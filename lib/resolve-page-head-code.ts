/**
 * Resolve document-level page chrome (custom `<head>` HTML, body classes,
 * hreflang) from the request pathname so the site layout can bake them into
 * the SSR document without calling `headers()`.
 *
 * SERVER-ONLY: uses page-fetcher, page_layers, and CMS placeholder resolution.
 *
 * `tenantId` and `baseUrl` are supplied by the caller (the document layout):
 * cloud passes both from route params so this stays ISR-safe (no `headers()`),
 * self-hosted passes neither and falls back to deployment-wide data.
 */

import 'server-only';

import { unstable_cache } from '@/coursey/cache';
import { getBodyClasses } from '@/lib/body-classes';
import { buildAllPagesTag, buildRouteTag } from '@/lib/cache-tags';
import { shouldEmitHreflang } from '@/lib/document-seo-links';
import { buildPageHreflangAlternatesForPage } from '@/lib/generate-page-metadata';
import { fetchErrorPage, fetchHomepage, fetchPageByPathForMetadata } from '@/lib/page-fetcher';
import { parsePathnameForPageHead } from '@/lib/page-head-path';
import { getDraftLayers, getPublishedLayers } from '@/lib/repositories/pageLayersRepository';
import { resolveCustomCodePlaceholders } from '@/lib/resolve-cms-variables';
import { getSupabaseAdmin } from '@/lib/supabase-server';

import type { HreflangAlternate } from '@/lib/hreflang-utils';
import type { CollectionField, CollectionItemWithValues, Page } from '@/types';

export interface PageDocumentChrome {
  customHead: string;
  bodyClasses: string;
  hreflang: HreflangAlternate[];
}

export interface ResolvePageChromeOptions {
  /** Tenant to scope every fetch to. Omitted self-hosted. */
  tenantId?: string;
  /** Absolute site base URL for hreflang. Omitted when the site has none. */
  baseUrl?: string | null;
  /** Site base URL used to absolutize asset URLs in custom head code. */
  primaryDomainUrl?: string | null;
}

const EMPTY_CHROME: PageDocumentChrome = { customHead: '', bodyClasses: '', hreflang: [] };

async function resolveHeadFromPage(
  page: Page,
  isPublished: boolean,
  options: ResolvePageChromeOptions,
  collectionItem?: CollectionItemWithValues,
  collectionFields?: CollectionField[]
): Promise<string> {
  const raw = page.settings?.custom_code?.head || '';
  if (!raw) {
    return '';
  }

  if (page.is_dynamic && collectionItem && collectionFields && collectionFields.length > 0) {
    return resolveCustomCodePlaceholders(raw, collectionItem, collectionFields, isPublished, {
      tenantId: options.tenantId,
      primaryDomainUrl: options.primaryDomainUrl,
    });
  }

  return raw;
}

async function loadHreflangForPage(
  page: Page,
  collectionItem: CollectionItemWithValues | undefined,
  isPreview: boolean,
  baseUrl: string | null | undefined,
  tenantId?: string,
): Promise<HreflangAlternate[]> {
  if (!baseUrl || !shouldEmitHreflang(page, isPreview)) {
    return [];
  }

  try {
    return buildPageHreflangAlternatesForPage(page, baseUrl, collectionItem, tenantId);
  } catch (error) {
    console.error('[resolve-page-head-code] Failed to load hreflang:', error);
    return [];
  }
}

async function loadBodyClassesForPageId(
  pageId: string,
  isPublished: boolean,
  tenantId?: string,
): Promise<string> {
  try {
    const pageLayers = isPublished
      ? await getPublishedLayers(pageId, tenantId)
      : await getDraftLayers(pageId, tenantId);
    return getBodyClasses(pageLayers?.layers);
  } catch {
    return '';
  }
}

async function loadBodyClassesForErrorPage(
  errorCode: number,
  isPublished: boolean,
  tenantId?: string,
): Promise<string> {
  const client = await getSupabaseAdmin(tenantId);
  if (!client) {
    return '';
  }

  const { data: errorPage } = await client
    .from('pages')
    .select('id')
    .eq('error_page', errorCode)
    .eq('is_published', isPublished)
    .is('deleted_at', null)
    .maybeSingle();

  if (!errorPage) {
    return '';
  }

  return loadBodyClassesForPageId(errorPage.id, isPublished, tenantId);
}

async function loadPageDocumentChrome(
  slugPath: string,
  isPublished: boolean,
  errorCode: number | null,
  options: ResolvePageChromeOptions,
): Promise<PageDocumentChrome> {
  const { tenantId, baseUrl } = options;
  try {
    if (errorCode != null) {
      const data = await fetchErrorPage(errorCode, isPublished, tenantId);
      if (!data?.page) {
        return EMPTY_CHROME;
      }

      return {
        customHead: await resolveHeadFromPage(
          data.page,
          isPublished,
          options,
          data.collectionItem,
          data.collectionFields
        ),
        bodyClasses: getBodyClasses(data.pageLayers?.layers),
        hreflang: await loadHreflangForPage(data.page, data.collectionItem, !isPublished, baseUrl, tenantId),
      };
    }

    // Homepage lives at is_index, not an empty slug match.
    if (slugPath === '') {
      const data = await fetchHomepage(isPublished, undefined, undefined, tenantId);
      if (!data?.page) {
        return EMPTY_CHROME;
      }

      return {
        customHead: await resolveHeadFromPage(data.page, isPublished, options),
        bodyClasses: getBodyClasses(data.pageLayers?.layers),
        hreflang: await loadHreflangForPage(data.page, undefined, !isPublished, baseUrl, tenantId),
      };
    }

    const data = await fetchPageByPathForMetadata(slugPath, isPublished, undefined, tenantId);
    if (!data?.page) {
      // Unknown URL renders not-found inside this layout — use the custom 404
      // body classes so the error page's background is in the first HTML byte.
      return {
        customHead: '',
        bodyClasses: await loadBodyClassesForErrorPage(404, isPublished, tenantId),
        hreflang: [],
      };
    }

    const fromFetchedLayers = getBodyClasses(data.pageLayers?.layers);
    return {
      customHead: await resolveHeadFromPage(
        data.page,
        isPublished,
        options,
        data.collectionItem,
        data.collectionFields
      ),
      bodyClasses: fromFetchedLayers || await loadBodyClassesForPageId(data.page.id, isPublished, tenantId),
      hreflang: await loadHreflangForPage(data.page, data.collectionItem, !isPublished, baseUrl, tenantId),
    };
  } catch (error) {
    console.error('[resolve-page-head-code] Failed to load page document chrome:', error);
    return EMPTY_CHROME;
  }
}

/**
 * Load custom head HTML, body-layer classes, and hreflang for the page at
 * `pathname`. Published lookups are cached until publish; preview is always
 * fresh. Cache keys and tags are tenant-scoped when a tenantId is given.
 */
export async function resolvePageDocumentChrome(
  pathname: string,
  options: ResolvePageChromeOptions = {},
): Promise<PageDocumentChrome> {
  const { isPreview, errorCode, slugPath } = parsePathnameForPageHead(pathname);
  const isPublished = !isPreview;
  const { tenantId } = options;

  if (isPreview) {
    return loadPageDocumentChrome(slugPath, false, errorCode, options);
  }

  const cacheKey = errorCode != null ? `error-${errorCode}` : (slugPath || '/');
  const routeTag = errorCode != null
    ? buildAllPagesTag(tenantId)
    : buildRouteTag(tenantId, slugPath);

  return unstable_cache(
    () => loadPageDocumentChrome(slugPath, true, errorCode, options),
    ['page-document-chrome-v2', cacheKey, tenantId ?? 'default'],
    { tags: [routeTag, buildAllPagesTag(tenantId)], revalidate: false }
  )();
}

/**
 * Load the custom head HTML for the page at `pathname`.
 * Published lookups are cached until publish; preview is always fresh.
 */
export async function resolvePageCustomHeadCode(
  pathname: string,
  options: ResolvePageChromeOptions = {},
): Promise<string> {
  const { customHead } = await resolvePageDocumentChrome(pathname, options);
  return customHead;
}
