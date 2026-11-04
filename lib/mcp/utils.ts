/**
 * Self-contained layer tree utilities for the embedded MCP server.
 * These are simplified versions focused on the MCP tool use case.
 */

import type { Layer, DesignProperties, Breakpoint, UIState, CollectionField, TranslationContentType, LinkSettings, Page, GlobalVariableType } from '@/types';
import { resolveOptionValue } from '@/lib/collection-field-utils';
import { generateId } from '@/lib/utils';
import { findParentCollectionLayer } from '@/lib/layer-utils';
import { COLLECTION_ITEM_KEYWORDS } from '@/lib/link-utils';
import { markdownToTiptapJson } from '@/lib/markdown-to-tiptap';
import {
  propertyToClass,
  setBreakpointClass,
  buildBgImgVarName,
  buildBgImgClass,
} from '@/lib/tailwind-class-mapper';
import { getLayerFromTemplate } from '@/lib/templates/blocks';

export { generateId } from '@/lib/utils';
export { designToClassString } from '@/lib/tailwind-class-mapper';

export function findLayerById(layers: Layer[], id: string): Layer | null {
  for (const layer of layers) {
    if (layer.id === id) return layer;
    if (layer.children) {
      const found = findLayerById(layer.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function updateLayerById(
  layers: Layer[],
  id: string,
  updater: (layer: Layer) => Layer,
): Layer[] {
  return layers.map((layer) => {
    if (layer.id === id) return updater(layer);
    if (layer.children) {
      return { ...layer, children: updateLayerById(layer.children, id, updater) };
    }
    return layer;
  });
}

export interface ImageUpdate {
  /** New asset to display. Omit to keep the current image. */
  asset_id?: string;
  /** New alt text. Omit to keep the current alt. */
  alt?: string;
}

/**
 * Apply an image source and/or alt text change to a layer's image variable.
 *
 * Keeps whatever is not being changed, including a component-variable link
 * (`src.id`) so updating the picture inside a component does not unlink it.
 * Pass the result of this to `updateLayerById`.
 */
export function applyImageUpdate(layer: Layer, update: ImageUpdate): Layer {
  const existing = layer.variables?.image;
  const src = update.asset_id !== undefined
    ? { type: 'asset' as const, ...(existing?.src?.id ? { id: existing.src.id } : {}), data: { asset_id: update.asset_id } }
    : existing?.src;
  const alt = update.alt !== undefined
    ? { ...existing?.alt, type: 'dynamic_text' as const, data: { content: update.alt } }
    : existing?.alt ?? { type: 'dynamic_text' as const, data: { content: '' } };

  if (!src) {
    // Alt-only update on a layer that has no image yet: nothing to attach the alt to.
    return layer;
  }

  return {
    ...layer,
    variables: { ...layer.variables, image: { ...existing, src, alt } },
  };
}

/** Human-readable summary of an image update for batch results. */
export function describeImageUpdate(update: ImageUpdate): string {
  if (update.asset_id !== undefined && update.alt !== undefined) return 'Set image and alt text';
  if (update.alt !== undefined) return 'Set alt text';
  return 'Set image';
}

export function insertLayer(
  layers: Layer[],
  parentId: string,
  child: Layer,
  position?: number,
): Layer[] {
  return layers.map((layer) => {
    if (layer.id === parentId) {
      const children = [...(layer.children || [])];
      const idx = position !== undefined
        ? Math.min(position, children.length)
        : children.length;
      children.splice(idx, 0, child);
      return { ...layer, children };
    }
    if (layer.children) {
      return { ...layer, children: insertLayer(layer.children, parentId, child, position) };
    }
    return layer;
  });
}

export function removeLayer(layers: Layer[], id: string): Layer[] {
  return layers
    .filter((layer) => layer.id !== id)
    .map((layer) => {
      if (layer.children) {
        return { ...layer, children: removeLayer(layer.children, id) };
      }
      return layer;
    });
}

export function moveLayer(
  layers: Layer[],
  layerId: string,
  newParentId: string,
  position?: number,
): Layer[] {
  const layer = findLayerById(layers, layerId);
  if (!layer) return layers;
  const withoutLayer = removeLayer(layers, layerId);
  return insertLayer(withoutLayer, newParentId, layer, position);
}

const LEAF_ELEMENTS = new Set([
  'icon', 'image', 'audio', 'video', 'iframe',
  'text', 'span', 'label', 'hr',
  'input', 'textarea', 'select', 'checkbox', 'radio',
  'htmlEmbed',
]);

export function canHaveChildren(layer: Layer): boolean {
  if (layer.componentId) return false;
  return !LEAF_ELEMENTS.has(layer.name);
}

export interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

export interface TiptapDoc {
  type: 'doc';
  content: TiptapNode[];
}

export function getTiptapTextContent(text: string): TiptapDoc {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
  };
}

/** True when value is a Tiptap document node: `{ type: 'doc', content: [...] }`. */
export function isTiptapDoc(value: unknown): value is TiptapDoc {
  return (
    typeof value === 'object'
    && value !== null
    && (value as TiptapDoc).type === 'doc'
    && Array.isArray((value as TiptapDoc).content)
  );
}

/**
 * Validate a translation's content_value against its content_type so malformed
 * data is rejected before it reaches the database. Returns an actionable error
 * the AI can use to correct and retry.
 */
export function validateTranslationContent(
  contentType: TranslationContentType,
  contentValue: string,
): { valid: true } | { valid: false; error: string } {
  if (contentType === 'richtext') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(contentValue);
    } catch {
      return {
        valid: false,
        error: 'richtext content_value must be a JSON-stringified Tiptap document like {"type":"doc","content":[...]}. Prefer the set_rich_text_translation tool, which builds the JSON from simple blocks.',
      };
    }
    if (!isTiptapDoc(parsed)) {
      return {
        valid: false,
        error: 'richtext content_value parsed as JSON but is not a Tiptap document. It must have the shape {"type":"doc","content":[...]}. Prefer the set_rich_text_translation tool.',
      };
    }
    return { valid: true };
  }

  if (contentType === 'asset_id' && !contentValue.trim()) {
    return { valid: false, error: 'asset_id content_value must be a non-empty asset ID.' };
  }

  return { valid: true };
}

/**
 * Build a Tiptap document from a simplified block array.
 * Accepts an array of block descriptors and produces valid Tiptap JSON.
 *
 * Block types:
 *  - { type: "paragraph", text: "..." }
 *  - { type: "heading", level: 1-6, text: "..." }
 *  - { type: "blockquote", text: "..." }
 *  - { type: "bulletList", items: ["...", "..."] }
 *  - { type: "orderedList", items: ["...", "..."] }
 *  - { type: "codeBlock", text: "..." }
 *  - { type: "horizontalRule" }
 *  - { type: "htmlEmbed", code: "<script>...</script>" }
 *  - { type: "image", src: "...", alt?: "...", asset_id?: "..." }
 *  - { type: "table", rows: [["cell", "cell"], ...], header_row: true }
 *  - { type: "component", component_id: "..." }
 *
 * Text can include simple inline formatting via markdown-like syntax:
 *  - **bold**, *italic*, [link text](url)
 */
export function buildTiptapDoc(blocks: RichTextBlock[]): TiptapDoc {
  return {
    type: 'doc',
    content: blocks.map(blockToTiptapNode),
  };
}

export interface RichTextBlock {
  type:
    | 'paragraph' | 'heading' | 'blockquote'
    | 'bulletList' | 'orderedList'
    | 'codeBlock' | 'horizontalRule'
    | 'htmlEmbed' | 'image' | 'table' | 'component';
  text?: string;
  level?: number;
  items?: string[];
  code?: string;
  src?: string;
  alt?: string;
  asset_id?: string;
  rows?: string[][];
  header_row?: boolean;
  component_id?: string;
}

/**
 * Coerce a single collection-item `rich_text` value into the serialized Tiptap
 * JSON string the CMS editor and renderer expect. Accepts, in order:
 *  - an already-built Tiptap doc object → stringified;
 *  - a JSON string that parses to a Tiptap doc → passed through unchanged;
 *  - an array of RichTextBlock → built via buildTiptapDoc;
 *  - any other string → treated as markdown and converted.
 * Empty / nullish values become null.
 *
 * Agents naturally produce markdown, so a plain string "## Title\n\nBody" is
 * turned into proper rich text instead of being stored verbatim (which renders
 * empty/broken because castValue expects a Tiptap document).
 */
export function coerceRichTextValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  if (isTiptapDoc(value)) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return JSON.stringify(buildTiptapDoc(value as RichTextBlock[]));
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    // A pre-built Tiptap doc supplied as a JSON string passes through untouched.
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (isTiptapDoc(parsed)) return trimmed;
      } catch {
        // Not JSON — fall through and treat as markdown.
      }
    }
    return markdownToTiptapJson(value);
  }

  // Unknown object shape: stringify so it at least round-trips through storage.
  return JSON.stringify(value);
}

/**
 * Normalize an agent-supplied global variable value to its stored text form:
 * rich text becomes Tiptap JSON (markdown accepted) and a bare URL becomes a
 * link value. Other types are stored as given.
 */
export function coerceGlobalVariableValue(type: GlobalVariableType, value: string | null): string | null {
  if (value === null) return null;
  if (type === 'rich_text') return coerceRichTextValue(value);
  const trimmed = value.trim();
  if (type === 'link' && trimmed && !trimmed.startsWith('{')) {
    return JSON.stringify({ type: 'url', url: trimmed });
  }
  return value;
}

/**
 * Pre-process a collection item's `{ fieldId: value }` map so `rich_text`
 * fields are stored as valid Tiptap JSON and `option` fields store the option
 * name (an option id is accepted too). Other fields pass through untouched.
 * Used by the create/update collection item tools before handing values to
 * setValuesByFieldName.
 */
export function coerceCollectionItemValues(
  values: Record<string, unknown>,
  fields: Pick<CollectionField, 'id' | 'type' | 'data'>[],
): Record<string, unknown> {
  const fieldById = new Map(fields.map((f) => [f.id, f]));
  const result: Record<string, unknown> = {};
  for (const [fieldId, value] of Object.entries(values)) {
    const field = fieldById.get(fieldId);
    if (field?.type === 'rich_text') result[fieldId] = coerceRichTextValue(value);
    else if (field?.type === 'option') result[fieldId] = resolveOptionValue(field.data?.options, value);
    else result[fieldId] = value;
  }
  return result;
}

function parseInlineMarks(text: string): TiptapNode[] {
  const nodes: TiptapNode[] = [];
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*|\[(.+?)\]\((.+?)\)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }
    if (match[1]) {
      nodes.push({ type: 'text', text: match[1], marks: [{ type: 'bold' }] });
    } else if (match[2]) {
      nodes.push({ type: 'text', text: match[2], marks: [{ type: 'italic' }] });
    } else if (match[3] && match[4]) {
      nodes.push({
        type: 'text',
        text: match[3],
        // Match the canonical LinkSettings shape the renderer resolves via
        // getLinkSettingsFromMark/generateLinkHref — a bare { href } is ignored.
        marks: [{
          type: 'richTextLink',
          attrs: {
            type: 'url',
            url: { type: 'dynamic_text', data: { content: match[4] } },
            target: '_blank',
            rel: 'noopener noreferrer nofollow',
          },
        }],
      });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push({ type: 'text', text: text.slice(lastIndex) });
  }

  return nodes.length > 0 ? nodes : [{ type: 'text', text }];
}

function blockToTiptapNode(block: RichTextBlock): TiptapNode {
  switch (block.type) {
    case 'heading':
      return {
        type: 'heading',
        attrs: { level: block.level || 2 },
        content: block.text ? parseInlineMarks(block.text) : [],
      };
    case 'paragraph':
      return {
        type: 'paragraph',
        content: block.text ? parseInlineMarks(block.text) : [],
      };
    case 'blockquote':
      return {
        type: 'blockquote',
        content: [{
          type: 'paragraph',
          content: block.text ? parseInlineMarks(block.text) : [],
        }],
      };
    case 'bulletList':
      return {
        type: 'bulletList',
        content: (block.items || []).map((item) => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: parseInlineMarks(item) }],
        })),
      };
    case 'orderedList':
      return {
        type: 'orderedList',
        content: (block.items || []).map((item) => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: parseInlineMarks(item) }],
        })),
      };
    case 'codeBlock':
      return {
        type: 'codeBlock',
        content: block.text ? [{ type: 'text', text: block.text }] : [],
      };
    case 'horizontalRule':
      return { type: 'horizontalRule' };
    case 'htmlEmbed':
      return {
        type: 'richTextHtmlEmbed',
        attrs: { code: block.code || '' },
      };
    case 'image':
      return {
        type: 'richTextImage',
        attrs: {
          src: block.src || '',
          alt: block.alt || null,
          assetId: block.asset_id || null,
          link: null,
        },
      };
    case 'component':
      return {
        type: 'richTextComponent',
        attrs: { componentId: block.component_id || '' },
      };
    case 'table':
      return buildTableNode(block.rows || [], block.header_row !== false);
    default:
      return {
        type: 'paragraph',
        content: block.text ? [{ type: 'text', text: block.text }] : [],
      };
  }
}

function buildTableNode(rows: string[][], headerRow: boolean): TiptapNode {
  if (rows.length === 0) return { type: 'paragraph' };
  return {
    type: 'table',
    content: rows.map((row, rowIdx) => ({
      type: 'tableRow',
      content: row.map((cellText) => ({
        type: headerRow && rowIdx === 0 ? 'tableHeader' : 'tableCell',
        content: [{ type: 'paragraph', content: cellText ? parseInlineMarks(cellText) : [] }],
      })),
    })),
  };
}

/**
 * Normalize CSS values that don't map directly to Tailwind utilities.
 * e.g., "flex-start" → "start", "space-between" → "between", "Flex" → "flex"
 */
function normalizeDesignValues(
  design: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  const result = { ...design };

  if (result.layout && typeof result.layout === 'object') {
    const layout = { ...result.layout };

    if (typeof layout.display === 'string') {
      layout.display = layout.display.toLowerCase();
    }

    const flexValueMap: Record<string, string> = {
      'flex-start': 'start',
      'flex-end': 'end',
      'space-between': 'between',
      'space-around': 'around',
      'space-evenly': 'evenly',
    };

    for (const prop of ['justifyContent', 'alignItems', 'alignSelf', 'alignContent'] as const) {
      const val = layout[prop];
      if (typeof val === 'string' && flexValueMap[val]) {
        layout[prop] = flexValueMap[val];
      }
    }

    result.layout = layout;
  }

  return result;
}

export function applyDesignToLayer(
  layer: Layer,
  design: Record<string, Record<string, unknown>>,
  breakpoint: Breakpoint = 'desktop',
  uiState: UIState = 'neutral',
): Layer {
  const isNeutralDesktop = breakpoint === 'desktop' && uiState === 'neutral';

  // Normalize CSS values (flex-start→start, Flex→flex, etc.) before processing
  design = normalizeDesignValues(design);

  // Extract bgGradientVars/bgImageVars before processing — they hold raw CSS
  // values (not simple design properties) and need the backgroundImage design
  // property + bg-[image:var(--bg-img)] class wired up to actually render.
  const bgGradientVars = (design.backgrounds as Record<string, unknown>)?.bgGradientVars as Record<string, string> | undefined;
  const bgImageVars = normalizeBgImageVars(
    (design.backgrounds as Record<string, unknown>)?.bgImageVars as Record<string, string> | undefined,
  );
  const inputDesign = { ...design };
  if (inputDesign.backgrounds) {
    const { bgGradientVars: _, bgImageVars: __, ...restBg } = inputDesign.backgrounds as Record<string, unknown>;
    inputDesign.backgrounds = restBg;
  }

  if (isNeutralDesktop) {
    // Simple path: merge design and regenerate all classes (preserving state/breakpoint classes)
    const mergedDesign: DesignProperties = { ...layer.design };
    for (const [cat, props] of Object.entries(inputDesign)) {
      if (props && typeof props === 'object') {
        mergedDesign[cat as keyof DesignProperties] = {
          ...(mergedDesign[cat as keyof DesignProperties] || {}),
          ...props,
        } as DesignProperties[keyof DesignProperties];
      }
    }

    // Handle gradient/image vars
    if (bgGradientVars || bgImageVars) {
      const bgDesign = mergedDesign.backgrounds || {};
      if (bgGradientVars) bgDesign.bgGradientVars = { ...bgDesign.bgGradientVars, ...bgGradientVars };
      if (bgImageVars) bgDesign.bgImageVars = { ...bgDesign.bgImageVars, ...bgImageVars };
      const varName = buildBgImgVarName('desktop', 'neutral');
      if (bgGradientVars?.[varName] || bgImageVars?.[varName]) {
        bgDesign.backgroundImage = varName;
      }
      mergedDesign.backgrounds = bgDesign;
    }

    const changes: Record<string, Record<string, unknown>> = { ...inputDesign };
    if (mergedDesign.backgrounds?.backgroundImage && (bgGradientVars || bgImageVars)) {
      changes.backgrounds = {
        ...(changes.backgrounds || {}),
        backgroundImage: mergedDesign.backgrounds.backgroundImage,
      };
    }

    // Only touch classes for the properties being changed (same as the builder's
    // useDesignSync). Layer classes can carry base classes the design object
    // doesn't describe (e.g. layout templates), so regenerating everything from
    // the design would silently drop them.
    let classes = Array.isArray(layer.classes) ? [...layer.classes] : (layer.classes || '').split(' ').filter(Boolean);
    for (const [cat, props] of Object.entries(changes)) {
      if (!props || typeof props !== 'object') continue;
      for (const [prop, value] of Object.entries(props)) {
        if (prop === 'isActive' || value === undefined) continue;
        const cls = value === null || value === ''
          ? null
          : propertyToClass(cat as keyof DesignProperties, prop, String(value));
        const updated = setBreakpointClass(classes, prop, cls, 'desktop', 'neutral');
        if (updated === classes && cls) {
          for (const c of cls.split(' ').filter(Boolean)) {
            if (!updated.includes(c)) updated.push(c);
          }
        }
        classes = updated;
      }
    }

    return { ...layer, design: mergedDesign, classes: classes.join(' ') };
  }

  // State/breakpoint path: apply each property with prefix via setBreakpointClass
  let classes = Array.isArray(layer.classes) ? [...layer.classes] : (layer.classes || '').split(' ').filter(Boolean);

  for (const [cat, props] of Object.entries(inputDesign)) {
    if (!props || typeof props !== 'object') continue;
    for (const [prop, value] of Object.entries(props as Record<string, unknown>)) {
      if (prop === 'isActive' || value === undefined || value === null) continue;
      const cls = propertyToClass(cat as keyof DesignProperties, prop, String(value));
      if (cls) {
        classes = setBreakpointClass(classes, prop, cls, breakpoint, uiState);
      }
    }
  }

  // Handle gradient/image vars for non-neutral states
  if (bgGradientVars || bgImageVars) {
    const bgDesign = { ...(layer.design?.backgrounds || {}) };
    if (bgGradientVars) bgDesign.bgGradientVars = { ...bgDesign.bgGradientVars, ...bgGradientVars };
    if (bgImageVars) bgDesign.bgImageVars = { ...bgDesign.bgImageVars, ...bgImageVars };
    const varName = buildBgImgVarName(breakpoint, uiState);
    if (bgGradientVars?.[varName] || bgImageVars?.[varName]) {
      bgDesign.backgroundImage = bgDesign.backgroundImage || buildBgImgVarName('desktop', 'neutral');
      const bgImgClass = buildBgImgClass(varName);
      classes = setBreakpointClass(classes, 'backgroundImage', bgImgClass, breakpoint, uiState);
    }
    const mergedDesign = { ...layer.design, backgrounds: bgDesign };
    return { ...layer, design: mergedDesign, classes: classes.join(' ') };
  }

  return { ...layer, classes: classes.join(' ') };
}

/**
 * Wrap bare image URLs in `url(...)` so bgImageVars values are always valid
 * CSS background-image values (gradients and already-wrapped values pass through).
 */
function normalizeBgImageVars(vars?: Record<string, string>): Record<string, string> | undefined {
  if (!vars) return vars;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    const needsWrap = typeof value === 'string' && !value.startsWith('url(') && !value.includes('gradient(');
    result[key] = needsWrap ? `url(${value})` : value;
  }
  return result;
}

/**
 * Ensure a layer's design + classes actually render its `variables.backgroundImage`.
 *
 * Setting the variable alone only provides the `--bg-img` CSS value at render time —
 * nothing consumes it until the layer also has `design.backgrounds.backgroundImage`
 * pointing at the var (which generates the `bg-[image:var(--bg-img)]` class).
 * Mirrors what the builder's BackgroundsControls does when picking an image.
 * Cover/center/no-repeat defaults are only applied when not already set.
 */
export function applyBackgroundImageDesign(layer: Layer): Layer {
  const bg = layer.design?.backgrounds || {};
  const patch: Record<string, unknown> = {
    isActive: true,
    backgroundImage: buildBgImgVarName('desktop', 'neutral'),
  };
  if (!bg.backgroundSize) patch.backgroundSize = 'cover';
  if (!bg.backgroundPosition) patch.backgroundPosition = 'center';
  if (!bg.backgroundRepeat) patch.backgroundRepeat = 'no-repeat';
  return applyDesignToLayer(layer, { backgrounds: patch });
}

// ── Shared layer-edit helpers (single tools + batch ops) ─────────────────────

export interface BackgroundImageInput {
  asset_id?: string;
  url?: string;
}

/**
 * Set a layer's background image from an asset or URL and make sure the
 * design/classes render it. Returns the layer unchanged when neither is given.
 */
export function applyBackgroundImage(layer: Layer, input: BackgroundImageInput): Layer {
  const src = input.asset_id
    ? { type: 'asset' as const, data: { asset_id: input.asset_id } }
    : input.url
      ? { type: 'dynamic_text' as const, data: { content: input.url } }
      : null;
  if (!src) return layer;

  return applyBackgroundImageDesign({
    ...layer,
    variables: { ...layer.variables, backgroundImage: { src } },
  });
}

export interface LinkInput {
  link_type: 'url' | 'email' | 'phone' | 'asset' | 'page';
  url?: string;
  page_id_target?: string;
  collection_item_id?: string;
  email?: string;
  phone?: string;
  asset_id?: string;
  anchor_layer_id?: string;
  target?: '_blank' | '_self' | '_parent' | '_top';
  rel?: string;
  download?: boolean;
}

export type DynamicPageLinkTarget = Pick<Page, 'is_dynamic' | 'settings'>;

/**
 * A link to a dynamic page must say WHICH item it opens — without a
 * collection_item_id the renderer prints the literal "/blog/{slug}". Agents
 * link cards inside a Collection List to the detail page constantly, so fill
 * in the keyword they mean: "current-collection" when the layer is (or sits
 * inside) a list of the page's collection, "current-page" when the layer is on
 * a dynamic page of that collection. Anything else is left for the agent.
 */
export function defaultDynamicPageItem<T extends LinkInput>(
  input: T,
  layers: Layer[],
  layerId: string,
  targetPage: DynamicPageLinkTarget | null | undefined,
  currentPage?: DynamicPageLinkTarget | null,
): T {
  if (input.link_type !== 'page' || input.collection_item_id || !targetPage?.is_dynamic) return input;
  const collectionId = targetPage.settings?.cms?.collection_id;
  if (!collectionId) return input;

  const self = findLayerById(layers, layerId);
  const list = self?.variables?.collection?.id ? self : findParentCollectionLayer(layers, layerId);
  if (list?.variables?.collection?.id === collectionId) {
    return { ...input, collection_item_id: COLLECTION_ITEM_KEYWORDS.CURRENT_COLLECTION };
  }
  if (currentPage?.is_dynamic && currentPage.settings?.cms?.collection_id === collectionId) {
    return { ...input, collection_item_id: COLLECTION_ITEM_KEYWORDS.CURRENT_PAGE };
  }
  return input;
}

/**
 * Build the LinkSettings a layer stores from the agent-facing link fields.
 * Pass `existing` to keep a component-variable link (`variable_id`) intact.
 */
export function buildLinkSettings(input: LinkInput, existing?: LinkSettings): LinkSettings {
  const link: LinkSettings = { type: input.link_type };
  if (input.link_type === 'url' && input.url) link.url = { type: 'dynamic_text', data: { content: input.url } };
  if (input.link_type === 'email' && input.email) link.email = { type: 'dynamic_text', data: { content: input.email } };
  if (input.link_type === 'phone' && input.phone) link.phone = { type: 'dynamic_text', data: { content: input.phone } };
  if (input.link_type === 'asset' && input.asset_id) link.asset = { id: input.asset_id };
  if (input.link_type === 'page' && input.page_id_target) {
    link.page = input.collection_item_id
      ? { id: input.page_id_target, collection_item_id: input.collection_item_id }
      : { id: input.page_id_target };
  }
  if (input.anchor_layer_id) link.anchor_layer_id = input.anchor_layer_id;
  if (input.target) link.target = input.target;
  if (input.rel !== undefined) link.rel = input.rel;
  if (input.download !== undefined) link.download = input.download;

  // variable_id is a runtime extension on LinkSettings used by component linking.
  const variableId = (existing as { variable_id?: string } | undefined)?.variable_id;
  if (variableId) (link as LinkSettings & { variable_id?: string }).variable_id = variableId;

  return link;
}

/**
 * Normalize `anchor_layer_id` to the target element's HTML id, the value the
 * builder stores and the renderer turns into `href="#id"`. Accepts either a
 * layer id or an HTML id already present on `targetLayers` (the page the link
 * points to). Returns an error when the anchor cannot render.
 */
export function resolveLinkAnchor<T extends LinkInput>(
  input: T,
  targetLayers: Layer[],
): { input: T } | { error: string } {
  const raw = input.anchor_layer_id?.replace(/^#/, '');
  if (!raw) return { input };

  const byLayerId = findLayerById(targetLayers, raw);
  if (byLayerId) {
    const htmlId = byLayerId.settings?.id || byLayerId.attributes?.id;
    if (!htmlId) {
      return {
        error: `Layer "${raw}" has no HTML id, so there is nothing to scroll to. Give it one first with update_layer_settings (html_id, e.g. "features"), then link to it.`,
      };
    }
    return { input: { ...input, anchor_layer_id: htmlId } };
  }

  const exists = (list: Layer[]): boolean => list.some((l) =>
    l.settings?.id === raw || l.attributes?.id === raw || (l.children ? exists(l.children) : false));
  if (exists(targetLayers)) return { input: { ...input, anchor_layer_id: raw } };

  return {
    error: `No layer with id or HTML id "${raw}" on the target page. Pass a layer id whose layer has an HTML id (update_layer_settings html_id).`,
  };
}

/** Summary for tool results, e.g. "Set page link". */
export function describeLink(input: LinkInput): string {
  return `Set ${input.link_type} link`;
}

export interface LayerSettingsInput {
  tag?: string;
  html_id?: string;
  custom_name?: string;
  hidden?: boolean;
  keep_in_html?: boolean;
  custom_attributes?: Record<string, string>;
  html_embed_code?: string;
}

const FORM_FIELD_LAYERS = new Set(['input', 'textarea', 'select']);

/** Field attributes the builder's field settings edit on `layer.attributes` (lowercased → stored key). */
const FORM_FIELD_ATTRIBUTES: Record<string, string> = {
  type: 'type',
  name: 'name',
  placeholder: 'placeholder',
  value: 'value',
  required: 'required',
  autofocus: 'autoFocus',
};
const BOOLEAN_FIELD_ATTRIBUTES = new Set(['required', 'autoFocus']);

/**
 * Splits custom attributes on a form field into the field's own attributes
 * (stored on `layer.attributes`, like the builder does) and the rest.
 */
function applyFieldAttributes(layer: Layer, customAttributes: Record<string, string>) {
  const attributes: Record<string, unknown> = { ...layer.attributes };
  const remaining: Record<string, string> = {};
  const fieldKeys: string[] = [];
  // The 401 page's password input must keep name/type for the verify endpoint.
  const isLocked = layer.restrictions?.copy === false && layer.restrictions?.delete === false;

  for (const [name, value] of Object.entries(customAttributes)) {
    const key = FORM_FIELD_ATTRIBUTES[name.toLowerCase()];
    if (!key) {
      remaining[name] = value;
      continue;
    }
    fieldKeys.push(name);
    if (isLocked && (key === 'name' || key === 'type')) continue;
    if (BOOLEAN_FIELD_ATTRIBUTES.has(key)) {
      if (value === 'false') delete attributes[key];
      else attributes[key] = true;
    } else if (value === '') {
      delete attributes[key];
    } else {
      attributes[key] = value;
    }
  }
  return { attributes, remaining, fieldKeys };
}

/**
 * Apply the element-agnostic layer settings (tag, id, name, hidden, custom
 * attributes, embed code). Element-specific settings (slider, lightbox, map,
 * options source) are handled only by update_layer_settings.
 */
export function applyLayerSettings(layer: Layer, input: LayerSettingsInput): Layer {
  const settings = { ...layer.settings };
  let attributes = layer.attributes;
  if (input.tag) settings.tag = input.tag;
  if (input.html_id) settings.id = input.html_id;
  if (input.hidden !== undefined) settings.hidden = input.hidden;
  if (input.keep_in_html !== undefined) settings.keepInHtml = input.keep_in_html;
  if (input.custom_attributes) {
    let customAttributes = input.custom_attributes;
    if (FORM_FIELD_LAYERS.has(layer.name)) {
      const split = applyFieldAttributes(layer, customAttributes);
      attributes = split.attributes;
      customAttributes = split.remaining;
      // Drop stale copies so they don't override the field's own value.
      const existing = Object.fromEntries(
        Object.entries(settings.customAttributes || {}).filter(([name]) => !split.fieldKeys.some((k) => k.toLowerCase() === name.toLowerCase())),
      );
      settings.customAttributes = { ...existing, ...customAttributes };
    } else {
      settings.customAttributes = { ...settings.customAttributes, ...customAttributes };
    }
  }
  if (input.html_embed_code !== undefined) settings.htmlEmbed = { ...settings.htmlEmbed, code: input.html_embed_code };

  return {
    ...layer,
    settings,
    ...(attributes !== layer.attributes ? { attributes } : {}),
    ...(input.custom_name ? { customName: input.custom_name } : {}),
  };
}

// ── Element Templates ────────────────────────────────────────────────────────

function textLayerTemplate(
  text: string,
  tag: string,
  design: DesignProperties,
  classes: string | string[],
): Omit<Layer, 'id'> {
  return {
    name: 'text',
    settings: { tag },
    classes,
    restrictions: { editText: true },
    design,
    variables: {
      text: { type: 'dynamic_rich_text', data: { content: getTiptapTextContent(text) } },
    },
  };
}

interface InlineTemplate {
  name: string;
  description: string;
  template: Omit<Layer, 'id'>;
  useBlocksTemplate?: never;
}

interface BlocksTemplate {
  name: string;
  description: string;
  template?: never;
  useBlocksTemplate: true;
}

type ElementTemplateEntry = InlineTemplate | BlocksTemplate;

export const ELEMENT_TEMPLATES: Record<string, ElementTemplateEntry> = {
  div: {
    name: 'Block',
    description: 'Generic container element (div)',
    template: {
      name: 'div',
      classes: ['flex', 'flex-col'],
      children: [],
      design: { layout: { isActive: true, display: 'Flex', flexDirection: 'column' } },
    },
  },
  section: {
    name: 'Section',
    description: 'Full-width section wrapper',
    template: {
      name: 'section',
      classes: ['flex', 'flex-col', 'w-[100%]', 'pt-[80px]', 'pb-[80px]', 'items-center'],
      children: [],
      design: {
        layout: { isActive: true, display: 'Flex', flexDirection: 'column', alignItems: 'center' },
        sizing: { isActive: true, width: '100%' },
        spacing: { isActive: true, paddingTop: '80px', paddingBottom: '80px' },
      },
    },
  },
  container: {
    name: 'Container',
    description: 'Max-width container (1280px)',
    template: {
      name: 'div',
      classes: ['flex', 'flex-col', 'max-w-[1280px]', 'w-[100%]', 'pl-[32px]', 'pr-[32px]'],
      children: [],
      design: {
        layout: { isActive: true, display: 'Flex', flexDirection: 'column' },
        sizing: { isActive: true, width: '100%', maxWidth: '1280px' },
        spacing: { isActive: true, paddingLeft: '32px', paddingRight: '32px' },
      },
    },
  },
  hr: {
    name: 'Separator',
    description: 'Horizontal rule / divider',
    template: {
      name: 'hr',
      classes: ['border-t', 'border-[#d1d5db]'],
      design: { borders: { isActive: true, borderWidth: '1px 0 0 0', borderColor: '#d1d5db' } },
    },
  },
  heading: {
    name: 'Heading',
    description: 'Large heading text (h1)',
    template: textLayerTemplate('Heading', 'h1', {
      typography: { isActive: true, fontSize: '48px', fontWeight: '700', lineHeight: '1.1', letterSpacing: '-0.01' },
    }, ['text-[48px]', 'font-[700]', 'leading-[1.1]', 'tracking-[-0.01em]']),
  },
  text: {
    name: 'Text',
    description: 'Paragraph text',
    template: textLayerTemplate('Text', 'p', {
      typography: { isActive: true, fontSize: '16px' },
    }, ['text-[16px]']),
  },
  image: {
    name: 'Image',
    description: 'Image element',
    template: {
      name: 'image',
      settings: { tag: 'img' },
      classes: ['w-[100%]', 'object-cover'],
      attributes: { loading: 'lazy' },
      design: { sizing: { isActive: true, width: '100%', objectFit: 'cover' } },
      variables: {
        image: {
          src: { type: 'asset', data: { asset_id: null } },
          alt: { type: 'dynamic_text', data: { content: 'Image description' } },
        },
      },
    },
  },
  icon: {
    name: 'Icon',
    description: 'SVG icon element',
    template: {
      name: 'icon',
      classes: ['w-[24px]', 'h-[24px]'],
      settings: { tag: 'div' },
      design: { sizing: { isActive: true, width: '24px', height: '24px' } },
      variables: { icon: { src: { type: 'asset', data: { asset_id: null } } } },
    },
  },
  video: {
    name: 'Video',
    description: 'Video element',
    template: {
      name: 'video',
      classes: ['w-full', 'h-auto', 'aspect-[16/9]', 'overflow-hidden'],
      attributes: { controls: true, preload: 'metadata' },
      design: { sizing: { isActive: true, width: '100%', height: 'auto', aspectRatio: '16/9' } },
      variables: { video: { src: { type: 'asset', data: { asset_id: null } } } },
    },
  },
  audio: {
    name: 'Audio',
    description: 'Audio player element',
    template: {
      name: 'audio',
      classes: [],
      attributes: { controls: true, preload: 'metadata' },
      variables: { audio: { src: { type: 'asset', data: { asset_id: null } } } },
    },
  },
  button: {
    name: 'Button',
    description: 'Button element with text',
    template: {
      name: 'button',
      classes: [
        'flex', 'flex-row', 'items-center', 'justify-center',
        'text-[#FFFFFF]', 'pr-[16px]', 'pl-[16px]', 'pt-[8px]', 'pb-[8px]',
        'text-[14px]', 'rounded-[12px]', 'bg-[#171717]',
      ],
      attributes: { type: 'button' },
      design: {
        typography: { isActive: true, color: '#ffffff', fontSize: '16px' },
        spacing: { isActive: true, paddingLeft: '16px', paddingRight: '16px', paddingTop: '8px', paddingBottom: '8px' },
        backgrounds: { backgroundColor: '#171717', isActive: true },
      },
      children: [],
    },
  },
  form: {
    name: 'Form',
    description: 'Native form, pre-populated with name/email/message fields, a submit button, and success/error alerts. Configure submission behavior via update_form_settings. Add or remove native field children (input, textarea, select, etc.) to customize.',
    useBlocksTemplate: true,
  },
  input: {
    name: 'Input',
    description: 'Native text input with a label wrapper. Set the field type/placeholder/name via update_layer_settings.',
    useBlocksTemplate: true,
  },
  textarea: {
    name: 'Textarea',
    description: 'Native multi-line textarea with a label wrapper.',
    useBlocksTemplate: true,
  },
  htmlEmbed: {
    name: 'Code Embed',
    description: 'Custom HTML/CSS/JS embed',
    template: {
      name: 'htmlEmbed',
      classes: ['w-full'],
      settings: { tag: 'div', htmlEmbed: { code: '<div>Custom HTML here</div>' } },
      design: { sizing: { isActive: true, width: '100%' } },
    },
  },
  iframe: {
    name: 'Embed',
    description: 'Iframe embed',
    template: {
      name: 'iframe',
      classes: ['w-full', 'h-[400px]'],
      design: { sizing: { isActive: true, width: '100%', height: '400px' } },
      variables: { iframe: { src: { type: 'dynamic_text', data: { content: '' } } } },
    },
  },
  richText: {
    name: 'Rich Text',
    description: 'Rich text block with headings, paragraphs, lists, quotes, links, and inline formatting',
    template: {
      name: 'richText',
      classes: ['flex', 'flex-col', 'gap-[16px]', 'text-[16px]'],
      restrictions: { editText: true },
      design: {
        layout: { isActive: true, display: 'Flex', flexDirection: 'column', gap: '16px' },
        typography: { isActive: true, fontSize: '16px' },
      },
      variables: {
        text: {
          type: 'dynamic_rich_text',
          data: {
            content: {
              type: 'doc',
              content: [
                { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Heading' }] },
                { type: 'paragraph', content: [{ type: 'text', text: 'Start writing your content here.' }] },
              ],
            },
          },
        },
      },
    },
  },
  columns: {
    name: 'Columns',
    description: '2-column horizontal layout using flexbox.',
    useBlocksTemplate: true,
  },
  grid: {
    name: 'Grid',
    description: '2x2 CSS Grid layout.',
    useBlocksTemplate: true,
  },
  collection: {
    name: 'Collection List',
    description: 'CMS collection list — the REPEATED ITEM: this layer and its children are cloned once per item of the bound collection. Add it inside a parent div that holds the list layout (grid / gap); style this layer as the card. Bind with bind_collection_layer after adding.',
    useBlocksTemplate: true,
  },
  select: {
    name: 'Select',
    description: 'Dropdown select input for forms.',
    useBlocksTemplate: true,
  },
  checkbox: {
    name: 'Checkbox',
    description: 'Checkbox input for forms.',
    useBlocksTemplate: true,
  },
  radio: {
    name: 'Radio',
    description: 'Radio button input for forms.',
    useBlocksTemplate: true,
  },
  filter: {
    name: 'Filter',
    description: 'Collection filter input — filters a collection list by a field value.',
    useBlocksTemplate: true,
  },
  label: {
    name: 'Label',
    description: 'Form label element.',
    useBlocksTemplate: true,
  },
  map: {
    name: 'Map',
    description: 'Interactive map element.',
    useBlocksTemplate: true,
  },
  slider: {
    name: 'Slider',
    description: 'Image/content slider (carousel) with navigation arrows, pagination bullets, and configurable autoplay. Comes with 3 default slides.',
    useBlocksTemplate: true,
  },
  lightbox: {
    name: 'Lightbox',
    description: 'Lightbox overlay for viewing images in a fullscreen gallery with navigation, thumbnails, and zoom.',
    useBlocksTemplate: true,
  },
  localeSelector: {
    name: 'Locale Selector',
    description: 'Language switcher dropdown for multi-language sites.',
    useBlocksTemplate: true,
  },
  table: {
    name: 'Table',
    description: 'Data table (renders as <table>). Pre-populated with a header row and two body rows.',
    useBlocksTemplate: true,
  },
  thead: {
    name: 'Table Header',
    description: '<thead> with one header row. Add inside a table.',
    useBlocksTemplate: true,
  },
  tbody: {
    name: 'Table Body',
    description: '<tbody> with one row. Add inside a table.',
    useBlocksTemplate: true,
  },
  tr: {
    name: 'Table Row',
    description: '<tr>. Add inside thead or tbody.',
    useBlocksTemplate: true,
  },
  td: {
    name: 'Table Cell',
    description: '<td>. Add inside a tr.',
    useBlocksTemplate: true,
  },
  th: {
    name: 'Table Header Cell',
    description: '<th>. Add inside a thead tr.',
    useBlocksTemplate: true,
  },
};

export function createLayerFromTemplate(
  templateKey: string,
  overrides?: { customName?: string; textContent?: string; richContent?: RichTextBlock[] },
): Layer | null {
  const entry = ELEMENT_TEMPLATES[templateKey];
  if (!entry) return null;

  // Complex composite elements (slider, lightbox) use the full blocks template system
  if (entry.useBlocksTemplate) {
    const layer = getLayerFromTemplate(templateKey, overrides?.customName ? { customName: overrides.customName } : undefined);
    return layer;
  }

  const assignIds = (layerData: Omit<Layer, 'id'> & { id?: string }): Layer => {
    const layer = { ...layerData, id: generateId('lyr') } as Layer;
    if (Array.isArray(layer.children)) {
      layer.children = layer.children.map((child) => assignIds(child));
    }
    return layer;
  };

  const layer = assignIds({ ...entry.template });

  if (overrides?.customName) {
    layer.customName = overrides.customName;
  }

  if (overrides?.textContent && (layer.name === 'text' || layer.name === 'richText')) {
    layer.variables = {
      ...layer.variables,
      text: { type: 'dynamic_rich_text', data: { content: getTiptapTextContent(overrides.textContent) } },
    };
  }

  if (overrides?.richContent && layer.name === 'richText') {
    layer.variables = {
      ...layer.variables,
      text: { type: 'dynamic_rich_text', data: { content: buildTiptapDoc(overrides.richContent) } },
    };
  }

  if (templateKey === 'button') {
    const buttonText = overrides?.textContent || 'Button';
    const textChild = assignIds({
      name: 'text',
      settings: { tag: 'span' },
      classes: [],
      design: {},
      restrictions: { editText: true },
      variables: {
        text: { type: 'dynamic_rich_text', data: { content: getTiptapTextContent(buttonText) } },
      },
    } as Omit<Layer, 'id'>);
    layer.children = [textChild];
  }

  return layer;
}
