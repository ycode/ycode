/**
 * Sitemap Utility Functions
 *
 * Generates sitemap XML for published pages with localization support
 */

import type {
  Page,
  PageFolder,
  Locale,
  Translation,
  SitemapSettings,
  SitemapChangeFrequency,
  CollectionItem,
} from '@/types';
import { buildSlugPath } from './page-utils';
import { buildPageHreflangAlternates } from './hreflang-utils';
import type { HreflangAlternate } from './hreflang-utils';
import { buildAbsolutePageUrl } from './url-utils';

export interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq?: SitemapChangeFrequency;
  alternates?: SitemapAlternate[];
}

export type SitemapAlternate = HreflangAlternate;

/**
 * Expand a page/item into one sitemap `<url>` per locale.
 *
 * Each locale gets its own `<loc>` (its localized URL) carrying the full
 * reciprocal hreflang cluster, matching Google's recommended per-URL format.
 * Single-locale sites (no alternates) yield a single default entry.
 */
function expandToPerLocaleSitemapUrls(
  defaultLoc: string,
  lastmod: string | undefined,
  changefreq: SitemapChangeFrequency | undefined,
  alternates: HreflangAlternate[]
): SitemapUrl[] {
  if (alternates.length === 0) {
    return [{ loc: defaultLoc, lastmod, changefreq }];
  }

  // One <url> per locale. x-default duplicates the default locale's href, so
  // skip it as a <loc> (it stays in the alternates cluster as a child link).
  return alternates
    .filter(alt => alt.hreflang !== 'x-default')
    .map(alt => ({ loc: alt.href, lastmod, changefreq, alternates }));
}

/**
 * Build sitemap URLs for a static page (non-dynamic)
 */
function buildStaticPageUrls(
  page: Page,
  folders: PageFolder[],
  baseUrl: string,
  settings: SitemapSettings,
  locales: Locale[],
  translationsByLocale: Map<string, Record<string, Translation>>
): SitemapUrl[] {
  // Always skip pages with noindex
  if (page.settings?.seo?.noindex) {
    return [];
  }

  // Skip error pages (401, 404, 500)
  if (page.error_page != null) {
    return [];
  }

  // Build the default (base) URL
  const defaultPath = buildSlugPath(page, folders, 'page');
  const defaultUrl = buildAbsolutePageUrl(baseUrl, defaultPath);

  // Full reciprocal hreflang cluster (empty for single-locale sites)
  const alternates = buildPageHreflangAlternates({
    page,
    folders,
    baseUrl,
    locales,
    translationsByLocale,
  });

  // Emit one <url> per locale so each localized page is listed directly
  return expandToPerLocaleSitemapUrls(
    defaultUrl,
    page.updated_at,
    settings.defaultChangeFrequency,
    alternates
  );
}

/**
 * Build sitemap URLs for a dynamic page with collection items
 */
function buildDynamicPageUrls(
  page: Page,
  folders: PageFolder[],
  baseUrl: string,
  settings: SitemapSettings,
  collectionItems: CollectionItem[],
  slugFieldId: string,
  itemValues: Map<string, Map<string, string>>, // itemId -> fieldId -> value
  locales: Locale[],
  translationsByLocale: Map<string, Record<string, Translation>>
): SitemapUrl[] {
  // Always skip error pages (401, 404, 500)
  if (page.error_page != null) {
    return [];
  }

  // Always skip pages with noindex
  if (page.settings?.seo?.noindex) {
    return [];
  }

  const urls: SitemapUrl[] = [];

  // Build folder path prefix (without the {slug} placeholder)
  const folderPath = buildSlugPath(page, folders, 'page', '').replace(/\/$/, '');

  for (const item of collectionItems) {
    // Get the slug value from item values
    const fieldValues = itemValues.get(item.id);
    const slugValue = fieldValues?.get(slugFieldId);

    if (!slugValue) continue;

    const itemPath = folderPath ? `${folderPath}/${slugValue}` : `/${slugValue}`;
    const itemUrl = buildAbsolutePageUrl(baseUrl, itemPath);

    // Full reciprocal hreflang cluster (empty for single-locale sites)
    const alternates = buildPageHreflangAlternates({
      page,
      folders,
      baseUrl,
      locales,
      translationsByLocale,
      dynamicSlug: { itemId: item.id, defaultValue: slugValue },
    });

    // Emit one <url> per locale so each localized item is listed directly
    urls.push(...expandToPerLocaleSitemapUrls(
      itemUrl,
      item.updated_at,
      settings.defaultChangeFrequency,
      alternates
    ));
  }

  return urls;
}

/**
 * Generate sitemap URLs from pages and collection data
 */
export function generateSitemapUrls(
  pages: Page[],
  folders: PageFolder[],
  baseUrl: string,
  settings: SitemapSettings,
  locales: Locale[],
  translationsByLocale: Map<string, Record<string, Translation>>,
  dynamicPageData: Map<string, {
    items: CollectionItem[];
    slugFieldId: string;
    itemValues: Map<string, Map<string, string>>;
  }>
): SitemapUrl[] {
  const urls: SitemapUrl[] = [];

  for (const page of pages) {
    if (page.is_dynamic && page.settings?.cms) {
      // Dynamic page - generate URLs for each collection item
      const data = dynamicPageData.get(page.id);
      if (data) {
        urls.push(...buildDynamicPageUrls(
          page,
          folders,
          baseUrl,
          settings,
          data.items,
          data.slugFieldId,
          data.itemValues,
          locales,
          translationsByLocale
        ));
      }
    } else {
      // Static page
      urls.push(...buildStaticPageUrls(
        page,
        folders,
        baseUrl,
        settings,
        locales,
        translationsByLocale
      ));
    }
  }

  return urls;
}

/**
 * Escape XML special characters
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Format date for sitemap (W3C Datetime format)
 */
function formatSitemapDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toISOString().split('T')[0];
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

/**
 * Generate XML sitemap from URLs
 */
export function generateSitemapXml(urls: SitemapUrl[]): string {
  const hasAlternates = urls.some(url => url.alternates && url.alternates.length > 0);

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';

  if (hasAlternates) {
    xml += '\n        xmlns:xhtml="http://www.w3.org/1999/xhtml"';
  }

  xml += '>\n';

  for (const url of urls) {
    xml += '  <url>\n';
    xml += `    <loc>${escapeXml(url.loc)}</loc>\n`;

    if (url.lastmod) {
      xml += `    <lastmod>${formatSitemapDate(url.lastmod)}</lastmod>\n`;
    }

    if (url.changefreq) {
      xml += `    <changefreq>${url.changefreq}</changefreq>\n`;
    }

    // Add xhtml:link elements for language alternates
    if (url.alternates && url.alternates.length > 0) {
      for (const alt of url.alternates) {
        xml += `    <xhtml:link rel="alternate" hreflang="${escapeXml(alt.hreflang)}" href="${escapeXml(alt.href)}" />\n`;
      }
    }

    xml += '  </url>\n';
  }

  xml += '</urlset>';

  return xml;
}

export { getDefaultSitemapSettings, normalizeSitemapSettings } from './sitemap-settings';
