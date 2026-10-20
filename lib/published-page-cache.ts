import 'server-only';

import { unstable_cache } from '@/coursey/cache';
import { buildAllPagesTag, buildRouteTag } from '@/lib/cache-tags';
import { fetchErrorPage, fetchPageByPathForMetadata, slimPageData } from '@/lib/page-fetcher';
import type { PageData } from '@/lib/page-fetcher';

export type ErrorPageCode = 401 | 404;

/**
 * Cached lookup of the user's custom error page, invalidated on publish.
 * Shared by the 404 boundary, the page routes and their metadata so a single
 * cache entry serves all of them.
 */
export function fetchCachedErrorPage(
  errorCode: ErrorPageCode,
  tenantId?: string
): Promise<PageData | null> {
  return unstable_cache(
    async () => {
      const data = await fetchErrorPage(errorCode, true, tenantId);
      return data ? slimPageData(data) : null;
    },
    [`error-${errorCode}`, tenantId ?? ''],
    { tags: [buildAllPagesTag(tenantId)], revalidate: false }
  )();
}

/**
 * Cached metadata-only lookup of a published page (no layer resolution).
 * Shared by the published page route and its layout so both read one entry.
 */
export function fetchCachedPageForMetadata(
  slugPath: string,
  tenantId?: string
): Promise<PageData | null> {
  return unstable_cache(
    async () => fetchPageByPathForMetadata(slugPath, true, undefined, tenantId),
    [`metadata-/${slugPath}`, tenantId ?? ''],
    { tags: [buildRouteTag(tenantId, slugPath), buildAllPagesTag(tenantId)], revalidate: false }
  )();
}
