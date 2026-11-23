import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectReferencedComponentIds } from '@/lib/component-utils';

test('collects instance, override and rich-text component references', () => {
  const layers = [{
    id: 'root',
    name: 'div',
    componentId: 'comp-a',
    componentOverrides: {
      rich_text: {
        'var-body': { type: 'dynamic_rich_text', data: { content: { type: 'doc', content: [{ type: 'richTextComponent', attrs: { componentId: 'comp-b' } }] } } },
      },
    },
    children: [{
      id: 'text',
      name: 'text',
      variables: { text: { type: 'dynamic_rich_text', data: { content: { type: 'doc', content: [{ type: 'richTextComponent', attrs: { componentId: 'comp-c' } }] } } } },
    }],
  }];

  assert.deepEqual([...collectReferencedComponentIds(layers)].sort(), ['comp-a', 'comp-b', 'comp-c']);
});

test('collects references inside serialized rich text values', () => {
  const doc = JSON.stringify({ type: 'doc', content: [{ type: 'richTextComponent', attrs: { componentId: 'comp-d' } }] });
  const values = { field: doc, nested: JSON.stringify({ value: doc }) };

  assert.deepEqual([...collectReferencedComponentIds(values)], ['comp-d']);
});

test('returns nothing for layers without components', () => {
  assert.equal(collectReferencedComponentIds([{ id: 'a', name: 'div', children: [] }]).size, 0);
});
