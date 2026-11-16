import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientLinkTranslations, getTranslationValue, hasTranslationContent } from '@/lib/locale-runtime';
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

function row(source_type: Translation['source_type'], source_id: string, content_key: string, content_value: string): Translation {
  return {
    id: `id-${source_id}-${content_key}`,
    locale_id: 'fr',
    source_type,
    source_id,
    content_key,
    content_type: 'text',
    content_value,
    is_completed: true,
    is_published: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
  };
}

test('client link translations keep only page and folder slugs, without row metadata', () => {
  const translations = {
    'page:p1:slug': row('page', 'p1', 'slug', 'a-propos'),
    'folder:f1:slug': row('folder', 'f1', 'slug', 'blogue'),
    'cms:i1:field:key:slug': row('cms', 'i1', 'field:key:slug', 'article-un'),
    'page:p1:seo:title': row('page', 'p1', 'seo:title', 'À propos'),
  };

  const slim = clientLinkTranslations(translations);

  assert.deepEqual(Object.keys(slim ?? {}).sort(), ['folder:f1:slug', 'page:p1:slug']);
  assert.deepEqual(slim?.['page:p1:slug'], {
    source_type: 'page',
    source_id: 'p1',
    content_key: 'slug',
    content_type: 'text',
    content_value: 'a-propos',
    is_completed: true,
  });
  assert.equal(getTranslationValue(slim?.['folder:f1:slug'] as Translation), 'blogue');
  assert.equal(clientLinkTranslations(null), undefined);
});
