import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_COMPONENT_FOLDER,
  getComponentFolderNames,
  groupComponentsByFolder,
  normalizeComponentFolder,
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
