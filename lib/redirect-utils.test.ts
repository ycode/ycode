import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getChangedRedirectPaths, matchRedirect } from './redirect-utils';
import type { Redirect } from '../types';

const r = (id: string, oldUrl: string, newUrl: string, type?: '301' | '302'): Redirect => ({ id, oldUrl, newUrl, type });

test('getChangedRedirectPaths returns the source of an added redirect', () => {
  const before = [r('a', '/old', '/new')];
  const after = [...before, r('b', 'blog/x', '/blog/y')];
  assert.deepEqual(getChangedRedirectPaths(before, after), ['/blog/x']);
});

test('getChangedRedirectPaths returns removed and retargeted sources', () => {
  const before = [r('a', '/old', '/new'), r('b', '/gone', '/')];
  const after = [r('a', '/old', '/newer')];
  assert.deepEqual(getChangedRedirectPaths(before, after)?.sort(), ['/gone', '/old']);
});

test('getChangedRedirectPaths treats a type change as a change', () => {
  const before = [r('a', '/old', '/new')];
  const after = [r('a', '/old', '/new', '302')];
  assert.deepEqual(getChangedRedirectPaths(before, after), ['/old']);
});

test('getChangedRedirectPaths ignores renamed ids and shadowed duplicates', () => {
  const before = [r('a', '/old', '/new'), r('b', '/old', '/other')];
  const after = [r('c', '/old', '/new'), r('d', '/old', '/third')];
  assert.deepEqual(getChangedRedirectPaths(before, after), []);
});

test('getChangedRedirectPaths returns null when a pattern redirect changes', () => {
  const before = [r('a', '/blog/.*', '/news')];
  assert.equal(getChangedRedirectPaths(before, []), null);
  assert.equal(getChangedRedirectPaths([], [r('b', '/docs/(.+)', '/help/$1')]), null);
});

test('getChangedRedirectPaths keeps listing paths when patterns are unchanged', () => {
  const pattern = r('p', '/blog/.*', '/news');
  assert.deepEqual(getChangedRedirectPaths([pattern], [pattern, r('a', '/x', '/y')]), ['/x']);
});

test('getChangedRedirectPaths handles missing lists', () => {
  assert.deepEqual(getChangedRedirectPaths(null, [r('a', '/x', '/y')]), ['/x']);
  assert.deepEqual(getChangedRedirectPaths(undefined, null), []);
});

test('matchRedirect still prefers exact matches over patterns', () => {
  const redirects = [r('p', '/blog/.*', '/news'), r('a', 'blog/post', '/post')];
  assert.equal(matchRedirect('/blog/post', redirects)?.newUrl, '/post');
  assert.equal(matchRedirect('/blog/other', redirects)?.newUrl, '/news');
});
