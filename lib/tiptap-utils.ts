/**
 * Tiptap Utilities
 *
 * Shared utilities for working with Tiptap JSON content
 * Used by both client-side rendering (text-format-utils) and server-side (page-fetcher)
 */

import type { JSONContent } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';

/**
 * Rename legacy `image` nodes to `richTextImage` so migrated docs render in the
 * editor. The new schema only registers `richTextImage`; unknown node types are
 * silently dropped on load.
 */
export function normalizeLegacyTiptapDoc<T>(doc: T): T {
  if (!doc || typeof doc !== 'object') return doc;
  const node = doc as any;
  if (node.type === 'image') {
    node.type = 'richTextImage';
  }
  if (Array.isArray(node.content)) {
    node.content.forEach((child: any) => normalizeLegacyTiptapDoc(child));
  }
  return doc;
}

/**
 * Parse a stored rich-text value (Tiptap JSON object, stringified JSON or
 * legacy plain text) into a Tiptap doc.
 */
export function parseRichTextDoc(value: unknown): JSONContent {
  if (typeof value === 'object' && value !== null) {
    return normalizeLegacyTiptapDoc(value as JSONContent);
  }
  if (typeof value === 'string' && value.startsWith('{')) {
    try {
      return normalizeLegacyTiptapDoc(JSON.parse(value));
    } catch {
      // Not valid JSON, treat as plain text
    }
  }
  if (typeof value === 'string' && value.trim()) {
    return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }] };
  }
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

/** Parse a stringified Tiptap doc, or null when the value isn't one (e.g. plain text or legacy HTML). */
export function parseTiptapDocOrNull(value: string | null | undefined): JSONContent | null {
  if (!value?.trim().startsWith('{')) return null;
  try {
    const parsed = JSON.parse(value);
    return isTiptapDoc(parsed) ? normalizeLegacyTiptapDoc(parsed) : null;
  } catch {
    return null;
  }
}

/** Text blocks that carry nothing when they have no children (an emptied editor keeps the block type). */
const EMPTYABLE_TEXT_BLOCKS = new Set(['paragraph', 'heading']);

/** Whether a stored rich-text value has no content (blank, or only empty paragraphs/headings). */
export function isRichTextEmpty(value: unknown): boolean {
  const blocks = parseRichTextDoc(value).content;
  if (!Array.isArray(blocks)) return true;
  return blocks.every((block) => EMPTYABLE_TEXT_BLOCKS.has(block.type ?? '') && !block.content?.length);
}

/**
 * Serialize a doc the way the editor's `getJSON()` does (schema default attrs
 * filled in), so an unchanged stored value doesn't compare as an edit.
 */
export function toEditorJSON(schema: Schema, doc: JSONContent): JSONContent {
  try {
    return schema.nodeFromJSON(doc).toJSON();
  } catch {
    return doc;
  }
}

/**
 * Extract inline nodes from nested Tiptap rich text content
 * Flattens paragraphs and preserves marks for inline rendering
 * @param content - Array of Tiptap nodes to extract from
 * @param parentMarks - Marks to inherit from parent nodes
 */
export function extractInlineNodesFromRichText(
  content: any[],
  parentMarks: any[] = []
): any[] {
  const result: any[] = [];

  for (const node of content) {
    if (node.type === 'text') {
      // Merge marks from parent with node marks
      const combinedMarks = [...parentMarks, ...(node.marks || [])];
      result.push({
        type: 'text',
        text: node.text,
        marks: combinedMarks.length > 0 ? combinedMarks : undefined,
      });
    } else if (node.type === 'paragraph') {
      // Preserve paragraph styling by adding a dynamicStyle mark
      const paragraphMark = { type: 'dynamicStyle', attrs: { styleKeys: ['paragraph'] } };
      const marksWithParagraph = [...parentMarks, paragraphMark];
      if (node.content && node.content.length > 0) {
        result.push(...extractInlineNodesFromRichText(node.content, marksWithParagraph));
      } else {
        // Empty paragraphs use non-breaking space to preserve the empty line
        result.push({
          type: 'text',
          text: '\u00A0',
          marks: marksWithParagraph,
        });
      }
      // Add space between paragraphs when flattening
      result.push({ type: 'text', text: ' ' });
    } else if (node.type === 'heading') {
      // Preserve heading styling by adding a dynamicStyle mark with the heading level
      const level = node.attrs?.level || 1;
      const headingMark = { type: 'dynamicStyle', attrs: { styleKeys: [`h${level}`] } };
      const marksWithHeading = [...parentMarks, headingMark];
      if (node.content && node.content.length > 0) {
        result.push(...extractInlineNodesFromRichText(node.content, marksWithHeading));
      } else {
        // Empty headings use non-breaking space to preserve the empty line
        result.push({
          type: 'text',
          text: '\u00A0',
          marks: marksWithHeading,
        });
      }
      // Add space after heading when flattening
      result.push({ type: 'text', text: ' ' });
    } else if (node.type === 'dynamicVariable') {
      // Preserve dynamic variables with combined marks
      result.push({
        ...node,
        marks: [...parentMarks, ...(node.marks || [])],
      });
    } else if (node.type === 'bulletList' || node.type === 'orderedList') {
      // Preserve list nodes as-is - they'll be rendered as block elements
      result.push({
        ...node,
        marks: parentMarks.length > 0 ? parentMarks : undefined,
      });
      result.push({ type: 'text', text: ' ' });
    } else if (node.type === 'richTextComponent') {
      // Preserve embedded component nodes as-is for block rendering
      result.push(node);
    } else if (node.type === 'horizontalRule') {
      result.push(node);
    } else if (node.type === 'listItem') {
      // List items should be handled by their parent list
      // But if we encounter one directly, extract its content
      if (node.content) {
        result.push(...extractInlineNodesFromRichText(node.content, parentMarks));
      }
    } else if (node.content) {
      // Recursively extract from other nodes with content
      result.push(...extractInlineNodesFromRichText(node.content, parentMarks));
    }
  }

  return result;
}

/**
 * Check if a value is a valid Tiptap doc structure
 */
export function isTiptapDoc(value: unknown): value is { type: 'doc'; content: any[] } {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as any).type === 'doc' &&
    Array.isArray((value as any).content)
  );
}

/**
 * Check if Tiptap JSON content contains block-level elements (lists)
 * These cannot be nested inside restrictive tags (p, h1-h6, span, a, button)
 */
export function contentHasBlockElements(content: any): boolean {
  if (!content || typeof content !== 'object') {
    return false;
  }

  // Handle Tiptap doc structure
  if (content.type === 'doc' && Array.isArray(content.content)) {
    return content.content.some((block: any) =>
      block.type === 'bulletList' || block.type === 'orderedList' || block.type === 'richTextComponent' || block.type === 'horizontalRule' || block.type === 'table'
    );
  }

  return false;
}

/**
 * Value resolver function type for looking up field values
 */
export type FieldValueResolver = (fieldId: string, relationships?: string[], source?: string) => string | null | undefined;

/**
 * Check if rich text content contains block elements, including from inline variables
 * Uses a resolver function to look up field values, making it reusable for both
 * client-side (React) and server-side (HTML string) rendering
 *
 * @param content - Tiptap JSON content (doc structure)
 * @param resolveValue - Function to resolve field values by fieldId
 */
export function hasBlockElementsWithResolver(
  content: any,
  resolveValue: FieldValueResolver
): boolean {
  if (!content || typeof content !== 'object') {
    return false;
  }

  // Check direct content for lists
  if (contentHasBlockElements(content)) {
    return true;
  }

  if (content.type !== 'doc' || !Array.isArray(content.content)) {
    return false;
  }

  // Recursively check for dynamicVariable nodes that point to rich_text fields
  const checkNode = (node: any): boolean => {
    if (node.type === 'dynamicVariable') {
      const variable = node.attrs?.variable;
      if (variable?.type === 'field' && variable.data?.field_type === 'rich_text') {
        // rich_text CMS fields can contain block elements (lists, etc.) at any time,
        // and renderBlock uses <div> for paragraphs containing them, so the parent
        // must also be block-level to avoid <div> inside <p>
        return true;
      }
    }

    // Recursively check content arrays
    if (Array.isArray(node.content)) {
      return node.content.some(checkNode);
    }

    return false;
  };

  return content.content.some(checkNode);
}

/** Check if Tiptap JSON content contains a link mark or embedded component node. */
export function hasLinkOrComponent(node: any): boolean {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'richTextComponent') return true;
  if (node.marks?.some((m: any) => m.type === 'richTextLink')) return true;
  if (Array.isArray(node.content)) {
    return node.content.some(hasLinkOrComponent);
  }
  return false;
}

/** Extract the first CMS field binding from Tiptap JSON content (dynamicVariable node with type 'field'). */
export function getCmsFieldBinding(node: any): { field_id: string; label?: string; source?: 'page' | 'collection'; collection_layer_id?: string; field_type?: string | null; format?: string } | null {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'dynamicVariable') {
    const variable = node.attrs?.variable;
    if (variable?.type === 'field' && variable.data?.field_id) {
      return {
        field_id: variable.data.field_id,
        label: node.attrs?.label,
        source: variable.data.source,
        collection_layer_id: variable.data.collection_layer_id,
        field_type: variable.data.field_type ?? null,
        format: variable.data.format,
      };
    }
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      const result = getCmsFieldBinding(child);
      if (result) return result;
    }
  }
  return null;
}

/** Check if content is exactly one CMS variable with no other nodes (doc > 1 paragraph > 1 dynamicVariable) */
export function getSoleCmsFieldBinding(content: any): ReturnType<typeof getCmsFieldBinding> {
  if (!content || content.type !== 'doc') return null;
  const paragraphs = content.content;
  if (!Array.isArray(paragraphs) || paragraphs.length !== 1) return null;
  const paragraph = paragraphs[0];
  if (paragraph.type !== 'paragraph') return null;
  const nodes = paragraph.content;
  if (!Array.isArray(nodes) || nodes.length !== 1) return null;
  if (nodes[0].type !== 'dynamicVariable') return null;
  return getCmsFieldBinding(nodes[0]);
}

/** True if a Tiptap doc contains at least one dynamicVariable node (matching `predicate` when given). */
export function hasVariableNode(doc: any, predicate?: (node: any) => boolean): boolean {
  if (!doc?.content || !Array.isArray(doc.content)) return false;
  const walk = (nodes: any[]): boolean => nodes.some((n: any) => {
    if (!n || typeof n !== 'object') return false;
    if (n.type === 'dynamicVariable' && (!predicate || predicate(n))) return true;
    if (Array.isArray(n.content)) return walk(n.content);
    return false;
  });
  return walk(doc.content);
}

/** True if a Tiptap doc contains at least one text or dynamicVariable node. */
export function hasAnyTextOrVariable(doc: any): boolean {
  if (!doc?.content || !Array.isArray(doc.content)) return false;
  const walk = (nodes: any[]): boolean => nodes.some((n: any) => {
    if (!n || typeof n !== 'object') return false;
    if (n.type === 'text' && typeof n.text === 'string' && n.text.length > 0) return true;
    if (n.type === 'dynamicVariable') return true;
    if (Array.isArray(n.content)) return walk(n.content);
    return false;
  });
  return walk(doc.content);
}

/** Check if Tiptap JSON content contains components or inline variables (non-editable on canvas). */
export function hasComponentOrVariable(node: any): boolean {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'richTextComponent') return true;
  if (node.type === 'dynamicVariable') return true;
  if (Array.isArray(node.content)) {
    return node.content.some(hasComponentOrVariable);
  }
  return false;
}

/** Extract the rich-text content value from a layer's text variable.
 *  Always returns TipTap JSON so consumers (RichTextEditor with
 *  withFormatting=true) never receive a raw string they can't render. */
export function getRichTextValue(variables?: { text?: { type: string; data: { content: any } } }): any {
  const textVar = variables?.text;
  if (textVar?.type === 'dynamic_rich_text') return textVar.data.content;
  if (textVar?.type === 'dynamic_text') {
    const content = textVar.data.content;
    if (typeof content === 'string') {
      return {
        type: 'doc',
        content: [{ type: 'paragraph', content: content ? [{ type: 'text', text: content }] : [] }],
      };
    }
    return content;
  }
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

/**
 * Detect whether a Tiptap document carries any actual rich-text formatting.
 * "Formatting" includes block-level structure beyond a single paragraph
 * (headings, lists, blockquotes, code blocks, horizontal rules, images,
 * tables, embedded components) as well as inline marks (bold, italic,
 * underline, links, etc.) and hard breaks.
 *
 * Used at extraction time to decide whether translatable content should be
 * surfaced as a rich-text sheet editor or a simple text input — the editor
 * follows the *current* content, not the source layer's original variable type.
 */
export function tiptapDocHasFormatting(doc: any): boolean {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.content)) return false;

  const blocks = doc.content;
  // Multiple block-level nodes implies structure (paragraph break)
  if (blocks.length > 1) return true;

  const NON_PLAIN_BLOCK_TYPES: ReadonlySet<string> = new Set([
    'heading',
    'bulletList',
    'orderedList',
    'listItem',
    'blockquote',
    'codeBlock',
    'horizontalRule',
    'image',
    'table',
    'tableRow',
    'tableCell',
    'tableHeader',
    'iframe',
    'youtube',
    'richTextComponent',
  ]);

  const walk = (nodes: any[]): boolean => nodes.some((n: any) => {
    if (!n || typeof n !== 'object') return false;
    if (n.type && NON_PLAIN_BLOCK_TYPES.has(n.type)) return true;
    if (n.type === 'hardBreak') return true;
    if (n.type === 'text' && Array.isArray(n.marks) && n.marks.length > 0) {
      return true;
    }
    if (Array.isArray(n.content) && n.content.length > 0) return walk(n.content);
    return false;
  });

  return walk(blocks);
}

/**
 * Serialize a Tiptap document to a plain-text string with canonical inline
 * variable tags preserved. Block-level nodes are joined by newlines so that
 * paragraph structure round-trips through the simple text input.
 *
 * This is the inverse of {@link parseValueToContent} for the subset of content
 * we accept in plain-text translation fields: text, hardBreak, and
 * dynamicVariable nodes. Any inline marks are dropped (the surrounding caller
 * has already decided that this content is plain).
 */
export function tiptapDocToCanonicalString(doc: any): string {
  if (!doc?.content || !Array.isArray(doc.content)) return '';

  const serializeNode = (node: any): string => {
    if (!node || typeof node !== 'object') return '';
    if (node.type === 'text') return typeof node.text === 'string' ? node.text : '';
    if (node.type === 'hardBreak') return '\n';
    if (node.type === 'dynamicVariable') {
      const variable = node.attrs?.variable;
      if (!variable) return '';
      return `<ycode-inline-variable>${JSON.stringify(variable)}</ycode-inline-variable>`;
    }
    if (Array.isArray(node.content)) return node.content.map(serializeNode).join('');
    return '';
  };

  return doc.content
    .map(serializeNode)
    .map((s: string) => s.replace(/[ \t]+/g, ' '))
    .filter((s: string) => s.length > 0)
    .join('\n');
}

/**
 * Extract plain text from Tiptap JSON content
 * Useful for previews, search indexing, or fallback display
 */
export function extractPlainTextFromTiptap(content: any): string {
  if (!content || typeof content !== 'object') return '';

  let result = '';

  const extractFromNode = (node: any): void => {
    if (node.type === 'text' && node.text) {
      result += node.text;
    } else if (node.type === 'dynamicVariable' && node.attrs?.label) {
      result += `[${node.attrs.label}]`;
    } else if (node.type === 'paragraph') {
      if (result.length > 0 && !result.endsWith(' ')) {
        result += ' ';
      }
      if (Array.isArray(node.content)) {
        node.content.forEach(extractFromNode);
      }
    } else if (Array.isArray(node.content)) {
      node.content.forEach(extractFromNode);
    }
  };

  if (content.type === 'doc' && Array.isArray(content.content)) {
    content.content.forEach(extractFromNode);
  } else if (Array.isArray(content)) {
    content.forEach(extractFromNode);
  } else {
    extractFromNode(content);
  }

  return result.trim();
}

/**
 * Extract plain text from Tiptap JSON, preserving block-level boundaries as
 * newlines. Useful for multi-line previews (e.g. read-only translation
 * textareas) where collapsing paragraphs/headings into a single line would
 * misrepresent the structure of the original content.
 *
 * Inline marks (bold, italic, links) are dropped — only the textual content
 * and dynamic-variable labels survive.
 */
export function extractMultilinePlainTextFromTiptap(content: any): string {
  if (!content || typeof content !== 'object') return '';

  // Block-level nodes that should each occupy their own line in the preview.
  const BLOCK_TYPES = new Set([
    'paragraph',
    'heading',
    'blockquote',
    'codeBlock',
    'listItem',
    'horizontalRule',
    'richTextHtmlEmbed',
    'richTextImage',
    'richTextComponent',
  ]);

  const lines: string[] = [];

  const collectInline = (node: any, into: { text: string }): void => {
    if (!node) return;
    if (node.type === 'text' && node.text) {
      into.text += node.text;
      return;
    }
    if (node.type === 'dynamicVariable' && node.attrs?.label) {
      into.text += `[${node.attrs.label}]`;
      return;
    }
    if (node.type === 'hardBreak') {
      into.text += '\n';
      return;
    }
    if (Array.isArray(node.content)) {
      node.content.forEach((child: any) => collectInline(child, into));
    }
  };

  const visit = (node: any): void => {
    if (!node) return;
    if (node.type === 'horizontalRule') {
      lines.push('');
      return;
    }
    if (BLOCK_TYPES.has(node.type)) {
      const acc = { text: '' };
      if (Array.isArray(node.content)) {
        node.content.forEach((child: any) => {
          // Nested block nodes (e.g. a paragraph inside a listItem) get their
          // own line so list bullets / quotes still read naturally.
          if (BLOCK_TYPES.has(child?.type)) {
            visit(child);
          } else {
            collectInline(child, acc);
          }
        });
      }
      if (acc.text) {
        lines.push(acc.text);
      }
      return;
    }
    if (Array.isArray(node.content)) {
      node.content.forEach(visit);
    }
  };

  if (content.type === 'doc' && Array.isArray(content.content)) {
    content.content.forEach(visit);
  } else if (Array.isArray(content)) {
    content.forEach(visit);
  } else {
    visit(content);
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
