import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getArdManifestError, serializeArdManifest } from './ard-manifest';

test('getArdManifestError accepts empty content', () => {
  assert.equal(getArdManifestError(''), null);
  assert.equal(getArdManifestError('   '), null);
  assert.equal(getArdManifestError(null), null);
});

test('getArdManifestError accepts a manifest as a string or object', () => {
  assert.equal(getArdManifestError('{"entries":[]}'), null);
  assert.equal(getArdManifestError({ entries: [{ type: 'application/mcp-server-card+json' }] }), null);
});

test('getArdManifestError rejects invalid JSON and wrong shapes', () => {
  assert.match(getArdManifestError('{"entries":[') ?? '', /not valid JSON/);
  assert.match(getArdManifestError('[]') ?? '', /JSON object/);
  assert.match(getArdManifestError('{"items":[]}') ?? '', /"entries" array/);
});

test('serializeArdManifest serves strings as stored and stringifies objects', () => {
  assert.equal(serializeArdManifest('  {"entries":[]}\n'), '{"entries":[]}');
  assert.equal(serializeArdManifest({ entries: [] }), '{\n  "entries": []\n}');
  assert.equal(serializeArdManifest(''), null);
  assert.equal(serializeArdManifest(null), null);
});
