import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getDefaultSitemapSettings,
  isNormalizedSitemapSettings,
  normalizeSitemapSettings,
} from '@/lib/sitemap-settings';

function spreadString(value: string): Record<string, string> {
  return Object.fromEntries([...value].map((char, i) => [String(i), char]));
}

test('returns defaults for missing or unusable values', () => {
  for (const value of [null, undefined, '', 'not json', 42, true, []]) {
    assert.deepEqual(normalizeSitemapSettings(value), getDefaultSitemapSettings());
  }
});

test('keeps a standard value unchanged', () => {
  const value = { mode: 'custom', includeImages: true, defaultChangeFrequency: 'daily', customXml: '<urlset/>' };
  assert.deepEqual(normalizeSitemapSettings(value), value);
  assert.equal(isNormalizedSitemapSettings(value), true);
});

test('maps the legacy { enabled, changefreq, priority } shape', () => {
  assert.deepEqual(
    normalizeSitemapSettings({ enabled: true, changefreq: 'monthly', priority: 0.5 }),
    { mode: 'auto', includeImages: false, defaultChangeFrequency: 'monthly', customXml: '' },
  );
  assert.equal(normalizeSitemapSettings({ enabled: false, changefreq: 'weekly' }).mode, 'none');
});

test('prefers new keys over legacy keys when both are present', () => {
  assert.deepEqual(
    normalizeSitemapSettings({ enabled: false, changefreq: 'daily', mode: 'auto', defaultChangeFrequency: 'yearly' }),
    { mode: 'auto', includeImages: false, defaultChangeFrequency: 'yearly', customXml: '' },
  );
});

test('parses JSON-encoded strings, including double encoding', () => {
  const json = JSON.stringify({ mode: 'custom', customXml: '<urlset/>' });
  const expected = { mode: 'custom', includeImages: false, defaultChangeFrequency: 'weekly', customXml: '<urlset/>' };
  assert.deepEqual(normalizeSitemapSettings(json), expected);
  assert.deepEqual(normalizeSitemapSettings(JSON.stringify(json)), expected);
});

test('reassembles character-indexed objects and lets named keys win', () => {
  const broken = {
    ...spreadString(JSON.stringify({ mode: 'auto', defaultChangeFrequency: 'daily' })),
    mode: 'none',
  };
  assert.deepEqual(
    normalizeSitemapSettings(broken),
    { mode: 'none', includeImages: false, defaultChangeFrequency: 'daily', customXml: '' },
  );
});

test('drops invalid field values', () => {
  assert.deepEqual(
    normalizeSitemapSettings({ mode: 'sometimes', includeImages: 'yes', defaultChangeFrequency: 'often', customXml: 7 }),
    getDefaultSitemapSettings(),
  );
});

test('flags non-standard shapes as not normalized', () => {
  assert.equal(isNormalizedSitemapSettings({ enabled: true, changefreq: 'weekly', priority: 0.5 }), false);
  assert.equal(isNormalizedSitemapSettings({ ...getDefaultSitemapSettings(), priority: 0.5 }), false);
  assert.equal(isNormalizedSitemapSettings(JSON.stringify(getDefaultSitemapSettings())), false);
  assert.equal(isNormalizedSitemapSettings({ mode: 'auto' }), false);
});
