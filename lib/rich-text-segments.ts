/**
 * Rich-text segments
 *
 * Splits a Tiptap doc into translatable text segments (one per paragraph or
 * heading) and rebuilds the doc from translated segments. Inline formatting is
 * encoded as numbered tags (`<m1>…</m1>`) and inline nodes such as variables or
 * line breaks as placeholders (`<x1/>`), so a translator only sends text while
 * links, images, tables and lists are copied from the source doc.
 */

import type { JSONContent } from '@tiptap/core';

const SEGMENT_BLOCK_TYPES = new Set(['paragraph', 'heading']);
const LINK_MARK_TYPES = new Set(['link', 'richTextLink']);
const TAG_PATTERN = /<(\/?)m(\d+)>|<x(\d+)\/>/g;

type Mark = NonNullable<JSONContent['marks']>[number];

export interface RichTextSegment {
  i: number;
  text: string;
}

export interface RichTextSourceSegment extends RichTextSegment {
  translated_text?: string;
}

interface EncodedSegment {
  text: string;
  marks: Mark[];
  placeholders: JSONContent[];
}

/** Paragraph/heading blocks with content, in document order (references into `doc`). */
function collectSegmentBlocks(doc: JSONContent): JSONContent[] {
  const blocks: JSONContent[] = [];
  const walk = (node: JSONContent) => {
    if (SEGMENT_BLOCK_TYPES.has(node.type ?? '')) {
      if (node.content?.length) blocks.push(node);
      return;
    }
    node.content?.forEach(walk);
  };
  walk(doc);
  return blocks;
}

/**
 * Encode a block's inline content as tagged text. With `seed` (the source
 * block's encoding), tag and placeholder numbers match the source; marks the
 * source lacks get numbers after the source's.
 */
function encodeSegment(block: JSONContent, seed?: EncodedSegment): EncodedSegment {
  const marks: Mark[] = [...(seed?.marks ?? [])];
  const markIds = new Map(marks.map((mark, index) => [JSON.stringify(mark), index + 1]));
  const placeholders: JSONContent[] = [...(seed?.placeholders ?? [])];
  const placeholderKeys = placeholders.map((node) => JSON.stringify(node));
  const usedPlaceholders = new Set<number>();
  const stack: number[] = [];
  let text = '';

  const markId = (mark: Mark) => {
    const key = JSON.stringify(mark);
    let id = markIds.get(key);
    if (!id) {
      marks.push(mark);
      id = marks.length;
      markIds.set(key, id);
    }
    return id;
  };

  const placeholderId = (node: JSONContent) => {
    const key = JSON.stringify(node);
    let index = placeholderKeys.findIndex((k, i) => k === key && !usedPlaceholders.has(i));
    if (index === -1) {
      placeholders.push(node);
      placeholderKeys.push(key);
      index = placeholders.length - 1;
    }
    usedPlaceholders.add(index);
    return index + 1;
  };

  for (const child of block.content ?? []) {
    if (child.type !== 'text') {
      text += `<x${placeholderId(child)}/>`;
      continue;
    }

    const ids = (child.marks ?? []).map(markId);
    let keep = 0;
    while (keep < stack.length && ids.includes(stack[keep])) keep++;
    while (stack.length > keep) text += `</m${stack.pop()}>`;
    for (const id of ids) {
      if (!stack.includes(id)) {
        stack.push(id);
        text += `<m${id}>`;
      }
    }
    text += child.text ?? '';
  }
  while (stack.length) text += `</m${stack.pop()}>`;

  return { text, marks, placeholders };
}

/**
 * Rebuild a block's inline content from a translated segment, or return why it
 * can't be. Links among the first `requiredMarks` marks and every placeholder
 * must be present.
 */
function decodeSegment(
  text: string,
  source: EncodedSegment,
  requiredMarks = source.marks.length
): { content: JSONContent[] } | { error: string } {
  const content: JSONContent[] = [];
  const stack: number[] = [];
  const usedMarks = new Set<number>();
  const usedPlaceholders = new Set<number>();
  let last = 0;

  const pushText = (value: string) => {
    if (!value) return;
    const node: JSONContent = { type: 'text', text: value };
    if (stack.length) node.marks = stack.map((id) => source.marks[id - 1]);
    content.push(node);
  };

  for (const match of text.matchAll(TAG_PATTERN)) {
    pushText(text.slice(last, match.index));
    last = (match.index ?? 0) + match[0].length;

    if (match[3]) {
      const id = Number(match[3]);
      if (!source.placeholders[id - 1]) return { error: `unknown placeholder <x${id}/>` };
      if (usedPlaceholders.has(id)) return { error: `placeholder <x${id}/> is used twice` };
      usedPlaceholders.add(id);
      content.push(structuredClone(source.placeholders[id - 1]));
      continue;
    }

    const id = Number(match[2]);
    if (!source.marks[id - 1]) return { error: `unknown tag <m${id}>` };
    if (match[1]) {
      if (stack[stack.length - 1] !== id) return { error: `</m${id}> does not close the innermost open tag` };
      stack.pop();
    } else {
      if (stack.includes(id)) return { error: `<m${id}> is opened twice without closing` };
      stack.push(id);
      usedMarks.add(id);
    }
  }
  pushText(text.slice(last));

  if (stack.length) return { error: `<m${stack[stack.length - 1]}> is never closed` };
  if (!content.length) return { error: 'text is empty' };

  const missingLink = source.marks.findIndex((mark, index) => (
    index < requiredMarks && LINK_MARK_TYPES.has(mark.type) && !usedMarks.has(index + 1)
  ));
  if (missingLink !== -1) return { error: `link <m${missingLink + 1}> is missing` };
  const missingPlaceholder = source.placeholders.findIndex((_, index) => !usedPlaceholders.has(index + 1));
  if (missingPlaceholder !== -1) return { error: `placeholder <x${missingPlaceholder + 1}/> is missing` };

  return { content };
}

/** FNV-1a hash, hex-encoded. */
function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Key of a doc's structure (blocks, attributes and inline placeholders, not its
 * text or formatting). Two docs with the same key have aligned segment indexes.
 */
export function getRichTextStructureKey(doc: JSONContent): string {
  // Placeholders may move within a translated segment, so their order is ignored.
  const strip = (node: JSONContent): unknown => {
    if (SEGMENT_BLOCK_TYPES.has(node.type ?? '')) {
      const placeholders = (node.content ?? []).filter((child) => child.type !== 'text').map((child) => JSON.stringify(child));
      return { ...node, content: placeholders.sort() };
    }
    return node.content ? { ...node, content: node.content.map(strip) } : node;
  };
  return hashString(JSON.stringify(strip(doc)));
}

/** Segment blocks of `translation` when it shares the structure of `source`, otherwise null. */
function collectAlignedBlocks(source: JSONContent, translation?: JSONContent | null): JSONContent[] | null {
  if (!translation || getRichTextStructureKey(translation) !== getRichTextStructureKey(source)) return null;
  return collectSegmentBlocks(translation);
}

/**
 * Translatable segments of a doc, with formatting encoded as `<mN>` tags and
 * inline nodes as `<xN/>`. With a `translation` sharing the doc's structure,
 * segments it translated include `translated_text`, encoded with the same tags.
 */
export function getRichTextSegments(doc: JSONContent, translation?: JSONContent | null): RichTextSourceSegment[] {
  const translatedBlocks = collectAlignedBlocks(doc, translation);
  return collectSegmentBlocks(doc).map((block, i) => {
    const encoded = encodeSegment(block);
    const translatedBlock = translatedBlocks?.[i];
    if (!translatedBlock || JSON.stringify(translatedBlock.content) === JSON.stringify(block.content)) {
      return { i, text: encoded.text };
    }
    return { i, text: encoded.text, translated_text: encodeSegment(translatedBlock, encoded).text };
  });
}

/**
 * Indexes of segments whose content in `translated` differs from `source`, or
 * null when the docs don't share a structure (segments can't be compared).
 */
export function getTranslatedSegmentIndexes(source: JSONContent, translated: JSONContent): Set<number> | null {
  const translatedBlocks = collectAlignedBlocks(source, translated);
  if (!translatedBlocks) return null;
  const indexes = new Set<number>();
  collectSegmentBlocks(source).forEach((block, i) => {
    if (JSON.stringify(block.content) !== JSON.stringify(translatedBlocks[i].content)) indexes.add(i);
  });
  return indexes;
}

/**
 * Build a translated doc from `source`, replacing the given segments. Segments
 * not provided are taken from `base` (a previous translation) when it shares
 * the source structure, otherwise from the source.
 */
export function applyRichTextSegments(
  source: JSONContent,
  segments: RichTextSegment[],
  base?: JSONContent | null
): { doc: JSONContent } | { errors: string[] } {
  const doc = structuredClone(source);
  const blocks = collectSegmentBlocks(doc);
  const sourceBlocks = collectSegmentBlocks(source);
  const baseBlocks = collectAlignedBlocks(source, base);
  const errors: string[] = [];

  baseBlocks?.forEach((block, i) => {
    blocks[i].content = structuredClone(block.content);
  });

  const seen = new Set<number>();
  for (const segment of segments) {
    if (!Number.isInteger(segment.i) || segment.i < 0 || segment.i >= blocks.length) {
      errors.push(`[${segment.i}] no such segment (0-${blocks.length - 1})`);
      continue;
    }
    if (seen.has(segment.i)) {
      errors.push(`[${segment.i}] provided twice`);
      continue;
    }
    seen.add(segment.i);

    // Tags numbered from the previous translation (e.g. bold added in the editor) stay valid.
    const sourceEncoded = encodeSegment(sourceBlocks[segment.i]);
    const table = baseBlocks ? encodeSegment(baseBlocks[segment.i], sourceEncoded) : sourceEncoded;
    const decoded = decodeSegment(segment.text, table, sourceEncoded.marks.length);
    if ('error' in decoded) {
      errors.push(`[${segment.i}] ${decoded.error}`);
      continue;
    }
    blocks[segment.i].content = decoded.content;
  }

  return errors.length ? { errors } : { doc };
}
