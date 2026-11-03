import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildOverrideValue, defaultOverrideSource } from './instance-overrides-core';
import type { OverrideContext } from './instance-overrides-core';
import type { DynamicPageLinkTarget } from './utils';
import type { CollectionField, Layer } from '../../types';

const fields = [
  { id: 'fld-name', name: 'Name', type: 'text' },
  { id: 'fld-cover', name: 'Cover', type: 'image' },
  { id: 'fld-url', name: 'Website', type: 'link' },
] as CollectionField[];

const layers: Layer[] = [{
  id: 'body',
  name: 'body',
  classes: '',
  children: [
    {
      id: 'list',
      name: 'div',
      classes: '',
      variables: { collection: { id: 'col-posts' } },
      children: [{ id: 'card', name: 'div', classes: '', componentId: 'cmp-card', children: [] }],
    },
    { id: 'hero', name: 'div', classes: '', componentId: 'cmp-card', children: [] },
    { id: 'faq', name: 'section', classes: '', settings: { id: 'faq' }, children: [] },
  ],
}];

const pages: Record<string, DynamicPageLinkTarget> = {
  'page-home': { is_dynamic: false, settings: {} },
  'page-post': { is_dynamic: true, settings: { cms: { collection_id: 'col-posts', slug_field_id: 'fld-slug' } } },
};

const ctx: OverrideContext = {
  layers,
  pageId: 'page-home',
  instanceLayerId: 'card',
  resolveBinding: async (source) => (source === 'collection'
    ? { collectionLayerId: 'list', fields }
    : { error: 'This page is not a dynamic CMS page.' }),
  getPage: async (id) => pages[id] ?? null,
  getPageLayers: async () => layers,
};

const fieldData = (fieldId: string, fieldType: string) => ({
  type: 'field',
  data: { field_id: fieldId, field_type: fieldType, relationships: [], source: 'collection', collection_layer_id: 'list' },
});

test('source defaults to the enclosing Collection List, else the page', () => {
  assert.equal(defaultOverrideSource(layers, 'card'), 'collection');
  assert.equal(defaultOverrideSource(layers, 'hero'), 'page');
});

test('text segments bind fields of the enclosing list', async () => {
  const built = await buildOverrideValue('text', {
    segments: [{ type: 'text', text: 'By ' }, { type: 'field', field_id: 'fld-name' }],
  }, ctx);

  assert.deepEqual(built, {
    value: {
      type: 'dynamic_rich_text',
      data: {
        content: {
          type: 'doc',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'By ' },
              { type: 'dynamicVariable', attrs: { variable: fieldData('fld-name', 'text'), label: 'Name' } },
            ],
          }],
        },
      },
    },
  });
});

test('unknown fields and field-less segments are rejected', async () => {
  const missing = await buildOverrideValue('text', { segments: [{ type: 'field', field_id: 'nope' }] }, ctx);
  assert.ok('error' in missing && missing.error.includes('"nope" not found'));

  const literalOnly = await buildOverrideValue('text', { segments: [{ type: 'text', text: 'Hi' }] }, ctx);
  assert.ok('error' in literalOnly);
});

test('field_id binds image and link variables', async () => {
  assert.deepEqual(await buildOverrideValue('image', { field_id: 'fld-cover', alt: 'Cover' }, ctx), {
    value: { src: fieldData('fld-cover', 'image'), alt: { type: 'dynamic_text', data: { content: 'Cover' } } },
  });
  assert.deepEqual(await buildOverrideValue('link', { field_id: 'fld-url', target: '_blank' }, ctx), {
    value: { type: 'field', field: fieldData('fld-url', 'link'), target: '_blank' },
  });
});

test('icon variables cannot bind a field', async () => {
  const built = await buildOverrideValue('icon', { field_id: 'fld-cover' }, ctx);
  assert.ok('error' in built);
});

test('outside a Collection List, bindings default to the page source', async () => {
  const built = await buildOverrideValue('text', {
    segments: [{ type: 'field', field_id: 'fld-name' }],
  }, { ...ctx, instanceLayerId: 'hero' });
  assert.deepEqual(built, { error: 'This page is not a dynamic CMS page.' });
});

test('links to a dynamic page pick the CMS item', async () => {
  assert.deepEqual(await buildOverrideValue('link', { link_page_id: 'page-post' }, ctx), {
    value: { type: 'page', page: { id: 'page-post', collection_item_id: 'current-collection' } },
  });
  assert.deepEqual(await buildOverrideValue('link', { link_page_id: 'page-post', collection_item_id: 'item-1' }, ctx), {
    value: { type: 'page', page: { id: 'page-post', collection_item_id: 'item-1' } },
  });
  assert.deepEqual(await buildOverrideValue('link', { link_page_id: 'page-home' }, ctx), {
    value: { type: 'page', page: { id: 'page-home' } },
  });
});

test('anchor links resolve to the target HTML id', async () => {

  assert.deepEqual(await buildOverrideValue('link', { anchor_layer_id: 'faq' }, ctx), {
    value: { type: 'url', anchor_layer_id: 'faq' },
  });
});

test('static overrides keep their previous shapes', async () => {
  assert.deepEqual(await buildOverrideValue('link', { url: 'https://ycode.com' }, ctx), {
    value: { type: 'url', url: { type: 'dynamic_text', data: { content: 'https://ycode.com' } } },
  });
  assert.deepEqual(await buildOverrideValue('visibility', { visible: false }, ctx), { value: { visible: false } });
  assert.deepEqual(await buildOverrideValue('image', {}, ctx), { error: 'No usable value provided (image)' });
});
