import AnimationInitializer from '@/components/AnimationInitializer';
import BodyClassApplier from '@/components/BodyClassApplier';
import ContentHeightReporter from '@/components/ContentHeightReporter';
import CustomCodeInjector from '@/components/CustomCodeInjector';
import HreflangAlternateLinks from '@/components/HreflangAlternateLinks';
import LayerRendererPublic from '@/components/LayerRendererPublic';
import SliderInitializer from '@/components/SliderInitializer';
import LightboxInitializer from '@/components/LightboxInitializer';
import PasswordForm from '@/components/PasswordForm';
import YcodeBadge from '@/components/YcodeBadge';
import { unstable_cache } from 'next/cache';
import { resolveCustomCodePlaceholders } from '@/lib/resolve-cms-variables';
import { renderRootLayoutHeadCode } from '@/lib/parse-head-html';
import { generateInitialAnimationCSS, type HiddenLayerInfo } from '@/lib/animation-utils';
import { buildCustomFontsCss, buildFontClassesCss, fetchGoogleFontsCss, getCustomFontPreloads, getGoogleFontLinks } from '@/lib/font-utils';
import type { FontPreload } from '@/lib/font-utils';
import { buildImageSizes, collectLayerAssetIds, findLcpCandidate, generateImageSrcset, getAssetProxyUrl, getOptimizedImageUrl } from '@/lib/asset-utils';
import { getAllPages } from '@/lib/repositories/pageRepository';
import { getAllPageFolders } from '@/lib/repositories/pageFolderRepository';
import { getMapboxAccessToken, getGoogleMapsEmbedApiKey } from '@/lib/map-server';
import { getAllColorVariables } from '@/lib/repositories/colorVariableRepository';
import { getAllGlobalVariables } from '@/lib/repositories/globalVariableRepository';
import { getSettingByKey } from '@/lib/repositories/settingsRepository';
import { getItemsWithValues, getItemsWithValuesByIds } from '@/lib/repositories/collectionItemRepository';
import { getValuesByItemIds } from '@/lib/repositories/collectionItemValueRepository';
import { getFieldsByCollectionId } from '@/lib/repositories/collectionFieldRepository';
import { REF_PAGE_PREFIX, REF_COLLECTION_PREFIX, isCollectionItemKeyword, parseCollectionLinkValue } from '@/lib/link-utils';
import { getClassesString, hasPasswordFormLayer } from '@/lib/layer-utils';
import { buildGlobalsMetaMap, buildGlobalsValueMap } from '@/lib/collection-field-utils';
import { buildLocalizedPageUrls, type LocalizedDynamicSlug } from '@/lib/page-utils';
import { getTranslatableKey, slimTranslations } from '@/lib/locale-runtime';
import { getSlugTranslationsByLocale } from '@/lib/repositories/translationRepository';
import { buildPageHreflangAlternatesForPage } from '@/lib/generate-page-metadata';
import { getSiteBaseUrl } from '@/lib/url-utils';
import type { HreflangAlternate } from '@/lib/hreflang-utils';
import type { Layer, BackgroundsDesign, Component, Page, CollectionItemWithValues, CollectionField, Locale, PageFolder, PasswordProtectionContext, Translation } from '@/types';

interface PageLinkRef { collection_item_id: string; page_id: string }

const getCachedPublishedPages = unstable_cache(
  async () => getAllPages({ is_published: true }),
  ['page-renderer-published-pages'],
  { tags: ['all-pages'], revalidate: false }
);

const getCachedPublishedFolders = unstable_cache(
  async () => getAllPageFolders({ is_published: true }),
  ['page-renderer-published-folders'],
  { tags: ['all-pages'], revalidate: false }
);

/** Recursively collect all page link refs ({collection_item_id, page_id}) from a Tiptap JSON node.
 * Also descends into pre-resolved layers stored on embedded richTextComponent nodes. */
function collectTiptapPageLinks(node: any): PageLinkRef[] {
  if (!node || typeof node !== 'object') return [];
  const results: PageLinkRef[] = [];
  if (node.marks && Array.isArray(node.marks)) {
    for (const mark of node.marks) {
      if (mark.type === 'richTextLink' && mark.attrs?.type === 'page'
        && mark.attrs.page?.collection_item_id && mark.attrs.page?.id) {
        results.push({ collection_item_id: mark.attrs.page.collection_item_id, page_id: mark.attrs.page.id });
      }
    }
  }
  // Pre-resolved layers from rich-text-embedded components (set by resolveTiptapComponentCollections)
  if (node.type === 'richTextComponent' && Array.isArray(node.attrs?._resolvedLayers)) {
    results.push(...collectLayerPageLinks(node.attrs._resolvedLayers as Layer[]));
  }
  if (node.content && Array.isArray(node.content)) {
    for (const child of node.content) results.push(...collectTiptapPageLinks(child));
  }
  return results;
}

/**
 * Walk a layer tree and return every page link ref from both layer-level links
 * and richTextLink marks inside rich text variables.
 */
function collectLayerPageLinks(layers: Layer[]): PageLinkRef[] {
  const results: PageLinkRef[] = [];
  const scan = (layer: Layer) => {
    if (layer.variables?.link?.type === 'page') {
      const { collection_item_id, id: page_id } = layer.variables.link.page ?? {};
      if (collection_item_id && page_id) results.push({ collection_item_id, page_id });
    }
    // Field-bound links: extract page refs from pre-resolved link values
    if (layer.variables?.link?.type === 'field') {
      const resolvedValue = layer.variables.link.field?.data?._resolvedValue;
      if (resolvedValue) {
        const linkValue = parseCollectionLinkValue(resolvedValue);
        if (linkValue?.type === 'page' && linkValue.page?.collection_item_id && linkValue.page?.id) {
          results.push({ collection_item_id: linkValue.page.collection_item_id, page_id: linkValue.page.id });
        }
      }
    }
    // Form redirect_url: extract page refs so the target item slug is pre-fetched
    const redirectUrl = layer.settings?.form?.redirect_url;
    if (redirectUrl?.type === 'page') {
      const { collection_item_id, id: page_id } = redirectUrl.page ?? {};
      if (collection_item_id && page_id) results.push({ collection_item_id, page_id });
    }
    const textVar = layer.variables?.text as any;
    if (textVar?.type === 'dynamic_rich_text' && textVar.data?.content) {
      results.push(...collectTiptapPageLinks(textVar.data.content));
    }
    if (layer.children) layer.children.forEach(scan);
  };
  layers.forEach(scan);
  return results;
}

/** Recursively scan a Tiptap JSON node for richTextComponent nodes and harvest
 * slugs from their pre-resolved layers (populated by resolveTiptapComponentCollections). */
function extractTiptapCollectionItemSlugs(node: any, slugs: Record<string, string>): void {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'richTextComponent' && Array.isArray(node.attrs?._resolvedLayers)) {
    const nested = extractCollectionItemSlugs(node.attrs._resolvedLayers as Layer[]);
    Object.assign(slugs, nested);
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) extractTiptapCollectionItemSlugs(child, slugs);
  }
}

/**
 * Extract collection item slugs from resolved collection layers.
 * These are populated by resolveCollectionLayers with `_collectionItemId` / `_collectionItemSlug`.
 * Also descends into pre-resolved layers of rich-text-embedded components so links inside
 * those components (e.g. "current-collection") can be resolved at render time.
 */
function extractCollectionItemSlugs(layers: Layer[]): Record<string, string> {
  const slugs: Record<string, string> = {};
  const scan = (layer: Layer) => {
    if (layer._collectionItemId && layer._collectionItemSlug) {
      slugs[layer._collectionItemId] = layer._collectionItemSlug;
    }
    const textVar = layer.variables?.text as any;
    if (textVar?.type === 'dynamic_rich_text' && textVar.data?.content) {
      extractTiptapCollectionItemSlugs(textVar.data.content, slugs);
    }
    if (layer.children) layer.children.forEach(scan);
  };
  layers.forEach(scan);
  return slugs;
}

/**
 * The public renderer styles layers from their compiled `classes`; the structured
 * `design` object is builder-only metadata used to regenerate those classes in the
 * editor. The only part read at render time is `design.backgrounds.bgImageVars` /
 * `bgGradientVars`, which are applied as inline CSS custom properties (see
 * LayerRendererPublic and lib/page-fetcher). Everything else — including
 * `backgroundColor` / `backgroundClip` (already baked into `classes`) — is dropped.
 * On a content-heavy page the full design tree can be ~30% of the serialized RSC
 * Flight payload.
 */
function stripDesignForClient(design: Layer['design']): Layer['design'] | undefined {
  const backgrounds = design?.backgrounds;
  if (!backgrounds) return undefined;
  const slim: BackgroundsDesign = {};
  if (backgrounds.bgImageVars) slim.bgImageVars = backgrounds.bgImageVars;
  if (backgrounds.bgGradientVars) slim.bgGradientVars = backgrounds.bgGradientVars;
  if (!slim.bgImageVars && !slim.bgGradientVars) return undefined;
  return { backgrounds: slim };
}

/**
 * Rich-text inline styles (`textStyles`) are applied at render time via their
 * compiled `classes` (see getTextStyleClasses). The accompanying `design`,
 * `styleOverrides`, `styleId`, and `label` are builder-only, so keep just `classes`.
 *
 * We must preserve an entry whenever its `classes` is a string — even an empty one.
 * `getTextStyleClasses` does `textStyles?.[key]?.classes ?? DEFAULT_TEXT_STYLES[...]`,
 * so an explicit `classes: ''` suppresses the default, whereas an absent entry falls
 * back to it. Dropping empty-string entries would silently re-introduce default
 * styling. Entries with no `classes` string already resolve to the default, so
 * omitting them is equivalent to keeping them.
 */
function stripTextStylesForClient(textStyles: Layer['textStyles']): Layer['textStyles'] | undefined {
  if (!textStyles) return undefined;
  const slim: NonNullable<Layer['textStyles']> = {};
  let kept = false;
  for (const [key, style] of Object.entries(textStyles)) {
    if (typeof style?.classes === 'string') {
      slim[key] = { classes: style.classes };
      kept = true;
    }
  }
  return kept ? slim : undefined;
}

/**
 * Strip heavy SSR-only data from the layer tree before passing to client
 * components. After resolveCollectionLayers, all variables are pre-resolved
 * into the layers — _collectionItemValues and _layerDataMap are redundant
 * and can be enormous (e.g. 50 articles × full rich text bodies). All builder-only
 * style metadata (`design`, `styleIds`, `styleId`, `styleOverrides`,
 * `styleOverridesByStyle`, and per-`textStyles` design) is likewise dropped — the
 * published `classes` strings are already fully resolved, so the client never needs
 * to re-resolve them (see stripDesignForClient / stripTextStylesForClient).
 *
 * The RSC Flight payload serializes everything passed to 'use client'
 * components, so stripping here avoids doubling the response size.
 */
function stripSSROnlyData(layers: Layer[]): Layer[] {
  return layers.map(layer => {
    const stripped: Layer = { ...layer };

    delete stripped._collectionItemValues;
    delete stripped._collectionItemSlug;
    delete stripped._layerDataMap;

    // Builder-only style resolution inputs. The flat `classes` string is the
    // already-resolved output, so the public renderer never reads these.
    delete stripped.styleIds;
    delete stripped.styleId;
    delete stripped.styleOverrides;
    delete stripped.styleOverridesByStyle;

    const slimDesign = stripDesignForClient(stripped.design);
    if (slimDesign) {
      stripped.design = slimDesign;
    } else {
      delete stripped.design;
    }

    const slimTextStyles = stripTextStylesForClient(stripped.textStyles);
    if (slimTextStyles) {
      stripped.textStyles = slimTextStyles;
    } else {
      delete stripped.textStyles;
    }

    if (stripped._filterConfig?.layerTemplate) {
      stripped._filterConfig = {
        ...stripped._filterConfig,
        layerTemplate: stripSSROnlyData(stripped._filterConfig.layerTemplate),
      };
    }

    if (stripped._paginationMeta?.layerTemplate) {
      stripped._paginationMeta = {
        ...stripped._paginationMeta,
        layerTemplate: stripSSROnlyData(stripped._paginationMeta.layerTemplate),
      };
    }

    if (stripped.children) {
      stripped.children = stripSSROnlyData(stripped.children);
    }

    return stripped;
  });
}

/** Extract minimal animation data from the layer tree for AnimationInitializer */
function extractAnimationLayers(layers: Layer[]): Layer[] {
  return layers
    .filter(layer => layer.interactions?.length || layer.children?.length)
    .map(layer => ({
      id: layer.id,
      name: layer.name,
      classes: '',
      interactions: layer.interactions,
      children: layer.children ? extractAnimationLayers(layer.children) : undefined,
    }));
}

/** Scan a Tiptap JSON node for richTextComponent nodes and test their pre-resolved
 * layers (populated by resolveTiptapComponentCollections) against the predicate. */
function tiptapTreeHasLayer(node: any, predicate: (layer: Layer) => boolean): boolean {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'richTextComponent' && Array.isArray(node.attrs?._resolvedLayers)
    && layerTreeHasLayer(node.attrs._resolvedLayers as Layer[], predicate)) {
    return true;
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      if (tiptapTreeHasLayer(child, predicate)) return true;
    }
  }
  return false;
}

/** Recursively check if any layer matches the predicate, descending into both
 * children and the pre-resolved layers of rich-text-embedded components. */
function layerTreeHasLayer(layers: Layer[], predicate: (layer: Layer) => boolean): boolean {
  for (const layer of layers) {
    if (predicate(layer)) return true;
    const textVar = layer.variables?.text as any;
    if (textVar?.type === 'dynamic_rich_text' && textVar.data?.content
      && tiptapTreeHasLayer(textVar.data.content, predicate)) {
      return true;
    }
    if (layer.children && layerTreeHasLayer(layer.children, predicate)) return true;
  }
  return false;
}

/** Check if any layer in the tree (including rich-text-embedded components) is a slider */
function hasSliderLayers(layers: Layer[]): boolean {
  return layerTreeHasLayer(layers, layer => layer.name === 'slider');
}

/** Check if any layer in the tree (including rich-text-embedded components) is a lightbox */
function hasLightboxLayers(layers: Layer[]): boolean {
  return layerTreeHasLayer(layers, layer => layer.name === 'lightbox');
}

/**
 * Recursively check if any layer in the tree has interactions configured.
 * Used to skip rendering AnimationInitializer (and shipping ~50KB of GSAP +
 * ScrollTrigger + SplitText to the client) for pages with no animations.
 */
function hasAnyInteractions(layers: Layer[]): boolean {
  for (const layer of layers) {
    if (layer.interactions?.length) return true;
    if (layer.children && hasAnyInteractions(layer.children)) return true;
  }
  return false;
}

interface PageRendererProps {
  page: Page;
  layers: Layer[];
  components: Component[];
  generatedCss?: string;
  colorVariablesCss?: string;
  collectionItem?: CollectionItemWithValues;
  collectionFields?: CollectionField[];
  /**
   * Ordered list of collection item ids on the dynamic page's collection.
   * Used to resolve `next-item` / `previous-item` link keywords. Only relevant
   * for dynamic pages.
   */
  pageCollectionSortedItemIds?: string[];
  /**
   * Map of `collection_item_id -> slug` for every item in
   * `pageCollectionSortedItemIds`. Merged into the slug lookup so next/previous
   * links resolve to a real URL.
   */
  pageCollectionSortedItemSlugs?: Record<string, string>;
  locale?: Locale | null;
  availableLocales?: Locale[];
  isPreview?: boolean;
  translations?: Record<string, any> | null;
  gaMeasurementId?: string | null;
  globalCustomCodeHead?: string | null;
  globalCustomCodeBody?: string | null;
  ycodeBadge?: boolean;
  passwordProtection?: PasswordProtectionContext;
}

/**
 * Shared component for rendering published/preview pages
 * Handles layer resolution, CSS injection, and custom code injection
 *
 * Note: This is a Server Component. Script/style tags are automatically
 * hoisted to <head> by Next.js during SSR, eliminating FOUC.
 */
/** Extract body layer from the tree and return its classes + children to render */
function extractBodyLayer(layers: Layer[]): { bodyClasses: string; childLayers: Layer[] } {
  const bodyLayer = layers.find(l => l.id === 'body');
  if (!bodyLayer) {
    return { bodyClasses: '', childLayers: layers };
  }

  const otherLayers = layers.filter(l => l.id !== 'body');
  return {
    bodyClasses: getClassesString(bodyLayer),
    childLayers: [...(bodyLayer.children || []), ...otherLayers],
  };
}

export default async function PageRenderer({
  page,
  layers,
  components,
  generatedCss,
  colorVariablesCss,
  collectionItem,
  collectionFields = [],
  pageCollectionSortedItemIds,
  pageCollectionSortedItemSlugs,
  locale,
  availableLocales = [],
  isPreview = false,
  translations,
  gaMeasurementId,
  globalCustomCodeHead,
  globalCustomCodeBody,
  ycodeBadge = true,
  passwordProtection,
}: PageRendererProps) {
  const usePublishedData = page.is_published && !isPreview;
  // Check if this is a 401 error page that needs password form
  const is401Page = page.error_page === 401;
  // Layers are always pre-resolved by the caller (page-fetcher).
  // Components are passed through for rich-text embedded component rendering in LayerRenderer.
  const resolvedLayers = layers || [];
  // When the 401 page contains an editable password-protected form layer, the form
  // is rendered & wired inline by LayerRendererPublic; otherwise we fall back to
  // the hardcoded PasswordForm so older / customised 401 pages still work.
  const hasInlinePasswordForm = is401Page && hasPasswordFormLayer(resolvedLayers);

  // Single tree traversal — derive both sets from the flat list
  const allPageLinks = collectLayerPageLinks(resolvedLayers);
  const referencedItemIds = new Set(
    allPageLinks
      .filter(l => !isCollectionItemKeyword(l.collection_item_id) && !l.collection_item_id.startsWith('ref-'))
      .map(l => l.collection_item_id)
  );

  // Build collection item slugs map
  const collectionItemSlugs: Record<string, string> = {};

  // Add slugs from resolved collection layers (for 'current-collection' links)
  const resolvedSlugs = extractCollectionItemSlugs(resolvedLayers);
  Object.assign(collectionItemSlugs, resolvedSlugs);

  // Add current page's collection item if available
  if (collectionItem && collectionFields) {
    const slugField = collectionFields.find(f => f.key === 'slug');
    if (slugField && collectionItem.values[slugField.id]) {
      collectionItemSlugs[collectionItem.id] = collectionItem.values[slugField.id];
    }
  }

  // Merge slugs for the dynamic page's collection (next/previous navigation).
  if (pageCollectionSortedItemSlugs) {
    Object.assign(collectionItemSlugs, pageCollectionSortedItemSlugs);
  }

  let pages: Page[] = [];
  let folders: PageFolder[] = [];

  try {
    // Start pages/folders fetch and referenced-item fetch in parallel
    const itemsMapPromise = referencedItemIds.size > 0
      ? getItemsWithValuesByIds(Array.from(referencedItemIds), usePublishedData)
      : Promise.resolve({} as Record<string, import('@/types').CollectionItemWithValues>);

    [[pages, folders]] = await Promise.all([
      usePublishedData
        ? Promise.all([getCachedPublishedPages(), getCachedPublishedFolders()])
        : Promise.all([
          getAllPages({ is_published: false }),
          getAllPageFolders({ is_published: false }),
        ]),
      itemsMapPromise.then(async (itemsMap) => {
        const collectionIds = new Set(Object.values(itemsMap).map(i => i.collection_id));
        const fieldsByCollection = new Map<string, CollectionField[]>();
        await Promise.all(
          Array.from(collectionIds).map(async (collId) => {
            const fields = await getFieldsByCollectionId(collId, usePublishedData);
            fieldsByCollection.set(collId, fields);
          })
        );

        for (const item of Object.values(itemsMap)) {
          const fields = fieldsByCollection.get(item.collection_id);
          const slugField = fields?.find(f => f.key === 'slug');
          if (slugField && item.values[slugField.id]) {
            collectionItemSlugs[item.id] = item.values[slugField.id];
          }
        }
      }),
    ]);

    // ref-* links depend on `pages` being resolved, so this runs after
    const refTargetCollectionIds = new Set(
      allPageLinks
        .filter(l => l.collection_item_id.startsWith(REF_PAGE_PREFIX) || l.collection_item_id.startsWith(REF_COLLECTION_PREFIX))
        .map(l => pages.find(p => p.id === l.page_id)?.settings?.cms?.collection_id)
        .filter((id): id is string => !!id)
    );
    if (refTargetCollectionIds.size > 0) {
      await Promise.all(
        Array.from(refTargetCollectionIds).map(async (collId) => {
          const [fields, { items }] = await Promise.all([
            getFieldsByCollectionId(collId, usePublishedData),
            getItemsWithValues(collId, usePublishedData),
          ]);
          const slugField = fields.find(f => f.key === 'slug');
          if (!slugField) return;
          for (const item of items) {
            if (item.values[slugField.id]) {
              collectionItemSlugs[item.id] = item.values[slugField.id];
            }
          }
        })
      );
    }
  } catch (error) {
    console.error('[PageRenderer] Error fetching link resolution data:', error);
  }

  // Referenced/ref item slugs above are stored in the source language. On a
  // non-default locale, swap each to its translated slug so dynamic-page links
  // resolve to the localized URL (e.g. /fr/.../a-fr instead of /fr/.../a-en).
  if (translations && locale && !locale.is_default) {
    for (const itemId of Object.keys(collectionItemSlugs)) {
      const translatedSlug = translations[`cms:${itemId}:field:key:slug`]?.content_value;
      if (translatedSlug) {
        collectionItemSlugs[itemId] = translatedSlug;
      }
    }
  }

  // Pre-compute localized URLs for the locale selector so switching language
  // preserves translated folder/page/CMS slugs instead of reusing the source slug.
  // Only runs on multi-locale pages that actually render a locale selector.
  let localizedPageUrls: Record<string, string> | undefined;
  if (
    availableLocales.length > 1 &&
    layerTreeHasLayer(resolvedLayers, l => l.name === 'localeSelector')
  ) {
    try {
      const translationsByLocale: Record<string, Record<string, Translation>> = {};
      await Promise.all(
        availableLocales
          .filter(l => !l.is_default)
          .map(async (l) => {
            // Reuse already-loaded translations for the current locale
            if (locale && l.id === locale.id && translations) {
              translationsByLocale[l.id] = translations as Record<string, Translation>;
              return;
            }
            // Only slug rows are needed to build localized URLs for the locale
            // switcher — avoid loading the full CMS-content catalogue per locale.
            const rows = await getSlugTranslationsByLocale(l.id, usePublishedData);
            const map: Record<string, Translation> = {};
            for (const t of rows) {
              map[getTranslatableKey(t)] = t;
            }
            translationsByLocale[l.id] = map;
          })
      );

      // Dynamic pages need the translated CMS item slug per locale
      let dynamicSlug: LocalizedDynamicSlug | null = null;
      if (page.is_dynamic && collectionItem) {
        const slugField = collectionFields.find(f => f.key === 'slug');
        if (slugField) {
          // collectionItem.values are already translated for the current locale,
          // so fetch the raw (default-locale) slug to use as the default + fallback.
          const rawValues = await getValuesByItemIds([collectionItem.id], usePublishedData, undefined, [slugField.id]);
          const sourceSlug = rawValues[collectionItem.id]?.[slugField.id];
          if (sourceSlug) {
            dynamicSlug = {
              itemId: collectionItem.id,
              contentKey: slugField.key ? `field:key:${slugField.key}` : `field:id:${slugField.id}`,
              defaultValue: String(sourceSlug),
            };
          }
        }
      }

      localizedPageUrls = buildLocalizedPageUrls(page, folders, availableLocales, translationsByLocale, dynamicSlug);
    } catch (error) {
      console.error('[PageRenderer] Error building localized page URLs:', error);
    }
  }

  // Extract custom code from page settings and resolve placeholders for dynamic pages.
  // Page head code is injected into <head> by the site layout on self-hosted;
  // only resolve it here in cloud mode where the layout cannot read the URL.
  const shouldInjectPageHead = process.env.SKIP_SETUP === 'true';
  const rawPageCustomCodeHead = shouldInjectPageHead
    ? (page.settings?.custom_code?.head || '')
    : '';
  const rawPageCustomCodeBody = page.settings?.custom_code?.body || '';

  const pageCustomCodeHead = shouldInjectPageHead && page.is_dynamic && collectionItem
    ? await resolveCustomCodePlaceholders(rawPageCustomCodeHead, collectionItem, collectionFields, usePublishedData)
    : rawPageCustomCodeHead;

  const pageCustomCodeBody = page.is_dynamic && collectionItem
    ? await resolveCustomCodePlaceholders(rawPageCustomCodeBody, collectionItem, collectionFields, usePublishedData)
    : rawPageCustomCodeBody;

  const { bodyClasses, childLayers: rawChildLayers } = extractBodyLayer(resolvedLayers);
  const hasLayers = rawChildLayers.length > 0;

  // Language for <html lang> and the content wrapper. Falls back to the site's
  // default locale so the document always advertises a language for a11y/SEO.
  const resolvedLang = locale?.code || availableLocales.find((l) => l.is_default)?.code || undefined;

  // Generate CSS for initial animation states to prevent flickering
  const { css: initialAnimationCSS, hiddenLayerInfo } = generateInitialAnimationCSS(resolvedLayers);

  // Strip heavy SSR-only data before crossing the client component boundary.
  // On published pages, all variables are pre-resolved so _collectionItemValues
  // and _layerDataMap are redundant — removing them can cut the payload by 10x+.
  const childLayers = usePublishedData ? stripSSROnlyData(rawChildLayers) : rawChildLayers;
  const animationLayers = usePublishedData ? extractAnimationLayers(resolvedLayers) : resolvedLayers;

  // Load installed fonts and generate CSS + link URLs
  let fontsCss = '';
  let googleFontsInlinedCss = '';
  let googleFontLinkUrls: string[] = [];
  let fontPreloads: FontPreload[] = [];
  try {
    const { getAllFonts: getAllDraftFonts } = await import('@/lib/repositories/fontRepository');
    const { getPublishedFonts } = await import('@/lib/repositories/fontRepository');
    const fonts = isPreview ? await getAllDraftFonts() : await getPublishedFonts();
    fontsCss = buildCustomFontsCss(fonts) + buildFontClassesCss(fonts);
    googleFontLinkUrls = getGoogleFontLinks(fonts);
    fontPreloads = getCustomFontPreloads(fonts);

    // Inline the resolved @font-face CSS so the browser skips the blocking
    // round-trip to fonts.googleapis.com and goes straight to gstatic for
    // the woff2 binaries. Cached per font config across requests.
    if (googleFontLinkUrls.length > 0) {
      googleFontsInlinedCss = await unstable_cache(
        async () => fetchGoogleFontsCss(googleFontLinkUrls),
        [`google-fonts-css-${googleFontLinkUrls.join('|')}`],
        { tags: ['all-pages'], revalidate: false },
      )();
    }
  } catch (error) {
    console.error('[PageRenderer] Error loading fonts:', error);
  }

  // Fetch server-side settings needed by LayerRenderer (map tokens, color variables, timezone)
  // Globals follow the page's draft/published mode so previews see draft values.
  const [mapboxToken, googleMapsEmbedKey, serverColorVariables, timezoneSetting, globalVariables] = await Promise.all([
    getMapboxAccessToken(),
    getGoogleMapsEmbedApiKey(),
    getAllColorVariables(),
    getSettingByKey('timezone').catch(() => null),
    getAllGlobalVariables(usePublishedData).catch(() => []),
  ]);
  // Flat id -> value map merged into resolution at render time.
  const globalsData = buildGlobalsValueMap(globalVariables);
  // Flat id -> metadata map used to resolve global type/name at render time.
  const globalsMeta = buildGlobalsMetaMap(globalVariables);
  const serverSettings: Record<string, unknown> = {};
  if (mapboxToken) {
    serverSettings.mapbox_access_token = mapboxToken;
  }
  if (googleMapsEmbedKey) {
    serverSettings.google_maps_embed_api_key = googleMapsEmbedKey;
  }
  if (serverColorVariables.length > 0) {
    serverSettings.color_variables = serverColorVariables;
  }
  if (typeof timezoneSetting === 'string' && timezoneSetting) {
    serverSettings.timezone = timezoneSetting;
  }

  // Pre-resolve all asset URLs for SSR (images, videos, audio, icons, and field values)
  const layerAssetIds = collectLayerAssetIds(resolvedLayers, components);

  // Also collect from page collection item values (for dynamic pages)
  if (collectionItem) {
    for (const value of Object.values(collectionItem.values)) {
      if (typeof value === 'string') {
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
          layerAssetIds.add(value);
        } else if (value.startsWith('{')) {
          const linkValue = parseCollectionLinkValue(value);
          if (linkValue?.type === 'asset' && linkValue.asset?.id) {
            layerAssetIds.add(linkValue.asset.id);
          }
        }
      }
    }
  }

  // Image-typed globals store an asset id as their value — pre-resolve those
  // assets so global-bound images render on published pages (no client store).
  for (const global of globalVariables) {
    if (global.type === 'image' && global.value) {
      layerAssetIds.add(global.value);
    }
  }

  // Fetch all assets and build resolved map
  // Use draft assets (isPublished=false) for preview mode, published assets otherwise
  // `mimeType` is tracked locally so the LCP heuristic can skip SVG logos;
  // it is stripped before passing the map across the client boundary.
  type ResolvedAssetEntry = { url: string; width?: number | null; height?: number | null; mimeType?: string };
  let resolvedAssetsWithMime: Record<string, ResolvedAssetEntry> | undefined;
  if (layerAssetIds.size > 0) {
    try {
      const { getAssetsByIds } = await import('@/lib/repositories/assetRepository');
      const assetMap = await getAssetsByIds(Array.from(layerAssetIds), !isPreview);
      resolvedAssetsWithMime = {};
      for (const [id, asset] of Object.entries(assetMap)) {
        let url: string | undefined;
        const proxyUrl = getAssetProxyUrl(asset);
        if (proxyUrl) {
          url = proxyUrl;
        } else if (asset.public_url) {
          url = asset.public_url;
        } else if (asset.content) {
          url = asset.content;
        }
        if (url) {
          resolvedAssetsWithMime[id] = { url, width: asset.width, height: asset.height, mimeType: asset.mime_type };
        }
      }
    } catch (error) {
      console.error('[PageRenderer] Error fetching assets:', error);
    }
  }

  // Identify the LCP candidate so the renderer can flip its loading=lazy
  // template default to eager + fetchpriority=high. Skips logos/icons by
  // ignoring images inside header/footer/nav and SVG-backed assets.
  const lcpCandidate = findLcpCandidate(childLayers, resolvedAssetsWithMime);
  const lcpCandidateLayerId = lcpCandidate?.layerId ?? null;

  // Resolve the candidate's URL so we can emit <link rel="preload" as="image">
  // in <head>. The browser starts fetching the hero image as soon as it parses
  // the preload — well before it reaches the <img> tag deeper in the document.
  // Only handles asset-variable images; CMS field-bound images on dynamic
  // pages would need item-aware resolution.
  let lcpPreloadSrc: string | null = null;
  let lcpPreloadSrcset: string | null = null;
  let lcpPreloadSizes: string | null = null;
  if (lcpCandidate?.assetId && resolvedAssetsWithMime) {
    const candidateAsset = resolvedAssetsWithMime[lcpCandidate.assetId];
    if (candidateAsset?.url) {
      lcpPreloadSrc = getOptimizedImageUrl(candidateAsset.url, 1920, 85);
      lcpPreloadSrcset = generateImageSrcset(candidateAsset.url, undefined, undefined, candidateAsset.width) || null;
      lcpPreloadSizes = buildImageSizes(candidateAsset.width || null);
    }
  }

  // Strip mimeType before crossing the client component boundary — only
  // url/width/height are part of the shared `resolvedAssets` contract.
  const resolvedAssets: Record<string, { url: string; width?: number | null; height?: number | null }> | undefined =
    resolvedAssetsWithMime
      ? Object.fromEntries(
        Object.entries(resolvedAssetsWithMime).map(([id, { url, width, height }]) => [id, { url, width, height }])
      )
      : undefined;

  // Build hreflang alternates for multilingual sites. Rendered as lowercase
  // <link rel="alternate" hreflang> tags below (not via Next metadata, which
  // emits camelCase hrefLang). Skipped for previews, error pages, and noindex
  // pages, mirroring the sitemap's language cluster.
  let hreflangAlternates: HreflangAlternate[] = [];
  if (!isPreview && availableLocales.length > 1 && page.error_page === null && !page.settings?.seo?.noindex) {
    try {
      const globalCanonicalUrl = await getSettingByKey('global_canonical_url').catch(() => null);
      const baseUrl = getSiteBaseUrl({
        globalCanonicalUrl: typeof globalCanonicalUrl === 'string' ? globalCanonicalUrl : null,
      });
      if (baseUrl) {
        hreflangAlternates = await buildPageHreflangAlternatesForPage(page, baseUrl, collectionItem);
      }
    } catch (error) {
      console.error('[PageRenderer] Error building hreflang alternates:', error);
    }
  }

  return (
    <>
      {/* Global head code fallback when layout skips it (SKIP_SETUP mode) */}
      {process.env.SKIP_SETUP === 'true' && globalCustomCodeHead && (
        renderRootLayoutHeadCode(globalCustomCodeHead, 'global-head')
      )}

      {/* Page-specific custom head code.
          Self-hosted: the site layout injects this into the real <head>.
          Cloud (SKIP_SETUP): the layout cannot read the request URL without
          breaking ISR, so fall back to rendering here. */}
      {shouldInjectPageHead && pageCustomCodeHead && (
        renderRootLayoutHeadCode(pageCustomCodeHead, 'page-head')
      )}

      {/* hreflang alternates for multilingual sites (lowercase attribute) */}
      <HreflangAlternateLinks alternates={hreflangAlternates} />

      {/* Preload the LCP image so the browser starts the fetch from <head>
          rather than waiting until the parser reaches the <img> tag. Pairs
          with the eager + fetchpriority=high props the renderer sets on the
          same layer below. */}
      {lcpPreloadSrc && (
        lcpPreloadSrcset ? (
          <link
            rel="preload"
            as="image"
            href={lcpPreloadSrc}
            imageSrcSet={lcpPreloadSrcset}
            imageSizes={lcpPreloadSizes || undefined}
            fetchPriority="high"
          />
        ) : (
          <link
            rel="preload"
            as="image"
            href={lcpPreloadSrc}
            fetchPriority="high"
          />
        )
      )}

      {/* Strip native browser appearance from form elements so Tailwind classes apply */}
      <style
        id="ycode-form-reset"
        dangerouslySetInnerHTML={{ __html: 'input,select,textarea{appearance:none;-webkit-appearance:none}select{background-image:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'16\' height=\'16\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23737373\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Cpath d=\'m6 9 6 6 6-6\'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;background-size:16px 16px}input[type="checkbox"]:checked,input[type="radio"]:checked{background-color:currentColor;border-color:transparent;background-size:100% 100%;background-position:center;background-repeat:no-repeat}input[type="checkbox"]:checked{background-image:url("data:image/svg+xml,%3csvg viewBox=\'0 0 16 16\' fill=\'white\' xmlns=\'http://www.w3.org/2000/svg\'%3e%3cpath d=\'M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2-2a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z\'/%3e%3c/svg%3e")}input[type="radio"]:checked{background-image:url("data:image/svg+xml,%3csvg viewBox=\'0 0 16 16\' fill=\'white\' xmlns=\'http://www.w3.org/2000/svg\'%3e%3ccircle cx=\'8\' cy=\'8\' r=\'3\'/%3e%3c/svg%3e")}' }}
      />

      {/* Inject CSS directly — React 19 hoists <style> with precedence to <head> */}
      {generatedCss && (
        <style
          id="ycode-styles"
          dangerouslySetInnerHTML={{ __html: generatedCss }}
        />
      )}

      {/* Inject color variable CSS custom properties */}
      {colorVariablesCss && (
        <style
          id="ycode-color-vars"
          dangerouslySetInnerHTML={{ __html: colorVariablesCss }}
        />
      )}

      {/* Warm up the Google Fonts origins. When CSS is inlined below we only
          need gstatic (the binary origin); when we fall back to <link
          rel=stylesheet> we also need googleapis. `crossOrigin` on gstatic
          is required because font files are fetched in CORS mode. */}
      {googleFontLinkUrls.length > 0 && (
        <>
          {!googleFontsInlinedCss && (
            <link rel="preconnect" href="https://fonts.googleapis.com" />
          )}
          <link
            rel="preconnect" href="https://fonts.gstatic.com"
            crossOrigin="anonymous"
          />
        </>
      )}

      {/* Inline resolved @font-face rules when available — skips the blocking
          CSS request to fonts.googleapis.com. Falls back to <link
          rel=stylesheet> if the publish-time fetch failed. */}
      {googleFontsInlinedCss ? (
        <style
          id="ycode-google-fonts"
          dangerouslySetInnerHTML={{ __html: googleFontsInlinedCss }}
        />
      ) : (
        googleFontLinkUrls.map((url, i) => (
          <link
            key={`gfont-${i}`}
            rel="stylesheet"
            href={url}
          />
        ))
      )}

      {/* Preload uploaded custom font binaries so the browser fetches them from
          <head> instead of after CSS parsing, shrinking the font swap window.
          `crossOrigin` is required — fonts are always fetched in CORS mode. */}
      {fontPreloads.map((font) => (
        <link
          key={`font-preload-${font.href}`}
          rel="preload"
          as="font"
          href={font.href}
          type={font.type}
          crossOrigin="anonymous"
        />
      ))}

      {/* Inject custom font @font-face rules and font class CSS */}
      {fontsCss && (
        <style
          id="ycode-fonts"
          dangerouslySetInnerHTML={{ __html: fontsCss }}
        />
      )}

      {/* Inject initial animation styles to prevent flickering */}
      {initialAnimationCSS && (
        <style
          id="ycode-gsap-initial-styles"
          dangerouslySetInnerHTML={{ __html: initialAnimationCSS }}
        />
      )}

      {/* Inject Google Analytics script (non-preview only) */}
      {gaMeasurementId && (
        <>
          <script
            async
            src={`https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`}
          />
          <script
            id="google-analytics"
            dangerouslySetInnerHTML={{
              __html: `
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${gaMeasurementId}');
              `,
            }}
          />
        </>
      )}

      {/* Apply body layer classes immediately to prevent FOUC */}
      <script
        dangerouslySetInnerHTML={{
          __html: `document.body.className=document.body.className.replace(/\\bycode-body-applied\\b/g,'')+' ${(bodyClasses || 'bg-white').replace(/'/g, "\\'")} ycode-body-applied'`,
        }}
      />
      <BodyClassApplier classes={bodyClasses || 'bg-white'} />

      {/* Set <html lang> from the page locale. The root element is rendered by
          the shared layout (which can't know the per-page locale), so apply it
          here where the locale is resolved. */}
      {resolvedLang && (
        <script
          dangerouslySetInnerHTML={{
            __html: `document.documentElement.lang=${JSON.stringify(resolvedLang)}`,
          }}
        />
      )}

      <div
        id="ybody"
        className="contents"
        data-layer-id="body"
        data-layer-type="div"
        data-is-empty={hasLayers ? 'false' : 'true'}
        lang={resolvedLang}
      >
        <LayerRendererPublic
          layers={childLayers}
          isPublished={page.is_published}
          pageId={page.id}
          pageCollectionItemId={collectionItem?.id}
          pageCollectionItemData={collectionItem?.values || undefined}
          pageCollectionSortedItemIds={pageCollectionSortedItemIds}
          hiddenLayerInfo={hiddenLayerInfo}
          currentLocale={locale}
          availableLocales={availableLocales}
          localizedPageUrls={localizedPageUrls}
          pages={pages as any}
          folders={folders as any}
          collectionItemSlugs={collectionItemSlugs}
          isPreview={isPreview}
          // Text/media translations are already baked into the layer tree
          // server-side, so the client only needs slug rows to build localized
          // link hrefs. Slimming keeps the full per-locale catalog out of the
          // RSC payload (see issue #447 for the same treatment of components).
          translations={slimTranslations(translations)}
          resolvedAssets={resolvedAssets}
          // Rich-text embedded components are already pre-resolved into the layer
          // tree (_resolvedLayers), so the client renderer never needs the full
          // component library. Passing [] avoids serializing every component
          // definition into the RSC payload (see issue #447).
          components={[]}
          serverSettings={serverSettings}
          globalsData={Object.keys(globalsData).length > 0 ? globalsData : undefined}
          globalsMeta={Object.keys(globalsMeta).length > 0 ? globalsMeta : undefined}
          lcpCandidateLayerId={lcpCandidateLayerId}
          passwordProtection={is401Page ? passwordProtection : undefined}
        />

        {/* Fallback hardcoded password form: only when the 401 page has no inline
            password-protected form layer (e.g. older / customised 401 pages). */}
        {is401Page && passwordProtection && !hasInlinePasswordForm && (
          <PasswordForm
            pageId={passwordProtection.pageId}
            folderId={passwordProtection.folderId}
            redirectUrl={passwordProtection.redirectUrl}
            isPublished={passwordProtection.isPublished}
          />
        )}
      </div>

      {/* Initialize GSAP animations based on layer interactions.
          Skipped entirely when no layer has interactions so we don't ship
          GSAP + ScrollTrigger + SplitText to the client for static pages. */}
      {hasAnyInteractions(resolvedLayers) && <AnimationInitializer layers={animationLayers} />}

      {/* Initialize Swiper on slider elements */}
      {hasSliderLayers(resolvedLayers) && <SliderInitializer />}

      {/* Initialize lightbox modals */}
      {hasLightboxLayers(resolvedLayers) && <LightboxInitializer />}

      {/* Report content height to parent for zoom calculations (preview only) */}
      {!page.is_published && <ContentHeightReporter />}

      {/* Inject global custom body code (applies to all pages) */}
      {globalCustomCodeBody && (
        <CustomCodeInjector html={globalCustomCodeBody} />
      )}

      {/* Inject page-specific custom body code */}
      {pageCustomCodeBody && (
        <CustomCodeInjector html={pageCustomCodeBody} />
      )}

      {ycodeBadge && !isPreview && <YcodeBadge />}
    </>
  );
}
