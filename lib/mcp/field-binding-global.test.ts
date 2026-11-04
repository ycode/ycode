import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDynamicTextDoc } from '@/lib/mcp/field-binding-core';
import { coerceGlobalVariableValue } from '@/lib/mcp/utils';
import { globalToPseudoField } from '@/lib/collection-field-utils';

import type { CollectionField, GlobalVariable } from '@/types';

const priceGlobal = {
  id: 'g1',
  name: 'Price per photo',
  key: null,
  type: 'text',
  value: '$0.12',
  data: {},
  order: 0,
  is_published: false,
} as unknown as GlobalVariable;

test('dynamic text with a global segment stores the builder pill shape', () => {
  const field = globalToPseudoField(priceGlobal);
  const built = buildDynamicTextDoc(
    [{ type: 'text', text: 'Only ' }, { type: 'field', field_id: 'g1' }, { type: 'text', text: ' per photo' }],
    new Map<string, CollectionField>([[field.id, field]]),
    'global',
    undefined,
  );

  assert.ok(!('error' in built));
  const [, node] = built.doc.content[0].content as Record<string, any>[];
  assert.deepEqual(node, {
    type: 'dynamicVariable',
    attrs: {
      label: 'Price per photo',
      variable: { type: 'field', data: { field_id: 'g1', field_type: 'text', relationships: [], source: 'global', global_id: 'g1' } },
    },
  });
});

test('unknown global ids point the agent at list_global_variables', () => {
  const built = buildDynamicTextDoc([{ type: 'field', field_id: 'missing' }], new Map(), 'global', undefined);
  assert.ok('error' in built);
  assert.match(built.error, /list_global_variables/);
});

test('coerces agent values to the stored global value format', () => {
  assert.equal(coerceGlobalVariableValue('link', 'https://example.com'), '{"type":"url","url":"https://example.com"}');
  assert.equal(coerceGlobalVariableValue('text', ' $0.12 '), ' $0.12 ');
  assert.equal(coerceGlobalVariableValue('number', null), null);
  assert.equal(JSON.parse(coerceGlobalVariableValue('rich_text', '**Free**')!).type, 'doc');
});
