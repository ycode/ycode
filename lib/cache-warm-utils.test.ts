import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCurrentWarmRun, orderRoutesForWarming } from '@/lib/cache-warm-utils';

test('warms the homepage first, then by path depth', () => {
  assert.deepEqual(
    orderRoutesForWarming(['blog/post-1', 'de/about', 'about', '', 'de', 'de/blog/post-1']),
    ['', 'about', 'de', 'blog/post-1', 'de/about', 'de/blog/post-1'],
  );
});

test('keeps the caller order within the same depth', () => {
  assert.deepEqual(
    orderRoutesForWarming(['pricing', 'about', 'blog/b', 'blog/a', 'fr/pricing']),
    ['pricing', 'about', 'blog/b', 'blog/a', 'fr/pricing'],
  );
});

test('does not modify the input', () => {
  const routes = ['a/b', ''];
  orderRoutesForWarming(routes);
  assert.deepEqual(routes, ['a/b', '']);
});

test('a hop of the stored run keeps warming', () => {
  assert.equal(isCurrentWarmRun('run-2', 'run-2'), true);
});

test('a hop of a replaced run stops', () => {
  assert.equal(isCurrentWarmRun('run-1', 'run-2'), false);
});

test('fails open without a run id or stored run', () => {
  assert.equal(isCurrentWarmRun(undefined, 'run-2'), true);
  assert.equal(isCurrentWarmRun('run-1', null), true);
  assert.equal(isCurrentWarmRun('run-1', ''), true);
});
