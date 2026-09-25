/**
 * Self-contained layer tree utilities for the embedded MCP server.
 * These are simplified versions focused on the MCP tool use case.
 */

import type { Layer, DesignProperties, Breakpoint, UIState, CollectionFieldType, TranslationContentType } from '@/types';
import { generateId } from '@/lib/utils';
import { markdownToTiptapJson } from '@/lib/markdown-to-tiptap';
import {
  designToClassString,
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
 * Pre-process a collection item's `{ fieldId: value }` map so `rich_text`
 * fields are stored as valid Tiptap JSON. Non-rich-text fields pass through
 * untouched. Used by the create/update collection item tools before handing
 * values to setValuesByFieldName.
 */
export function coerceCollectionItemValues(
  values: Record<string, unknown>,
  fieldTypeById: Record<string, CollectionFieldType>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [fieldId, value] of Object.entries(values)) {
    result[fieldId] = fieldTypeById[fieldId] === 'rich_text'
      ? coerceRichTextValue(value)
      : value;
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

    // Regenerate base classes, preserve any state/breakpoint-prefixed classes
    const existingClasses = Array.isArray(layer.classes) ? layer.classes : (layer.classes || '').split(' ').filter(Boolean);
    const stateClasses = existingClasses.filter(cls =>
      cls.match(/^(max-lg:|max-md:|lg:|md:)?(hover:|focus:|active:|disabled:|current:)/) ||
      cls.match(/^(max-lg:|max-md:)/)
    );
    const baseClasses = designToClassString(mergedDesign);
    const allClasses = baseClasses ? `${baseClasses} ${stateClasses.join(' ')}`.trim() : stateClasses.join(' ');

    return { ...layer, design: mergedDesign, classes: allClasses };
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
    description: 'CMS collection list — repeats its children for each item in the bound collection. Bind to a collection after adding.',
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
