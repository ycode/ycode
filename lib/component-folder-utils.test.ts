import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_COMPONENT_FOLDER,
  getComponentFolderNames,
  groupComponentsByFolder,
  moveComponentFolder,
  normalizeComponentFolder,
  renameComponentFolderInOrder,
} from './component-folder-utils';
import type { Component } from '../types';

function component(id: string, folder?: string | null): Component {
  return {
    id,
    name: id,
    layers: [],
    folder,
    is_published: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

test('normalizeComponentFolder maps empty and default names to null', () => {
  assert.equal(normalizeComponentFolder(undefined), null);
  assert.equal(normalizeComponentFolder('   '), null);
  assert.equal(normalizeComponentFolder('components'), null);
  assert.equal(normalizeComponentFolder(`  ${DEFAULT_COMPONENT_FOLDER} `), null);
  assert.equal(normalizeComponentFolder('  Cards '), 'Cards');
});

test('getComponentFolderNames returns sorted unique names', () => {
  const names = getComponentFolderNames([
    component('a', 'Navigation'),
    component('b', 'Cards'),
    component('c', 'Cards'),
    component('d', null),
  ]);
  assert.deepEqual(names, ['Cards', 'Navigation']);
});

test('groupComponentsByFolder puts the default folder first and keeps order', () => {
  const groups = groupComponentsByFolder([
    component('a', 'Navigation'),
    component('b'),
    component('c', 'Cards'),
    component('d', ' '),
    component('e', 'Cards'),
  ]);

  assert.deepEqual(groups.map((g) => g.label), [DEFAULT_COMPONENT_FOLDER, 'Cards', 'Navigation']);
  assert.deepEqual(groups[0].components.map((c) => c.id), ['b', 'd']);
  assert.deepEqual(groups[1].components.map((c) => c.id), ['c', 'e']);
});

test('groupComponentsByFolder hides an empty default folder only when folders exist', () => {
  assert.deepEqual(
    groupComponentsByFolder([component('a', 'Cards')]).map((g) => g.label),
    ['Cards']
  );
  assert.deepEqual(groupComponentsByFolder([]).map((g) => g.folder), [null]);
});

test('groupComponentsByFolder follows the stored order, unlisted folders after', () => {
  const components = [
    component('a', 'Navigation'),
    component('b'),
    component('c', 'Cards'),
    component('d', 'Footers'),
  ];

  assert.deepEqual(
    groupComponentsByFolder(components, ['Navigation', DEFAULT_COMPONENT_FOLDER, 'Gone']).map((g) => g.label),
    ['Navigation', DEFAULT_COMPONENT_FOLDER, 'Cards', 'Footers']
  );
  assert.deepEqual(
    groupComponentsByFolder(components, ['Footers']).map((g) => g.label),
    [DEFAULT_COMPONENT_FOLDER, 'Footers', 'Cards', 'Navigation']
  );
});

test('moveComponentFolder moves a folder and keeps a hidden default position', () => {
  const keys = ['A', 'B', 'C'];
  assert.deepEqual(moveComponentFolder(keys, 'C', 'top'), ['C', 'A', 'B']);
  assert.deepEqual(moveComponentFolder(keys, 'B', 'up'), ['B', 'A', 'C']);
  assert.deepEqual(moveComponentFolder(keys, 'B', 'down'), ['A', 'C', 'B']);
  assert.deepEqual(moveComponentFolder(keys, 'A', 'bottom'), ['B', 'C', 'A']);
  assert.deepEqual(moveComponentFolder(keys, 'A', 'up'), keys);
  assert.deepEqual(
    moveComponentFolder(keys, 'C', 'top', ['A', DEFAULT_COMPONENT_FOLDER, 'B', 'C']),
    ['C', DEFAULT_COMPONENT_FOLDER, 'A', 'B']
  );
});

test('renameComponentFolderInOrder renames in place and merges into listed folders', () => {
  const order = ['A', DEFAULT_COMPONENT_FOLDER, 'B'];
  assert.deepEqual(renameComponentFolderInOrder(order, 'A', 'Z'), ['Z', DEFAULT_COMPONENT_FOLDER, 'B']);
  assert.deepEqual(renameComponentFolderInOrder(order, 'A', 'B'), [DEFAULT_COMPONENT_FOLDER, 'B']);
  assert.deepEqual(renameComponentFolderInOrder(order, 'B', null), ['A', DEFAULT_COMPONENT_FOLDER]);
  assert.deepEqual(renameComponentFolderInOrder(['A'], 'A', null), [DEFAULT_COMPONENT_FOLDER]);
  assert.equal(renameComponentFolderInOrder(order, 'Missing', 'Z'), order);
});
