import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractComponentTranslatableItems,
  extractLayerContentMap,
  injectTranslatedText,
} from '@/lib/localisation-utils';

import type { Layer, Translation } from '@/types';

const nav = {
  id: 'nav',
  name: 'div',
  settings: { customAttributes: { 'aria-label': 'Main navigation', 'data-track': 'nav', Title: 'Menu' } },
} as unknown as Layer;

const translation = (sourceType: string, sourceId: string, contentKey: string, value: string) => ({
  [`${sourceType}:${sourceId}:${contentKey}`]: {
    source_type: sourceType,
    source_id: sourceId,
    content_key: contentKey,
    content_value: value,
    is_completed: true,
  },
});

test('lists only text custom attributes as translatable', () => {
  const contentMap = extractLayerContentMap([nav], 'page', 'page-1');

  assert.equal(contentMap['layer:nav:attribute:aria-label'], 'Main navigation');
  assert.equal(contentMap['layer:nav:attribute:Title'], 'Menu');
  assert.equal(contentMap['layer:nav:attribute:data-track'], undefined);
});

test('injects translated attribute values and keeps the others', () => {
  const translations = translation('page', 'page-1', 'layer:nav:attribute:aria-label', 'Navigation principale') as unknown as Record<string, Translation>;
  const [layer] = injectTranslatedText([nav], 'page-1', translations);

  assert.deepEqual(layer.settings?.customAttributes, {
    'aria-label': 'Navigation principale',
    'data-track': 'nav',
    Title: 'Menu',
  });
  assert.equal(nav.settings?.customAttributes?.['aria-label'], 'Main navigation');
});

test('translates attributes of component layers under the component scope', () => {
  const items = extractComponentTranslatableItems({ id: 'comp-1', name: 'Header' }, [nav]);
  assert.ok(items.some(item => item.key === 'component:comp-1:layer:nav:attribute:aria-label'));

  const translations = translation('component', 'comp-1', 'layer:nav:attribute:aria-label', 'Navigation principale') as unknown as Record<string, Translation>;
  const resolved = [{ ...nav, id: 'instance-nav', _originalLayerId: 'nav', _masterComponentId: 'comp-1' }] as unknown as Layer[];
  const [layer] = injectTranslatedText(resolved, 'page-1', translations);

  assert.equal(layer.settings?.customAttributes?.['aria-label'], 'Navigation principale');
});
