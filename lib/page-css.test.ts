import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INLINE_PAGE_CSS_MAX_BYTES,
  getPageCssHash,
  getPageCssUrl,
  isPageCssHash,
  shouldLinkPageCss,
} from '@/lib/page-css';

const PAGE_ID = '074cae7d-ebce-415d-9053-009133dd28b4';

test('hashes are stable, 16 hex chars and change with the CSS', () => {
  const hash = getPageCssHash('.a{color:red}');

  assert.equal(hash, getPageCssHash('.a{color:red}'));
  assert.match(hash, /^[a-f0-9]{16}$/);
  assert.notEqual(hash, getPageCssHash('.a{color:blue}'));
});

test('recognises only well-formed hashes', () => {
  assert.equal(isPageCssHash(getPageCssHash('.a{}')), true);
  assert.equal(isPageCssHash('30f959ac16d1c3e'), false);
  assert.equal(isPageCssHash('30F959AC16D1C3E5'), false);
  assert.equal(isPageCssHash('../../etc/passwd'), false);
  assert.equal(isPageCssHash(''), false);
});

test('builds a content-addressed stylesheet URL', () => {
  const css = '.a{color:red}';

  assert.equal(
    getPageCssUrl(PAGE_ID, css),
    `/api/page-css/${PAGE_ID}/${getPageCssHash(css)}.css`,
  );
});

test('links only stylesheets above the inline limit', () => {
  assert.equal(shouldLinkPageCss('a'.repeat(INLINE_PAGE_CSS_MAX_BYTES)), false);
  assert.equal(shouldLinkPageCss('a'.repeat(INLINE_PAGE_CSS_MAX_BYTES + 1)), true);
});

test('measures the inline limit in bytes, not characters', () => {
  const multiByte = 'é'.repeat(INLINE_PAGE_CSS_MAX_BYTES / 2 + 1);

  assert.equal(multiByte.length < INLINE_PAGE_CSS_MAX_BYTES, true);
  assert.equal(shouldLinkPageCss(multiByte), true);
});
