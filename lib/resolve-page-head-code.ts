/**
 * Resolve a page's custom <head> HTML from the request pathname so the site
 * layout can inject it into the real document head.
 *
 * SERVER-ONLY: uses page-fetcher and CMS placeholder resolution.
 */

import 'server-only';

import { unstable_cache } from 'next/cache';
import { fetchErrorPage, fetchHomepage, fetchPageByPathForMetadata } from '@/lib/page-fetcher';
import { parsePathnameForPageHead } from '@/lib/page-head-path';
import { resolveCustomCodePlaceholders } from '@/lib/resolve-cms-variables';

import type { CollectionField, CollectionItemWithValues, Page } from '@/types';

async function resolveHeadFromPage(
  page: Page,
  isPublished: boolean,
  collectionItem?: CollectionItemWithValues,
  collectionFields?: CollectionField[]
): Promise<string> {
  const raw = page.settings?.custom_code?.head || '';
  if (!raw) {
    return '';
  }

  if (page.is_dynamic && collectionItem && collectionFields && collectionFields.length > 0) {
    return resolveCustomCodePlaceholders(raw, collectionItem, collectionFields, isPublished);
  }

  return raw;
}

async function loadPageHeadCode(
  slugPath: string,
  isPublished: boolean,
  errorCode: number | null
): Promise<string> {
  try {
    if (errorCode != null) {
      const data = await fetchErrorPage(errorCode, isPublished);
      return data?.page ? resolveHeadFromPage(data.page, isPublished, data.collectionItem, data.collectionFields) : '';
    }

    // Homepage lives at is_index, not an empty slug match.
    if (slugPath === '') {
      const data = await fetchHomepage(isPublished);
      return data?.page ? resolveHeadFromPage(data.page, isPublished) : '';
    }

    const data = await fetchPageByPathForMetadata(slugPath, isPublished);
    return data?.page
      ? resolveHeadFromPage(data.page, isPublished, data.collectionItem, data.collectionFields)
      : '';
  } catch (error) {
    console.error('[resolve-page-head-code] Failed to load page head code:', error);
    return '';
  }
}

/**
 * Load the custom head HTML for the page at `pathname`.
 * Published lookups are cached until publish; preview is always fresh.
 */
export async function resolvePageCustomHeadCode(pathname: string): Promise<string> {
  const { isPreview, errorCode, slugPath } = parsePathnameForPageHead(pathname);
  const isPublished = !isPreview;

  if (isPreview) {
    return loadPageHeadCode(slugPath, false, errorCode);
  }

  const cacheKey = errorCode != null
    ? `error-${errorCode}`
    : (slugPath || '/');
  const routeTag = errorCode != null
    ? 'all-pages'
    : `route-${cacheKey === '/' ? '/' : `/${cacheKey}`}`;

  return unstable_cache(
    () => loadPageHeadCode(slugPath, true, errorCode),
    ['page-head-html', cacheKey],
    { tags: [routeTag, 'all-pages'], revalidate: false }
  )();
}
