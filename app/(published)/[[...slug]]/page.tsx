import { notFound, redirect, permanentRedirect } from 'next/navigation';
import { connection } from 'next/server';
import { unstable_cache } from 'next/cache';
import { addCacheTag } from '@vercel/functions';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { GLOBAL_SETTINGS_TAG } from '@/lib/cache-tags';
import { buildSlugPath } from '@/lib/page-utils';
import { generatePageMetadata, fetchGlobalPageSettings } from '@/lib/generate-page-metadata';
import { generateCachedErrorPageMetadata } from '@/lib/not-found-metadata';
import { fetchCachedErrorPage, fetchCachedPageForMetadata } from '@/lib/published-page-cache';
import { fetchPublishedHomepage, fetchPublishedPageWithLayers } from '@/lib/published-page-data';
import PageRenderer from '@/components/PageRenderer';
import PaginationSeoLinks from '@/components/PaginationSeoLinks';
import PasswordForm from '@/components/PasswordForm';
import { getSettingByKey } from '@/lib/repositories/settingsRepository';
import { parseAuthCookie, getPasswordProtection, fetchFoldersForAuth } from '@/lib/page-auth';
import { getSiteBaseUrl } from '@/lib/url-utils';
import { getOffCanonicalDynamicRedirect } from '@/lib/hreflang-utils';
import { matchRedirect } from '@/lib/redirect-utils';
import type { PageFolder, Translation, Redirect as RedirectType } from '@/types';

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
      return [{ slug: [] }];
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
      return [{ slug: [] }];
    }

    const params: { slug: string[] }[] = [
      { slug: [] }, // Default-locale homepage (`/` lives in this catch-all)
    ];

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
        if (locale.is_default) continue; // Skip default locale (`/` is `{ slug: [] }` above)
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

      // Skip empty paths (default-locale homepage is `{ slug: [] }` above)
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
    return [{ slug: [] }];
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
    // Also tagged on its own so a selective publish can refresh it —
    // `published_at` changes on every publish, and re-rendered pages must
    // see the new one even when no global resource changed.
    return await unstable_cache(
      async () => fetchGlobalPageSettings(),
      ['data-for-global-settings'],
      { tags: ['all-pages', GLOBAL_SETTINGS_TAG], revalidate: false }
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

interface PageProps {
  params: Promise<{ slug?: string[] }>;
}

export default async function Page({ params }: PageProps) {
  const { slug } = await params;
  const slugPath = slug?.join('/') ?? '';
  const isHomepage = slugPath === '';

  // Tag this response for Vercel CDN cache invalidation. The publish endpoint
  // purges this exact tag (route-/<slug>) so only this URL's cache entry is
  // invalidated. No-ops outside Vercel.
  await addCacheTag([isHomepage ? 'route-/' : `route-/${slugPath}`, 'all-pages']);

  const currentPath = isHomepage ? '/' : `/${slugPath}`;
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

  const [data, globalSettings] = await Promise.all([
    isHomepage ? fetchPublishedHomepage() : fetchPublishedPageWithLayers(slugPath),
    fetchCachedGlobalSettings(),
  ]);

  if (!data || (isHomepage && !data.pageLayers)) {
    if (isHomepage) {
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

    // Page not found: hand off to the 404 boundary so the response carries a real
    // HTTP 404 status (the custom 404 page is rendered there). Returning content
    // here would emit a 200 "soft 404", which search engines penalize.
    notFound();
  }

  const { page, pageLayers, components, collectionItem, collectionFields, pageCollectionSortedItemIds, pageCollectionSortedItemSlugs, locale, availableLocales, translations, generatedCss } = data;

  // Per-page CSS with fallback to global published_css
  const cssForPage = generatedCss || globalSettings.publishedCss || undefined;

  // Check password protection for this page.
  // First evaluate without cookies() so non-protected pages stay cacheable.
  const folders = await fetchCachedFoldersForAuth();

  // Redirect off-canonical dynamic slugs (e.g. a default slug requested under a
  // translated locale) to the canonical localized URL to avoid duplicate content.
  if (page.is_dynamic && collectionItem) {
    const canonicalPath = getOffCanonicalDynamicRedirect({
      page,
      folders,
      locale,
      translations,
      itemId: collectionItem.id,
      currentPath,
    });
    if (canonicalPath) {
      permanentRedirect(canonicalPath);
    }
  }

  const protectionCheck = getPasswordProtection(page, folders, null);

  // If page is protected, opt into dynamic rendering and read the auth cookie.
  if (protectionCheck.isProtected) {
    await connection();
    const authCookie = await parseAuthCookie();
    const protection = getPasswordProtection(page, folders, authCookie);

    // If page is protected and not unlocked, show 401 error page
    if (!protection.isUnlocked) {
      const errorPageData = await fetchCachedErrorPage(401, undefined, slugPath);

      if (errorPageData) {
        const { page: errorPage, pageLayers: errorPageLayers, components: errorComponents } = errorPageData;

        return (
          <PageRenderer
            page={errorPage}
            layers={errorPageLayers.layers || []}
            components={errorComponents}
            generatedCss={globalSettings.publishedCss || undefined}
            colorVariablesCss={globalSettings.colorVariablesCss || undefined}
            locale={errorPageData.locale}
            availableLocales={errorPageData.availableLocales}
            translations={errorPageData.translations}
            globalCustomCodeHead={globalSettings.globalCustomCodeHead}
            globalCustomCodeBody={globalSettings.globalCustomCodeBody}
            ycodeBadge={globalSettings.ycodeBadge}
            passwordProtection={{
              pageId: protection.protectedBy === 'page' ? protection.protectedById : undefined,
              folderId: protection.protectedBy === 'folder' ? protection.protectedById : undefined,
              redirectUrl: currentPath,
              isPublished: true,
            }}
            localeSwitchTarget={{ page, collectionItem, collectionFields }}
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
    <>
      <PaginationSeoLinks
        layers={pageLayers.layers || []}
        basePath={currentPath}
        baseUrl={getSiteBaseUrl({ globalCanonicalUrl: globalSettings.globalCanonicalUrl })}
      />
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
    </>
  );
}

// Generate metadata
export async function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }): Promise<Metadata> {
  const { slug } = await params;
  const slugPath = slug?.join('/') ?? '';
  const isHomepage = slugPath === '';

  const [data, globalSettings] = await Promise.all([
    isHomepage ? fetchPublishedHomepage() : fetchCachedPageForMetadata(slugPath),
    fetchCachedGlobalSettings(),
  ]);

  if (!data) {
    if (isHomepage) {
      return {
        title: 'Ycode',
        description: 'Built with Ycode',
      };
    }

    // The layout emits this same metadata into the flushed head (Next.js drops
    // a page's metadata once it calls notFound()); keeping it here too means
    // the streamed metadata the client applies doesn't contradict it.
    return generateCachedErrorPageMetadata(404, slugPath, { globalSeoSettings: globalSettings });
  }

  // Don't leak metadata for protected pages. Checking without cookies keeps
  // generateMetadata fully static — no need to verify unlock state here since
  // the page component handles access gating.
  const folders = await fetchCachedFoldersForAuth();
  const protectionCheck = getPasswordProtection(data.page, folders, null);

  if (protectionCheck.isProtected) {
    return generateCachedErrorPageMetadata(401, slugPath, { globalSeoSettings: globalSettings });
  }

  const routeTag = isHomepage ? 'route-/' : `route-/${slugPath}`;
  const { meta, baseUrl } = await unstable_cache(
    async () => ({
      meta: await generatePageMetadata(data.page, {
        fallbackTitle: isHomepage
          ? 'Home'
          : slugPath.charAt(0).toUpperCase() + slugPath.slice(1),
        collectionItem: data.collectionItem,
        pagePath: isHomepage ? '/' : `/${slugPath}`,
        globalSeoSettings: globalSettings,
        translations: data.translations,
      }),
      baseUrl: getSiteBaseUrl({ globalCanonicalUrl: globalSettings.globalCanonicalUrl }),
    }),
    [isHomepage ? 'data-for-route-/-meta' : `data-for-route-/${slugPath}-meta`],
    { tags: [routeTag, 'all-pages'], revalidate: false }
  )();

  if (baseUrl) {
    try { meta.metadataBase = new URL(baseUrl); } catch { /* invalid URL */ }
  }

  return meta;
}
