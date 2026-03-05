import React from 'react';
import type { TextStyle, DynamicRichTextVariable, LinkSettings, Component } from '@/types';
import { cn } from '@/lib/utils';
import { formatFieldValue, resolveFieldFromSources } from '@/lib/cms-variables-utils';
import { generateLinkHref, type LinkResolutionContext } from '@/lib/link-utils';
import { extractInlineNodesFromRichText, contentHasBlockElements, hasBlockElementsWithResolver } from '@/lib/tiptap-utils';
import { applyComponentOverrides, resolveComponents } from '@/lib/resolve-components';

/**
 * Context for resolving rich text links - re-exports LinkResolutionContext for backwards compatibility
 */
export type RichTextLinkContext = LinkResolutionContext;

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
  // Heading styles (h1-h6) - matching RichTextEditor prose styles
  h1: {
    label: 'Heading 1',
    classes: 'block text-[30px] font-semibold',
    design: {
      layout: { display: 'block' },
      typography: { fontSize: '30px', fontWeight: 'semibold' },
    },
  },
  h2: {
    label: 'Heading 2',
    classes: 'block text-[24px] font-semibold',
    design: {
      layout: { display: 'block' },
      typography: { fontSize: '24px', fontWeight: 'semibold' },
    },
  },
  h3: {
    label: 'Heading 3',
    classes: 'block text-[20px] font-semibold',
    design: {
      layout: { display: 'block' },
      typography: { fontSize: '20px', fontWeight: 'semibold' },
    },
  },
  h4: {
    label: 'Heading 4',
    classes: 'block text-[18px] font-semibold',
    design: {
      layout: { display: 'block' },
      typography: { fontSize: '18px', fontWeight: 'semibold' },
    },
  },
  h5: {
    label: 'Heading 5',
    classes: 'block text-[16px] font-semibold',
    design: {
      layout: { display: 'block' },
      typography: { fontSize: '16px', fontWeight: 'semibold' },
    },
  },
  h6: {
    label: 'Heading 6',
    classes: 'block text-[14px] font-semibold',
    design: {
      layout: { display: 'block' },
      typography: { fontSize: '14px', fontWeight: 'semibold' },
    },
  },
  // Paragraph style - block display with spacing and line height
  paragraph: {
    label: 'Paragraph',
    classes: 'block',
    design: {
      layout: { display: 'block' },
    },
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
    label: 'Bullet List',
    classes: 'ml-[8px] pl-[16px] list-disc',
    design: {
      spacing: { marginLeft: '8px', paddingLeft: '16px' },
    },
  },
  orderedList: {
    label: 'Ordered List',
    classes: 'ml-[8px] pl-[20px] list-decimal',
    design: {
      spacing: { marginLeft: '8px', paddingLeft: '20px' },
    },
  },
  listItem: {
    label: 'List Item',
    classes: '',
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
 * Get variable node metadata and raw value
 * Returns the field type and raw value (useful for rich_text handling)
 */
function getVariableNodeData(
  node: any,
  collectionItemData?: Record<string, string>,
  pageCollectionItemData?: Record<string, string>,
  layerDataMap?: Record<string, Record<string, string>>
): { fieldType: string | null; rawValue: unknown } {
  if (node.attrs?.variable?.type === 'field' && node.attrs.variable.data?.field_id) {
    const { field_id, field_type, relationships = [], source, collection_layer_id } = node.attrs.variable.data;

    // Build the full path for relationship resolution
    const fieldPath = relationships.length > 0
      ? [field_id, ...relationships].join('.')
      : field_id;

    const rawValue = resolveFieldFromSources(fieldPath, source, collectionItemData, pageCollectionItemData, collection_layer_id, layerDataMap);
    return { fieldType: field_type || null, rawValue };
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
  const { fieldType, rawValue } = getVariableNodeData(node, collectionItemData, pageCollectionItemData);
  return formatFieldValue(rawValue, fieldType, timezone);
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
        case 'code':
          text = React.createElement('code', buildProps('code', getMarkClass('code')), text);
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
              // Use shared link generation utility
              return generateLinkHref(mark.attrs as LinkSettings, fullContext) || '#';
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
 * Render nested rich text content from a Tiptap JSON structure
 * Used when a rich_text CMS field is inserted as an inline variable
 * Flattens the content to render inline with surrounding text
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
): React.ReactNode[] {
  // richTextValue should be a Tiptap doc structure: { type: 'doc', content: [...] }
  if (!richTextValue) {
    return [];
  }

  // Parse string to object if needed (published pages may store as JSON string)
  let parsed = richTextValue;
  if (typeof richTextValue === 'string') {
    try {
      parsed = JSON.parse(richTextValue);
    } catch {
      // If parsing fails, return as plain text
      return [React.createElement('span', { key }, richTextValue)];
    }
  }

  // After parsing, verify it's an object
  if (typeof parsed !== 'object') {
    return [];
  }

  // Handle Tiptap doc structure
  if (parsed.type === 'doc' && Array.isArray(parsed.content)) {
    // Check if content has block elements that need proper block rendering
    // (headings, multiple paragraphs, lists)
    const hasBlockStructure = parsed.content.length > 1 ||
      parsed.content.some((block: any) =>
        block.type === 'heading' ||
        block.type === 'bulletList' ||
        block.type === 'orderedList' ||
        block.type === 'richTextComponent'
      );

    if (hasBlockStructure) {
      // Render each block properly to preserve structure
      // Use spans instead of p/h tags since we're inside another element
      return parsed.content.map((block: any, blockIdx: number) => {
        const blockKey = `${key}-block-${blockIdx}`;

        if (block.type === 'heading') {
          const level = block.attrs?.level || 1;
          const styleKey = `h${level}`;
          const headingClass = textStyles?.[styleKey]?.classes ??
            DEFAULT_TEXT_STYLES[styleKey]?.classes ?? '';
          const props: Record<string, any> = { key: blockKey, className: headingClass };
          if (isEditMode) {
            props['data-style'] = styleKey;
          }
          // Empty headings use non-breaking space to preserve the empty line
          if (!block.content || block.content.length === 0) {
            return React.createElement('span', props, '\u00A0');
          }
          const content = renderInlineContent(block.content, collectionItemData, pageCollectionItemData, textStyles, isEditMode, linkContext, timezone, layerDataMap, components, renderComponentBlock, ancestorComponentIds);
          return React.createElement('span', props, ...content);
        }

        if (block.type === 'paragraph') {
          const paragraphClass = textStyles?.paragraph?.classes ??
            DEFAULT_TEXT_STYLES.paragraph?.classes ?? '';
          const props: Record<string, any> = { key: blockKey, className: paragraphClass };
          if (isEditMode) {
            props['data-style'] = 'paragraph';
          }
          // Empty paragraphs use non-breaking space to preserve the empty line
          if (!block.content || block.content.length === 0) {
            return React.createElement('span', props, '\u00A0');
          }
          const content = renderInlineContent(block.content, collectionItemData, pageCollectionItemData, textStyles, isEditMode, linkContext, timezone, layerDataMap, components, renderComponentBlock, ancestorComponentIds);
          return React.createElement('span', props, ...content);
        }

        if (block.type === 'bulletList' || block.type === 'orderedList') {
          const listClass = textStyles?.[block.type]?.classes ??
            DEFAULT_TEXT_STYLES[block.type]?.classes ?? '';
          const tag = block.type === 'bulletList' ? 'ul' : 'ol';
          const listProps: Record<string, any> = { key: blockKey, className: listClass };
          if (isEditMode) {
            listProps['data-style'] = block.type;
          }
          const items = block.content?.map((item: any, itemIdx: number) => {
            const itemClass = textStyles?.listItem?.classes ??
              DEFAULT_TEXT_STYLES.listItem?.classes ?? '';
            const itemContent = item.content?.flatMap((itemBlock: any) => {
              if (itemBlock.type === 'paragraph' && itemBlock.content) {
                return renderInlineContent(itemBlock.content, collectionItemData, pageCollectionItemData, textStyles, isEditMode, linkContext, timezone, layerDataMap, components, renderComponentBlock, ancestorComponentIds);
              }
              return [];
            }) || [];
            const itemProps: Record<string, any> = { key: `${blockKey}-item-${itemIdx}`, className: itemClass };
            if (isEditMode) {
              itemProps['data-style'] = 'listItem';
            }
            return React.createElement('li', itemProps, ...itemContent);
          }) || [];
          return React.createElement(tag, listProps, ...items);
        }

        // Handle embedded component blocks
        if (block.type === 'richTextComponent' && block.attrs?.componentId) {
          return renderRichTextComponentBlock(block, blockKey, components, renderComponentBlock, ancestorComponentIds);
        }

        // Fallback: render inline content
        if (block.content) {
          const content = renderInlineContent(block.content, collectionItemData, pageCollectionItemData, textStyles, isEditMode, linkContext, timezone, layerDataMap, components, renderComponentBlock, ancestorComponentIds);
          return React.createElement('span', { key: blockKey }, ...content);
        }

        return null;
      }).filter(Boolean);
    }

    // Simple case: flatten to inline nodes
    const inlineNodes = extractInlineNodesFromRichText(parsed.content);

    if (inlineNodes.length === 0) {
      return [];
    }

    // Render the flattened inline content
    const rendered = renderInlineContent(
      inlineNodes,
      collectionItemData,
      pageCollectionItemData,
      textStyles,
      isEditMode,
      linkContext,
      timezone,
      layerDataMap,
      components,
      renderComponentBlock,
      ancestorComponentIds
    );

    // Add unique keys to each rendered node
    return rendered.map((node, nodeIdx) => {
      if (React.isValidElement(node)) {
        return React.cloneElement(node, { key: `${key}-nested-${nodeIdx}` });
      }
      // Wrap non-element nodes (strings, etc.) in a span
      return React.createElement('span', { key: `${key}-nested-${nodeIdx}` }, node);
    });
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
): React.ReactNode[] {
  return content.flatMap((node, idx) => {
    const key = `node-${idx}`;

    if (node.type === 'text') {
      return [renderTextNode(node, key, textStyles, isEditMode, collectionItemData, pageCollectionItemData, linkContext, layerDataMap)];
    }

    if (node.type === 'dynamicVariable') {
      const { fieldType, rawValue } = getVariableNodeData(node, collectionItemData, pageCollectionItemData, layerDataMap);

      // Handle rich_text fields - render nested Tiptap content
      if (fieldType === 'rich_text' && rawValue) {
        // Parse JSON string if needed (published pages store as string)
        let richTextValue: unknown = rawValue;
        if (typeof rawValue === 'string') {
          try {
            richTextValue = JSON.parse(rawValue);
          } catch {
            // If parsing fails, fall through to text rendering
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
          );
        }
      }

      // For other field types, render as text
      const value = formatFieldValue(rawValue, fieldType, timezone);
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

    // Handle list nodes that were preserved during flattening
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      const listClass = textStyles?.[node.type]?.classes ??
        DEFAULT_TEXT_STYLES[node.type]?.classes ?? '';
      const tag = node.type === 'bulletList' ? 'ul' : 'ol';
      const listProps: Record<string, any> = { key, className: listClass };
      if (isEditMode) {
        listProps['data-style'] = node.type;
      }
      const items = node.content?.map((item: any, itemIdx: number) => {
        const itemClass = textStyles?.listItem?.classes ??
          DEFAULT_TEXT_STYLES.listItem?.classes ?? '';
        const itemContent = item.content?.flatMap((itemBlock: any) => {
          if (itemBlock.type === 'paragraph' && itemBlock.content) {
            return renderInlineContent(itemBlock.content, collectionItemData, pageCollectionItemData, textStyles, isEditMode, linkContext, timezone, layerDataMap, components, renderComponentBlock, ancestorComponentIds);
          }
          return [];
        }) || [];
        const itemProps: Record<string, any> = { key: `${key}-item-${itemIdx}`, className: itemClass };
        if (isEditMode) {
          itemProps['data-style'] = 'listItem';
        }
        return React.createElement('li', itemProps, ...itemContent);
      }) || [];
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
  if (!component || !component.layers?.length) {
    return React.createElement('span', { key, className: 'text-xs text-muted-foreground' }, '[missing component]');
  }

  if (!renderComponentBlock) {
    return React.createElement('span', { key, 'data-component-id': componentId }, `[${component.name}]`);
  }

  // Build updated ancestor set including the current component
  const updatedAncestors = new Set(ancestorComponentIds);
  updatedAncestors.add(componentId);

  // Use pre-resolved layers (from server-side resolveRichTextCollections) when available
  if (block.attrs._resolvedLayers) {
    return renderComponentBlock(component, block.attrs._resolvedLayers, overrides, key, updatedAncestors);
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

    // Empty paragraphs use non-breaking space to preserve the empty line
    if (!block.content || block.content.length === 0) {
      const emptyTag = useSpanForParagraphs ? 'span' : 'p';
      return React.createElement(emptyTag, { key, className: paragraphClass }, '\u00A0');
    }

    // Use div when paragraph contains block-level content (rich_text variables or embedded components)
    const hasBlockContent = block.content?.some((n: any) =>
      (n.type === 'dynamicVariable' && n.attrs?.variable?.data?.field_type === 'rich_text') ||
      n.type === 'richTextComponent'
    );
    const tag = hasBlockContent ? 'div' : useSpanForParagraphs ? 'span' : 'p';

    return React.createElement(tag, { key, className: paragraphClass }, ...renderInlineContent(block.content, collectionItemData, pageCollectionItemData, textStyles, isEditMode, linkContext, timezone, layerDataMap, components, renderComponentBlock, ancestorComponentIds));
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
    return React.createElement(tag, headingProps, ...renderInlineContent(block.content, collectionItemData, pageCollectionItemData, textStyles, isEditMode, linkContext, timezone, layerDataMap, components, renderComponentBlock, ancestorComponentIds));
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
        renderListItem(item, `${key}-${itemIdx}`, collectionItemData, pageCollectionItemData, textStyles, isEditMode, linkContext, timezone, layerDataMap, components, renderComponentBlock, ancestorComponentIds)
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
        renderListItem(item, `${key}-${itemIdx}`, collectionItemData, pageCollectionItemData, textStyles, isEditMode, linkContext, timezone, layerDataMap, components, renderComponentBlock, ancestorComponentIds)
      )
    );
  }

  // Handle embedded component blocks
  if (block.type === 'richTextComponent' && block.attrs?.componentId) {
    return renderRichTextComponentBlock(block, key, components, renderComponentBlock, ancestorComponentIds);
  }

  return null;
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
): React.ReactNode {
  const content = variable.data.content;

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
    if (!paragraph.content || paragraph.content.length === 0) {
      return null;
    }
    return renderInlineContent(paragraph.content, collectionItemData, pageCollectionItemData, textStyles, isEditMode, linkContext, timezone, layerDataMap, components, renderComponentBlock, ancestorComponentIds);
  }

  return doc.content.map((block: any, idx: number) =>
    renderBlock(block, idx, collectionItemData, pageCollectionItemData, textStyles, useSpanForParagraphs, isEditMode, linkContext, timezone, layerDataMap, components, renderComponentBlock, ancestorComponentIds)
  );
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
