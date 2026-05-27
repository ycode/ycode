import { cache } from 'react';
import { escapeHtml } from '@/lib/escape-html';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { getKnexClient } from '@/lib/knex-client';
import { buildSlugPath, buildDynamicPageUrl, buildLocalizedSlugPath, buildLocalizedDynamicPageUrl, detectLocaleFromPath, matchPageWithTranslatedSlugs, matchDynamicPageWithTranslatedSlugs } from '@/lib/page-utils';
import { getItemWithValues, getItemsWithValues, getItemsWithValuesByIds, getItemIdsByFieldValue, getItemsByCollectionId } from '@/lib/repositories/collectionItemRepository';
import { getValuesByItemIds } from '@/lib/repositories/collectionItemValueRepository';
import { getFieldsByCollectionId } from '@/lib/repositories/collectionFieldRepository';
import { enrichItemsWithCountValues } from '@/lib/repositories/collectionCountRepository';
import type { Page, PageFolder, PageLayers, Component, ComponentVariable, CollectionItemWithValues, CollectionField, Layer, CollectionPaginationMeta, Translation, Locale } from '@/types';
import { getCollectionVariable, resolveFieldValue, evaluateVisibility, getLayerHtmlTag, filterDisabledSliderLayers } from '@/lib/layer-utils';
import { isFieldVariable, isAssetVariable, createDynamicTextVariable, createDynamicRichTextVariable, createAssetVariable, getDynamicTextContent, getVariableStringValue, getAssetId, resolveDesignStyles } from '@/lib/variable-utils';
import { buildImageSizes, generateImageSrcset, getOptimizedImageUrl, getAssetProxyUrl, DEFAULT_ASSETS, collectLayerAssetIds, buildSvgDataUrl, parseImageDimension } from '@/lib/asset-utils';
import { resolveComponents, applyComponentOverrides } from '@/lib/resolve-components';
import { getComponentVariantLayers } from '@/lib/component-variant-utils';
import { isTiptapDoc, hasBlockElementsWithResolver } from '@/lib/tiptap-utils';
import { castValue, parseMultiReferenceValue, remapLayerIdsForCollectionItem } from '@/lib/collection-utils';
import { DEFAULT_TEXT_STYLES } from '@/lib/text-format-utils';

// Pagination context passed through to resolveCollectionLayers
export interface PaginationContext {
  // Map of layerId -> page number (defaults to 1 if not specified)
  pageNumbers?: Record<string, number>;
  // Default page number for all collection layers (from URL ?page=N)
  defaultPage?: number;
}

import { resolveFieldLinkValue, resolveRefCollectionItemId, generateLinkHref, isLinkAtCollectionBoundary, parseCollectionLinkValue, extractCrossCollectionItemIds } from '@/lib/link-utils';
import type { LinkResolutionContext } from '@/lib/link-utils';
import { getLinkSettingsFromMark } from '@/lib/tiptap-extensions/rich-text-link';
import { SWIPER_CLASS_MAP, SWIPER_DATA_ATTR_MAP } from '@/lib/slider-constants';
import { resolveInlineVariables, resolveInlineVariablesFromData } from '@/lib/inline-variables';
import { formatFieldValue } from '@/lib/cms-variables-utils';
import { buildLayerTranslationKey, getTranslationByKey, hasValidTranslationValue, getTranslationValue, injectTranslatedText, applyCmsTranslations, translateComponentOverrides } from '@/lib/localisation-utils';
import { formatDateFieldsInItemValues } from '@/lib/date-format-utils';
import { getSettingByKey } from '@/lib/repositories/settingsRepository';
import { parseMultiAssetFieldValue, buildAssetVirtualValues } from '@/lib/multi-asset-utils';
import { combineBgValues, mergeStaticBgVars } from '@/lib/tailwind-class-mapper';
import { generateInitialAnimationCSS } from '@/lib/animation-utils';
import { getMapIframeProps, DEFAULT_MAP_SETTINGS } from '@/lib/map-utils';
import { getMapboxAccessToken, getGoogleMapsEmbedApiKey } from '@/lib/map-server';
import { getAssetsByIds } from '@/lib/repositories/assetRepository';
import { isVirtualAssetField, findDisplayField } from '@/lib/collection-field-utils';
import type { FieldVariable, AssetVariable, DynamicTextVariable, LinkSettings } from '@/types';
import type { DesignColorVariable } from '@/types';

// Cached map provider tokens for synchronous use inside layerToHtml.
// Set by ensureMapTokens() before HTML generation begins.
let _cachedMapboxToken: string | null = null;
let _cachedGoogleMapsEmbedKey: string | null = null;

async function ensureMapTokens(): Promise<void> {
  if (_cachedMapboxToken === null) {
    _cachedMapboxToken = (await getMapboxAccessToken()) || '';
  }
  if (_cachedGoogleMapsEmbedKey === null) {
    _cachedGoogleMapsEmbedKey = (await getGoogleMapsEmbedApiKey()) || '';
  }
}

/**
 * Create the appropriate variable for an asset field value.
 * Virtual fields (e.g., __asset_url) contain URLs directly, regular fields contain asset IDs.
 */
function createResolvedAssetVariable(
  fieldId: string,
  resolvedValue: string | null | undefined,
  fallback: FieldVariable
): FieldVariable | AssetVariable | DynamicTextVariable {
  if (!resolvedValue) return fallback;
  return isVirtualAssetField(fieldId)
    ? createDynamicTextVariable(resolvedValue)
    : createAssetVariable(resolvedValue);
}

export interface PageData {
  page: Page;
  pageLayers: PageLayers;
  components: Component[];
  collectionItem?: CollectionItemWithValues; // For dynamic pages
  collectionFields?: CollectionField[]; // For dynamic pages
  /**
   * Ordered ids of every item in the dynamic page's collection, sorted by
   * `manual_order` ASC. Used to resolve `next-item` / `previous-item` link
   * keywords. Only set for dynamic pages.
   */
  pageCollectionSortedItemIds?: string[];
  /**
   * Map of `collection_item_id -> slug` for every item in
   * `pageCollectionSortedItemIds`. PageRenderer merges this into its slug
   * lookup so next/previous links can resolve to the correct URL even when
   * the neighbouring items are not otherwise referenced on the page.
   */
  pageCollectionSortedItemSlugs?: Record<string, string>;
  locale?: Locale | null; // Current locale (if detected from URL)
  availableLocales?: Locale[]; // All active locales for locale switcher
  translations?: Record<string, Translation>; // Translations for locale-aware URL generation
  /** Per-page CSS generated from this page's layers + resolved components. */
  generatedCss?: string | null;
}

/**
 * Strip heavy data from PageData to reduce serialized size for caching.
 * After the server-side resolution pipeline (resolveComponents → resolveCollectionLayers
 * → resolveRichTextCollections → resolveAllAssets), component layers are fully expanded
 * in the layer tree and rich-text embedded components have pre-resolved _resolvedLayers.
 * This strips component layers and pageLayers metadata that aren't needed downstream.
 */
export function slimPageData(data: PageData): PageData {
  return {
    ...data,
    pageLayers: { layers: data.pageLayers.layers || [] } as PageLayers,
    components: data.components.map(({ layers, ...rest }) => ({ ...rest, layers: [] }) as Component),
    generatedCss: data.generatedCss,
  };
}

export type PageDataCore = Omit<PageData, 'pageLayers'>;

export function splitPageData(data: PageData): { core: PageDataCore; layers: Layer[] } {
  const slimmed = slimPageData(data);
  const { pageLayers, ...core } = slimmed;
  return { core, layers: pageLayers.layers || [] };
}

export function reassemblePageData(core: PageDataCore, layers: Layer[]): PageData {
  return { ...core, pageLayers: { layers } as PageLayers };
}

/**
 * Order collection items the same way next/previous navigation should walk
 * them. When no setting is configured, falls back to the auto-generated
 * `id`-keyed field sorted ascending (1 → N) — the same default the page-
 * settings UI exposes. Field sorts compare numerically when both sides
 * parse as numbers, otherwise locale string compare.
 */
function sortItemsForNextPrevious<T extends { id: string; manual_order: number; values: Record<string, string> }>(
  items: T[],
  collectionFields: CollectionField[],
  settings?: { sort_by?: string; sort_order?: 'asc' | 'desc' }
): T[] {
  const idFieldId = collectionFields.find(f => f.key === 'id')?.id;
  const sortBy = settings?.sort_by || idFieldId || 'manual';
  const sortOrder = settings?.sort_order || 'asc';
  const direction = sortOrder === 'desc' ? -1 : 1;

  if (sortBy === 'manual') {
    return [...items].sort((a, b) => (a.manual_order - b.manual_order) * direction);
  }

  return [...items].sort((a, b) => {
    const aRaw = a.values[sortBy] ?? '';
    const bRaw = b.values[sortBy] ?? '';
    const aStr = String(aRaw);
    const bStr = String(bRaw);
    const aNum = aStr.trim() !== '' ? Number(aStr) : NaN;
    const bNum = bStr.trim() !== '' ? Number(bStr) : NaN;

    if (!isNaN(aNum) && !isNaN(bNum)) {
      return (aNum - bNum) * direction;
    }
    return aStr.localeCompare(bStr) * direction;
  });
}

/**
 * Match a URL path against a dynamic page pattern and extract the slug value
 * @param urlPath - The URL path (e.g., "/products/item-1")
 * @param patternPath - The pattern path with {slug} placeholder (e.g., "/products/{slug}")
 * @returns The extracted slug value or null if no match
 */
function matchDynamicPagePattern(urlPath: string, patternPath: string): string | null {
  // Replace {slug} with a regex capture group
  const patternRegex = patternPath.replace(/\{slug\}/g, '([^/]+)');
  const regex = new RegExp(`^${patternRegex}$`);
  const match = urlPath.match(regex);

  if (!match) {
    return null;
  }

  // Extract the slug value (first capture group)
  return match[1] || null;
}

/**
 * Load translations for a locale from the database
 * @param localeCode - The locale code (e.g., "fr", "en")
 * @param isPublished - Whether to fetch published translations
 * @returns Map of translations keyed by translatable key (source_type:source_id:content_key)
 */
export async function loadTranslationsForLocale(
  localeCode: string,
  isPublished: boolean,
  tenantId?: string
): Promise<{ locale: Locale | null; translations: Record<string, Translation> }> {
  try {
    const supabase = await getSupabaseAdmin(tenantId);

    if (!supabase) {
      return { locale: null, translations: {} };
    }

    // Find the locale by code
    const { data: locale } = await supabase
      .from('locales')
      .select('*')
      .eq('code', localeCode)
      .eq('is_published', isPublished)
      .is('deleted_at', null)
      .single();

    if (!locale) {
      return { locale: null, translations: {} };
    }

    // Fetch all translations for this locale. Supabase caps PostgREST
    // responses at 1000 rows by default — projects with more translations
    // were silently truncated, causing entire layers to render in the
    // source language on SSR while the editor (which fetches via its own
    // paginated API) showed them correctly. Page through explicit ranges.
    const PAGE_SIZE = 1000;
    const translations: Translation[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data: page, error } = await supabase
        .from('translations')
        .select('*')
        .eq('locale_id', locale.id)
        .eq('is_published', isPublished)
        .is('deleted_at', null)
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        console.error('Failed to fetch translations page:', error);
        break;
      }

      if (!page || page.length === 0) break;
      translations.push(...(page as Translation[]));
      if (page.length < PAGE_SIZE) break;
    }

    // Build translations map keyed by translatable key
    const translationsMap: Record<string, Translation> = {};
    for (const translation of translations) {
      const key = `${translation.source_type}:${translation.source_id}:${translation.content_key}`;
      translationsMap[key] = translation;
    }

    return { locale, translations: translationsMap };
  } catch (error) {
    console.error('Failed to load translations for locale:', localeCode, error);
    return { locale: null, translations: {} };
  }
}

/**
 * Fetch collection item by slug field value (supports translated slugs)
 * @param collectionId - Collection UUID
 * @param slugFieldId - Field ID for the slug field
 * @param slugValue - The slug value to match (could be original or translated)
 * @param isPublished - Get draft (false) or published (true) version
 * @param collectionFields - Collection fields (needed to build translation keys)
 * @param locale - Current locale (for translated slug lookup)
 * @param translations - Translations map (for translated slug lookup)
 */
async function getCollectionItemBySlug(
  collectionId: string,
  slugFieldId: string,
  slugValue: string,
  isPublished: boolean,
  collectionFields?: CollectionField[],
  locale?: Locale | null,
  translations?: Record<string, Translation>,
  tenantId?: string
): Promise<CollectionItemWithValues | null> {
  try {
    const supabase = await getSupabaseAdmin(tenantId);

    if (!supabase) {
      return null;
    }

    // If locale and translations are provided, try to find item by translated slug first
    if (locale && translations && collectionFields) {
      const slugField = collectionFields.find(f => f.id === slugFieldId);

      if (slugField) {
        // Build content_key for the slug field
        const contentKey = slugField.key
          ? `field:key:${slugField.key}`
          : `field:id:${slugField.id}`;

        // Search through translations to find which item has this translated slug
        for (const [translationKey, translation] of Object.entries(translations)) {
          // Translation key format: cms:{itemId}:{contentKey}
          if (translation.content_value === slugValue && translationKey.endsWith(contentKey)) {
            // Extract item ID from translation key
            const itemId = translation.source_id;

            // Verify this item belongs to the correct collection
            const { data: item, error: itemError } = await supabase
              .from('collection_items')
              .select('*')
              .eq('id', itemId)
              .eq('collection_id', collectionId)
              .eq('is_published', isPublished)
              .is('deleted_at', null)
              .single();

            if (!itemError && item) {
              // Found the item via translation - return it with all values
              return await getItemWithValues(item.id, isPublished);
            }
          }
        }
      }
    }

    // Fall back to original slug lookup (no translation or translation not found)
    const { data: valueData, error: valueError } = await supabase
      .from('collection_item_values')
      .select('item_id')
      .eq('field_id', slugFieldId)
      .eq('value', slugValue)
      .eq('is_published', isPublished)
      .is('deleted_at', null)
      .limit(1)
      .single();

    if (valueError || !valueData) {
      return null;
    }

    // Verify the item belongs to the correct collection
    const { data: item, error: itemError } = await supabase
      .from('collection_items')
      .select('*')
      .eq('id', valueData.item_id)
      .eq('collection_id', collectionId)
      .eq('is_published', isPublished)
      .is('deleted_at', null)
      .single();

    if (itemError || !item) {
      return null;
    }

    // Fetch the item with all its values
    return await getItemWithValues(item.id, isPublished);
  } catch (error) {
    console.error('Failed to fetch collection item by slug:', error);
    return null;
  }
}

/**
 * Fetch page by full path (including folders)
 * Works for both draft and published pages
 * Handles dynamic pages by matching URL patterns and fetching collection items
 * Supports localized URLs with translated slugs
 * @param slugPath - The URL path (may include locale prefix like "fr/products/item")
 * @param isPublished - Whether to fetch published or draft version
 * @param paginationContext - Optional pagination context with page numbers from URL
 */
async function fetchPageByPathInternal(
  slugPath: string,
  isPublished: boolean,
  paginationContext?: PaginationContext,
  tenantId?: string,
  options?: { resolveLayers?: boolean }
): Promise<PageData | null> {
  try {
    const resolveLayers = options?.resolveLayers !== false;
    const supabase = await getSupabaseAdmin(tenantId);

    if (!supabase) {
      console.error('Supabase not configured');
      return null;
    }

    // Fetch shared page lookup data in parallel.
    // Components/timezone are only needed when resolving layers.
    const [{ data: availableLocales }, { data: pages }, { data: folders }, components, timezoneRaw] = await Promise.all([
      supabase.from('locales').select('*').eq('is_published', isPublished).is('deleted_at', null),
      supabase.from('pages').select('*').eq('is_published', isPublished).is('deleted_at', null),
      supabase.from('page_folders').select('*').eq('is_published', isPublished).is('deleted_at', null),
      resolveLayers ? fetchComponents(supabase, isPublished) : Promise.resolve([] as Component[]),
      resolveLayers ? getSettingByKey('timezone') : Promise.resolve('UTC'),
    ]);
    const timezone = (timezoneRaw as string | null) || 'UTC';

    const validLocaleCodes = availableLocales?.map(l => l.code) || [];
    const localeDetection = detectLocaleFromPath(slugPath, validLocaleCodes);
    const pathWithoutLocale = localeDetection?.remainingPath ?? slugPath;

    let translations: Record<string, Translation> | undefined;
    let detectedLocale: Locale | null = null;

    if (localeDetection) {
      const { locale, translations: trans } = await loadTranslationsForLocale(
        localeDetection.localeCode,
        isPublished,
        tenantId
      );
      detectedLocale = locale;
      translations = trans;
    }

    if (!pages || !folders) {
      return null;
    }

    const targetPath = pathWithoutLocale;

    // If path is empty after locale detection (e.g., "/fr/" -> "fr" -> ""),
    // try to fetch the homepage
    if (targetPath === '' && detectedLocale) {
      // Pass preloaded components and translations so CMS content is translated
      const homepageData = await fetchHomepage(isPublished, paginationContext, components, tenantId, translations);
      if (homepageData) {
        // Components and collection layers are already resolved by fetchHomepage
        // Apply translations for the detected locale
        let processedLayers = homepageData.pageLayers.layers || [];
        if (translations && Object.keys(translations).length > 0) {
          processedLayers = injectTranslatedText(processedLayers, homepageData.page.id, translations, { includeIncomplete: !isPublished });
        }

        // Resolve all AssetVariables to URLs server-side (prevents client-side API calls)
        const resolved = await resolveAllAssets(processedLayers, isPublished, components);
        processedLayers = resolved.layers;

        return {
          ...homepageData,
          pageLayers: {
            ...homepageData.pageLayers,
            layers: processedLayers,
          },
          components: homepageData.components,
          locale: detectedLocale,
          availableLocales: availableLocales as Locale[] || [],
          translations,
        };
      }
      return null;
    }

    // First, try to find an exact match (non-dynamic page)
    // Use translated slug matching if translations are available
    let matchingPage = pages.find((page: Page) => {
      if (page.is_dynamic) return false; // Skip dynamic pages for exact match

      // If we have translations, match using translated slugs
      if (translations) {
        return matchPageWithTranslatedSlugs(targetPath, page, folders as PageFolder[], translations);
      }

      // Otherwise, use default slug matching
      const fullPath = buildSlugPath(page, folders as PageFolder[], 'page');
      return fullPath === `/${targetPath}`;
    });

    // If no exact match, try dynamic pages
    if (!matchingPage) {
      // Find all dynamic pages and check if URL matches their pattern
      const dynamicPages = pages.filter((page: Page) => page.is_dynamic);

      for (const dynamicPage of dynamicPages) {
        let extractedSlug: string | null = null;

        // Match using translated slugs if available
        if (translations) {
          extractedSlug = matchDynamicPageWithTranslatedSlugs(
            targetPath,
            dynamicPage,
            folders as PageFolder[],
            translations
          );
        } else {
          // Use default slug matching
          const patternPath = buildSlugPath(dynamicPage, folders as PageFolder[], 'page', '{slug}');
          extractedSlug = matchDynamicPagePattern(`/${targetPath}`, patternPath);
        }

        if (extractedSlug) {
          // Fetch the collection item by slug value (supports translated slugs)
          const cmsSettings = dynamicPage.settings?.cms;
          if (cmsSettings?.collection_id && cmsSettings?.slug_field_id) {
            // Fetch collection fields (needed for translation key lookup and custom code placeholders)
            const collectionFields = await getFieldsByCollectionId(
              cmsSettings.collection_id,
              isPublished,
              { excludeComputed: true }
            );

            const collectionItem = await getCollectionItemBySlug(
              cmsSettings.collection_id,
              cmsSettings.slug_field_id,
              extractedSlug,
              isPublished,
              collectionFields,
              detectedLocale,
              translations,
              tenantId
            );

            if (!collectionItem) {
              // Slug doesn't belong to this dynamic page's collection — try next
              continue;
            }

            // Found the matching dynamic page
            matchingPage = dynamicPage;

            // Metadata-only mode: skip heavy layer/component resolution
            if (!resolveLayers) {
              let enhancedItemValues = await resolveReferenceFields(
                collectionItem.values,
                collectionFields,
                isPublished
              );
              enhancedItemValues = applyCmsTranslations(collectionItem.id, enhancedItemValues, collectionFields, translations, { includeIncomplete: !isPublished });
              enhancedItemValues = formatDateFieldsInItemValues(enhancedItemValues, collectionFields, timezone);

              const enhancedCollectionItem = {
                ...collectionItem,
                values: enhancedItemValues,
              };

              return {
                page: matchingPage,
                pageLayers: { layers: [] } as any,
                components: [],
                collectionItem: enhancedCollectionItem,
                collectionFields,
                locale: detectedLocale,
                availableLocales: availableLocales as Locale[] || [],
                translations,
              };
            }

            // Get layers for the dynamic page
            const { data: pageLayers, error: layersError } = await supabase
              .from('page_layers')
              .select('*')
              .eq('page_id', matchingPage.id)
              .eq('is_published', isPublished)
              .is('deleted_at', null)
              .order('created_at', { ascending: false })
              .limit(1)
              .single();

            if (layersError) {
              console.error(`Failed to fetch ${isPublished ? 'published' : 'draft'} layers:`, layersError);
              return null;
            }

            // Resolve reference fields in the collection item values
            // This adds nested field values like "location.name" for inline variable resolution
            let enhancedItemValues = await resolveReferenceFields(
              collectionItem.values,
              collectionFields,
              isPublished
            );

            // Apply CMS translations to the item values
            enhancedItemValues = applyCmsTranslations(collectionItem.id, enhancedItemValues, collectionFields, translations, { includeIncomplete: !isPublished });

            const rawItemValues = { ...enhancedItemValues };
            enhancedItemValues = formatDateFieldsInItemValues(enhancedItemValues, collectionFields, timezone);

            // Create enhanced collection item with resolved reference values and translations
            const enhancedCollectionItem = {
              ...collectionItem,
              values: enhancedItemValues,
            };

            // Translate component-instance override values first, so the translated
            // values are what `resolveComponents` propagates into the rendered tree.
            const localizedRawLayers = detectedLocale && translations && Object.keys(translations).length > 0
              ? translateComponentOverrides(pageLayers?.layers || [], matchingPage.id, translations, { includeIncomplete: !isPublished })
              : pageLayers?.layers || [];

            const layersWithComponents = resolveComponents(localizedRawLayers, components);

            // Inject dynamic page collection data into layers (including expanded component layers)
            // This resolves inline variables like "Name → Location" on the page
            const layersWithInjectedData = await Promise.all(
              layersWithComponents.map((layer: Layer) =>
                injectCollectionData(layer, enhancedItemValues, collectionFields, isPublished, undefined, rawItemValues, timezone)
              )
            );

            // Then resolve collection layers (nested collections will handle their own injection)
            // The isPublished parameter controls which collection items to fetch
            // Pass enhanced values so nested collections can filter based on dynamic page data
            // Pass collectionItem.id so inverse reference layers can query by parent item
            let resolvedLayers = layersWithInjectedData.length > 0
              ? await resolveCollectionLayers(layersWithInjectedData, isPublished, enhancedItemValues, paginationContext, translations, collectionItem.id, timezone)
              : [];

            // Resolve collections inside rich text embedded components
            resolvedLayers = await resolveRichTextCollections(resolvedLayers, components, isPublished, translations);

            // Apply translations (components already resolved above)
            if (detectedLocale && translations && Object.keys(translations).length > 0) {
              resolvedLayers = injectTranslatedText(resolvedLayers, matchingPage.id, translations, { includeIncomplete: !isPublished });
            }

            // Resolve all AssetVariables to URLs server-side (prevents client-side API calls)
            const resolved = await resolveAllAssets(resolvedLayers, isPublished, components);
            resolvedLayers = resolved.layers;

            // Fetch the ordered list of ids + slugs for the page's collection
            // so links using `next-item` / `previous-item` can resolve at
            // render time. The sort is configurable per-page (CMS settings);
            // the default is `manual_order ASC` to match other parts of the
            // system. We grab values too so we can build a slug map — the
            // neighbouring items are typically not referenced anywhere else
            // on the page, so PageRenderer would otherwise have no way to
            // resolve their URLs.
            let pageCollectionSortedItemIds: string[] | undefined;
            let pageCollectionSortedItemSlugs: Record<string, string> | undefined;
            try {
              const slugFieldId = collectionFields.find(f => f.key === 'slug')?.id;
              const { items: fetchedItems } = await getItemsWithValues(
                cmsSettings.collection_id,
                isPublished
              );
              const orderedItems = sortItemsForNextPrevious(
                fetchedItems,
                collectionFields,
                cmsSettings.next_previous
              );
              pageCollectionSortedItemIds = orderedItems.map(i => i.id);
              if (slugFieldId) {
                pageCollectionSortedItemSlugs = {};
                for (const item of orderedItems) {
                  const slug = item.values[slugFieldId];
                  if (slug) pageCollectionSortedItemSlugs[item.id] = slug;
                }
              }
            } catch (err) {
              // Non-fatal: next/previous links will simply not resolve.
              console.error('[fetchPageByPath] Failed to fetch collection item order:', err);
            }

            return {
              page: matchingPage,
              pageLayers: {
                ...pageLayers,
                layers: resolvedLayers,
              },
              components,
              collectionItem: enhancedCollectionItem,
              collectionFields,
              pageCollectionSortedItemIds,
              pageCollectionSortedItemSlugs,
              locale: detectedLocale,
              availableLocales: availableLocales as Locale[] || [],
              translations,
              generatedCss: pageLayers?.generated_css || null,
            };
          }
        }
      }

      // No matching page found (neither exact nor dynamic)
      return null;
    }

    // Handle non-dynamic page (exact match)
    if (!resolveLayers) {
      return {
        page: matchingPage,
        pageLayers: { layers: [] } as any,
        components: [],
        locale: detectedLocale,
        availableLocales: availableLocales as Locale[] || [],
        translations,
      };
    }

    // Get layers for the matched page
    const { data: pageLayers, error: layersError } = await supabase
      .from('page_layers')
      .select('*')
      .eq('page_id', matchingPage.id)
      .eq('is_published', isPublished)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (layersError) {
      console.error(`Failed to fetch ${isPublished ? 'published' : 'draft'} layers:`, layersError);
      return null;
    }

    // Translate component-instance override values before resolving components,
    // so per-instance translations propagate correctly through the override pipeline.
    const localizedRawLayers = detectedLocale && translations && Object.keys(translations).length > 0
      ? translateComponentOverrides(pageLayers?.layers || [], matchingPage.id, translations, { includeIncomplete: !isPublished })
      : pageLayers?.layers || [];

    const layersWithComponents = resolveComponents(localizedRawLayers, components);

    let resolvedLayers = layersWithComponents.length > 0
      ? await resolveCollectionLayers(layersWithComponents, isPublished, undefined, paginationContext, translations, undefined, timezone)
      : [];

    resolvedLayers = await resolveRichTextCollections(resolvedLayers, components, isPublished, translations);

    // Apply translations (components already resolved above)
    if (detectedLocale && translations && Object.keys(translations).length > 0) {
      resolvedLayers = injectTranslatedText(resolvedLayers, matchingPage.id, translations, { includeIncomplete: !isPublished });
    }

    const resolved = await resolveAllAssets(resolvedLayers, isPublished, components);
    resolvedLayers = resolved.layers;

    return {
      page: matchingPage,
      pageLayers: {
        ...pageLayers,
        layers: resolvedLayers,
      },
      components,
      locale: detectedLocale,
      availableLocales: availableLocales as Locale[] || [],
      translations,
      generatedCss: pageLayers?.generated_css || null,
    };
  } catch (error) {
    console.error('Failed to fetch page:', error);
    return null;
  }
}

export const fetchPageByPath = cache(async function fetchPageByPath(
  slugPath: string,
  isPublished: boolean,
  paginationContext?: PaginationContext,
  tenantId?: string,
): Promise<PageData | null> {
  return fetchPageByPathInternal(slugPath, isPublished, paginationContext, tenantId, { resolveLayers: true });
});

export async function fetchPageByPathForMetadata(
  slugPath: string,
  isPublished: boolean,
  paginationContext?: PaginationContext,
  tenantId?: string,
): Promise<PageData | null> {
  return fetchPageByPathInternal(slugPath, isPublished, paginationContext, tenantId, { resolveLayers: false });
}

/**
 * Fetch error page by error code (404, 401, 500)
 * Works for both draft and published pages
 */
export async function fetchErrorPage(
  errorCode: number,
  isPublished: boolean,
  tenantId?: string
): Promise<PageData | null> {
  try {
    const supabase = await getSupabaseAdmin(tenantId);

    if (!supabase) {
      console.error('Supabase not configured');
      return null;
    }

    // Get all active locales from the database
    const { data: availableLocales } = await supabase
      .from('locales')
      .select('*')
      .eq('is_published', isPublished)
      .is('deleted_at', null);

    // Get the error page
    const { data: errorPage } = await supabase
      .from('pages')
      .select('*')
      .eq('error_page', errorCode)
      .eq('is_published', isPublished)
      .is('deleted_at', null)
      .single();

    if (!errorPage) {
      return null;
    }

    // Get layers for the error page
    const { data: pageLayers, error: layersError } = await supabase
      .from('page_layers')
      .select('*')
      .eq('page_id', errorPage.id)
      .eq('is_published', isPublished)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (layersError) {
      console.error(`Failed to fetch ${isPublished ? 'published' : 'draft'} error page layers:`, layersError);
      return null;
    }

    const components = await fetchComponents(supabase, isPublished);

    // First, resolve components so collection layers inside components are available
    const layersWithComponents = resolveComponents(pageLayers?.layers || [], components);

    // Resolve collection layers server-side (for both draft and published)
    // The isPublished parameter controls which collection items to fetch
    let resolvedLayers = layersWithComponents.length > 0
      ? await resolveCollectionLayers(layersWithComponents, isPublished, undefined, undefined, undefined)
      : [];

    // Resolve collections inside rich text embedded components
    resolvedLayers = await resolveRichTextCollections(resolvedLayers, components, isPublished);

    // Resolve all AssetVariables to URLs server-side (prevents client-side API calls)
    const resolved = await resolveAllAssets(resolvedLayers, isPublished, components);
    resolvedLayers = resolved.layers;

    return {
      page: errorPage,
      pageLayers: {
        ...pageLayers,
        layers: resolvedLayers,
      },
      components, // Layers are pre-resolved; components passed for rich-text embedded rendering
      locale: null, // Error pages don't have locale context
      availableLocales: availableLocales as Locale[] || [],
      translations: {}, // Error pages don't have translations
    };
  } catch (error) {
    console.error('Failed to fetch error page:', error);
    return null;
  }
}

/**
 * Fetch homepage (index page at root level)
 * Works for both draft and published pages
 * @param isPublished - Whether to fetch published or draft version
 * @param paginationContext - Optional pagination context with page numbers from URL
 * @param preloadedComponents - Optional pre-fetched components to avoid redundant queries
 */
export const fetchHomepage = cache(async function fetchHomepage(
  isPublished: boolean,
  paginationContext?: PaginationContext,
  preloadedComponents?: Component[],
  tenantId?: string,
  translations?: Record<string, Translation>
): Promise<Pick<PageData, 'page' | 'pageLayers' | 'components' | 'locale' | 'availableLocales' | 'translations' | 'generatedCss'> | null> {
  try {
    const supabase = await getSupabaseAdmin(tenantId);

    if (!supabase) {
      return null;
    }

    // Fetch locales, homepage, and components in parallel
    const [
      { data: availableLocales },
      { data: homepage },
      componentsResult,
    ] = await Promise.all([
      supabase.from('locales').select('*').eq('is_published', isPublished).is('deleted_at', null),
      supabase.from('pages').select('*').eq('is_index', true).is('page_folder_id', null).eq('is_published', isPublished).is('deleted_at', null).limit(1).single(),
      preloadedComponents ? Promise.resolve(preloadedComponents) : fetchComponents(supabase, isPublished),
    ]);

    if (!homepage) {
      return null;
    }

    const components = componentsResult;

    // Get layers for homepage (depends on homepage.id)
    const { data: pageLayers, error: layersError } = await supabase
      .from('page_layers')
      .select('*')
      .eq('page_id', homepage.id)
      .eq('is_published', isPublished)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (layersError) {
      return null;
    }

    // Translate component-instance override values before resolving components
    // so per-instance translations are applied through the override pipeline.
    const localizedRawLayers = translations && Object.keys(translations).length > 0
      ? translateComponentOverrides(pageLayers?.layers || [], homepage.id, translations, { includeIncomplete: !isPublished })
      : pageLayers?.layers || [];

    const layersWithComponents = resolveComponents(localizedRawLayers, components);

    // Resolve collection layers server-side (for both draft and published)
    let resolvedLayers = layersWithComponents.length > 0
      ? await resolveCollectionLayers(layersWithComponents, isPublished, undefined, paginationContext, translations)
      : [];

    // Resolve collections inside rich text embedded components
    resolvedLayers = await resolveRichTextCollections(resolvedLayers, components, isPublished, translations);

    // Resolve all AssetVariables to URLs server-side (prevents client-side API calls)
    const resolved = await resolveAllAssets(resolvedLayers, isPublished, components);
    resolvedLayers = resolved.layers;

    return {
      page: homepage,
      pageLayers: {
        ...pageLayers,
        layers: resolvedLayers,
      },
      components,
      locale: null,
      availableLocales: availableLocales as Locale[] || [],
      translations: translations || {},
      generatedCss: pageLayers?.generated_css || null,
    };
  } catch (error) {
    return null;
  }
});

/**
 * Fetch all components from the database
 * @param supabase - Supabase client
 * @param isPublished - Whether to fetch published or draft components (defaults to false for draft)
 * @returns Array of components or empty array if fetch fails
 */
async function fetchComponents(supabase: any, isPublished: boolean = false): Promise<Component[]> {
  const { data: components } = await supabase
    .from('components')
    .select('*')
    .eq('is_published', isPublished)
    .is('deleted_at', null);
  return components || [];
}

/**
 * Resolve reference field values by fetching referenced item data
 * Adds referenced item's fields with a prefix based on the field path
 * @param itemValues - Current item values (field_id -> value)
 * @param fields - Collection fields to check for references
 * @param isPublished - Whether to fetch published data
 * @returns Enhanced item values with resolved reference data
 */
async function resolveReferenceFields(
  itemValues: Record<string, string>,
  fields: CollectionField[],
  isPublished: boolean,
  pathPrefix: string = '',
  visited: Set<string> = new Set()
): Promise<Record<string, string>> {
  const enhancedValues = { ...itemValues };

  // Find reference fields (single reference only - multi-reference is used for collection sources)
  const referenceFields = fields.filter(
    f => f.type === 'reference' && f.reference_collection_id
  );

  for (const field of referenceFields) {
    const refItemId = itemValues[field.id];
    if (!refItemId || !field.reference_collection_id) continue;

    // Prevent infinite loops from circular references
    const visitKey = `${field.id}:${refItemId}`;
    if (visited.has(visitKey)) continue;
    visited.add(visitKey);

    try {
      const refItem = await getItemWithValues(refItemId, isPublished);
      if (!refItem) continue;

      const refFields = await getFieldsByCollectionId(field.reference_collection_id, isPublished, { excludeComputed: true });

      // Build the path prefix for this level
      const currentPath = pathPrefix ? `${pathPrefix}.${field.id}` : field.id;

      // Add referenced item's values with the current path as prefix
      // e.g., if field is "Author" with id "abc123", and referenced item has "name" field with id "xyz789"
      // the value becomes accessible as "abc123.xyz789" in the values map
      for (const refField of refFields) {
        const refValue = refItem.values[refField.id];
        if (refValue !== undefined) {
          // Store as: parentFieldId.refFieldId for relationship path resolution
          enhancedValues[`${currentPath}.${refField.id}`] = refValue;
        }
      }

      // Recursively resolve nested reference fields
      const nestedValues = await resolveReferenceFields(
        refItem.values,
        refFields,
        isPublished,
        currentPath,
        visited
      );

      // Merge nested values (they'll have the full path)
      Object.assign(enhancedValues, nestedValues);
    } catch (error) {
      console.error(`Failed to resolve reference field ${field.id}:`, error);
    }
  }

  return enhancedValues;
}

/**
 * Batch-resolve first-level reference fields for many items at once.
 * Instead of N × R individual fetches (one per item per reference field),
 * this collects all unique referenced item IDs and collection schemas
 * upfront, fetches them in 2–3 total queries, then distributes the
 * results — pure computation with no additional I/O.
 *
 * Nested references (depth > 1) are left to the per-item
 * resolveReferenceFields which handles them with low fan-out.
 */
async function batchResolveReferenceFields(
  itemsValues: Record<string, string>[],
  fields: CollectionField[],
  isPublished: boolean,
  dataCache?: CollectionDataCache,
  boundFieldPaths?: Set<string>,
): Promise<Record<string, string>[]> {
  let referenceFields = fields.filter(
    f => f.type === 'reference' && f.reference_collection_id
  );

  // When bound paths are known, only resolve reference fields that appear as a prefix
  if (boundFieldPaths) {
    referenceFields = referenceFields.filter(rf =>
      Array.from(boundFieldPaths).some(p => p.startsWith(rf.id + '.'))
    );
  }

  if (referenceFields.length === 0) return itemsValues;

  const allRefItemIds = new Set<string>();
  const refCollectionIds = new Set<string>();

  for (const values of itemsValues) {
    for (const field of referenceFields) {
      const refId = values[field.id];
      if (refId && field.reference_collection_id) {
        allRefItemIds.add(refId);
        refCollectionIds.add(field.reference_collection_id);
      }
    }
  }

  if (allRefItemIds.size === 0) return itemsValues;

  let refItemsMap: Record<string, CollectionItemWithValues>;
  let refFieldsMap: Map<string, CollectionField[]>;

  if (dataCache) {
    refItemsMap = {};
    for (const itemId of allRefItemIds) {
      const found = dataCache.itemsById.get(itemId);
      if (found) refItemsMap[itemId] = found;
    }
    refFieldsMap = new Map();
    for (const collId of refCollectionIds) {
      const f = dataCache.fieldsByCollection.get(collId);
      if (f) refFieldsMap.set(collId, f);
    }
  } else {
    const [fetchedItems, ...fieldEntries] = await Promise.all([
      getItemsWithValuesByIds(Array.from(allRefItemIds), isPublished),
      ...Array.from(refCollectionIds).map(async (collId) => {
        const f = await getFieldsByCollectionId(collId, isPublished, { excludeComputed: true });
        return [collId, f] as const;
      }),
    ]);
    refItemsMap = fetchedItems;
    refFieldsMap = new Map<string, CollectionField[]>(fieldEntries);
  }

  return itemsValues.map(values => {
    const enhanced = { ...values };

    for (const field of referenceFields) {
      const refId = values[field.id];
      if (!refId || !field.reference_collection_id) continue;

      const refItem = refItemsMap[refId];
      if (!refItem) continue;

      const refFields = refFieldsMap.get(field.reference_collection_id);
      if (!refFields) continue;

      for (const rf of refFields) {
        const dotKey = `${field.id}.${rf.id}`;
        if (boundFieldPaths && !boundFieldPaths.has(dotKey)) continue;
        if (refItem.values[rf.id] !== undefined) {
          enhanced[dotKey] = refItem.values[rf.id];
        }
      }
    }

    return enhanced;
  });
}

/**
 * Inject collection field values into a layer and its children
 * Recursively resolves field variables in text, images, etc.
 * @param layer - Layer to inject data into
 * @param itemValues - Collection item field values (field_id -> value)
 * @param fields - Optional collection fields (for reference field resolution)
 * @param isPublished - Whether fetching published data
 * @param layerDataMap - Map of layer ID → item data for layer-specific resolution
 * @param rawItemValues - Unformatted values (ISO dates) for applying custom format presets
 * @returns Layer with resolved field values
 */
async function injectCollectionData(
  layer: Layer,
  itemValues: Record<string, string>,
  fields?: CollectionField[],
  isPublished: boolean = true,
  layerDataMap?: Record<string, Record<string, string>>,
  rawItemValues?: Record<string, string>,
  timezone: string = 'UTC'
): Promise<Layer> {
  // Callers (resolveCollectionLayers, fetchPageByPath) already run
  // resolveReferenceFields before passing values here. Re-resolving on
  // every recursive child would fire O(N × D × R) redundant Supabase
  // queries that overwhelm the connection and hang the request.
  const enhancedValues = itemValues;

  const updates: Partial<Layer> = {};
  // Start with all original variables; each section overwrites only its own key
  const resolvedVars: Record<string, unknown> = { ...layer.variables };

  // Resolve inline variables in text content
  const textVariable = layer.variables?.text;

  // Handle DynamicRichTextVariable (Tiptap JSON with dynamicVariable nodes)
  if (textVariable && textVariable.type === 'dynamic_rich_text') {
    const content = textVariable.data.content;
    if (content && typeof content === 'object') {
      const restrictiveBlockTags = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'a', 'button'];
      const currentTag = layer.settings?.tag || layer.name || 'div';
      if (restrictiveBlockTags.includes(currentTag) &&
          hasBlockElementsInInlineVariables(content, enhancedValues)) {
        updates.settings = {
          ...layer.settings,
          tag: 'div',
        };
      }

      const resolvedContent = resolveRichTextVariables(content, enhancedValues, layerDataMap, rawItemValues, timezone);
      resolvedVars.text = {
        type: 'dynamic_rich_text',
        data: { content: resolvedContent },
      };
    }
  }
  // Handle DynamicTextVariable (legacy string format with inline variable tags)
  else if (textVariable && textVariable.type === 'dynamic_text') {
    const textContent = textVariable.data.content;
    if (textContent.includes('<ycode-inline-variable>')) {
      const mockItem: CollectionItemWithValues = {
        id: 'temp',
        collection_id: 'temp',
        created_at: '',
        updated_at: '',
        deleted_at: null,
        manual_order: 0,
        is_published: true,
        is_publishable: true,
        content_hash: null,
        values: enhancedValues,
      };
      const resolved = resolveInlineVariablesWithRelationships(textContent, mockItem, timezone, rawItemValues);

      resolvedVars.text = {
        type: 'dynamic_text',
        data: { content: resolved },
      };
    }
  }

  // Image src field binding (variables structure)
  const imageSrc = layer.variables?.image?.src;
  if (imageSrc && isFieldVariable(imageSrc) && imageSrc.data.field_id) {
    const resolvedValue = resolveFieldValueWithRelationships(imageSrc, enhancedValues, layerDataMap);
    resolvedVars.image = {
      src: createResolvedAssetVariable(imageSrc.data.field_id, resolvedValue, imageSrc),
      alt: layer.variables?.image?.alt || createDynamicTextVariable(''),
    };
  }

  // Video src field binding (variables structure)
  const videoSrc = layer.variables?.video?.src;
  if (videoSrc && isFieldVariable(videoSrc) && videoSrc.data.field_id) {
    const resolvedValue = resolveFieldValueWithRelationships(videoSrc, enhancedValues, layerDataMap);
    resolvedVars.video = {
      ...layer.variables?.video,
      src: createResolvedAssetVariable(videoSrc.data.field_id, resolvedValue, videoSrc),
    };
  }

  // Audio src field binding (variables structure)
  const audioSrc = layer.variables?.audio?.src;
  if (audioSrc && isFieldVariable(audioSrc) && audioSrc.data.field_id) {
    const resolvedValue = resolveFieldValueWithRelationships(audioSrc, enhancedValues, layerDataMap);
    resolvedVars.audio = {
      ...layer.variables?.audio,
      src: createResolvedAssetVariable(audioSrc.data.field_id, resolvedValue, audioSrc),
    };
  }

  // Background image src field binding (variables structure)
  const bgImageSrc = layer.variables?.backgroundImage?.src;
  if (bgImageSrc && isFieldVariable(bgImageSrc) && bgImageSrc.data.field_id) {
    const resolvedValue = resolveFieldValueWithRelationships(bgImageSrc, enhancedValues, layerDataMap);
    resolvedVars.backgroundImage = {
      src: createResolvedAssetVariable(bgImageSrc.data.field_id, resolvedValue, bgImageSrc),
    };
  }

  // Lightbox CMS field binding — resolve filesField to concrete asset IDs/URLs
  const lightboxSettings = layer.settings?.lightbox;
  if (lightboxSettings?.filesSource === 'cms' && lightboxSettings.filesField && isFieldVariable(lightboxSettings.filesField)) {
    const resolvedValue = resolveFieldValueWithRelationships(lightboxSettings.filesField, enhancedValues, layerDataMap);
    if (resolvedValue) {
      // The value can be a single asset ID, a comma-separated list, or a JSON array
      let resolvedFiles: string[];
      try {
        const parsed = JSON.parse(resolvedValue);
        resolvedFiles = Array.isArray(parsed) ? parsed : [resolvedValue];
      } catch {
        resolvedFiles = resolvedValue.includes(',')
          ? resolvedValue.split(',').map(s => s.trim()).filter(Boolean)
          : [resolvedValue];
      }
      updates.settings = {
        ...layer.settings,
        ...updates.settings,
        lightbox: {
          ...lightboxSettings,
          files: resolvedFiles,
        },
      };
    }
  }

  // Link field binding — pre-resolve raw value so it survives stripSSROnlyData
  const linkVar = layer.variables?.link;
  if (linkVar?.type === 'field' && linkVar.field?.data?.field_id) {
    const resolvedValue = resolveFieldValueWithRelationships(linkVar.field, enhancedValues, layerDataMap);
    if (resolvedValue) {
      resolvedVars.link = {
        ...linkVar,
        field: {
          ...linkVar.field,
          data: {
            ...linkVar.field.data,
            _resolvedValue: resolvedValue,
          },
        },
      };
    }
  }

  // Design color field bindings → inline styles (supports solid + gradient)
  const designBindings = layer.variables?.design as Record<string, DesignColorVariable> | undefined;
  if (designBindings) {
    const dynamicStyles = resolveDesignStyles(designBindings, (fieldVar) =>
      resolveFieldValueWithRelationships(fieldVar, enhancedValues, layerDataMap)
    );
    if (dynamicStyles) {
      updates._dynamicStyles = dynamicStyles;
    }
  }

  // Assign all resolved variables
  updates.variables = resolvedVars as Layer['variables'];

  // Recursively process children, but SKIP collection layers
  // Collection layers will be processed by resolveCollectionLayers with their own item data
  if (layer.children) {
    const resolvedChildren = await Promise.all(
      layer.children.map(child => {
        // Skip collection layers - they'll be processed separately with correct per-item data
        if (child.variables?.collection?.id) {
          return Promise.resolve(child);
        }
        return injectCollectionData(child, enhancedValues, fields, isPublished, layerDataMap, rawItemValues, timezone);
      })
    );
    updates.children = resolvedChildren;
  }

  return {
    ...layer,
    ...updates,
  };
}

/**
 * Resolve inline variables with support for relationship paths
 * e.g., {"type":"field","data":{"field_id":"authorId","relationships":["nameFieldId"]}}
 */
function resolveInlineVariablesWithRelationships(
  text: string,
  collectionItem: CollectionItemWithValues,
  timezone: string = 'UTC',
  rawValues?: Record<string, string>
): string {
  if (!collectionItem || !collectionItem.values) {
    return text;
  }

  const regex = /<ycode-inline-variable>([\s\S]*?)<\/ycode-inline-variable>/g;
  return text.replace(regex, (match, variableContent) => {
    try {
      const parsed = JSON.parse(variableContent.trim());

      if (parsed.type === 'field' && parsed.data?.field_id) {
        const fieldId = parsed.data.field_id;
        const relationships = parsed.data.relationships || [];

        // Build the full path for relationship resolution
        const fullPath = relationships.length > 0
          ? [fieldId, ...relationships].join('.')
          : fieldId;

        const fieldValue = collectionItem.values[fullPath];
        if (parsed.data.format && fieldValue) {
          // Use raw (unformatted ISO) values for custom format presets,
          // since itemValues are pre-formatted by formatDateFieldsInItemValues
          const rawValue = rawValues?.[fullPath] ?? fieldValue;
          return formatFieldValue(rawValue, parsed.data.field_type, timezone, parsed.data.format);
        }
        return fieldValue || '';
      }
    } catch {
      // Invalid JSON or not a field variable, leave as is
    }

    return match;
  });
}

/**
 * Resolve field value with support for relationship paths and layer-specific data
 * @param fieldVariable - The field variable with field_id, relationships, and optional collection_layer_id
 * @param itemValues - Current item values
 * @param layerDataMap - Optional map of layer ID → item data for layer-specific resolution
 */
function resolveFieldValueWithRelationships(
  fieldVariable: { type: 'field'; data: { field_id: string | null; relationships?: string[]; format?: string; collection_layer_id?: string } },
  itemValues: Record<string, string>,
  layerDataMap?: Record<string, Record<string, string>>
): string | undefined {
  const { field_id, relationships = [], collection_layer_id } = fieldVariable.data;
  if (!field_id) {
    return undefined;
  }

  // Build the full path for relationship resolution
  const fullPath = relationships.length > 0
    ? [field_id, ...relationships].join('.')
    : field_id;

  // Use layer-specific data if collection_layer_id is specified
  if (collection_layer_id && layerDataMap?.[collection_layer_id]) {
    return layerDataMap[collection_layer_id][fullPath];
  }

  return itemValues[fullPath];
}

/**
 * Check if rich text content contains block elements from inline variables
 * Wrapper around shared utility that provides a resolver for page-fetcher's data format
 */
function hasBlockElementsInInlineVariables(
  content: any,
  itemValues: Record<string, string>
): boolean {
  const resolveValue = (fieldId: string, relationships?: string[]) => {
    const lookupKey = relationships && relationships.length > 0
      ? [fieldId, ...relationships].join('.')
      : fieldId;
    return itemValues[lookupKey];
  };

  return hasBlockElementsWithResolver(content, resolveValue);
}

/**
 * Resolve dynamicVariable nodes in Tiptap JSON content
 * Traverses the content tree and replaces variable nodes with resolved text
 * For rich_text fields, inline the nested Tiptap content
 * @param layerDataMap - Optional map of layer ID → item data for layer-specific resolution
 * @param rawItemValues - Unformatted values (ISO dates) for applying custom format presets
 */
function resolveRichTextVariables(
  content: any,
  itemValues: Record<string, string>,
  layerDataMap?: Record<string, Record<string, string>>,
  rawItemValues?: Record<string, string>,
  timezone: string = 'UTC'
): any {
  if (!content || typeof content !== 'object') {
    return content;
  }

  // Handle dynamicVariable node - replace with resolved content
  if (content.type === 'dynamicVariable') {
    const variable = content.attrs?.variable;
    if (variable?.type === 'field' && variable.data?.field_id) {
      const fieldId = variable.data.field_id;
      const fieldType = variable.data.field_type;
      const relationships = variable.data.relationships || [];
      const collectionLayerId = variable.data.collection_layer_id;

      // Build field path
      const fullPath = relationships.length > 0
        ? [fieldId, ...relationships].join('.')
        : fieldId;

      // Resolve value: use layer-specific data if collection_layer_id is specified
      let value: any;
      if (collectionLayerId && layerDataMap?.[collectionLayerId]) {
        value = layerDataMap[collectionLayerId][fullPath];
      } else {
        value = itemValues[fullPath];
      }

      // Handle rich_text fields - preserve block structure for proper rendering
      if (fieldType === 'rich_text' && isTiptapDoc(value)) {
        const resolvedBlocks = value.content.map((block: any) =>
          resolveRichTextVariables(block, itemValues, layerDataMap, rawItemValues, timezone)
        );
        return resolvedBlocks.flat();
      }

      // Fallback for rich_text that's not a valid doc structure
      if (fieldType === 'rich_text' && value && typeof value === 'object') {
        return {
          type: 'text',
          text: JSON.stringify(value),
          marks: content.marks || [],
        };
      }

      // Apply custom format using raw (unformatted) values when available
      // Date values in itemValues are pre-formatted by formatDateFieldsInItemValues,
      // so custom format presets need the original ISO string from rawItemValues
      const format = variable.data.format;
      let textValue: string;
      if (format && rawItemValues) {
        const rawValue = rawItemValues[fullPath];
        textValue = rawValue != null
          ? formatFieldValue(rawValue, fieldType, timezone, format)
          : (value != null ? String(value) : '');
      } else {
        textValue = value != null ? String(value) : '';
      }

      return {
        type: 'text',
        text: textValue,
        marks: content.marks || [],
      };
    }
    return { type: 'text', text: '', marks: content.marks || [] };
  }

  // Recursively process content array
  if (Array.isArray(content)) {
    // Flatten arrays that may contain nested arrays from rich_text expansion
    return content.flatMap(node => {
      const resolved = resolveRichTextVariables(node, itemValues, layerDataMap, rawItemValues, timezone);
      return Array.isArray(resolved) ? resolved : [resolved];
    });
  }

  // Recursively process object properties
  const result: any = {};
  for (const key of Object.keys(content)) {
    if (key === 'content' && Array.isArray(content[key])) {
      // Flatten the content array in case of expanded rich_text nodes
      result[key] = content[key].flatMap((node: any) => {
        const resolved = resolveRichTextVariables(node, itemValues, layerDataMap, rawItemValues, timezone);
        return Array.isArray(resolved) ? resolved : [resolved];
      });
    } else if (typeof content[key] === 'object' && content[key] !== null) {
      result[key] = resolveRichTextVariables(content[key], itemValues, layerDataMap, rawItemValues, timezone);
    } else {
      result[key] = content[key];
    }
  }

  // When a rich_text variable expands inside a paragraph, the expansion
  // produces block-level nodes (paragraphs, headings, components) inside
  // the paragraph — lift them out so the parent doc gets proper blocks.
  // Any surrounding inline nodes are grouped into new paragraphs.
  if (result.type === 'paragraph' && Array.isArray(result.content)) {
    const isBlockNode = (n: any) =>
      n?.type === 'paragraph' || n?.type === 'heading' ||
      n?.type === 'bulletList' || n?.type === 'orderedList' ||
      n?.type === 'richTextComponent' || n?.type === 'richTextImage' ||
      n?.type === 'table' || n?.type === 'richTextHtmlEmbed' || n?.type === 'horizontalRule';
    const hasBlockChildren = result.content.some(isBlockNode);
    if (hasBlockChildren) {
      const lifted: any[] = [];
      let currentInline: any[] = [];
      for (const node of result.content) {
        if (isBlockNode(node)) {
          if (currentInline.length > 0) {
            lifted.push({ type: 'paragraph', content: currentInline });
            currentInline = [];
          }
          lifted.push(node);
        } else {
          currentInline.push(node);
        }
      }
      if (currentInline.length > 0) {
        lifted.push({ type: 'paragraph', content: currentInline });
      }
      return lifted;
    }
  }

  return result;
}

/**
 * Walk Tiptap JSON nodes, resolve collections inside richTextComponent nodes,
 * and store the result as `_resolvedLayers` so the renderer can use them directly.
 * Tracks ancestor component IDs to prevent infinite circular resolution.
 */
async function resolveTiptapComponentCollections(
  content: any,
  components: Component[],
  isPublished: boolean,
  translations?: Record<string, Translation>,
  ancestorComponentIds?: Set<string>,
): Promise<any> {
  if (!content || typeof content !== 'object') return content;

  if (Array.isArray(content)) {
    let changed = false;
    const result = await Promise.all(
      content.map(async (node: any) => {
        const resolved = await resolveTiptapComponentCollections(node, components, isPublished, translations, ancestorComponentIds);
        if (resolved !== node) changed = true;
        return resolved;
      })
    );
    return changed ? result : content;
  }

  let nodeChanged = false;
  let node = content;

  // Resolve richTextComponent nodes
  if (node.type === 'richTextComponent' && node.attrs?.componentId) {
    const componentId = node.attrs.componentId as string;

    // Prevent circular resolution (component embedding itself)
    if (!ancestorComponentIds?.has(componentId)) {
      const comp = components.find(c => c.id === componentId);
      // Pick the variant the rich-text node is bound to (falls back to the
      // first/Default variant when no variant is selected or the requested
      // one was deleted).
      const compVariantLayers = comp ? getComponentVariantLayers(comp, node.attrs.componentVariantId) : [];
      if (comp && compVariantLayers.length) {
        const childAncestors = new Set(ancestorComponentIds);
        childAncestors.add(componentId);

        const overrides = node.attrs.componentOverrides ?? undefined;
        const withOverrides = applyComponentOverrides(compVariantLayers, overrides, comp.variables);
        const withComponents = resolveComponents(withOverrides, components, comp.variables, overrides);
        const withCollections = await resolveCollectionLayers(withComponents, isPublished, undefined, undefined, translations);

        // Recursively resolve rich text components inside the resolved layers
        // (handles Component A → rich text → Component B → collection)
        const fullyResolved = await resolveRichTextCollections(
          withCollections, components, isPublished, translations, childAncestors,
        );

        node = {
          ...node,
          attrs: { ...node.attrs, _resolvedLayers: fullyResolved },
        };
        nodeChanged = true;
      }
    }
  }

  // Recurse into content array
  if (Array.isArray(node.content)) {
    const resolvedContent = await resolveTiptapComponentCollections(node.content, components, isPublished, translations, ancestorComponentIds);
    if (resolvedContent !== node.content) {
      node = { ...node, content: resolvedContent };
      nodeChanged = true;
    }
  }

  return nodeChanged ? node : content;
}

/**
 * Pre-resolve collections inside rich text embedded components.
 * Walks all layers, finds dynamic_rich_text variables with richTextComponent nodes,
 * and resolves their collection layers server-side.
 * Tracks ancestor component IDs to prevent infinite circular resolution.
 */
export async function resolveRichTextCollections(
  layers: Layer[],
  components: Component[],
  isPublished: boolean,
  translations?: Record<string, Translation>,
  ancestorComponentIds?: Set<string>,
): Promise<Layer[]> {
  if (!components.length) return layers;

  const resolveLayer = async (layer: Layer): Promise<Layer> => {
    let updated = layer;

    // Check if this layer has rich text with potential embedded components
    const textVar = layer.variables?.text;
    if (textVar?.type === 'dynamic_rich_text' && textVar.data?.content) {
      const resolved = await resolveTiptapComponentCollections(
        textVar.data.content, components, isPublished, translations, ancestorComponentIds,
      );
      if (resolved !== textVar.data.content) {
        updated = {
          ...updated,
          variables: {
            ...updated.variables,
            text: { type: 'dynamic_rich_text', data: { content: resolved } },
          },
        };
      }
    }

    // Recurse into children
    if (updated.children?.length) {
      const resolvedChildren = await Promise.all(
        updated.children.map(child => resolveLayer(child))
      );
      if (resolvedChildren.some((c, i) => c !== updated.children![i])) {
        updated = { ...updated, children: resolvedChildren };
      }
    }

    return updated;
  };

  return Promise.all(layers.map(resolveLayer));
}

interface CollectionDataCache {
  itemsByCollection: Map<string, CollectionItemWithValues[]>;
  totalByCollection: Map<string, number>;
  fieldsByCollection: Map<string, CollectionField[]>;
  fieldTypeMap: Record<string, string>;
  itemsById: Map<string, CollectionItemWithValues>;
}

/**
 * Scan a collection layer's child template and return every CMS field ID
 * that is actually referenced (bound) in the subtree.
 *
 * Returns two sets:
 *  - fieldIds:  simple UUIDs (for DB-level WHERE field_id IN filtering)
 *  - fieldPaths: full dot-separated paths like "refFieldId.targetFieldId"
 *                (for filtering enhancedValues after reference expansion)
 *
 * Stops recursion at child layers that define their own collection scope.
 */
function collectBoundFieldIds(layers: Layer[]): { fieldIds: Set<string>; fieldPaths: Set<string> } {
  const fieldIds = new Set<string>();
  const fieldPaths = new Set<string>();

  function addFieldVariable(fv: { type: 'field'; data: { field_id: string | null; relationships?: string[] } }) {
    const fid = fv.data.field_id;
    if (!fid) return;
    fieldIds.add(fid);
    const rels = fv.data.relationships || [];
    fieldPaths.add(rels.length > 0 ? [fid, ...rels].join('.') : fid);
  }

  function scanInlineVariableTags(html: string) {
    const regex = /<ycode-inline-variable>([\s\S]*?)<\/ycode-inline-variable>/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(html)) !== null) {
      try {
        const parsed = JSON.parse(m[1].trim());
        if (parsed.type === 'field' && parsed.data?.field_id) {
          addFieldVariable(parsed);
        }
      } catch { /* skip malformed */ }
    }
  }

  function scanTiptapNode(node: any) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'dynamicVariable') {
      const v = node.attrs?.variable;
      if (v?.type === 'field' && v.data?.field_id) addFieldVariable(v);
    }
    // richTextLink marks can reference fields (attrs.field is a full FieldVariable)
    if (Array.isArray(node.marks)) {
      for (const mark of node.marks) {
        if (mark.type === 'richTextLink' && mark.attrs) {
          const fv = mark.attrs.field;
          if (fv?.type === 'field' && fv.data?.field_id) addFieldVariable(fv);
          // Also scan inline variables in url/email/phone dynamic text attrs
          for (const k of ['url', 'email', 'phone']) {
            const lv = mark.attrs[k];
            if (lv?.type === 'dynamic_text' && lv.data?.content) {
              scanInlineVariableTags(lv.data.content);
            }
          }
        }
      }
    }
    if (Array.isArray(node.content)) node.content.forEach(scanTiptapNode);
  }

  function scanDesignColorVariable(dcv: any) {
    if (!dcv || typeof dcv !== 'object') return;
    if (dcv.field?.type === 'field') addFieldVariable(dcv.field);
    for (const stops of [dcv.linear?.stops, dcv.radial?.stops]) {
      if (Array.isArray(stops)) {
        for (const stop of stops) {
          if (stop.field?.type === 'field') addFieldVariable(stop.field);
        }
      }
    }
  }

  function scanLayer(layer: Layer) {
    const vars = layer.variables;
    if (!vars) {
      if (layer.children) {
        for (const child of layer.children) {
          if (child.variables?.collection?.id) continue;
          scanLayer(child);
        }
      }
      return;
    }

    // --- text ---
    const tv = vars.text;
    if (tv?.type === 'dynamic_text') {
      scanInlineVariableTags(tv.data.content);
    } else if (tv?.type === 'dynamic_rich_text' && tv.data.content) {
      scanTiptapNode(tv.data.content);
    }

    // --- image.src / image.alt ---
    const img = vars.image;
    if (img?.src?.type === 'field') addFieldVariable(img.src as any);
    if (img?.alt?.type === 'dynamic_text') scanInlineVariableTags((img.alt as any).data.content);

    // --- video.src / video.poster ---
    if (vars.video?.src?.type === 'field') addFieldVariable(vars.video.src as any);
    if (vars.video?.poster?.type === 'field') addFieldVariable(vars.video.poster as any);

    // --- audio.src ---
    if (vars.audio?.src?.type === 'field') addFieldVariable(vars.audio.src as any);

    // --- backgroundImage.src ---
    if (vars.backgroundImage?.src?.type === 'field') addFieldVariable(vars.backgroundImage.src as any);

    // --- link.field ---
    if (vars.link?.field?.type === 'field') addFieldVariable(vars.link.field);

    // --- link.url / link.email / link.phone (dynamic text with inline vars) ---
    for (const k of ['url', 'email', 'phone'] as const) {
      const lv = (vars.link as any)?.[k];
      if (lv?.type === 'dynamic_text') scanInlineVariableTags(lv.data.content);
    }

    // --- iframe.src ---
    if (vars.iframe?.src?.type === 'dynamic_text') scanInlineVariableTags(vars.iframe.src.data.content);

    // --- lightbox filesField ---
    const lbf = layer.settings?.lightbox?.filesField;
    if (lbf?.type === 'field') addFieldVariable(lbf as any);

    // --- design color bindings ---
    if (vars.design) {
      for (const dcv of Object.values(vars.design)) {
        scanDesignColorVariable(dcv);
      }
    }

    // --- conditionalVisibility ---
    if (vars.conditionalVisibility?.groups) {
      for (const g of vars.conditionalVisibility.groups) {
        for (const c of g.conditions) {
          if (c.fieldId) {
            fieldIds.add(c.fieldId);
            fieldPaths.add(c.fieldId);
          }
        }
      }
    }

    // --- collection filters & sort (on the collection layer itself) ---
    if (vars.collection) {
      const col = vars.collection;
      if (col.filters?.groups) {
        for (const g of col.filters.groups) {
          for (const c of g.conditions) {
            if (c.fieldId) {
              fieldIds.add(c.fieldId);
              fieldPaths.add(c.fieldId);
            }
          }
        }
      }
      if (col.sort_by && col.sort_by !== 'none' && col.sort_by !== 'manual' && col.sort_by !== 'random') {
        fieldIds.add(col.sort_by);
        fieldPaths.add(col.sort_by);
      }
      if (col.source_field_id) {
        fieldIds.add(col.source_field_id);
        fieldPaths.add(col.source_field_id);
      }
    }

    // --- settings.optionsSource.sortFieldId ---
    if (layer.settings?.optionsSource?.sortFieldId) {
      fieldIds.add(layer.settings.optionsSource.sortFieldId);
      fieldPaths.add(layer.settings.optionsSource.sortFieldId);
    }

    // Recurse into children, but stop at layers that start a new collection scope
    if (layer.children) {
      for (const child of layer.children) {
        if (child.variables?.collection?.id) continue;
        scanLayer(child);
      }
    }
  }

  layers.forEach(scanLayer);
  return { fieldIds, fieldPaths };
}

function collectAllCollectionIds(layers: Layer[]): Set<string> {
  const ids = new Set<string>();
  const scan = (layer: Layer) => {
    if (layer.variables?.collection?.id) ids.add(layer.variables.collection.id);
    if (layer.settings?.optionsSource?.collectionId) ids.add(layer.settings.optionsSource.collectionId);
    if (layer.children) layer.children.forEach(scan);
  };
  layers.forEach(scan);
  return ids;
}

async function buildCollectionCache(
  collectionIds: Set<string>,
  isPublished: boolean,
  boundFieldIds?: Set<string>,
  boundFieldPaths?: Set<string>,
  boundCollectionIds?: Set<string>,
): Promise<CollectionDataCache> {
  const empty: CollectionDataCache = {
    itemsByCollection: new Map(), totalByCollection: new Map(),
    fieldsByCollection: new Map(), fieldTypeMap: {}, itemsById: new Map(),
  };
  if (collectionIds.size === 0) return empty;

  const client = await getSupabaseAdmin();
  if (!client) return empty;

  // Warm direct DB connection in parallel so first-hit value queries don't pay
  // connection setup cost on the critical path.
  const warmKnexPromise = getKnexClient()
    .then(knex => knex.raw('select 1'))
    .catch(() => null);

  const ids = Array.from(collectionIds);

  // Phase 1: Fetch fields for all collections (needed to discover reference collections)
  const { data: nonComputedFieldsData } = await client
    .from('collection_fields')
    .select('*')
    .in('collection_id', ids)
    .eq('is_published', isPublished)
    .is('deleted_at', null)
    .eq('is_computed', false)
    .order('order', { ascending: true })
    .limit(5000);

  // Count fields are computed but their config is needed during render so layers
  // bound to a count value can resolve correctly. Pull them in alongside the
  // regular fields. Other computed types (e.g. status) are still excluded.
  const { data: countFieldsData } = await client
    .from('collection_fields')
    .select('*')
    .in('collection_id', ids)
    .eq('is_published', isPublished)
    .is('deleted_at', null)
    .eq('type', 'count')
    .limit(5000);

  const fieldsData = [...(nonComputedFieldsData || []), ...(countFieldsData || [])];

  // Discover referenced collections so we can pre-fetch their data too.
  // When boundFieldIds is supplied, only follow reference fields that are bound.
  const refCollectionIds: string[] = [];
  const refFieldIdToCollectionId = new Map<string, string>();
  for (const f of fieldsData || []) {
    if (f.type === 'reference' && f.reference_collection_id && !collectionIds.has(f.reference_collection_id)) {
      if (!boundFieldIds || boundFieldIds.has(f.id)) {
        refCollectionIds.push(f.reference_collection_id);
        refFieldIdToCollectionId.set(f.id, f.reference_collection_id);
      }
    }
  }

  // Build per-referenced-collection field filters from bound fieldPaths.
  // For a path "refFieldId.targetFieldId", targetFieldId is needed from the ref collection.
  const refCollectionBoundFieldIds = new Map<string, Set<string>>();
  if (boundFieldPaths) {
    for (const path of boundFieldPaths) {
      const parts = path.split('.');
      if (parts.length >= 2) {
        const refFieldId = parts[0];
        const targetFieldId = parts[1];
        const refCollId = refFieldIdToCollectionId.get(refFieldId);
        if (refCollId) {
          if (!refCollectionBoundFieldIds.has(refCollId)) refCollectionBoundFieldIds.set(refCollId, new Set());
          refCollectionBoundFieldIds.get(refCollId)!.add(targetFieldId);
        }
      }
    }
  }

  // Phase 2: Fetch ref collection fields + items in parallel.
  // Items are fetched per-collection because a single `.in('collection_id', [...])`
  // query is bounded by Supabase/PostgREST's `db-max-rows` setting (often 1000),
  // so a large collection can starve smaller ones in the same page.
  const allCollIds = [...ids, ...refCollectionIds];
  const PER_COLLECTION_LIMIT = 5000;

  const buildItemsQuery = (collectionId: string) => {
    let q = client
      .from('collection_items')
      .select('*')
      .eq('collection_id', collectionId)
      .eq('is_published', isPublished)
      .is('deleted_at', null)
      .order('manual_order', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(PER_COLLECTION_LIMIT);
    if (isPublished) q = q.eq('is_publishable', true);
    return q;
  };

  const itemsPromise = Promise.all(allCollIds.map(buildItemsQuery))
    .then(results => ({
      data: results.flatMap(r => r.data || []),
      error: results.find(r => r.error)?.error,
    }));

  const refFieldsPromise = refCollectionIds.length > 0
    ? client.from('collection_fields').select('*')
      .in('collection_id', refCollectionIds)
      .eq('is_published', isPublished)
      .is('deleted_at', null)
      .eq('is_computed', false)
      .order('order', { ascending: true })
      .limit(5000)
    : Promise.resolve({ data: [] as any[] });

  const [{ data: itemsData }, { data: refFieldsRaw }] = await Promise.all([itemsPromise, refFieldsPromise]);

  // Build field structures
  const allFieldsData = [...(fieldsData || []), ...(refFieldsRaw || [])];
  const fieldsByCollection = new Map<string, CollectionField[]>();
  const fieldTypeMap: Record<string, string> = {};
  for (const f of allFieldsData) {
    if (!fieldsByCollection.has(f.collection_id)) fieldsByCollection.set(f.collection_id, []);
    fieldsByCollection.get(f.collection_id)!.push(f);
    fieldTypeMap[f.id] = f.type;
  }

  // Phase 3: Fetch values — filter by bound field IDs when available
  await warmKnexPromise;

  // Partition items: bound primary (have field filter) vs unbound primary (optionsSource etc.) vs ref
  const boundPrimaryItemIds: string[] = [];
  const unboundPrimaryItemIds: string[] = [];
  const refItemIds: string[] = [];
  for (const item of itemsData || []) {
    if (!collectionIds.has(item.collection_id)) {
      refItemIds.push(item.id);
    } else if (boundCollectionIds?.has(item.collection_id)) {
      boundPrimaryItemIds.push(item.id);
    } else {
      unboundPrimaryItemIds.push(item.id);
    }
  }

  // Slug fields are always needed for URL building
  const slugFieldIds: string[] = [];
  for (const [, fields] of fieldsByCollection) {
    const slug = fields.find(f => f.key === 'slug');
    if (slug) slugFieldIds.push(slug.id);
  }

  // Build the field filter for primary collection items
  let primaryFieldFilter: string[] | undefined;
  if (boundFieldIds && boundFieldIds.size > 0) {
    const merged = new Set(boundFieldIds);
    for (const sid of slugFieldIds) merged.add(sid);
    primaryFieldFilter = Array.from(merged);
  }

  // Build per-ref-collection field filter and merge into a single array for the batch call
  let refFieldFilter: string[] | undefined;
  if (refCollectionBoundFieldIds.size > 0) {
    const merged = new Set<string>();
    for (const [, fids] of refCollectionBoundFieldIds) {
      for (const fid of fids) merged.add(fid);
    }
    for (const sid of slugFieldIds) merged.add(sid);
    refFieldFilter = Array.from(merged);
  }

  // Fetch values: filtered for bound collections, unfiltered for optionsSource/other collections
  const valueFetches: Promise<Record<string, Record<string, any>>>[] = [];
  if (boundPrimaryItemIds.length > 0) {
    valueFetches.push(getValuesByItemIds(boundPrimaryItemIds, isPublished, fieldTypeMap, primaryFieldFilter));
  }
  if (unboundPrimaryItemIds.length > 0) {
    valueFetches.push(getValuesByItemIds(unboundPrimaryItemIds, isPublished, fieldTypeMap));
  }
  if (refItemIds.length > 0) {
    valueFetches.push(getValuesByItemIds(refItemIds, isPublished, fieldTypeMap, refFieldFilter));
  }
  const valuesByItem: Record<string, Record<string, any>> = {};
  if (valueFetches.length > 0) {
    const results = await Promise.all(valueFetches);
    for (const r of results) Object.assign(valuesByItem, r);
  }

  // Build items-with-values grouped by collection + flat index
  const itemsByCollection = new Map<string, CollectionItemWithValues[]>();
  const totalByCollection = new Map<string, number>();
  const itemsById = new Map<string, CollectionItemWithValues>();

  for (const item of itemsData || []) {
    const withValues: CollectionItemWithValues = { ...item, values: valuesByItem[item.id] || {} };
    if (!itemsByCollection.has(item.collection_id)) {
      itemsByCollection.set(item.collection_id, []);
      totalByCollection.set(item.collection_id, 0);
    }
    itemsByCollection.get(item.collection_id)!.push(withValues);
    totalByCollection.set(item.collection_id, totalByCollection.get(item.collection_id)! + 1);
    itemsById.set(item.id, withValues);
  }

  // Ensure every requested collection has an entry
  for (const id of allCollIds) {
    if (!itemsByCollection.has(id)) { itemsByCollection.set(id, []); totalByCollection.set(id, 0); }
    if (!fieldsByCollection.has(id)) fieldsByCollection.set(id, []);
  }

  return { itemsByCollection, totalByCollection, fieldsByCollection, fieldTypeMap, itemsById };
}

/** Return a shallow copy of `layer` without its `children`. */
function stripChildren(layer: Layer): Omit<Layer, 'children'> {
  const { children: _children, ...rest } = layer;
  return rest;
}

/**
 * Resolve collection layers server-side by fetching their data.
 * Recursively traverses the layer tree and injects collection items.
 * @param layers - Layer tree to resolve
 * @param isPublished - Whether to fetch published or draft items
 * @param parentItemValues - Optional parent item values for multi-reference filtering
 * @param paginationContext - Optional pagination context with page numbers
 * @param translations - Optional translations map for CMS field translations
 */
export async function resolveCollectionLayers(
  layers: Layer[],
  isPublished: boolean,
  parentItemValues?: Record<string, string>,
  paginationContext?: PaginationContext,
  translations?: Record<string, Translation>,
  parentCollectionItemId?: string,
  timezone?: string,
): Promise<Layer[]> {
  // Reuse caller-provided timezone, or fetch once for the entire tree
  if (!timezone) {
    timezone = (await getSettingByKey('timezone') as string | null) || 'UTC';
  }

  // Scan all collection layers to determine which field IDs are actually used in templates
  const allCollectionIds = collectAllCollectionIds(layers);
  const mergedBoundFieldIds = new Set<string>();
  const mergedBoundFieldPaths = new Set<string>();
  const boundFieldPathsByLayerId = new Map<string, Set<string>>();
  const scannedCollectionIds = new Set<string>();

  function scanCollectionLayersForBounds(layerList: Layer[]) {
    for (const layer of layerList) {
      if (layer.variables?.collection?.id) {
        const { fieldIds: fids, fieldPaths: fpaths } = collectBoundFieldIds([layer]);
        for (const fid of fids) mergedBoundFieldIds.add(fid);
        for (const fp of fpaths) mergedBoundFieldPaths.add(fp);
        boundFieldPathsByLayerId.set(layer.id, fpaths);
        scannedCollectionIds.add(layer.variables.collection.id);
      }
      if (layer.children) scanCollectionLayersForBounds(layer.children);
    }
  }
  scanCollectionLayersForBounds(layers);

  // Pre-fetch all collection data in bulk, filtered to bound fields
  const cache = await buildCollectionCache(
    allCollectionIds,
    isPublished,
    mergedBoundFieldIds.size > 0 ? mergedBoundFieldIds : undefined,
    mergedBoundFieldPaths.size > 0 ? mergedBoundFieldPaths : undefined,
    scannedCollectionIds.size > 0 ? scannedCollectionIds : undefined,
  );

  // Inject computed count field values into the cached items so layers bound
  // to a count field render the live number on SSR. Counts always reflect
  // published child items, regardless of the surrounding `isPublished` mode.
  for (const [collId, items] of cache.itemsByCollection) {
    if (items.length === 0) continue;
    await enrichItemsWithCountValues(items, collId, isPublished);
  }

  const resolveLayer = async (
    layer: Layer,
    itemValues?: Record<string, string>,
    parentLayerDataMap?: Record<string, Record<string, string>>,
    parentItemId?: string
  ): Promise<Layer> => {
    // Merge parent's layer data map with layer's own map
    const layerDataMap = { ...parentLayerDataMap, ...(layer._layerDataMap || {}) };
    // Check if this is a collection layer
    const isCollectionLayer = !!layer.variables?.collection?.id;
    const hasOptionsSource = layer.name === 'div' && !!layer.settings?.optionsSource?.collectionId;

    if (isCollectionLayer && !hasOptionsSource) {
      const collectionVariable = getCollectionVariable(layer);

      if (collectionVariable && collectionVariable.id) {
        try {
          // Fetch collection items with layer-specific settings
          const sortBy = collectionVariable.sort_by;
          const sortOrder = collectionVariable.sort_order;
          const sourceFieldId = collectionVariable.source_field_id;
          const sourceFieldType = collectionVariable.source_field_type;
          const sourceFieldSource = collectionVariable.source_field_source;

          // Handle multi-asset collections - build virtual items from asset IDs
          if (sourceFieldType === 'multi_asset' && sourceFieldId && itemValues) {
            const fieldValue = itemValues[sourceFieldId];
            const assetIds = parseMultiAssetFieldValue(fieldValue);

            if (assetIds.length === 0) {
              // No assets - return layer without children
              return { ...layer, children: [] };
            }

            // Fetch all assets at once (returns Record<string, Asset>)
            const assetsById = await getAssetsByIds(assetIds, isPublished);

            // Clone the layer for each asset (like regular collections)
            const clonedLayers: Layer[] = await Promise.all(
              assetIds.map(async (assetId) => {
                const asset = assetsById[assetId];
                if (!asset) return null;

                const virtualValues = buildAssetVirtualValues(asset);

                // Build layer data map: add this layer's data to existing map
                // Must be built before resolving/injecting so children can access parent collection data
                const updatedLayerDataMap = {
                  ...layerDataMap,
                  [layer.id]: virtualValues,
                };

                // Resolve children for THIS specific asset's virtual values
                const resolvedChildren = layer.children?.length
                  ? await Promise.all(layer.children.map(child => resolveLayer(child, virtualValues, updatedLayerDataMap)))
                  : [];

                // Inject virtual field data into the resolved children
                const injectedChildren = await Promise.all(
                  resolvedChildren.map(child =>
                    injectCollectionData(child, virtualValues, undefined, isPublished, updatedLayerDataMap, undefined, timezone)
                  )
                );

                // Build the cloned layer with original IDs first
                const clonedLayer: Layer = {
                  ...layer,
                  attributes: {
                    ...layer.attributes,
                    'data-collection-item-id': assetId,
                  } as Record<string, any>,
                  variables: {
                    ...layer.variables,
                    collection: undefined,
                  },
                  children: injectedChildren,
                  _collectionItemValues: virtualValues,
                  _collectionItemId: assetId,
                  _layerDataMap: updatedLayerDataMap,
                };

                // Remap all layer IDs in the subtree to make them unique per asset
                // This ensures animations target the correct elements for each item
                return remapLayerIdsForCollectionItem(clonedLayer, `-item-${assetId}`);
              })
            ).then(results => results.filter((item): item is Layer => item !== null));

            // Return a fragment layer containing all cloned items
            // _fragment is a special marker that LayerRenderer and layerToHtml handle
            return {
              ...layer,
              id: `${layer.id}-fragment`,
              name: '_fragment',
              classes: [],
              design: undefined,
              attributes: {} as Record<string, any>,
              children: clonedLayers,
              variables: {
                ...layer.variables,
                collection: undefined,
              },
            };
          }

          // Check if pagination is enabled (either 'pages' or 'load_more' mode)
          const paginationConfig = collectionVariable.pagination;
          const isPaginated = paginationConfig?.enabled && (paginationConfig?.mode === 'pages' || paginationConfig?.mode === 'load_more');

          // Determine limit and offset based on pagination settings
          let limit: number | undefined;
          let offset: number | undefined;
          let currentPage = 1;

          if (isPaginated) {
            const itemsPerPage = paginationConfig.items_per_page || 10;
            // Get page number from context (either specific to this layer or default)
            currentPage = paginationContext?.pageNumbers?.[layer.id]
              ?? paginationContext?.defaultPage
              ?? 1;
            limit = itemsPerPage;
            offset = (currentPage - 1) * itemsPerPage;
          } else {
            // Use legacy limit/offset from collection variable
            limit = collectionVariable.limit;
            offset = collectionVariable.offset;
          }

          // When field-based sorting is active, fetch ALL items so we sort the
          // full set before applying limit/offset. DB-level pagination uses
          // manual_order which would give us the wrong subset.
          const isFieldSort = sortBy && sortBy !== 'none' && sortBy !== 'manual' && sortBy !== 'random';

          // Determine allowed item IDs for reference/inverse-reference filtering
          let allowedItemIds: string[] | undefined;
          if (sourceFieldType === 'inverse_reference' && sourceFieldId && parentItemId) {
            const cachedItems = cache.itemsByCollection.get(collectionVariable.id) || [];
            allowedItemIds = cachedItems
              .filter(item => {
                const val = item.values[sourceFieldId!];
                if (!val) return false;
                return val === parentItemId || (typeof val === 'string' && val.includes(`"${parentItemId}"`));
              })
              .map(item => item.id);
          } else if (sourceFieldId && itemValues) {
            const refValue = itemValues[sourceFieldId];
            if (refValue) {
              if (sourceFieldType === 'reference') {
                allowedItemIds = Array.isArray(refValue) ? refValue : [refValue];
              } else {
                allowedItemIds = parseMultiReferenceValue(refValue);
              }
            } else {
              allowedItemIds = [];
            }
          }

          // Use pre-fetched cache instead of per-collection DB queries
          const collectionFields = cache.fieldsByCollection.get(collectionVariable.id) || [];
          let filteredItems = [...(cache.itemsByCollection.get(collectionVariable.id) || [])];

          if (allowedItemIds !== undefined) {
            const allowedSet = new Set(allowedItemIds);
            filteredItems = filteredItems.filter(i => allowedSet.has(i.id));
          }

          const totalItems = filteredItems.length;

          // For non-field-sort, apply limit/offset in-memory (mirrors DB pagination)
          let items: CollectionItemWithValues[];
          if (!isFieldSort && (limit || offset)) {
            const start = offset || 0;
            items = filteredItems.slice(start, limit ? start + limit : undefined);
          } else {
            items = filteredItems;
          }

          // Apply static collection filters (evaluate against each item's own values)
          const collectionFilters = collectionVariable.filters;
          if (collectionFilters?.groups?.length) {
            const staticFilters = {
              ...collectionFilters,
              groups: collectionFilters.groups.map(group => ({
                ...group,
                conditions: group.conditions.filter(c => !c.inputLayerId),
              })).filter(group => group.conditions.length > 0),
            };

            if (staticFilters.groups.length > 0) {
              items = items.filter(item =>
                evaluateVisibility(staticFilters, {
                  collectionLayerData: item.values,
                  pageCollectionData: null,
                  pageCollectionCounts: {},
                })
              );
            }
          }

          // Apply sorting if specified (since API doesn't handle sortBy yet)
          let sortedItems = items;
          if (sortBy && sortBy !== 'none') {
            if (sortBy === 'manual') {
              sortedItems = items.sort((a, b) => a.manual_order - b.manual_order);
            } else if (sortBy === 'random') {
              sortedItems = items.sort(() => Math.random() - 0.5);
            } else {
              sortedItems = items.sort((a, b) => {
                const aValue = a.values[sortBy] || '';
                const bValue = b.values[sortBy] || '';
                const aStr = String(aValue);
                const bStr = String(bValue);
                const aNum = aStr.trim() !== '' ? Number(aStr) : NaN;
                const bNum = bStr.trim() !== '' ? Number(bStr) : NaN;

                if (!isNaN(aNum) && !isNaN(bNum)) {
                  return sortOrder === 'desc' ? bNum - aNum : aNum - bNum;
                }

                const comparison = aStr.localeCompare(bStr);
                return sortOrder === 'desc' ? -comparison : comparison;
              });

              if (limit || offset) {
                const start = offset || 0;
                sortedItems = sortedItems.slice(start, limit ? start + limit : undefined);
              }
            }
          }

          // Find slug field for building collection item URLs
          const slugField = collectionFields.find(f => f.key === 'slug');

          // Pre-process all items: translations + date formatting (pure computation)
          const preprocessed = sortedItems.map(item => {
            let translatedValues = applyCmsTranslations(item.id, item.values, collectionFields, translations, { includeIncomplete: !isPublished });
            const rawTranslatedValues = { ...translatedValues };
            translatedValues = formatDateFieldsInItemValues(translatedValues, collectionFields, timezone);
            return { item, translatedValues, rawTranslatedValues };
          });

          const layerBoundPaths = boundFieldPathsByLayerId.get(layer.id);
          const allEnhancedValues = await batchResolveReferenceFields(
            preprocessed.map(p => p.translatedValues),
            collectionFields,
            isPublished,
            cache,
            layerBoundPaths,
          );
          const clonedLayers: Layer[] = await Promise.all(
            preprocessed.map(async ({ item, rawTranslatedValues }, index) => {
              const enhancedValues = allEnhancedValues[index];
              const rawEnhancedValues = { ...enhancedValues, ...rawTranslatedValues };

              // Extract slug for URL building
              const itemSlug = slugField ? (enhancedValues[slugField.id] || item.values[slugField.id]) : undefined;

              // Build layer data map: add this layer's data (with resolved references) to existing map
              // Must be built before resolving/injecting so children can access parent collection data
              const updatedLayerDataMap = {
                ...layerDataMap,
                [layer.id]: enhancedValues,
              };

              // Resolve children for THIS specific item's values
              // This ensures nested collection layers filter based on this item's reference fields
              // Pass item.id so inverse reference children can query by parent item ID
              const resolvedChildren = layer.children?.length
                ? await Promise.all(layer.children.map(child => resolveLayer(child, enhancedValues, updatedLayerDataMap, item.id)))
                : [];

              // Then inject field data into the resolved children
              const injectedChildren = await Promise.all(
                resolvedChildren.map(child =>
                  injectCollectionData(child, enhancedValues, collectionFields, isPublished, updatedLayerDataMap, rawEnhancedValues, timezone)
                )
              );

              // Filter _collectionItemValues to only bound paths (reduces payload in draft/preview)
              let filteredValues = enhancedValues;
              if (layerBoundPaths && layerBoundPaths.size > 0) {
                filteredValues = {};
                for (const key of Object.keys(enhancedValues)) {
                  if (layerBoundPaths.has(key)) {
                    filteredValues[key] = enhancedValues[key];
                  }
                }
              }

              // Build the cloned layer with original IDs first
              const clonedLayer: Layer = {
                ...layer,
                attributes: {
                  ...layer.attributes,
                  'data-collection-item-id': item.id,
                } as Record<string, any>,
                variables: {
                  ...layer.variables,
                  collection: undefined,
                },
                children: injectedChildren,
                _collectionItemValues: filteredValues,
                _collectionItemId: item.id,
                _collectionItemSlug: itemSlug,
                _layerDataMap: updatedLayerDataMap,
              };

              // Remap all layer IDs in the subtree to make them unique per item
              // This ensures animations target the correct elements for each collection item
              return remapLayerIdsForCollectionItem(clonedLayer, `-item-${item.id}`);
            })
          );
          // Build pagination metadata if pagination is enabled
          let paginationMeta: CollectionPaginationMeta | undefined;
          if (isPaginated && paginationConfig) {
            const itemsPerPage = paginationConfig.items_per_page || 10;
            paginationMeta = {
              currentPage,
              totalPages: Math.ceil(totalItems / itemsPerPage),
              totalItems,
              itemsPerPage,
              layerId: layer.id,
              collectionId: collectionVariable.id,
              mode: paginationConfig.mode, // 'pages' or 'load_more'
              itemIds: allowedItemIds, // For multi-reference filtering in load_more
              // Store the original layer template for load_more client-side rendering
              layerTemplate: paginationConfig.mode === 'load_more' ? layer.children : undefined,
              collectionLayer: paginationConfig.mode === 'load_more'
                ? stripChildren(layer)
                : undefined,
              isPublished,
              sortBy: collectionVariable.sort_by,
              sortOrder: collectionVariable.sort_order,
            };
          }

          // Build children array - just the cloned items
          // Pagination is now a sibling layer, not added here
          const fragmentChildren = clonedLayers;

          // Check if this collection has any runtime-linked controls (filters or sorting)
          const hasLinkedFilters = !!(
            collectionFilters?.groups?.some(g =>
              g.conditions.some(c => !!c.inputLayerId || !!c.inputLayerId2)
            ) ||
            collectionVariable.sort_by_inputLayerId ||
            collectionVariable.sort_order_inputLayerId
          );

          // Return a fragment layer - LayerRenderer will render children directly without wrapper
          return {
            ...layer,
            id: `${layer.id}-fragment`,
            name: '_fragment',  // Special marker for LayerRenderer to unwrap
            classes: [],
            design: undefined,
            attributes: {} as Record<string, any>,
            children: fragmentChildren,
            variables: {
              ...layer.variables,
              collection: undefined,
            },
            // Store pagination meta for client hydration (SSR only)
            _paginationMeta: paginationMeta,
            // Store filter config for client-side filtering (when collection has linked filter inputs)
            _filterConfig: hasLinkedFilters ? {
              collectionId: collectionVariable.id,
              collectionLayerId: layer.id,
              filters: collectionFilters || { groups: [] },
              sortBy: collectionVariable.sort_by,
              sortOrder: collectionVariable.sort_order,
              sortByInputLayerId: collectionVariable.sort_by_inputLayerId,
              sortOrderInputLayerId: collectionVariable.sort_order_inputLayerId,
              limit: isPaginated ? paginationConfig.items_per_page : collectionVariable.limit,
              paginationMode: isPaginated ? paginationConfig.mode : undefined,
              layerTemplate: layer.children || [],
              collectionLayerClasses: Array.isArray(layer.classes) ? layer.classes : (layer.classes ? [layer.classes] : []),
              collectionLayerTag: layer.name || 'div',
              isPublished,
              // Full collection layer (sans children) — used to rebuild the
              // proper wrapper (link/action/attributes) when items are
              // re-rendered client-side via filter/load-more.
              collectionLayer: stripChildren(layer),
            } : undefined,
          };
        } catch (error) {
          console.error(`Failed to resolve collection layer ${layer.id}:`, error);
          return {
            ...layer,
            children: layer.children ? await Promise.all(layer.children.map(child => resolveLayer(child, itemValues, layerDataMap, parentItemId))) : undefined,
          };
        }
      }
    }

    // Collection-sourced select: replace children with options from a collection
    if (layer.name === 'select' && layer.settings?.optionsSource?.collectionId) {
      try {
        const sourceCollectionId = layer.settings.optionsSource.collectionId;
        let sourceItems = [...(cache.itemsByCollection.get(sourceCollectionId) || [])];
        const sourceFields = cache.fieldsByCollection.get(sourceCollectionId) || [];
        const opts = layer.settings.optionsSource;

        const displayField = findDisplayField(sourceFields);

        if (opts.sortFieldId) {
          const sortField = sourceFields.find(f => f.id === opts.sortFieldId);
          if (sortField) {
            const dir = opts.sortOrder === 'desc' ? -1 : 1;
            sourceItems = [...sourceItems].sort((a, b) => {
              const aVal = String(a.values[sortField.id] ?? '');
              const bVal = String(b.values[sortField.id] ?? '');
              return aVal.localeCompare(bVal, undefined, { numeric: true, sensitivity: 'base' }) * dir;
            });
          }
        }

        const defaultItemId = opts.defaultItemId;
        const hasDefault = !!(defaultItemId && sourceItems.some(i => i.id === defaultItemId));

        const existingPlaceholder = layer.children?.find(
          (c) => c.name === 'option' && c.settings?.isPlaceholder
        );
        const placeholderText = (
          existingPlaceholder?.variables?.text?.type === 'dynamic_text'
            ? existingPlaceholder.variables.text.data.content
            : null
        ) || 'All';
        const placeholderOption: Layer = {
          id: existingPlaceholder?.id || `${layer.id}-opt-placeholder`,
          name: 'option',
          classes: '',
          attributes: { value: '' },
          settings: { isPlaceholder: true },
          variables: {
            text: { type: 'dynamic_text' as const, data: { content: placeholderText } },
          },
        };

        const generatedOptions: Layer[] = sourceItems.map(item => {
          const label = displayField ? (item.values[displayField.id] || 'Untitled') : 'Untitled';
          return {
            id: `${layer.id}-opt-${item.id}`,
            name: 'option',
            classes: '',
            attributes: { value: item.id },
            variables: {
              text: { type: 'dynamic_text' as const, data: { content: String(label) } },
            },
          };
        });

        return {
          ...layer,
          attributes: {
            ...(layer.attributes || {}),
            ...(hasDefault ? { value: defaultItemId } : { value: '' }),
          },
          children: [placeholderOption, ...generatedOptions],
        };
      } catch (error) {
        console.error(`Failed to resolve collection-sourced select options for layer ${layer.id}:`, error);
      }
    }

    // Helper to find a specific input type in a layer's children tree
    const findInputByType = (children: Layer[] | undefined, type: string): Layer | undefined => {
      if (!children) return undefined;
      for (const c of children) {
        if (c.name === 'input' && c.attributes?.type === type) return c;
        if (c.children) { const found = findInputByType(c.children, type); if (found) return found; }
      }
      return undefined;
    };

    // Build a _fragment layer from a collection-sourced input group (checkbox or radio)
    const buildInputGroupFragment = (
      inputType: 'checkbox' | 'radio',
      items: { id: string; values: Record<string, string> }[],
      fields: { id: string; type: string; key?: string | null; fillable?: boolean }[],
    ): Layer => {
      const opts = layer.settings!.optionsSource!;
      const displayField = findDisplayField(fields as CollectionField[]);
      const prefix = inputType === 'checkbox' ? 'cb' : 'rb';

      if (opts.sortFieldId) {
        const sortField = fields.find(f => f.id === opts.sortFieldId);
        if (sortField) {
          const dir = opts.sortOrder === 'desc' ? -1 : 1;
          items = [...items].sort((a, b) => {
            const aVal = String(a.values[sortField.id] ?? '');
            const bVal = String(b.values[sortField.id] ?? '');
            return aVal.localeCompare(bVal, undefined, { numeric: true, sensitivity: 'base' }) * dir;
          });
        }
      }

      const templateInput = findInputByType(layer.children, inputType);
      const templateText = layer.children?.find(c => c.name === 'text');

      const inputIdPrefix = templateInput?.id || layer.id;
      const baseName = templateInput?.attributes?.name || templateInput?.settings?.id || layer.id;
      const inputName = inputType === 'checkbox'
        ? (baseName.endsWith('[]') ? baseName : `${baseName}[]`)
        : baseName;

      // Preserve template input attributes (required, disabled, etc.)
      const { type: _t, name: _n, value: _v, checked: _c, ...inheritedInputAttrs } = templateInput?.attributes || {};

      const generatedChildren: Layer[] = items.map(item => {
        const label = displayField ? (item.values[displayField.id] || 'Untitled') : 'Untitled';
        const isDefault = inputType === 'checkbox'
          ? (opts.defaultItemIds || []).includes(item.id)
          : opts.defaultItemId === item.id;

        return {
          id: `${inputIdPrefix}-${prefix}-${item.id}`,
          name: 'div',
          settings: { tag: 'label' },
          classes: layer.classes || '',
          children: [
            {
              id: `${inputIdPrefix}-${prefix}-${item.id}-input`,
              name: 'input',
              classes: templateInput?.classes || '',
              attributes: {
                ...inheritedInputAttrs,
                type: inputType,
                name: inputName,
                value: item.id,
                ...(isDefault ? { checked: 'true' } : {}),
              },
              design: templateInput?.design,
            },
            {
              id: `${inputIdPrefix}-${prefix}-${item.id}-text`,
              name: 'text',
              classes: templateText?.classes || '',
              design: templateText?.design,
              variables: {
                text: { type: 'dynamic_text' as const, data: { content: String(label) } },
              },
            },
          ],
        } as Layer;
      });

      const { collection: _col, ...restVariables } = layer.variables || {};
      return {
        ...layer,
        id: `${layer.id}-fragment`,
        name: '_fragment',
        classes: [],
        design: undefined,
        attributes: {} as Record<string, any>,
        variables: Object.keys(restVariables).length > 0 ? restVariables : undefined,
        children: generatedChildren,
      };
    };

    // Collection-sourced checkbox/radio group: replace children with inputs from a collection
    if (layer.name === 'div' && layer.settings?.optionsSource?.collectionId) {
      const inputType = findInputByType(layer.children, 'checkbox') ? 'checkbox'
        : findInputByType(layer.children, 'radio') ? 'radio'
          : null;

      if (inputType) {
        try {
          const sourceCollectionId = layer.settings.optionsSource.collectionId;
          const items = cache.itemsByCollection.get(sourceCollectionId) || [];
          const fields = cache.fieldsByCollection.get(sourceCollectionId) || [];
          return buildInputGroupFragment(inputType, items, fields);
        } catch (error) {
          console.error(`Failed to resolve collection-sourced ${inputType} options for layer ${layer.id}:`, error);
        }
      }
    }

    // Recursively resolve children, passing current item values and layer data map
    if (layer.children) {
      return {
        ...layer,
        children: await Promise.all(layer.children.map(child => resolveLayer(child, itemValues, layerDataMap, parentItemId))),
      };
    }

    return layer;
  };

  const result = await Promise.all(layers.map(layer => resolveLayer(layer, parentItemValues, undefined, parentCollectionItemId)));

  // Collect pagination metadata from all fragments
  const paginationMetaMap: Record<string, CollectionPaginationMeta> = {};
  function collectPaginationMeta(layerList: Layer[]) {
    for (const layer of layerList) {
      if (layer._paginationMeta) {
        const originalId = layer.id.replace('-fragment', '');
        paginationMetaMap[originalId] = layer._paginationMeta;
      }
      if (layer.children) {
        collectPaginationMeta(layer.children);
      }
    }
  }
  collectPaginationMeta(result);

  // Update pagination sibling layers with correct meta
  function updatePaginationSiblings(layerList: Layer[]): Layer[] {
    return layerList.map(layer => {
      // Check if this is a pagination wrapper (has data-pagination-for attribute)
      const paginationFor = layer.attributes?.['data-pagination-for'];
      if (paginationFor && paginationMetaMap[paginationFor]) {
        // Update this pagination layer with the meta
        return updatePaginationLayerWithMeta(layer, paginationMetaMap[paginationFor]);
      }

      // Recursively update children
      if (layer.children) {
        return {
          ...layer,
          children: updatePaginationSiblings(layer.children),
        };
      }

      return layer;
    });
  }

  const resultWithPagination = updatePaginationSiblings(result);

  // Third pass: Filter layers by conditional visibility
  // We need to compute collection counts first, then filter
  // parentItemValues is the page collection data for dynamic pages
  const filteredResult = filterByVisibility(resultWithPagination, undefined, parentItemValues);

  return filteredResult;
}

/**
 * Compute item counts for all collection layers in a layer tree
 * Used for evaluating page collection visibility conditions
 */
function computeCollectionCounts(layers: Layer[]): Record<string, number> {
  const counts: Record<string, number> = {};

  function traverse(layerList: Layer[]) {
    for (const layer of layerList) {
      // If this is a fragment containing cloned collection items, count them
      if (layer.name === '_fragment' && layer.children) {
        // Find the original layer ID (before -fragment suffix)
        const originalId = layer.id.replace('-fragment', '');
        counts[originalId] = layer.children.length;
      }

      // Also check for pre-resolved collection items
      if (layer._collectionItems) {
        counts[layer.id] = layer._collectionItems.length;
      }

      if (layer.children) {
        traverse(layer.children);
      }
    }
  }

  traverse(layers);
  return counts;
}

/**
 * Find collection layer IDs that have linked filters (_filterConfig).
 * These need special handling for conditional visibility (has_no_items etc.)
 * since filtered counts change at runtime.
 */
function findFilterableCollectionIds(layers: Layer[]): Set<string> {
  const ids = new Set<string>();
  function traverse(layerList: Layer[]) {
    for (const layer of layerList) {
      if (layer._filterConfig) {
        ids.add(layer._filterConfig.collectionLayerId);
      }
      if (layer.children) traverse(layer.children);
    }
  }
  traverse(layers);
  return ids;
}

/**
 * Check if a layer's conditional visibility references a filterable collection
 * via page_collection conditions (has_no_items, has_items, item_count).
 * Returns the collection layer ID if found, null otherwise.
 */
function getFilterableCollectionTarget(
  conditionalVisibility: import('@/types').ConditionalVisibility,
  filterableIds: Set<string>
): { collectionLayerId: string; operator: string; compareOperator?: string; compareValue?: number } | null {
  for (const group of conditionalVisibility.groups || []) {
    for (const condition of group.conditions) {
      if (
        condition.source === 'page_collection' &&
        condition.collectionLayerId &&
        filterableIds.has(condition.collectionLayerId) &&
        (condition.operator === 'has_no_items' || condition.operator === 'has_items' || condition.operator === 'item_count')
      ) {
        return {
          collectionLayerId: condition.collectionLayerId,
          operator: condition.operator,
          compareOperator: condition.compareOperator,
          compareValue: condition.compareValue,
        };
      }
    }
  }
  return null;
}

/**
 * Filter layers by conditional visibility rules
 * @param layers - Layer tree to filter
 * @param collectionLayerData - Current collection layer item values for field conditions
 * @param pageCollectionData - Page collection data for dynamic pages
 * @returns Filtered layer tree with hidden layers removed
 */
function filterByVisibility(
  layers: Layer[],
  collectionLayerData?: Record<string, string>,
  pageCollectionData?: Record<string, string> | null
): Layer[] {
  const pageCollectionCounts = computeCollectionCounts(layers);
  const filterableCollectionIds = findFilterableCollectionIds(layers);

  function filterLayer(
    layer: Layer,
    currentCollectionLayerData?: Record<string, string>
  ): Layer | null {
    const effectiveCollectionLayerData = layer._collectionItemValues || currentCollectionLayerData;

    const conditionalVisibility = layer.variables?.conditionalVisibility;
    if (conditionalVisibility && conditionalVisibility.groups?.length > 0) {
      const isVisible = evaluateVisibility(conditionalVisibility, {
        collectionLayerData: effectiveCollectionLayerData,
        pageCollectionData,
        pageCollectionCounts,
      });
      const filterTarget = getFilterableCollectionTarget(conditionalVisibility, filterableCollectionIds);
      if (filterTarget) {
        const attributes: Record<string, any> = {
          ...(layer.attributes || {}),
        };
        if (filterTarget.operator === 'has_no_items') {
          attributes['data-collection-empty-state'] = filterTarget.collectionLayerId;
        } else if (filterTarget.operator === 'has_items') {
          attributes['data-collection-has-items'] = filterTarget.collectionLayerId;
        } else if (filterTarget.operator === 'item_count') {
          attributes['data-collection-item-count'] = filterTarget.collectionLayerId;
          attributes['data-collection-item-count-op'] = filterTarget.compareOperator || 'eq';
          attributes['data-collection-item-count-value'] = String(filterTarget.compareValue ?? 0);
        }
        return {
          ...layer,
          _dynamicStyles: {
            ...(layer._dynamicStyles || {}),
            display: isVisible ? '' : 'none',
          },
          attributes,
          children: layer.children
            ? layer.children
              .map(child => filterLayer(child, effectiveCollectionLayerData))
              .filter((child): child is Layer => child !== null)
            : undefined,
        };
      }
      if (!isVisible) {
        return null;
      }
    }

    if (layer.children) {
      const filteredChildren = layer.children
        .map(child => filterLayer(child, effectiveCollectionLayerData))
        .filter((child): child is Layer => child !== null);

      return {
        ...layer,
        children: filteredChildren,
      };
    }

    return layer;
  }

  return layers
    .map(layer => filterLayer(layer, collectionLayerData))
    .filter((layer): layer is Layer => layer !== null);
}

/**
 * Update a pagination layer with dynamic meta (page info text, button states)
 * @param layer - The pagination layer to update
 * @param meta - Pagination metadata
 * @returns Updated layer with dynamic content
 */
function updatePaginationLayerWithMeta(layer: Layer, meta: CollectionPaginationMeta): Layer {
  const { currentPage, totalPages, totalItems, itemsPerPage, mode } = meta;

  // Deep clone to avoid mutation
  const updatedLayer: Layer = JSON.parse(JSON.stringify(layer));

  // Helper to recursively update layers
  function updateLayerRecursive(l: Layer): void {
    // Update page info text (for 'pages' mode)
    if (l.id?.endsWith('-pagination-info')) {
      l.variables = {
        ...l.variables,
        text: {
          type: 'dynamic_text',
          data: { content: `Page ${currentPage} of ${totalPages}` }
        }
      };
    }

    // Update items count text (for 'load_more' mode)
    if (l.id?.endsWith('-pagination-count')) {
      const shownItems = Math.min(itemsPerPage, totalItems);
      l.variables = {
        ...l.variables,
        text: {
          type: 'dynamic_text',
          data: { content: `Showing ${shownItems} of ${totalItems}` }
        }
      };
    }

    // Update previous button state
    if (l.id?.endsWith('-pagination-prev')) {
      const isFirstPage = currentPage <= 1;
      l.attributes = l.attributes || {};
      l.attributes['data-current-page'] = String(currentPage);
      if (isFirstPage) {
        l.attributes.disabled = true;
        l.classes = Array.isArray(l.classes)
          ? [...l.classes, 'opacity-50', 'cursor-not-allowed']
          : `${l.classes || ''} opacity-50 cursor-not-allowed`;
      }
    }

    // Update next button state
    if (l.id?.endsWith('-pagination-next')) {
      const isLastPage = currentPage >= totalPages;
      l.attributes = l.attributes || {};
      l.attributes['data-current-page'] = String(currentPage);
      if (isLastPage) {
        l.attributes.disabled = true;
        l.classes = Array.isArray(l.classes)
          ? [...l.classes, 'opacity-50', 'cursor-not-allowed']
          : `${l.classes || ''} opacity-50 cursor-not-allowed`;
      }
    }

    // Hide load more button when all items shown (in load_more mode)
    if (l.id?.endsWith('-pagination-loadmore')) {
      const allItemsShown = itemsPerPage >= totalItems;
      if (allItemsShown) {
        l.classes = Array.isArray(l.classes)
          ? [...l.classes, 'hidden']
          : `${l.classes || ''} hidden`;
      }
    }

    // Recursively update children
    if (l.children) {
      l.children.forEach(updateLayerRecursive);
    }
  }

  updateLayerRecursive(updatedLayer);
  return updatedLayer;
}

/**
 * Generate a pagination wrapper layer with Previous/Next buttons
 * This is injected as a sibling after the collection fragment
 * @param collectionLayerId - Original collection layer ID
 * @param paginationMeta - Pagination metadata
 * @returns Layer structure for pagination controls
 */
export function generatePaginationWrapper(
  collectionLayerId: string,
  paginationMeta: CollectionPaginationMeta
): Layer {
  const { currentPage, totalPages } = paginationMeta;
  const isFirstPage = currentPage <= 1;
  const isLastPage = currentPage >= totalPages;

  return {
    id: `${collectionLayerId}-pagination`,
    name: 'div',
    classes: 'flex items-center justify-center gap-4 mt-4',
    children: [
      // Previous Button
      {
        id: `${collectionLayerId}-pagination-prev`,
        name: 'button',
        classes: `px-4 py-2 rounded bg-[#e5e7eb] hover:bg-[#d1d5db] transition-colors ${isFirstPage ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`,
        settings: {
          tag: 'button',
        },
        attributes: {
          'data-pagination-action': 'prev',
          'data-collection-layer-id': collectionLayerId,
          'data-current-page': String(currentPage),
          ...(isFirstPage ? { disabled: true } : {}),
        } as Record<string, any>,
        children: [
          {
            id: `${collectionLayerId}-pagination-prev-text`,
            name: 'span',
            classes: '',
            variables: {
              text: {
                type: 'dynamic_text',
                data: { content: 'Previous' }
              }
            }
          } as Layer,
        ],
      } as Layer,
      // Page indicator
      {
        id: `${collectionLayerId}-pagination-info`,
        name: 'span',
        classes: 'text-sm text-[#4b5563]',
        variables: {
          text: {
            type: 'dynamic_text',
            data: { content: `Page ${currentPage} of ${totalPages}` }
          }
        }
      } as Layer,
      // Next Button
      {
        id: `${collectionLayerId}-pagination-next`,
        name: 'button',
        classes: `px-4 py-2 rounded bg-[#e5e7eb] hover:bg-[#d1d5db] transition-colors ${isLastPage ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`,
        settings: {
          tag: 'button',
        },
        attributes: {
          'data-pagination-action': 'next',
          'data-collection-layer-id': collectionLayerId,
          'data-current-page': String(currentPage),
          ...(isLastPage ? { disabled: true } : {}),
        } as Record<string, any>,
        children: [
          {
            id: `${collectionLayerId}-pagination-next-text`,
            name: 'span',
            classes: '',
            variables: {
              text: {
                type: 'dynamic_text',
                data: { content: 'Next' }
              }
            }
          } as Layer,
        ],
      } as Layer,
    ],
    attributes: {
      'data-pagination-wrapper': 'true',
      'data-collection-layer-id': collectionLayerId,
    } as Record<string, any>,
  } as Layer;
}

/**
 * Fetch slugs for collection items referenced by link field values in other collections.
 * Enriches the provided slugs map in-place.
 */
async function enrichSlugsFromLinkFields(
  items: CollectionItemWithValues[],
  collectionFields: CollectionField[],
  existingSlugs: Record<string, string>,
  isPublished: boolean,
): Promise<void> {
  const linkFieldIds = collectionFields.filter(f => f.type === 'link').map(f => f.id);
  if (linkFieldIds.length === 0) return;

  const missingItemIds = extractCrossCollectionItemIds(items, linkFieldIds, existingSlugs);
  if (missingItemIds.length === 0) return;

  const refItems = await getItemsWithValuesByIds(missingItemIds, isPublished);
  const refCollectionIds = new Set(Object.values(refItems).map(i => i.collection_id));

  const fieldsByCollection = new Map<string, CollectionField[]>();
  await Promise.all(
    Array.from(refCollectionIds).map(async (collId) => {
      const fields = await getFieldsByCollectionId(collId, isPublished);
      fieldsByCollection.set(collId, fields);
    })
  );

  for (const refItem of Object.values(refItems)) {
    const fields = fieldsByCollection.get(refItem.collection_id);
    const slugField = fields?.find(f => f.key === 'slug');
    if (slugField && refItem.values[slugField.id]) {
      existingSlugs[refItem.id] = refItem.values[slugField.id];
    }
  }
}

/**
 * Render collection items to HTML string for "Load More" pagination
 * Takes the original layer template and renders each item with injected data
 * @param items - Collection items with values
 * @param layerTemplate - The original layer template (children of the collection layer)
 * @param collectionId - Collection ID for fetching fields
 * @param collectionLayerId - The collection layer ID (for unique item IDs)
 * @param isPublished - Whether to fetch published data
 * @param locale - Optional locale for URL generation
 * @param translations - Optional translations for URL generation
 * @returns HTML string of rendered items
 */
export async function renderCollectionItemsToHtml(
  items: CollectionItemWithValues[],
  layerTemplate: Layer[],
  collectionId: string,
  collectionLayerId: string,
  isPublished: boolean,
  pages?: Page[],
  folders?: PageFolder[],
  collectionItemSlugs?: Record<string, string>,
  locale?: Locale | null,
  translations?: Record<string, Translation>,
  tenantId?: string,
  collectionLayerClasses?: string[],
  collectionLayerTag?: string,
  pageLinkContext?: PageLinkContext,
  // When provided, items are rendered as full clones of the collection layer
  // (matching SSR exactly), so link/action wrappers and layer-level
  // attributes are preserved. Falls back to a generic wrapper otherwise.
  collectionLayer?: Omit<Layer, 'children'>,
): Promise<string> {
  // Fetch collection fields, timezone, and map tokens in parallel
  const [collectionFields, timezoneRaw] = await Promise.all([
    getFieldsByCollectionId(collectionId, isPublished, { excludeComputed: true }),
    getSettingByKey('timezone'),
    ensureMapTokens(),
  ]);
  const htmlTimezone = (timezoneRaw as string | null) || 'UTC';

  // Enrich slugs with cross-collection link field references
  const enrichedSlugs = { ...collectionItemSlugs };
  await enrichSlugsFromLinkFields(items, collectionFields, enrichedSlugs, isPublished);

  // Pre-process: translations + date formatting (pure computation)
  const preprocessed = items.map(item => {
    const rawValues = { ...item.values };
    const formattedValues = formatDateFieldsInItemValues(item.values, collectionFields, htmlTimezone);
    return { item, rawValues, formattedValues };
  });

  // Batch-resolve reference fields for ALL items (2–3 queries total)
  const allEnhancedValues = await batchResolveReferenceFields(
    preprocessed.map(p => p.formattedValues),
    collectionFields,
    isPublished,
  );

  // Render each item using the template
  const renderedItems = await Promise.all(
    preprocessed.map(async ({ item, rawValues }, index) => {
      const enhancedValues = allEnhancedValues[index];

      // Deep clone the template for each item. ID remapping is deferred:
      // - When `collectionLayer` is provided (preferred path), we'll rebuild
      //   the full layer first and remap the entire subtree once at the end,
      //   so SSR-equivalent wrappers are generated and IDs aren't doubled.
      // - Otherwise we pre-remap children with the `-fc-${itemId}` suffix
      //   used by the legacy generic-wrapper path. The `-fc-` namespace
      //   prevents collisions with SSR clones (which use `-item-`).
      const idSuffix = `-fc-${item.id}`;
      const clonedTemplateRaw: Layer[] = JSON.parse(JSON.stringify(layerTemplate)) as Layer[];
      const clonedTemplate: Layer[] = collectionLayer
        ? clonedTemplateRaw
        : clonedTemplateRaw.map(layer => remapLayerIdsForCollectionItem(layer, idSuffix));

      // Inject collection data into each layer of the template (text, images, etc.)
      const injectedLayers = await Promise.all(
        clonedTemplate.map((layer: Layer) =>
          injectCollectionDataForHtml(layer, enhancedValues, collectionFields, isPublished, rawValues, htmlTimezone)
        )
      );

      // Resolve nested collection layers (sub-collections like "shades" inside "colors")
      // Pass item.values so nested collections can filter based on parent item's field values
      let resolvedLayers = await resolveCollectionLayers(
        injectedLayers,
        isPublished,
        item.values,
        undefined,
        undefined,
        item.id,
        htmlTimezone,
      );

      // Resolve all AssetVariables to URLs server-side
      const resolved = await resolveAllAssets(resolvedLayers, isPublished);
      resolvedLayers = resolved.layers;
      let assetMap = resolved.assetMap;

      // Build anchor map for O(1) anchor resolution
      const anchorMap = buildAnchorMap(resolvedLayers);

      // Collect asset IDs from field links in layers that have asset field_type stored
      const assetFieldTypes = ['image', 'video', 'audio', 'document'];
      const collectFieldLinkAssetIds = (layers: Layer[]): string[] => {
        const assetIds: string[] = [];
        const scan = (layer: Layer) => {
          const fieldType = layer.variables?.link?.field?.data?.field_type;
          const fieldId = layer.variables?.link?.field?.data?.field_id;
          if (fieldType && fieldId) {
            if (assetFieldTypes.includes(fieldType)) {
              const assetId = item.values[fieldId];
              if (assetId && !assetMap[assetId]) {
                assetIds.push(assetId);
              }
            } else if (fieldType === 'link') {
              const rawValue = item.values[fieldId];
              if (rawValue) {
                const linkValue = parseCollectionLinkValue(rawValue);
                if (linkValue?.type === 'asset' && linkValue.asset?.id && !assetMap[linkValue.asset.id]) {
                  assetIds.push(linkValue.asset.id);
                }
              }
            }
          }
          layer.children?.forEach(scan);
        };
        layers.forEach(scan);
        return assetIds;
      };

      const missingAssetIds = collectFieldLinkAssetIds(resolvedLayers);

      // Fetch any missing assets from field links
      if (missingAssetIds.length > 0) {
        const { getAssetsByIds } = await import('@/lib/repositories/assetRepository');
        const additionalAssets = await getAssetsByIds(missingAssetIds, isPublished);
        for (const asset of Object.values(additionalAssets)) {
          const proxyUrl = getAssetProxyUrl(asset);
          if (proxyUrl) {
            asset.public_url = proxyUrl;
          }
        }
        assetMap = { ...assetMap, ...additionalAssets };
      }

      // Apply conditional visibility based on this item's field values
      resolvedLayers = filterByVisibility(resolvedLayers, item.values);

      // Preferred path: rebuild a full clone of the collection layer just
      // like SSR does (link/action/attributes preserved). Renders one HTML
      // node via layerToHtml so wrappers like <a> are emitted properly.
      // IDs aren't pre-remapped (see clonedTemplate above), so the whole
      // subtree gets a single remap pass here.
      if (collectionLayer) {
        const slugField = collectionFields.find(f => f.key === 'slug');
        const itemSlug = slugField ? (rawValues[slugField.id] || item.values[slugField.id]) : undefined;

        const clonedLayer: Layer = {
          ...collectionLayer,
          attributes: {
            ...(collectionLayer.attributes || {}),
            'data-collection-item-id': item.id,
          },
          variables: {
            ...(collectionLayer.variables || {}),
            collection: undefined,
          },
          children: resolvedLayers,
          _collectionItemValues: enhancedValues,
          _collectionItemId: item.id,
          _collectionItemSlug: itemSlug,
        };

        const remapped = remapLayerIdsForCollectionItem(clonedLayer, idSuffix);
        return layerToHtml(remapped, item.id, pages, folders, enrichedSlugs, locale, translations, anchorMap, item.values, undefined, assetMap, undefined, undefined, undefined, undefined, pageLinkContext);
      }

      // Fallback: render children and wrap with a generic container. Used
      // when the caller didn't pass the full collection layer (older API
      // contracts). Loses link/action wrappers but keeps content rendering.
      const itemHtml = resolvedLayers
        .map((layer) =>
          layerToHtml(layer, item.id, pages, folders, enrichedSlugs, locale, translations, anchorMap, item.values, undefined, assetMap, undefined, undefined, undefined, undefined, pageLinkContext)
        )
        .join('');

      const itemWrapperId = `${collectionLayerId}-fc-${item.id}`;
      const wrapperTag = collectionLayerTag || 'div';
      const wrapperClassStr = Array.isArray(collectionLayerClasses) && collectionLayerClasses.length > 0
        ? ` class="${collectionLayerClasses.join(' ')}"`
        : '';
      return `<${wrapperTag} data-layer-id="${itemWrapperId}" data-collection-item-id="${item.id}"${wrapperClassStr}>${itemHtml}</${wrapperTag}>`;
    })
  );

  return renderedItems.join('');
}

/**
 * Inject collection data into a layer for HTML rendering
 * Similar to injectCollectionData but simplified for HTML output
 */
async function injectCollectionDataForHtml(
  layer: Layer,
  itemValues: Record<string, string>,
  fields: CollectionField[],
  isPublished: boolean,
  rawItemValues?: Record<string, string>,
  timezone: string = 'UTC'
): Promise<Layer> {
  // Reference fields are resolved once per item by the caller
  // (renderCollectionItemsToHtml). Re-resolving on every recursive
  // child would cause redundant Supabase queries.
  const enhancedValues = itemValues;

  const updates: Partial<Layer> = {};
  const resolvedVars: Record<string, unknown> = { ...layer.variables };

  // Resolve inline variables in text content
  const textVariable = layer.variables?.text;

  // Handle DynamicRichTextVariable (Tiptap JSON with dynamicVariable nodes)
  if (textVariable && textVariable.type === 'dynamic_rich_text') {
    const content = textVariable.data.content;
    if (content && typeof content === 'object') {
      const restrictiveBlockTags = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'a', 'button'];
      const currentTag = layer.settings?.tag || layer.name || 'div';
      if (restrictiveBlockTags.includes(currentTag) &&
          hasBlockElementsInInlineVariables(content, enhancedValues)) {
        updates.settings = {
          ...layer.settings,
          tag: 'div',
        };
      }

      const resolvedContent = resolveRichTextVariables(content, enhancedValues, undefined, rawItemValues, timezone);
      resolvedVars.text = {
        type: 'dynamic_rich_text',
        data: { content: resolvedContent },
      };
    }
  }
  // Handle DynamicTextVariable (legacy string format with inline variable tags)
  else if (textVariable && textVariable.type === 'dynamic_text') {
    const textContent = textVariable.data.content;
    if (textContent.includes('<ycode-inline-variable>')) {
      const mockItem: CollectionItemWithValues = {
        id: 'temp',
        collection_id: 'temp',
        created_at: '',
        updated_at: '',
        deleted_at: null,
        manual_order: 0,
        is_published: true,
        is_publishable: true,
        content_hash: null,
        values: enhancedValues,
      };
      const resolved = resolveInlineVariables(textContent, mockItem, timezone, rawItemValues);
      resolvedVars.text = {
        type: 'dynamic_text',
        data: { content: resolved },
      };
    }
  }

  // Helper to resolve field value with relationship path
  const resolveFieldPath = (fieldVar: FieldVariable): string => {
    const fieldId = fieldVar.data.field_id!;
    const relationships = fieldVar.data.relationships || [];
    const fullPath = relationships.length > 0
      ? [fieldId, ...relationships].join('.')
      : fieldId;
    return enhancedValues[fullPath] || '';
  };

  // Image src field binding (variables structure)
  const imageSrc = layer.variables?.image?.src;
  if (imageSrc && isFieldVariable(imageSrc) && imageSrc.data.field_id) {
    const resolvedValue = resolveFieldPath(imageSrc);
    resolvedVars.image = {
      src: createResolvedAssetVariable(imageSrc.data.field_id, resolvedValue, imageSrc),
      alt: layer.variables?.image?.alt || createDynamicTextVariable(''),
    };
  }

  // Video src field binding (variables structure)
  const videoSrc = layer.variables?.video?.src;
  if (videoSrc && isFieldVariable(videoSrc) && videoSrc.data.field_id) {
    const resolvedValue = resolveFieldPath(videoSrc);
    resolvedVars.video = {
      ...layer.variables?.video,
      src: createResolvedAssetVariable(videoSrc.data.field_id, resolvedValue, videoSrc),
    };
  }

  // Audio src field binding (variables structure)
  const audioSrc = layer.variables?.audio?.src;
  if (audioSrc && isFieldVariable(audioSrc) && audioSrc.data.field_id) {
    const resolvedValue = resolveFieldPath(audioSrc);
    resolvedVars.audio = {
      ...layer.variables?.audio,
      src: createResolvedAssetVariable(audioSrc.data.field_id, resolvedValue, audioSrc),
    };
  }

  // Background image src field binding (variables structure)
  const bgImageSrc = layer.variables?.backgroundImage?.src;
  if (bgImageSrc && isFieldVariable(bgImageSrc) && bgImageSrc.data.field_id) {
    const resolvedValue = resolveFieldPath(bgImageSrc);
    resolvedVars.backgroundImage = {
      src: createResolvedAssetVariable(bgImageSrc.data.field_id, resolvedValue, bgImageSrc),
    };
  }

  // Design color field bindings → inline styles (supports solid + gradient)
  const designBindingsHtml = layer.variables?.design as Record<string, DesignColorVariable> | undefined;
  if (designBindingsHtml) {
    const dynamicStyles = resolveDesignStyles(designBindingsHtml, (fieldVar) =>
      resolveFieldPath(fieldVar)
    );
    if (dynamicStyles) {
      updates._dynamicStyles = dynamicStyles;
    }
  }

  // Assign all resolved variables
  updates.variables = resolvedVars as Layer['variables'];

  // Recursively process children
  if (layer.children) {
    const resolvedChildren = await Promise.all(
      layer.children.map(child =>
        injectCollectionDataForHtml(child, enhancedValues, fields, isPublished, rawItemValues, timezone)
      )
    );
    updates.children = resolvedChildren;
  }

  return {
    ...layer,
    ...updates,
  };
}

/**
 * Resolve all AssetVariables in layer tree to DynamicTextVariables with public URLs
 * This ensures assets are resolved server-side before rendering
 * Should be called after all other layer processing (collections, components, etc.)
 * @param isPublished - Whether to fetch published (true) or draft (false) assets
 * @param components - Available components, needed to resolve assets from rich-text embedded components
 */
export async function resolveAllAssets(
  layers: Layer[],
  isPublished: boolean = true,
  components?: Component[],
): Promise<{ layers: Layer[]; assetMap: Record<string, { public_url: string | null; content?: string | null; width?: number | null; height?: number | null }> }> {
  const { getAssetsByIds } = await import('@/lib/repositories/assetRepository');

  // Step 1: Collect all asset IDs from the layer tree
  const assetIds = collectLayerAssetIds(layers, components || []);

  // Step 2: Fetch all assets in a single query
  const assetMap = await getAssetsByIds(Array.from(assetIds), isPublished);

  // Step 2.5: Override public_url with SEO-friendly proxy URLs where available
  for (const asset of Object.values(assetMap)) {
    const proxyUrl = getAssetProxyUrl(asset);
    if (proxyUrl) {
      asset.public_url = proxyUrl;
    }
  }

  // Step 3: Resolve layer URLs using the fetched asset map
  return { layers: layers.map(l => resolveLayerAssets(l, assetMap)), assetMap };
}

/**
 * Synchronously resolve AssetVariables on a layer tree using an already-fetched assetMap.
 * Replaces AssetVariable refs with DynamicTextVariable containing the resolved URL.
 * Used by resolveAllAssets (upfront) and the componentRenderer in layerToHtml (at render time).
 */
function resolveLayerAssets(
  layer: Layer,
  assetMap: Record<string, { public_url: string | null; content?: string | null; width?: number | null; height?: number | null }>,
): Layer {
  const variableUpdates: Partial<Layer['variables']> = {};

  let attributeUpdates: Record<string, any> | undefined;

  const imageSrc = layer.variables?.image?.src;
  if (imageSrc && isAssetVariable(imageSrc)) {
    const assetId = getAssetId(imageSrc);
    if (assetId) {
      const asset = assetMap[assetId];
      let resolvedUrl = '';
      if (asset?.public_url) {
        resolvedUrl = asset.public_url;
      } else if (asset?.content) {
        resolvedUrl = buildSvgDataUrl(asset.content, asset.width, asset.height);
      }
      variableUpdates.image = {
        src: createDynamicTextVariable(resolvedUrl),
        alt: layer.variables?.image?.alt || createDynamicTextVariable(''),
      };

      // Store intrinsic dimensions from asset for CLS prevention
      if (asset?.width && asset?.height) {
        attributeUpdates = {
          ...(layer.attributes || {}),
          ...(!layer.attributes?.width && { width: String(asset.width) }),
          ...(!layer.attributes?.height && { height: String(asset.height) }),
        };
      }
    }
  }

  const videoSrc = layer.variables?.video?.src;
  const videoPoster = layer.variables?.video?.poster;
  const videoUpdates: { src?: any; poster?: any } = {};
  if (videoSrc && isAssetVariable(videoSrc)) {
    const assetId = getAssetId(videoSrc);
    if (assetId) {
      const asset = assetMap[assetId];
      videoUpdates.src = createDynamicTextVariable(asset?.public_url || '');
    }
  }
  if (videoPoster && isAssetVariable(videoPoster)) {
    const assetId = getAssetId(videoPoster);
    if (assetId) {
      const asset = assetMap[assetId];
      videoUpdates.poster = createDynamicTextVariable(asset?.public_url || '');
    }
  }
  if (Object.keys(videoUpdates).length > 0) {
    variableUpdates.video = { ...layer.variables?.video, ...videoUpdates };
  }

  const audioSrc = layer.variables?.audio?.src;
  if (audioSrc && isAssetVariable(audioSrc)) {
    const assetId = getAssetId(audioSrc);
    if (assetId) {
      const asset = assetMap[assetId];
      variableUpdates.audio = { src: createDynamicTextVariable(asset?.public_url || '') };
    }
  }

  const bgImageSrc = layer.variables?.backgroundImage?.src;
  if (bgImageSrc && isAssetVariable(bgImageSrc)) {
    const assetId = getAssetId(bgImageSrc);
    let resolvedUrl = '';
    if (assetId) {
      const asset = assetMap[assetId];
      if (asset?.public_url) {
        resolvedUrl = asset.public_url;
      } else if (asset?.content) {
        resolvedUrl = buildSvgDataUrl(asset.content, asset.width, asset.height);
      }
    } else {
      resolvedUrl = DEFAULT_ASSETS.IMAGE;
    }
    if (resolvedUrl) {
      variableUpdates.backgroundImage = { src: createDynamicTextVariable(resolvedUrl) };
    }
  }

  const iconSrc = layer.variables?.icon?.src;
  if (iconSrc && isAssetVariable(iconSrc)) {
    const assetId = getAssetId(iconSrc);
    if (assetId) {
      const asset = assetMap[assetId];
      variableUpdates.icon = {
        src: { type: 'static_text' as const, data: { content: asset?.content || '' } },
      };
    }
  }

  // Resolve richTextImage src URLs inside Tiptap content
  const textVar = layer.variables?.text;
  if (textVar && 'type' in textVar && textVar.type === 'dynamic_rich_text') {
    const resolvedContent = resolveRichTextImageAssets((textVar as any).data?.content, assetMap);
    if (resolvedContent !== (textVar as any).data?.content) {
      variableUpdates.text = {
        ...textVar,
        data: { ...(textVar as any).data, content: resolvedContent },
      } as any;
    }
  }

  const updates: Partial<Layer> = {};
  if (Object.keys(variableUpdates).length > 0) {
    updates.variables = { ...layer.variables, ...variableUpdates };
  }
  if (attributeUpdates) {
    updates.attributes = attributeUpdates;
  }
  if (layer.children) {
    updates.children = layer.children.map(child => resolveLayerAssets(child, assetMap));
  }

  return Object.keys(updates).length > 0 ? { ...layer, ...updates } : layer;
}

/** Recursively resolve richTextImage asset URLs in Tiptap JSON content. */
function resolveRichTextImageAssets(
  node: any,
  assetMap: Record<string, { public_url: string | null; content?: string | null }>,
): any {
  if (!node || typeof node !== 'object') return node;

  if (node.type === 'richTextImage' && node.attrs?.assetId) {
    const asset = assetMap[node.attrs.assetId];
    if (asset?.public_url) {
      return { ...node, attrs: { ...node.attrs, src: asset.public_url } };
    }
  }

  if (Array.isArray(node.content)) {
    let changed = false;
    const newContent = node.content.map((child: any) => {
      const resolved = resolveRichTextImageAssets(child, assetMap);
      if (resolved !== child) changed = true;
      return resolved;
    });
    if (changed) return { ...node, content: newContent };
  }

  return node;
}

/**
 * Build a map of layerId -> anchor value (attributes.id) for O(1) anchor resolution
 */
export function buildAnchorMap(layers: Layer[]): Record<string, string> {
  const map: Record<string, string> = {};

  const traverse = (layerList: Layer[]) => {
    for (const layer of layerList) {
      if (layer.attributes?.id) {
        map[layer.id] = layer.attributes.id;
      }
      if (layer.children) {
        traverse(layer.children);
      }
    }
  };

  traverse(layers);
  return map;
}

/**
 * Render Tiptap JSON content to HTML string
 * Handles text nodes, marks (bold, italic, etc.), and paragraphs
 */
/**
 * Callback for rendering an embedded component inside rich-text to HTML.
 * @param componentId - The component ID
 * @param overrides - Component variable overrides
 * @returns HTML string of the rendered component
 */
type RenderComponentHtmlFn = (
  componentId: string,
  overrides: Layer['componentOverrides'],
  preResolvedLayers?: Layer[],
) => string;

function renderTiptapToHtml(
  content: any,
  textStyles?: Record<string, any>,
  renderComponentHtml?: RenderComponentHtmlFn,
  linkContext?: LinkResolutionContext,
  parentRowIdx = 0,
): string {
  if (!content || typeof content !== 'object') {
    return '';
  }

  // Handle text node
  if (content.type === 'text') {
    let text = escapeHtml(content.text || '');

    // Apply marks in reverse order (innermost to outermost)
    if (content.marks && Array.isArray(content.marks)) {
      for (let i = content.marks.length - 1; i >= 0; i--) {
        const mark = content.marks[i];
        const markClass = textStyles?.[mark.type]?.classes || '';
        const classAttr = markClass ? ` class="${escapeHtml(markClass)}"` : '';

        switch (mark.type) {
          case 'bold':
            text = `<strong${classAttr}>${text}</strong>`;
            break;
          case 'italic':
            text = `<em${classAttr}>${text}</em>`;
            break;
          case 'underline':
            text = `<u${classAttr}>${text}</u>`;
            break;
          case 'strike':
            text = `<s${classAttr}>${text}</s>`;
            break;
          case 'subscript':
            text = `<sub${classAttr}>${text}</sub>`;
            break;
          case 'superscript':
            text = `<sup${classAttr}>${text}</sup>`;
            break;
          case 'link':
            if (mark.attrs?.href) {
              const target = mark.attrs.target ? ` target="${escapeHtml(mark.attrs.target)}"` : '';
              const rel = mark.attrs.rel ? ` rel="${escapeHtml(mark.attrs.rel)}"` : (mark.attrs.target === '_blank' ? ' rel="noopener noreferrer"' : '');
              text = `<a href="${escapeHtml(mark.attrs.href)}"${target}${rel}${classAttr}>${text}</a>`;
            }
            break;
          case 'richTextLink': {
            const rtLinkSettings = getLinkSettingsFromMark(mark.attrs || {});
            if (rtLinkSettings.type && linkContext) {
              const href = generateLinkHref(rtLinkSettings, linkContext);
              if (href) {
                const target = mark.attrs.target ? ` target="${escapeHtml(mark.attrs.target)}"` : '';
                const rel = mark.attrs.rel
                  ? ` rel="${escapeHtml(mark.attrs.rel)}"`
                  : (mark.attrs.target === '_blank' ? ' rel="noopener noreferrer"' : '');
                const download = mark.attrs.download ? ' download' : '';
                text = `<a href="${escapeHtml(href)}"${target}${rel}${download}${classAttr}>${text}</a>`;
              }
            }
            break;
          }
          case 'dynamicStyle': {
            // Handle dynamic styles (headings, paragraphs, custom styles)
            const styleKeys: string[] = mark.attrs?.styleKeys || [];
            // Backwards compatibility: single styleKey
            if (styleKeys.length === 0 && mark.attrs?.styleKey) {
              styleKeys.push(mark.attrs.styleKey);
            }
            // Merge layer textStyles with defaults
            const mergedStyles = { ...DEFAULT_TEXT_STYLES, ...textStyles };
            const classes = styleKeys
              .map(k => mergedStyles[k]?.classes || '')
              .filter(Boolean)
              .join(' ');
            if (classes) {
              text = `<span class="${escapeHtml(classes)}">${text}</span>`;
            }
            break;
          }
        }
      }
    }
    return text;
  }

  // Handle paragraph
  if (content.type === 'paragraph') {
    const mergedStyles = { ...DEFAULT_TEXT_STYLES, ...textStyles };
    const paragraphClass = mergedStyles?.paragraph?.classes || '';
    // Empty paragraphs use non-breaking space to preserve the empty line
    const innerHtml = content.content && content.content.length > 0
      ? content.content.map((node: any) => renderTiptapToHtml(node, textStyles, renderComponentHtml, linkContext)).join('')
      : '\u00A0';
    // Wrap in span with paragraph styles for proper block display
    return `<span class="${escapeHtml(paragraphClass)}">${innerHtml}</span>`;
  }

  // Handle heading
  if (content.type === 'heading') {
    const level = content.attrs?.level || 1;
    const styleKey = `h${level}`;
    const mergedStyles = { ...DEFAULT_TEXT_STYLES, ...textStyles };
    const headingClass = mergedStyles?.[styleKey]?.classes || '';
    // Empty headings use non-breaking space to preserve the empty line
    const innerHtml = content.content && content.content.length > 0
      ? content.content.map((node: any) => renderTiptapToHtml(node, textStyles, renderComponentHtml, linkContext)).join('')
      : '\u00A0';
    // Use span to avoid nesting issues (h1 inside p is invalid)
    return `<span class="${escapeHtml(headingClass)}">${innerHtml}</span>`;
  }

  // Handle doc (root)
  if (content.type === 'doc' && Array.isArray(content.content)) {
    return content.content.map((node: any) => renderTiptapToHtml(node, textStyles, renderComponentHtml, linkContext)).join('');
  }

  // Handle bullet list
  if (content.type === 'bulletList') {
    const listClass = textStyles?.bulletList?.classes || '';
    const classAttr = listClass ? ` class="${escapeHtml(listClass)}"` : '';
    const items = content.content
      ? content.content.map((item: any) => renderTiptapToHtml(item, textStyles, renderComponentHtml, linkContext)).join('')
      : '';
    return `<ul${classAttr}>${items}</ul>`;
  }

  // Handle ordered list
  if (content.type === 'orderedList') {
    const listClass = textStyles?.orderedList?.classes || '';
    const classAttr = listClass ? ` class="${escapeHtml(listClass)}"` : '';
    const items = content.content
      ? content.content.map((item: any) => renderTiptapToHtml(item, textStyles, renderComponentHtml, linkContext)).join('')
      : '';
    return `<ol${classAttr}>${items}</ol>`;
  }

  // Handle list item
  if (content.type === 'listItem') {
    const innerHtml = content.content
      ? content.content.map((node: any) => renderTiptapToHtml(node, textStyles, renderComponentHtml, linkContext)).join('')
      : '';
    return `<li>${innerHtml}</li>`;
  }

  // Handle hardBreak
  if (content.type === 'hardBreak') {
    return '<br>';
  }

  // Handle rich-text images (optionally wrapped in a link)
  if (content.type === 'richTextImage') {
    const src = content.attrs?.src ? escapeHtml(content.attrs.src) : '';
    const alt = content.attrs?.alt ? escapeHtml(content.attrs.alt) : '';
    const imgClass = textStyles?.richTextImage?.classes || '';
    const classAttr = imgClass ? ` class="${escapeHtml(imgClass)}"` : '';
    const imgTag = `<img src="${src}" alt="${alt}"${classAttr} />`;

    const storedLink = content.attrs?.link as LinkSettings | null;
    if (storedLink?.type && linkContext) {
      const resolvedHref = generateLinkHref(storedLink, linkContext);
      if (resolvedHref) {
        const href = escapeHtml(resolvedHref);
        const target = storedLink.target ? ` target="${escapeHtml(storedLink.target)}"` : '';
        const rel = storedLink.target === '_blank' ? ' rel="noopener noreferrer"' : '';
        const download = storedLink.download ? ' download' : '';
        return `<a href="${href}"${target}${rel}${download}>${imgTag}</a>`;
      }
    }

    return imgTag;
  }

  // Handle horizontal rules (separator)
  if (content.type === 'horizontalRule') {
    const mergedStyles = { ...DEFAULT_TEXT_STYLES, ...textStyles };
    const hrClass = mergedStyles?.horizontalRule?.classes || '';
    const classAttr = hrClass ? ` class="${escapeHtml(hrClass)}"` : '';
    return `<hr${classAttr} />`;
  }

  // Handle embedded component blocks
  if (content.type === 'richTextComponent' && content.attrs?.componentId) {
    if (renderComponentHtml) {
      return renderComponentHtml(
        content.attrs.componentId,
        content.attrs.componentOverrides ?? undefined,
        content.attrs._resolvedLayers,
      );
    }
    return `<div data-component-id="${escapeHtml(content.attrs.componentId)}"></div>`;
  }

  if (content.type === 'table') {
    const rows = (content.content || [])
      .map((row: any, rowIdx: number) => renderTiptapToHtml(row, textStyles, renderComponentHtml, linkContext, rowIdx))
      .join('');

    const mergedStyles = { ...DEFAULT_TEXT_STYLES, ...textStyles };
    const tableClass = mergedStyles?.table?.classes || '';
    const classAttr = tableClass ? ` class="${escapeHtml(tableClass)}"` : '';

    return `<div class="overflow-x-auto max-w-full"><table${classAttr}><tbody>${rows}</tbody></table></div>`;
  }

  if (content.type === 'tableRow') {
    const mergedStyles = { ...DEFAULT_TEXT_STYLES, ...textStyles };
    const rowClass = mergedStyles?.tableRow?.classes || '';
    const rowClassAttr = rowClass ? ` class="${escapeHtml(rowClass)}"` : '';
    const cells = (content.content || [])
      .map((node: any, cellIdx: number) => {
        if (node.type !== 'tableCell' && node.type !== 'tableHeader') {
          return renderTiptapToHtml(node, textStyles, renderComponentHtml, linkContext, parentRowIdx);
        }
        const tag = node.type === 'tableHeader' ? 'th' : 'td';
        const cellStyleKey = node.type === 'tableHeader' ? 'tableHeader' : 'tableCell';
        let cellClass = mergedStyles?.[cellStyleKey]?.classes || '';
        const borders: string[] = [];
        if (parentRowIdx > 0) borders.push('border-t-[1px]');
        if (cellIdx > 0) borders.push('border-l-[1px]');
        if (borders.length > 0) {
          const borderClasses = `${borders.join(' ')} border-solid border-[#000000]/10`;
          cellClass = cellClass ? `${cellClass} ${borderClasses}` : borderClasses;
        }
        const attrs: string[] = [];
        if (cellClass) attrs.push(`class="${escapeHtml(cellClass)}"`);
        if (node.attrs?.colspan && node.attrs.colspan > 1) attrs.push(`colspan="${node.attrs.colspan}"`);
        if (node.attrs?.rowspan && node.attrs.rowspan > 1) attrs.push(`rowspan="${node.attrs.rowspan}"`);
        const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
        const cellContent = (node.content || [])
          .map((child: any) => renderTiptapToHtml(child, textStyles, renderComponentHtml, linkContext))
          .join('');
        return `<${tag}${attrStr}>${cellContent}</${tag}>`;
      })
      .join('');
    return `<tr${rowClassAttr}>${cells}</tr>`;
  }

  // Handle HTML embed blocks — render empty placeholder;
  // HtmlEmbedRenderer injects the code client-side via useEffect
  if (content.type === 'richTextHtmlEmbed') {
    return '';
  }

  // Fallback: recursively process content
  if (Array.isArray(content.content)) {
    return content.content.map((node: any) => renderTiptapToHtml(node, textStyles, renderComponentHtml, linkContext)).join('');
  }

  return '';
}

/**
 * Page-level link resolution context passed through `layerToHtml`. Bundles
 * data that's specific to the dynamic page being rendered (rather than to the
 * cloned collection layer or current item), so layer-level link resolution
 * can produce next/previous-style URLs and respect preview prefixes.
 */
export interface PageLinkContext {
  pageCollectionItemId?: string;
  pageCollectionSortedItemIds?: string[];
  isPreview?: boolean;
  /**
   * Set by the static export to opt out of the iframe-wrapped htmlEmbed
   * SSR fallback. The live site relies on React hydration to replace the
   * SSR iframe with an inline `HtmlEmbedRenderer`; the static export has
   * no hydration, so an iframe with no `height` clips the user's content.
   */
  isStaticExport?: boolean;
}

/** Build an `assetMap`-backed `getAsset` callback compatible with `generateLinkHref`. */
function makeAssetMapResolver(
  assetMap?: Record<string, { public_url: string | null; content?: string | null }>
): ((id: string) => { public_url?: string | null; content?: string | null } | null) | undefined {
  if (!assetMap) return undefined;
  return (id: string) => assetMap[id] ?? null;
}

/**
 * Convert a Layer to HTML string
 * Handles common layer types and their attributes
 */
export function layerToHtml(
  layer: Layer,
  collectionItemId?: string,
  pages?: Page[],
  folders?: PageFolder[],
  collectionItemSlugs?: Record<string, string>,
  locale?: Locale | null,
  translations?: Record<string, Translation>,
  anchorMap?: Record<string, string>,
  collectionItemData?: Record<string, string>,
  pageCollectionItemData?: Record<string, string>,
  assetMap?: Record<string, { public_url: string | null; content?: string | null; width?: number | null; height?: number | null }>,
  layerDataMap?: Record<string, Record<string, string>>,
  components?: Component[],
  ancestorComponentIds?: Set<string>,
  isSlideChild?: boolean,
  pageLinkContext?: PageLinkContext,
): string {
  // Handle fragment layers (created by resolveCollectionLayers for nested collections)
  // Fragments render their children directly without a wrapper element
  if (layer.name === '_fragment' && layer.children) {
    return layer.children
      .map((child) =>
        layerToHtml(child, collectionItemId, pages, folders, collectionItemSlugs, locale, translations, anchorMap, collectionItemData, pageCollectionItemData, assetMap, layerDataMap, components, ancestorComponentIds, isSlideChild, pageLinkContext)
      )
      .join('');
  }

  // Use stored item values from cloned collection layers if available (multi-asset/nested collections)
  // This ensures layers inside collection items have access to the correct item values
  const effectiveCollectionItemData = layer._collectionItemValues || collectionItemData;
  const effectiveCollectionItemId = layer._collectionItemId || collectionItemId;

  // Build layer data map with stored collection layer data
  const effectiveLayerDataMap = layer._layerDataMap || layerDataMap;

  // Get the HTML tag
  let tag = getLayerHtmlTag(layer);

  // Buttons with link settings render as <a> directly instead of being
  // wrapped in <a><button></button></a> which is invalid HTML
  const buttonLinkSettings = layer.variables?.link;
  const isButtonWithLink = layer.name === 'button' && buttonLinkSettings && buttonLinkSettings.type;
  if (isButtonWithLink) {
    tag = 'a';
  }

  // Divs with link settings render as <a> directly instead of being
  // wrapped in <a class="contents"><div>…</div></a>.
  // Only match actual div layers (layer.name === 'div'), not other layers
  // whose tag was forced to 'div' by earlier overrides (e.g. headings with lists).
  const isDivWithLink = !isButtonWithLink
    && layer.name === 'div'
    && tag === 'div'
    && layer.id !== 'body'
    && buttonLinkSettings && buttonLinkSettings.type;
  if (isDivWithLink) {
    tag = 'a';
  }

  // Build classes string
  let classesStr = '';
  if (Array.isArray(layer.classes)) {
    classesStr = layer.classes.join(' ');
  } else if (typeof layer.classes === 'string') {
    classesStr = layer.classes;
  }

  // <a> with display:flex is block-level (full width) unlike <button> which
  // shrink-wraps. Add w-fit to match button sizing unless width is explicit.
  if (isButtonWithLink) {
    const cls = Array.isArray(layer.classes) ? layer.classes : (layer.classes || '').split(' ');
    const hasWidth = cls.some((c: string) => /^w-/.test(c.split(':').pop() || ''));
    if (!hasWidth) {
      classesStr = classesStr ? `${classesStr} w-fit` : 'w-fit';
    }
  }

  // Add Swiper-specific classes for slider layers
  if (SWIPER_CLASS_MAP[layer.name]) {
    classesStr = classesStr
      ? `${classesStr} ${SWIPER_CLASS_MAP[layer.name]}`
      : SWIPER_CLASS_MAP[layer.name];
  }

  if (isSlideChild) {
    classesStr = classesStr ? `${classesStr} swiper-slide` : 'swiper-slide';
  }

  // Build attributes
  const attrs: string[] = [];

  if (layer.id) {
    attrs.push(`data-layer-id="${escapeHtml(layer.id)}"`);
  }

  // Add data attributes for slider nav/pagination elements (used by SliderInitializer)
  if (SWIPER_DATA_ATTR_MAP[layer.name]) {
    attrs.push(SWIPER_DATA_ATTR_MAP[layer.name]);
  }

  // Add slider settings as data attribute on the root slider layer
  if (layer.name === 'slider' && layer.settings?.slider) {
    attrs.push(`data-slider-id="${escapeHtml(layer.id)}"`);
    attrs.push(`data-slider-settings="${escapeHtml(JSON.stringify(layer.settings.slider))}"`);
  }

  // Add lightbox data attributes for the lightbox layer
  if (layer.name === 'lightbox' && layer.settings?.lightbox) {
    const lbSettings = layer.settings.lightbox;
    const triggerId = lbSettings.groupId || layer.id;
    attrs.push(`data-lightbox-id="${escapeHtml(triggerId)}"`);
    // Strip builder-only fields from serialized settings
    const { filesField: _ff, filesSource: _fs, ...runtimeSettings } = lbSettings;
    attrs.push(`data-lightbox-settings="${escapeHtml(JSON.stringify(runtimeSettings))}"`);
    // Resolve lightbox file asset IDs to URLs
    const resolvedFiles = lbSettings.files
      .map((fileId: string) => {
        if (fileId.startsWith('http') || fileId.startsWith('/')) return fileId;
        const asset = assetMap?.[fileId];
        return asset?.public_url ?? null;
      })
      .filter(Boolean) as string[];
    if (resolvedFiles.length) {
      attrs.push(`data-lightbox-files="${escapeHtml(resolvedFiles.join(','))}"`);
    }
    // For grouped lightboxes, set which image to open to
    if (lbSettings.groupId && resolvedFiles.length > 0) {
      attrs.push(`data-lightbox-open-to="${escapeHtml(resolvedFiles[0])}"`);
    }
  }

  // Render filter-dependent conditional visibility data attributes
  if (layer.attributes?.['data-collection-empty-state']) {
    attrs.push(`data-collection-empty-state="${escapeHtml(layer.attributes['data-collection-empty-state'])}"`);
  }
  if (layer.attributes?.['data-collection-has-items']) {
    attrs.push(`data-collection-has-items="${escapeHtml(layer.attributes['data-collection-has-items'])}"`);
  }

  if (classesStr) {
    attrs.push(`class="${escapeHtml(classesStr)}"`);
  }

  if (layer.attributes?.id) {
    attrs.push(`id="${escapeHtml(layer.attributes.id)}"`);
  }

  // Hide elements marked as hiddenGenerated (e.g. alerts, slider fraction placeholder)
  if (layer.hiddenGenerated) {
    const existingDynamic = layer._dynamicStyles || {};
    layer = { ...layer, _dynamicStyles: { ...existingDynamic, display: 'none' } };
  }

  // Hide bullet pagination template until Swiper initializes and generates the real bullets
  if (layer.name === 'slideBullets') {
    const existingDynamic = layer._dynamicStyles || {};
    layer = { ...layer, _dynamicStyles: { ...existingDynamic, visibility: 'hidden' } };
  }

  // Build inline styles from dynamic sources (CMS color bindings + background image variable)
  // Route CMS-bound gradients through --bg-img variable instead of 'background'
  const rawDynamic = layer._dynamicStyles || {};
  const cmsGradient = rawDynamic.background?.includes('gradient(') ? rawDynamic.background : undefined;
  const inlineStyles: Record<string, string> = cmsGradient
    ? Object.fromEntries(Object.entries(rawDynamic).filter(([k]) => k !== 'background'))
    : { ...rawDynamic };

  // Combine static bgImageVars + bgGradientVars per CSS variable key
  const bgImageVars = layer.design?.backgrounds?.bgImageVars;
  const bgGradientVars = layer.design?.backgrounds?.bgGradientVars;
  Object.assign(inlineStyles, mergeStaticBgVars(bgImageVars, bgGradientVars));

  // Resolve background image from variable → set --bg-img CSS custom property (combined with gradient)
  const bgImageSrc = layer.variables?.backgroundImage?.src;
  if (bgImageSrc && bgImageSrc.type === 'dynamic_text') {
    const bgUrl = bgImageSrc.data.content;
    if (bgUrl && bgUrl.trim()) {
      const cssUrl = bgUrl.startsWith('url(') ? bgUrl : `url(${bgUrl})`;
      inlineStyles['--bg-img'] = combineBgValues(cssUrl, bgGradientVars?.['--bg-img']);
    }
  }

  // CMS-bound gradient routes through --bg-img variable
  if (cmsGradient) {
    const existingImg = inlineStyles['--bg-img']?.split(', ').find(v => v.startsWith('url(')) || bgImageVars?.['--bg-img'];
    inlineStyles['--bg-img'] = combineBgValues(existingImg, cmsGradient);
  }

  if (Object.keys(inlineStyles).length > 0) {
    const styleStr = Object.entries(inlineStyles)
      .map(([prop, val]) => {
        // Convert camelCase to kebab-case for CSS (except CSS variables)
        const cssProp = prop.startsWith('--') ? prop : prop.replace(/([A-Z])/g, '-$1').toLowerCase();
        return `${cssProp}:${val}`;
      })
      .join(';');
    attrs.push(`style="${escapeHtml(styleStr)}"`);
  }

  // Handle images (variables structure)
  if (tag === 'img') {
    const imageSrc = layer.variables?.image?.src;
    let resolvedSrcValue: string | undefined;
    if (imageSrc) {
      if (imageSrc.type === 'dynamic_text') {
        resolvedSrcValue = imageSrc.data.content || undefined;
      } else if (imageSrc.type === 'asset') {
        resolvedSrcValue = undefined;
      }
    }

    // Resolve intrinsic width/height up front: needed both for the width/
    // height attributes (CLS prevention) and to cap srcset descriptors so
    // they don't exceed the source's natural size.
    let imgWidth = layer.attributes?.width as string | undefined;
    let imgHeight = layer.attributes?.height as string | undefined;
    if ((!imgWidth || !imgHeight) && resolvedSrcValue && assetMap) {
      const matchedAsset = Object.values(assetMap).find(a => a.public_url === resolvedSrcValue);
      if (matchedAsset?.width && matchedAsset?.height) {
        if (!imgWidth) imgWidth = String(matchedAsset.width);
        if (!imgHeight) imgHeight = String(matchedAsset.height);
      }
    }

    const intrinsicWidth = parseImageDimension(imgWidth);
    const intrinsicHeight = parseImageDimension(imgHeight);

    if (resolvedSrcValue && resolvedSrcValue.trim()) {
      const optimizedSrc = getOptimizedImageUrl(resolvedSrcValue, 1920, 85);
      attrs.push(`src="${escapeHtml(optimizedSrc)}"`);

      const srcset = generateImageSrcset(resolvedSrcValue, undefined, undefined, intrinsicWidth);
      if (srcset) {
        attrs.push(`srcset="${escapeHtml(srcset)}"`);
        attrs.push(`sizes="${escapeHtml(buildImageSizes(intrinsicWidth))}"`);
      }
    }
    attrs.push('data-layer-type="image"');

    const imageAlt = layer.variables?.image?.alt;
    if (imageAlt && imageAlt.type === 'dynamic_text') {
      const resolvedAlt = resolveInlineVariablesFromData(imageAlt.data.content, effectiveCollectionItemData, pageCollectionItemData, 'UTC', effectiveLayerDataMap);
      attrs.push(`alt="${escapeHtml(resolvedAlt)}"`);
    }

    if (intrinsicWidth) attrs.push(`width="${intrinsicWidth}"`);
    if (intrinsicHeight) attrs.push(`height="${intrinsicHeight}"`);

    const imgLoadingAttr = layer.attributes?.loading;
    if (imgLoadingAttr) attrs.push(`loading="${escapeHtml(String(imgLoadingAttr))}"`);
  }

  // Handle YouTube video (VideoVariable with provider='youtube') - render as iframe
  if (layer.name === 'video') {
    const videoSrc = layer.variables?.video?.src;
    if (videoSrc && videoSrc.type === 'video' && 'provider' in videoSrc.data && videoSrc.data.provider === 'youtube') {
      const rawVideoId = videoSrc.data.video_id || '';
      // Resolve inline variables in video ID (supports CMS binding)
      const videoId = resolveInlineVariablesFromData(rawVideoId, effectiveCollectionItemData, pageCollectionItemData, 'UTC', effectiveLayerDataMap);
      const privacyMode = layer.attributes?.youtubePrivacyMode === true;
      const domain = privacyMode ? 'youtube-nocookie.com' : 'youtube.com';

      // Build YouTube embed URL with parameters
      const params: string[] = [];
      if (layer.attributes?.autoplay === true) params.push('autoplay=1');
      if (layer.attributes?.muted === true) params.push('mute=1');
      if (layer.attributes?.loop === true) params.push(`loop=1&playlist=${videoId}`);
      if (layer.attributes?.controls !== true) params.push('controls=0');

      const embedUrl = `https://www.${domain}/embed/${videoId}${params.length > 0 ? '?' + params.join('&') : ''}`;

      attrs.push(`src="${escapeHtml(embedUrl)}"`);
      attrs.push('frameborder="0"');
      attrs.push('allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"');
      attrs.push('allowfullscreen');
      attrs.push('data-layer-type="video"');

      const attrsStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
      const childrenHtml = layer.children
        ? layer.children
          .map((child) =>
            layerToHtml(child, effectiveCollectionItemId, pages, folders, collectionItemSlugs, locale, translations, anchorMap, effectiveCollectionItemData, pageCollectionItemData, assetMap, effectiveLayerDataMap, components, ancestorComponentIds, layer.name === 'slides', pageLinkContext)
          )
          .join('')
        : '';
      return `<iframe${attrsStr}>${childrenHtml}</iframe>`;
    }
  }

  // Handle Map layers — provider-aware iframe
  if (layer.name === 'map') {
    const mapSettings = {
      ...DEFAULT_MAP_SETTINGS,
      ...layer.settings?.map,
      mapbox: { ...DEFAULT_MAP_SETTINGS.mapbox, ...layer.settings?.map?.mapbox },
      google: { ...DEFAULT_MAP_SETTINGS.google, ...layer.settings?.map?.google },
    };
    const mapToken = mapSettings.provider === 'google'
      ? _cachedGoogleMapsEmbedKey
      : _cachedMapboxToken;

    if (mapToken) {
      const iframeProps = getMapIframeProps(mapSettings, mapToken);
      const attrsStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
      if (iframeProps.type === 'src') {
        return `<div${attrsStr}><iframe src="${escapeHtml(iframeProps.src)}" referrerpolicy="no-referrer-when-downgrade" loading="lazy" style="width:100%;height:100%;border:none;display:block" title="Map"></iframe></div>`;
      }
      const escapedSrcdoc = escapeHtml(iframeProps.srcDoc);
      return `<div${attrsStr}><iframe srcdoc="${escapedSrcdoc}" sandbox="allow-scripts allow-same-origin" style="width:100%;height:100%;border:none;display:block" title="Map"></iframe></div>`;
    }

    const attrsStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
    return `<div${attrsStr}></div>`;
  }

  // Handle video (variables structure)
  if (tag === 'video') {
    const videoSrc = layer.variables?.video?.src;
    if (videoSrc) {
      // Extract string value from variable (should be DynamicTextVariable after resolution)
      let srcValue: string | undefined = undefined;
      if (videoSrc.type === 'dynamic_text') {
        srcValue = videoSrc.data.content || undefined;
      } else if (videoSrc.type === 'asset') {
        // AssetVariable should have been resolved, but if not, skip
        srcValue = undefined;
      }
      if (srcValue && srcValue.trim()) {
        attrs.push(`src="${escapeHtml(srcValue)}"`);
      }
    }
    // Handle video poster
    const videoPoster = layer.variables?.video?.poster;
    if (videoPoster) {
      let posterValue: string | undefined = undefined;
      // After resolveAllAssets, poster should be DynamicTextVariable
      if ((videoPoster as any).type === 'dynamic_text') {
        posterValue = (videoPoster as any).data?.content || undefined;
      }
      if (posterValue && posterValue.trim()) {
        attrs.push(`poster="${escapeHtml(posterValue)}"`);
      }
    }
    attrs.push('data-layer-type="video"');
  }

  // Handle audio (variables structure)
  if (tag === 'audio') {
    const audioSrc = layer.variables?.audio?.src;
    if (audioSrc) {
      // Extract string value from variable (should be DynamicTextVariable after resolution)
      let srcValue: string | undefined = undefined;
      if (audioSrc.type === 'dynamic_text') {
        srcValue = audioSrc.data.content || undefined;
      } else if (audioSrc.type === 'asset') {
        // AssetVariable should have been resolved, but if not, skip
        srcValue = undefined;
      }
      if (srcValue && srcValue.trim()) {
        attrs.push(`src="${escapeHtml(srcValue)}"`);
      }
    }
    attrs.push('data-layer-type="audio"');
  }

  // Handle icons (variables structure)
  let iconHtml = '';
  if (layer.name === 'icon') {
    const iconSrc = layer.variables?.icon?.src;
    if (iconSrc) {
      iconHtml = getVariableStringValue(iconSrc) || '';
    }
    // Add data-icon attribute to trigger CSS styling
    attrs.push('data-icon="true"');
  }

  // Handle Code Embed layers - render as iframe for SSR
  if (layer.name === 'htmlEmbed') {
    const htmlEmbedCode = layer.settings?.htmlEmbed?.code || '<div>Add your custom code here</div>';

    // Static export has no React hydration to replace the SSR iframe with
    // an inline HtmlEmbedRenderer mount, and iframes default to ~150px
    // tall with no `height` set — clipping the user's content. Emit the
    // code inline so it renders at natural height, matching the editor.
    // <script> tags in initial document HTML are executed by the browser,
    // so user-pasted scripts run exactly as authored.
    if (pageLinkContext?.isStaticExport) {
      attrs.push('data-html-embed="true"');
      const inlineAttrsStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
      return `<div${inlineAttrsStr}>${htmlEmbedCode}</div>`;
    }

    // Create a complete HTML document for iframe srcdoc
    const iframeContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      margin: 0;
      padding: 0;
      overflow: hidden;
    }
  </style>
</head>
<body>
  ${htmlEmbedCode}
</body>
</html>`;

    // Escape the HTML for srcdoc attribute
    const escapedIframeContent = iframeContent
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;');

    attrs.push('data-html-embed="true"');
    attrs.push(`srcdoc="${escapedIframeContent}"`);
    attrs.push('sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"');
    attrs.push('style="width: 100%; border: none; display: block;"');
    attrs.push(`title="Code Embed ${layer.id}"`);

    const attrsStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
    return `<iframe${attrsStr}></iframe>`;
  }

  // Handle links (variables structure).
  // All link types share the same resolver as React rendering — `generateLinkHref` —
  // so behaviour stays consistent between SSR HTML output and client/published rendering.
  if (tag === 'a') {
    const linkSettings = layer.variables?.link;
    if (linkSettings) {
      const hrefValue = generateLinkHref(linkSettings, {
        pages,
        folders,
        collectionItemSlugs,
        collectionItemId: effectiveCollectionItemId,
        pageCollectionItemId: pageLinkContext?.pageCollectionItemId,
        collectionItemData: effectiveCollectionItemData,
        pageCollectionItemData,
        isPreview: pageLinkContext?.isPreview,
        locale,
        translations,
        getAsset: makeAssetMapResolver(assetMap),
        anchorMap,
        layerDataMap: effectiveLayerDataMap,
        pageCollectionSortedItemIds: pageLinkContext?.pageCollectionSortedItemIds,
      });

      if (hrefValue) {
        attrs.push(`href="${escapeHtml(hrefValue)}"`);
      } else if (isLinkAtCollectionBoundary(linkSettings, {
        pageCollectionItemId: pageLinkContext?.pageCollectionItemId,
        pageCollectionSortedItemIds: pageLinkContext?.pageCollectionSortedItemIds,
      })) {
        // First/last item in the collection: render as a non-navigable, accessible
        // disabled affordance instead of a bare `<a>` with no href.
        attrs.push('aria-disabled="true"');
        attrs.push('data-link-disabled="true"');
      }

      // Link behavior attributes from linkSettings
      const linkTarget = linkSettings.target;
      if (linkTarget) {
        attrs.push(`target="${escapeHtml(linkTarget)}"`);
      }
      const linkRel = linkSettings.rel || (linkTarget === '_blank' ? 'noopener noreferrer' : '');
      if (linkRel) {
        attrs.push(`rel="${escapeHtml(linkRel)}"`);
      }
      if (linkSettings.download) {
        attrs.push('download');
      }
    }
  }

  // Add custom attributes
  // Map JSX attribute names back to HTML equivalents for published output
  const jsxToHtmlAttrMap: Record<string, string> = {
    'htmlFor': 'for',
    'className': 'class',
    'autoFocus': 'autofocus',
  };
  if (layer.attributes) {
    for (const [key, value] of Object.entries(layer.attributes)) {
      // Skip type attribute for elements converted to <a>
      if ((isButtonWithLink || isDivWithLink) && key === 'type') continue;
      if (value !== undefined && value !== null) {
        const htmlKey = jsxToHtmlAttrMap[key] || key;
        // Boolean HTML attributes should be rendered without a value
        if (value === true) {
          attrs.push(escapeHtml(htmlKey));
        } else if (value !== false) {
          attrs.push(`${escapeHtml(htmlKey)}="${escapeHtml(String(value))}"`);
        }
      }
    }
  }

  if (layer.name === 'option' && layer.settings?.isPlaceholder) {
    attrs.push('selected');
  }

  // For buttons/divs rendered as <a>, resolve link href and add attributes directly
  if ((isButtonWithLink || isDivWithLink) && buttonLinkSettings) {
    let btnLinkHref = '';

    switch (buttonLinkSettings.type) {
      case 'url':
        btnLinkHref = buttonLinkSettings.url?.data?.content || '';
        break;
      case 'email':
        btnLinkHref = buttonLinkSettings.email?.data?.content ? `mailto:${buttonLinkSettings.email.data.content}` : '';
        break;
      case 'phone':
        btnLinkHref = buttonLinkSettings.phone?.data?.content ? `tel:${buttonLinkSettings.phone.data.content}` : '';
        break;
      case 'page':
        if (buttonLinkSettings.page?.id && pages && folders) {
          const linkedPage = pages.find(p => p.id === buttonLinkSettings.page?.id);
          if (linkedPage) {
            btnLinkHref = buildLocalizedSlugPath(linkedPage, folders, 'page', locale, translations);
          }
        }
        break;
      case 'field': {
        const fieldId = buttonLinkSettings.field?.data?.field_id;
        const collLayerId = buttonLinkSettings.field?.data?.collection_layer_id;
        let rawValue: string | undefined;
        if (collLayerId && effectiveLayerDataMap?.[collLayerId]) {
          rawValue = fieldId ? effectiveLayerDataMap[collLayerId][fieldId] : undefined;
        } else {
          rawValue = fieldId ? effectiveCollectionItemData?.[fieldId] : undefined;
        }
        if (fieldId && rawValue) {
          const fieldType = buttonLinkSettings.field?.data?.field_type;
          btnLinkHref = resolveFieldLinkValue({
            fieldId,
            rawValue,
            fieldType,
            context: {
              pages: pages || [],
              folders: folders || [],
              collectionItemSlugs,
              locale,
              translations,
              isPreview: false,
              getAsset: makeAssetMapResolver(assetMap),
            },
            assetMap,
          });
        }
        break;
      }
    }

    if (buttonLinkSettings.anchor_layer_id) {
      const anchorValue = anchorMap?.[buttonLinkSettings.anchor_layer_id] || buttonLinkSettings.anchor_layer_id;
      btnLinkHref = btnLinkHref ? `${btnLinkHref}#${anchorValue}` : `#${anchorValue}`;
    }

    if (btnLinkHref) {
      attrs.push(`href="${escapeHtml(btnLinkHref)}"`);
      if (buttonLinkSettings.target) {
        attrs.push(`target="${escapeHtml(buttonLinkSettings.target)}"`);
      }
      const btnLinkRel = buttonLinkSettings.rel || (buttonLinkSettings.target === '_blank' ? 'noopener noreferrer' : '');
      if (btnLinkRel) {
        attrs.push(`rel="${escapeHtml(btnLinkRel)}"`);
      }
      if (buttonLinkSettings.download) {
        attrs.push('download');
      }
    }
    if (isButtonWithLink) {
      attrs.push('role="button"');
    }
  }

  // For slider layers, strip inactive pagination/navigation children from the tree
  const effectiveChildren = (layer.name === 'slider' && layer.children)
    ? filterDisabledSliderLayers(layer.children, layer.settings)
    : layer.children;

  // Render children
  const childrenHtml = effectiveChildren
    ? effectiveChildren
      .map((child) =>
        layerToHtml(child, effectiveCollectionItemId, pages, folders, collectionItemSlugs, locale, translations, anchorMap, effectiveCollectionItemData, pageCollectionItemData, assetMap, effectiveLayerDataMap, components, ancestorComponentIds, layer.name === 'slides', pageLinkContext)
      )
      .join('')
    : '';

  // Get text content from variables.text
  const textVariable = layer.variables?.text;
  let textContent = '';
  let isRichText = false;

  if (textVariable) {
    if (textVariable.type === 'dynamic_text') {
      textContent = textVariable.data.content || '';
    } else if (textVariable.type === 'dynamic_rich_text') {
      // Build component renderer with circular reference prevention
      const componentRenderer: RenderComponentHtmlFn | undefined = components?.length
        ? (componentId, overrides, preResolvedLayers) => {
          if (ancestorComponentIds?.has(componentId)) return '';
          const comp = components.find(c => c.id === componentId);
          if (!comp) return '';
          const childAncestors = new Set(ancestorComponentIds);
          childAncestors.add(componentId);
          // Use pre-resolved layers (with collections) when available from resolveRichTextCollections
          let resolved: Layer[];
          if (preResolvedLayers) {
            resolved = preResolvedLayers;
          } else if (comp.layers?.length) {
            resolved = resolveComponents(
              applyComponentOverrides(comp.layers, overrides, comp.variables),
              components, comp.variables, overrides,
            );
          } else {
            return '';
          }
          const withAssets = assetMap
            ? resolved.map(l => resolveLayerAssets(l, assetMap))
            : resolved;
          // Generate initial animation CSS for embedded component layers
          const { css: rtcAnimCSS } = generateInitialAnimationCSS(withAssets);
          const rtcStyleTag = rtcAnimCSS ? `<style>${rtcAnimCSS}</style>` : '';
          return rtcStyleTag + withAssets
            .map(l => layerToHtml(l, effectiveCollectionItemId, pages, folders, collectionItemSlugs, locale, translations, anchorMap, effectiveCollectionItemData, pageCollectionItemData, assetMap, effectiveLayerDataMap, components, childAncestors, layer.name === 'slides', pageLinkContext))
            .join('');
        }
        : undefined;
      const richTextLinkContext: LinkResolutionContext = {
        pages,
        folders,
        collectionItemSlugs,
        collectionItemId: effectiveCollectionItemId,
        pageCollectionItemId: pageLinkContext?.pageCollectionItemId,
        collectionItemData: effectiveCollectionItemData,
        pageCollectionItemData,
        isPreview: pageLinkContext?.isPreview,
        locale,
        translations,
        getAsset: makeAssetMapResolver(assetMap),
        anchorMap,
        layerDataMap: effectiveLayerDataMap,
        pageCollectionSortedItemIds: pageLinkContext?.pageCollectionSortedItemIds,
      };
      textContent = renderTiptapToHtml(textVariable.data.content, layer.textStyles, componentRenderer, richTextLinkContext);
      isRichText = true;
    }
  }

  // Handle self-closing tags
  const selfClosingTags = ['img', 'br', 'hr', 'input', 'meta', 'link'];
  if (selfClosingTags.includes(tag)) {
    let selfClosingHtml = `<${tag} ${attrs.join(' ')} />`;

    // Wrap with link if layer has link settings.
    // Reuse `generateLinkHref` so all link types — including dynamic-page
    // collection_item_id keywords like `current-page` and `next-item` — work
    // identically to layer `<a>` tags and React rendering.
    const linkSettings = layer.variables?.link;
    if (linkSettings && linkSettings.type) {
      const linkHref = generateLinkHref(linkSettings, {
        pages,
        folders,
        collectionItemSlugs,
        collectionItemId: effectiveCollectionItemId,
        pageCollectionItemId: pageLinkContext?.pageCollectionItemId,
        collectionItemData: effectiveCollectionItemData,
        pageCollectionItemData,
        isPreview: pageLinkContext?.isPreview,
        locale,
        translations,
        getAsset: makeAssetMapResolver(assetMap),
        anchorMap,
        layerDataMap: effectiveLayerDataMap,
        pageCollectionSortedItemIds: pageLinkContext?.pageCollectionSortedItemIds,
      });

      const atBoundary = !linkHref && isLinkAtCollectionBoundary(linkSettings, {
        pageCollectionItemId: pageLinkContext?.pageCollectionItemId,
        pageCollectionSortedItemIds: pageLinkContext?.pageCollectionSortedItemIds,
      });

      if (linkHref || atBoundary) {
        const linkAttrs: string[] = [];
        if (linkHref) {
          linkAttrs.push(`href="${escapeHtml(linkHref)}"`);
        } else {
          linkAttrs.push('aria-disabled="true"', 'data-link-disabled="true"');
        }
        const linkTarget = linkSettings.target;
        if (linkTarget) {
          linkAttrs.push(`target="${escapeHtml(linkTarget)}"`);
        }
        const linkRel = linkSettings.rel || (linkTarget === '_blank' ? 'noopener noreferrer' : '');
        if (linkRel) {
          linkAttrs.push(`rel="${escapeHtml(linkRel)}"`);
        }
        if (linkSettings.download) {
          linkAttrs.push('download');
        }
        selfClosingHtml = `<a ${linkAttrs.join(' ')}>${selfClosingHtml}</a>`;
      }
    }

    return selfClosingHtml;
  }

  // Render the element
  const attrsStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';

  // For icon layers, use raw iconHtml (don't escape SVG content)
  // For rich text, content is already HTML-safe (escaped during Tiptap rendering)
  let elementHtml = '';
  if (layer.name === 'icon' && iconHtml) {
    elementHtml = `<${tag}${attrsStr}>${iconHtml}${childrenHtml}</${tag}>`;
  } else if (isRichText) {
    // Rich text content is already rendered to HTML, don't escape
    elementHtml = `<${tag}${attrsStr}>${textContent}${childrenHtml}</${tag}>`;
  } else {
    elementHtml = `<${tag}${attrsStr}>${escapeHtml(textContent)}${childrenHtml}</${tag}>`;
  }

  // Wrap with link if layer has link settings (but is not already an <a> tag)
  const linkSettings = layer.variables?.link;
  if (tag !== 'a' && linkSettings && linkSettings.type) {
    let linkHref = '';

    switch (linkSettings.type) {
      case 'url':
        linkHref = linkSettings.url?.data?.content || '';
        break;
      case 'email':
        linkHref = linkSettings.email?.data?.content ? `mailto:${linkSettings.email.data.content}` : '';
        break;
      case 'phone':
        linkHref = linkSettings.phone?.data?.content ? `tel:${linkSettings.phone.data.content}` : '';
        break;
      case 'page':
        if (linkSettings.page?.id && pages && folders) {
          const linkedPage = pages.find(p => p.id === linkSettings.page?.id);
          if (linkedPage) {
            // Use localized URL if locale is active
            linkHref = buildLocalizedSlugPath(linkedPage, folders, 'page', locale, translations);
          }
        }
        break;
      case 'field': {
        const wrapFieldId = linkSettings.field?.data?.field_id;
        const wrapCollectionLayerId = linkSettings.field?.data?.collection_layer_id;
        // Use layer-specific data if collection_layer_id is specified
        let rawValue: string | undefined;
        if (wrapCollectionLayerId && effectiveLayerDataMap?.[wrapCollectionLayerId]) {
          rawValue = wrapFieldId ? effectiveLayerDataMap[wrapCollectionLayerId][wrapFieldId] : undefined;
        } else {
          rawValue = wrapFieldId ? effectiveCollectionItemData?.[wrapFieldId] : undefined;
        }
        if (wrapFieldId && rawValue) {
          const fieldType = linkSettings.field?.data?.field_type;
          linkHref = resolveFieldLinkValue({
            fieldId: wrapFieldId,
            rawValue,
            fieldType,
            context: {
              pages: pages || [],
              folders: folders || [],
              collectionItemSlugs,
              locale,
              translations,
              isPreview: false,
              getAsset: makeAssetMapResolver(assetMap),
            },
            assetMap,
          });
        }
        break;
      }
    }

    // Append anchor if present - resolve layer ID to actual anchor value
    if (linkSettings.anchor_layer_id) {
      const anchorValue = anchorMap?.[linkSettings.anchor_layer_id] || linkSettings.anchor_layer_id;
      if (linkHref) {
        linkHref = `${linkHref}#${anchorValue}`;
      } else {
        linkHref = `#${anchorValue}`;
      }
    }

    // Wrap content in <a> tag if we have a valid href
    if (linkHref) {
      const linkAttrs: string[] = [`href="${escapeHtml(linkHref)}"`];

      if (linkSettings.target) {
        linkAttrs.push(`target="${escapeHtml(linkSettings.target)}"`);
      }

      const linkRel = linkSettings.rel || (linkSettings.target === '_blank' ? 'noopener noreferrer' : '');
      if (linkRel) {
        linkAttrs.push(`rel="${escapeHtml(linkRel)}"`);
      }

      if (linkSettings.download) {
        linkAttrs.push('download');
      }

      linkAttrs.push('class="contents"');

      elementHtml = `<a ${linkAttrs.join(' ')}>${elementHtml}</a>`;
    }
  }

  return elementHtml;
}
