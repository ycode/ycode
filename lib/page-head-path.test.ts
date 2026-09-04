import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePathnameForPageHead } from '@/lib/page-head-path';

test('homepage is an empty slug path', () => {
  assert.deepEqual(parsePathnameForPageHead('/'), {
    isPreview: false,
    errorCode: null,
    slugPath: '',
  });
});

test('strips the leading slash from a published slug', () => {
  assert.deepEqual(parsePathnameForPageHead('/about/team'), {
    isPreview: false,
    errorCode: null,
    slugPath: 'about/team',
  });
});

test('preview homepage', () => {
  assert.deepEqual(parsePathnameForPageHead('/ycode/preview'), {
    isPreview: true,
    errorCode: null,
    slugPath: '',
  });
});

test('preview nested slug', () => {
  assert.deepEqual(parsePathnameForPageHead('/ycode/preview/about/team'), {
    isPreview: true,
    errorCode: null,
    slugPath: 'about/team',
  });
});

test('preview error page', () => {
  assert.deepEqual(parsePathnameForPageHead('/ycode/preview/error-pages/404'), {
    isPreview: true,
    errorCode: 404,
    slugPath: '',
  });
});
