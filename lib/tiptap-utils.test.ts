import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import OrderedList from '@tiptap/extension-ordered-list';
import ListItem from '@tiptap/extension-list-item';
import { isRichTextEmpty, parseRichTextDoc, toEditorJSON } from '@/lib/tiptap-utils';

const schema = getSchema([Document, Paragraph, Text, OrderedList, ListItem]);

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

/** A stored doc as imported or written by older editor versions: no list attrs */
const storedDoc = () => ({
  type: 'doc',
  content: [
    paragraph('Intro'),
    { type: 'orderedList', content: [{ type: 'listItem', content: [paragraph('First tip')] }] },
  ],
});

test('fills in schema default attrs the stored doc lacks', () => {
  const list = toEditorJSON(schema, storedDoc()).content?.[1];
  assert.equal(list?.type, 'orderedList');
  assert.equal(list?.attrs?.start, 1);
});

test('an unchanged stored doc compares equal to the editor output', () => {
  const editorOutput = schema.nodeFromJSON(storedDoc()).toJSON();
  assert.notEqual(JSON.stringify(storedDoc()), JSON.stringify(editorOutput));
  assert.equal(JSON.stringify(toEditorJSON(schema, storedDoc())), JSON.stringify(editorOutput));
});

test('a real text edit still differs', () => {
  const edited = storedDoc();
  edited.content[0] = paragraph('Intro, edited');
  const editorOutput = schema.nodeFromJSON(storedDoc()).toJSON();
  assert.notEqual(JSON.stringify(toEditorJSON(schema, edited)), JSON.stringify(editorOutput));
});

test('returns docs the schema cannot parse unchanged', () => {
  const unknown = { type: 'doc', content: [{ type: 'mysteryNode' }] };
  assert.deepEqual(toEditorJSON(schema, unknown), unknown);
});

test('parses stringified JSON', () => {
  assert.deepEqual(parseRichTextDoc(JSON.stringify(storedDoc())), storedDoc());
});

test('renames legacy image nodes', () => {
  const doc = parseRichTextDoc({ type: 'doc', content: [{ type: 'image', attrs: { src: 'a.png' } }] });
  assert.equal(doc.content?.[0]?.type, 'richTextImage');
});

test('wraps legacy plain text in a paragraph', () => {
  assert.deepEqual(parseRichTextDoc('Hello'), { type: 'doc', content: [paragraph('Hello')] });
});

test('treats invalid JSON as plain text', () => {
  assert.deepEqual(parseRichTextDoc('{oops'), { type: 'doc', content: [paragraph('{oops')] });
});

test('returns an empty doc for empty values', () => {
  const empty = { type: 'doc', content: [{ type: 'paragraph' }] };
  assert.deepEqual(parseRichTextDoc(''), empty);
  assert.deepEqual(parseRichTextDoc(null), empty);
});

test('treats blank values and empty paragraph/heading docs as empty rich text', () => {
  assert.equal(isRichTextEmpty(''), true);
  assert.equal(isRichTextEmpty(null), true);
  assert.equal(isRichTextEmpty('{"type":"doc","content":[{"type":"paragraph"}]}'), true);
  assert.equal(isRichTextEmpty({ type: 'doc', content: [{ type: 'paragraph' }, { type: 'paragraph', content: [] }] }), true);
  assert.equal(isRichTextEmpty({ type: 'doc' }), true);
  assert.equal(isRichTextEmpty('{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[]}]}'), true);
});

test('treats docs with text or non-paragraph blocks as non-empty rich text', () => {
  assert.equal(isRichTextEmpty(JSON.stringify({ type: 'doc', content: [paragraph('Hi')] })), false);
  assert.equal(isRichTextEmpty({ type: 'doc', content: [{ type: 'richTextImage', attrs: { src: 'a.png' } }] }), false);
  assert.equal(isRichTextEmpty('Legacy plain text'), false);
});
