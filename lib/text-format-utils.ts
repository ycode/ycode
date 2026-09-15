import React from 'react';
import type { TextStyle, DynamicRichTextVariable, LinkSettings, Component } from '@/types';
import { cn } from '@/lib/utils';
import { formatFieldValue, resolveFieldFromSources } from '@/lib/cms-variables-utils';
import { generateLinkHref, type LinkResolutionContext } from '@/lib/link-utils';
import { contentHasBlockElements, hasBlockElementsWithResolver } from '@/lib/tiptap-utils';
import { applyComponentOverrides, resolveComponents } from '@/lib/resolve-components';
import type { GlobalFieldMeta } from '@/lib/collection-field-utils';
import { getDefaultFormatId, isFormatValidForFieldType } from '@/lib/variable-format-utils';
import { getLinkSettingsFromMark } from '@/lib/tiptap-extensions/link-settings';
import HtmlEmbedRenderer from '@/components/HtmlEmbedRenderer';

/**
 * Context for resolving rich text links - re-exports LinkResolutionContext for backwards compatibility
 */
export type RichTextLinkContext = LinkResolutionContext;

/**
 * Replace stale global-variable snapshots in a Tiptap document with the current
 * metadata from the globals list. Pills still store the stable global id, but
 * type/format are render-time concerns: if a global changes from number to date,
 * every layer using that id should render as a date immediately, even if the
 * layer was never opened and re-saved in the sidebar editor.
 */
function refreshGlobalVariableNodes<T>(node: T, globalsMeta?: Record<string, GlobalFieldMeta>): T {
  if (!globalsMeta || !node || typeof node !== 'object') return node;

  const tiptapNode = node as any;
  let nextNode = tiptapNode;

  if (
    tiptapNode.type === 'dynamicVariable' &&
    tiptapNode.attrs?.variable?.type === 'field' &&
    tiptapNode.attrs.variable.data?.source === 'global' &&
    tiptapNode.attrs.variable.data?.field_id
  ) {
    const variable = tiptapNode.attrs.variable;
    const meta = globalsMeta[variable.data.field_id];
    if (meta) {
      const currentFormat = variable.data.format;
      const nextFormat = isFormatValidForFieldType(currentFormat, meta.type)
        ? currentFormat
        : getDefaultFormatId(meta.type);
      const nextVariable = {
        ...variable,
        data: {
          ...variable.data,
          field_type: meta.type,
          format: nextFormat,
        },
      };
      nextNode = {
        ...tiptapNode,
        attrs: {
          ...tiptapNode.attrs,
          label: meta.name,
          variable: nextVariable,
        },
      };
    }
  }

  if (Array.isArray(nextNode.content)) {
    let changed = nextNode !== tiptapNode;
    const content = nextNode.content.map((child: any) => {
      const refreshed = refreshGlobalVariableNodes(child, globalsMeta);
      if (refreshed !== child) changed = true;
      return refreshed;
    });
    if (changed) {
      return { ...nextNode, content };
    }
  }

  return nextNode as T;
}

/**
 * Get a human-readable label for a text style
 * Returns the style.label if it exists, otherwise formats the key (camelCase to Title Case)
 * @param key - The text style key (e.g., 'bold', 'bulletList')
 * @param style - Optional TextStyle object that may contain a label
 * @returns Formatted label string
 */
export function getTextStyleLabel(key: string, style?: TextStyle): string {
  // Dynamic styles (dts-*) get a generic label
  if (key.startsWith('dts-')) {
    return 'Dynamic Style';
  }

  // Return the label if it exists
  if (style?.label) {
    return style.label;
  }

  // Convert camelCase to Title Case
  // e.g., 'bulletList' → 'Bullet List', 'bold' → 'Bold'
  return key
    .replace(/([A-Z])/g, ' $1') // Add space before capital letters
    .replace(/^./, (str) => str.toUpperCase()) // Capitalize first letter
    .trim();
}

/**
 * Default text styles for formatting marks (bold, italic, underline, etc.)
 * Used in text element templates and can be overridden per layer
 */
export const DEFAULT_TEXT_STYLES: Record<string, TextStyle> = {
  h1: {
    label: 'Heading 1',
    classes: 'text-[30px] font-semibold',
    design: {
      typography: { fontSize: '30px', fontWeight: 'semibold' },
    },
  },
  h2: {
    label: 'Heading 2',
    classes: 'text-[24px] font-semibold',
    design: {
      typography: { fontSize: '24px', fontWeight: 'semibold' },
    },
  },
  h3: {
    label: 'Heading 3',
    classes: 'text-[20px] font-semibold',
    design: {
      typography: { fontSize: '20px', fontWeight: 'semibold' },
    },
  },
  h4: {
    label: 'Heading 4',
    classes: 'text-[18px] font-semibold',
    design: {
      typography: { fontSize: '18px', fontWeight: 'semibold' },
    },
  },
  h5: {
    label: 'Heading 5',
    classes: 'text-[16px] font-semibold',
    design: {
      typography: { fontSize: '16px', fontWeight: 'semibold' },
    },
  },
  h6: {
    label: 'Heading 6',
    classes: 'text-[14px] font-semibold',
    design: {
      typography: { fontSize: '14px', fontWeight: 'semibold' },
    },
  },
  paragraph: {
    label: 'Paragraph',
    classes: '',
    design: {},
  },
  // Inline formatting marks
  bold: {
    label: 'Bold',
    classes: 'font-bold',
    design: {
      typography: { fontWeight: 'bold' },
    },
  },
  italic: {
    label: 'Italic',
    classes: 'italic',
    design: {
      typography: { fontStyle: 'italic' },
    },
  },
  underline: {
    label: 'Underline',
    classes: 'underline',
    design: {
      typography: { textDecoration: 'underline' },
    },
  },
  strike: {
    label: 'Strikethrough',
    classes: 'line-through',
    design: {
      typography: { textDecoration: 'line-through' },
    },
  },
  subscript: {
    label: 'Subscript',
    classes: 'align-sub',
    design: {
      typography: { verticalAlign: 'sub' },
    },
  },
  superscript: {
    label: 'Superscript',
    classes: 'align-super',
    design: {
      typography: { verticalAlign: 'super' },
    },
  },
  code: {
    label: 'Code',
    classes: 'font-mono bg-muted px-[4px] py-[2px] rounded text-[14px]',
    design: {
      typography: { fontFamily: 'mono', fontSize: '14px' },
      backgrounds: { backgroundColor: 'muted' },
      spacing: { paddingLeft: '4px', paddingRight: '4px', paddingTop: '2px', paddingBottom: '2px' },
      borders: { borderRadius: 'rounded' },
    },
  },
  link: {
    label: 'Link',
    classes: 'text-[#1c70d7] underline underline-offset-2',
    design: {
      typography: {
        textDecoration: 'underline',
        color: '#1c70d7',
      },
    },
  },
  bulletList: {
    label: 'Bullet list',
    classes: 'ml-[8px] pl-[16px] list-disc',
    design: {
      spacing: { marginLeft: '8px', paddingLeft: '16px' },
    },
  },
  orderedList: {
    label: 'Ordered list',
    classes: 'ml-[8px] pl-[20px] list-decimal',
    design: {
      spacing: { marginLeft: '8px', paddingLeft: '20px' },
    },
  },
  listItem: {
    label: 'List Item',
    classes: '',
  },
  blockquote: {
    label: 'Blockquote',
    classes: 'border-l-[3px] border-current/20 pl-[16px]',
    design: {
      borders: { borderLeftWidth: '3px' },
      spacing: { paddingLeft: '16px' },
    },
  },
  richTextImage: {
    label: 'Image',
    classes: 'block max-w-full h-auto rounded-[4px]',
    design: {
      layout: { display: 'block' },
      sizing: { maxWidth: '100%', height: 'auto' },
      borders: { borderRadius: '4px' },
    },
  },
  horizontalRule: {
    label: 'Separator',
    classes: 'border-t-[1px] border-[#aeaeae]',
    design: {
      borders: { borderTopWidth: '1px', borderColor: '#aeaeae' },
    },
  },
  // Table elements
  table: {
    label: 'Table',
    classes: 'w-full border-separate border-spacing-0 mt-[20px] mb-[20px] border-solid border-[1px] border-[#000000]/10 rounded-[10px] overflow-hidden',
    design: {
      sizing: { width: '100%' },
      spacing: { marginTop: '20', marginBottom: '20', isActive: true },
      borders: { isActive: true, borderColor: '#000000/10', borderStyle: 'solid', borderWidth: '1', borderRadius: '10' },
    },
  },
  tableHeader: {
    label: 'Table header cell',
    classes: 'text-left font-[500] pt-[12px] pr-[12px] pb-[12px] pl-[12px] bg-[#000000]/5',
    design: {
      borders: { isActive: true, borderWidthMode: 'all' },
      spacing: { paddingLeft: '12', paddingRight: '12', paddingTop: '12', paddingBottom: '12', isActive: true },
      typography: { textAlign: 'left', fontWeight: '500', isActive: true },
      backgrounds: { isActive: true, backgroundColor: '#000000/5' },
    },
  },
  tableCell: {
    label: 'Table cell',
    classes: 'pt-[12px] pr-[12px] pb-[12px] pl-[12px]',
    design: {
      borders: { isActive: true, borderWidthMode: 'individual', borderRadiusMode: 'individual' },
      spacing: { paddingLeft: '12', paddingRight: '12', paddingTop: '12', paddingBottom: '12', isActive: true },
      typography: { textAlign: 'left', verticalAlign: 'top', isActive: true },
      backgrounds: { isActive: true },
    },
  },
  tableRow: {
    label: 'Table row',
    classes: '',
    design: {
      borders: { isActive: true },
      backgrounds: { isActive: true },
    },
  },
};

/**
 * Get a text style by key, falling back to DEFAULT_TEXT_STYLES
 * @param textStyles - Layer's custom text styles (may be undefined)
 * @param key - Text style key (e.g., 'h1', 'bold', 'paragraph')
 */
export function getTextStyle(
  textStyles: Record<string, TextStyle> | undefined,
  key: string
): TextStyle | undefined {
  return textStyles?.[key] ?? DEFAULT_TEXT_STYLES[key];
}

/**
 * Get text style classes by key, falling back to DEFAULT_TEXT_STYLES
 * @param textStyles - Layer's custom text styles (may be undefined)
 * @param key - Text style key (e.g., 'h1', 'bold', 'paragraph')
 */
export function getTextStyleClasses(
  textStyles: Record<string, TextStyle> | undefined,
  key: string
): string {
  return textStyles?.[key]?.classes ?? DEFAULT_TEXT_STYLES[key]?.classes ?? '';
}

/**
 * Create a Tiptap text object from a plain string
 * Returns the standard Tiptap JSON structure: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: ... }] }] }
 */
export function getTiptapTextContent(text: string): {
  type: 'doc';
  content: Array<{
    type: 'paragraph';
    content: Array<{ type: 'text'; text: string }>;
  }>;
} {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: text ? [{ type: 'text', text }] : [],
      },
    ],
  };
}

/**
 * Resolve the link href for a richTextImage node.
 * Reads from the `link` attribute (full LinkSettings) first, falling back to legacy `href`.
 * In edit mode, uses '#' placeholder to avoid expensive link resolution.
 */
function resolveImageLinkHref(
  attrs: Record<string, unknown> | undefined,
  isEditMode: boolean,
  linkContext?: RichTextLinkContext,
  collectionItemData?: Record<string, string>,
  pageCollectionItemData?: Record<string, string>,
): string | null {
  if (!attrs) return null;

  const storedLink = attrs.link as LinkSettings | null;
  if (!storedLink?.type) return null;

  if (isEditMode) return '#';

  const fullContext: LinkResolutionContext = {
    ...linkContext,
    collectionItemData,
    pageCollectionItemData,
  };
  return generateLinkHref(storedLink, fullContext) || null;
}

/**
 * Flatten multi-paragraph Tiptap content into a single paragraph with hardBreak nodes.
 * Used for heading/text elements that should not contain nested block elements.
 * Treats `heading` blocks like paragraphs so their inline content is preserved without
 * producing a nested <h1>-<h6> inside the simple text layer's own heading tag.
 * Converts: [paragraph("a"), heading("b")] → [paragraph("a", hardBreak, "b")]
 */
export function flattenTiptapParagraphs(content: any): any {
  if (!content || typeof content !== 'object' || content.type !== 'doc') return content;
  const blocks = content.content;
  if (!Array.isArray(blocks) || blocks.length === 0) return content;

  const FLATTENABLE = new Set(['paragraph', 'heading']);
  const allFlattenable = blocks.every((b: any) => FLATTENABLE.has(b?.type));
  if (!allFlattenable) return content;

  if (blocks.length === 1 && blocks[0].type === 'paragraph') return content;

  const merged: any[] = [];
  blocks.forEach((block: any, i: number) => {
    if (i > 0 && merged.length > 0) {
      merged.push({ type: 'hardBreak' });
    }
    if (block.content && Array.isArray(block.content)) {
      merged.push(...block.content);
    }
  });

  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: merged }],
  };
}

/**
 * Get variable node metadata and raw value
 * Returns the field type and raw value (useful for rich_text handling)
 */
function getVariableNodeData(
  node: any,
  collectionItemData?: Record<string, string>,
  pageCollectionItemData?: Record<string, string>,
  layerDataMap?: Record<string, Record<string, string>>
): { fieldType: string | null; rawValue: unknown; format?: string } {
  if (node.attrs?.variable?.type === 'field' && node.attrs.variable.data?.field_id) {
    const { field_id, field_type, relationships = [], source, collection_layer_id, format } = node.attrs.variable.data;

    const fieldPath = relationships.length > 0
      ? [field_id, ...relationships].join('.')
      : field_id;

    const rawValue = resolveFieldFromSources(fieldPath, source, collectionItemData, pageCollectionItemData, collection_layer_id, layerDataMap);
    return { fieldType: field_type || null, rawValue, format };
  }

  return { fieldType: null, rawValue: undefined };
}

/**
 * Resolve inline variable in Tiptap node
 * @param node - TipTap dynamicVariable node
 * @param collectionItemData - Data from collection layer items
 * @param pageCollectionItemData - Data from page collection (dynamic pages)
 * @param timezone - Timezone for formatting date values
 */
function resolveVariableNode(
  node: any,
  collectionItemData?: Record<string, string>,
  pageCollectionItemData?: Record<string, string>,
  timezone: string = 'UTC'
): string {
  const { fieldType, rawValue, format } = getVariableNodeData(node, collectionItemData, pageCollectionItemData);
  return formatFieldValue(rawValue, fieldType, timezone, format);
}

/**
 * Render a text node with its marks (bold, italic, underline, strike)
 * @param isEditMode - If true, adds data-style attributes for style selection on canvas
 * @param collectionItemData - Collection layer item values for resolving inline variables
 * @param pageCollectionItemData - Page collection item values for resolving inline variables (dynamic pages)
 * @param layerDataMap - Map of layer ID → item data for layer-specific resolution
 */
function renderTextNode(
  node: any,
  key: string,
  textStyles?: Record<string, TextStyle>,
  isEditMode = false,
  collectionItemData?: Record<string, string>,
  pageCollectionItemData?: Record<string, string>,
  linkContext?: RichTextLinkContext,
  layerDataMap?: Record<string, Record<string, string>>
): React.ReactNode {
  let text: React.ReactNode = node.text || '';

  // Helper: use layer textStyles if set, otherwise fall back to DEFAULT_TEXT_STYLES
  const getMarkClass = (markKey: string) => getTextStyleClasses(textStyles, markKey);

  // Apply marks in reverse order (innermost to outermost)
  if (node.marks && Array.isArray(node.marks)) {
    for (let i = node.marks.length - 1; i >= 0; i--) {
      const mark = node.marks[i];
      // Build props with optional data-style for edit mode
      const buildProps = (markKey: string, className?: string) => {
        const props: Record<string, any> = { key: `${key}-${markKey}`, className };
        if (isEditMode) {
          props['data-style'] = markKey;
        }
        return props;
      };

      switch (mark.type) {
        case 'bold':
          text = React.createElement('strong', buildProps('bold', getMarkClass('bold')), text);
          break;
        case 'italic':
          text = React.createElement('em', buildProps('italic', getMarkClass('italic')), text);
          break;
        case 'underline':
          text = React.createElement('u', buildProps('underline', getMarkClass('underline')), text);
          break;
        case 'strike':
          text = React.createElement('s', buildProps('strike', getMarkClass('strike')), text);
          break;
        case 'subscript':
          text = React.createElement('sub', buildProps('subscript', getMarkClass('subscript')), text);
          break;
        case 'superscript':
          text = React.createElement('sup', buildProps('superscript', getMarkClass('superscript')), text);
          break;
        case 'dynamicStyle': {
          // Dynamic style stores an array of styleKeys
          const styleKeys: string[] = mark.attrs?.styleKeys || [];
          // Backwards compatibility: single styleKey
          if (styleKeys.length === 0 && mark.attrs?.styleKey) {
            styleKeys.push(mark.attrs.styleKey);
          }
          // Combine classes from all styleKeys using cn() for intelligent merging
          // Later styles override earlier ones for conflicting properties
          const mergedStyles = { ...DEFAULT_TEXT_STYLES, ...textStyles };
          const classesArray = styleKeys
            .map(k => mergedStyles[k]?.classes || '')
            .filter(Boolean);
          const styleClasses = cn(...classesArray);
          const lastKey = styleKeys[styleKeys.length - 1];
          const props: Record<string, any> = {
            key: `${key}-${lastKey || 'dynamicStyle'}`,
            className: styleClasses,
          };
          if (isEditMode) {
            props['data-style-keys'] = JSON.stringify(styleKeys);
            props['data-style-key'] = lastKey; // For click detection
          }
          text = React.createElement('span', props, text);
          break;
        }
        case 'richTextLink': {
          // Rich text link with full LinkSettings stored in attrs
          // In edit mode, skip expensive link resolution and just use '#'
          const href = isEditMode
            ? '#'
            : (() => {
              // Build context with collection item data for inline variable resolution
              const fullContext: LinkResolutionContext = {
                ...linkContext,
                collectionItemData,
                pageCollectionItemData,
              };
              // Normalise attrs to canonical LinkSettings (tolerates legacy
              // { href, linkType } shape) before resolving the href.
              return generateLinkHref(getLinkSettingsFromMark(mark.attrs || {}), fullContext) || '#';
            })();

          const linkProps: Record<string, any> = {
            key: `${key}-richTextLink`,
            href,
            className: getMarkClass('link'),
          };

          if (mark.attrs?.target) {
            linkProps.target = mark.attrs.target;
          }
          if (mark.attrs?.rel || mark.attrs?.target === '_blank') {
            linkProps.rel = mark.attrs.rel || 'noopener noreferrer';
          }
          if (mark.attrs?.download) {
            linkProps.download = true;
          }

          // In edit mode, prevent navigation and add data-style for styling
          if (isEditMode) {
            linkProps.onClick = (e: React.MouseEvent) => e.preventDefault();
            linkProps['data-style'] = 'link';
          }

          text = React.createElement('a', linkProps, text);
          break;
        }
      }
    }
  }

  return text;
}

/**
 * Render nested rich text content from a Tiptap JSON structure.
 * Used when a rich_text CMS field is inserted as an inline variable.
 * When useSpanForParagraphs is true (default), block elements render as spans
 * to avoid invalid HTML nesting inside restrictive tags like <p> or <h1>.
 */
function renderNestedRichTextContent(
  richTextValue: any,
  key: string,
  collectionItemData?: Record<string, string>,
  pageCollectionItemData?: Record<string, string>,
  textStyles?: Record<string, TextStyle>,
  isEditMode = false,
  linkContext?: RichTextLinkContext,
  timezone: string = 'UTC',
  layerDataMap?: Record<string, Record<string, string>>,
  components?: Component[],
  renderComponentBlock?: RenderComponentBlockFn,
  ancestorComponentIds?: Set<string>,
  useSpanForParagraphs = true,
): React.ReactNode[] {
  if (!richTextValue) {
    return [];
  }

  let parsed = richTextValue;
  if (typeof richTextValue === 'string') {
    try {
      parsed = JSON.parse(richTextValue);
    } catch {
      return [React.createElement('span', { key }, richTextValue)];
    }
  }

  if (typeof parsed !== 'object') {
    return [];
  }

  if (parsed.type === 'doc' && Array.isArray(parsed.content)) {
    return parsed.content.map((block: any, blockIdx: number) =>
      renderBlock(block, blockIdx, collectionItemData, pageCollectionItemData, textStyles, useSpanForParagraphs, isEditMode, linkContext, timezone, layerDataMap, components, renderComponentBlock, ancestorComponentIds)
    ).filter(Boolean);
  }

  return [];
}

/**
 * Render inline content (text nodes, variables, formatting)
 */
function renderInlineContent(
  content: any[],
  collectionItemData?: Record<string, string>,
  pageCollectionItemData?: Record<string, string>,
  textStyles?: Record<string, TextStyle>,
  isEditMode = false,
  linkContext?: RichTextLinkContext,
  timezone: string = 'UTC',
  layerDataMap?: Record<string, Record<string, string>>,
  components?: Component[],
  renderComponentBlock?: RenderComponentBlockFn,
  ancestorComponentIds?: Set<string>,
  useSpanForParagraphs = true,
): React.ReactNode[] {
  return content.flatMap((node, idx) => {
    const key = `node-${idx}`;

    if (node.type === 'text') {
      return [renderTextNode(node, key, textStyles, isEditMode, collectionItemData, pageCollectionItemData, linkContext, layerDataMap)];
    }

    if (node.type === 'dynamicVariable') {
      const { fieldType, rawValue, format } = getVariableNodeData(node, collectionItemData, pageCollectionItemData, layerDataMap);

      // Handle rich_text fields - render nested Tiptap content
      if (fieldType === 'rich_text' && rawValue) {
        let richTextValue: unknown = rawValue;
        if (typeof rawValue === 'string') {
          try {
            richTextValue = JSON.parse(rawValue);
          } catch {
            richTextValue = null;
          }
        }
        if (richTextValue && typeof richTextValue === 'object') {
          return renderNestedRichTextContent(
            richTextValue,
            key,
            collectionItemData,
            pageCollectionItemData,
            textStyles,
            isEditMode,
            linkContext,
            timezone,
            layerDataMap,
            components,
            renderComponentBlock,
            ancestorComponentIds,
            useSpanForParagraphs,
          );
        }
      }

      // For other field types, render as text with optional format
      const value = formatFieldValue(rawValue, fieldType, timezone, format);
      const textNode = {
        type: 'text',
        text: value,
        marks: node.marks || [],
      };
      return [renderTextNode(textNode, key, textStyles, isEditMode, collectionItemData, pageCollectionItemData, undefined, layerDataMap)];
    }

    // Handle embedded component nodes preserved during flattening (from CMS rich_text fields)
    if (node.type === 'richTextComponent' && node.attrs?.componentId) {
      const rendered = renderRichTextComponentBlock(node, key, components, renderComponentBlock, ancestorComponentIds);
      return rendered ? [rendered] : [];
    }

    // Handle HTML embed nodes that may appear inline from CMS rich_text expansion
    if (node.type === 'richTextHtmlEmbed') {
      const htmlCode = node.attrs?.code || '';
      if (!htmlCode) return [];

      return [React.createElement(HtmlEmbedRenderer, { key, code: htmlCode })];
    }

    // Handle richTextImage nodes that may appear inline from CMS rich_text expansion.
    // Legacy migrated content may use `image` as the node type — accept both.
    if (node.type === 'richTextImage' || node.type === 'image') {
      const imgProps: Record<string, any> = {
        key,
        src: node.attrs?.src || '',
        alt: node.attrs?.alt || '',
        className: getTextStyleClasses(textStyles, 'richTextImage'),
      };
      if (node.attrs?.assetId) {
        imgProps['data-asset-id'] = node.attrs.assetId;
      }
      const imgEl = React.createElement('img', imgProps);

      const imgLinkHref = resolveImageLinkHref(node.attrs, isEditMode, linkContext, collectionItemData, pageCollectionItemData);
      if (imgLinkHref) {
        const imgTarget = node.attrs?.link?.target || undefined;
        return [React.createElement('a', {
          key,
          href: imgLinkHref,
          target: imgTarget,
          rel: imgTarget === '_blank' ? 'noopener noreferrer' : undefined,
        }, imgEl)];
      }

      return [imgEl];
    }

    if (node.type === 'hardBreak') {
      return [React.createElement('br', { key })];
    }

    // Handle list nodes that were preserved during flattening
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      const listClass = textStyles?.[node.type]?.classes ??
        DEFAULT_TEXT_STYLES[node.type]?.classes ?? '';
      const tag = node.type === 'bulletList' ? 'ul' : 'ol';
      const listProps: Record<string, any> = { key, className: listClass };
      if (isEditMode) {
        listProps['data-style'] = node.type;
      }
      const items = node.content?.map((item: any, itemIdx: number) =>
        renderListItem(item, `${key}-${itemIdx}`, collectionItemData, pageCollectionItemData, textStyles, isEditMode, linkContext, timezone, layerDataMap, components, renderComponentBlock, ancestorComponentIds, itemIdx)
      ) || [];
      return [React.createElement(tag, listProps, ...items)];
    }

    return [];
  }).filter(Boolean);
}

/**
 * Callback for rendering an embedded component block inside rich-text.
 * Receives the resolved component, its layers with overrides applied, and a unique key.
 * `ancestorComponentIds` tracks the component chain to prevent infinite loops.
 */
export type RenderComponentBlockFn = (
  component: Component,
  resolvedLayers: import('@/types').Layer[],
  overrides: import('@/types').Layer['componentOverrides'],
  key: string,
  ancestorComponentIds?: Set<string>,
) => React.ReactNode;

/**
 * Render an embedded component node to React.
 * Resolves the component, applies overrides, and delegates to the callback.
 * Tracks ancestor component IDs to prevent infinite loops.
 */
function renderRichTextComponentBlock(
  block: any,
  key: string,
  components?: Component[],
  renderComponentBlock?: RenderComponentBlockFn,
  ancestorComponentIds?: Set<string>,
): React.ReactNode {
  const componentId = block.attrs.componentId as string;
  const overrides = block.attrs.componentOverrides ?? undefined;

  // Prevent circular rendering
  if (ancestorComponentIds?.has(componentId)) {
    return null;
  }

  const component = components?.find(c => c.id === componentId);

  // Build updated ancestor set including the current component
  const updatedAncestors = new Set(ancestorComponentIds);
  updatedAncestors.add(componentId);

  // Published/SSR path: layers are pre-resolved server-side by
  // resolveRichTextCollections (nested components and collections at any depth),
  // so the full `components` library is not needed on the client — only the
  // resolved layers. This lets published pages serialize an empty `components`
  // array, keeping the RSC payload small without curating which definitions survive.
  if (block.attrs._resolvedLayers) {
    // Component metadata is unused when rendering pre-resolved layers; fall back
    // to a lightweight stub so an empty `components` array still renders.
    const resolvedComponent = component ?? ({ id: componentId, name: '' } as Component);
    if (!renderComponentBlock) {
      return React.createElement('span', { key, 'data-component-id': componentId }, `[${resolvedComponent.name}]`);
    }
    return renderComponentBlock(resolvedComponent, block.attrs._resolvedLayers, overrides, key, updatedAncestors);
  }

  // Fallback (edit mode): resolve from the component definition, which requires
  // the full component metadata and library to be present.
  if (!component) {
    return React.createElement('span', { key, className: 'text-xs text-muted-foreground' }, '[missing component]');
  }

  if (!renderComponentBlock) {
    return React.createElement('span', { key, 'data-component-id': componentId }, `[${component.name}]`);
  }

  if (!component.layers?.length) {
    return React.createElement('span', { key, className: 'text-xs text-muted-foreground' }, '[missing component]');
  }

  const withOverrides = applyComponentOverrides(
    component.layers,
    overrides,
    component.variables,
  );

  // Resolve nested component instances so they render in non-edit mode
  const resolvedLayers = components?.length
    ? resolveComponents(withOverrides, components, component.variables, overrides)
    : withOverrides;

  return renderComponentBlock(component, resolvedLayers, overrides, key, updatedAncestors);
}

/**
 * Render a paragraph or list item block
 */
function renderBlock(
  block: any,
  idx: number,
  collectionItemData?: Record<string, string>,
  pageCollectionItemData?: Record<string, string>,
  textStyles?: Record<string, TextStyle>,
  useSpanForParagraphs = false,
  isEditMode = false,
  linkContext?: RichTextLinkContext,
  timezone: string = 'UTC',
  layerDataMap?: Record<string, Record<string, string>>,
  components?: Component[],
  renderComponentBlock?: RenderComponentBlockFn,
  ancestorComponentIds?: Set<string>,
): React.ReactNode {
  const key = `block-${idx}`;

  if (block.type === 'paragraph') {
    const paragraphClass = getTextStyleClasses(textStyles, 'paragraph');
    const paragraphProps: Record<string, any> = { key, className: paragraphClass };
    if (isEditMode) {
      paragraphProps['data-style'] = 'paragraph';
    }

    // Empty paragraphs use non-breaking space to preserve the empty line
    if (!block.content || block.content.length === 0) {
      const emptyTag = useSpanForParagraphs ? 'span' : 'p';
      return React.createElement(emptyTag, paragraphProps, '\u00A0');
    }

    // Use div when paragraph contains block-level content (rich_text variables or embedded components)
    const hasBlockContent = block.content?.some((n: any) =>
      (n.type === 'dynamicVariable' && n.attrs?.variable?.data?.field_type === 'rich_text') ||
      n.type === 'richTextComponent'
    );
    const tag = hasBlockContent ? 'div' : useSpanForParagraphs ? 'span' : 'p';

    return React.createElement(tag, paragraphProps, ...renderInlineContent(block.content, collectionItemData, pageCollectionItemData, textStyles, isEditMode, linkContext, timezone, layerDataMap, components, renderComponentBlock, ancestorComponentIds, useSpanForParagraphs));
  }

  if (block.type === 'heading') {
    const level = block.attrs?.level as 1 | 2 | 3 | 4 | 5 | 6 || 1;
    const styleKey = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
    const headingClass = getTextStyleClasses(textStyles, styleKey);
    // Use span when inside restrictive tags (p, h1-h6, etc.) to avoid invalid HTML nesting
    const tag = useSpanForParagraphs ? 'span' : styleKey;

    // Empty headings use non-breaking space to preserve the empty line
    if (!block.content || block.content.length === 0) {
      return React.createElement(tag, { key, className: headingClass }, '\u00A0');
    }

    const headingProps: Record<string, any> = { key, className: headingClass };
    if (isEditMode) {
      headingProps['data-style'] = styleKey;
    }
    return React.createElement(tag, headingProps, ...renderInlineContent(block.content, collectionItemData, pageCollectionItemData, textStyles, isEditMode, linkContext, timezone, layerDataMap, components, renderComponentBlock, ancestorComponentIds, useSpanForParagraphs));
  }

  if (block.type === 'bulletList') {
    const ulProps: Record<string, any> = {
      key,
      className: getTextStyleClasses(textStyles, 'bulletList'),
    };
    if (isEditMode) {
      ulProps['data-style'] = 'bulletList';
    }
    return React.createElement(
      'ul',
      ulProps,
      block.content?.map((item: any, itemIdx: number) =>
        renderListItem(item, `${key}-${itemIdx}`, collectionItemData, pageCollectionItemData, textStyles, isEditMode, linkContext, timezone, layerDataMap, components, renderComponentBlock, ancestorComponentIds, itemIdx)
      )
    );
  }

  if (block.type === 'orderedList') {
    const olProps: Record<string, any> = {
      key,
      className: getTextStyleClasses(textStyles, 'orderedList'),
    };
    if (isEditMode) {
      olProps['data-style'] = 'orderedList';
    }
    return React.createElement(
      'ol',
      olProps,
      block.content?.map((item: any, itemIdx: number) =>
        renderListItem(item, `${key}-${itemIdx}`, collectionItemData, pageCollectionItemData, textStyles, isEditMode, linkContext, timezone, layerDataMap, components, renderComponentBlock, ancestorComponentIds, itemIdx)
      )
    );
  }

  if (block.type === 'blockquote') {
    const bqProps: Record<string, any> = {
      key,
      className: getTextStyleClasses(textStyles, 'blockquote'),
    };
    if (isEditMode) {
      bqProps['data-style'] = 'blockquote';
    }
    return React.createElement(
      'blockquote',
      bqProps,
      block.content?.map((child: any, childIdx: number) =>
        renderBlock(child, childIdx, collectionItemData, pageCollectionItemData, textStyles, useSpanForParagraphs, isEditMode, linkContext, timezone, layerDataMap, components, renderComponentBlock, ancestorComponentIds)
      )
    );
  }

  if (block.type === 'richTextImage' || block.type === 'image') {
    const imgProps: Record<string, any> = {
      key,
      src: block.attrs?.src || '',
      alt: block.attrs?.alt || '',
      className: getTextStyleClasses(textStyles, 'richTextImage'),
    };
    if (isEditMode) {
      imgProps['data-style'] = 'richTextImage';
    }
    if (block.attrs?.assetId) {
      imgProps['data-asset-id'] = block.attrs.assetId;
    }
    const imgElement = React.createElement('img', imgProps);

    const imgLinkHref = resolveImageLinkHref(block.attrs, isEditMode, linkContext, collectionItemData, pageCollectionItemData);
    if (imgLinkHref) {
      const imgTarget = block.attrs?.link?.target || undefined;
      return React.createElement('a', {
        key,
        href: imgLinkHref,
        target: imgTarget,
        rel: imgTarget === '_blank' ? 'noopener noreferrer' : undefined,
      }, imgElement);
    }

    return imgElement;
  }

  if (block.type === 'horizontalRule') {
    const hrProps: Record<string, any> = {
      key,
      className: getTextStyleClasses(textStyles, 'horizontalRule'),
    };
    if (isEditMode) {
      hrProps['data-style'] = 'horizontalRule';
    }
    return React.createElement('hr', hrProps);
  }

  // Handle embedded component blocks
  if (block.type === 'richTextComponent' && block.attrs?.componentId) {
    return renderRichTextComponentBlock(block, key, components, renderComponentBlock, ancestorComponentIds);
  }

  if (block.type === 'table') {
    const rows = (block.content || []).map((row: any, rowIdx: number) =>
      renderTableNode(row, `${key}-row-${rowIdx}`, collectionItemData, pageCollectionItemData, textStyles, isEditMode, linkContext, timezone, layerDataMap, components, renderComponentBlock, ancestorComponentIds, rowIdx)
    );

    const tbodyProps: Record<string, any> = { key: `${key}-tbody` };
    const tableClass = getTextStyleClasses(textStyles, 'table');
    const tableProps: Record<string, any> = { key: `${key}-table` };
    if (tableClass) tableProps.className = tableClass;
    if (isEditMode) tableProps['data-style'] = 'table';

    return React.createElement(
      'div',
      { key, className: 'overflow-x-auto max-w-full' },
      React.createElement('table', tableProps,
        React.createElement('tbody', tbodyProps, rows)
      )
    );
  }

  // Handle HTML embed blocks
  if (block.type === 'richTextHtmlEmbed') {
    const htmlCode = block.attrs?.code || '';
    if (!htmlCode) return null;

    return React.createElement(HtmlEmbedRenderer, { key, code: htmlCode });
  }

  return null;
}

/**
 * Recursively render a Tiptap table node (tableRow, tableCell, tableHeader)
 */
function renderTableNode(
  node: any,
  key: string,
  collectionItemData?: Record<string, string>,
  pageCollectionItemData?: Record<string, string>,
  textStyles?: Record<string, TextStyle>,
  isEditMode = false,
  linkContext?: RichTextLinkContext,
  timezone: string = 'UTC',
  layerDataMap?: Record<string, Record<string, string>>,
  components?: Component[],
  renderComponentBlock?: RenderComponentBlockFn,
  ancestorComponentIds?: Set<string>,
  nodeIdx = 0,
  parentRowIdx = 0,
): React.ReactNode {
  if (!node) return null;

  const rowIdx = node.type === 'tableRow' ? nodeIdx : parentRowIdx;

  const children = (node.content || []).map((child: any, idx: number) => {
    if (child.type === 'tableRow' || child.type === 'tableCell' || child.type === 'tableHeader') {
      return renderTableNode(child, `${key}-${idx}`, collectionItemData, pageCollectionItemData, textStyles, isEditMode, linkContext, timezone, layerDataMap, components, renderComponentBlock, ancestorComponentIds, idx, rowIdx);
    }
    return renderBlock(child, idx, collectionItemData, pageCollectionItemData, textStyles, false, isEditMode, linkContext, timezone, layerDataMap, components, renderComponentBlock, ancestorComponentIds);
  });

  const tagMap: Record<string, string> = {
    tableRow: 'tr',
    tableCell: 'td',
    tableHeader: 'th',
  };

  const tag = tagMap[node.type] || 'div';
  const styleKeyMap: Record<string, string> = {
    tableRow: 'tableRow',
    tableCell: 'tableCell',
    tableHeader: 'tableHeader',
  };
  const styleKey = styleKeyMap[node.type];
  let className = styleKey ? getTextStyleClasses(textStyles, styleKey) : '';

  if (node.type === 'tableCell' || node.type === 'tableHeader') {
    const borders: string[] = [];
    if (parentRowIdx > 0) borders.push('border-t-[1px]');
    if (nodeIdx > 0) borders.push('border-l-[1px]');
    if (borders.length > 0) {
      const borderClasses = `${borders.join(' ')} border-solid border-[#000000]/10`;
      className = className ? `${className} ${borderClasses}` : borderClasses;
    }
  }

  const props: Record<string, any> = { key };
  if (className) props.className = className;
  if (isEditMode && styleKey) props['data-style'] = styleKey;

  if ((node.type === 'tableCell' || node.type === 'tableHeader') && node.attrs) {
    if (node.attrs.colspan && node.attrs.colspan > 1) props.colSpan = node.attrs.colspan;
    if (node.attrs.rowspan && node.attrs.rowspan > 1) props.rowSpan = node.attrs.rowspan;
  }

  return React.createElement(tag, props, children);
}

/**
 * Render a list item
 */
function renderListItem(
  item: any,
  key: string,
  collectionItemData?: Record<string, string>,
  pageCollectionItemData?: Record<string, string>,
  textStyles?: Record<string, TextStyle>,
  isEditMode = false,
  linkContext?: RichTextLinkContext,
  timezone: string = 'UTC',
  layerDataMap?: Record<string, Record<string, string>>,
  components?: Component[],
  renderComponentBlock?: RenderComponentBlockFn,
  ancestorComponentIds?: Set<string>,
  itemIdx?: number,
): React.ReactNode {
  if (item.type !== 'listItem') return null;

  const children = item.content?.flatMap((block: any, idx: number) => {
    if (block.type === 'paragraph') {
      return renderInlineContent(block.content || [], collectionItemData, pageCollectionItemData, textStyles, isEditMode, linkContext, timezone, layerDataMap, components, renderComponentBlock, ancestorComponentIds);
    }
    return renderBlock(block, idx, collectionItemData, pageCollectionItemData, textStyles, false, isEditMode, linkContext, timezone, layerDataMap, components, renderComponentBlock, ancestorComponentIds);
  });

  const liProps: Record<string, any> = {
    key,
    className: getTextStyleClasses(textStyles, 'listItem'),
  };
  if (isEditMode) {
    liProps['data-style'] = 'listItem';
    if (itemIdx !== undefined) {
      liProps['data-list-item-index'] = itemIdx;
    }
  }
  return React.createElement('li', liProps, children);
}

/**
 * Check if rich text content contains block-level elements (lists)
 * These cannot be nested inside restrictive tags and require tag replacement
 */
export function hasBlockElements(variable: DynamicRichTextVariable): boolean {
  return contentHasBlockElements(variable.data.content);
}

/**
 * Check if rich text content contains block-level elements, including inline variables
 * that resolve to rich_text CMS fields with lists
 * @param variable - The DynamicRichTextVariable to check
 * @param collectionItemData - Collection item values (for resolving inline variables)
 * @param pageCollectionItemData - Page collection item values (for dynamic pages)
 */
export function hasBlockElementsWithInlineVariables(
  variable: DynamicRichTextVariable,
  collectionItemData?: Record<string, string>,
  pageCollectionItemData?: Record<string, string>
): boolean {
  const content = variable.data.content;

  // Create a resolver function for the shared utility
  const resolveValue = (fieldId: string, relationships?: string[], source?: string) => {
    const lookupKey = relationships && relationships.length > 0
      ? [fieldId, ...relationships].join('.')
      : fieldId;

    if (source === 'page') {
      return pageCollectionItemData?.[lookupKey];
    }
    return collectionItemData?.[lookupKey] ?? pageCollectionItemData?.[lookupKey];
  };

  return hasBlockElementsWithResolver(content, resolveValue);
}

/**
 * Render DynamicRichTextVariable content to React elements
 * @param collectionItemData - Merged collection layer data
 * @param pageCollectionItemData - Data from page collection (dynamic pages)
 * @param useSpanForParagraphs - If true, renders paragraphs as <span class="block"> instead of <p>
 * @param isEditMode - If true, adds data-style attributes for style selection on canvas
 * @param linkContext - Context for resolving page/asset/field links
 * @param timezone - Timezone for formatting date values
 * @param layerDataMap - Map of layer ID → item data for layer-specific resolution
 * @param components - Available components for resolving embedded component nodes
 * @param renderComponentBlock - Callback to render a resolved component block
 */
export function renderRichText(
  variable: DynamicRichTextVariable,
  collectionItemData?: Record<string, string>,
  pageCollectionItemData?: Record<string, string>,
  textStyles?: Record<string, TextStyle>,
  useSpanForParagraphs = false,
  isEditMode = false,
  linkContext?: RichTextLinkContext,
  timezone: string = 'UTC',
  layerDataMap?: Record<string, Record<string, string>>,
  components?: Component[],
  renderComponentBlock?: RenderComponentBlockFn,
  ancestorComponentIds?: Set<string>,
  isSimpleTextElement = false,
  globalsMeta?: Record<string, GlobalFieldMeta>,
): React.ReactNode {
  const content = refreshGlobalVariableNodes(variable.data.content, globalsMeta);

  if (!content || typeof content !== 'object' || !('type' in content)) {
    return null;
  }

  const doc = content as any;

  if (doc.type !== 'doc' || !doc.content || !Array.isArray(doc.content)) {
    return null;
  }

  // If there's only a single paragraph, render its content inline (no <p> or <span> wrapper)
  if (doc.content.length === 1 && doc.content[0].type === 'paragraph') {
    const paragraph = doc.content[0];

    // When the sole paragraph contains only a rich_text CMS variable, the variable expands
    // to multiple block elements. Return them unwrapped so they become direct children of
    // the parent container — otherwise flex gap/spacing breaks.
    const hasSoleRichTextVariable = paragraph.content?.length === 1 &&
      paragraph.content[0].type === 'dynamicVariable' &&
      paragraph.content[0].attrs?.variable?.data?.field_type === 'rich_text';

    if (hasSoleRichTextVariable) {
      const nestedUseSpans = isSimpleTextElement ? true : useSpanForParagraphs;
      const inlineContent = renderInlineContent(paragraph.content, collectionItemData, pageCollectionItemData, textStyles, isEditMode, linkContext, timezone, layerDataMap, components, renderComponentBlock, ancestorComponentIds, nestedUseSpans);
      return Array.isArray(inlineContent) ? inlineContent : [inlineContent];
    }

    if (!paragraph.content || paragraph.content.length === 0) {
      if (isEditMode && !isSimpleTextElement) {
        const paragraphClass = textStyles?.paragraph?.classes ?? DEFAULT_TEXT_STYLES.paragraph?.classes ?? '';
        return React.createElement('span', { 'data-style': 'paragraph', 'data-block-index': 0, className: paragraphClass }, '\u00A0');
      }
      return null;
    }
    const inlineContent = renderInlineContent(paragraph.content, collectionItemData, pageCollectionItemData, textStyles, isEditMode, linkContext, timezone, layerDataMap, components, renderComponentBlock, ancestorComponentIds, useSpanForParagraphs);
    if (!isSimpleTextElement) {
      // Wrap so inline nodes (text + <strong>, etc.) form a single flow unit.
      // Without this, a parent with `flex flex-col` turns each text node /
      // inline element into separate flex items that stack vertically.
      const tag = useSpanForParagraphs ? 'span' : 'p';
      const paragraphClass = textStyles?.paragraph?.classes ?? DEFAULT_TEXT_STYLES.paragraph?.classes ?? '';
      const children = Array.isArray(inlineContent) ? inlineContent : [inlineContent];
      const props: Record<string, any> = { className: paragraphClass || undefined };
      if (isEditMode) {
        props['data-style'] = 'paragraph';
        props['data-block-index'] = 0;
      }
      return React.createElement(tag, props, ...children);
    }
    return inlineContent;
  }

  let visibleBlockIdx = 0;
  return doc.content.map((block: any, idx: number) => {
    const element = renderBlock(block, idx, collectionItemData, pageCollectionItemData, textStyles, useSpanForParagraphs, isEditMode, linkContext, timezone, layerDataMap, components, renderComponentBlock, ancestorComponentIds);
    const isVisibleBlock = block.type !== 'paragraph' || block.content?.length;
    // Embedded component blocks render as a React.Fragment, which only accepts
    // `key`/`children` — cloning to inject `data-block-index` would throw.
    const isFragment = React.isValidElement(element) && (element as React.ReactElement).type === React.Fragment;
    if (element && isVisibleBlock && isEditMode && !isFragment) {
      return React.cloneElement(element as React.ReactElement<any>, {
        'data-block-index': visibleBlockIdx++,
      });
    }
    return element;
  });
}

/**
 * Convert DynamicRichTextVariable to Tiptap-compatible JSON content
 */
export function richTextToTiptapContent(
  variable: DynamicRichTextVariable
): any {
  return variable.data.content;
}

/**
 * Create DynamicRichTextVariable from Tiptap JSON content
 */
export function createRichTextVariable(content: any): DynamicRichTextVariable {
  return {
    type: 'dynamic_rich_text',
    data: {
      content,
    },
  };
}

/**
 * Extract plain text from DynamicRichTextVariable (strips formatting and variables)
 */
export function extractPlainText(variable: DynamicRichTextVariable): string {
  const content = variable.data.content;

  if (!content || typeof content !== 'object' || !('type' in content)) {
    return '';
  }

  const doc = content as any;
  let text = '';

  const extractFromNode = (node: any): void => {
    if (node.type === 'text') {
      text += node.text || '';
    } else if (node.content && Array.isArray(node.content)) {
      node.content.forEach(extractFromNode);
    }
  };

  if (doc.content && Array.isArray(doc.content)) {
    doc.content.forEach(extractFromNode);
  }

  return text;
}

/**
 * Convert Tiptap JSON content to string format with inline variables
 * Used for RichTextEditor component
 */
export function tiptapContentToString(content: any): string {
  if (!content || typeof content !== 'object' || content.type !== 'doc') {
    return '';
  }

  let result = '';

  const processNode = (node: any): void => {
    if (node.type === 'text') {
      result += node.text || '';
    } else if (node.type === 'dynamicVariable') {
      // Convert variable node to inline variable tag
      if (node.attrs?.variable) {
        result += `<ycode-inline-variable>${JSON.stringify(node.attrs.variable)}</ycode-inline-variable>`;
      }
    } else if (node.content && Array.isArray(node.content)) {
      node.content.forEach(processNode);
    }
  };

  if (content.content && Array.isArray(content.content)) {
    content.content.forEach(processNode);
  }

  return result;
}

/**
 * Convert string with inline variables to Tiptap JSON content
 * Inverse of tiptapContentToString
 */
export function stringToTiptapContent(text: string): any {
  const content: any[] = [];
  const regex = /<ycode-inline-variable>([\s\S]*?)<\/ycode-inline-variable>/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      const textContent = text.slice(lastIndex, match.index);
      if (textContent) {
        content.push({
          type: 'text',
          text: textContent,
        });
      }
    }

    // Parse variable JSON
    const variableContent = match[1].trim();
    try {
      const variable = JSON.parse(variableContent);
      content.push({
        type: 'dynamicVariable',
        attrs: {
          variable,
          label: variable.data?.field_id || variable.type || 'variable',
        },
      });
    } catch {
      // Invalid JSON, skip
    }

    lastIndex = regex.lastIndex;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    const textContent = text.slice(lastIndex);
    if (textContent) {
      content.push({
        type: 'text',
        text: textContent,
      });
    }
  }

  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: content.length > 0 ? content : undefined,
      },
    ],
  };
}
