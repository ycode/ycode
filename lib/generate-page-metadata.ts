/**
 * Generate Page Metadata
 *
 * SERVER-ONLY: This module uses server-only utilities and should never be imported in client code.
 */

import 'server-only';

import { cache } from 'react';
import type { Metadata } from 'next';
import type { Asset, Locale, Page, PageFolder, Translation } from '@/types';
import type { CollectionItemWithValues } from '@/types';
import { resolveInlineVariables, resolveImageUrl } from '@/lib/resolve-cms-variables';
import { getSettingsByKeys } from '@/lib/repositories/settingsRepository';
import { getAssetById } from '@/lib/repositories/assetRepository';
import { getAllLocales } from '@/lib/repositories/localeRepository';
import { getAllPublishedPageFolders } from '@/lib/repositories/pageFolderRepository';
import { getValuesByItemIds } from '@/lib/repositories/collectionItemValueRepository';
import { getSlugTranslationsByLocale } from '@/lib/repositories/translationRepository';
import { buildSvgDataUrl, getAssetProxyUrl } from '@/lib/asset-utils';
import { generateColorVariablesCss } from '@/lib/repositories/colorVariableRepository';
import { buildPageHreflangAlternates, type HreflangAlternate } from '@/lib/hreflang-utils';
import { getTranslatableKey, getTranslatedAssetId, getTranslatedText } from '@/lib/locale-runtime';
import { buildAbsolutePageUrl, getSiteBaseUrl } from '@/lib/url-utils';

/**
 * Global page render settings fetched once per page render
 */
export interface GlobalPageSettings {
  googleSiteVerification?: string | null;
  globalCanonicalUrl?: string | null;
  gaMeasurementId?: string | null;
  publishedCss?: string | null;
  colorVariablesCss?: string | null;
  globalCustomCodeHead?: string | null;
  globalCustomCodeBody?: string | null;
  ycodeBadge?: boolean;
  publishedAt?: string | null;
  faviconUrl?: string | null;
  faviconMimeType?: string | null;
  webClipUrl?: string | null;
  webClipMimeType?: string | null;
}

/** @deprecated Use GlobalPageSettings instead */
export type GlobalSeoSettings = GlobalPageSettings;

/**
 * Generate metadata options
 */
export interface GenerateMetadataOptions {
  /** Include [Preview] prefix in title */
  isPreview?: boolean;
  /** Fallback title if page has no name */
  fallbackTitle?: string;
  /** Fallback description if page has no SEO description */
  fallbackDescription?: string;
  /** Collection item for resolving field variables (for dynamic pages) */
  collectionItem?: CollectionItemWithValues;
  /** Current page path for canonical URL */
  pagePath?: string;
  /** Pre-fetched global SEO settings (avoids duplicate fetches) */
  globalSeoSettings?: GlobalSeoSettings;
  /** Tenant ID for multi-tenant deployments */
  tenantId?: string;
  /** Primary domain URL (e.g. https://example.com) for metadataBase */
  primaryDomainUrl?: string;
  /** Per-locale translations, keyed `{source}:{id}:{content_key}`, for localized SEO */
  translations?: Record<string, Translation> | null;
}

/**
 * Resolve a usable URL for favicon/web-clip assets, falling back to an
 * inline data URL for SVGs stored without a public_url/storage_path.
 */
function resolveIconAssetUrl(asset: Asset): string | null {
  const proxyOrPublic = getAssetProxyUrl(asset) || asset.public_url || null;
  if (proxyOrPublic) return proxyOrPublic;

  if (asset.mime_type === 'image/svg+xml' && asset.content) {
    return buildSvgDataUrl(asset.content, asset.width, asset.height);
  }

  return null;
}

async function fetchGlobalPageSettingsImpl(isPreview = false): Promise<GlobalPageSettings> {
  const settings = await getSettingsByKeys([
    'google_site_verification',
    'global_canonical_url',
    'ga_measurement_id',
    'published_css',
    'custom_code_head',
    'custom_code_body',
    'ycode_badge',
    'published_at',
    'favicon_asset_id',
    'web_clip_asset_id',
  ]);

  // Fetch favicon and web clip asset URLs if IDs are set
  // In preview mode, read draft assets so the favicon shows before publishing.
  let faviconUrl: string | null = null;
  let faviconMimeType: string | null = null;
  let webClipUrl: string | null = null;
  let webClipMimeType: string | null = null;
  const isAssetPublished = !isPreview;

  if (settings.favicon_asset_id) {
    try {
      const asset = await getAssetById(settings.favicon_asset_id, isAssetPublished);
      if (asset) {
        faviconUrl = resolveIconAssetUrl(asset);
        faviconMimeType = asset.mime_type || null;
      }
    } catch {
      // Ignore errors fetching favicon
    }
  }

  if (settings.web_clip_asset_id) {
    try {
      const asset = await getAssetById(settings.web_clip_asset_id, isAssetPublished);
      if (asset) {
        webClipUrl = resolveIconAssetUrl(asset);
        webClipMimeType = asset.mime_type || null;
      }
    } catch {
      // Ignore errors fetching web clip
    }
  }

  const colorVariablesCss = await generateColorVariablesCss();

  return {
    googleSiteVerification: settings.google_site_verification || null,
    globalCanonicalUrl: settings.global_canonical_url || null,
    gaMeasurementId: settings.ga_measurement_id || null,
    publishedCss: settings.published_css || null,
    colorVariablesCss,
    globalCustomCodeHead: settings.custom_code_head || null,
    globalCustomCodeBody: settings.custom_code_body || null,
    ycodeBadge: settings.ycode_badge ?? true,
    publishedAt: typeof settings.published_at === 'string' ? settings.published_at : null,
    faviconUrl,
    faviconMimeType,
    webClipUrl,
    webClipMimeType,
  };
}

/**
 * Fetch all global page settings in a single database query
 * Includes SEO settings, published CSS, and global custom code
 * Wrapped with React cache to deduplicate within the same request (non-preview only)
 */
const fetchGlobalPageSettingsCached = cache(async (): Promise<GlobalPageSettings> => {
  return fetchGlobalPageSettingsImpl();
});

export async function fetchGlobalPageSettings(isPreview = false): Promise<GlobalPageSettings> {
  if (isPreview) {
    // Preview mode: bypass cache and read draft assets
    return fetchGlobalPageSettingsImpl(true);
  }
  return fetchGlobalPageSettingsCached();
}

/** @deprecated Use fetchGlobalPageSettings instead */
export const fetchGlobalSeoSettings = fetchGlobalPageSettingsCached;

/**
 * Localization data needed to build per-page hreflang alternates.
 * Translations are keyed by locale ID, then by translatable key.
 */
interface HreflangDataset {
  locales: Locale[];
  folders: PageFolder[];
  translationsByLocale: Map<string, Record<string, Translation>>;
}

/**
 * Load published locales, folders and per-locale translations needed to build
 * hreflang alternates. Wrapped in React cache so it runs once per request even
 * when multiple metadata helpers ask for it. Returns a single locale only when
 * the site isn't multilingual, in which case callers skip hreflang.
 */
const fetchHreflangDataset = cache(async (): Promise<HreflangDataset> => {
  const [locales, folders] = await Promise.all([
    getAllLocales(true),
    getAllPublishedPageFolders(),
  ]);

  const translationsByLocale = new Map<string, Record<string, Translation>>();

  if (locales.length > 1) {
    for (const locale of locales) {
      if (locale.is_default) continue;
      // hreflang alternates only need slug rows to build localized URLs.
      const translations = await getSlugTranslationsByLocale(locale.id, true);
      const map: Record<string, Translation> = {};
      for (const t of translations) {
        map[getTranslatableKey(t)] = t;
      }
      translationsByLocale.set(locale.id, map);
    }
  }

  return { locales, folders, translationsByLocale };
});

/**
 * Build the hreflang alternates for a page on a multilingual site. Returns an
 * empty array when hreflang shouldn't be emitted (single locale or no
 * resolvable alternates). Rendered as lowercase `<link rel="alternate"
 * hreflang>` tags (see HreflangAlternateLinks) rather than via Next's
 * `metadata.alternates.languages`, which React 19 emits as camelCase `hrefLang`.
 */
export async function buildPageHreflangAlternatesForPage(
  page: Page,
  baseUrl: string,
  collectionItem?: CollectionItemWithValues,
   
  tenantId?: string
): Promise<HreflangAlternate[]> {
  const { locales, folders, translationsByLocale } = await fetchHreflangDataset();

  if (locales.length <= 1) {
    return [];
  }

  // Dynamic pages need the collection item's slug to resolve per-locale URLs.
  // `collectionItem.values` is localized to the active render locale, so read the
  // raw (default-locale) slug — it anchors the x-default and default-locale
  // alternates and the fallback for locales without a translated slug.
  const slugFieldId = page.settings?.cms?.slug_field_id;
  let dynamicSlug: { itemId: string; defaultValue: string } | null = null;
  if (page.is_dynamic && collectionItem && slugFieldId) {
    const rawValues = await getValuesByItemIds([collectionItem.id], true, undefined, [slugFieldId]);
    const rawSlug = rawValues[collectionItem.id]?.[slugFieldId];
    dynamicSlug = {
      itemId: collectionItem.id,
      defaultValue: String(rawSlug ?? collectionItem.values?.[slugFieldId] ?? ''),
    };
  }

  return buildPageHreflangAlternates({
    page,
    folders,
    baseUrl,
    locales,
    translationsByLocale,
    dynamicSlug,
  });
}

/**
 * Generate Next.js metadata from a page object
 * Handles SEO settings, Open Graph, Twitter Card, and noindex rules
 * Resolves field variables for dynamic pages
 *
 * @param page - The page object containing settings and metadata
 * @param options - Optional configuration for metadata generation
 * @returns Next.js Metadata object
 */
export async function generatePageMetadata(
  page: Page,
  options: GenerateMetadataOptions = {}
): Promise<Metadata> {
  const { isPreview = false, fallbackTitle, fallbackDescription, collectionItem, pagePath, primaryDomainUrl, translations } = options;

  const seo = page.settings?.seo;
  const isErrorPage = page.error_page !== null;

  // Resolve locale-translated SEO values (falls back to originals when no
  // completed translation exists for the current locale).
  const seoTitle = getTranslatedText(seo?.title, 'seo:title', translations, page.id);
  const seoDescription = getTranslatedText(seo?.description, 'seo:description', translations, page.id);

  // Build title - resolve field variables if collection item is available
  let title = seoTitle || page.name || fallbackTitle || 'Page';
  if (collectionItem && seoTitle) {
    title = resolveInlineVariables(seoTitle, collectionItem) || page.name || fallbackTitle || 'Page';
  }
  if (isPreview) {
    title = `[Preview] ${title}`;
  }

  // Build description - resolve field variables if collection item is available
  let description = seoDescription || fallbackDescription || page.name;
  if (collectionItem && seoDescription) {
    description = resolveInlineVariables(seoDescription, collectionItem) || fallbackDescription || page.name;
  }

  // Base metadata
  const metadata: Metadata = {
    title,
    description,
  };

  // Resolve the site base URL for making relative URLs absolute.
  // URL objects don't survive unstable_cache serialization, so we resolve
  // absolute URLs as strings here instead of relying on metadataBase.
  let siteBaseUrl: string | null = null;

  // URL of the current page, shared by canonical and og:url. Prefer an absolute
  // URL built from the resolved base (canonical / primary domain / Vercel env)
  // so it's correct on Vercel and cloud even when the route doesn't set
  // `metadataBase`. Falls back to the relative path locally (no base
  // configured), which Next.js resolves against `metadataBase` when available.
  let pageUrl: string | undefined;

  // Always fetch global settings — preview mode reads draft assets so the
  // favicon and web clip render before the user publishes.
  const seoSettings = options.globalSeoSettings || await fetchGlobalPageSettings(isPreview);

  if (!isPreview) {
    siteBaseUrl = getSiteBaseUrl({
      globalCanonicalUrl: seoSettings.globalCanonicalUrl,
      primaryDomainUrl,
    });

    pageUrl = pagePath === undefined
      ? undefined
      : siteBaseUrl
        ? buildAbsolutePageUrl(siteBaseUrl, pagePath)
        : pagePath;

    // Add Google Site Verification meta tag
    if (seoSettings.googleSiteVerification) {
      metadata.verification = {
        google: seoSettings.googleSiteVerification,
      };
    }

    // Add canonical URL
    if (pageUrl !== undefined) {
      metadata.alternates = {
        ...metadata.alternates,
        canonical: pageUrl,
      };
    }

    // hreflang alternates are rendered as lowercase <link> tags in the page
    // head (see HreflangAlternateLinks / PageRenderer), not via
    // metadata.alternates.languages — React 19 emits that map's `hrefLang`
    // prop verbatim, but the HTML/Google standard is lowercase `hreflang`.
  }

  // Add custom favicon and web clip (apple-touch-icon) — applies to preview too.
  // Default favicon is handled by app/icon.svg
  if (seoSettings.faviconUrl || seoSettings.webClipUrl) {
    metadata.icons = {};
    if (seoSettings.faviconUrl) {
      metadata.icons.icon = seoSettings.faviconMimeType
        ? { url: seoSettings.faviconUrl, type: seoSettings.faviconMimeType }
        : seoSettings.faviconUrl;
    }
    if (seoSettings.webClipUrl) {
      metadata.icons.apple = seoSettings.webClipMimeType
        ? { url: seoSettings.webClipUrl, type: seoSettings.webClipMimeType }
        : seoSettings.webClipUrl;
    }
  }

  // Add Open Graph and Twitter Card metadata (not for error pages)
  if (!isErrorPage) {
    // A fixed asset (string ID) can be translated per locale; CMS field
    // variables resolve from the collection item instead.
    const seoImage = typeof seo?.image === 'string'
      ? getTranslatedAssetId(seo.image, 'seo:image', translations, page.id)
      : seo?.image;

    // Resolve image URL (handles both Asset ID string and FieldVariable)
    let imageUrl = seoImage ? await resolveImageUrl(seoImage, collectionItem) : null;

    // Make relative URLs absolute — social crawlers require absolute og:image URLs
    if (imageUrl && imageUrl.startsWith('/') && siteBaseUrl) {
      imageUrl = `${siteBaseUrl}${imageUrl}`;
    }

    if (imageUrl || pageUrl !== undefined) {
      metadata.openGraph = {
        title,
        description,
        ...(pageUrl !== undefined ? { url: pageUrl } : {}),
        ...(imageUrl
          ? {
            images: [
              {
                url: imageUrl,
                width: 1200,
                height: 630,
              },
            ],
          }
          : {}),
      };
      metadata.twitter = {
        card: imageUrl ? 'summary_large_image' : 'summary',
        title,
        description,
        ...(imageUrl ? { images: [imageUrl] } : {}),
      };
    }
  }

  // Add noindex if enabled, if error page, or if preview
  if (seo?.noindex || isErrorPage || isPreview) {
    metadata.robots = {
      index: false,
      follow: false,
    };
  }

  return metadata;
}
