import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFieldVariableData,
  collectFieldVariableFormats,
  withMatchingVariableFormat,
} from '@/lib/variable-format-utils';

const pill = (fieldId: string, format?: string) => ({
  type: 'dynamicVariable',
  attrs: {
    label: 'Price',
    variable: {
      type: 'field',
      data: { field_id: fieldId, field_type: 'number', relationships: [], source: 'global', ...(format ? { format } : {}) },
    },
  },
});

const doc = (...content: Record<string, unknown>[]) => ({ type: 'doc', content: [{ type: 'paragraph', content }] });

test('inserted variable takes the format used in the source doc', () => {
  const formats = collectFieldVariableFormats(doc({ type: 'text', text: 'From ' }, pill('g1', 'number-decimal')));
  const variable = withMatchingVariableFormat(buildFieldVariableData('g1', [], 'number', 'global'), formats);
  assert.equal(variable.data.format, 'number-decimal');
});

test('source variable without a format drops the default format', () => {
  const formats = collectFieldVariableFormats(doc(pill('g1')));
  const variable = withMatchingVariableFormat(buildFieldVariableData('g1', [], 'number', 'global'), formats);
  assert.equal('format' in variable.data, false);
});

test('variable not in the source keeps its default format', () => {
  const formats = collectFieldVariableFormats(doc(pill('g1', 'number-decimal')));
  const variable = withMatchingVariableFormat(buildFieldVariableData('g2', [], 'number', 'global'), formats);
  assert.equal(variable.data.format, 'number-integer');
});

test('same field from a different source does not match', () => {
  const formats = collectFieldVariableFormats(doc(pill('f1', 'number-decimal')));
  const variable = withMatchingVariableFormat(buildFieldVariableData('f1', [], 'number', 'collection'), formats);
  assert.equal(variable.data.format, 'number-integer');
});
