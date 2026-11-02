import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractComponentTranslatableItems,
  translateNestedComponentOverrides,
} from '@/lib/localisation-utils';
import { resolveComponents } from '@/lib/resolve-components';

import type { Component, Layer, Translation } from '@/types';

const textValue = (content: string) => ({ type: 'dynamic_text', data: { content } });

const innerComponent = {
  id: 'comp-b',
  name: 'Card',
  variables: [{ id: 'var-title', name: 'Title', type: 'text' }],
  layers: [{
    id: 'b-root',
    name: 'div',
    children: [{ id: 'b-text', name: 'text', variables: { text: { ...textValue('Default'), id: 'var-title' } } }],
  }],
} as unknown as Component;

const outerComponent = {
  id: 'comp-a',
  name: 'Section',
  layers: [{
    id: 'a-root',
    name: 'section',
    children: [{
      id: 'b-instance',
      name: 'div',
      componentId: 'comp-b',
      componentOverrides: { text: { 'var-title': textValue('Hello') } },
    }],
  }],
} as unknown as Component;

const translations = {
  'component:comp-a:layer:b-instance:override:text:var-title': {
    source_type: 'component',
    source_id: 'comp-a',
    content_key: 'layer:b-instance:override:text:var-title',
    content_value: 'Bonjour',
    is_completed: true,
  },
} as unknown as Record<string, Translation>;

function findText(layers: Layer[], id: string): string | undefined {
  for (const layer of layers) {
    if (layer._originalLayerId === id || layer.id === id) {
      return (layer.variables?.text as { data: { content: string } } | undefined)?.data.content;
    }
    const found = layer.children ? findText(layer.children, id) : undefined;
    if (found !== undefined) return found;
  }
  return undefined;
}

test('lists overrides on instances nested in a component as component-scoped items', () => {
  const items = extractComponentTranslatableItems(outerComponent, outerComponent.layers, [innerComponent, outerComponent]);
  const override = items.find(item => item.content_key === 'layer:b-instance:override:text:var-title');

  assert.ok(override);
  assert.equal(override.key, 'component:comp-a:layer:b-instance:override:text:var-title');
  assert.equal(override.source_type, 'component');
  assert.equal(override.content_value, 'Hello');
  assert.equal(override.info.label, 'Card › Title');
});

test('renders the translated override of a nested instance', () => {
  const components = translateNestedComponentOverrides([innerComponent, outerComponent], translations);
  const pageLayers = [{ id: 'a-instance', name: 'section', componentId: 'comp-a' }] as Layer[];

  assert.equal(findText(resolveComponents(pageLayers, components), 'b-text'), 'Bonjour');
  assert.equal(findText(resolveComponents(pageLayers, [innerComponent, outerComponent]), 'b-text'), 'Hello');
});

test('returns components unchanged without translations', () => {
  const components = [innerComponent, outerComponent];
  assert.equal(translateNestedComponentOverrides(components, {}), components);
});
