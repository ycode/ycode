/**
 * Sitemap Settings
 *
 * Defaults and normalization for the `sitemap` setting. Kept free of other lib
 * imports so the settings repository can normalize on write.
 */

import type { SitemapChangeFrequency, SitemapMode, SitemapSettings } from '@/types';

const SITEMAP_MODES: readonly SitemapMode[] = ['none', 'auto', 'custom'];

const SITEMAP_CHANGE_FREQUENCIES: readonly SitemapChangeFrequency[] = [
  'always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never',
];

/**
 * Default sitemap settings (Ycode-generated sitemap enabled for new apps)
 */
export function getDefaultSitemapSettings(): SitemapSettings {
  return {
    mode: 'auto',
    includeImages: false,
    defaultChangeFrequency: 'weekly',
    customXml: '',
  };
}

function isSitemapMode(value: unknown): value is SitemapMode {
  return typeof value === 'string' && (SITEMAP_MODES as readonly string[]).includes(value);
}

function isSitemapChangeFrequency(value: unknown): value is SitemapChangeFrequency {
  return typeof value === 'string' && (SITEMAP_CHANGE_FREQUENCIES as readonly string[]).includes(value);
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === 'string') return parseJsonObject(parsed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Not JSON — fall through to defaults
  }
  return null;
}

/**
 * Spreading a JSON string into an object produces `{ "0": "{", "1": "\"", … }`.
 * Reassemble the string from its numeric keys and let the named keys (later
 * edits made on top of the broken value) win.
 */
function reassembleCharIndexedObject(value: Record<string, unknown>): Record<string, unknown> {
  const indexKeys = Object.keys(value).filter((key) => /^\d+$/.test(key));
  if (indexKeys.length === 0) return value;

  const json = indexKeys
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => (typeof value[key] === 'string' ? value[key] : ''))
    .join('');

  const named = Object.fromEntries(
    Object.entries(value).filter(([key]) => !/^\d+$/.test(key))
  );

  return { ...(parseJsonObject(json) ?? {}), ...named };
}

/**
 * Coerce any stored `sitemap` value into `SitemapSettings`.
 *
 * Handles JSON-encoded strings, character-indexed objects (a spread string),
 * and the legacy `{ enabled, changefreq, priority }` shape. Missing or invalid
 * fields fall back to the defaults.
 */
export function normalizeSitemapSettings(value: unknown): SitemapSettings {
  const defaults = getDefaultSitemapSettings();

  let raw: Record<string, unknown> | null = null;
  if (typeof value === 'string') {
    raw = parseJsonObject(value);
  } else if (value && typeof value === 'object' && !Array.isArray(value)) {
    raw = reassembleCharIndexedObject(value as Record<string, unknown>);
  }

  if (!raw) return defaults;

  let mode: SitemapMode = defaults.mode;
  if (isSitemapMode(raw.mode)) {
    mode = raw.mode;
  } else if (raw.enabled === false) {
    mode = 'none';
  }

  let defaultChangeFrequency = defaults.defaultChangeFrequency;
  if (isSitemapChangeFrequency(raw.defaultChangeFrequency)) {
    defaultChangeFrequency = raw.defaultChangeFrequency;
  } else if (isSitemapChangeFrequency(raw.changefreq)) {
    defaultChangeFrequency = raw.changefreq;
  }

  return {
    mode,
    includeImages: raw.includeImages === true,
    defaultChangeFrequency,
    customXml: typeof raw.customXml === 'string' ? raw.customXml : '',
  };
}

/**
 * True when the stored value already has the exact `SitemapSettings` shape.
 */
export function isNormalizedSitemapSettings(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const stored = value as Record<string, unknown>;
  const normalized = normalizeSitemapSettings(value) as unknown as Record<string, unknown>;
  const keys = Object.keys(stored);
  return keys.length === Object.keys(normalized).length
    && keys.every((key) => stored[key] === normalized[key]);
}
