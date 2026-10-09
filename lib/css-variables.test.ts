import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCssVariablesStylesheet } from '@/lib/css-variables-stylesheet';
import { getDefaultColorVariables, legacyColorsToGraph, validateCssVariableValues, isValidCssVariableValue } from '@/lib/css-variable-utils';
import { cssVariableSetSchema, cssVariableModeSchema } from '@/lib/css-variable-schemas';
import { parseTextShadow, serializeTextShadow } from '@/lib/text-shadow-utils';
import { classesToDesign, designToClasses, getAffectedProperties, replaceConflictingClasses } from '@/lib/tailwind-class-mapper';
import type { CssVariablesGraph, CssVariableType, DesignProperties } from '@/types';
import { useCssVariablesStore } from '@/stores/useCssVariablesStore';
import { cssVariablesApi } from '@/lib/api';

function fixture(): CssVariablesGraph {
  return {
    sets: [{ id: 'set', name: 'Tokens', activation_kind: 'theme', sort_order: 0, created_at: '', updated_at: '' }],
    modes: [{ id: 'base', set_id: 'set', name: 'Default', is_default: true, data_theme: null, min_width: null, sort_order: 0, created_at: '', updated_at: '' },
      { id: 'dark', set_id: 'set', name: 'Dark', is_default: false, data_theme: 'dark', min_width: null, sort_order: 1, created_at: '', updated_at: '' }],
    groups: [],
    variables: [{ id: 'color', set_id: 'set', group_id: null, type: 'color', name: 'Brand', sort_order: 0, created_at: '', updated_at: '' },
      { id: 'semantic', set_id: 'set', group_id: null, type: 'color', name: 'Text', sort_order: 1, created_at: '', updated_at: '' }],
    values: [{ css_variable_id: 'color', mode_id: 'base', value: '#ff0000/50', created_at: '', updated_at: '' },
      { css_variable_id: 'color', mode_id: 'dark', value: '#ffffff', created_at: '', updated_at: '' },
      { css_variable_id: 'semantic', mode_id: 'base', value: 'var(--color)', created_at: '', updated_at: '' }],
  };
}

test('preserve color IDs, opacity and live alias declarations across modes', () => {
  const graph = fixture();
  validateCssVariableValues(graph);
  const css = buildCssVariablesStylesheet(graph);
  assert.ok(css.includes('--color: rgba(255,0,0,0.5);'));
  assert.ok(css.includes('--semantic: var(--color);'));
  assert.ok(css.includes('[data-theme="dark"] { --color: #ffffff; }'));
  assert.equal(getDefaultColorVariables(graph)[1].value, '#ff0000/50');
});

test('sort breakpoints by width and omit missing overrides to retain defaults', () => {
  const graph = fixture();
  graph.sets[0].activation_kind = 'breakpoint';
  graph.modes[1].min_width = 1024;
  graph.modes.push({ ...graph.modes[1], id: 'tablet', min_width: 768, sort_order: 9 });
  graph.values.push({ ...graph.values[0], mode_id: 'tablet', value: '#cccccc' });
  const css = buildCssVariablesStylesheet(graph);
  assert.ok(css.indexOf('768px') < css.indexOf('1024px'));
  assert.equal((css.match(/--semantic:/g) ?? []).length, 1);
});

test('reject missing, mismatched and cyclic aliases including cross-mode cycles', () => {
  const graph = fixture();
  graph.values[2].value = 'var(--missing)';
  assert.throws(() => validateCssVariableValues(graph), /existing variable/);
  graph.values[2].value = 'var(--color)';
  graph.variables[0].type = 'size';
  assert.throws(() => validateCssVariableValues(graph));
  graph.variables[0].type = 'color';
  graph.values[1].value = 'var(--semantic)';
  assert.throws(() => validateCssVariableValues(graph), /cycle/);
  graph.values[1].value = '#fff';
  graph.modes[1].set_id = 'another-set';
  assert.throws(() => validateCssVariableValues(graph), /same collection/);
});

test('validate lengths and font stacks and reject CSS/HTML injection', () => {
  const cases: [CssVariableType, string][] = [['size', '1.5rem'], ['size', '-2px'], ['size', '.25em'], ['number', '1.4'], ['percentage', '50%'], ['font_family', '"Helvetica Neue", sans-serif']];
  for (const [type, value] of cases) assert.equal(isValidCssVariableValue(type, value), true);
  for (const value of ['1px; color: red', '</style><script>alert(1)</script>', 'url(https://example.com)', 'calc(1px + 1rem)']) {
    assert.equal(isValidCssVariableValue('size', value), false);
  }
  const graph = fixture();
  graph.values[0].value = '</style><script>alert(1)</script>';
  assert.equal(buildCssVariablesStylesheet(graph).includes('<script>'), false);
  assert.throws(() => cssVariableSetSchema.parse({ name: 'x', id: 'overwrite' }));
  assert.throws(() => cssVariableModeSchema.parse({ set_id: 'bad-id', name: 'mode', min_width: -1 }));
});

test('round-trip measurement and font references through classes', () => {
  const ref = 'var(--token)';
  const cases: [keyof DesignProperties, string][] = [['sizing', 'width'], ['sizing', 'height'], ['spacing', 'paddingTop'], ['spacing', 'marginRight'], ['typography', 'fontSize'], ['typography', 'fontFamily'], ['typography', 'lineHeight'], ['typography', 'letterSpacing'], ['borders', 'borderWidth'], ['borders', 'borderRadius'], ['borders', 'outlineWidth']];
  for (const [category, property] of cases) {
    const design = { [category]: { [property]: ref } } as DesignProperties;
    const classes = designToClasses(design);
    const parsed = classesToDesign(classes);
    assert.equal((parsed?.[category] as Record<string, string>)?.[property], ref, `${category}.${property}: ${classes.join(' ')}`);
  }
});

test('size and color variables do not erase each other when changing properties', () => {
  const sizeClass = ['text-', '[length:var(--size)]'].join('');
  const colorClass = ['text-', '[color:var(--color)]'].join('');
  assert.equal(classesToDesign(designToClasses({ typography: { fontFamily: 'var(--font)' } }))?.typography?.fontWeight, undefined);
  assert.deepEqual(getAffectedProperties(sizeClass), ['fontSize']);
  assert.deepEqual(getAffectedProperties(colorClass), ['color']);
  assert.deepEqual(replaceConflictingClasses([sizeClass, colorClass], 'fontSize', null), [colorClass]);
  assert.deepEqual(replaceConflictingClasses([sizeClass, colorClass], 'color', null), [sizeClass]);
  const widthClass = ['border-', '[length:var(--size)]'].join('');
  assert.ok(getAffectedProperties(widthClass).includes('borderWidth'));
  assert.equal(getAffectedProperties(widthClass).includes('borderColor'), false);
});

test('shadow tokens survive parsing and serialization alongside numeric pixels', () => {
  const value = 'var(--x)_1rem_var(--blur)_rgba(0,0,0,0.4)';
  const parsed = parseTextShadow(value);
  assert.ok(parsed);
  assert.equal(parsed.blur, 'var(--blur)');
  assert.equal(serializeTextShadow(parsed), value);
  const numeric = parseTextShadow('0px_2px_4px_#000000');
  assert.ok(numeric);
  assert.equal(serializeTextShadow(numeric), '0px_2px_4px_#000000');
});

test('render legacy colors before the typed schema migration runs', () => {
  const colors = [{ id: 'brand', name: 'Brand', value: '#ff0000/50', sort_order: 2, created_at: '', updated_at: '' }];
  const graph = legacyColorsToGraph(colors);
  validateCssVariableValues(graph);
  assert.equal(graph.variables[0].id, 'brand');
  assert.ok(buildCssVariablesStylesheet(graph).includes('--brand: rgba(255,0,0,0.5);'));
  assert.deepEqual(getDefaultColorVariables(graph), colors);
});

test('reordering one group preserves other groups, collections, values and IDs', async () => {
  const graph = fixture();
  graph.variables.push({ ...graph.variables[0], id: 'unrelated', set_id: 'another-set', sort_order: 42 });
  const original = cssVariablesApi.reorderItems;
  cssVariablesApi.reorderItems = async ids => {
    assert.deepEqual(ids, ['semantic', 'color']);
    return { data: { success: true } };
  };
  try {
    useCssVariablesStore.setState({ graph, error: null });
    await useCssVariablesStore.getState().reorderItems(['semantic', 'color']);
    const next = useCssVariablesStore.getState().graph;
    assert.deepEqual(next.variables.map(v => [v.id, v.sort_order]), [['color', 1], ['semantic', 0], ['unrelated', 42]]);
    assert.deepEqual(next.values, graph.values);
    assert.deepEqual(next.sets, graph.sets);
  } finally {
    cssVariablesApi.reorderItems = original;
  }
});

test('failed ordering saves report API errors and keep edits made while saving', async () => {
  const graph = fixture();
  graph.sets.push({ ...graph.sets[0], id: 'another-set', name: 'Other', sort_order: 1 });
  const original = cssVariablesApi.reorderSets;
  let finish!: (response: { error: string }) => void;
  cssVariablesApi.reorderSets = () => new Promise(resolve => { finish = resolve; });
  try {
    useCssVariablesStore.setState({ graph, error: null });
    const save = useCssVariablesStore.getState().reorderSets(['another-set', 'set']);
    await Promise.resolve();
    assert.equal(useCssVariablesStore.getState().graph.sets[0].sort_order, 1);
    useCssVariablesStore.setState(state => ({ graph: { ...state.graph, sets: state.graph.sets.map(s => s.id === 'set' ? { ...s, name: 'Renamed while saving' } : s) } }));
    finish({ error: 'Permission denied' });
    await save;
    const state = useCssVariablesStore.getState();
    assert.equal(state.error, 'Permission denied');
    assert.equal(state.graph.sets[0].sort_order, 0);
    assert.equal(state.graph.sets[0].name, 'Renamed while saving');
    assert.equal(state.graph.sets[1].sort_order, 1);
  } finally {
    cssVariablesApi.reorderSets = original;
  }
});

test('rapid ordering saves are serialized so the last order persists', async () => {
  const graph = fixture();
  graph.groups = ['a', 'b'].map((id, sort_order) => ({ id, name: id, set_id: 'set', sort_order, created_at: '', updated_at: '' }));
  const original = cssVariablesApi.reorderGroups;
  const requests: string[][] = [];
  let finish!: (response: { data: { success: boolean } }) => void;
  cssVariablesApi.reorderGroups = ids => {
    requests.push(ids);
    return requests.length === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ data: { success: true } });
  };
  try {
    useCssVariablesStore.setState({ graph, error: null });
    const first = useCssVariablesStore.getState().reorderGroups(['b', 'a']);
    const second = useCssVariablesStore.getState().reorderGroups(['a', 'b']);
    await Promise.resolve();
    assert.deepEqual(requests, [['b', 'a']]);
    finish({ data: { success: true } });
    await Promise.all([first, second]);
    assert.deepEqual(requests, [['b', 'a'], ['a', 'b']]);
    assert.deepEqual(useCssVariablesStore.getState().graph.groups.map(g => [g.id, g.sort_order]), [['a', 0], ['b', 1]]);
  } finally {
    cssVariablesApi.reorderGroups = original;
  }
});
