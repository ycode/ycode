import 'server-only';

import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { fetchHomepage, fetchPageByPath, reassemblePageData, splitPageData } from '@/lib/page-fetcher';
import type { PageData, PaginationContext } from '@/lib/page-fetcher';

/**
 * Fetch published page and layers data from database
 * Cached per slug and page for revalidation. React `cache` lets the page
 * render and the 404 boundary share one lookup per request.
 */
export const fetchPublishedPageWithLayers = cache(async (slugPath: string) => {
  // Tags are both 'route-/X' AND 'all-pages':
  // - route-/X lets selective invalidation purge just this page's data cache
  // - all-pages lets full invalidation (color variables, redirects, etc.)
  //   sweep every page's data cache in one invalidateByTag call.
  // Vercel's invalidateByTag is tag-precise — invalidating one route's tag
  // doesn't cascade to entries that only share 'all-pages'. (Next.js bug
  // #63509 would apply if we used revalidateTag for selective, but we route
  // exclusively through invalidateByTag on Vercel.)
  const tags = [`route-/${slugPath}`, 'all-pages'];
  const opts = { tags, revalidate: false as const };

  // `basePath` lets paginated collections server-render crawlable links to
  // page 2 (this route only ever renders page 1 — `p_*` params are rewritten
  // to the force-dynamic route by the proxy).
  const paginationContext: PaginationContext = { basePath: `/${slugPath}` };

  const [core, layers] = await Promise.all([
    unstable_cache(
      async () => {
        const data = await fetchPageByPath(slugPath, true, paginationContext);
        if (!data) return null;
        return splitPageData(data).core;
      },
      [`core-/${slugPath}`],
      opts
    )(),
    unstable_cache(
      async () => {
        const data = await fetchPageByPath(slugPath, true, paginationContext);
        if (!data) return null;
        return splitPageData(data).layers;
      },
      [`layers-/${slugPath}`],
      opts
    )(),
  ]);

  if (!core) return null;
  return reassemblePageData(core, layers || []);
});

export const fetchPublishedHomepage = cache(async () => {
  const tags = ['route-/', 'all-pages'];
  const opts = { tags, revalidate: false as const };
  const paginationContext: PaginationContext = { basePath: '/' };

  const [core, layers] = await Promise.all([
    unstable_cache(
      async () => {
        const data = await fetchHomepage(true, paginationContext);
        if (!data) return null;
        return splitPageData(data as PageData).core;
      },
      ['core-/'],
      opts
    )(),
    unstable_cache(
      async () => {
        const data = await fetchHomepage(true, paginationContext);
        if (!data) return null;
        return splitPageData(data as PageData).layers;
      },
      ['layers-/'],
      opts
    )(),
  ]);

  if (!core) return null;
  return reassemblePageData(core, layers || []);
});

const getPublishedRouteStore = cache((): { slugPath?: string } => ({}));

/**
 * Record which published route is being rendered (request-scoped). Called by
 * the published layout, whose children include the 404 boundary — a boundary
 * gets no route params of its own.
 */
export function setPublishedRoute(slugPath: string): void {
  getPublishedRouteStore().slugPath = slugPath;
}

/**
 * Whether the route being rendered resolves to a published page, i.e. the page
 * will not call `notFound()`. Uses the page's own lookup, so the two always
 * agree. Resolves to false whenever that is not certain, so the caller falls
 * back to rendering the 404.
 */
export async function isPublishedRouteFound(): Promise<boolean> {
  const { slugPath } = getPublishedRouteStore();
  if (slugPath === undefined) return false;

  // The homepage renders a welcome screen instead of a 404 when it has no content
  if (slugPath === '') return true;

  try {
    return (await fetchPublishedPageWithLayers(slugPath)) !== null;
  } catch {
    return false;
  }
}
