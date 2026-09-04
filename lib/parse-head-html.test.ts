import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderRootLayoutHeadCode } from '@/lib/parse-head-html';

test('parses an inline script into a script element', () => {
  const elements = renderRootLayoutHeadCode('<script>\nTesting\n</script>', 'page-head');
  assert.equal(elements.length, 1);
  const el = elements[0] as React.ReactElement<{ dangerouslySetInnerHTML?: { __html: string } }>;
  assert.equal(el.type, 'script');
  assert.equal(el.props.dangerouslySetInnerHTML?.__html.trim(), 'Testing');
});

test('parses meta and link tags alongside a script', () => {
  const html = '<meta name="foo" content="bar"><link rel="preconnect" href="https://example.com"><script src="https://example.com/a.js"></script>';
  const elements = renderRootLayoutHeadCode(html, 'page-head');
  assert.equal(elements.length, 3);
  assert.equal((elements[0] as React.ReactElement).type, 'meta');
  assert.equal((elements[1] as React.ReactElement).type, 'link');
  assert.equal((elements[2] as React.ReactElement).type, 'script');
});
