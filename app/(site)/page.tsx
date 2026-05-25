import { redirect, permanentRedirect } from 'next/navigation';
import { unstable_cache } from 'next/cache';
import { addCacheTag } from '@vercel/functions';
import Link from 'next/link';
import { fetchHomepage, fetchErrorPage, splitPageData, reassemblePageData, slimPageData } from '@/lib/page-fetcher';
import type { PageData } from '@/lib/page-fetcher';
import PageRenderer from '@/components/PageRenderer';
import PasswordForm from '@/components/PasswordForm';
import { generatePageMetadata, fetchGlobalPageSettings } from '@/lib/generate-page-metadata';
import { getSettingByKey } from '@/lib/repositories/settingsRepository';
import { matchRedirect } from '@/lib/redirect-utils';
import { parseAuthCookie, getPasswordProtection, fetchFoldersForAuth } from '@/lib/page-auth';
import { getSiteBaseUrl } from '@/lib/url-utils';
import { TIME_DEPENDENT_PAGES_TAG } from '@/lib/services/cacheService';
import { PAGES_WITH_DATE_PRESETS_SETTING } from '@/lib/services/datePresetsService';
import type { Redirect as RedirectType } from '@/types';
import type { Metadata } from 'next';

// Static by default for performance, dynamic only when pagination is requested
export const revalidate = false; // Cache indefinitely until publish invalidates

/**
 * Fetch homepage data from database
 * Cached with tag-based revalidation (no time-based stale cache)
 */
async function fetchPublishedHomepage(isTimeDependent: boolean) {
  // Tags are both 'route-/' AND 'all-pages':
  // - route-/ lets selective invalidation purge just this page's data cache
  // - all-pages lets full invalidation (color variables, redirects, etc.)
  //   sweep every page's data cache in one invalidateByTag call.
  // Vercel's invalidateByTag is tag-precise, so no cascade — selective
  // invalidation of one route doesn't disturb others. (Next.js bug #63509
  // would apply if we used revalidateTag for selective on Vercel, but we
  // route exclusively through invalidateByTag here.)
  // `time-dependent-pages` is added opt-in for pages with `$today`/preset-based
  // visibility or filter rules so the daily cron can roll them over.
  const tags = ['route-/', 'all-pages'];
  if (isTimeDependent) tags.push(TIME_DEPENDENT_PAGES_TAG);
  const opts = { tags, revalidate: false as const };

  const [core, layers] = await Promise.all([
    unstable_cache(
      async () => {
        const data = await fetchHomepage(true);
        if (!data) return null;
        return splitPageData(data as PageData).core;
      },
      ['core-/'],
      opts
    )(),
    unstable_cache(
      async () => {
        const data = await fetchHomepage(true);
        if (!data) return null;
        return splitPageData(data as PageData).layers;
      },
      ['layers-/'],
      opts
    )(),
  ]);

  if (!core) return null;
  return reassemblePageData(core, layers || []);
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

/**
 * Returns whether the homepage is in the stored "time-dependent" set.
 * We fetch the homepage core once (cached) to resolve the page ID, then
 * check membership in the cached id list.
 */
async function isHomepageTimeDependent(): Promise<boolean> {
  try {
    const [timeDependentIds, core] = await Promise.all([
      unstable_cache(
        async () => {
          const value = await getSettingByKey(PAGES_WITH_DATE_PRESETS_SETTING);
          return Array.isArray(value) ? (value as string[]) : [];
        },
        ['data-for-time-dependent-page-ids'],
        { tags: ['all-pages'], revalidate: false },
      )(),
      unstable_cache(
        async () => {
          const data = await fetchHomepage(true);
          return data ? splitPageData(data as PageData).core : null;
        },
        ['core-/'],
        { tags: ['route-/', 'all-pages'], revalidate: false },
      )(),
    ]);
    if (timeDependentIds.length === 0) return false;
    return !!core && timeDependentIds.includes(core.page.id);
  } catch {
    return false;
  }
}

async function fetchCachedErrorPage(errorCode: 401) {
  return unstable_cache(
    async () => {
      const data = await fetchErrorPage(errorCode, true);
      return data ? slimPageData(data) : null;
    },
    [`error-${errorCode}`],
    { tags: ['all-pages'], revalidate: false }
  )();
}

export default async function Home() {
  // Tag this response for Vercel CDN cache invalidation. The publish endpoint
  // purges this exact tag (route-/) so only the homepage cache entry is
  // invalidated. No-ops outside Vercel.
  const isTimeDependent = await isHomepageTimeDependent();
  const responseTags = ['route-/', 'all-pages'];
  if (isTimeDependent) responseTags.push(TIME_DEPENDENT_PAGES_TAG);
  await addCacheTag(responseTags);

  // Check for redirects targeting the homepage
  const redirects = await fetchCachedRedirects();
  if (redirects && Array.isArray(redirects)) {
    const matched = matchRedirect('/', redirects);
    if (matched) {
      if (matched.type === '302') {
        redirect(matched.newUrl);
      } else {
        permanentRedirect(matched.newUrl);
      }
    }
  }

  // Cache-first homepage path; pagination is served through internal dynamic routes.
  const data = await fetchPublishedHomepage(isTimeDependent);

  // If no published homepage exists, show default landing page
  if (!data || !data.pageLayers) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center p-8 flex flex-col items-center justify-center gap-2">
          <h1 className="text-xl font-semibold text-neutral-900">
            Welcome to Ycode
          </h1>
          <Link
            href="/ycode"
            className=" bg-blue-500 text-white text-sm font-medium h-8 flex items-center justify-center px-3 rounded-lg transition-colors"
          >
            Get started
          </Link>
        </div>
      </div>
    );
  }

  // Load all global settings early so error pages also get global custom code
  const globalSettings = await fetchCachedGlobalSettings();

  // Per-page CSS with fallback to global published_css
  const cssForPage = data.generatedCss || globalSettings.publishedCss || undefined;

  // Check password protection for homepage.
  // First evaluate without cookies() so non-protected pages can stay cacheable.
  const folders = await fetchCachedFoldersForAuth();
  const protectionCheck = getPasswordProtection(data.page, folders, null);

  // If homepage is protected, read auth cookie and re-check unlock state.
  if (protectionCheck.isProtected) {
    const authCookie = await parseAuthCookie();
    const protection = getPasswordProtection(data.page, folders, authCookie);

    // If homepage is protected and not unlocked, show 401 error page
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
            passwordProtection={{
              pageId: protection.protectedBy === 'page' ? protection.protectedById : undefined,
              folderId: protection.protectedBy === 'folder' ? protection.protectedById : undefined,
              redirectUrl: '/',
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
              redirectUrl="/"
              isPublished={true}
            />
          </div>
        </div>
      );
    }
  }

  // Render homepage
  return (
    <PageRenderer
      page={data.page}
      layers={data.pageLayers.layers || []}
      components={data.components}
      generatedCss={cssForPage}
      colorVariablesCss={globalSettings.colorVariablesCss || undefined}
      locale={data.locale}
      availableLocales={data.availableLocales}
      translations={data.translations}
      gaMeasurementId={globalSettings.gaMeasurementId}
      globalCustomCodeHead={globalSettings.globalCustomCodeHead}
      globalCustomCodeBody={globalSettings.globalCustomCodeBody}
      ycodeBadge={globalSettings.ycodeBadge}
    />
  );
}

// Generate metadata
export async function generateMetadata(): Promise<Metadata> {
  // Keep tag set consistent across metadata + render so we don't create two
  // cache entries with diverging tags for the same underlying fetch.
  const isTimeDependent = await isHomepageTimeDependent();
  const [data, globalSettings] = await Promise.all([
    fetchPublishedHomepage(isTimeDependent),
    fetchCachedGlobalSettings(),
  ]);

  if (!data) {
    return {
      title: 'Ycode',
      description: 'Built with Ycode',
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
        fallbackTitle: 'Home',
        pagePath: '/',
        globalSeoSettings: globalSettings,
      }),
      baseUrl: getSiteBaseUrl({ globalCanonicalUrl: globalSettings.globalCanonicalUrl }),
    }),
    ['data-for-route-/-meta'],
    { tags: ['route-/', 'all-pages'], revalidate: false }
  )();

  if (baseUrl) {
    try { meta.metadataBase = new URL(baseUrl); } catch { /* invalid URL */ }
  }

  return meta;
}
