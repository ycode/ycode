import { notFound, redirect, permanentRedirect } from 'next/navigation';
import { unstable_cache } from 'next/cache';
import { addCacheTag } from '@vercel/functions';
import type { Metadata } from 'next';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { buildSlugPath } from '@/lib/page-utils';
import { generatePageMetadata, fetchGlobalPageSettings } from '@/lib/generate-page-metadata';
import { fetchPageByPath, fetchPageByPathForMetadata, fetchErrorPage, splitPageData, reassemblePageData, slimPageData } from '@/lib/page-fetcher';
import PageRenderer from '@/components/PageRenderer';
import PasswordForm from '@/components/PasswordForm';
import { getSettingByKey } from '@/lib/repositories/settingsRepository';
import { parseAuthCookie, getPasswordProtection, fetchFoldersForAuth } from '@/lib/page-auth';
import { getSiteBaseUrl } from '@/lib/url-utils';
import { matchRedirect } from '@/lib/redirect-utils';
import { TIME_DEPENDENT_PAGES_TAG } from '@/lib/services/cacheService';
import { PAGES_WITH_DATE_PRESETS_SETTING } from '@/lib/services/datePresetsService';
import type { Page, PageFolder, Translation, Redirect as RedirectType } from '@/types';

// Static by default for performance, dynamic only when pagination is requested
export const revalidate = false; // Cache indefinitely until publish invalidates
export const dynamicParams = true;

/**
 * Generate static params for known published pages
 * This tells Next.js which pages to pre-render
 * Includes both default locale paths and translated paths for all locales
 */
export async function generateStaticParams() {
  try {
    const supabase = await getSupabaseAdmin();

    if (!supabase) {
      return [];
    }

    // Get all published pages and folders (excluding soft-deleted)
    const { data: pages } = await supabase
      .from('pages')
      .select('*')
      .eq('is_published', true)
      .is('deleted_at', null);

    const { data: folders } = await supabase
      .from('page_folders')
      .select('*')
      .eq('is_published', true)
      .is('deleted_at', null);

    // Get all active locales
    const { data: locales } = await supabase
      .from('locales')
      .select('*')
      .is('deleted_at', null);

    // Get all published translations
    const { data: translations } = await supabase
      .from('translations')
      .select('*')
      .eq('is_published', true)
      .is('deleted_at', null);

    if (!pages || !folders) {
      return [];
    }

    const params: { slug: string[] }[] = [];

    // Build translations map for easier lookup
    const translationsMap: Record<string, Record<string, Translation>> = {};
    if (translations) {
      for (const translation of translations) {
        if (!translationsMap[translation.locale_id]) {
          translationsMap[translation.locale_id] = {};
        }
        const key = `${translation.source_type}:${translation.source_id}:${translation.content_key}`;
        translationsMap[translation.locale_id][key] = translation;
      }
    }

    // Generate localized homepage paths (e.g., /fr/, /es/)
    if (locales) {
      for (const locale of locales) {
        if (locale.is_default) continue; // Skip default locale (/ is handled by app/page.tsx)
        params.push({ slug: [locale.code] });
      }
    }

    // Generate params for each non-dynamic page
    for (const page of pages) {
      // Skip dynamic pages - they are handled dynamically at request time
      if (page.is_dynamic) {
        continue;
      }

      // Generate default locale path (no locale prefix)
      const defaultPath = buildSlugPath(page, folders as PageFolder[], 'page');
      const defaultSegments = defaultPath.slice(1).split('/').filter(Boolean);

      // Skip empty paths (homepage is handled by app/page.tsx)
      if (defaultSegments.length > 0) {
        params.push({ slug: defaultSegments });
      }

      // Generate translated paths for non-default locales
      if (locales) {
        for (const locale of locales) {
          if (locale.is_default) continue; // Skip default locale

          const localeTranslations = translationsMap[locale.id] || {};

          // Build localized path with translated slugs
          const slugParts: string[] = [locale.code];

          // Add translated folder path
          let currentFolderId = page.page_folder_id;
          const folderSegments: string[] = [];
          while (currentFolderId) {
            const folder = folders.find(f => f.id === currentFolderId);
            if (!folder) break;

            const translationKey = `folder:${folder.id}:slug`;
            const translatedSlug = localeTranslations[translationKey]?.content_value || folder.slug;
            folderSegments.unshift(translatedSlug);

            currentFolderId = folder.page_folder_id;
          }
          slugParts.push(...folderSegments);

          // Add page's own slug
          if (!page.is_index && page.slug) {
            const pageKey = `page:${page.id}:slug`;
            const translatedSlug = localeTranslations[pageKey]?.content_value || page.slug;
            slugParts.push(translatedSlug);
          }

          const localizedSegments = slugParts.filter(Boolean);
          if (localizedSegments.length > 1) { // Must have at least locale + something
            params.push({ slug: localizedSegments });
          }
        }
      }
    }

    return params;
  } catch (error) {
    console.error('Failed to generate static params:', error);
    return [];
  }
}

/**
 * Fetch published page and layers data from database
 * Cached per slug and page for revalidation
 */
async function fetchPublishedPageWithLayers(slugPath: string, isTimeDependent: boolean) {
  // Tags are both 'route-/X' AND 'all-pages':
  // - route-/X lets selective invalidation purge just this page's data cache
  // - all-pages lets full invalidation (color variables, redirects, etc.)
  //   sweep every page's data cache in one invalidateByTag call.
  // Vercel's invalidateByTag is tag-precise — invalidating one route's tag
  // doesn't cascade to entries that only share 'all-pages'. (Next.js bug
  // #63509 would apply if we used revalidateTag for selective, but we route
  // exclusively through invalidateByTag on Vercel.)
  // `time-dependent-pages` is added opt-in for pages with `$today`/preset-based
  // visibility or filter rules so the daily cron can roll them over.
  const tags = [`route-/${slugPath}`, 'all-pages'];
  if (isTimeDependent) tags.push(TIME_DEPENDENT_PAGES_TAG);
  const opts = { tags, revalidate: false as const };

  const [core, layers] = await Promise.all([
    unstable_cache(
      async () => {
        const data = await fetchPageByPath(slugPath, true);
        if (!data) return null;
        return splitPageData(data).core;
      },
      [`core-/${slugPath}`],
      opts
    )(),
    unstable_cache(
      async () => {
        const data = await fetchPageByPath(slugPath, true);
        if (!data) return null;
        return splitPageData(data).layers;
      },
      [`layers-/${slugPath}`],
      opts
    )(),
  ]);

  if (!core) return null;
  return reassemblePageData(core, layers || []);
}

async function fetchPublishedPageForMetadata(slugPath: string) {
  return unstable_cache(
    async () => fetchPageByPathForMetadata(slugPath, true),
    [`metadata-/${slugPath}`],
    { tags: [`route-/${slugPath}`, 'all-pages'], revalidate: false }
  )();
}

/**
 * Returns whether the page at `slugPath` is in the stored "time-dependent"
 * set. The membership check needs the page's ID, which we resolve via the
 * cached metadata fetch (already in cache for the metadata path; cheap one
 * extra read on a cold cache for the render path).
 */
async function isTimeDependentPage(slugPath: string): Promise<boolean> {
  try {
    const [timeDependentIds, pageMeta] = await Promise.all([
      unstable_cache(
        async () => {
          const value = await getSettingByKey(PAGES_WITH_DATE_PRESETS_SETTING);
          return Array.isArray(value) ? (value as string[]) : [];
        },
        ['data-for-time-dependent-page-ids'],
        { tags: ['all-pages'], revalidate: false },
      )(),
      fetchPublishedPageForMetadata(slugPath),
    ]);
    if (timeDependentIds.length === 0) return false;
    return !!pageMeta && timeDependentIds.includes(pageMeta.page.id);
  } catch {
    return false;
  }
}

async function fetchCachedRedirects(): Promise<RedirectType[] | null> {
  try {
    return await unstable_cache(
      async () => getSettingByKey('redirects') as Promise<RedirectType[] | null>,
      ['data-for-redirects'],
      { tags: ['all-pages'], revalidate: false }
    )();
  } catch {
    return null;
  }
}

async function fetchCachedGlobalSettings() {
  try {
    return await unstable_cache(
      async () => fetchGlobalPageSettings(),
      ['data-for-global-settings'],
      { tags: ['all-pages'], revalidate: false }
    )();
  } catch {
    return {
      googleSiteVerification: null,
      globalCanonicalUrl: null,
      gaMeasurementId: null,
      publishedCss: null,
      colorVariablesCss: null,
      globalCustomCodeHead: null,
      globalCustomCodeBody: null,
      ycodeBadge: true,
      faviconUrl: null,
      webClipUrl: null,
    };
  }
}

async function fetchCachedFoldersForAuth() {
  try {
    return await unstable_cache(
      async () => fetchFoldersForAuth(true),
      ['data-for-auth-folders'],
      { tags: ['all-pages'], revalidate: false }
    )();
  } catch {
    return [];
  }
}

async function fetchCachedErrorPage(errorCode: 401 | 404) {
  return unstable_cache(
    async () => {
      const data = await fetchErrorPage(errorCode, true);
      return data ? slimPageData(data) : null;
    },
    [`error-${errorCode}`],
    { tags: ['all-pages'], revalidate: false }
  )();
}

interface PageProps {
  params: Promise<{ slug: string | string[] }>;
}

export default async function Page({ params }: PageProps) {
  // Await params
  const { slug } = await params;

  // Handle catch-all slug (join array into path)
  const slugPath = Array.isArray(slug) ? slug.join('/') : slug;

  // Tag this response for Vercel CDN cache invalidation. The publish endpoint
  // purges this exact tag (route-/<slug>) so only this URL's cache entry is
  // invalidated. No-ops outside Vercel.
  const isTimeDependent = await isTimeDependentPage(slugPath);
  const responseTags = [`route-/${slugPath}`, 'all-pages'];
  if (isTimeDependent) responseTags.push(TIME_DEPENDENT_PAGES_TAG);
  await addCacheTag(responseTags);

  // Check for redirects before processing the page
  const currentPath = `/${slugPath}`;
  const redirects = await fetchCachedRedirects();
  if (redirects && Array.isArray(redirects)) {
    const matched = matchRedirect(currentPath, redirects);
    if (matched) {
      if (matched.type === '302') {
        redirect(matched.newUrl);
      } else {
        permanentRedirect(matched.newUrl);
      }
    }
  }

  // Fetch page data and global settings in parallel
  const [data, globalSettings] = await Promise.all([
    fetchPublishedPageWithLayers(slugPath, isTimeDependent),
    fetchCachedGlobalSettings(),
  ]);

  // If page not found, try to show custom 404 error page
  if (!data) {
    const errorPageData = await fetchCachedErrorPage(404);

    if (errorPageData) {
      const { page: errorPage, pageLayers: errorPageLayers, components: errorComponents } = errorPageData;

      return (
        <PageRenderer
          page={errorPage}
          layers={errorPageLayers.layers || []}
          components={errorComponents}
          generatedCss={globalSettings.publishedCss || undefined}
          colorVariablesCss={globalSettings.colorVariablesCss || undefined}
          globalCustomCodeHead={globalSettings.globalCustomCodeHead}
          globalCustomCodeBody={globalSettings.globalCustomCodeBody}
          ycodeBadge={globalSettings.ycodeBadge}
        />
      );
    }

    // No custom 404 page, use default Next.js 404
    notFound();
  }

  const { page, pageLayers, components, collectionItem, collectionFields, pageCollectionSortedItemIds, pageCollectionSortedItemSlugs, locale, availableLocales, translations, generatedCss } = data;

  // Per-page CSS with fallback to global published_css
  const cssForPage = generatedCss || globalSettings.publishedCss || undefined;

  // Check password protection for this page.
  // First evaluate without cookies() so non-protected pages stay cacheable.
  const folders = await fetchCachedFoldersForAuth();
  const protectionCheck = getPasswordProtection(page, folders, null);

  // If page is protected, read auth cookie and re-check unlock state.
  if (protectionCheck.isProtected) {
    const authCookie = await parseAuthCookie();
    const protection = getPasswordProtection(page, folders, authCookie);

    // If page is protected and not unlocked, show 401 error page
    if (!protection.isUnlocked) {
      const errorPageData = await fetchCachedErrorPage(401);

      if (errorPageData) {
        const { page: errorPage, pageLayers: errorPageLayers, components: errorComponents } = errorPageData;

        return (
          <PageRenderer
            page={errorPage}
            layers={errorPageLayers.layers || []}
            components={errorComponents}
            generatedCss={globalSettings.publishedCss || undefined}
            colorVariablesCss={globalSettings.colorVariablesCss || undefined}
            globalCustomCodeHead={globalSettings.globalCustomCodeHead}
            globalCustomCodeBody={globalSettings.globalCustomCodeBody}
            ycodeBadge={globalSettings.ycodeBadge}
            passwordProtection={{
              pageId: protection.protectedBy === 'page' ? protection.protectedById : undefined,
              folderId: protection.protectedBy === 'folder' ? protection.protectedById : undefined,
              redirectUrl: currentPath,
              isPublished: true,
            }}
          />
        );
      }

      // Inline fallback if no custom 401 page exists
      return (
        <div className="min-h-screen flex items-center justify-center bg-white">
          <div className="text-center max-w-md px-4">
            <h1 className="text-6xl font-bold text-gray-900 mb-4">401</h1>
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">Password Protected</h2>
            <p className="text-gray-600 mb-8">Enter the password to continue.</p>
            <PasswordForm
              pageId={protection.protectedBy === 'page' ? protection.protectedById : undefined}
              folderId={protection.protectedBy === 'folder' ? protection.protectedById : undefined}
              redirectUrl={currentPath}
              isPublished={true}
            />
          </div>
        </div>
      );
    }
  }

  return (
    <PageRenderer
      page={page}
      layers={pageLayers.layers || []}
      components={components}
      generatedCss={cssForPage}
      colorVariablesCss={globalSettings.colorVariablesCss || undefined}
      collectionItem={collectionItem}
      collectionFields={collectionFields}
      pageCollectionSortedItemIds={pageCollectionSortedItemIds}
      pageCollectionSortedItemSlugs={pageCollectionSortedItemSlugs}
      locale={locale}
      availableLocales={availableLocales}
      translations={translations}
      gaMeasurementId={globalSettings.gaMeasurementId}
      globalCustomCodeHead={globalSettings.globalCustomCodeHead}
      globalCustomCodeBody={globalSettings.globalCustomCodeBody}
      ycodeBadge={globalSettings.ycodeBadge}
    />
  );
}

// Generate metadata
export async function generateMetadata({ params }: { params: Promise<{ slug: string | string[] }> }): Promise<Metadata> {
  const { slug } = await params;

  // Handle catch-all slug (join array into path)
  const slugPath = Array.isArray(slug) ? slug.join('/') : slug;

  // Fetch page and global settings in parallel
  const [data, globalSettings] = await Promise.all([
    fetchPublishedPageForMetadata(slugPath),
    fetchCachedGlobalSettings(),
  ]);

  if (!data) {
    return {
      title: 'Page Not Found',
    };
  }

  // Check password protection - don't leak metadata for protected pages.
  // First check without cookies() to avoid forcing dynamic metadata for public pages.
  const folders = await fetchCachedFoldersForAuth();
  const protectionCheck = getPasswordProtection(data.page, folders, null);

  if (protectionCheck.isProtected) {
    const authCookie = await parseAuthCookie();
    const protection = getPasswordProtection(data.page, folders, authCookie);
    if (!protection.isUnlocked) {
      return {
        title: 'Password Protected',
        description: 'This page is password protected.',
        robots: { index: false, follow: false },
      };
    }
  }

  const { meta, baseUrl } = await unstable_cache(
    async () => ({
      meta: await generatePageMetadata(data.page, {
        fallbackTitle: slugPath.charAt(0).toUpperCase() + slugPath.slice(1),
        collectionItem: data.collectionItem,
        pagePath: '/' + slugPath,
        globalSeoSettings: globalSettings,
      }),
      baseUrl: getSiteBaseUrl({ globalCanonicalUrl: globalSettings.globalCanonicalUrl }),
    }),
    [`data-for-route-/${slugPath}-meta`],
    { tags: [`route-/${slugPath}`, 'all-pages'], revalidate: false }
  )();

  if (baseUrl) {
    try { meta.metadataBase = new URL(baseUrl); } catch { /* invalid URL */ }
  }

  return meta;
}
