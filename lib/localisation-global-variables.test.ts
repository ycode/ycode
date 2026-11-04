import { test } from 'node:test';
import assert from 'node:assert/strict';
import { injectTranslatedText, richTextHasItemBoundVariable } from '@/lib/localisation-utils';

import type { Layer, Translation } from '@/types';

const pill = (source: 'global' | 'collection', id: string) => ({
  type: 'dynamicVariable',
  attrs: {
    label: 'Price',
    variable: { type: 'field', data: { field_id: id, field_type: 'text', relationships: [], source } },
  },
});

const doc = (...content: Record<string, unknown>[]) => ({ type: 'doc', content: [{ type: 'paragraph', content }] });

const layer = {
  id: 'price',
  name: 'text',
  variables: { text: { type: 'dynamic_rich_text', data: { content: doc({ type: 'text', text: 'Only ' }, pill('global', 'g1')) } } },
} as unknown as Layer;

const translationOf = (value: unknown) => ({
  'page:page-1:layer:price:text': {
    source_type: 'page',
    source_id: 'page-1',
    content_key: 'layer:price:text',
    content_type: 'richtext',
    content_value: JSON.stringify(value),
    is_completed: true,
  },
}) as unknown as Record<string, Translation>;

const textContent = (result: Layer) => (result.variables?.text as { data: { content: unknown } }).data.content;

test('global pills do not count as item-bound variables', () => {
  assert.equal(richTextHasItemBoundVariable(JSON.stringify(doc(pill('global', 'g1')))), false);
  assert.equal(richTextHasItemBoundVariable(JSON.stringify(doc(pill('collection', 'f1')))), true);
  assert.equal(richTextHasItemBoundVariable(JSON.stringify(doc(pill('global', 'g1'), pill('collection', 'f1')))), true);
  assert.equal(richTextHasItemBoundVariable('Seulement 0,12 $'), false);
});

test('injects a translation that keeps a global pill', () => {
  const translated = doc({ type: 'text', text: 'Seulement ' }, pill('global', 'g1'));
  const [result] = injectTranslatedText([layer], 'page-1', translationOf(translated));

  assert.deepEqual(textContent(result), translated);
});

test('skips a translation that re-captures a collection field binding', () => {
  const translated = doc({ type: 'text', text: 'Par ' }, pill('collection', 'f1'));
  const [result] = injectTranslatedText([layer], 'page-1', translationOf(translated));

  assert.deepEqual(textContent(result), textContent(layer));
});
