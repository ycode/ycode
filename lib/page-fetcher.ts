import { cache } from 'react';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { buildSlugPath, buildDynamicPageUrl, buildLocalizedSlugPath, buildLocalizedDynamicPageUrl, detectLocaleFromPath, matchPageWithTranslatedSlugs, matchDynamicPageWithTranslatedSlugs } from '@/lib/page-utils';
import { getItemWithValues, getItemsWithValues } from '@/lib/repositories/collectionItemRepository';
import { getFieldsByCollectionId } from '@/lib/repositories/collectionFieldRepository';
import type { Page, PageFolder, PageLayers, Component, ComponentVariable, CollectionItemWithValues, CollectionField, Layer, CollectionPaginationMeta, Translation, Locale } from '@/types';
import { getCollectionVariable, resolveFieldValue, evaluateVisibility, getLayerHtmlTag, filterDisabledSliderLayers } from '@/lib/layer-utils';
import { isFieldVariable, isAssetVariable, createDynamicTextVariable, createDynamicRichTextVariable, createAssetVariable, getDynamicTextContent, getVariableStringValue, getAssetId, resolveDesignStyles } from '@/lib/variable-utils';
import { generateImageSrcset, getImageSizes, getOptimizedImageUrl, getAssetProxyUrl, DEFAULT_ASSETS, collectLayerAssetIds } from '@/lib/asset-utils';
import { resolveComponents, applyComponentOverrides } from '@/lib/resolve-components';
import { extractInlineNodesFromRichText, isTiptapDoc, hasBlockElementsWithResolver } from '@/lib/tiptap-utils';
import { DEFAULT_TEXT_STYLES } from '@/lib/text-format-utils';

// Pagination context passed through to resolveCollectionLayers
export interface PaginationContext {
  // Map of layerId -> page number (defaults to 1 if not specified)
  pageNumbers?: Record<string, number>;
  // Default page number for all collection layers (from URL ?page=N)
  defaultPage?: number;
}
import { resolveFieldLinkValue } from '@/lib/link-utils';
import { SWIPER_CLASS_MAP, SWIPER_DATA_ATTR_MAP } from '@/lib/templates/utilities';
import { resolveInlineVariables, resolveInlineVariablesFromData } from '@/lib/inline-variables';
import { buildLayerTranslationKey, getTranslationByKey, hasValidTranslationValue, getTranslationValue } from '@/lib/localisation-utils';
import { formatDateFieldsInItemValues } from '@/lib/date-format-utils';
import { getSettingByKey } from '@/lib/repositories/settingsRepository';
import { parseMultiAssetFieldValue, buildAssetVirtualValues } from '@/lib/multi-asset-utils';
import { parseMultiReferenceValue } from '@/lib/collection-utils';
import { combineBgValues, mergeStaticBgVars } from '@/lib/tailwind-class-mapper';
import { getAssetsByIds } from '@/lib/repositories/assetRepository';
import { isVirtualAssetField, findDisplayField } from '@/lib/collection-field-utils';
import type { FieldVariable, AssetVariable, DynamicTextVariable } from '@/types';
import type { DesignColorVariable } from '@/types';

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
  locale?: Locale | null; // Current locale (if detected from URL)
  availableLocales?: Locale[]; // All active locales for locale switcher
  translations?: Record<string, Translation>; // Translations for locale-aware URL generation
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

    // Fetch all translations for this locale
    const { data: translations } = await supabase
      .from('translations')
      .select('*')
      .eq('locale_id', locale.id)
      .eq('is_published', isPublished)
      .is('deleted_at', null);

    if (!translations) {
      return { locale, translations: {} };
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
export const fetchPageByPath = cache(async function fetchPageByPath(
  slugPath: string,
  isPublished: boolean,
  paginationContext?: PaginationContext,
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

    const validLocaleCodes = availableLocales?.map(l => l.code) || [];

    // Detect locale from URL path using database locale codes
    const localeDetection = detectLocaleFromPath(slugPath, validLocaleCodes);
    const pathWithoutLocale = localeDetection?.remainingPath ?? slugPath;

    // Load translations if locale detected
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

    // Fetch pages, folders, and components in parallel
    const [{ data: pages }, { data: folders }, components] = await Promise.all([
      supabase.from('pages').select('*').eq('is_published', isPublished).is('deleted_at', null),
      supabase.from('page_folders').select('*').eq('is_published', isPublished).is('deleted_at', null),
      fetchComponents(supabase, isPublished),
    ]);

    if (!pages || !folders) {
      return null;
    }

    const targetPath = pathWithoutLocale;

    // If path is empty after locale detection (e.g., "/fr/" -> "fr" -> ""),
    // try to fetch the homepage
    if (targetPath === '' && detectedLocale) {
      // Pass preloaded components to avoid redundant query
      const homepageData = await fetchHomepage(isPublished, paginationContext, components);
      if (homepageData) {
        // Components and collection layers are already resolved by fetchHomepage
        // Apply translations for the detected locale
        let processedLayers = homepageData.pageLayers.layers || [];
        if (translations && Object.keys(translations).length > 0) {
          processedLayers = injectTranslatedText(processedLayers, homepageData.page.id, translations);
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
          components: homepageData.components, // Layers are pre-resolved; components passed for rich-text embedded rendering
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
          // Found a matching dynamic page pattern
          matchingPage = dynamicPage;

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
              // Collection item not found for this slug
              return null;
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
            enhancedItemValues = applyCmsTranslations(collectionItem.id, enhancedItemValues, collectionFields, translations);

            // Format date fields in user's timezone
            const timezone = (await getSettingByKey('timezone') as string | null) || 'UTC';
            enhancedItemValues = formatDateFieldsInItemValues(enhancedItemValues, collectionFields, timezone);

            // Create enhanced collection item with resolved reference values and translations
            const enhancedCollectionItem = {
              ...collectionItem,
              values: enhancedItemValues,
            };

            // First, resolve components so collection layers inside components are available
            const layersWithComponents = resolveComponents(pageLayers?.layers || [], components);

            // Inject dynamic page collection data into layers (including expanded component layers)
            // This resolves inline variables like "Name → Location" on the page
            const layersWithInjectedData = await Promise.all(
              layersWithComponents.map((layer: Layer) =>
                injectCollectionData(layer, enhancedItemValues, collectionFields, isPublished)
              )
            );

            // Then resolve collection layers (nested collections will handle their own injection)
            // The isPublished parameter controls which collection items to fetch
            // Pass enhanced values so nested collections can filter based on dynamic page data
            let resolvedLayers = layersWithInjectedData.length > 0
              ? await resolveCollectionLayers(layersWithInjectedData, isPublished, enhancedItemValues, paginationContext, translations)
              : [];

            // Resolve collections inside rich text embedded components
            resolvedLayers = await resolveRichTextCollections(resolvedLayers, components, isPublished, translations);

            // Apply translations (components already resolved above)
            if (detectedLocale && translations && Object.keys(translations).length > 0) {
              resolvedLayers = injectTranslatedText(resolvedLayers, matchingPage.id, translations);
            }

            // Resolve all AssetVariables to URLs server-side (prevents client-side API calls)
            const resolved = await resolveAllAssets(resolvedLayers, isPublished, components);
            resolvedLayers = resolved.layers;

            return {
              page: matchingPage,
              pageLayers: {
                ...pageLayers,
                layers: resolvedLayers,
              },
              components, // Layers are pre-resolved; components passed for rich-text embedded rendering
              collectionItem: enhancedCollectionItem, // Include enhanced collection item for dynamic pages
              collectionFields, // Include collection fields for resolving placeholders
              locale: detectedLocale,
              availableLocales: availableLocales as Locale[] || [],
              translations,
            };
          }
        }
      }

      // No matching page found (neither exact nor dynamic)
      return null;
    }

    // Handle non-dynamic page (exact match)
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

    // First, resolve components so collection layers inside components are available
    const layersWithComponents = resolveComponents(pageLayers?.layers || [], components);

    // Resolve collection layers server-side (for both draft and published)
    // The isPublished parameter controls which collection items to fetch
    let resolvedLayers = layersWithComponents.length > 0
      ? await resolveCollectionLayers(layersWithComponents, isPublished, undefined, paginationContext, translations)
      : [];

    // Resolve collections inside rich text embedded components
    resolvedLayers = await resolveRichTextCollections(resolvedLayers, components, isPublished, translations);

    // Apply translations (components already resolved above)
    if (detectedLocale && translations && Object.keys(translations).length > 0) {
      resolvedLayers = injectTranslatedText(resolvedLayers, matchingPage.id, translations);
    }

    // Resolve all AssetVariables to URLs server-side (prevents client-side API calls)
    const resolved = await resolveAllAssets(resolvedLayers, isPublished, components);
    resolvedLayers = resolved.layers;

    return {
      page: matchingPage,
      pageLayers: {
        ...pageLayers,
        layers: resolvedLayers,
      },
      components, // Layers are pre-resolved; components passed for rich-text embedded rendering
      locale: detectedLocale,
      availableLocales: availableLocales as Locale[] || [],
      translations,
    };
  } catch (error) {
    console.error('Failed to fetch page:', error);
    return null;
  }
});

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
  tenantId?: string
): Promise<Pick<PageData, 'page' | 'pageLayers' | 'components' | 'locale' | 'availableLocales' | 'translations'> | null> {
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

    // First, resolve components so collection layers inside components are available
    const layersWithComponents = resolveComponents(pageLayers?.layers || [], components);

    // Resolve collection layers server-side (for both draft and published)
    let resolvedLayers = layersWithComponents.length > 0
      ? await resolveCollectionLayers(layersWithComponents, isPublished, undefined, paginationContext, undefined)
      : [];

    // Resolve collections inside rich text embedded components
    resolvedLayers = await resolveRichTextCollections(resolvedLayers, components, isPublished);

    // Resolve all AssetVariables to URLs server-side (prevents client-side API calls)
    const resolved = await resolveAllAssets(resolvedLayers, isPublished, components);
    resolvedLayers = resolved.layers;

    return {
      page: homepage,
      pageLayers: {
        ...pageLayers,
        layers: resolvedLayers,
      },
      components, // Layers are pre-resolved; components passed for rich-text embedded rendering
      locale: null, // Homepage accessed without locale prefix
      availableLocales: availableLocales as Locale[] || [],
      translations: {}, // Homepage accessed without locale prefix
    };
  } catch (error) {
    return null;
  }
});

/**
 * Inject translated text and assets into layers recursively
 * Replaces layer text content and asset sources with translations when available
 * Handles both page-level and component-level translations
 * @param layers - Layer tree to translate
 * @param pageId - Page ID for building translation keys
 * @param translations - Translations map
 * @returns Layers with translated text and assets
 */
function injectTranslatedText(
  layers: Layer[],
  pageId: string,
  translations: Record<string, Translation>
): Layer[] {
  return layers.map(layer => {
    const updates: Partial<Layer> = {};
    const variableUpdates: Partial<Layer['variables']> = {};

    // 1. Inject text translation
    const textTranslationKey = buildLayerTranslationKey(pageId, `layer:${layer.id}:text`, layer._masterComponentId);
    const textTranslation = getTranslationByKey(translations, textTranslationKey);

    const textValue = getTranslationValue(textTranslation);
    if (textValue) {
      // Preserve the original variable type (dynamic_text or dynamic_rich_text)
      if (layer.variables?.text?.type === 'dynamic_rich_text') {
        variableUpdates.text = createDynamicRichTextVariable(textValue);
      } else {
        variableUpdates.text = createDynamicTextVariable(textValue);
      }
    }

    // 2. Inject asset translations for media layers
    // Image layer - translate src and alt text
    if (layer.name === 'image') {
      const imageSrcKey = buildLayerTranslationKey(pageId, `layer:${layer.id}:image_src`, layer._masterComponentId);
      const imageSrcTranslation = getTranslationByKey(translations, imageSrcKey);
      const imageAltKey = buildLayerTranslationKey(pageId, `layer:${layer.id}:image_alt`, layer._masterComponentId);
      const imageAltTranslation = getTranslationByKey(translations, imageAltKey);

      if (imageSrcTranslation || imageAltTranslation) {
        const imageUpdates: any = { ...layer.variables?.image };

        if (imageSrcTranslation && imageSrcTranslation.content_value) {
          imageUpdates.src = createAssetVariable(imageSrcTranslation.content_value);
        }

        const imageAltValue = getTranslationValue(imageAltTranslation);
        if (imageAltValue) {
          imageUpdates.alt = createDynamicTextVariable(imageAltValue);
        } else {
          // Preserve original alt if no translation
          imageUpdates.alt = layer.variables?.image?.alt || createDynamicTextVariable('');
        }

        variableUpdates.image = imageUpdates;
      }
    }

    // Video layer - translate src and poster
    if (layer.name === 'video') {
      const videoSrcKey = buildLayerTranslationKey(pageId, `layer:${layer.id}:video_src`, layer._masterComponentId);
      const videoSrcTranslation = getTranslationByKey(translations, videoSrcKey);
      const videoPosterKey = buildLayerTranslationKey(pageId, `layer:${layer.id}:video_poster`, layer._masterComponentId);
      const videoPosterTranslation = getTranslationByKey(translations, videoPosterKey);

      if (videoSrcTranslation || videoPosterTranslation) {
        const videoUpdates: any = { ...layer.variables?.video };

        if (videoSrcTranslation && videoSrcTranslation.content_value) {
          videoUpdates.src = createAssetVariable(videoSrcTranslation.content_value);
        }

        if (videoPosterTranslation && videoPosterTranslation.content_value) {
          videoUpdates.poster = createAssetVariable(videoPosterTranslation.content_value);
        }

        variableUpdates.video = videoUpdates;
      }
    }

    // Audio layer - translate src
    if (layer.name === 'audio') {
      const audioSrcKey = buildLayerTranslationKey(pageId, `layer:${layer.id}:audio_src`, layer._masterComponentId);
      const audioSrcTranslation = getTranslationByKey(translations, audioSrcKey);

      if (audioSrcTranslation && audioSrcTranslation.content_value) {
        variableUpdates.audio = {
          src: createAssetVariable(audioSrcTranslation.content_value),
        };
      }
    }

    // Icon layer - translate src
    if (layer.name === 'icon') {
      const iconSrcKey = buildLayerTranslationKey(pageId, `layer:${layer.id}:icon_src`, layer._masterComponentId);
      const iconSrcTranslation = getTranslationByKey(translations, iconSrcKey);

      if (iconSrcTranslation && iconSrcTranslation.content_value) {
        variableUpdates.icon = {
          src: createAssetVariable(iconSrcTranslation.content_value),
        };
      }
    }

    // Apply variable updates if any
    if (Object.keys(variableUpdates).length > 0) {
      updates.variables = {
        ...layer.variables,
        ...variableUpdates,
      };
    }

    // Recursively process children
    if (layer.children && layer.children.length > 0) {
      updates.children = injectTranslatedText(layer.children, pageId, translations);
    }

    return {
      ...layer,
      ...updates,
    };
  });
}

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
 * Apply CMS translations to collection item values
 * @param itemId - Collection item ID
 * @param itemValues - Original item values (field_id -> value)
 * @param collectionFields - Collection fields to determine field keys
 * @param translations - Translations map
 * @returns Item values with translations applied
 */
function applyCmsTranslations(
  itemId: string,
  itemValues: Record<string, string>,
  collectionFields: CollectionField[],
  translations?: Record<string, Translation>
): Record<string, string> {
  if (!translations || Object.keys(translations).length === 0) {
    return itemValues;
  }

  const translatedValues = { ...itemValues };

  // Create a map of field ID to field key for lookup
  const fieldIdToKey = new Map<string, string | null>();
  for (const field of collectionFields) {
    fieldIdToKey.set(field.id, field.key);
  }

  // Apply translations for each field
  for (const fieldId of Object.keys(itemValues)) {
    const fieldKey = fieldIdToKey.get(fieldId);

    // Build translation key: field:key:{key} or field:id:{id} when key is null
    const contentKey = fieldKey ? `field:key:${fieldKey}` : `field:id:${fieldId}`;
    const translationKey = `cms:${itemId}:${contentKey}`;
    const translation = translations[translationKey];

    const translatedValue = getTranslationValue(translation);
    if (translatedValue) {
      translatedValues[fieldId] = translatedValue;
    }
  }

  return translatedValues;
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
      // Fetch the referenced item
      const refItem = await getItemWithValues(refItemId, isPublished);
      if (!refItem) continue;

      // Get fields for the referenced collection
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
 * Inject collection field values into a layer and its children
 * Recursively resolves field variables in text, images, etc.
 * @param layer - Layer to inject data into
 * @param itemValues - Collection item field values (field_id -> value)
 * @param fields - Optional collection fields (for reference field resolution)
 * @param isPublished - Whether fetching published data
 * @param layerDataMap - Map of layer ID → item data for layer-specific resolution
 * @returns Layer with resolved field values
 */
async function injectCollectionData(
  layer: Layer,
  itemValues: Record<string, string>,
  fields?: CollectionField[],
  isPublished: boolean = true,
  layerDataMap?: Record<string, Record<string, string>>
): Promise<Layer> {
  // Resolve reference fields if we have field definitions
  let enhancedValues = itemValues;
  if (fields && fields.length > 0) {
    enhancedValues = await resolveReferenceFields(itemValues, fields, isPublished);
  }

  const updates: Partial<Layer> = {};

  // Resolve inline variables in text content
  const textVariable = layer.variables?.text;

  // Handle DynamicRichTextVariable (Tiptap JSON with dynamicVariable nodes)
  if (textVariable && textVariable.type === 'dynamic_rich_text') {
    const content = textVariable.data.content;
    if (content && typeof content === 'object') {
      // Check if content contains block elements (lists) from inline variables
      // If so, change restrictive tags (p, h1-h6, etc.) to div
      const restrictiveBlockTags = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'a', 'button'];
      const currentTag = layer.settings?.tag || layer.name || 'div';
      if (restrictiveBlockTags.includes(currentTag) &&
          hasBlockElementsInInlineVariables(content, enhancedValues)) {
        updates.settings = {
          ...layer.settings,
          tag: 'div',
        };
      }

      const resolvedContent = resolveRichTextVariables(content, enhancedValues, layerDataMap);
      updates.variables = {
        ...layer.variables,
        text: {
          type: 'dynamic_rich_text',
          data: { content: resolvedContent }
        }
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
      const resolved = resolveInlineVariablesWithRelationships(textContent, mockItem);

      updates.variables = {
        ...layer.variables,
        text: {
          type: 'dynamic_text',
          data: { content: resolved }
        }
      };
    }
  }

  // Image src field binding (variables structure)
  const imageSrc = layer.variables?.image?.src;
  if (imageSrc && isFieldVariable(imageSrc) && imageSrc.data.field_id) {
    const resolvedValue = resolveFieldValueWithRelationships(imageSrc, enhancedValues, layerDataMap);
    updates.variables = {
      ...updates.variables,
      ...layer.variables,
      image: {
        src: createResolvedAssetVariable(imageSrc.data.field_id, resolvedValue, imageSrc),
        alt: layer.variables?.image?.alt || createDynamicTextVariable(''),
      },
    };
  }

  // Video src field binding (variables structure)
  const videoSrc = layer.variables?.video?.src;
  if (videoSrc && isFieldVariable(videoSrc) && videoSrc.data.field_id) {
    const resolvedValue = resolveFieldValueWithRelationships(videoSrc, enhancedValues, layerDataMap);
    updates.variables = {
      ...updates.variables,
      ...layer.variables,
      video: {
        ...layer.variables?.video,
        src: createResolvedAssetVariable(videoSrc.data.field_id, resolvedValue, videoSrc),
      },
    };
  }

  // Audio src field binding (variables structure)
  const audioSrc = layer.variables?.audio?.src;
  if (audioSrc && isFieldVariable(audioSrc) && audioSrc.data.field_id) {
    const resolvedValue = resolveFieldValueWithRelationships(audioSrc, enhancedValues, layerDataMap);
    updates.variables = {
      ...updates.variables,
      ...layer.variables,
      audio: {
        ...layer.variables?.audio,
        src: createResolvedAssetVariable(audioSrc.data.field_id, resolvedValue, audioSrc),
      },
    };
  }

  // Background image src field binding (variables structure)
  const bgImageSrc = layer.variables?.backgroundImage?.src;
  if (bgImageSrc && isFieldVariable(bgImageSrc) && bgImageSrc.data.field_id) {
    const resolvedValue = resolveFieldValueWithRelationships(bgImageSrc, enhancedValues, layerDataMap);
    updates.variables = {
      ...updates.variables,
      ...layer.variables,
      backgroundImage: {
        src: createResolvedAssetVariable(bgImageSrc.data.field_id, resolvedValue, bgImageSrc),
      },
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

  // Recursively process children, but SKIP collection layers
  // Collection layers will be processed by resolveCollectionLayers with their own item data
  if (layer.children) {
    const resolvedChildren = await Promise.all(
      layer.children.map(child => {
        // Skip collection layers - they'll be processed separately with correct per-item data
        if (child.variables?.collection?.id) {
          return Promise.resolve(child);
        }
        return injectCollectionData(child, enhancedValues, fields, isPublished, layerDataMap);
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
  collectionItem: CollectionItemWithValues
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
        if (relationships.length > 0) {
          const fullPath = [fieldId, ...relationships].join('.');
          const fieldValue = collectionItem.values[fullPath];
          return fieldValue || '';
        }

        // Simple field lookup
        const fieldValue = collectionItem.values[fieldId];
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
 */
function resolveRichTextVariables(
  content: any,
  itemValues: Record<string, string>,
  layerDataMap?: Record<string, Record<string, string>>
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

      // Handle rich_text fields - inline the nested Tiptap content
      if (fieldType === 'rich_text' && isTiptapDoc(value)) {
        const inlineNodes = extractInlineNodesFromRichText(value.content, content.marks || []);
        // Recursively resolve any nested dynamic variables
        return inlineNodes.map(node => resolveRichTextVariables(node, itemValues, layerDataMap));
      }

      // Fallback for rich_text that's not a valid doc structure
      if (fieldType === 'rich_text' && value && typeof value === 'object') {
        return {
          type: 'text',
          text: JSON.stringify(value),
          marks: content.marks || [],
        };
      }

      // For other field types, convert to string
      const textValue = value != null ? String(value) : '';

      // Replace variable node with text node, preserving marks (bold, italic, etc.)
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
      const resolved = resolveRichTextVariables(node, itemValues, layerDataMap);
      return Array.isArray(resolved) ? resolved : [resolved];
    });
  }

  // Recursively process object properties
  const result: any = {};
  for (const key of Object.keys(content)) {
    if (key === 'content' && Array.isArray(content[key])) {
      // Flatten the content array in case of expanded rich_text nodes
      result[key] = content[key].flatMap((node: any) => {
        const resolved = resolveRichTextVariables(node, itemValues, layerDataMap);
        return Array.isArray(resolved) ? resolved : [resolved];
      });
    } else if (typeof content[key] === 'object' && content[key] !== null) {
      result[key] = resolveRichTextVariables(content[key], itemValues, layerDataMap);
    } else {
      result[key] = content[key];
    }
  }

  return result;
}

/**
 * Resolve collection layers server-side by fetching their data
 * Recursively traverses the layer tree and injects collection items
 * @param layers - Layer tree to resolve
 * @param isPublished - Whether to fetch published or draft items
 * @param parentItemValues - Optional parent item values for multi-reference filtering
 * @param paginationContext - Optional pagination context with page numbers
 * @param translations - Optional translations map for CMS field translations
 * @returns Layers with collection data injected
 */

/**
 * Remaps all layer IDs in a subtree to make them unique per collection item.
 * Also updates interaction tween layer_id references to match the new IDs.
 * This prevents animations from targeting only the first collection item
 * when multiple items share the same child layer IDs in the DOM.
 */
function remapLayerIdsForCollectionItem(layer: Layer, suffix: string): Layer {
  // First pass: collect all original IDs in the subtree
  const originalIds = new Set<string>();
  const collectIds = (l: Layer) => {
    originalIds.add(l.id);
    l.children?.forEach(collectIds);
  };
  collectIds(layer);

  // Second pass: remap IDs and interaction tween references
  const remapLayer = (l: Layer): Layer => {
    const remapped: Layer = {
      ...l,
      id: `${l.id}${suffix}`,
    };

    if (l.interactions?.length) {
      remapped.interactions = l.interactions.map(interaction => ({
        ...interaction,
        // Make interaction ID unique so AnimationInitializer caches separate timelines per item
        id: `${interaction.id}${suffix}`,
        tweens: interaction.tweens.map(tween => ({
          ...tween,
          layer_id: originalIds.has(tween.layer_id)
            ? `${tween.layer_id}${suffix}`
            : tween.layer_id,
        })),
      }));
    }

    if (l.children) {
      remapped.children = l.children.map(remapLayer);
    }

    return remapped;
  };

  return remapLayer(layer);
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
      if (comp?.layers?.length) {
        const childAncestors = new Set(ancestorComponentIds);
        childAncestors.add(componentId);

        const overrides = node.attrs.componentOverrides ?? undefined;
        const withOverrides = applyComponentOverrides(comp.layers, overrides, comp.variables);
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

export async function resolveCollectionLayers(
  layers: Layer[],
  isPublished: boolean,
  parentItemValues?: Record<string, string>,
  paginationContext?: PaginationContext,
  translations?: Record<string, Translation>
): Promise<Layer[]> {
  // Fetch timezone setting for date formatting
  const timezone = (await getSettingByKey('timezone') as string | null) || 'UTC';

  const resolveLayer = async (
    layer: Layer,
    itemValues?: Record<string, string>,
    parentLayerDataMap?: Record<string, Record<string, string>>
  ): Promise<Layer> => {
    // Merge parent's layer data map with layer's own map
    const layerDataMap = { ...parentLayerDataMap, ...(layer._layerDataMap || {}) };
    // Check if this is a collection layer
    const isCollectionLayer = !!layer.variables?.collection?.id;

    if (isCollectionLayer) {
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
                    injectCollectionData(child, virtualValues, undefined, isPublished, updatedLayerDataMap)
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

          // Build filters for the query
          const filters: any = {};
          if (limit) filters.limit = limit;
          if (offset) filters.offset = offset;

          // For reference/multi-reference fields, get allowed item IDs BEFORE fetching
          // This ensures pagination counts and offsets are correct for the filtered set
          let allowedItemIds: string[] | undefined;
          if (sourceFieldId && itemValues) {
            const refValue = itemValues[sourceFieldId];
            if (refValue) {
              if (sourceFieldType === 'reference') {
                // Single reference: only one item ID
                allowedItemIds = Array.isArray(refValue) ? refValue : [refValue];
              } else {
                // Multi-reference: parse array (handles both array and JSON string formats)
                allowedItemIds = parseMultiReferenceValue(refValue);
              }
            } else {
              // No value in parent item for this field - show no items
              allowedItemIds = [];
            }
          }

          // Pass allowed item IDs as filter so count and pagination are correct
          if (allowedItemIds !== undefined) {
            filters.itemIds = allowedItemIds;
          }

          // Fetch items with values - total count now reflects filtered set
          const fetchResult = await getItemsWithValues(
            collectionVariable.id,
            isPublished,
            filters
          );
          let items = fetchResult.items;
          const totalItems = fetchResult.total;

          // Apply static collection filters (evaluate against each item's own values)
          // Dynamic filters (conditions with inputLayerId) are handled client-side
          // by FilterableCollection, so we strip them here during SSR
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
              // Field-based sorting
              sortedItems = items.sort((a, b) => {
                const aValue = a.values[sortBy] || '';
                const bValue = b.values[sortBy] || '';
                const aNum = parseFloat(String(aValue));
                const bNum = parseFloat(String(bValue));

                if (!isNaN(aNum) && !isNaN(bNum)) {
                  return sortOrder === 'desc' ? bNum - aNum : aNum - bNum;
                }

                const comparison = String(aValue).localeCompare(String(bValue));
                return sortOrder === 'desc' ? -comparison : comparison;
              });
            }
          }

          // Fetch collection fields for reference resolution
          const collectionFields = await getFieldsByCollectionId(collectionVariable.id, isPublished, { excludeComputed: true });

          // Find slug field for building collection item URLs
          const slugField = collectionFields.find(f => f.key === 'slug');
          // Clone the collection layer for each item (design settings apply to each repeated item)
          // For each item, resolve nested collection layers with that item's values
          // Note: Pagination is now a sibling layer, not a child, so no filtering needed
          const clonedLayers: Layer[] = await Promise.all(
            sortedItems.map(async (item) => {
              // Apply CMS translations to item values before using them
              let translatedValues = applyCmsTranslations(item.id, item.values, collectionFields, translations);
              // Format date fields in user's timezone
              translatedValues = formatDateFieldsInItemValues(translatedValues, collectionFields, timezone);

              // Resolve reference fields BEFORE building layerDataMap
              // This ensures relationship paths (e.g., "refFieldId.targetFieldId") are available
              const enhancedValues = await resolveReferenceFields(translatedValues, collectionFields, isPublished);

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
              const resolvedChildren = layer.children?.length
                ? await Promise.all(layer.children.map(child => resolveLayer(child, enhancedValues, updatedLayerDataMap)))
                : [];

              // Then inject field data into the resolved children
              const injectedChildren = await Promise.all(
                resolvedChildren.map(child =>
                  injectCollectionData(child, enhancedValues, collectionFields, isPublished, updatedLayerDataMap)
                )
              );

              // Build the cloned layer with original IDs first
              const clonedLayer: Layer = {
                ...layer,  // Clone all properties including classes, design, name, etc.
                attributes: {
                  ...layer.attributes,
                  'data-collection-item-id': item.id,
                } as Record<string, any>,
                variables: {
                  ...layer.variables,
                  collection: undefined,  // Remove collection binding from clone
                },
                children: injectedChildren,
                // Store enhanced item values (with resolved references) for visibility filtering (SSR only, not serialized to client)
                _collectionItemValues: enhancedValues,
                // Store item ID and slug for URL building in link resolution (SSR only)
                _collectionItemId: item.id,
                _collectionItemSlug: itemSlug,
                // Store layer data map for layer-specific field resolution
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
            } : undefined,
          };
        } catch (error) {
          console.error(`Failed to resolve collection layer ${layer.id}:`, error);
          return {
            ...layer,
            children: layer.children ? await Promise.all(layer.children.map(child => resolveLayer(child, itemValues, layerDataMap))) : undefined,
          };
        }
      }
    }

    // Collection-sourced select: replace children with options from a collection
    if (layer.name === 'select' && layer.settings?.optionsSource?.collectionId) {
      try {
        const sourceCollectionId = layer.settings.optionsSource.collectionId;
        let { items: sourceItems } = await getItemsWithValues(sourceCollectionId, isPublished);
        const sourceFields = await getFieldsByCollectionId(sourceCollectionId, isPublished);
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

        const placeholderOption: Layer = {
          id: `${layer.id}-opt-placeholder`,
          name: 'option',
          classes: '',
          attributes: { value: '' },
          variables: {
            text: { type: 'dynamic_text' as const, data: { content: 'Select...' } },
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
            ...(hasDefault ? { value: defaultItemId } : {}),
          },
          children: [placeholderOption, ...generatedOptions],
        };
      } catch (error) {
        console.error(`Failed to resolve collection-sourced select options for layer ${layer.id}:`, error);
      }
    }

    // Recursively resolve children, passing current item values and layer data map
    if (layer.children) {
      return {
        ...layer,
        children: await Promise.all(layer.children.map(child => resolveLayer(child, itemValues, layerDataMap))),
      };
    }

    return layer;
  };

  const result = await Promise.all(layers.map(layer => resolveLayer(layer, parentItemValues, undefined)));

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
  translations?: Record<string, Translation>
): Promise<string> {
  // Fetch collection fields for field resolution
  const collectionFields = await getFieldsByCollectionId(collectionId, isPublished, { excludeComputed: true });

  // Get timezone setting for date formatting
  const htmlTimezone = (await getSettingByKey('timezone') as string | null) || 'UTC';

  // Render each item using the template
  const renderedItems = await Promise.all(
    items.map(async (item, index) => {
      // Format date fields in user's timezone
      const formattedValues = formatDateFieldsInItemValues(item.values, collectionFields, htmlTimezone);

      // Deep clone the template for each item
      const clonedTemplate = JSON.parse(JSON.stringify(layerTemplate));

      // Inject collection data into each layer of the template (text, images, etc.)
      const injectedLayers = await Promise.all(
        clonedTemplate.map((layer: Layer) =>
          injectCollectionDataForHtml(layer, formattedValues, collectionFields, isPublished)
        )
      );

      // Resolve nested collection layers (sub-collections like "shades" inside "colors")
      // Pass item.values so nested collections can filter based on parent item's field values
      let resolvedLayers = await resolveCollectionLayers(
        injectedLayers,
        isPublished,
        item.values, // Parent item values for multi-reference filtering
        undefined, // No pagination context for Load More rendering
        undefined // TODO: Add translation support for Load More pagination
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
          if (fieldType && assetFieldTypes.includes(fieldType) && fieldId) {
            const assetId = item.values[fieldId];
            if (assetId && !assetMap[assetId]) {
              assetIds.push(assetId);
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

      // Convert layers to HTML (handles fragments from resolved collections)
      const itemHtml = resolvedLayers
        .map((layer) =>
          layerToHtml(layer, item.id, pages, folders, collectionItemSlugs, locale, translations, anchorMap, item.values, undefined, assetMap, undefined, undefined)
        )
        .join('');

      // Wrap in collection item container with the proper layer ID format
      const itemWrapperId = `${collectionLayerId}-item-${item.id}`;
      return `<div data-layer-id="${itemWrapperId}" data-collection-item-id="${item.id}">${itemHtml}</div>`;
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
  isPublished: boolean
): Promise<Layer> {
  // Resolve reference fields if we have field definitions
  let enhancedValues = itemValues;
  if (fields && fields.length > 0) {
    enhancedValues = await resolveReferenceFields(itemValues, fields, isPublished);
  }

  const updates: Partial<Layer> = {};

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

      const resolvedContent = resolveRichTextVariables(content, enhancedValues);
      updates.variables = {
        ...layer.variables,
        text: {
          type: 'dynamic_rich_text',
          data: { content: resolvedContent }
        }
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
      const resolved = resolveInlineVariables(textContent, mockItem);
      updates.variables = {
        ...layer.variables,
        text: {
          type: 'dynamic_text',
          data: { content: resolved }
        }
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
    updates.variables = {
      ...updates.variables,
      ...layer.variables,
      image: {
        src: createResolvedAssetVariable(imageSrc.data.field_id, resolvedValue, imageSrc),
        alt: layer.variables?.image?.alt || createDynamicTextVariable(''),
      },
    };
  }

  // Video src field binding (variables structure)
  const videoSrc = layer.variables?.video?.src;
  if (videoSrc && isFieldVariable(videoSrc) && videoSrc.data.field_id) {
    const resolvedValue = resolveFieldPath(videoSrc);
    updates.variables = {
      ...updates.variables,
      ...layer.variables,
      video: {
        ...layer.variables?.video,
        src: createResolvedAssetVariable(videoSrc.data.field_id, resolvedValue, videoSrc),
      },
    };
  }

  // Audio src field binding (variables structure)
  const audioSrc = layer.variables?.audio?.src;
  if (audioSrc && isFieldVariable(audioSrc) && audioSrc.data.field_id) {
    const resolvedValue = resolveFieldPath(audioSrc);
    updates.variables = {
      ...updates.variables,
      ...layer.variables,
      audio: {
        ...layer.variables?.audio,
        src: createResolvedAssetVariable(audioSrc.data.field_id, resolvedValue, audioSrc),
      },
    };
  }

  // Background image src field binding (variables structure)
  const bgImageSrc = layer.variables?.backgroundImage?.src;
  if (bgImageSrc && isFieldVariable(bgImageSrc) && bgImageSrc.data.field_id) {
    const resolvedValue = resolveFieldPath(bgImageSrc);
    updates.variables = {
      ...updates.variables,
      ...layer.variables,
      backgroundImage: {
        src: createResolvedAssetVariable(bgImageSrc.data.field_id, resolvedValue, bgImageSrc),
      },
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

  // Recursively process children
  if (layer.children) {
    const resolvedChildren = await Promise.all(
      layer.children.map(child =>
        injectCollectionDataForHtml(child, enhancedValues, fields, isPublished)
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
async function resolveAllAssets(
  layers: Layer[],
  isPublished: boolean = true,
  components?: Component[],
): Promise<{ layers: Layer[]; assetMap: Record<string, { public_url: string | null; content?: string | null }> }> {
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
  assetMap: Record<string, { public_url: string | null; content?: string | null }>,
): Layer {
  const variableUpdates: Partial<Layer['variables']> = {};

  const imageSrc = layer.variables?.image?.src;
  if (imageSrc && isAssetVariable(imageSrc)) {
    const assetId = getAssetId(imageSrc);
    if (assetId) {
      const asset = assetMap[assetId];
      let resolvedUrl = '';
      if (asset?.public_url) {
        resolvedUrl = asset.public_url;
      } else if (asset?.content) {
        resolvedUrl = `data:image/svg+xml,${encodeURIComponent(asset.content)}`;
      }
      variableUpdates.image = {
        src: createDynamicTextVariable(resolvedUrl),
        alt: layer.variables?.image?.alt || createDynamicTextVariable(''),
      };
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
        resolvedUrl = `data:image/svg+xml,${encodeURIComponent(asset.content)}`;
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

  const updates: Partial<Layer> = {};
  if (Object.keys(variableUpdates).length > 0) {
    updates.variables = { ...layer.variables, ...variableUpdates };
  }
  if (layer.children) {
    updates.children = layer.children.map(child => resolveLayerAssets(child, assetMap));
  }

  return Object.keys(updates).length > 0 ? { ...layer, ...updates } : layer;
}

/**
 * Build a map of layerId -> anchor value (attributes.id) for O(1) anchor resolution
 */
function buildAnchorMap(layers: Layer[]): Record<string, string> {
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
      ? content.content.map((node: any) => renderTiptapToHtml(node, textStyles, renderComponentHtml)).join('')
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
      ? content.content.map((node: any) => renderTiptapToHtml(node, textStyles, renderComponentHtml)).join('')
      : '\u00A0';
    // Use span to avoid nesting issues (h1 inside p is invalid)
    return `<span class="${escapeHtml(headingClass)}">${innerHtml}</span>`;
  }

  // Handle doc (root)
  if (content.type === 'doc' && Array.isArray(content.content)) {
    return content.content.map((node: any) => renderTiptapToHtml(node, textStyles, renderComponentHtml)).join('');
  }

  // Handle bullet list
  if (content.type === 'bulletList') {
    const listClass = textStyles?.bulletList?.classes || '';
    const classAttr = listClass ? ` class="${escapeHtml(listClass)}"` : '';
    const items = content.content
      ? content.content.map((item: any) => renderTiptapToHtml(item, textStyles, renderComponentHtml)).join('')
      : '';
    return `<ul${classAttr}>${items}</ul>`;
  }

  // Handle ordered list
  if (content.type === 'orderedList') {
    const listClass = textStyles?.orderedList?.classes || '';
    const classAttr = listClass ? ` class="${escapeHtml(listClass)}"` : '';
    const items = content.content
      ? content.content.map((item: any) => renderTiptapToHtml(item, textStyles, renderComponentHtml)).join('')
      : '';
    return `<ol${classAttr}>${items}</ol>`;
  }

  // Handle list item
  if (content.type === 'listItem') {
    const innerHtml = content.content
      ? content.content.map((node: any) => renderTiptapToHtml(node, textStyles, renderComponentHtml)).join('')
      : '';
    return `<li>${innerHtml}</li>`;
  }

  // Handle hardBreak
  if (content.type === 'hardBreak') {
    return '<br>';
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

  // Fallback: recursively process content
  if (Array.isArray(content.content)) {
    return content.content.map((node: any) => renderTiptapToHtml(node, textStyles, renderComponentHtml)).join('');
  }

  return '';
}

/**
 * Convert a Layer to HTML string
 * Handles common layer types and their attributes
 */
function layerToHtml(
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
  assetMap?: Record<string, { public_url: string | null; content?: string | null }>,
  layerDataMap?: Record<string, Record<string, string>>,
  components?: Component[],
  ancestorComponentIds?: Set<string>,
): string {
  // Handle fragment layers (created by resolveCollectionLayers for nested collections)
  // Fragments render their children directly without a wrapper element
  if (layer.name === '_fragment' && layer.children) {
    return layer.children
      .map((child) =>
        layerToHtml(child, collectionItemId, pages, folders, collectionItemSlugs, locale, translations, anchorMap, collectionItemData, pageCollectionItemData, assetMap, layerDataMap, components, ancestorComponentIds)
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
    if (imageSrc) {
      // Extract string value from variable (should be DynamicTextVariable after resolution)
      // AssetVariable should have been resolved to DynamicTextVariable in injectCollectionDataForHtml
      let srcValue: string | undefined = undefined;
      if (imageSrc.type === 'dynamic_text') {
        srcValue = imageSrc.data.content || undefined;
      } else if (imageSrc.type === 'asset') {
        // AssetVariable should have been resolved, but if not, skip (don't use asset_id as URL)
        srcValue = undefined;
      }
      // Only add src if we have a valid URL (not empty string)
      if (srcValue && srcValue.trim()) {
        const optimizedSrc = getOptimizedImageUrl(srcValue, 1920, 1920, 85);
        attrs.push(`src="${escapeHtml(optimizedSrc)}"`);

        // Generate srcset for responsive images
        const srcset = generateImageSrcset(srcValue);
        if (srcset) {
          attrs.push(`srcset="${escapeHtml(srcset)}"`);
          // Add sizes attribute for responsive images
          attrs.push(`sizes="${escapeHtml(getImageSizes())}"`);
        }
      }
    }
    // Add data-layer-type for images
    attrs.push('data-layer-type="image"');

    const imageAlt = layer.variables?.image?.alt;
    if (imageAlt && imageAlt.type === 'dynamic_text') {
      attrs.push(`alt="${escapeHtml(imageAlt.data.content)}"`);
    }
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
            layerToHtml(child, effectiveCollectionItemId, pages, folders, collectionItemSlugs, locale, translations, anchorMap, effectiveCollectionItemData, pageCollectionItemData, assetMap, effectiveLayerDataMap, components, ancestorComponentIds)
          )
          .join('')
        : '';
      return `<iframe${attrsStr}>${childrenHtml}</iframe>`;
    }
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

  // Handle links (variables structure)
  if (tag === 'a') {
    const linkSettings = layer.variables?.link;
    if (linkSettings) {
      let hrefValue = '';

      switch (linkSettings.type) {
        case 'url':
          if (linkSettings.url?.data?.content) {
            hrefValue = linkSettings.url.data.content;
          }
          break;
        case 'email':
          if (linkSettings.email?.data?.content) {
            hrefValue = `mailto:${linkSettings.email.data.content}`;
          }
          break;
        case 'phone':
          if (linkSettings.phone?.data?.content) {
            hrefValue = `tel:${linkSettings.phone.data.content}`;
          }
          break;
        case 'asset':
          // Asset URLs should be resolved elsewhere (resolveAllAssets)
          break;
        case 'page':
          // Resolve page URL using pages and folders
          if (linkSettings.page?.id && pages && folders) {
            const linkedPage = pages.find(p => p.id === linkSettings.page?.id);
            if (linkedPage) {
              // Check if this is a dynamic page with a specific collection item
              if (linkedPage.is_dynamic && linkSettings.page.collection_item_id && collectionItemSlugs) {
                let itemSlug: string | undefined;

                // Handle special "current" keywords - use the current collection item ID
                if (linkSettings.page.collection_item_id === 'current-page' ||
                    linkSettings.page.collection_item_id === 'current-collection') {
                  // Use the current collection item's slug (from effectiveCollectionItemId)
                  itemSlug = effectiveCollectionItemId ? collectionItemSlugs[effectiveCollectionItemId] : undefined;
                } else {
                  // Use the specific item slug
                  itemSlug = collectionItemSlugs[linkSettings.page.collection_item_id];
                }

                // Use localized URL if locale is active
                hrefValue = buildLocalizedDynamicPageUrl(linkedPage, folders, itemSlug || null, locale, translations);
              } else {
                // Static page or dynamic page without specific item
                hrefValue = buildLocalizedSlugPath(linkedPage, folders, 'page', locale, translations);
              }
            }
          }
          break;
        case 'field': {
          const fieldId = linkSettings.field?.data?.field_id;
          const collectionLayerId = linkSettings.field?.data?.collection_layer_id;
          // Use layer-specific data if collection_layer_id is specified
          let rawValue: string | undefined;
          if (collectionLayerId && effectiveLayerDataMap?.[collectionLayerId]) {
            rawValue = fieldId ? effectiveLayerDataMap[collectionLayerId][fieldId] : undefined;
          } else {
            rawValue = fieldId ? effectiveCollectionItemData?.[fieldId] : undefined;
          }
          if (fieldId && rawValue) {
            const fieldType = linkSettings.field?.data?.field_type;
            hrefValue = resolveFieldLinkValue({
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
              },
              assetMap,
            });
          }
          break;
        }
      }

      // Append anchor if present (anchor_layer_id references a layer's ID attribute)
      // Resolve layer ID to actual anchor value using pre-built map (O(1) lookup)
      if (linkSettings.anchor_layer_id) {
        const anchorValue = anchorMap?.[linkSettings.anchor_layer_id] || linkSettings.anchor_layer_id;
        if (hrefValue) {
          hrefValue = `${hrefValue}#${anchorValue}`;
        } else {
          hrefValue = `#${anchorValue}`;
        }
      }

      if (hrefValue) {
        attrs.push(`href="${escapeHtml(hrefValue)}"`);
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
      // Skip type attribute for buttons converted to <a>
      if (isButtonWithLink && key === 'type') continue;
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

  // For buttons rendered as <a>, resolve link href and add attributes directly
  if (isButtonWithLink && buttonLinkSettings) {
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
    attrs.push('role="button"');
  }

  // For slider layers, strip inactive pagination/navigation children from the tree
  const effectiveChildren = (layer.name === 'slider' && layer.children)
    ? filterDisabledSliderLayers(layer.children, layer.settings)
    : layer.children;

  // Render children
  const childrenHtml = effectiveChildren
    ? effectiveChildren
      .map((child) =>
        layerToHtml(child, effectiveCollectionItemId, pages, folders, collectionItemSlugs, locale, translations, anchorMap, effectiveCollectionItemData, pageCollectionItemData, assetMap, effectiveLayerDataMap, components, ancestorComponentIds)
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
          if (!comp?.layers?.length) return '';
          const childAncestors = new Set(ancestorComponentIds);
          childAncestors.add(componentId);
          // Use pre-resolved layers (with collections) when available from resolveRichTextCollections
          const resolved = preResolvedLayers
            ?? resolveComponents(
              applyComponentOverrides(comp.layers, overrides, comp.variables),
              components, comp.variables, overrides,
            );
          const withAssets = assetMap
            ? resolved.map(l => resolveLayerAssets(l, assetMap))
            : resolved;
          return withAssets
            .map(l => layerToHtml(l, effectiveCollectionItemId, pages, folders, collectionItemSlugs, locale, translations, anchorMap, effectiveCollectionItemData, pageCollectionItemData, assetMap, effectiveLayerDataMap, components, childAncestors))
            .join('');
        }
        : undefined;
      textContent = renderTiptapToHtml(textVariable.data.content, layer.textStyles, componentRenderer);
      isRichText = true;
    }
  }

  // Handle self-closing tags
  const selfClosingTags = ['img', 'br', 'hr', 'input', 'meta', 'link'];
  if (selfClosingTags.includes(tag)) {
    let selfClosingHtml = `<${tag} ${attrs.join(' ')} />`;

    // Wrap with link if layer has link settings
    const linkSettings = layer.variables?.link;
    if (linkSettings && linkSettings.type) {
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
              linkHref = buildLocalizedSlugPath(linkedPage, folders, 'page', locale, translations);
            }
          }
          break;
        case 'field': {
          const fieldId = linkSettings.field?.data?.field_id;
          const collectionLayerId = linkSettings.field?.data?.collection_layer_id;
          // Use layer-specific data if collection_layer_id is specified
          let rawValue: string | undefined;
          if (collectionLayerId && effectiveLayerDataMap?.[collectionLayerId]) {
            rawValue = fieldId ? effectiveLayerDataMap[collectionLayerId][fieldId] : undefined;
          } else {
            rawValue = fieldId ? effectiveCollectionItemData?.[fieldId] : undefined;
          }
          if (fieldId && rawValue) {
            const fieldType = linkSettings.field?.data?.field_type;
            linkHref = resolveFieldLinkValue({
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
              },
              assetMap,
            });
          }
          break;
        }
      }

      // Append anchor if present
      if (linkSettings.anchor_layer_id) {
        const anchorValue = anchorMap?.[linkSettings.anchor_layer_id] || linkSettings.anchor_layer_id;
        if (linkHref) {
          linkHref = `${linkHref}#${anchorValue}`;
        } else {
          linkHref = `#${anchorValue}`;
        }
      }

      // Wrap in <a> tag if we have a valid href
      if (linkHref) {
        const linkAttrs: string[] = [`href="${escapeHtml(linkHref)}"`];
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

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
