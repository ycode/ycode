import { revalidateTag, revalidatePath } from 'next/cache';
import { invalidateByTag } from '@vercel/functions';
import { GLOBAL_SETTINGS_TAG } from '@/lib/cache-tags';
import { getSupabaseAdmin, getSupabaseConfig } from '@/lib/supabase-server';
import { buildSlugPath, normalizeSlugSegment } from '@/lib/page-utils';
import type { Page, PageFolder } from '@/types';
import type {
  ChangedLocale,
  ChangedTranslation,
  PublishLocalisationResult,
  SlugSnapshot,
} from '@/lib/services/localisationService';

/**
 * Number of routes warmed per function invocation. All routes in a batch are
 * fetched in parallel, so the batch wall-time is roughly one URL's render
 * time. Sized to comfortably finish inside the warm endpoint's maxDuration
 * (with 50 parallel 15s-timeout fetches fitting in a 60s budget).
 */
const WARM_BATCH_SIZE = 50;

/**
 * Overall safety cap on how many routes a single invalidation event will warm
 * across the whole self-chaining batch sequence. Warming is a best-effort
 * optimisation, not a correctness requirement — anything beyond this self-warms
 * on first real visit. The cap bounds runaway cost when a dynamic page expands
 * to thousands of CMS items. Configurable via CACHE_WARM_MAX_TOTAL.
 */
const MAX_ROUTES_TO_WARM_TOTAL = (() => {
  const raw = Number(process.env.CACHE_WARM_MAX_TOTAL);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 2000;
})();

type SupabaseAdmin = NonNullable<Awaited<ReturnType<typeof getSupabaseAdmin>>>;

const SUPABASE_IN_LIMIT = 500;

/**
 * Vercel's bulk cache-tag purge API accepts at most 16 tags per call
 * (https://vercel.com/docs/caching/cdn-cache/purge). Passing a larger array
 * gets rejected, so every tag beyond the cap would silently keep serving
 * stale content. Dynamic (CMS) pages make this trivial to hit: a single
 * dynamic page expands to one route per published item, so a component/style
 * change touching a dynamic template can produce dozens of routes in one
 * selective-invalidation pass. We chunk to stay under the cap.
 */
const MAX_TAGS_PER_INVALIDATION = 16;

/** Split an array into chunks safe for Supabase `.in()` queries. */
function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Purge a set of cache tags via Vercel's CDN purge API, chunked to respect the
 * 16-tags-per-call limit. Batches are settled independently so one failed batch
 * doesn't abort the rest; the first error is rethrown for the caller to handle.
 */
export async function purgeTagsOnVercel(tags: string[]): Promise<void> {
  if (tags.length === 0) return;
  const batches = chunk(tags, MAX_TAGS_PER_INVALIDATION);
  const results = await Promise.allSettled(batches.map((batch) => invalidateByTag(batch)));
  const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failure) throw failure.reason;
}

/**
 * Cache Invalidation Service
 *
 * Handles CDN cache invalidation for published pages using Next.js revalidation.
 * Supports both full-site invalidation and selective per-page invalidation.
 */

/**
 * Invalidate cache for a specific page by route path.
 *
 * On Vercel: uses invalidateByTag exclusively, which talks directly to Vercel's
 * CDN purge API and covers all three cache layers (CDN, Runtime, Data). We
 * deliberately avoid revalidateTag here because Next.js bug #63509 causes it
 * to cascade-invalidate other tags consumed by the page render, breaking
 * selective invalidation on Vercel.
 *
 * On self-hosted (no Vercel runtime): invalidateByTag no-ops, so we fall
 * back to revalidateTag to clear the in-process Next.js data cache.
 *
 * @param routePath - Route path (without leading slash for tag, with for path)
 */
export async function invalidatePage(routePath: string): Promise<boolean> {
  const tag = `route-/${routePath}`;
  try {
    if (process.env.VERCEL === '1') {
      await invalidateByTag(tag);
    } else {
      revalidateTag(tag, { expire: 0 });
    }
    return true;
  } catch (error) {
    console.error('❌ [Cache] Invalidation error:', error);
    return false;
  }
}

/**
 * Invalidate cache for multiple pages.
 * Uses Vercel's batched invalidateByTag on Vercel, revalidateTag elsewhere.
 *
 * @param routePaths - Array of route paths
 */
export async function invalidatePages(routePaths: string[]): Promise<boolean> {
  if (routePaths.length === 0) return true;
  try {
    const tags = routePaths.map((p) => `route-/${p}`);
    if (process.env.VERCEL === '1') {
      // Chunked to respect Vercel's 16-tags-per-purge cap — without this,
      // routes beyond the first 16 (common when a dynamic CMS page expands to
      // many item URLs) would never be invalidated and keep serving stale HTML.
      await purgeTagsOnVercel(tags);
    } else {
      for (const tag of tags) {
        revalidateTag(tag, { expire: 0 });
      }
    }
    return true;
  } catch (error) {
    console.error('❌ [Cache] Invalidation error:', error);
    return false;
  }
}

/**
 * Clear all cache (full site invalidation)
 * Invalidates the root layout which cascades to all pages
 */
export async function clearAllCache(): Promise<void> {
  if(process.env.COURSEY_PLATFORM === 'true') return;
  try {
    if (process.env.VERCEL === '1') {
      // Vercel: direct CDN purge by the 'all-pages' tag set on every page
      // response. Covers CDN, Runtime, and Data caches in one call. Avoids
      // revalidateTag's cascade bug (#63509).
      await invalidateByTag('all-pages');
    } else {
      // Self-hosted: clear Next.js's in-process caches.
      revalidateTag('all-pages', { expire: 0 });
      revalidatePath('/', 'layout');
    }
  } catch (error) {
    console.error('❌ [Cache] Clear all error:', error);
    throw new Error('Failed to clear all cache');
  }
}

/**
 * Resolve published page IDs to their route paths (for cache invalidation).
 * Returns all URL paths each page can be reached at, including locale variants.
 *
 * For dynamic pages, enumerates actual collection item slugs rather than
 * returning a {slug} placeholder (which would never match a real cache tag).
 */
export async function getRoutePathsForPages(pageIds: string[]): Promise<string[]> {
  if (pageIds.length === 0) return [];

  const client = await getSupabaseAdmin();
  if (!client) return [];

  const [
    { data: pages },
    { data: folders },
    { data: locales },
    { data: translations },
  ] = await Promise.all([
    client.from('pages').select('*').in('id', pageIds).eq('is_published', true).is('deleted_at', null),
    client.from('page_folders').select('*').eq('is_published', true).is('deleted_at', null),
    client.from('locales').select('*').is('deleted_at', null),
    client.from('translations').select('*').eq('is_published', true).is('deleted_at', null),
  ]);

  if (!pages || !folders) return [];

  const routePaths: string[] = [];
  const dynamicPages: Page[] = [];

  // Build translations lookup
  const translationsMap: Record<string, Record<string, string>> = {};
  if (translations) {
    for (const t of translations) {
      if (!translationsMap[t.locale_id]) translationsMap[t.locale_id] = {};
      const key = `${t.source_type}:${t.source_id}:${t.content_key}`;
      translationsMap[t.locale_id][key] = t.content_value;
    }
  }

  for (const page of pages as Page[]) {
    if (page.is_dynamic) {
      dynamicPages.push(page);
      continue;
    }

    // Default locale path
    const defaultPath = buildSlugPath(page, folders as PageFolder[], 'page');
    const trimmed = defaultPath.slice(1); // Remove leading "/"

    if (page.is_index && page.page_folder_id === null) {
      routePaths.push('');
    } else if (trimmed) {
      routePaths.push(trimmed);
    }

    // Locale variant paths
    if (locales) {
      for (const locale of locales) {
        if (locale.is_default) continue;
        const localeTranslations = translationsMap[locale.id] || {};

        const slugParts: string[] = [locale.code];

        let currentFolderId = page.page_folder_id;
        const folderSegments: string[] = [];
        while (currentFolderId) {
          const folder = (folders as PageFolder[]).find(f => f.id === currentFolderId);
          if (!folder) break;
          const tKey = `folder:${folder.id}:slug`;
          folderSegments.unshift(localeTranslations[tKey] || folder.slug);
          currentFolderId = folder.page_folder_id;
        }
        slugParts.push(...folderSegments);

        if (!page.is_index && page.slug) {
          const pageKey = `page:${page.id}:slug`;
          slugParts.push(localeTranslations[pageKey] || page.slug);
        }

        const localePath = slugParts.map(normalizeSlugSegment).filter(Boolean).join('/');
        if (localePath) routePaths.push(localePath);
      }
    }
  }

  // Resolve actual URLs for dynamic pages by enumerating collection item slugs
  if (dynamicPages.length > 0) {
    const dynamicRoutes = await resolveDynamicPageRoutes(
      client, dynamicPages, folders as PageFolder[], locales || [], translationsMap,
    );
    routePaths.push(...dynamicRoutes);
  }

  return [...new Set(routePaths)];
}

/**
 * Enumerate all published instance URLs for dynamic (CMS-driven) pages.
 * Each dynamic page is bound to a collection; we look up the slug field
 * values of published items to build the real URL paths.
 */
async function resolveDynamicPageRoutes(
  client: SupabaseAdmin,
  dynamicPages: Page[],
  folders: PageFolder[],
  locales: Array<{ id: string; code: string; is_default: boolean }>,
  translationsMap: Record<string, Record<string, string>>,
): Promise<string[]> {
  const routes: string[] = [];

  for (const page of dynamicPages) {
    const collectionId = (page.settings as any)?.cms?.collection_id;
    if (!collectionId) continue;

    const { data: slugField } = await client
      .from('collection_fields')
      .select('id')
      .eq('collection_id', collectionId)
      .eq('key', 'slug')
      .is('deleted_at', null)
      .limit(1)
      .single();

    if (!slugField) continue;

    const { data: items } = await client
      .from('collection_items')
      .select('id')
      .eq('collection_id', collectionId)
      .eq('is_published', true)
      .is('deleted_at', null);

    if (!items || items.length === 0) continue;

    const itemIds = items.map(i => i.id);
    const slugValues: Array<{ item_id: string; value: unknown }> = [];
    for (const idChunk of chunk(itemIds, SUPABASE_IN_LIMIT)) {
      const { data } = await client
        .from('collection_item_values')
        .select('item_id, value')
        .eq('field_id', slugField.id)
        .eq('is_published', true)
        .is('deleted_at', null)
        .in('item_id', idChunk);
      if (data) slugValues.push(...data);
    }

    if (slugValues.length === 0) continue;

    // Folder base path (everything before the {slug} segment)
    const basePath = buildSlugPath(page, folders, 'page', '').slice(1).replace(/\/$/, '');

    for (const sv of slugValues) {
      if (!sv.value) continue;
      const itemSlug = sv.value as string;
      const fullPath = basePath ? `${basePath}/${itemSlug}` : itemSlug;
      routes.push(fullPath);

      // Locale variant paths for each item
      for (const locale of locales) {
        if (locale.is_default) continue;
        const lt = translationsMap[locale.id] || {};

        const slugParts: string[] = [locale.code];
        let currentFolderId = page.page_folder_id;
        const folderSegments: string[] = [];
        while (currentFolderId) {
          const folder = folders.find(f => f.id === currentFolderId);
          if (!folder) break;
          folderSegments.unshift(lt[`folder:${folder.id}:slug`] || folder.slug);
          currentFolderId = folder.page_folder_id;
        }
        slugParts.push(...folderSegments);
        // Use the item's translated slug for this locale (the actual localized
        // URL); fall back to the default slug when no translation exists.
        slugParts.push(lt[`cms:${sv.item_id}:field:key:slug`] || itemSlug);

        const localePath = slugParts.map(normalizeSlugSegment).filter(Boolean).join('/');
        if (localePath) routes.push(localePath);
      }
    }
  }

  return routes;
}

/**
 * Build route paths for deleted CMS items from their old slug values.
 * Maps each collection's deleted slugs to the dynamic pages that use that
 * collection, constructing the full URL paths that should be invalidated.
 *
 * @param deletedSlugs - Map of collectionId → array of deleted item slug values
 */
export async function getRoutePathsForDeletedCollectionItems(
  deletedSlugs: Map<string, string[]>,
): Promise<string[]> {
  if (deletedSlugs.size === 0) return [];

  const client = await getSupabaseAdmin();
  if (!client) return [];

  const routes: string[] = [];

  const [
    { data: dynamicPages },
    { data: folders },
    { data: locales },
    { data: translations },
  ] = await Promise.all([
    client.from('pages').select('*').eq('is_published', true).eq('is_dynamic', true).is('deleted_at', null),
    client.from('page_folders').select('*').eq('is_published', true).is('deleted_at', null),
    client.from('locales').select('*').is('deleted_at', null),
    client.from('translations')
      .select('locale_id, source_type, source_id, content_key, content_value')
      .eq('is_published', true).is('deleted_at', null)
      .in('content_key', ['slug', 'field:key:slug']),
  ]);

  if (!dynamicPages || !folders) return [];

  // Build translations lookup: locale_id → "type:source:key" → value
  const translationsMap: Record<string, Record<string, string>> = {};
  for (const t of translations || []) {
    if (!translationsMap[t.locale_id]) translationsMap[t.locale_id] = {};
    translationsMap[t.locale_id][`${t.source_type}:${t.source_id}:${t.content_key}`] = t.content_value;
  }

  // Translated slugs are keyed by item id, but callers only pass default slug
  // values. Map each old slug back to its item id (draft rows survive unpublish,
  // so they still resolve) to look up per-locale translated slugs.
  const slugToItemIdByCollection = new Map<string, Map<string, string>>();
  for (const [collectionId, slugs] of deletedSlugs) {
    if (!slugs || slugs.length === 0) continue;
    const { data: slugField } = await client
      .from('collection_fields')
      .select('id')
      .eq('collection_id', collectionId)
      .eq('key', 'slug')
      .is('deleted_at', null)
      .limit(1)
      .single();
    if (!slugField) continue;
    const { data: values } = await client
      .from('collection_item_values')
      .select('item_id, value')
      .eq('field_id', slugField.id)
      .is('deleted_at', null)
      .in('value', slugs);
    const map = new Map<string, string>();
    for (const v of values || []) {
      if (typeof v.value === 'string') map.set(v.value, v.item_id);
    }
    slugToItemIdByCollection.set(collectionId, map);
  }

  for (const page of dynamicPages as Page[]) {
    const collectionId = (page.settings as any)?.cms?.collection_id;
    if (!collectionId) continue;

    const slugs = deletedSlugs.get(collectionId);
    if (!slugs || slugs.length === 0) continue;

    const slugToItemId = slugToItemIdByCollection.get(collectionId) || new Map<string, string>();
    const basePath = buildSlugPath(page, folders as PageFolder[], 'page', '').slice(1).replace(/\/$/, '');

    for (const itemSlug of slugs) {
      const fullPath = basePath ? `${basePath}/${itemSlug}` : itemSlug;
      routes.push(fullPath);

      const itemId = slugToItemId.get(itemSlug);

      // Locale-prefixed paths with translated folder + item slugs
      if (locales) {
        for (const locale of locales) {
          if (locale.is_default) continue;
          const lt = translationsMap[locale.id] || {};
          const slugParts: string[] = [locale.code];
          let currentFolderId = page.page_folder_id;
          const folderSegments: string[] = [];
          while (currentFolderId) {
            const folder = (folders as PageFolder[]).find(f => f.id === currentFolderId);
            if (!folder) break;
            folderSegments.unshift(lt[`folder:${folder.id}:slug`] || folder.slug);
            currentFolderId = folder.page_folder_id;
          }
          slugParts.push(...folderSegments);
          const translatedSlug = itemId ? lt[`cms:${itemId}:field:key:slug`] : undefined;
          slugParts.push(translatedSlug || itemSlug);
          const localePath = slugParts.map(normalizeSlugSegment).filter(Boolean).join('/');
          if (localePath) routes.push(localePath);
        }
      }
    }
  }

  return [...new Set(routes)];
}

/**
 * Invalidate cache for pages affected by a change to a single CMS collection.
 *
 * Used by external integrations that mutate published collection items without
 * going through the builder's publish flow (v1 REST API, Webflow sync, etc.).
 *
 * Covers two kinds of dependents:
 *   - Pages that render a collection-list/collection-grid block of this collection.
 *   - The dynamic page bound to this collection (one URL per published item).
 *
 * For deletes and slug renames, pass the pre-mutation slug(s) in `removedSlugs`
 * so we can invalidate the old URL — once the item is soft-deleted or renamed,
 * `getRoutePathsForPages` no longer enumerates it, and the CDN would keep
 * serving the deleted/old content as a 200.
 */
export async function invalidateForCollectionChange(
  collectionId: string,
  options: { removedSlugs?: string[] } = {},
): Promise<{ invalidatedRoutes: string[] }> {
  const { findAffectedPages } = await import('@/lib/repositories/pageLayersRepository');

  const affected = await findAffectedPages([], [], [collectionId]);
  const pageIds = affected.collectionPageIds;

  const liveRoutes = pageIds.length > 0 ? await getRoutePathsForPages(pageIds) : [];

  const removedRoutes = (options.removedSlugs && options.removedSlugs.length > 0)
    ? await getRoutePathsForDeletedCollectionItems(new Map([[collectionId, options.removedSlugs]]))
    : [];

  const routes = [...new Set([...liveRoutes, ...removedRoutes])];

  if (routes.length > 0) {
    await invalidatePages(routes);
  }

  return { invalidatedRoutes: routes };
}

export interface SelectiveInvalidationResult {
  strategy: 'selective' | 'full';
  invalidatedRoutes: string[];
  reason?: string;
}

/**
 * Returns true if any of the given page IDs is a published error page
 * (404/401, etc.). Error pages carry an `error_page` code instead of a slug.
 */
async function hasErrorPage(pageIds: string[]): Promise<boolean> {
  if (pageIds.length === 0) return false;

  const client = await getSupabaseAdmin();
  if (!client) return false;

  for (const ids of chunk(pageIds, SUPABASE_IN_LIMIT)) {
    const { data } = await client
      .from('pages')
      .select('id')
      .in('id', ids)
      .eq('is_published', true)
      .not('error_page', 'is', null)
      .is('deleted_at', null)
      .limit(1);

    if (data && data.length > 0) return true;
  }

  return false;
}

/**
 * Perform selective cache invalidation based on what actually changed.
 *
 * Receives the exact page IDs that were modified during publish (content_hash
 * changed, new page, or folder moved) — no guessing via timestamps.
 * Falls back to full invalidation when global resources changed.
 *
 * @param changedPageIds - Page IDs that actually changed during publish (from publishPages)
 * @param globalChanged - Whether global resources changed (triggers full nuke)
 * @param indirectlyAffectedPageIds - Page IDs affected by component, style, or collection changes
 */
export async function selectiveInvalidation(
  changedPageIds: string[],
  globalChanged: boolean,
  indirectlyAffectedPageIds: string[] = [],
): Promise<SelectiveInvalidationResult> {
  if (globalChanged) {
    await clearAllCache();
    return { strategy: 'full', invalidatedRoutes: [], reason: 'global resources changed' };
  }

  // The global-settings entry carries `published_at`, which changes on every
  // publish. Route purges alone leave it stale, so whatever re-renders after
  // this call (changed pages, locale routes, deleted-page fallbacks) would
  // read the previous publish's settings. Cheap: one tag, one call.
  await invalidateGlobalSettings();

  const allAffectedIds = [...new Set([...changedPageIds, ...indirectlyAffectedPageIds])];

  if (allAffectedIds.length === 0) {
    return { strategy: 'selective', invalidatedRoutes: [], reason: 'no pages changed' };
  }

  // Error pages (401/404) have empty slugs, so they resolve to no route and
  // can't be selectively invalidated. They're also embedded into other routes
  // (the 401 page renders inside every password-protected page; the 404 page
  // renders on unmatched URLs) and served via the `all-pages`-tagged
  // `error-<code>` data cache. A selective route purge would never refresh
  // them, so escalate to a full invalidation when an error page changed.
  if (await hasErrorPage(allAffectedIds)) {
    await clearAllCache();
    return { strategy: 'full', invalidatedRoutes: [], reason: 'error page changed' };
  }

  const routePaths = await getRoutePathsForPages(allAffectedIds);

  if (routePaths.length > 0) {
    await invalidatePages(routePaths);
  }

  return { strategy: 'selective', invalidatedRoutes: routePaths };
}

/**
 * Drop the cached global settings (published_at, custom code, favicon…) so
 * the next page render re-reads them. Covered implicitly by clearAllCache.
 */
export async function invalidateGlobalSettings(): Promise<boolean> {
  try {
    if (process.env.VERCEL === '1') {
      await invalidateByTag(GLOBAL_SETTINGS_TAG);
    } else {
      revalidateTag(GLOBAL_SETTINGS_TAG, { expire: 0 });
    }
    return true;
  } catch (error) {
    console.error('❌ [Cache] Global settings invalidation error:', error);
    return false;
  }
}

/**
 * Resolve every URL the public site currently serves from published pages.
 * Includes static pages, locale variants, and every dynamic-page instance
 * (one URL per published CMS item).
 *
 * Used to warm the cache after a full invalidation so the first real
 * visitor doesn't pay the cold-cache cost.
 */
export async function getAllPublishedRoutes(): Promise<string[]> {
  const client = await getSupabaseAdmin();
  if (!client) return [];

  const { data: pages } = await client
    .from('pages')
    .select('id')
    .eq('is_published', true)
    .is('deleted_at', null);

  if (!pages || pages.length === 0) return [];

  return getRoutePathsForPages(pages.map((p) => p.id));
}

/** Build the absolute origin (`https://host`) from forwarded request headers. */
function resolveBaseUrl(request: Request): string | null {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!host) return null;
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';
  return `${proto}://${host}`;
}

/**
 * Keep only safe, same-origin relative routes. Guards the chain endpoint (which
 * takes routes from a request body) against absolute URLs or protocol-relative
 * paths that would point warming fetches off-origin.
 */
function sanitiseWarmRoutes(routes: unknown): string[] {
  if (!Array.isArray(routes)) return [];
  return routes.filter(
    (r): r is string =>
      typeof r === 'string' &&
      r.length > 0 &&
      !r.includes('://') &&
      !r.startsWith('/') &&
      !r.startsWith('\\'),
  );
}

/** Fetch a batch of routes in parallel, swallowing per-route failures. */
async function warmBatch(routes: string[], baseUrl: string): Promise<void> {
  await Promise.allSettled(
    routes.map((route) =>
      fetch(`${baseUrl}/${route}`, {
        signal: AbortSignal.timeout(15000),
      }).catch(() => null),
    ),
  );
}

// ── Internal chain authentication ────────────────────────────────────────
// The warm endpoint issues GETs to same-origin paths, so it must not be an
// open amplification endpoint. Rather than make self-hosters configure a
// dedicated secret, we sign each chain hop with an HMAC keyed on the Supabase
// service-role key — a credential every deployment already has, that is
// server-only and never sent to the browser. The raw key is never
// transmitted; only the per-payload signature travels over the wire.

const WARM_SIGNATURE_HEADER = 'x-warm-signature';

/** The HMAC key for chain auth: the service-role key the app already requires. */
async function getChainSigningKey(): Promise<string | null> {
  try {
    const creds = await getSupabaseConfig();
    return creds?.serviceRoleKey ?? null;
  } catch {
    return null;
  }
}

/** HMAC-SHA256 of `message` keyed by `key`, hex-encoded. Web Crypto = runtime-agnostic. */
async function hmacHex(message: string, key: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Length-safe constant-time-ish comparison of two hex strings. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify a warm-chain request actually came from this deployment by checking
 * the HMAC signature against the raw request body. Exported for the endpoint.
 */
export async function verifyWarmChainSignature(
  rawBody: string,
  signature: string | null,
): Promise<boolean> {
  if (!signature) return false;
  const key = await getChainSigningKey();
  if (!key) return false;
  return safeEqual(await hmacHex(rawBody, key), signature);
}

/**
 * Fire-and-forget trigger for the next link in the warming chain. Hits the
 * dedicated warm endpoint, which warms a fresh batch in its own function
 * invocation (sidestepping the triggering function's lifetime limit) and
 * chains onward until the route list is drained or the overall cap is hit.
 *
 * Signs the payload with the service-role-derived HMAC; if no signing key is
 * available the chain simply stops and remaining routes self-warm on first
 * visit. No user-configured secret required.
 */
async function scheduleWarmChain(
  baseUrl: string,
  routes: string[],
  alreadyWarmed: number,
): Promise<void> {
  if (routes.length === 0) return;
  const key = await getChainSigningKey();
  if (!key) return;

  const body = JSON.stringify({ routes, warmed: alreadyWarmed });
  const signature = await hmacHex(body, key);
  await fetch(`${baseUrl}/ycode/api/cache/warm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [WARM_SIGNATURE_HEADER]: signature },
    body,
    // The endpoint returns as soon as it has scheduled its own background
    // work, so this resolves fast — the timeout only guards a stuck connect.
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
}

/**
 * Warm a batch of routes in the background, then chain to a fresh invocation
 * for the next batch until every route is warmed or MAX_ROUTES_TO_WARM_TOTAL
 * is reached. Shared by the initial `warmRoutes` call and the self-chaining
 * `/ycode/api/cache/warm` endpoint.
 *
 * @param alreadyWarmed routes warmed by earlier links in this chain, used to
 *   enforce the cumulative overall cap.
 * @returns how many routes this link scheduled, and how many remain queued for
 *   the next link.
 */
export async function warmRouteChain(
  routes: string[],
  alreadyWarmed: number,
  request: Request,
): Promise<{ scheduled: number; remaining: number }> {
  if (process.env.VERCEL !== '1') return { scheduled: 0, remaining: 0 };

  const safeRoutes = sanitiseWarmRoutes(routes);
  if (safeRoutes.length === 0) return { scheduled: 0, remaining: 0 };

  const baseUrl = resolveBaseUrl(request);
  if (!baseUrl) return { scheduled: 0, remaining: 0 };

  // Enforce the overall cap using the cumulative counter carried through the
  // chain, so a long route list can't exceed the budget across invocations.
  const budget = Math.max(0, MAX_ROUTES_TO_WARM_TOTAL - alreadyWarmed);
  if (budget === 0) return { scheduled: 0, remaining: safeRoutes.length };

  const allowed = safeRoutes.slice(0, budget);
  const batch = allowed.slice(0, WARM_BATCH_SIZE);
  const remaining = allowed.slice(WARM_BATCH_SIZE);

  try {
    const { waitUntil } = await import('@vercel/functions');
    waitUntil(
      (async () => {
        await warmBatch(batch, baseUrl);
        if (remaining.length > 0) {
          await scheduleWarmChain(baseUrl, remaining, alreadyWarmed + batch.length);
        }
      })(),
    );
    return { scheduled: batch.length, remaining: remaining.length };
  } catch {
    return { scheduled: 0, remaining: safeRoutes.length };
  }
}

/**
 * Background-warm a set of routes by issuing GET requests to them, so the
 * next real visitor sees x-vercel-cache: HIT instead of STALE/MISS.
 *
 * Uses Vercel's waitUntil so warming runs AFTER the response is sent: zero
 * added latency on the triggering request. Warms the first batch here and
 * self-chains through `/ycode/api/cache/warm` for the rest, draining the
 * whole list up to MAX_ROUTES_TO_WARM_TOTAL — anything beyond that self-warms
 * on first real visit.
 *
 * Vercel-only: warming via internal fetch only makes sense when there's a
 * CDN in front of the function. No-ops elsewhere.
 *
 * @returns null if not on Vercel, no host header, no routes, or warming
 *   failed to schedule. Otherwise reports how many will be warmed (across the
 *   whole chain) vs the total requested.
 */
export async function warmRoutes(
  routes: string[],
  request: Request,
): Promise<{ warmed: number; total: number } | null> {
  if (process.env.COURSEY_PLATFORM === 'true' || process.env.VERCEL !== '1' || routes.length === 0) return null;

  const total = routes.length;
  const result = await warmRouteChain(routes, 0, request);
  if (result.scheduled === 0 && result.remaining === 0) return null;

  // scheduled = this batch; remaining = what the chain will drain next. The
  // chain is capped at MAX_ROUTES_TO_WARM_TOTAL, so report the capped total.
  const willWarm = Math.min(total, MAX_ROUTES_TO_WARM_TOTAL);
  return { warmed: willWarm, total };
}

// ══════════════════════════════════════════════════════════════════════════
// Localisation-aware invalidation
// ══════════════════════════════════════════════════════════════════════════
//
// Translation and locale changes don't update page/component `content_hash`
// — they live in their own table. Without targeted invalidation here, the
// CDN keeps serving the old translation forever.
//
// We compute exactly which locale-prefixed URLs each change affects, so we
// invalidate only those routes instead of nuking the entire site. The
// `slugSnapshot` captured before the upsert in `publishLocalisation` lets
// us reconstruct the OLD URL for slug renames so the orphan is purged.

export interface LocalisationInvalidationResult {
  newRoutes: string[];      // Live URLs to invalidate AND warm
  oldRoutes: string[];      // Orphaned URLs to invalidate (don't warm)
  needsFullInvalidation: boolean; // is_default flip — too far-reaching for selective
  reason?: string;
}

interface CurrentLocalisationState {
  pagesById: Map<string, Page>;
  pages: Page[];
  folders: PageFolder[];
  localesById: Map<string, { id: string; code: string; is_default: boolean }>;
  currentFolderSlugs: Map<string, Map<string, string>>; // locale_id → folder_id → slug
  currentPageSlugs: Map<string, Map<string, string>>;   // locale_id → page_id → slug
  currentCmsSlugs: Map<string, Map<string, string>>;    // locale_id → item_id → slug
  itemSlugByItemId: Map<string, string>;                // default-locale slug for each CMS item
  itemCollectionByItemId: Map<string, string>;          // item_id → collection_id
  dynamicPageByCollectionId: Map<string, Page>;
  collectionItemsByCollectionId: Map<string, string[]>;
}

/** Read everything we need to construct locale URLs (post-upsert state). */
async function loadCurrentLocalisationState(): Promise<CurrentLocalisationState | null> {
  const client = await getSupabaseAdmin();
  if (!client) return null;

  const [
    { data: pages },
    { data: folders },
    { data: locales },
    { data: translations },
    { data: collectionItems },
    { data: collectionFields },
    { data: collectionItemValues },
  ] = await Promise.all([
    client.from('pages').select('*').eq('is_published', true).is('deleted_at', null),
    client.from('page_folders').select('*').eq('is_published', true).is('deleted_at', null),
    client.from('locales').select('*').eq('is_published', true).is('deleted_at', null),
    client.from('translations').select('locale_id, source_type, source_id, content_key, content_value')
      .eq('is_published', true).is('deleted_at', null)
      .in('content_key', ['slug', 'field:key:slug']),
    client.from('collection_items').select('id, collection_id').eq('is_published', true).is('deleted_at', null),
    client.from('collection_fields').select('id, collection_id, key').eq('key', 'slug').is('deleted_at', null),
    client.from('collection_item_values').select('item_id, field_id, value').eq('is_published', true).is('deleted_at', null),
  ]);

  if (!pages || !folders) return null;

  const pagesById = new Map<string, Page>();
  for (const p of pages as Page[]) pagesById.set(p.id, p);

  const localesById = new Map<string, { id: string; code: string; is_default: boolean }>();
  for (const l of locales || []) localesById.set(l.id, { id: l.id, code: l.code, is_default: l.is_default });

  const currentFolderSlugs = new Map<string, Map<string, string>>();
  const currentPageSlugs = new Map<string, Map<string, string>>();
  const currentCmsSlugs = new Map<string, Map<string, string>>();
  for (const t of translations || []) {
    const target = t.source_type === 'folder' && t.content_key === 'slug'
      ? currentFolderSlugs
      : t.source_type === 'page' && t.content_key === 'slug'
        ? currentPageSlugs
        : t.source_type === 'cms' && t.content_key === 'field:key:slug'
          ? currentCmsSlugs
          : null;
    if (!target) continue;
    if (!target.has(t.locale_id)) target.set(t.locale_id, new Map());
    target.get(t.locale_id)!.set(t.source_id, t.content_value);
  }

  const slugFieldIds = new Set((collectionFields || []).map((f) => f.id));
  const itemSlugByItemId = new Map<string, string>();
  for (const v of collectionItemValues || []) {
    if (slugFieldIds.has(v.field_id) && typeof v.value === 'string' && v.value) {
      itemSlugByItemId.set(v.item_id, v.value);
    }
  }

  const itemCollectionByItemId = new Map<string, string>();
  const collectionItemsByCollectionId = new Map<string, string[]>();
  for (const it of collectionItems || []) {
    itemCollectionByItemId.set(it.id, it.collection_id);
    if (!collectionItemsByCollectionId.has(it.collection_id)) collectionItemsByCollectionId.set(it.collection_id, []);
    collectionItemsByCollectionId.get(it.collection_id)!.push(it.id);
  }

  const dynamicPageByCollectionId = new Map<string, Page>();
  for (const p of pages as Page[]) {
    if (!p.is_dynamic) continue;
    const cid = (p.settings as any)?.cms?.collection_id;
    if (cid) dynamicPageByCollectionId.set(cid, p);
  }

  return {
    pagesById,
    pages: pages as Page[],
    folders: folders as PageFolder[],
    localesById,
    currentFolderSlugs,
    currentPageSlugs,
    currentCmsSlugs,
    itemSlugByItemId,
    itemCollectionByItemId,
    dynamicPageByCollectionId,
    collectionItemsByCollectionId,
  };
}

/** Build the slug segments for a folder chain using a given overrides map. */
function buildFolderSegments(
  folderId: string | null,
  folders: PageFolder[],
  folderSlugOverrides: Map<string, string> | undefined,
): string[] {
  const segments: string[] = [];
  let cur = folderId;
  while (cur) {
    const folder = folders.find((f) => f.id === cur);
    if (!folder) break;
    segments.unshift(folderSlugOverrides?.get(folder.id) ?? folder.slug);
    cur = folder.page_folder_id;
  }
  return segments;
}

/** Build the locale-prefixed URL for a static page in a specific locale. */
function buildStaticLocaleUrl(
  page: Page,
  folders: PageFolder[],
  localeCode: string,
  folderSlugOverrides: Map<string, string> | undefined,
  pageSlugOverride: string | undefined,
): string {
  if (page.is_index && page.page_folder_id === null) return localeCode;
  const folderSegs = buildFolderSegments(page.page_folder_id, folders, folderSlugOverrides);
  const parts = [localeCode, ...folderSegs];
  if (!page.is_index && page.slug) parts.push(pageSlugOverride ?? page.slug);
  return parts.filter(Boolean).join('/');
}

/** Build the locale-prefixed URL for one item of a dynamic page. */
function buildDynamicLocaleUrl(
  page: Page,
  folders: PageFolder[],
  localeCode: string,
  folderSlugOverrides: Map<string, string> | undefined,
  itemSlug: string,
): string {
  const folderSegs = buildFolderSegments(page.page_folder_id, folders, folderSlugOverrides);
  return [localeCode, ...folderSegs, itemSlug].filter(Boolean).join('/');
}

/** Resolve a non-CMS translation source to the pages it affects. */
async function resolvePagesForTranslationSource(
  sourceType: 'page' | 'folder' | 'component',
  sourceId: string,
  state: CurrentLocalisationState,
): Promise<Page[]> {
  if (sourceType === 'page') {
    const p = state.pagesById.get(sourceId);
    return p ? [p] : [];
  }
  if (sourceType === 'folder') {
    // All descendant pages (recursive folder match)
    const descendantFolderIds = new Set<string>([sourceId]);
    let added = true;
    while (added) {
      added = false;
      for (const f of state.folders) {
        if (f.page_folder_id && descendantFolderIds.has(f.page_folder_id) && !descendantFolderIds.has(f.id)) {
          descendantFolderIds.add(f.id);
          added = true;
        }
      }
    }
    return state.pages.filter((p) => p.page_folder_id && descendantFolderIds.has(p.page_folder_id));
  }
  // component
  try {
    const { findAffectedPages } = await import('@/lib/repositories/pageLayersRepository');
    const affected = await findAffectedPages([sourceId], [], []);
    return affected.componentPageIds
      .map((id) => state.pagesById.get(id))
      .filter((p): p is Page => Boolean(p));
  } catch {
    return [];
  }
}

/**
 * Given a localisation publish diff, compute every locale-prefixed URL that
 * the change set affects, separated into:
 *   - newRoutes: currently-live URLs to invalidate and warm.
 *   - oldRoutes: orphaned URLs (slug rename, locale rename/delete) to
 *                invalidate WITHOUT warming.
 *
 * Returns `needsFullInvalidation: true` for changes that touch the whole
 * URL structure (currently: any locale's `is_default` flipped).
 */
export async function buildLocaleRoutesForChanges(
  localisationResult: PublishLocalisationResult,
): Promise<LocalisationInvalidationResult> {
  const { changedLocales, changedTranslations, slugSnapshot } = localisationResult;

  if (changedLocales.length === 0 && changedTranslations.length === 0) {
    return { newRoutes: [], oldRoutes: [], needsFullInvalidation: false };
  }

  // Any is_default flip reshuffles the entire URL structure (default-locale
  // pages drop their prefix; non-default gain one). Bail to full invalidation.
  const defaultFlipped = changedLocales.find(
    (l) => l.oldIsDefault !== null && l.newIsDefault !== null && l.oldIsDefault !== l.newIsDefault,
  );
  if (defaultFlipped) {
    return {
      newRoutes: [],
      oldRoutes: [],
      needsFullInvalidation: true,
      reason: `locale ${defaultFlipped.id} default-flag flipped`,
    };
  }

  const state = await loadCurrentLocalisationState();
  if (!state) {
    return { newRoutes: [], oldRoutes: [], needsFullInvalidation: false, reason: 'no supabase client' };
  }

  const newRoutes = new Set<string>();
  const oldRoutes = new Set<string>();

  // Helpers bound to current vs snapshot slug contexts.
  const oldFolderSlugs = (localeId: string) => slugSnapshot.folderSlugsByLocale.get(localeId);
  const newFolderSlugs = (localeId: string) => state.currentFolderSlugs.get(localeId);
  const oldPageSlug = (localeId: string, pageId: string) =>
    slugSnapshot.pageSlugsByLocale.get(localeId)?.get(pageId);
  const newPageSlug = (localeId: string, pageId: string) =>
    state.currentPageSlugs.get(localeId)?.get(pageId);
  const oldCmsSlug = (localeId: string, itemId: string) =>
    slugSnapshot.cmsSlugsByLocale.get(localeId)?.get(itemId);
  const newCmsSlug = (localeId: string, itemId: string) =>
    state.currentCmsSlugs.get(localeId)?.get(itemId);

  // ─── Translation changes ──────────────────────────────────────────────
  for (const change of changedTranslations) {
    const localeId = change.locale_id;
    const current = state.localesById.get(localeId);
    const snapshot = slugSnapshot.localesById.get(localeId);

    // If the locale was the default at any point in time, only non-default
    // locales actually produce locale-prefixed URLs. Default-locale
    // translations are no-ops for routing but still affect render → those
    // are handled by the static page itself (default-locale URL has no
    // prefix). For now, only process non-default-locale translations here;
    // default-locale text changes are routed through normal page invalidation.
    const newCode = current && !current.is_default ? current.code : null;
    const oldCode = snapshot && !snapshot.is_default ? snapshot.code : null;
    if (!newCode && !oldCode) continue;

    if (change.source_type === 'cms') {
      const itemId = change.source_id;
      const collectionId = state.itemCollectionByItemId.get(itemId);
      if (!collectionId) continue;
      const page = state.dynamicPageByCollectionId.get(collectionId);
      if (!page) continue;

      const defaultItemSlug = state.itemSlugByItemId.get(itemId);

      if (change.content_key === 'field:key:slug') {
        // Slug rename for this item in this locale.
        const newSlug = change.newValue ?? defaultItemSlug;
        const oldSlug = change.oldValue ?? defaultItemSlug;
        if (newCode && newSlug) {
          newRoutes.add(buildDynamicLocaleUrl(page, state.folders, newCode, newFolderSlugs(localeId), newSlug));
        }
        if (oldCode && oldSlug) {
          oldRoutes.add(buildDynamicLocaleUrl(page, state.folders, oldCode, oldFolderSlugs(localeId), oldSlug));
        }
      } else {
        // Non-slug CMS field translation — current locale URL only.
        if (newCode) {
          const slug = newCmsSlug(localeId, itemId) ?? defaultItemSlug;
          if (slug) newRoutes.add(buildDynamicLocaleUrl(page, state.folders, newCode, newFolderSlugs(localeId), slug));
        }
      }
      continue;
    }

    // page / folder / component
    const affectedPages = await resolvePagesForTranslationSource(
      change.source_type as 'page' | 'folder' | 'component',
      change.source_id,
      state,
    );

    const isPageSlugRename = change.source_type === 'page' && change.content_key === 'slug';
    const isFolderSlugRename = change.source_type === 'folder' && change.content_key === 'slug';

    for (const page of affectedPages) {
      if (page.is_dynamic) {
        // Build URL for every published item of this dynamic page.
        const cid = (page.settings as any)?.cms?.collection_id;
        const itemIds = (cid && state.collectionItemsByCollectionId.get(cid)) || [];
        for (const itemId of itemIds) {
          const defaultSlug = state.itemSlugByItemId.get(itemId);
          if (!defaultSlug) continue;
          if (newCode) {
            const slug = newCmsSlug(localeId, itemId) ?? defaultSlug;
            newRoutes.add(buildDynamicLocaleUrl(page, state.folders, newCode, newFolderSlugs(localeId), slug));
          }
          if (isFolderSlugRename && oldCode) {
            const slug = oldCmsSlug(localeId, itemId) ?? defaultSlug;
            oldRoutes.add(buildDynamicLocaleUrl(page, state.folders, oldCode, oldFolderSlugs(localeId), slug));
          }
        }
        continue;
      }

      if (isPageSlugRename) {
        const newSlug = change.newValue ?? page.slug ?? undefined;
        const oldSlug = change.oldValue ?? page.slug ?? undefined;
        if (newCode) newRoutes.add(buildStaticLocaleUrl(page, state.folders, newCode, newFolderSlugs(localeId), newSlug));
        if (oldCode) oldRoutes.add(buildStaticLocaleUrl(page, state.folders, oldCode, oldFolderSlugs(localeId), oldSlug));
      } else if (isFolderSlugRename) {
        if (newCode) {
          newRoutes.add(
            buildStaticLocaleUrl(page, state.folders, newCode, newFolderSlugs(localeId), newPageSlug(localeId, page.id) ?? page.slug ?? undefined),
          );
        }
        if (oldCode) {
          oldRoutes.add(
            buildStaticLocaleUrl(page, state.folders, oldCode, oldFolderSlugs(localeId), oldPageSlug(localeId, page.id) ?? page.slug ?? undefined),
          );
        }
      } else {
        // Text / SEO / image / component-text translation. URL unchanged.
        if (newCode) {
          newRoutes.add(
            buildStaticLocaleUrl(page, state.folders, newCode, newFolderSlugs(localeId), newPageSlug(localeId, page.id) ?? page.slug ?? undefined),
          );
        }
      }
    }
  }

  // ─── Locale changes (rename / add / remove) ───────────────────────────
  for (const change of changedLocales) {
    // Adds: warm new-code URLs (no old URLs to invalidate).
    // Removes: invalidate old-code URLs (no new URLs to warm).
    // Renames: invalidate old-code, warm new-code.
    const newCode = change.newCode && change.newIsDefault === false ? change.newCode : null;
    const oldCode = change.oldCode && change.oldIsDefault === false ? change.oldCode : null;

    // Skip pure no-ops and default-locale changes (URLs unprefixed).
    if (!newCode && !oldCode) continue;
    if (newCode && oldCode && newCode === oldCode) continue;

    for (const page of state.pages) {
      if (page.is_dynamic) {
        const cid = (page.settings as any)?.cms?.collection_id;
        const itemIds = (cid && state.collectionItemsByCollectionId.get(cid)) || [];
        for (const itemId of itemIds) {
          const defaultSlug = state.itemSlugByItemId.get(itemId);
          if (!defaultSlug) continue;
          if (newCode) {
            const slug = newCmsSlug(change.id, itemId) ?? defaultSlug;
            newRoutes.add(buildDynamicLocaleUrl(page, state.folders, newCode, newFolderSlugs(change.id), slug));
          }
          if (oldCode) {
            const slug = oldCmsSlug(change.id, itemId) ?? defaultSlug;
            oldRoutes.add(buildDynamicLocaleUrl(page, state.folders, oldCode, oldFolderSlugs(change.id), slug));
          }
        }
        continue;
      }
      if (newCode) {
        newRoutes.add(
          buildStaticLocaleUrl(page, state.folders, newCode, newFolderSlugs(change.id), newPageSlug(change.id, page.id) ?? page.slug ?? undefined),
        );
      }
      if (oldCode) {
        oldRoutes.add(
          buildStaticLocaleUrl(page, state.folders, oldCode, oldFolderSlugs(change.id), oldPageSlug(change.id, page.id) ?? page.slug ?? undefined),
        );
      }
    }
  }

  // Drop empty-string routes (we don't ever want to invalidate the
  // homepage as a "locale URL" — that's a global concern, not localisation).
  return {
    newRoutes: [...newRoutes].filter((r) => r.length > 0),
    oldRoutes: [...oldRoutes].filter((r) => r.length > 0),
    needsFullInvalidation: false,
  };
}

/**
 * Top-level orchestrator: from a localisation publish diff, compute the
 * affected locale URLs, invalidate them, and return the split so the
 * caller can decide how to warm.
 *
 * - On a full-invalidation signal (e.g., default-locale flip), the caller
 *   should invoke `clearAllCache()` + `getAllPublishedRoutes()` for warming.
 * - Otherwise the caller appends `newRoutes` to the warm set (kept hot for
 *   the next visitor) and treats `oldRoutes` as orphaned (invalidate only).
 */
export async function invalidateForLocalisationChanges(
  localisationResult: PublishLocalisationResult,
): Promise<LocalisationInvalidationResult> {
  const result = await buildLocaleRoutesForChanges(localisationResult);

  if (result.needsFullInvalidation) return result;

  const all = [...result.newRoutes, ...result.oldRoutes];
  if (all.length > 0) {
    await invalidatePages(all);
  }
  return result;
}

// Re-export ChangedLocale/ChangedTranslation type info to avoid the rest of
// the codebase reaching across services.
export type { ChangedLocale, ChangedTranslation, SlugSnapshot, PublishLocalisationResult };
