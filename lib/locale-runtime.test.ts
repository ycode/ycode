import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTranslationValue, hasTranslationContent } from '@/lib/locale-runtime';
import type { Translation } from '@/types';

const EMPTY_DOC = '{"type":"doc","content":[{"type":"paragraph"}]}';
const TEXT_DOC = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Bonjour"}]}]}';

test('blank values and empty rich-text docs have no content', () => {
  assert.equal(hasTranslationContent(''), false);
  assert.equal(hasTranslationContent('   '), false);
  assert.equal(hasTranslationContent(null), false);
  assert.equal(hasTranslationContent(EMPTY_DOC), false);
  assert.equal(hasTranslationContent('{"type":"doc","content":[{"type":"paragraph"},{"type":"paragraph"}]}'), false);
  assert.equal(hasTranslationContent('{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[]}]}'), false);
});

test('text, rich-text docs and non-doc JSON have content', () => {
  assert.equal(hasTranslationContent('Bonjour'), true);
  assert.equal(hasTranslationContent(TEXT_DOC), true);
  assert.equal(hasTranslationContent('{"type":"url","url":"https://example.com"}'), true);
  assert.equal(hasTranslationContent('{not json'), true);
});

test('an empty rich-text translation falls back to the original', () => {
  const translation = { content_value: EMPTY_DOC, is_completed: true } as Translation;
  assert.equal(getTranslationValue(translation), undefined);
  assert.equal(getTranslationValue(translation, { includeIncomplete: true }), undefined);
});
