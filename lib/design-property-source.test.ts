import assert from 'node:assert/strict';
import { test } from 'node:test';

import { colorVariableToCss, colorVarIdsFromClasses, splitColorVariableRefs } from './color-variable-utils';
import {
  getDesignPanelSource,
  getDesignPropertyLabel,
  groupDesignSourceSteps,
  resolveDesignPropertyChain,
  type DesignPanelSource,
} from './design-property-source';
import { setBreakpointClass } from './tailwind-class-mapper';
import type { Layer, LayerStyle } from '../types';

const style = (id: string, name: string, classes: string) => ({ id, name, classes, is_published: false }) as LayerStyle;
const element = (classes: string[]): DesignPanelSource => ({
  sources: [{ label: 'Hero', kind: 'element', classes }],
  parents: [],
});
const classNames = (steps: { className: string }[]) => steps.map((step) => step.className);

test('chains the style stack, including per-element changes', () => {
  const stylesById = new Map([
    ['card', style('card', 'Card', 'w-[100px] p-[8px]')],
    ['wide', style('wide', 'Card wide', 'w-[300px]')],
  ]);
  const layer = {
    id: 'l1',
    name: 'div',
    classes: 'p-[16px] w-[300px]',
    styleIds: ['card', 'wide'],
    styleOverridesByStyle: { card: { classes: 'w-[100px] p-[16px]' } },
  } as Layer;

  const panel = getDesignPanelSource(layer, { stylesById });

  const width = resolveDesignPropertyChain('width', panel, 'desktop', 'neutral');
  assert.deepEqual(width.map((step) => [step.className, step.label, step.isCustomized]), [
    ['w-[100px]', 'Card', false],
    ['w-[300px]', 'Card wide', false],
  ]);

  const padding = resolveDesignPropertyChain('padding', panel, 'desktop', 'neutral');
  assert.deepEqual(padding.map((step) => [step.className, step.label, step.styleId, step.isCustomized]), [
    ['p-[8px]', 'Card', 'card', false],
    ['p-[16px]', 'Card', 'card', true],
  ]);

  assert.deepEqual(groupDesignSourceSteps(padding).map((group) => classNames(group.steps)), [['p-[8px]', 'p-[16px]']]);
  assert.deepEqual(groupDesignSourceSteps(width).map((group) => classNames(group.steps)), [['w-[100px]'], ['w-[300px]']]);
});

test('uses the layer own classes without styles', () => {
  const layer = { id: 'l1', name: 'div', customName: 'Hero', classes: 'flex gap-[8px]' } as Layer;
  const { sources } = getDesignPanelSource(layer, { stylesById: new Map() });

  assert.deepEqual(sources, [{ label: 'Hero', kind: 'element', classes: ['flex', 'gap-[8px]'] }]);
});

test('chains breakpoint overrides up to the active breakpoint', () => {
  const panel = element(['w-[100px]', 'max-lg:w-[50px]', 'max-md:w-[20px]']);

  const tablet = resolveDesignPropertyChain('width', panel, 'tablet', 'neutral');
  assert.deepEqual(tablet.map((step) => [step.className, step.breakpoint]), [
    ['w-[100px]', 'desktop'],
    ['max-lg:w-[50px]', 'tablet'],
  ]);
});

test('puts state classes after neutral ones', () => {
  const panel = element(['text-[#000000]', 'hover:text-[#ff0000]', 'max-lg:text-[#00ff00]']);

  const hover = resolveDesignPropertyChain('color', panel, 'tablet', 'hover');
  assert.deepEqual(classNames(hover), ['text-[#000000]', 'max-lg:text-[#00ff00]', 'hover:text-[#ff0000]']);
  assert.equal(hover.at(-1)?.uiState, 'hover');

  const focus = resolveDesignPropertyChain('color', panel, 'desktop', 'focus');
  assert.deepEqual(classNames(focus), ['text-[#000000]']);
});

test('puts a text style after the layer classes', () => {
  const layer = {
    id: 'l1',
    name: 'text',
    classes: 'text-[#000000]',
    textStyles: { bold: { classes: 'text-[#ff0000]' } },
  } as unknown as Layer;

  const panel = getDesignPanelSource(layer, { textStyleKey: 'bold', stylesById: new Map() });
  const color = resolveDesignPropertyChain('color', panel, 'desktop', 'neutral');

  assert.deepEqual(color.map((step) => [step.className, step.kind]), [
    ['text-[#000000]', 'element'],
    ['text-[#ff0000]', 'textStyle'],
  ]);
});

test('starts inherited properties with the nearest parent that sets them', () => {
  const layer = { id: 'text', name: 'text', classes: 'text-[#ff0000]' } as Layer;
  const ancestors = [
    { id: 'card', name: 'div', customName: 'Card', classes: 'p-[8px]' },
    { id: 'section', name: 'section', customName: 'Hero', classes: 'text-[#333333] text-[20px]' },
    { id: 'body', name: 'div', customName: 'Body', classes: 'text-[#000000]' },
  ] as Layer[];

  const panel = getDesignPanelSource(layer, { stylesById: new Map(), ancestors });

  const color = resolveDesignPropertyChain('color', panel, 'desktop', 'neutral');
  assert.deepEqual(color.map((step) => [step.className, step.kind, step.layerId]), [
    ['text-[#333333]', 'parent', 'section'],
    ['text-[#ff0000]', 'element', undefined],
  ]);

  const fontSize = resolveDesignPropertyChain('fontSize', panel, 'desktop', 'neutral');
  assert.deepEqual(classNames(fontSize), ['text-[20px]']);

  assert.deepEqual(resolveDesignPropertyChain('padding', panel, 'desktop', 'neutral'), []);
});

test('formats design property names', () => {
  assert.equal(getDesignPropertyLabel('minWidth'), 'Min width');
  assert.equal(getDesignPropertyLabel('gap'), 'Gap');
});

test('returns an empty chain when the property is not set', () => {
  assert.deepEqual(resolveDesignPropertyChain('height', element(['w-[100px]']), 'desktop', 'neutral'), []);
});

test('does not read background colors as size or position', () => {
  const source = element(['bg-[#ff0000]', 'bg-[color:var(--brand)]', 'bg-cover']);

  assert.deepEqual(classNames(resolveDesignPropertyChain('backgroundSize', source, 'desktop', 'neutral')), ['bg-cover']);
  assert.deepEqual(resolveDesignPropertyChain('backgroundPosition', source, 'desktop', 'neutral'), []);
  assert.deepEqual(setBreakpointClass(['bg-[#ff0000]'], 'backgroundSize', 'bg-contain', 'desktop'), ['bg-[#ff0000]', 'bg-contain']);
});

test('reads color variable ids and converts their values', () => {
  const ids = new Set<string>();
  colorVarIdsFromClasses('text-[color:var(--brand)] bg-[var(--surface)] p-[8px]', ids);

  assert.deepEqual([...ids], ['brand', 'surface']);
  assert.equal(colorVariableToCss('#3b82f6'), '#3b82f6');
  assert.equal(colorVariableToCss('#3b82f6/50'), 'rgba(59,130,246,0.5)');
});

test('splits color variable references out of a class', () => {
  assert.deepEqual(splitColorVariableRefs('max-lg:text-[color:var(--brand)]'), [
    { text: 'max-lg:text-[' },
    { variableId: 'brand', text: 'color:var(--brand)' },
    { text: ']' },
  ]);
  assert.deepEqual(splitColorVariableRefs('p-[8px]'), [{ text: 'p-[8px]' }]);
});
