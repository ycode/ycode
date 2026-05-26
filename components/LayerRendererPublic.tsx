'use client';

/**
 * LayerRendererPublic - public-only layer renderer.
 *
 * This is the non-edit-mode counterpart of LayerRenderer. It is used by
 * PageRenderer (live + preview public pages) and the (site) error boundaries.
 * It contains zero builder dependencies (no dnd-kit, no CanvasTextEditor,
 * no LayerContextMenu, no editor stores, no collaboration UI). All data
 * needed for rendering is resolved server-side and passed in via props
 * (resolvedAssets, components, serverSettings, pages, folders, etc.).
 *
 * If you need to add a feature: add it here AND in LayerRenderer.tsx.
 */

import React, { useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import dynamic from 'next/dynamic';
import type { Layer, Locale, FormSettings, Component, DesignColorVariable, PasswordProtectionContext } from '@/types';
import { getLayerHtmlTag, getClassesString, getText, resolveFieldValue, isTextContentLayer, getCollectionVariable, filterDisabledSliderLayers } from '@/lib/layer-utils';
import { getMapIframeProps, DEFAULT_MAP_SETTINGS, resolveMarkerColor } from '@/lib/map-utils';
import { SWIPER_CLASS_MAP, SWIPER_DATA_ATTR_MAP } from '@/lib/slider-constants';
import { getDynamicTextContent, getImageUrlFromVariable, getVideoUrlFromVariable, getIframeUrlFromVariable, isFieldVariable, isAssetVariable, isStaticTextVariable, isDynamicTextVariable, getStaticTextContent, getAssetId, resolveDesignStyles } from '@/lib/variable-utils';
import { getTranslatedAssetId, getTranslatedText } from '@/lib/locale-runtime';
import { isValidLinkSettings, generateLinkHref, resolveLinkAttrs, isLinkAtCollectionBoundary, type LinkResolutionContext } from '@/lib/link-utils';
import { DEFAULT_ASSETS, buildImageSizes, generateImageSrcset, getOptimizedImageUrl, parseImageDimension } from '@/lib/asset-utils';
import { resolveInlineVariablesFromData } from '@/lib/inline-variables';
import { renderRichText, hasBlockElementsWithInlineVariables, getTextStyleClasses, flattenTiptapParagraphs, type RichTextLinkContext, type RenderComponentBlockFn } from '@/lib/text-format-utils';
import { combineBgValues, mergeStaticBgVars } from '@/lib/tailwind-class-mapper';
import { clsx } from 'clsx';
import type { HiddenLayerInfo } from '@/lib/animation-utils';
import { transformLayerIdsForInstance } from '@/lib/resolve-components';

/**
 * Per-layer-type code splitting.
 *
 * `LayerRendererPublic` is the single client component that hydrates every
 * published & preview page, so anything we import statically here ships in
 * the entry chunk for *every* visitor — even if the page never renders that
 * layer type. The bindings below load on demand the first time the matching
 * layer is encountered (~262 KiB of unused JS in PSI before this split).
 *
 * Keep `ssr: true` (the default): the wrapped components rely on SSR for
 * SEO / hydration consistency, we only want to defer the *client* chunk.
 */
const PaginatedCollection = dynamic(() => import('@/components/PaginatedCollection'));
const LoadMoreCollection = dynamic(() => import('@/components/LoadMoreCollection'));
const FilterableCollection = dynamic(() => import('@/components/FilterableCollection'));
const LocaleSelector = dynamic(() => import('@/components/layers/LocaleSelector'));
const AnimationInitializer = dynamic(() => import('@/components/AnimationInitializer'));
const FilterLayerBehavior = dynamic(() => import('@/components/FilterLayerBehavior'));
const AuthForm = dynamic(() => import('@/components/layers/AuthForm'));
const UserStatus = dynamic(() => import('@/components/layers/UserStatus'));

/** True if any layer in the tree has at least one interaction configured. */
function layerTreeHasInteractions(layers: Layer[]): boolean {
  for (const layer of layers) {
    if (layer.interactions?.length) return true;
    if (layer.children && layerTreeHasInteractions(layer.children)) return true;
  }
  return false;
}

/**
 * Build a map of layerId -> anchor value (attributes.id) for O(1) anchor resolution
 * Recursively traverses the layer tree once
 */
function buildAnchorMap(layers: Layer[]): Record<string, string> {
  const map: Record<string, string> = {};

  const traverse = (layerList: Layer[]) => {
    for (const layer of layerList) {
      // Only add to map if layer has a custom id attribute set
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

interface LayerRendererPublicProps {
  layers: Layer[];
  isPublished?: boolean;
  pageId?: string;
  collectionItemData?: Record<string, string>;
  collectionItemId?: string;
  layerDataMap?: Record<string, Record<string, string>>;
  pageCollectionItemId?: string;
  pageCollectionItemData?: Record<string, string> | null;
  /** Ordered ids of the dynamic page's collection — powers `next-item` / `previous-item` link keywords. */
  pageCollectionSortedItemIds?: string[];
  hiddenLayerInfo?: HiddenLayerInfo[];
  currentLocale?: Locale | null;
  availableLocales?: Locale[];
  localeSelectorFormat?: 'locale' | 'code';
  isInsideForm?: boolean;
  isInsideLink?: boolean;
  parentFormSettings?: FormSettings;
  pages?: any[];
  folders?: any[];
  collectionItemSlugs?: Record<string, string>;
  isPreview?: boolean;
  translations?: Record<string, any> | null;
  anchorMap?: Record<string, string>;
  resolvedAssets?: Record<string, { url: string; width?: number | null; height?: number | null }>;
  components?: Component[];
  ancestorComponentIds?: Set<string>;
  isSlideChild?: boolean;
  serverSettings?: Record<string, unknown>;
  /**
   * Layer id of the LCP candidate image, detected server-side. When this image
   * is rendered we override the template's default `loading="lazy"` with
   * `loading="eager"` + `fetchpriority="high"` so the browser starts downloading
   * the hero image during the HTML parse rather than after CSS/layout.
   */
  lcpCandidateLayerId?: string | null;
  /**
   * When set (typically on the 401 error page), a password-protected form layer
   * uses this context to call the page-auth verify endpoint and redirect on success.
   */
  passwordProtection?: PasswordProtectionContext;
}

const LayerRendererPublic: React.FC<LayerRendererPublicProps> = ({
  layers,
  isPublished = false,
  pageId = '',
  collectionItemData,
  collectionItemId,
  layerDataMap,
  pageCollectionItemId,
  pageCollectionItemData,
  pageCollectionSortedItemIds,
  collectionItemSlugs,
  hiddenLayerInfo,
  currentLocale,
  availableLocales = [],
  localeSelectorFormat,
  isInsideForm = false,
  isInsideLink = false,
  parentFormSettings,
  pages = [],
  folders = [],
  isPreview = false,
  translations,
  anchorMap: anchorMapProp,
  resolvedAssets,
  components: componentsProp,
  ancestorComponentIds,
  isSlideChild: isSlideChildProp,
  serverSettings,
  lcpCandidateLayerId,
  passwordProtection,
}) => {
  const anchorMap = useMemo(() => {
    return anchorMapProp || buildAnchorMap(layers);
  }, [anchorMapProp, layers]);

  const renderLayer = (layer: Layer): React.ReactNode => {
    if (layer.name === '_fragment' && layer.children) {
      const renderedChildren = layer.children.map((child: Layer) => renderLayer(child));

      const originalLayerId = layer.id.replace(/-fragment$/, '');
      const hasFilter = !!layer._filterConfig;
      const hasPagination = layer._paginationMeta && isPublished;

      if (hasPagination || hasFilter) {
        let content: React.ReactNode = renderedChildren;

        if (hasPagination) {
          const paginationMode = layer._paginationMeta!.mode || 'pages';

          if (paginationMode === 'load_more') {
            content = (
              <LoadMoreCollection
                paginationMeta={layer._paginationMeta!}
                collectionLayerId={originalLayerId}
                itemIds={layer._paginationMeta!.itemIds}
                layerTemplate={layer._paginationMeta!.layerTemplate}
              >
                {content}
              </LoadMoreCollection>
            );
          } else {
            content = (
              <PaginatedCollection
                paginationMeta={layer._paginationMeta!}
                collectionLayerId={originalLayerId}
              >
                {content}
              </PaginatedCollection>
            );
          }
        }

        if (hasFilter) {
          content = (
            <FilterableCollection
              collectionId={layer._filterConfig!.collectionId}
              collectionLayerId={layer._filterConfig!.collectionLayerId}
              filters={layer._filterConfig!.filters}
              sortBy={layer._filterConfig!.sortBy}
              sortOrder={layer._filterConfig!.sortOrder}
              sortByInputLayerId={layer._filterConfig!.sortByInputLayerId}
              sortOrderInputLayerId={layer._filterConfig!.sortOrderInputLayerId}
              limit={layer._filterConfig!.limit}
              paginationMode={layer._filterConfig!.paginationMode}
              layerTemplate={layer._filterConfig!.layerTemplate}
              collectionLayerClasses={layer._filterConfig!.collectionLayerClasses}
              collectionLayerTag={layer._filterConfig!.collectionLayerTag}
              isPublished={layer._filterConfig!.isPublished}
              userScope={layer._filterConfig!.userScope}
              userScopeFieldId={layer._filterConfig!.userScopeFieldId}
            >
              {content}
            </FilterableCollection>
          );
        }

        return (
          <Suspense key={layer.id} fallback={<div className="animate-pulse bg-gray-200 rounded h-32" />}>
            {content}
          </Suspense>
        );
      }

      return renderedChildren;
    }

    return (
      <LayerItem
        key={(layer as Layer & { _bulletKey?: string })._bulletKey || layer.id}
        layer={layer}
        isPublished={isPublished}
        pageId={pageId}
        collectionItemData={collectionItemData}
        collectionItemId={collectionItemId}
        layerDataMap={layerDataMap}
        pageCollectionItemId={pageCollectionItemId}
        pageCollectionItemData={pageCollectionItemData}
        pageCollectionSortedItemIds={pageCollectionSortedItemIds}
        hiddenLayerInfo={hiddenLayerInfo}
        currentLocale={currentLocale}
        availableLocales={availableLocales}
        localeSelectorFormat={localeSelectorFormat}
        isInsideForm={isInsideForm}
        isInsideLink={isInsideLink}
        parentFormSettings={parentFormSettings}
        pages={pages}
        folders={folders}
        collectionItemSlugs={collectionItemSlugs}
        isPreview={isPreview}
        translations={translations}
        anchorMap={anchorMap}
        resolvedAssets={resolvedAssets}
        components={componentsProp}
        ancestorComponentIds={ancestorComponentIds}
        isSlideChild={isSlideChildProp}
        serverSettings={serverSettings}
        lcpCandidateLayerId={lcpCandidateLayerId}
        passwordProtection={passwordProtection}
      />
    );
  };

  return (
    <>
      {layers.map((layer) => renderLayer(layer))}
    </>
  );
};

// Separate LayerItem component to handle drag-and-drop per layer
const LayerItem: React.FC<{
  layer: Layer;
  isPublished: boolean;
  pageId: string;
  collectionItemData?: Record<string, string>;
  collectionItemId?: string;
  layerDataMap?: Record<string, Record<string, string>>;
  pageCollectionItemId?: string;
  pageCollectionItemData?: Record<string, string> | null;
  pageCollectionSortedItemIds?: string[];
  hiddenLayerInfo?: HiddenLayerInfo[];
  currentLocale?: Locale | null;
  availableLocales?: Locale[];
  localeSelectorFormat?: 'locale' | 'code';
  isInsideForm?: boolean;
  isInsideLink?: boolean;
  parentFormSettings?: FormSettings;
  pages?: any[];
  folders?: any[];
  collectionItemSlugs?: Record<string, string>;
  isPreview?: boolean;
  translations?: Record<string, any> | null;
  anchorMap?: Record<string, string>;
  resolvedAssets?: Record<string, { url: string; width?: number | null; height?: number | null }>;
  components?: Component[];
  ancestorComponentIds?: Set<string>;
  isSlideChild?: boolean;
  serverSettings?: Record<string, unknown>;
  lcpCandidateLayerId?: string | null;
  passwordProtection?: PasswordProtectionContext;
}> = ({
  layer,
  isPublished,
  pageId,
  collectionItemData,
  collectionItemId,
  layerDataMap,
  pageCollectionItemId,
  pageCollectionItemData,
  pageCollectionSortedItemIds,
  hiddenLayerInfo,
  currentLocale,
  availableLocales,
  localeSelectorFormat,
  isInsideForm = false,
  isInsideLink = false,
  parentFormSettings,
  pages,
  folders,
  collectionItemSlugs,
  isPreview,
  translations,
  anchorMap,
  resolvedAssets,
  components: componentsProp,
  ancestorComponentIds,
  isSlideChild,
  serverSettings,
  lcpCandidateLayerId,
  passwordProtection,
}) => {
  const classesString = getClassesString(layer);
  const collectionLayerItemId = layer._collectionItemId || collectionItemId;
  const collectionLayerData = layer._collectionItemValues || collectionItemData;
  const effectiveLayerDataMap = React.useMemo(() => ({
    ...layerDataMap,
    ...(layer._layerDataMap || {}),
  }), [layerDataMap, layer._layerDataMap]);
  const effectiveAncestorIds = useMemo(() => {
    if (!layer.componentId) return ancestorComponentIds;
    const set = new Set(ancestorComponentIds);
    set.add(layer.componentId);
    return set;
  }, [ancestorComponentIds, layer.componentId]);

  const timezone = ((serverSettings?.timezone as string | undefined) ?? 'UTC');
  const allComponents = componentsProp ?? [];
  const colorVariables = (serverSettings?.color_variables as DesignColorVariable[] | undefined) ?? [];

  // Asset resolver that uses only the pre-resolved (SSR) asset map.
  // No editor stores are consulted in public mode.
  const getAsset = useCallback((id: string) => {
    if (!resolvedAssets?.[id]) return null;
    const { url, width, height } = resolvedAssets[id];
    if (url.startsWith('<')) {
      return { public_url: null, content: url };
    }
    return { public_url: url, width, height };
  }, [resolvedAssets]);

  // Shared props passed to nested LayerRendererPublic calls (component instances & rich-text components)
  const sharedRendererProps = useMemo(() => ({
    isPublished,
    pageId,
    collectionItemData: collectionLayerData,
    collectionItemId: collectionLayerItemId,
    layerDataMap: effectiveLayerDataMap,
    pageCollectionItemId,
    pageCollectionItemData,
    pageCollectionSortedItemIds,
    hiddenLayerInfo,
    currentLocale,
    availableLocales,
    localeSelectorFormat,
    isInsideForm,
    isInsideLink,
    parentFormSettings,
    pages,
    folders,
    collectionItemSlugs,
    isPreview,
    translations,
    anchorMap,
    resolvedAssets,
    components: componentsProp,
    serverSettings,
    lcpCandidateLayerId,
    passwordProtection,
  }), [isPublished, pageId, collectionLayerData, collectionLayerItemId, effectiveLayerDataMap, pageCollectionItemId, pageCollectionItemData, pageCollectionSortedItemIds, hiddenLayerInfo, currentLocale, availableLocales, localeSelectorFormat, isInsideForm, isInsideLink, parentFormSettings, pages, folders, collectionItemSlugs, isPreview, translations, anchorMap, resolvedAssets, componentsProp, serverSettings, lcpCandidateLayerId, passwordProtection]);

  const renderComponentBlock: RenderComponentBlockFn = useCallback(
    (comp, resolvedLayers, _overrides, key, innerAncestorIds) => {
      const uniqueLayers = transformLayerIdsForInstance(
        resolvedLayers,
        `${layer.id}-rtc-${key}`
      );
      // Only mount AnimationInitializer (which pulls in GSAP + plugins) when
      // the embedded component actually has interactions configured.
      const componentHasInteractions = layerTreeHasInteractions(uniqueLayers);
      return (
        <React.Fragment key={key}>
          <LayerRendererPublic
            layers={uniqueLayers}
            {...sharedRendererProps}
            ancestorComponentIds={innerAncestorIds}
          />
          {componentHasInteractions && (
            <AnimationInitializer
              layers={uniqueLayers}
              injectInitialCSS
            />
          )}
        </React.Fragment>
      );
    },
    [layer.id, sharedRendererProps]
  );

  let htmlTag = getLayerHtmlTag(layer);

  const isSimpleTextLayer = isTextContentLayer(layer);

  // Check if we need to override the tag for rich text with block elements
  // Tags like <p>, <h1>-<h6> cannot contain block elements like <ul>/<ol>
  const textVariable = layer.variables?.text;
  let useSpanForParagraphs = false;

  // Detect block-level expansion (lists, tables, headings, embedded components,
  // or a rich_text CMS variable that expands to blocks). This decides both the
  // wrapper tag and whether the content can be flattened to a single paragraph.
  const hasBlockExpansion = textVariable?.type === 'dynamic_rich_text'
    ? hasBlockElementsWithInlineVariables(
        textVariable as any,
        collectionLayerData,
        pageCollectionItemData || undefined,
    )
    : false;

  const restrictiveBlockTags = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'a', 'button'];
  const isRestrictiveTag = restrictiveBlockTags.includes(htmlTag);

  if (isRestrictiveTag) {
    if (hasBlockExpansion) {
      // Block-level expansion cannot live inside <p>/<h*>/<span>; switch the
      // wrapper to a <div> regardless of whether this is a simple text layer
      // or a richText layer.
      htmlTag = 'div';
    } else if (!isSimpleTextLayer && (textVariable?.type === 'dynamic_rich_text' || (textVariable as any)?.id)) {
      useSpanForParagraphs = true;
    }
  }

  // Buttons with link settings render as <a> directly instead of being
  // wrapped in <a><button></button></a> which is invalid HTML
  const isButtonWithLink = layer.name === 'button'
    && !isInsideForm
    && !isInsideLink
    && isValidLinkSettings(layer.variables?.link);
  if (isButtonWithLink) {
    htmlTag = 'a';
  }

  // Divs with link settings render as <a> directly instead of being
  // wrapped in <a class="contents"><div>…</div></a>.
  const isDivWithLink = !isButtonWithLink
    && !isInsideLink
    && layer.name === 'div'
    && htmlTag === 'div'
    && layer.id !== 'body'
    && isValidLinkSettings(layer.variables?.link);
  if (isDivWithLink) {
    htmlTag = 'a';
  }

  // Code Embed iframe ref and effect - must be at component level
  const htmlEmbedIframeRef = React.useRef<HTMLIFrameElement>(null);
  const filterLayerRef = React.useRef<HTMLDivElement>(null);
  const htmlEmbedCode = layer.name === 'htmlEmbed'
    ? (layer.settings?.htmlEmbed?.code || '<div>Add your custom code here</div>')
    : '';

  // Handle HTML embed iframe initialization and auto-resizing
  useEffect(() => {
    if (layer.name !== 'htmlEmbed' || !htmlEmbedIframeRef.current) return;

    const iframe = htmlEmbedIframeRef.current;
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;

    if (!iframeDoc) return;

    // Create a complete HTML document inside iframe
    iframeDoc.open();
    iframeDoc.write(`
      <!DOCTYPE html>
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
      </html>
    `);
    iframeDoc.close();

    // Auto-resize iframe to match content height
    const updateHeight = () => {
      if (iframeDoc.body) {
        const height = iframeDoc.body.scrollHeight;
        iframe.style.height = `${height}px`;
      }
    };

    // Initial height update
    updateHeight();

    // Watch for content size changes
    const resizeObserver = new ResizeObserver(updateHeight);
    if (iframeDoc.body) {
      resizeObserver.observe(iframeDoc.body);
    }

    // Fallback: Update height periodically for dynamic content
    const interval = setInterval(updateHeight, 100);

    return () => {
      resizeObserver.disconnect();
      clearInterval(interval);
    };
  }, [htmlEmbedCode, layer.name]);

  // Filter layer runtime behavior is implemented in FilterLayerBehavior, which
  // is dynamic-imported and mounted only when this layer is a filter. Keeping
  // it out of the main bundle drops zustand + ~180 lines of DOM-scanning code
  // from every page that doesn't use filtering.
  const isFilterLayer = layer.name === 'filter';
  const filterOnChange = layer.settings?.filterOnChange ?? false;

  // Resolve text and image URLs with field binding support
  const textContent = (() => {
    // Special handling for locale selector label
    if (layer.key === 'localeSelectorLabel') {
      const defaultLocale = availableLocales?.find(l => l.is_default) || availableLocales?.[0];
      const displayLocale = currentLocale || defaultLocale;

      if (!displayLocale) {
        return 'English';
      }

      const format = localeSelectorFormat || 'locale';
      return format === 'code' ? displayLocale.code.toUpperCase() : displayLocale.label;
    }

    const linkContext: RichTextLinkContext = {
      pages,
      folders,
      collectionItemSlugs,
      collectionItemId: collectionLayerItemId,
      pageCollectionItemId,
      isPreview,
      locale: currentLocale,
      translations,
      getAsset,
      anchorMap,
      resolvedAssets,
      layerDataMap: effectiveLayerDataMap,
      pageCollectionSortedItemIds,
    };

    // DynamicRichTextVariable format (with formatting)
    if (textVariable?.type === 'dynamic_rich_text') {
      // Simple text layers (text/heading) normally collapse all paragraphs
      // into one to fit the layer's single-tag wrapper. Skip flattening when
      // the content expands to block elements (e.g. a CMS rich_text variable
      // resolving to headings/tables/lists), otherwise that formatting is lost.
      const shouldFlatten = isSimpleTextLayer && !hasBlockExpansion;
      const variable = shouldFlatten
        ? { ...textVariable, data: { ...textVariable.data, content: flattenTiptapParagraphs(textVariable.data.content) } }
        : textVariable;
      return renderRichText(variable as any, collectionLayerData, pageCollectionItemData || undefined, layer.textStyles, useSpanForParagraphs, false, linkContext, timezone, effectiveLayerDataMap, allComponents, renderComponentBlock, effectiveAncestorIds, shouldFlatten);
    }

    // Check for inline variables in DynamicTextVariable format (legacy)
    if (textVariable?.type === 'dynamic_text') {
      const content = textVariable.data.content;
      if (typeof content === 'string') {
        if (content.includes('<ycode-inline-variable>')) {
          return resolveInlineVariablesFromData(content, collectionLayerData, pageCollectionItemData ?? undefined, timezone, effectiveLayerDataMap);
        }
        return content;
      }
      // Tiptap JSON content (e.g. dynamicVariable nodes) — skip, rendered by RichTextEditor
      return undefined;
    }
    const text = getText(layer);
    if (text) return text;
    return undefined;
  })();

  // Public path: component variable overrides are pre-baked server-side via
  // resolveComponents → applyComponentOverrides. We just use the layer's settings.
  const effectiveImageSettings = layer.variables?.image;

  const originalImageAssetId = effectiveImageSettings?.src?.type === 'asset'
    ? effectiveImageSettings.src.data?.asset_id
    : undefined;
  const translatedImageAssetId = getTranslatedAssetId(
    originalImageAssetId || undefined,
    `layer:${layer.id}:image_src`,
    translations,
    pageId,
    layer._masterComponentId
  );

  // Build image variable with translated asset ID
  const imageVariable = originalImageAssetId && translatedImageAssetId && translatedImageAssetId !== originalImageAssetId
    ? { ...effectiveImageSettings?.src, type: 'asset' as const, data: { asset_id: translatedImageAssetId } }
    : effectiveImageSettings?.src;

  const imageUrl = getImageUrlFromVariable(
    imageVariable,
    getAsset,
    collectionLayerData,
    pageCollectionItemData
  );

  // Get image alt text, resolve inline variables, and apply translation if available
  const rawImageAlt = String(getDynamicTextContent(effectiveImageSettings?.alt) || 'Image');
  const originalImageAlt = rawImageAlt.includes('<ycode-inline-variable>')
    ? resolveInlineVariablesFromData(rawImageAlt, collectionLayerData, pageCollectionItemData ?? undefined, timezone, effectiveLayerDataMap)
    : rawImageAlt;
  const translatedImageAlt = getTranslatedText(
    originalImageAlt,
    `layer:${layer.id}:image_alt`,
    translations,
    pageId,
    layer._masterComponentId
  ) || 'Image';
  const imageAlt = translatedImageAlt;

  // Public path: audio/video/icon component variable overrides are pre-baked
  // server-side. Use the layer's variables directly.
  const effectiveLayer = layer;

  // For published pages, children are already resolved server-side
  // (component instances inlined, collection layers expanded per item).
  const baseChildren = layer.children;
  const children = baseChildren;

  // For slider layers, strip inactive pagination/navigation children entirely
  const effectiveChildren = useMemo(() => {
    if (layer.name !== 'slider' || !children?.length) return children;
    return filterDisabledSliderLayers(children, layer.settings);
  }, [layer.name, layer.settings, children]);

  const subtreeHasInteractiveDescendants = useMemo(() => {
    const interactiveTags = new Set(['a', 'button', 'input', 'select', 'textarea']);

    const visit = (nodes?: Layer[]): boolean => {
      if (!nodes?.length) return false;

      return nodes.some((node) => {
        if (!node) return false;

        const childTag = node.settings?.tag || node.name || 'div';
        const childHasLink = isValidLinkSettings(node.variables?.link);

        return interactiveTags.has(childTag) || childHasLink || visit(node.children);
      });
    };

    return visit(effectiveChildren);
  }, [effectiveChildren]);

  // Browsers repair invalid interactive nesting (<a><button>, <a><a>, etc.)
  // differently during SSR, which can cause hydration mismatches.
  if (htmlTag === 'a' && subtreeHasInteractiveDescendants) {
    htmlTag = 'div';
  }

  // Public renderer never needs the canvas slider hook; live sliders are
  // initialized by SliderInitializer (loaded only when slider layers exist).

  // For rich text elements, add paragraph default classes when tag is <p>
  const paragraphClasses = !isSimpleTextLayer && htmlTag === 'p' && layer.variables?.text
    ? getTextStyleClasses(layer.textStyles, 'paragraph')
    : '';

  // `<button>` defaults to `display: inline-block` (shrink-wraps) and
  // `text-align: center`, while `<a>` defaults to `display: inline` and inherits
  // text-align (typically left). When a button-with-link is rendered as `<a>`,
  // re-apply those button defaults so layout matches:
  // - `w-fit`: only if no explicit width or block-level display class is set,
  //   since those make the element block-level (full width) on purpose.
  // - `text-center`: only if no explicit text-align class is set.
  const BLOCK_DISPLAY_CLASSES = new Set([
    'flex', 'block', 'grid', 'table', 'flow-root',
  ]);
  const TEXT_ALIGN_CLASSES = new Set([
    'text-left', 'text-center', 'text-right', 'text-justify', 'text-start', 'text-end',
  ]);
  const layerClassList = isButtonWithLink
    ? (Array.isArray(layer.classes) ? layer.classes : (layer.classes || '').split(' '))
    : [];
  const buttonNeedsFit = isButtonWithLink && (() => {
    const hasWidth = layerClassList.some((c: string) => /^w-/.test(c.split(':').pop() || ''));
    if (hasWidth) return false;
    const hasBlockDisplay = layerClassList.some((c: string) => BLOCK_DISPLAY_CLASSES.has(c.split(':').pop() || ''));
    return !hasBlockDisplay;
  })();
  const buttonNeedsTextCenter = isButtonWithLink
    && !layerClassList.some((c: string) => TEXT_ALIGN_CLASSES.has(c.split(':').pop() || ''));

  const fullClassName = clsx(classesString, paragraphClasses, SWIPER_CLASS_MAP[layer.name], isSlideChild && 'swiper-slide', buttonNeedsFit && 'w-fit', buttonNeedsTextCenter && 'text-center');

  if (layer.settings?.hidden) {
    return null;
  }

  // Prevent circular component rendering (A → B → A)
  if (layer.componentId && ancestorComponentIds?.has(layer.componentId)) {
    return null;
  }

  // Shared link resolution context — only built once, reused by button links,
  // <a> layer links, and link wrappers.
  const layerLinkContext: LinkResolutionContext = {
    pages,
    folders,
    collectionItemSlugs,
    collectionItemId: collectionLayerItemId,
    pageCollectionItemId,
    collectionItemData: collectionLayerData,
    pageCollectionItemData: pageCollectionItemData || undefined,
    isPreview,
    locale: currentLocale,
    translations,
    getAsset,
    anchorMap,
    resolvedAssets,
    layerDataMap: effectiveLayerDataMap,
    pageCollectionSortedItemIds,
  };

  const renderContent = () => {
    const Tag = htmlTag as any;
    const { style: attrStyle, ...otherAttributes } = effectiveLayer.attributes || {};

    // Map HTML attributes to React JSX equivalents
    const htmlToJsxAttrMap: Record<string, string> = {
      'for': 'htmlFor',
      'class': 'className',
      'autofocus': 'autoFocus',
    };

    // Convert string boolean values to actual booleans and map HTML attrs to JSX
    const normalizedAttributes = Object.fromEntries(
      Object.entries(otherAttributes)
        .filter(([key]) => {
          // React uses defaultValue/value on <select>, not selected on <option>
          if (htmlTag === 'option' && key === 'selected') return false;
          return true;
        })
        .map(([key, value]) => {
          // Map HTML attribute names to JSX equivalents
          const jsxKey = htmlToJsxAttrMap[key] || key;

          // If value is already a boolean, keep it
          if (typeof value === 'boolean') {
            return [jsxKey, value];
          }
          // If value is a string that looks like a boolean, convert it
          if (typeof value === 'string') {
            if (value === 'true') {
              return [jsxKey, true];
            }
            if (value === 'false') {
              return [jsxKey, false];
            }
          }
          // For all other values, keep them as-is
          return [jsxKey, value];
        })
    );

    // If inside a form and this is an input with a CMS field mapping, override the name attribute
    if (isInsideForm && (layer.name === 'input' || layer.name === 'textarea' || layer.name === 'select')) {
      const cmsFieldId = otherAttributes.cms_field_id;
      if (cmsFieldId) {
        normalizedAttributes.name = cmsFieldId;
      }
    }

    // Parse style string to object if needed (for display: contents from collection wrappers)
    const parsedAttrStyle = typeof attrStyle === 'string'
      ? Object.fromEntries(
        attrStyle.split(';')
          .filter(Boolean)
          .map(rule => {
            const [prop, val] = rule.split(':').map(s => s.trim());
            // Convert kebab-case to camelCase for React
            const camelProp = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            return [camelProp, val];
          })
      )
      : attrStyle;

    // Resolve design color bindings from CMS fields (editor + published, supports gradients)
    const designBindings = layer.variables?.design as Record<string, DesignColorVariable> | undefined;
    const resolvedDesignStyles = designBindings
      ? resolveDesignStyles(designBindings, (fieldVar) =>
        resolveFieldValue(fieldVar, collectionLayerData, pageCollectionItemData, effectiveLayerDataMap)
      ) || layer._dynamicStyles
      : layer._dynamicStyles;

    // Build background-image CSS custom properties by combining bgImageVars + bgGradientVars
    const bgImageVariable = layer.variables?.backgroundImage?.src;
    const staticImgVars = layer.design?.backgrounds?.bgImageVars;
    const staticGradVars = layer.design?.backgrounds?.bgGradientVars;
    const bgImageStyle: Record<string, string> = mergeStaticBgVars(staticImgVars, staticGradVars);

    // For dynamic sources (asset/CMS field), resolve URL and combine with any gradient
    if (bgImageVariable) {
      const bgImageUrl = getImageUrlFromVariable(
        bgImageVariable,
        getAsset,
        collectionLayerData,
        pageCollectionItemData
      );
      if (bgImageUrl) {
        const cssUrl = bgImageUrl.startsWith('url(') ? bgImageUrl : `url(${bgImageUrl})`;
        bgImageStyle['--bg-img'] = combineBgValues(cssUrl, staticGradVars?.['--bg-img']);
      }
    }

    // Extract CMS-bound gradient from resolved design styles so it routes through the CSS variable
    const resolvedGradient = resolvedDesignStyles?.background;
    const filteredDesignStyles = resolvedDesignStyles
      ? Object.fromEntries(Object.entries(resolvedDesignStyles).filter(([k]) => k !== 'background'))
      : resolvedDesignStyles;
    if (resolvedGradient?.includes('gradient(')) {
      bgImageStyle['--bg-img'] = combineBgValues(bgImageStyle['--bg-img']?.split(', ').find(v => v.startsWith('url(')) || staticImgVars?.['--bg-img'], resolvedGradient);
    }

    const mergedStyle = { ...parsedAttrStyle, ...filteredDesignStyles, ...bgImageStyle };

    const isEmpty = !textContent && (!children || children.length === 0);

    const combinedRef = (node: HTMLElement | null) => {
      if (isFilterLayer) {
        (filterLayerRef as React.MutableRefObject<HTMLDivElement | null>).current = node as HTMLDivElement | null;
      }
    };

    const elementProps: Record<string, unknown> = {
      ref: combinedRef,
      className: fullClassName,
      style: mergedStyle,
      'data-layer-id': layer.id,
      'data-layer-type': htmlTag,
      'data-is-empty': isEmpty ? 'true' : 'false',
      ...normalizedAttributes,
      suppressHydrationWarning: true,
    };

    // Apply link attributes for elements rendered as <a> (buttons with links or <a> layers)
    if (htmlTag === 'a' && layer.variables?.link) {
      if (isButtonWithLink) {
        elementProps.role = 'button';
        delete elementProps.type;
      }
      if (isValidLinkSettings(layer.variables.link)) {
        const linkAttrs = resolveLinkAttrs(layer.variables.link, layerLinkContext);
        if (linkAttrs) {
          Object.assign(elementProps, linkAttrs);
        } else if (isLinkAtCollectionBoundary(layer.variables.link, layerLinkContext)) {
          elementProps['aria-disabled'] = 'true';
          elementProps['data-link-disabled'] = 'true';
        }
      }
    }

    // Add data-gsap-hidden attribute for elements that should start hidden
    const hiddenInfo = hiddenLayerInfo?.find(info => info.layerId === layer.id);
    if (hiddenInfo) {
      elementProps['data-gsap-hidden'] = hiddenInfo.breakpoints || '';
    }

    // Hidden by default in public mode; form submission JS reveals on success/error.
    if (layer.alertType) {
      elementProps['data-alert-type'] = layer.alertType;
      const existingStyle = (typeof elementProps.style === 'object' && elementProps.style) || {};
      elementProps.style = { ...existingStyle, display: 'none' };
    }

    // Slider data attributes for production rendering (SliderInitializer)
    {
      if (layer.name === 'slider' && layer.settings?.slider) {
        elementProps['data-slider-id'] = layer.id;
        elementProps['data-slider-settings'] = JSON.stringify(layer.settings.slider);
      }
      if (SWIPER_DATA_ATTR_MAP[layer.name]) {
        elementProps[SWIPER_DATA_ATTR_MAP[layer.name]] = '';
      }

      // Lightbox data attributes (LightboxInitializer)
      if (layer.name === 'lightbox' && layer.settings?.lightbox) {
        const lbSettings = layer.settings.lightbox;
        elementProps['data-lightbox-id'] = lbSettings.groupId || layer.id;
        const { filesField: _ff, filesSource: _fs, ...runtimeSettings } = lbSettings;
        elementProps['data-lightbox-settings'] = JSON.stringify(runtimeSettings);
        const resolvedFiles = lbSettings.files
          .map((fileId: string) => {
            if (fileId.startsWith('http') || fileId.startsWith('/')) return fileId;
            return getAsset(fileId)?.public_url ?? null;
          })
          .filter(Boolean) as string[];
        if (resolvedFiles.length) {
          elementProps['data-lightbox-files'] = resolvedFiles.join(',');
        }
        if (lbSettings.groupId && resolvedFiles.length > 0) {
          elementProps['data-lightbox-open-to'] = resolvedFiles[0];
        }
      }
    }

    // Hide elements with hiddenGenerated: true by default (in all modes)
    if (layer.hiddenGenerated) {
      const existingStyle = typeof elementProps.style === 'object' ? elementProps.style : {};
      elementProps.style = { ...existingStyle, display: 'none' };
    }

    // Hide bullet pagination template until Swiper generates the real bullets
    if (layer.name === 'slideBullets') {
      const existingStyle = typeof elementProps.style === 'object' ? elementProps.style : {};
      elementProps.style = { ...existingStyle, visibility: 'hidden' as const };
    }

    // Apply custom ID from settings or attributes
    if (layer.settings?.id) {
      elementProps.id = layer.settings.id;
    } else if (layer.attributes?.id) {
      elementProps.id = layer.attributes.id;
    }

    // Apply custom attributes from settings
    if (layer.settings?.customAttributes) {
      Object.entries(layer.settings.customAttributes).forEach(([name, value]) => {
        elementProps[name] = value;
      });
    }

    // Select with placeholder: set defaultValue so React shows the placeholder option
    if (htmlTag === 'select' && !elementProps.value) {
      const hasPlaceholder = effectiveLayer.children?.some(
        (c) => c.name === 'option' && c.settings?.isPlaceholder
      );
      if (hasPlaceholder) {
        elementProps.defaultValue = '';
      }
    }

    if (htmlTag === 'img') {
      // Use default image if URL is empty or invalid
      const finalImageUrl = imageUrl && imageUrl.trim() !== '' ? imageUrl : DEFAULT_ASSETS.IMAGE;

      // Resolve intrinsic dimensions: explicit attributes > asset record > URL reverse-lookup.
      // Zero/invalid attribute values are ignored so the asset fallback still runs
      // (e.g. when a layer stores width="0" from an older bug or manual edit).
      let imgWidth: string | undefined = parseImageDimension(layer.attributes?.width as string | number | undefined)?.toString();
      let imgHeight: string | undefined = parseImageDimension(layer.attributes?.height as string | number | undefined)?.toString();

      if (!imgWidth || !imgHeight) {
        const assetId = isAssetVariable(imageVariable) ? getAssetId(imageVariable) : undefined;
        const asset = assetId ? getAsset(assetId) : undefined;
        if (asset && 'width' in asset && asset.width && !imgWidth) imgWidth = String(asset.width);
        if (asset && 'height' in asset && asset.height && !imgHeight) imgHeight = String(asset.height);

        // CMS images: field variable resolved to a URL — reverse-lookup asset by matching URL
        if ((!imgWidth || !imgHeight) && resolvedAssets && imageUrl) {
          for (const entry of Object.values(resolvedAssets)) {
            if (entry.url === imageUrl) {
              if (!imgWidth && entry.width) imgWidth = String(entry.width);
              if (!imgHeight && entry.height) imgHeight = String(entry.height);
              break;
            }
          }
        }
      }

      const isLcpCandidate = !!lcpCandidateLayerId && layer.id === lcpCandidateLayerId;
      const imgLoadingAttr = layer.attributes?.loading as string | undefined;
      // LCP candidate always loads eagerly with high fetchpriority — overrides
      // the image template's default `loading="lazy"`. Other images keep
      // whatever the user/template set.
      const effectiveLoading = isLcpCandidate ? 'eager' : imgLoadingAttr;

      const optimizedSrc = getOptimizedImageUrl(finalImageUrl, 1920, 85);

      // Prefer an explicit `sizes` attribute. Otherwise, if we have an
      // intrinsic pixel width, emit a media-aware sizes string so browsers
      // download a more appropriately sized variant on desktop. Falls back
      // to `100vw` when width is unknown.
      const explicitSizes = (layer.attributes?.sizes as string | undefined)?.trim();
      const intrinsicWidth = parseImageDimension(imgWidth);
      const intrinsicHeight = parseImageDimension(imgHeight);
      const sizes = explicitSizes || buildImageSizes(intrinsicWidth);

      // Pass intrinsic width so srcset descriptors don't exceed the source's
      // natural size (the proxy won't upscale; mismatched descriptors break
      // browser intrinsic-dimension math and shrink the rendered image).
      const srcset = generateImageSrcset(finalImageUrl, undefined, undefined, intrinsicWidth);

      const imageProps: Record<string, any> = {
        ...elementProps,
        alt: imageAlt,
        src: optimizedSrc,
        decoding: 'async',
      };

      // Set only positive intrinsic values; otherwise drop any `width="0"`/
      // `height="0"` that leaked in via normalizedAttributes.
      if (intrinsicWidth) imageProps.width = intrinsicWidth;
      else delete imageProps.width;
      if (intrinsicHeight) imageProps.height = intrinsicHeight;
      else delete imageProps.height;
      if (effectiveLoading) imageProps.loading = effectiveLoading;
      if (isLcpCandidate) imageProps.fetchPriority = 'high';

      if (srcset) {
        imageProps.srcSet = srcset;
        imageProps.sizes = sizes;
      }

      return (
        <Tag {...imageProps} />
      );
    }

    if (htmlTag === 'hr' || htmlTag === 'br') {
      return <Tag {...elementProps} />;
    }

    if (htmlTag === 'input') {
      // Auto-set name attribute for form inputs if not already set
      if (isInsideForm && !elementProps.name) {
        elementProps.name = layer.settings?.id || layer.id;
      }
      // Checkbox/radio: set value="true" so FormData gets name=true when checked
      if (isInsideForm && (normalizedAttributes.type === 'checkbox' || normalizedAttributes.type === 'radio')) {
        if (!elementProps.value) {
          elementProps.value = 'true';
        }
      }
      // Use defaultValue instead of value to keep inputs uncontrolled
      // This allows users to type in preview/published mode and avoids
      // React's "uncontrolled to controlled" warning when value is added later
      if ('value' in elementProps && normalizedAttributes.type !== 'checkbox' && normalizedAttributes.type !== 'radio') {
        elementProps.defaultValue = elementProps.value;
        delete elementProps.value;
      }
      if ('checked' in elementProps) {
        elementProps.defaultChecked = elementProps.checked;
        delete elementProps.checked;
      }
      return <Tag {...elementProps} />;
    }

    // Handle textarea - auto-set name for form submission and return early (no children)
    if (htmlTag === 'textarea') {
      if (isInsideForm && !elementProps.name) {
        elementProps.name = layer.settings?.id || layer.id;
      }
      // Use defaultValue instead of value to keep textareas uncontrolled
      if ('value' in elementProps) {
        elementProps.defaultValue = elementProps.value;
        delete elementProps.value;
      }
      return <Tag {...elementProps} />;
    }

    // Handle select - auto-set name for form submission
    if (htmlTag === 'select') {
      if (isInsideForm && !elementProps.name) {
        elementProps.name = layer.settings?.id || layer.id;
      }

      if ('value' in elementProps) {
        elementProps.defaultValue = elementProps.value;
        delete elementProps.value;
      }
    }

    const SocialLogin = dynamic(() => import('@/components/layers/SocialLogin'));

    // ... existing code ...

    // Special handling for social login component
    if (layer.name === 'social_login' || (layer.name === 'button' && layer.settings?.auth?.type === 'social')) {
      const provider = layer.settings?.auth?.provider || 'google';
      
      return (
        <SocialLogin
          provider={provider}
          className={fullClassName}
          style={mergedStyle}
        />
      );
    }

    if (htmlTag === 'form') {
      const formId = layer.settings?.id;
      const formSettings = layer.settings?.form;
      const isPasswordForm = formSettings?.form_type === 'password_protected';

      elementProps.onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        const form = e.currentTarget;

        // Password-protected forms gate access to locked pages via /api/page-auth/verify.
        // The standard /ycode/api/form-submissions path is skipped entirely.
        if (isPasswordForm) {
          const passwordInput =
            form.querySelector<HTMLInputElement>('input[type="password"][name="password"]')
            || form.querySelector<HTMLInputElement>('input[name="password"]')
            || form.querySelector<HTMLInputElement>('input[type="password"]');
          const submittedPassword = passwordInput?.value ?? '';

          const errorAlert = form.querySelector('[data-alert-type="error"]') as HTMLElement | null;
          const successAlert = form.querySelector('[data-alert-type="success"]') as HTMLElement | null;
          if (errorAlert) errorAlert.style.display = 'none';
          if (successAlert) successAlert.style.display = 'none';

          try {
            const response = await fetch('/api/page-auth/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                pageId: passwordProtection?.pageId,
                folderId: passwordProtection?.folderId,
                password: submittedPassword,
                redirectUrl: passwordProtection?.redirectUrl
                  ?? (typeof window !== 'undefined' ? window.location.pathname : '/'),
                isPublished: passwordProtection?.isPublished ?? true,
              }),
            });

            const data = await response.json().catch(() => ({}));

            if (response.ok) {
              const target = data?.redirectUrl;
              if (target && typeof window !== 'undefined') {
                window.location.href = target;
              } else if (typeof window !== 'undefined') {
                window.location.reload();
              }
              return;
            }

            if (errorAlert) errorAlert.style.display = '';
            if (passwordInput) passwordInput.value = '';
          } catch (error) {
            console.error('Password verification error:', error);
            if (errorAlert) errorAlert.style.display = '';
          }
          return;
        }

        const formData = new FormData(form);
        const payload: Record<string, any> = {};

        // Convert FormData to object
        formData.forEach((value, key) => {
          // Handle multiple values (e.g., checkboxes with same name)
          if (payload[key]) {
            if (Array.isArray(payload[key])) {
              payload[key].push(value);
            } else {
              payload[key] = [payload[key], value];
            }
          } else {
            payload[key] = value;
          }
        });

        // Resolve select values to display text instead of raw IDs
        const selects = form.querySelectorAll('select[name]');
        selects.forEach((sel) => {
          const select = sel as HTMLSelectElement;
          if (select.name && select.selectedIndex >= 0) {
            const selectedOption = select.options[select.selectedIndex];
            if (selectedOption && selectedOption.value && selectedOption.text && selectedOption.value !== selectedOption.text) {
              payload[select.name] = selectedOption.text;
            }
          }
        });

        // Resolve checkbox/radio values to display text instead of raw IDs
        form.querySelectorAll('input[type="checkbox"]:checked, input[type="radio"]:checked').forEach((el) => {
          const input = el as HTMLInputElement;
          if (!input.name || !input.value) return;
          const parent = input.closest('label') || input.parentElement;
          if (!parent) return;
          const labelText = Array.from(parent.children)
            .filter((n) => n !== input && n.tagName !== 'INPUT')
            .map((n) => n.textContent?.trim())
            .filter(Boolean)
            .join(' ')
            .trim();
          if (labelText && labelText !== input.value) {
            const currentVal = payload[input.name];
            if (Array.isArray(currentVal)) {
              const idx = currentVal.indexOf(input.value);
              if (idx >= 0) currentVal[idx] = labelText;
            } else if (currentVal === input.value) {
              payload[input.name] = labelText;
            }
          }
        });

        // Handle unchecked checkboxes - they aren't included in FormData
        // Set them to "false" so the submission shows name = false
        const checkboxes = form.querySelectorAll('input[type="checkbox"][name]');
        checkboxes.forEach((cb) => {
          const checkbox = cb as HTMLInputElement;
          if (checkbox.name && !(checkbox.name in payload)) {
            payload[checkbox.name] = 'false';
          }
        });

        try {
          const response = await fetch('/ycode/api/form-submissions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              form_id: formId || 'unnamed-form',
              payload,
              metadata: {
                page_url: typeof window !== 'undefined' ? window.location.href : undefined,
              },
              email: formSettings?.email_notification,
            }),
          });

          const result = await response.json();

          // Find alert elements within the form
          const errorAlert = form.querySelector('[data-alert-type="error"]') as HTMLElement | null;
          const successAlert = form.querySelector('[data-alert-type="success"]') as HTMLElement | null;

          // Hide both alerts first
          if (errorAlert) errorAlert.style.display = 'none';
          if (successAlert) successAlert.style.display = 'none';

          if (response.ok) {
            // Success handling
            const successAction = formSettings?.success_action || 'message';

            if (successAction === 'redirect' && formSettings?.redirect_url) {
              // Resolve link settings to actual URL
              const redirectHref = generateLinkHref(formSettings.redirect_url, {
                pages,
                folders,
                collectionItemSlugs,
                isPreview,
                locale: currentLocale,
                translations,
                getAsset,
                anchorMap,
                resolvedAssets,
              });
              if (redirectHref) {
                window.location.href = redirectHref;
              }
            } else {
              // Show success alert
              if (successAlert) {
                successAlert.style.display = '';
              }
            }
            // Reset the form
            form.reset();
          } else {
            // Error handling - show error alert
            if (errorAlert) {
              errorAlert.style.display = '';
            }
          }
        } catch (error) {
          console.error('Form submission error:', error);
          // Show error alert on catch
          const errorAlert = form.querySelector('[data-alert-type="error"]') as HTMLElement | null;
          if (errorAlert) {
            errorAlert.style.display = '';
          }
        }
      };
    }

    // Handle icon layers (check layer.name, not htmlTag since settings.tag might be 'div')
    if (layer.name === 'icon') {
      const iconSrc = effectiveLayer.variables?.icon?.src;
      let iconHtml = '';

      if (iconSrc) {
        if (isStaticTextVariable(iconSrc)) {
          iconHtml = getStaticTextContent(iconSrc);
        } else if (isDynamicTextVariable(iconSrc)) {
          iconHtml = getDynamicTextContent(iconSrc);
        } else if (isAssetVariable(iconSrc)) {
          const originalAssetId = iconSrc.data?.asset_id;
          if (originalAssetId) {
            // Apply translation if available
            const translatedAssetId = getTranslatedAssetId(
              originalAssetId,
              `layer:${layer.id}:icon_src`,
              translations,
              pageId,
              layer._masterComponentId
            );
            const assetId = translatedAssetId || originalAssetId;

            const asset = getAsset(assetId);
            iconHtml = asset?.content || '';
          }
        } else if (isFieldVariable(iconSrc)) {
          const resolvedValue = resolveFieldValue(iconSrc, collectionLayerData, pageCollectionItemData, effectiveLayerDataMap);
          if (resolvedValue && typeof resolvedValue === 'string') {
            const asset = getAsset(resolvedValue);
            iconHtml = asset?.content || resolvedValue;
          }
        }
      }

      // If no valid icon content, show default icon
      if (!iconHtml || iconHtml.trim() === '') {
        iconHtml = DEFAULT_ASSETS.ICON;
      }

      return (
        <Tag
          {...elementProps}
          data-icon="true"
          dangerouslySetInnerHTML={{ __html: iconHtml }}
        />
      );
    }

    // Handle Code Embed layers - Framer-style iframe isolation
    if (layer.name === 'htmlEmbed') {
      return (
        <iframe
          ref={htmlEmbedIframeRef}
          data-layer-id={layer.id}
          data-layer-type="htmlEmbed"
          data-html-embed="true"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          className={fullClassName}
          style={{
            width: '100%',
            border: 'none',
            display: 'block',
            ...mergedStyle,
          }}
          title={`Code Embed ${layer.id}`}
        />
      );
    }

    // Handle Map layers — provider-aware iframe
    if (layer.name === 'map') {
      const mapSettings = { ...DEFAULT_MAP_SETTINGS, ...layer.settings?.map,
        mapbox: { ...DEFAULT_MAP_SETTINGS.mapbox, ...layer.settings?.map?.mapbox },
        google: { ...DEFAULT_MAP_SETTINGS.google, ...layer.settings?.map?.google },
      };
      const provider = mapSettings.provider;
      const tokenKey = provider === 'google' ? 'google_maps_embed_api_key' : 'mapbox_access_token';
      const mapToken = serverSettings?.[tokenKey] as string | undefined;

      if (!mapToken) {
        const label = provider === 'google' ? 'Google Map API key' : 'Mapbox token';
        return (
          <div
            data-layer-id={layer.id}
            data-layer-type="map"
            className={fullClassName}
            style={mergedStyle}
          >
            <div className="flex items-center justify-center h-full bg-muted text-muted-foreground text-xs">
              {label} not configured
            </div>
          </div>
        );
      }

      const resolvedSettings = {
        ...mapSettings,
        markerColor: resolveMarkerColor(mapSettings.markerColor, colorVariables as any),
      };
      const iframeProps = getMapIframeProps(resolvedSettings, mapToken);

      return (
        <div
          data-layer-id={layer.id}
          data-layer-type="map"
          className={fullClassName}
          style={mergedStyle}
        >
          <iframe
            {...(iframeProps.type === 'src'
              ? { src: iframeProps.src, referrerPolicy: 'no-referrer-when-downgrade' as const }
              : { srcDoc: iframeProps.srcDoc, sandbox: 'allow-scripts allow-same-origin' }
            )}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              display: 'block',
            }}
            title="Map"
            suppressHydrationWarning
          />
        </div>
      );
    }

    if (htmlTag === 'video' || htmlTag === 'audio') {
      // Check if this is a YouTube video (VideoVariable type)
      if (htmlTag === 'video' && effectiveLayer.variables?.video?.src) {
        const videoSrc = effectiveLayer.variables.video.src;

        // YouTube video - render as iframe
        if (videoSrc.type === 'video' && 'provider' in videoSrc.data && videoSrc.data.provider === 'youtube') {
          const rawVideoId = videoSrc.data.video_id || '';
          // Resolve inline variables in video ID (supports CMS binding)
          const videoId = resolveInlineVariablesFromData(rawVideoId, collectionLayerData, pageCollectionItemData, timezone, effectiveLayerDataMap);
          // Use normalized attributes for consistency (already handles string/boolean conversion)
          const privacyMode = normalizedAttributes?.youtubePrivacyMode === true;
          const domain = privacyMode ? 'youtube-nocookie.com' : 'youtube.com';

          // Build YouTube embed URL with parameters
          const params: string[] = [];
          if (normalizedAttributes?.autoplay === true) params.push('autoplay=1');
          if (normalizedAttributes?.muted === true) params.push('mute=1');
          if (normalizedAttributes?.loop === true) params.push(`loop=1&playlist=${videoId}`);
          if (normalizedAttributes?.controls !== true) params.push('controls=0');

          const embedUrl = `https://www.${domain}/embed/${videoId}${params.length > 0 ? '?' + params.join('&') : ''}`;

          // Create iframe props - only include essential props to avoid hydration mismatches
          // Don't spread elementProps as it may contain client-only handlers
          const iframeProps: Record<string, any> = {
            'data-layer-id': layer.id,
            'data-layer-type': 'video',
            className: fullClassName,
            style: mergedStyle,
            src: embedUrl,
            frameBorder: '0',
            allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
            allowFullScreen: true,
          };

          // Apply custom ID from attributes
          if (layer.attributes?.id) {
            iframeProps.id = layer.attributes.id;
          }

          // Apply custom attributes from settings
          if (layer.settings?.customAttributes) {
            Object.entries(layer.settings.customAttributes).forEach(([name, value]) => {
              iframeProps[name] = value;
            });
          }

          return (
            <iframe key={`youtube-${layer.id}-${videoId}`} {...iframeProps} />
          );
        }
      }

      // Regular video/audio - render as media element
      const mediaSrc = (() => {
        if (htmlTag === 'video' && effectiveLayer.variables?.video?.src) {
          const src = effectiveLayer.variables.video.src;
          // Skip VideoVariable type (already handled above as YouTube iframe)
          if (src.type === 'video') {
            return undefined;
          }

          // Apply translation for video asset
          let videoVariable = src;
          if (src.type === 'asset' && src.data?.asset_id) {
            const originalAssetId = src.data.asset_id;
            const translatedAssetId = getTranslatedAssetId(
              originalAssetId,
              `layer:${layer.id}:video_src`,
              translations,
              pageId,
              layer._masterComponentId
            );
            if (translatedAssetId && translatedAssetId !== originalAssetId) {
              videoVariable = { ...src, data: { asset_id: translatedAssetId } };
            }
          }

          return getVideoUrlFromVariable(
            videoVariable,
            getAsset,
            collectionLayerData,
            pageCollectionItemData
          );
        }
        if (htmlTag === 'audio' && effectiveLayer.variables?.audio?.src) {
          const src = effectiveLayer.variables.audio.src;

          // Apply translation for audio asset
          let audioVariable = src;
          if (src.type === 'asset' && src.data?.asset_id) {
            const originalAssetId = src.data.asset_id;
            const translatedAssetId = getTranslatedAssetId(
              originalAssetId,
              `layer:${layer.id}:audio_src`,
              translations,
              pageId,
              layer._masterComponentId
            );
            if (translatedAssetId && translatedAssetId !== originalAssetId) {
              audioVariable = { ...src, data: { asset_id: translatedAssetId } };
            }
          }

          return getVideoUrlFromVariable(
            audioVariable,
            getAsset,
            collectionLayerData,
            pageCollectionItemData
          );
        }
        return imageUrl || undefined;
      })();

      // Get poster URL for video elements
      const posterUrl = (() => {
        if (htmlTag === 'video' && effectiveLayer.variables?.video?.poster) {
          // Apply translation for video poster
          let posterVariable = effectiveLayer.variables.video.poster;
          if (posterVariable?.type === 'asset' && posterVariable.data?.asset_id) {
            const originalAssetId = posterVariable.data.asset_id;
            const translatedAssetId = getTranslatedAssetId(
              originalAssetId,
              `layer:${layer.id}:video_poster`,
              translations,
              pageId,
              layer._masterComponentId
            );
            if (translatedAssetId && translatedAssetId !== originalAssetId) {
              posterVariable = { ...posterVariable, data: { asset_id: translatedAssetId } };
            }
          }

          return getImageUrlFromVariable(
            posterVariable,
            getAsset,
            collectionLayerData,
            pageCollectionItemData
          );
        }
        return undefined;
      })();

      // Always render media element, even without src (for published pages)
      // Only set src attribute if we have a valid URL
      const mediaProps: Record<string, any> = {
        ...elementProps,
        ...normalizedAttributes,
      };

      // React treats autoPlay as a DOM property, not an HTML attribute,
      // so it won't survive SSR or hydration. Remove from props and
      // apply via ref to avoid both the warning and the rendering issue.
      const shouldAutoPlay = mediaProps.autoplay === true;
      delete mediaProps.autoplay;

      if (mediaSrc) {
        mediaProps.src = mediaSrc;
      }

      if (posterUrl && htmlTag === 'video') {
        mediaProps.poster = posterUrl;
      }

      // Handle special attributes that need to be set on the DOM element
      // (autoplay and volume must be set via JavaScript on the DOM element)
      if (htmlTag === 'audio' || htmlTag === 'video') {
        const originalRef = mediaProps.ref;
        const volumeValue = normalizedAttributes?.volume
          ? parseInt(normalizedAttributes.volume) / 100
          : undefined;

        if (shouldAutoPlay || volumeValue !== undefined) {
          mediaProps.ref = (element: HTMLAudioElement | HTMLVideoElement | null) => {
            if (originalRef) {
              if (typeof originalRef === 'function') {
                originalRef(element);
              } else {
                (originalRef as React.MutableRefObject<HTMLAudioElement | HTMLVideoElement | null>).current = element;
              }
            }

            if (element) {
              if (shouldAutoPlay) {
                element.autoplay = true;
                element.setAttribute('autoplay', '');
                element.play().catch(() => {});
              }
              if (volumeValue !== undefined) {
                element.volume = volumeValue;
              }
            }
          };
        }
      }

      return (
        <Tag {...mediaProps}>
          {textContent && textContent}
          {effectiveChildren && effectiveChildren.length > 0 && (
            <LayerRendererPublic
              layers={effectiveChildren}
              isPublished={isPublished}
              pageId={pageId}
              collectionItemData={collectionLayerData}
              collectionItemId={collectionLayerItemId}
              layerDataMap={effectiveLayerDataMap}
              pageCollectionItemId={pageCollectionItemId}
              pageCollectionItemData={pageCollectionItemData}
              pageCollectionSortedItemIds={pageCollectionSortedItemIds}
              pages={pages}
              folders={folders}
              collectionItemSlugs={collectionItemSlugs}
              isPreview={isPreview}
              translations={translations}
              anchorMap={anchorMap}
              resolvedAssets={resolvedAssets}
              hiddenLayerInfo={hiddenLayerInfo}
              currentLocale={currentLocale}
              availableLocales={availableLocales}
              localeSelectorFormat={localeSelectorFormat}
              isInsideForm={isInsideForm}
              isInsideLink={isInsideLink}
              parentFormSettings={parentFormSettings}
              components={componentsProp}
              ancestorComponentIds={effectiveAncestorIds}
              isSlideChild={layer.name === 'slides'}
              serverSettings={serverSettings}
              lcpCandidateLayerId={lcpCandidateLayerId}
            />
          )}
        </Tag>
      );
    }

    if (htmlTag === 'iframe') {
      const iframeSrc = getIframeUrlFromVariable(layer.variables?.iframe?.src) || (normalizedAttributes as Record<string, string>).src || undefined;

      // Don't render iframe if no src (prevents empty src warning)
      if (!iframeSrc) {
        return null;
      }

      return (
        <Tag
          {...elementProps}
          src={iframeSrc}
        />
      );
    }

    // Special handling for locale selector wrapper (name='localeSelector')
    if (layer.name === 'localeSelector' && availableLocales && availableLocales.length > 0) {
      // Extract current page slug from URL (LocaleSelector handles this internally)
      const currentPageSlug = typeof window !== 'undefined'
        ? window.location.pathname.slice(1).replace(/^ycode\/preview\/?/, '')
        : '';

      // Get format setting from this layer to pass to children
      const format = layer.settings?.locale?.format || 'locale';

      return (
        <Tag {...elementProps} style={mergedStyle}>
          {textContent && textContent}

          {effectiveChildren && effectiveChildren.length > 0 && (
            <LayerRendererPublic
              layers={effectiveChildren}
              {...sharedRendererProps}
              localeSelectorFormat={format}
              isInsideForm={isInsideForm || htmlTag === 'form'}
              isInsideLink={isInsideLink || htmlTag === 'a'}
              parentFormSettings={htmlTag === 'form' ? layer.settings?.form : parentFormSettings}
              ancestorComponentIds={effectiveAncestorIds}
            />
          )}

          {/* Locale selector overlay */}
          <LocaleSelector
            currentLocale={currentLocale}
            availableLocales={availableLocales}
            currentPageSlug={currentPageSlug}
            isPublished={isPublished}
          />
        </Tag>
      );
    }

    // Special handling for auth form (name='auth_form')
    if (layer.name === 'auth_form') {
      const authType = layer.settings?.auth?.type || 'login';

      return (
        <AuthForm
          type={authType as 'login' | 'register'}
          className={fullClassName}
          style={mergedStyle}
          layerId={layer.id}
          redirectUrl={layer.settings?.auth?.redirectUrl}
        >
          {effectiveChildren && effectiveChildren.length > 0 && (
            <LayerRendererPublic
              layers={effectiveChildren}
              {...sharedRendererProps}
              isInsideForm={true}
              ancestorComponentIds={effectiveAncestorIds}
            />
          )}
        </AuthForm>
      );
    }

    // Special handling for User Status component
    if (layer.name === 'user_status') {
      const loginUrl = layer.settings?.auth?.loginUrl || '/login';
      const profileLinks = layer.settings?.auth?.profileLinks || [];

      return (
        <UserStatus
          className={fullClassName}
          style={mergedStyle}
          loginUrl={loginUrl}
          profileLinks={profileLinks}
        />
      );
    }

    // Collection layers are handled by the server (flattened into _fragments).
    // If a collection layer is still here without an item ID, it's a template - don't render it.
    if (getCollectionVariable(layer) && !layer._collectionItemId) {
      return null;
    }

    // Regular elements with text and/or children
    return (
      <Tag {...elementProps}>
        {textContent && textContent}

        {effectiveChildren && effectiveChildren.length > 0 && (
          <LayerRendererPublic
            layers={effectiveChildren}
            {...sharedRendererProps}
            isInsideForm={isInsideForm || htmlTag === 'form'}
            isInsideLink={isInsideLink || htmlTag === 'a'}
            parentFormSettings={htmlTag === 'form' ? layer.settings?.form : parentFormSettings}
            ancestorComponentIds={effectiveAncestorIds}
            isSlideChild={layer.name === 'slides'}
          />
        )}
      </Tag>
    );
  };

  let content = renderContent();

  // Mount filter behavior alongside the rendered filter container. The
  // dynamic chunk attaches DOM listeners to `filterLayerRef.current` once
  // hydrated; ref assignment runs before the dynamic effect, so timing is fine.
  if (isFilterLayer) {
    content = (
      <>
        {content}
        <FilterLayerBehavior
          containerRef={filterLayerRef}
          filterLayerId={layer.id}
          filterOnChange={filterOnChange}
        />
      </>
    );
  }

  // Wrap with link if layer has link settings
  // Skip for buttons/divs — they render as <a> directly (see isButtonWithLink, isDivWithLink)
  // Skip for <a> layers — they already render as <a> and nesting <a> inside <a> is invalid HTML
  const linkSettings = layer.variables?.link;
  const shouldWrapWithLink = !isButtonWithLink
    && !isDivWithLink
    && !isInsideLink
    && htmlTag !== 'a'
    && !subtreeHasInteractiveDescendants
    && isValidLinkSettings(linkSettings);

  if (shouldWrapWithLink && linkSettings) {
    const linkAttrs = resolveLinkAttrs(linkSettings, layerLinkContext);
    if (linkAttrs) {
      content = (
        <a
          {...linkAttrs}
          className="contents"
        >
          {content}
        </a>
      );
    } else if (isLinkAtCollectionBoundary(linkSettings, layerLinkContext)) {
      content = (
        <a
          aria-disabled="true"
          data-link-disabled="true"
          className="contents"
        >
          {content}
        </a>
      );
    }
  }

  return content;
};

export default LayerRendererPublic;
