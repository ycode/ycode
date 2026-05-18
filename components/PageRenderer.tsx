import AnimationInitializer from '@/components/AnimationInitializer';
import BodyClassApplier from '@/components/BodyClassApplier';
import ContentHeightReporter from '@/components/ContentHeightReporter';
import CustomCodeInjector from '@/components/CustomCodeInjector';
import LayerRendererPublic from '@/components/LayerRendererPublic';
import SliderInitializer from '@/components/SliderInitializer';
import LightboxInitializer from '@/components/LightboxInitializer';
import PasswordForm from '@/components/PasswordForm';
import YcodeBadge from '@/components/YcodeBadge';
import { unstable_cache } from 'next/cache';
import { resolveCustomCodePlaceholders } from '@/lib/resolve-cms-variables';
import { renderRootLayoutHeadCode } from '@/lib/parse-head-html';
import { generateInitialAnimationCSS, type HiddenLayerInfo } from '@/lib/animation-utils';
import { buildCustomFontsCss, buildFontClassesCss, fetchGoogleFontsCss, getGoogleFontLinks } from '@/lib/font-utils';
import { buildImageSizes, collectLayerAssetIds, findLcpCandidate, generateImageSrcset, getAssetProxyUrl, getOptimizedImageUrl } from '@/lib/asset-utils';
import { getAllPages } from '@/lib/repositories/pageRepository';
import { getAllPageFolders } from '@/lib/repositories/pageFolderRepository';
import { getMapboxAccessToken, getGoogleMapsEmbedApiKey } from '@/lib/map-server';
import { getAllColorVariables } from '@/lib/repositories/colorVariableRepository';
import { getSettingByKey } from '@/lib/repositories/settingsRepository';
import { getItemsWithValues, getItemsWithValuesByIds } from '@/lib/repositories/collectionItemRepository';
import { getFieldsByCollectionId } from '@/lib/repositories/collectionFieldRepository';
import { REF_PAGE_PREFIX, REF_COLLECTION_PREFIX, isCollectionItemKeyword, parseCollectionLinkValue } from '@/lib/link-utils';
import { getClassesString, hasPasswordFormLayer } from '@/lib/layer-utils';
import type { Layer, Component, Page, CollectionItemWithValues, CollectionField, Locale, PageFolder, PasswordProtectionContext } from '@/types';

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
 * Strip heavy SSR-only data from the layer tree before passing to client
 * components. After resolveCollectionLayers, all variables are pre-resolved
 * into the layers — _collectionItemValues and _layerDataMap are redundant
 * and can be enormous (e.g. 50 articles × full rich text bodies).
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

/** Recursively check if any layer in the tree is a slider */
function hasSliderLayers(layers: Layer[]): boolean {
  for (const layer of layers) {
    if (layer.name === 'slider') return true;
    if (layer.children && hasSliderLayers(layer.children)) return true;
  }
  return false;
}

/** Recursively check if any layer in the tree is a lightbox */
function hasLightboxLayers(layers: Layer[]): boolean {
  for (const layer of layers) {
    if (layer.name === 'lightbox') return true;
    if (layer.children && hasLightboxLayers(layer.children)) return true;
  }
  return false;
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

  // Extract custom code from page settings and resolve placeholders for dynamic pages
  const rawPageCustomCodeHead = page.settings?.custom_code?.head || '';
  const rawPageCustomCodeBody = page.settings?.custom_code?.body || '';

  const pageCustomCodeHead = page.is_dynamic && collectionItem
    ? resolveCustomCodePlaceholders(rawPageCustomCodeHead, collectionItem, collectionFields)
    : rawPageCustomCodeHead;

  const pageCustomCodeBody = page.is_dynamic && collectionItem
    ? resolveCustomCodePlaceholders(rawPageCustomCodeBody, collectionItem, collectionFields)
    : rawPageCustomCodeBody;

  const { bodyClasses, childLayers: rawChildLayers } = extractBodyLayer(resolvedLayers);
  const hasLayers = rawChildLayers.length > 0;

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
  try {
    const { getAllFonts: getAllDraftFonts } = await import('@/lib/repositories/fontRepository');
    const { getPublishedFonts } = await import('@/lib/repositories/fontRepository');
    const fonts = isPreview ? await getAllDraftFonts() : await getPublishedFonts();
    fontsCss = buildCustomFontsCss(fonts) + buildFontClassesCss(fonts);
    googleFontLinkUrls = getGoogleFontLinks(fonts);

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
  const [mapboxToken, googleMapsEmbedKey, serverColorVariables, timezoneSetting] = await Promise.all([
    getMapboxAccessToken(),
    getGoogleMapsEmbedApiKey(),
    getAllColorVariables(),
    getSettingByKey('timezone').catch(() => null),
  ]);
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

  return (
    <>
      {/* Global head code fallback when layout skips it (SKIP_SETUP mode) */}
      {process.env.SKIP_SETUP === 'true' && globalCustomCodeHead && (
        renderRootLayoutHeadCode(globalCustomCodeHead, 'global-head')
      )}

      {/* Page-specific custom head code — React 19 hoists meta/link/style/title to <head> */}
      {pageCustomCodeHead && renderRootLayoutHeadCode(pageCustomCodeHead, 'page-head')}

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

      <BodyClassApplier classes={bodyClasses || 'bg-white'} />

      <main
        id="ybody"
        className="contents"
        data-layer-id="body"
        data-layer-type="div"
        data-is-empty={hasLayers ? 'false' : 'true'}
      >
        <LayerRendererPublic
          layers={childLayers}
          isPublished={page.is_published}
          pageCollectionItemId={collectionItem?.id}
          pageCollectionItemData={collectionItem?.values || undefined}
          pageCollectionSortedItemIds={pageCollectionSortedItemIds}
          hiddenLayerInfo={hiddenLayerInfo}
          currentLocale={locale}
          availableLocales={availableLocales}
          pages={pages as any}
          folders={folders as any}
          collectionItemSlugs={collectionItemSlugs}
          isPreview={isPreview}
          translations={translations}
          resolvedAssets={resolvedAssets}
          components={components}
          serverSettings={serverSettings}
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
      </main>

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
