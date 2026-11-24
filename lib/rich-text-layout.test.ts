import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getRichTextLayout } from '@/lib/tiptap-utils';

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = (...content: unknown[]) => ({ type: 'doc', content });

const plain = doc(paragraph('One'), paragraph('Two'));
const withComponent = doc(paragraph('Before'), { type: 'richTextComponent', attrs: { componentId: 'c1' } });
const withList = doc({ type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('Item')] }] });

test('block layers keep their tag and use <p> paragraphs', () => {
  assert.deepEqual(getRichTextLayout(withComponent, 'div', false), { tag: 'div', useSpanForParagraphs: false, flatten: false });
  assert.deepEqual(getRichTextLayout(plain, 'div', false), { tag: 'div', useSpanForParagraphs: false, flatten: false });
});

test('text layers flatten unless the content has blocks', () => {
  assert.deepEqual(getRichTextLayout(plain, 'div', true), { tag: 'div', useSpanForParagraphs: false, flatten: true });
  assert.deepEqual(getRichTextLayout(withComponent, 'div', true), { tag: 'div', useSpanForParagraphs: false, flatten: false });
});

test('block content switches a restrictive tag to <div>', () => {
  assert.deepEqual(getRichTextLayout(withList, 'p', true), { tag: 'div', useSpanForParagraphs: false, flatten: false });
  assert.deepEqual(getRichTextLayout(withComponent, 'h2', false), { tag: 'div', useSpanForParagraphs: false, flatten: false });
});

test('inline content in a restrictive tag uses <span> paragraphs for rich text layers', () => {
  assert.deepEqual(getRichTextLayout(plain, 'p', false), { tag: 'p', useSpanForParagraphs: true, flatten: false });
  assert.deepEqual(getRichTextLayout(plain, 'h2', true), { tag: 'h2', useSpanForParagraphs: false, flatten: true });
});
