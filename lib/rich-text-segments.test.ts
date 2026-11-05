import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRichTextSegments,
  getRichTextSegments,
  getRichTextStructureKey,
  getTranslatedSegmentIndexes,
} from '@/lib/rich-text-segments';
import type { JSONContent } from '@tiptap/core';

const link = { type: 'richTextLink', attrs: { type: 'page', page: { id: 'p1', collection_item_id: null } } };
const bold = { type: 'bold' };
const pill = { type: 'dynamicVariable', attrs: { label: 'Price', variable: { type: 'field', data: { field_id: 'g1', source: 'global' } } } };

const source: JSONContent = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Best apps' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Try ' },
        { type: 'text', text: 'our editor', marks: [link] },
        { type: 'text', text: ' for ', marks: [] },
        pill,
        { type: 'text', text: ' today', marks: [bold] },
      ],
    },
    { type: 'paragraph' },
    { type: 'richTextImage', attrs: { src: 'a.png' } },
    {
      type: 'table',
      content: [{
        type: 'tableRow',
        content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Price', marks: [bold, link] }] }] }],
      }],
    },
  ],
};

test('splits paragraphs and headings into tagged segments, skipping empty blocks', () => {
  assert.deepEqual(getRichTextSegments(source), [
    { i: 0, text: 'Best apps' },
    { i: 1, text: 'Try <m1>our editor</m1> for <x1/><m2> today</m2>' },
    { i: 2, text: '<m1><m2>Price</m2></m1>' },
  ]);
});

test('rebuilds the doc from translated segments, keeping links, images and tables', () => {
  const result = applyRichTextSegments(source, [
    { i: 0, text: 'Beste Apps' },
    { i: 1, text: 'Probiere <x1/><m2> heute</m2> <m1>unseren Editor</m1>' },
    { i: 2, text: '<m1><m2>Preis</m2></m1>' },
  ]);
  assert.ok('doc' in result);
  const [heading, paragraph, empty, image, table] = result.doc.content!;
  assert.deepEqual(heading.content, [{ type: 'text', text: 'Beste Apps' }]);
  assert.deepEqual(paragraph.content, [
    { type: 'text', text: 'Probiere ' },
    pill,
    { type: 'text', text: ' heute', marks: [bold] },
    { type: 'text', text: ' ' },
    { type: 'text', text: 'unseren Editor', marks: [link] },
  ]);
  assert.deepEqual(empty, { type: 'paragraph' });
  assert.deepEqual(image, source.content![3]);
  assert.deepEqual(table.content![0].content![0].content![0].content, [{ type: 'text', text: 'Preis', marks: [bold, link] }]);
  assert.equal(getRichTextStructureKey(result.doc), getRichTextStructureKey(source));
});

test('merges a partial upload into the previous translation', () => {
  const first = applyRichTextSegments(source, [{ i: 0, text: 'Beste Apps' }]);
  assert.ok('doc' in first);
  const second = applyRichTextSegments(source, [{ i: 2, text: '<m1><m2>Preis</m2></m1>' }], first.doc);
  assert.ok('doc' in second);
  assert.deepEqual(getRichTextSegments(second.doc).map((s) => s.text), [
    'Beste Apps',
    'Try <m1>our editor</m1> for <x1/><m2> today</m2>',
    '<m1><m2>Preis</m2></m1>',
  ]);
  assert.deepEqual([...getTranslatedSegmentIndexes(source, second.doc)!], [0, 2]);
});

test('ignores a previous translation with a different structure', () => {
  const other: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Alt' }] }] };
  const result = applyRichTextSegments(source, [{ i: 2, text: '<m1><m2>Preis</m2></m1>' }], other);
  assert.ok('doc' in result);
  assert.equal(getRichTextSegments(result.doc)[0].text, 'Best apps');
  assert.equal(getTranslatedSegmentIndexes(source, other), null);
});

test('returns existing translations with source tags so single segments can be edited', () => {
  const first = applyRichTextSegments(source, [
    { i: 0, text: 'Beste Apps' },
    { i: 1, text: 'Probiere <m1>unseren Editor</m1> für <x1/><m2> heute</m2>' },
  ]);
  assert.ok('doc' in first);

  // Italic added to "Probiere" in the editor gets a tag number after the source's.
  const edited = structuredClone(first.doc);
  edited.content![1].content![0] = { type: 'text', text: 'Probiere', marks: [{ type: 'italic' }] };
  edited.content![1].content!.splice(1, 0, { type: 'text', text: ' ' });

  const segments = getRichTextSegments(source, edited);
  assert.equal(segments[0].translated_text, 'Beste Apps');
  assert.equal(segments[1].translated_text, '<m3>Probiere</m3> <m1>unseren Editor</m1> für <x1/><m2> heute</m2>');
  assert.equal(segments[2].translated_text, undefined);

  const fixed = applyRichTextSegments(source, [
    { i: 1, text: '<m3>Teste</m3> <m1>unseren Editor</m1> für <x1/><m2> heute</m2>' },
  ], edited);
  assert.ok('doc' in fixed);
  assert.equal(getRichTextSegments(source, fixed.doc)[1].translated_text, '<m3>Teste</m3> <m1>unseren Editor</m1> für <x1/><m2> heute</m2>');
  assert.equal(getRichTextSegments(fixed.doc)[0].text, 'Beste Apps');
});

test('keeps the structure when placeholders swap places within a segment', () => {
  const br = { type: 'hardBreak' };
  const doc: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }, pill, { type: 'text', text: 'B' }, br] }] };
  const result = applyRichTextSegments(doc, [{ i: 0, text: 'B<x2/>A<x1/>' }]);
  assert.ok('doc' in result);
  assert.equal(getRichTextStructureKey(result.doc), getRichTextStructureKey(doc));
  assert.equal(getRichTextSegments(doc, result.doc)[0].translated_text, 'B<x2/>A<x1/>');
});

test('rejects segments that drop links or placeholders, or have broken tags', () => {
  const result = applyRichTextSegments(source, [
    { i: 1, text: 'Probiere unseren Editor <x1/>' },
    { i: 2, text: '<m1><m2>Preis</m1></m2>' },
    { i: 0, text: '' },
    { i: 9, text: 'x' },
  ]);
  assert.ok('errors' in result);
  assert.deepEqual(result.errors, [
    '[1] link <m1> is missing',
    '[2] </m1> does not close the innermost open tag',
    '[0] text is empty',
    '[9] no such segment (0-2)',
  ]);
});
