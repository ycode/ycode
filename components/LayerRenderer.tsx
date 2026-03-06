'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import LayerLockIndicator from '@/components/collaboration/LayerLockIndicator';
import EditingIndicator from '@/components/collaboration/EditingIndicator';
import { useCollaborationPresenceStore, getResourceLockKey, RESOURCE_TYPES } from '@/stores/useCollaborationPresenceStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useLocalisationStore } from '@/stores/useLocalisationStore';
import type { Layer, Locale, ComponentVariable, FormSettings, LinkSettings, Breakpoint, CollectionItemWithValues, Component } from '@/types';
import type { UseLiveLayerUpdatesReturn } from '@/hooks/use-live-layer-updates';
import type { UseLiveComponentUpdatesReturn } from '@/hooks/use-live-component-updates';
import { getLayerHtmlTag, getClassesString, getText, resolveFieldValue, isTextEditable, getCollectionVariable, evaluateVisibility, findAncestorByName, filterDisabledSliderLayers } from '@/lib/layer-utils';
import { SWIPER_CLASS_MAP, SWIPER_DATA_ATTR_MAP } from '@/lib/templates/utilities';
import { useCanvasSlider } from '@/hooks/use-canvas-slider';
import { resolveFieldFromSources } from '@/lib/cms-variables-utils';
import { getDynamicTextContent, getImageUrlFromVariable, getVideoUrlFromVariable, getIframeUrlFromVariable, isFieldVariable, isAssetVariable, isStaticTextVariable, isDynamicTextVariable, getAssetId, getStaticTextContent, createAssetVariable, createDynamicTextVariable, resolveDesignStyles } from '@/lib/variable-utils';
import { getTranslatedAssetId, getTranslatedText } from '@/lib/localisation-utils';
import { isValidLinkSettings } from '@/lib/link-utils';
import { DEFAULT_ASSETS, ASSET_CATEGORIES, isAssetOfType } from '@/lib/asset-utils';
import { parseMultiAssetFieldValue, buildAssetVirtualValues } from '@/lib/multi-asset-utils';
import { parseMultiReferenceValue, resolveReferenceFieldsSync } from '@/lib/collection-utils';
import { MULTI_ASSET_COLLECTION_ID } from '@/lib/collection-field-utils';
import { generateImageSrcset, getImageSizes, getOptimizedImageUrl } from '@/lib/asset-utils';
import { useEditorStore } from '@/stores/useEditorStore';
import { toast } from 'sonner';
import { resolveInlineVariablesFromData } from '@/lib/inline-variables';
import { renderRichText, hasBlockElementsWithInlineVariables, getTextStyleClasses, type RichTextLinkContext, type RenderComponentBlockFn } from '@/lib/text-format-utils';
import { hasComponentOrVariable } from '@/lib/tiptap-utils';
import LayerContextMenu from '@/app/ycode/components/LayerContextMenu';
import CanvasTextEditor from '@/app/ycode/components/CanvasTextEditor';
import { useComponentsStore } from '@/stores/useComponentsStore';
import { useCollectionLayerStore } from '@/stores/useCollectionLayerStore';
import { useFilterStore } from '@/stores/useFilterStore';
import { useCollectionsStore } from '@/stores/useCollectionsStore';
import { useAssetsStore } from '@/stores/useAssetsStore';
import { ShimmerSkeleton } from '@/components/ui/shimmer-skeleton';
import { combineBgValues, mergeStaticBgVars } from '@/lib/tailwind-class-mapper';
import { clsx } from 'clsx';
import PaginatedCollection from '@/components/PaginatedCollection';
import LoadMoreCollection from '@/components/LoadMoreCollection';
import FilterableCollection from '@/components/FilterableCollection';
import LocaleSelector from '@/components/layers/LocaleSelector';
import { usePagesStore } from '@/stores/usePagesStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { generateLinkHref, type LinkResolutionContext } from '@/lib/link-utils';
import type { HiddenLayerInfo } from '@/lib/animation-utils';
import AnimationInitializer from '@/components/AnimationInitializer';
import { transformLayerIdsForInstance, resolveVariableLinks } from '@/lib/resolve-components';

import type { DesignColorVariable } from '@/types';

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

interface LayerRendererProps {
  layers: Layer[];
  onLayerClick?: (layerId: string, event?: React.MouseEvent) => void;
  onLayerUpdate?: (layerId: string, updates: Partial<Layer>) => void;
  onLayerHover?: (layerId: string | null) => void; // Callback for hover state changes
  selectedLayerId?: string | null;
  hoveredLayerId?: string | null; // Externally controlled hover state
  isEditMode?: boolean;
  isPublished?: boolean;
  enableDragDrop?: boolean;
  activeLayerId?: string | null;
  projected?: { depth: number; parentId: string | null } | null;
  pageId?: string;
  collectionItemData?: Record<string, string>; // Merged collection layer item data (field_id -> value)
  collectionItemId?: string; // The ID of the current collection layer item being rendered
  layerDataMap?: Record<string, Record<string, string>>; // Map of collection layer ID -> item data for layer-specific resolution
  pageCollectionItemId?: string; // The ID of the page's collection item (for dynamic pages)
  pageCollectionItemData?: Record<string, string> | null; // Page's collection item data (for dynamic pages)
  hiddenLayerInfo?: HiddenLayerInfo[]; // Layer IDs with breakpoint info for animations
  editorHiddenLayerIds?: Map<string, Breakpoint[]>; // Layer IDs to hide on canvas (edit mode only) with breakpoint info
  editorBreakpoint?: Breakpoint; // Current breakpoint in editor
  currentLocale?: Locale | null;
  availableLocales?: Locale[];
  localeSelectorFormat?: 'locale' | 'code'; // Format for locale selector label (inherited from parent)
  liveLayerUpdates?: UseLiveLayerUpdatesReturn | null; // For collaboration broadcasts
  liveComponentUpdates?: UseLiveComponentUpdatesReturn | null; // For component collaboration broadcasts
  parentComponentLayerId?: string; // ID of the parent component layer (if rendering inside a component)
  parentComponentOverrides?: Layer['componentOverrides']; // Override values from parent component instance
  parentComponentVariables?: ComponentVariable[]; // Component's variables for default value lookup
  editingComponentVariables?: ComponentVariable[]; // Variables when directly editing a component
  isInsideForm?: boolean; // Whether this layer is inside a form (for button type handling)
  parentFormSettings?: FormSettings; // Form settings from parent form layer
  pages?: any[]; // Pages for link resolution
  folders?: any[]; // Folders for link resolution
  collectionItemSlugs?: Record<string, string>; // Maps collection_item_id -> slug value for link resolution
  isPreview?: boolean; // Whether we're in preview mode (prefix links with /ycode/preview)
  translations?: Record<string, any> | null; // Translations for localized URL generation
  anchorMap?: Record<string, string>; // Pre-built map of layerId -> anchor value for O(1) lookups
  /** Pre-resolved asset URLs (asset_id -> public_url) for SSR link resolution */
  resolvedAssets?: Record<string, string>;
  /** Components for resolving embedded component nodes in rich-text (preview/published) */
  components?: Component[];
  /** Component IDs in the rendering chain, used to prevent circular loops through collection rich-text data */
  ancestorComponentIds?: Set<string>;
}

const LayerRenderer: React.FC<LayerRendererProps> = ({
  layers,
  onLayerClick,
  onLayerUpdate,
  onLayerHover,
  selectedLayerId,
  hoveredLayerId,
  isEditMode = true,
  isPublished = false,
  enableDragDrop = false,
  activeLayerId = null,
  projected = null,
  pageId = '',
  collectionItemData,
  collectionItemId,
  layerDataMap,
  pageCollectionItemId,
  pageCollectionItemData,
  collectionItemSlugs,
  hiddenLayerInfo,
  editorHiddenLayerIds,
  editorBreakpoint,
  currentLocale,
  availableLocales = [],
  localeSelectorFormat,
  liveLayerUpdates,
  liveComponentUpdates,
  parentComponentLayerId,
  parentComponentOverrides,
  parentComponentVariables,
  editingComponentVariables,
  isInsideForm = false,
  parentFormSettings,
  pages: pagesProp,
  folders: foldersProp,
  isPreview = false,
  translations,
  anchorMap: anchorMapProp,
  resolvedAssets,
  components: componentsProp,
  ancestorComponentIds,
}) => {
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState<string>('');
  const [editingClickCoords, setEditingClickCoords] = useState<{ x: number; y: number } | null>(null);

  // Get pages and folders for link resolution
  // Use props if provided (SSR/preview), otherwise use store (editor)
  const storePages = usePagesStore((state) => state.pages);
  const storeFolders = usePagesStore((state) => state.folders);
  const pages = pagesProp || storePages;
  const folders = foldersProp || storeFolders;

  // Build anchor map once at top level for O(1) anchor resolution
  // Use prop if provided (recursive calls), otherwise build from layers
  const anchorMap = useMemo(() => {
    return anchorMapProp || buildAnchorMap(layers);
  }, [anchorMapProp, layers]);

  // Helper to render a layer or unwrap fragments
  const renderLayer = (layer: Layer): React.ReactNode => {
    // Fragment layers: render children directly without wrapper element
    if (layer.name === '_fragment' && layer.children) {
      const renderedChildren = layer.children.map((child: Layer) => renderLayer(child));

      const originalLayerId = layer.id.replace(/-fragment$/, '');
      const hasFilter = layer._filterConfig && !isEditMode;
      const hasPagination = layer._paginationMeta && isPublished;

      if (hasPagination || hasFilter) {
        let content: React.ReactNode = renderedChildren;

        // Inner layer: pagination wraps the SSR items
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

        // Outer layer: FilterableCollection swaps content when filters are active
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
        isEditMode={isEditMode}
        isPublished={isPublished}
        enableDragDrop={enableDragDrop}
        selectedLayerId={selectedLayerId}
        hoveredLayerId={hoveredLayerId}
        activeLayerId={activeLayerId}
        projected={projected}
        onLayerClick={onLayerClick}
        onLayerUpdate={onLayerUpdate}
        onLayerHover={onLayerHover}
        editingLayerId={editingLayerId}
        setEditingLayerId={setEditingLayerId}
        editingContent={editingContent}
        setEditingContent={setEditingContent}
        editingClickCoords={editingClickCoords}
        setEditingClickCoords={setEditingClickCoords}
        pageId={pageId}
        collectionItemData={collectionItemData}
        collectionItemId={collectionItemId}
        layerDataMap={layerDataMap}
        pageCollectionItemId={pageCollectionItemId}
        pageCollectionItemData={pageCollectionItemData}
        hiddenLayerInfo={hiddenLayerInfo}
        editorHiddenLayerIds={editorHiddenLayerIds}
        editorBreakpoint={editorBreakpoint}
        currentLocale={currentLocale}
        availableLocales={availableLocales}
        localeSelectorFormat={localeSelectorFormat}
        liveLayerUpdates={liveLayerUpdates}
        liveComponentUpdates={liveComponentUpdates}
        parentComponentLayerId={parentComponentLayerId}
        parentComponentOverrides={parentComponentOverrides}
        parentComponentVariables={parentComponentVariables}
        editingComponentVariables={editingComponentVariables}
        isInsideForm={isInsideForm}
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
  isEditMode: boolean;
  isPublished: boolean;
  enableDragDrop: boolean;
  selectedLayerId?: string | null;
  hoveredLayerId?: string | null;
  activeLayerId?: string | null;
  projected?: { depth: number; parentId: string | null } | null;
  onLayerClick?: (layerId: string, event?: React.MouseEvent) => void;
  onLayerUpdate?: (layerId: string, updates: Partial<Layer>) => void;
  onLayerHover?: (layerId: string | null) => void;
  editingLayerId: string | null;
  setEditingLayerId: (id: string | null) => void;
  editingContent: string;
  setEditingContent: (content: string) => void;
  editingClickCoords: { x: number; y: number } | null;
  setEditingClickCoords: (coords: { x: number; y: number } | null) => void;
  pageId: string;
  collectionItemData?: Record<string, string>;
  collectionItemId?: string; // The ID of the current collection layer item being rendered
  layerDataMap?: Record<string, Record<string, string>>; // Map of collection layer ID -> item data
  pageCollectionItemId?: string; // The ID of the page's collection item (for dynamic pages)
  pageCollectionItemData?: Record<string, string> | null;
  hiddenLayerInfo?: HiddenLayerInfo[];
  editorHiddenLayerIds?: Map<string, Breakpoint[]>;
  editorBreakpoint?: Breakpoint;
  currentLocale?: Locale | null;
  availableLocales?: Locale[];
  localeSelectorFormat?: 'locale' | 'code';
  liveLayerUpdates?: UseLiveLayerUpdatesReturn | null;
  liveComponentUpdates?: UseLiveComponentUpdatesReturn | null;
  parentComponentLayerId?: string; // ID of the parent component layer (if this layer is inside a component)
  parentComponentOverrides?: Layer['componentOverrides']; // Override values from parent component instance
  parentComponentVariables?: ComponentVariable[]; // Component's variables for default value lookup
  editingComponentVariables?: ComponentVariable[]; // Variables when directly editing a component
  isInsideForm?: boolean; // Whether this layer is inside a form
  parentFormSettings?: FormSettings; // Form settings from parent form layer
  pages?: any[]; // Pages for link resolution
  folders?: any[]; // Folders for link resolution
  collectionItemSlugs?: Record<string, string>; // Maps collection_item_id -> slug value for link resolution
  isPreview?: boolean; // Whether we're in preview mode
  translations?: Record<string, any> | null; // Translations for localized URL generation
  anchorMap?: Record<string, string>; // Pre-built map of layerId -> anchor value
  resolvedAssets?: Record<string, string>;
  components?: Component[];
  ancestorComponentIds?: Set<string>;
}> = ({
  layer,
  isEditMode,
  isPublished,
  enableDragDrop,
  selectedLayerId,
  hoveredLayerId,
  activeLayerId,
  projected,
  onLayerClick,
  onLayerUpdate,
  onLayerHover,
  editingLayerId,
  setEditingLayerId,
  editingContent,
  setEditingContent,
  editingClickCoords,
  setEditingClickCoords,
  pageId,
  collectionItemData,
  collectionItemId,
  layerDataMap,
  pageCollectionItemId,
  pageCollectionItemData,
  hiddenLayerInfo,
  editorHiddenLayerIds,
  editorBreakpoint,
  currentLocale,
  availableLocales,
  localeSelectorFormat,
  liveLayerUpdates,
  liveComponentUpdates,
  parentComponentLayerId,
  parentComponentOverrides,
  parentComponentVariables,
  editingComponentVariables,
  isInsideForm = false,
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
}) => {
  const isSelected = selectedLayerId === layer.id;
  const isHovered = hoveredLayerId === layer.id;
  const isEditing = editingLayerId === layer.id;
  const isDragging = activeLayerId === layer.id;
  const textEditable = isTextEditable(layer);

  // Collaboration layer locking - use unified resource lock system
  const currentUserId = useAuthStore((state) => state.user?.id);
  const lockKey = getResourceLockKey(RESOURCE_TYPES.LAYER, layer.id);
  const lock = useCollaborationPresenceStore((state) => state.resourceLocks[lockKey]);
  // Check if locked by another user (only compute when lock exists)
  const isLockedByOther = !!(lock && lock.user_id !== currentUserId && Date.now() <= lock.expires_at);
  const classesString = getClassesString(layer);
  // Collection layer data (from repeaters/loops) - separate from page collection data
  // Use layer's pre-resolved values if present (from SSR), otherwise use prop from parent
  const collectionLayerItemId = layer._collectionItemId || collectionItemId;
  const collectionLayerData = layer._collectionItemValues || collectionItemData;
  // Layer-specific data map for resolving fields with collection_layer_id
  // Merge SSR-embedded map with prop from parent (SSR data takes precedence)
  const effectiveLayerDataMap = React.useMemo(() => ({
    ...layerDataMap,
    ...(layer._layerDataMap || {}),
  }), [layerDataMap, layer._layerDataMap]);
  // Track component scope for circular reference detection (works in both edit and published modes)
  const effectiveAncestorIds = useMemo(() => {
    if (!layer.componentId) return ancestorComponentIds;
    const set = new Set(ancestorComponentIds);
    set.add(layer.componentId);
    return set;
  }, [ancestorComponentIds, layer.componentId]);
  const getAssetFromStore = useAssetsStore((state) => state.getAsset);
  const assetsById = useAssetsStore((state) => state.assetsById);
  const timezone = useSettingsStore((state) => state.settingsByKey.timezone as string | null) ?? 'UTC';

  // Create asset resolver that checks pre-resolved assets first (SSR), then falls back to store
  const getAsset = useCallback((id: string) => {
    // Check pre-resolved assets from server first
    if (resolvedAssets?.[id]) {
      const value = resolvedAssets[id];
      // Inline SVG content (starts with <) — return as content, no public URL
      if (value.startsWith('<')) {
        return { public_url: null, content: value };
      }
      return { public_url: value };
    }
    // Fall back to store (may trigger async fetch)
    return getAssetFromStore(id);
  }, [resolvedAssets, getAssetFromStore]);
  const openFileManager = useEditorStore((state) => state.openFileManager);
  const allTranslations = useLocalisationStore((state) => state.translations);
  const editModeTranslations = isEditMode && currentLocale ? allTranslations[currentLocale.id] : null;
  const storeComponents = useComponentsStore((state) => state.components);
  const allComponents = storeComponents.length > 0 ? storeComponents : (componentsProp ?? []);

  // Shared props passed to nested LayerRenderer calls (component instances & rich-text components)
  const sharedRendererProps = useMemo(() => ({
    isEditMode,
    isPublished,
    selectedLayerId,
    hoveredLayerId,
    onLayerClick,
    onLayerUpdate,
    onLayerHover,
    pageId,
    collectionItemData: collectionLayerData,
    collectionItemId: collectionLayerItemId,
    layerDataMap: effectiveLayerDataMap,
    pageCollectionItemId,
    pageCollectionItemData,
    hiddenLayerInfo,
    editorHiddenLayerIds,
    editorBreakpoint,
    currentLocale,
    availableLocales,
    localeSelectorFormat,
    liveLayerUpdates,
    liveComponentUpdates,
    isInsideForm,
    parentFormSettings,
    pages,
    folders,
    collectionItemSlugs,
    isPreview,
    translations,
    anchorMap,
    resolvedAssets,
    components: componentsProp,
  }), [isEditMode, isPublished, selectedLayerId, hoveredLayerId, onLayerClick, onLayerUpdate, onLayerHover, pageId, collectionLayerData, collectionLayerItemId, effectiveLayerDataMap, pageCollectionItemId, pageCollectionItemData, hiddenLayerInfo, editorHiddenLayerIds, editorBreakpoint, currentLocale, availableLocales, localeSelectorFormat, liveLayerUpdates, liveComponentUpdates, isInsideForm, parentFormSettings, pages, folders, collectionItemSlugs, isPreview, translations, anchorMap, resolvedAssets, componentsProp]);

  // Callback for rendering embedded components inside rich-text content
  // Clicks on the embedded component's internal layers should select the text layer
  const renderComponentBlock: RenderComponentBlockFn = useCallback(
    (comp, resolvedLayers, _overrides, key, innerAncestorIds) => {
      const uniqueLayers = transformLayerIdsForInstance(
        resolvedLayers,
        `${layer.id}-rtc-${key}`
      );
      return (
      <React.Fragment key={key}>
        {isEditMode ? (
          <div className="pointer-events-none">
            <LayerRenderer
              layers={uniqueLayers}
              {...sharedRendererProps}
              parentComponentLayerId={layer.id}
              ancestorComponentIds={innerAncestorIds}
            />
          </div>
        ) : (
          <>
            <LayerRenderer
              layers={uniqueLayers}
              {...sharedRendererProps}
              parentComponentLayerId={layer.id}
              ancestorComponentIds={innerAncestorIds}
            />
            <AnimationInitializer layers={uniqueLayers} />
          </>
        )}
      </React.Fragment>
      );
    },
    [layer.id, sharedRendererProps, isEditMode]
  );

  let htmlTag = getLayerHtmlTag(layer);

  // Check if we need to override the tag for rich text with block elements
  // Tags like <p>, <h1>-<h6> cannot contain block elements like <ul>/<ol>
  const textVariable = layer.variables?.text;
  let useSpanForParagraphs = false;

  {
    const restrictiveBlockTags = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'a', 'button'];
    const isRestrictiveTag = restrictiveBlockTags.includes(htmlTag);

    if (isRestrictiveTag) {
      let hasLists = false;

      if (textVariable?.type === 'dynamic_rich_text') {
        hasLists = hasBlockElementsWithInlineVariables(
          textVariable as any,
          collectionLayerData,
          pageCollectionItemData || undefined
        );
      }

      // Also check resolved component variable value for block elements
      if (!hasLists) {
        const componentVariables = parentComponentVariables || editingComponentVariables;
        const linkedVariableId = (textVariable as any)?.id;
        if (linkedVariableId && componentVariables) {
          const overrideValue = parentComponentOverrides?.text?.[linkedVariableId];
          const variableDef = componentVariables.find(v => v.id === linkedVariableId);
          const valueToCheck = overrideValue ?? variableDef?.default_value;
          if (valueToCheck && 'type' in valueToCheck && valueToCheck.type === 'dynamic_rich_text') {
            hasLists = hasBlockElementsWithInlineVariables(
              valueToCheck as any,
              collectionLayerData,
              pageCollectionItemData || undefined
            );
          }
        }
      }

      if (hasLists) {
        htmlTag = 'div';
      } else if (textVariable?.type === 'dynamic_rich_text' || (textVariable as any)?.id) {
        useSpanForParagraphs = true;
      }
    }
  }

  // When editing text, CanvasTextEditor wraps content in a <div>
  // So we need to use 'div' as the outer tag to avoid invalid nesting like <p><div>
  if (isEditing && textEditable) {
    htmlTag = 'div';
  }

  // Buttons with link settings render as <a> directly instead of being
  // wrapped in <a><button></button></a> which is invalid HTML
  const isButtonWithLink = layer.name === 'button'
    && !isEditMode
    && !isInsideForm
    && isValidLinkSettings(layer.variables?.link);
  if (isButtonWithLink) {
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

  // Filter layer runtime behavior: attach event listeners to child inputs
  const isFilterLayer = layer.name === 'filter';
  const filterOnChange = layer.settings?.filterOnChange ?? false;

  // Load filter values from URL on initial render and populate input elements
  React.useEffect(() => {
    if (isEditMode || !isFilterLayer || !filterLayerRef.current) return;

    const container = filterLayerRef.current;
    const store = useFilterStore.getState();

    // Build the name map from DOM: inputLayerId → name attribute (or stripped ID)
    const nameMap: Record<string, string> = {};
    const reverseMap: Record<string, string> = {};
    const inputs = container.querySelectorAll('input, select, textarea');
    inputs.forEach(el => {
      const inputLayerId = (el as HTMLElement).closest('[data-layer-id]')?.getAttribute('data-layer-id');
      if (!inputLayerId) return;
      const nameAttr = (el as HTMLInputElement).getAttribute('name');
      const paramName = nameAttr || (inputLayerId.startsWith('lyr-') ? inputLayerId.slice(4) : inputLayerId);
      nameMap[inputLayerId] = paramName;
      reverseMap[paramName] = inputLayerId;
    });
    const inputLayerIds = Object.keys(nameMap);
    store.setNameMap(nameMap);

    // Populate input elements with values from URL params
    const url = new URL(window.location.href);
    url.searchParams.forEach((value, key) => {
      if (!value) return;
      const inputLayerId = reverseMap[key]
        || (key.startsWith('filter_') ? key.slice('filter_'.length) : null);
      if (!inputLayerId) return;
      // Find the input: it may be a descendant of a wrapper div OR the element itself
      let inputEl = container.querySelector(`[data-layer-id="${inputLayerId}"] input, [data-layer-id="${inputLayerId}"] select, [data-layer-id="${inputLayerId}"] textarea`) as HTMLInputElement | null;
      if (!inputEl) {
        const directEl = container.querySelector(`input[data-layer-id="${inputLayerId}"], select[data-layer-id="${inputLayerId}"], textarea[data-layer-id="${inputLayerId}"]`) as HTMLInputElement | null;
        inputEl = directEl;
      }
      if (!inputEl) return;
      if (inputEl.type === 'checkbox') {
        inputEl.checked = value === 'true';
      } else {
        inputEl.value = value;
      }
    });

    // Defer loadFromUrl to ensure FilterableCollection has mounted and subscribed
    setTimeout(() => store.loadFromUrl(), 0);

    return () => {
      const state = useFilterStore.getState();
      state.removeNameMapEntries(inputLayerIds);
    };
  }, [isEditMode, isFilterLayer]);

  React.useEffect(() => {
    if (isEditMode || !isFilterLayer || !filterLayerRef.current) return;

    const container = filterLayerRef.current;
    const filterLayerId = layer.id;
    const { setFilterValues } = useFilterStore.getState();

    const collectInputValues = () => {
      const nameMap: Record<string, string> = {};
      const inputValues: Record<string, string> = {};
      const inputs = container.querySelectorAll('input, select, textarea');
      inputs.forEach(el => {
        const inputEl = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        const inputLayerId = inputEl.closest('[data-layer-id]')?.getAttribute('data-layer-id');
        if (!inputLayerId) return;
        const nameAttr = inputEl.getAttribute('name');
        if (nameAttr) nameMap[inputLayerId] = nameAttr;
        const value = inputEl.type === 'checkbox' ? (inputEl as HTMLInputElement).checked.toString() : inputEl.value;
        inputValues[inputLayerId] = value;
      });
      setFilterValues(filterLayerId, inputValues);
      if (Object.keys(nameMap).length > 0) {
        useFilterStore.getState().setNameMap(nameMap);
      }
    };

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedCollect = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(collectInputValues, 750);
    };

    // Button click handler - always triggers collection
    const handleButtonClick = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.closest('button') || target.tagName === 'BUTTON') {
        e.preventDefault();
        collectInputValues();
      }
    };

    // Enter key handler - triggers collection from any input
    const handleKeyDown = (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key !== 'Enter') return;
      const target = ke.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT') {
        ke.preventDefault();
        collectInputValues();
      }
    };

    container.addEventListener('click', handleButtonClick);
    container.addEventListener('keydown', handleKeyDown);

    // If filterOnChange is enabled, listen for input changes
    if (filterOnChange) {
      const handleInputChange = () => debouncedCollect();
      container.addEventListener('input', handleInputChange);
      container.addEventListener('change', handleInputChange);

      // Apply initial input values (including defaults) on mount.
      collectInputValues();

      return () => {
        container.removeEventListener('click', handleButtonClick);
        container.removeEventListener('keydown', handleKeyDown);
        container.removeEventListener('input', handleInputChange);
        container.removeEventListener('change', handleInputChange);
        useFilterStore.getState().clearFilter(filterLayerId);
        if (debounceTimer) clearTimeout(debounceTimer);
      };
    }

    // Apply initial input values (including defaults) on mount.
    collectInputValues();

    return () => {
      container.removeEventListener('click', handleButtonClick);
      container.removeEventListener('keydown', handleKeyDown);
      useFilterStore.getState().clearFilter(filterLayerId);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [isFilterLayer, filterOnChange, isEditMode, layer.id]);

  // Resolve text and image URLs with field binding support
  const textContent = (() => {
    // Special handling for locale selector label
    if (layer.key === 'localeSelectorLabel' && !isEditMode) {
      // Get default locale if no locale is detected
      const defaultLocale = availableLocales?.find(l => l.is_default) || availableLocales?.[0];
      const displayLocale = currentLocale || defaultLocale;

      // Fallback if no locale data available
      if (!displayLocale) {
        return 'English';
      }

      // Use format from parent localeSelector layer (passed as prop)
      const format = localeSelectorFormat || 'locale';
      return format === 'code' ? displayLocale.code.toUpperCase() : displayLocale.label;
    }

    // Build link context for resolving page/asset/field links in rich text
    // Skip building context in edit mode since links are disabled and use '#'
    const linkContext: RichTextLinkContext | undefined = isEditMode
      ? undefined
      : {
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
      };

    // Check for component variable override or default value
    // This handles both:
    // 1. Component instances on a page (parentComponentVariables is set)
    // 2. Directly editing a component (editingComponentVariables is set)
    const componentVariables = parentComponentVariables || editingComponentVariables;
    const linkedVariableId = textVariable?.id;
    if (linkedVariableId && componentVariables) {
      // Check for override value first (only when viewing an instance, not when editing component)
      const overrideValue = parentComponentOverrides?.text?.[linkedVariableId];
      const variableDef = componentVariables.find(v => v.id === linkedVariableId);
      const valueToRender = overrideValue ?? variableDef?.default_value;

      if (valueToRender !== undefined) {
        // Value is typed as ComponentVariableValue - check if it's a text variable (has 'type' property)
        if ('type' in valueToRender && valueToRender.type === 'dynamic_rich_text') {
          return renderRichText(valueToRender as any, collectionLayerData, pageCollectionItemData || undefined, layer.textStyles, useSpanForParagraphs, isEditMode, linkContext, timezone, effectiveLayerDataMap, allComponents, renderComponentBlock, effectiveAncestorIds);
        }
        if ('type' in valueToRender && valueToRender.type === 'dynamic_text') {
          return (valueToRender as any).data.content;
        }
      }

      // Variable is linked but has no default value - return empty string (don't fall through to layer's text)
      return '';
    }

    // Check for DynamicRichTextVariable format (with formatting)
    if (textVariable?.type === 'dynamic_rich_text') {
      // Render rich text with formatting (bold, italic, etc.) and inline variables
      // In edit mode, adds data-style attributes for style selection
      return renderRichText(textVariable as any, collectionLayerData, pageCollectionItemData || undefined, layer.textStyles, useSpanForParagraphs, isEditMode, linkContext, timezone, effectiveLayerDataMap, allComponents, renderComponentBlock, effectiveAncestorIds);
    }

    // Check for inline variables in DynamicTextVariable format (legacy)
    if (textVariable?.type === 'dynamic_text') {
      const content = textVariable.data.content;
      if (content.includes('<ycode-inline-variable>')) {
        // Resolve inline variables with timezone-aware date formatting
        return resolveInlineVariablesFromData(content, collectionLayerData, pageCollectionItemData ?? undefined, timezone, effectiveLayerDataMap);
      }
      // No inline variables, return plain content
      return content;
    }
    const text = getText(layer);
    if (text) return text;
    return undefined;
  })();

  // Resolve image source - check for linked component variable first
  const componentVariables = parentComponentVariables || editingComponentVariables;
  const linkedImageVariableId = (layer.variables?.image?.src as any)?.id;

  // Get effective image settings (from component variable or layer)
  const effectiveImageSettings = (() => {
    if (linkedImageVariableId && componentVariables) {
      // Check for override value first (only when viewing an instance)
      const overrideValue = parentComponentOverrides?.image?.[linkedImageVariableId];
      const variableDef = componentVariables.find(v => v.id === linkedImageVariableId);
      const valueToUse = overrideValue ?? variableDef?.default_value;

      // ImageSettingsValue has src, alt, width, height, loading
      if (valueToUse && typeof valueToUse === 'object' && 'src' in valueToUse) {
        return valueToUse as { src?: any; alt?: any; width?: string; height?: string; loading?: string };
      }
    }
    // Fall back to layer's image settings
    return layer.variables?.image;
  })();

  // Get image asset ID and apply translation if available
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

  // Get image alt text and apply translation if available
  const originalImageAlt = getDynamicTextContent(effectiveImageSettings?.alt) || 'Image';
  const translatedImageAlt = getTranslatedText(
    originalImageAlt,
    `layer:${layer.id}:image_alt`,
    translations,
    pageId,
    layer._masterComponentId
  ) || 'Image';
  const imageAlt = translatedImageAlt;

  // Resolve audio source - check for linked component variable first
  const linkedAudioVariableId = (layer.variables?.audio?.src as any)?.id;
  const effectiveAudioSettings = (() => {
    if (linkedAudioVariableId && componentVariables) {
      const overrideValue = parentComponentOverrides?.audio?.[linkedAudioVariableId];
      const variableDef = componentVariables.find(v => v.id === linkedAudioVariableId);
      const valueToUse = (overrideValue ?? variableDef?.default_value) as any;
      if (valueToUse) {
        return {
          src: valueToUse.src || layer.variables?.audio?.src,
          attributes: {
            ...(valueToUse.controls !== undefined && { controls: valueToUse.controls }),
            ...(valueToUse.loop !== undefined && { loop: valueToUse.loop }),
            ...(valueToUse.muted !== undefined && { muted: valueToUse.muted }),
            ...(valueToUse.volume !== undefined && { volume: String(valueToUse.volume) }),
          },
        };
      }
    }
    return null;
  })();

  // Resolve video source - check for linked component variable first
  const linkedVideoVariableId = (layer.variables?.video?.src as any)?.id;
  const effectiveVideoSettings = (() => {
    if (linkedVideoVariableId && componentVariables) {
      const overrideValue = parentComponentOverrides?.video?.[linkedVideoVariableId];
      const variableDef = componentVariables.find(v => v.id === linkedVideoVariableId);
      const valueToUse = (overrideValue ?? variableDef?.default_value) as any;
      if (valueToUse) {
        return {
          src: valueToUse.src || layer.variables?.video?.src,
          poster: valueToUse.poster ?? layer.variables?.video?.poster,
          attributes: {
            ...(valueToUse.controls !== undefined && { controls: valueToUse.controls }),
            ...(valueToUse.loop !== undefined && { loop: valueToUse.loop }),
            ...(valueToUse.muted !== undefined && { muted: valueToUse.muted }),
            ...(valueToUse.autoplay !== undefined && { autoplay: valueToUse.autoplay }),
            ...(valueToUse.youtubePrivacyMode !== undefined && { youtubePrivacyMode: valueToUse.youtubePrivacyMode }),
          },
        };
      }
    }
    return null;
  })();

  // Resolve icon source - check for linked component variable first
  const linkedIconVariableId = (layer.variables?.icon?.src as any)?.id;
  const effectiveIconSrc = (() => {
    if (linkedIconVariableId && componentVariables) {
      const overrideValue = parentComponentOverrides?.icon?.[linkedIconVariableId];
      const variableDef = componentVariables.find(v => v.id === linkedIconVariableId);
      const valueToUse = (overrideValue ?? variableDef?.default_value) as any;
      if (valueToUse?.src) {
        return valueToUse.src;
      }
    }
    return layer.variables?.icon?.src;
  })();

  // Build effective layer with resolved component variable overrides
  const effectiveLayer = useMemo(() => {
    let resolved = layer;
    if (effectiveAudioSettings) {
      resolved = {
        ...resolved,
        variables: { ...resolved.variables, audio: { ...resolved.variables?.audio, src: effectiveAudioSettings.src } },
        attributes: { ...resolved.attributes, ...effectiveAudioSettings.attributes },
      };
    }
    if (effectiveVideoSettings) {
      resolved = {
        ...resolved,
        variables: { ...resolved.variables, video: { ...resolved.variables?.video, src: effectiveVideoSettings.src, poster: effectiveVideoSettings.poster } },
        attributes: { ...resolved.attributes, ...effectiveVideoSettings.attributes },
      };
    }
    if (effectiveIconSrc && effectiveIconSrc !== layer.variables?.icon?.src) {
      resolved = {
        ...resolved,
        variables: { ...resolved.variables, icon: { ...resolved.variables?.icon, src: effectiveIconSrc } },
      };
    }
    return resolved;
  }, [layer, effectiveAudioSettings, effectiveVideoSettings, effectiveIconSrc]);

  // Handle component instances - only fetch from store in edit mode
  // In published pages, components are pre-resolved server-side via resolveComponents()
  const getComponentById = useComponentsStore((state) => state.getComponentById);
  const component = (isEditMode && layer.componentId) ? getComponentById(layer.componentId) : null;

  // Transform component layers for this instance to ensure unique IDs per instance
  // This enables animations to target the correct elements when multiple instances exist
  const transformedComponentLayers = useMemo(() => {
    if (isEditMode && component && component.layers && component.layers.length > 0) {
      return transformLayerIdsForInstance(component.layers, layer.id);
    }
    return null;
  }, [isEditMode, component, layer.id]);

  const collectionVariable = getCollectionVariable(layer);
  const isCollectionLayer = !!collectionVariable;
  const collectionId = collectionVariable?.id;
  const sourceFieldId = collectionVariable?.source_field_id;
  const sourceFieldType = collectionVariable?.source_field_type;
  const layerData = useCollectionLayerStore((state) => state.layerData[layer.id]);
  const isLoadingLayerData = useCollectionLayerStore((state) => state.loading[layer.id]);
  const fetchLayerData = useCollectionLayerStore((state) => state.fetchLayerData);
  const fieldsByCollectionId = useCollectionsStore((state) => state.fields);
  const itemsByCollectionId = useCollectionsStore((state) => state.items);
  const allCollectionItems = React.useMemo(() => layerData || [], [layerData]);

  // Get the source for multi-asset field resolution
  const sourceFieldSource = collectionVariable?.source_field_source;

  // Resolve multi-asset source field by id from store (for empty state message)
  const multiAssetSourceField = React.useMemo(() => {
    if (sourceFieldType !== 'multi_asset' || !sourceFieldId) return null;
    const allFields = Object.values(fieldsByCollectionId).flat();
    return allFields.find((f) => f.id === sourceFieldId) ?? null;
  }, [sourceFieldType, sourceFieldId, fieldsByCollectionId]);

  // Filter items by reference field if source_field_id is set
  // Single reference: get the one referenced item (no loop, just context)
  // Multi-reference: filter to items in the array (loops through all)
  // Multi-asset: build virtual items from asset IDs
  const collectionItems = React.useMemo(() => {
    let items: CollectionItemWithValues[];

    // Handle multi-asset: build virtual items from assets
    if (sourceFieldType === 'multi_asset' && sourceFieldId) {
      // Get the field value from the correct source (page or collection)
      const fieldValue = sourceFieldSource === 'page'
        ? pageCollectionItemData?.[sourceFieldId]
        : collectionLayerData?.[sourceFieldId];

      const assetIds = parseMultiAssetFieldValue(fieldValue);
      if (assetIds.length === 0) return [];

      // Build virtual collection items from assets
      items = assetIds.map(assetId => {
        const asset = getAsset(assetId);
        // Check if it's a full Asset object or just a URL placeholder
        const isFullAsset = asset && 'filename' in asset;
        const virtualValues = isFullAsset ? buildAssetVirtualValues(asset) : {};
        return {
          id: assetId,
          collection_id: MULTI_ASSET_COLLECTION_ID,
          manual_order: 0,
          created_at: '',
          updated_at: '',
          deleted_at: null,
          is_published: true,
          is_publishable: true,
          content_hash: null,
          values: virtualValues,
        };
      });
    } else if (!sourceFieldId) {
      items = allCollectionItems;
    } else {
      // Get the reference field value using source-aware resolution
      const refValue = resolveFieldFromSources(sourceFieldId, undefined, collectionLayerData, pageCollectionItemData);
      if (!refValue) return [];

      // Handle single reference: value is just an item ID string
      if (sourceFieldType === 'reference') {
        // Find the single referenced item by ID
        const singleItem = allCollectionItems.find(item => item.id === refValue);
        items = singleItem ? [singleItem] : [];
      } else {
        // Handle multi-reference: filter to items whose IDs are in the multi-reference array
        const allowedIds = parseMultiReferenceValue(refValue);
        items = allCollectionItems.filter(item => allowedIds.includes(item.id));
      }
    }

    // Apply collection filters (evaluate against each item's own values)
    // In edit mode, skip conditions that have inputLayerId (dynamic filter inputs have no value at design time)
    const collectionFilters = collectionVariable?.filters;
    if (collectionFilters?.groups?.length) {
      const effectiveFilters = isEditMode
        ? {
          ...collectionFilters,
          groups: collectionFilters.groups
            .map(group => ({
              ...group,
              conditions: group.conditions.filter(c => !c.inputLayerId),
            }))
            .filter(group => group.conditions.length > 0),
        }
        : collectionFilters;

      if (effectiveFilters.groups.length > 0) {
        items = items.filter(item =>
          evaluateVisibility(effectiveFilters, {
            collectionLayerData: item.values,
            pageCollectionData: null,
            pageCollectionCounts: {},
          })
        );
      }
    }

    return items;
  }, [allCollectionItems, sourceFieldId, sourceFieldType, sourceFieldSource, collectionLayerData, pageCollectionItemData, getAsset, collectionVariable?.filters]);

  useEffect(() => {
    if (!isEditMode) return;
    if (!collectionVariable?.id) return;
    // Skip fetching for multi-asset collections (they don't have real collection data)
    if (collectionVariable.source_field_type === 'multi_asset') return;
    if (collectionVariable.id === MULTI_ASSET_COLLECTION_ID) return;
    if (allCollectionItems.length > 0 || isLoadingLayerData) return;

    fetchLayerData(
      layer.id,
      collectionVariable.id,
      collectionVariable.sort_by,
      collectionVariable.sort_order,
      collectionVariable.limit,
      collectionVariable.offset
    );
  }, [
    isEditMode,
    collectionVariable?.id,
    collectionVariable?.source_field_type,
    collectionVariable?.sort_by,
    collectionVariable?.sort_order,
    collectionVariable?.limit,
    collectionVariable?.offset,
    allCollectionItems.length,
    isLoadingLayerData,
    fetchLayerData,
    layer.id,
  ]);

  // For component instances in edit mode, use the component's layers as children
  // For published pages, children are already resolved server-side
  const baseChildren = (isEditMode && component && component.layers) ? component.layers : layer.children;

  // Replicate the single bullet template for each slide on canvas.
  // The count comes from Swiper's snap grid (set by useCanvasSlider).
  const sliderSnapCounts = useEditorStore((s) => s.sliderSnapCounts);
  const children = useMemo(() => {
    if (!isEditMode || layer.name !== 'slideBullets' || !baseChildren?.length) return baseChildren;
    const currentPageId = useEditorStore.getState().currentPageId;
    if (!currentPageId) return baseChildren;
    const allLayers = usePagesStore.getState().draftsByPageId[currentPageId]?.layers;
    if (!allLayers) return baseChildren;
    const slider = findAncestorByName(allLayers, layer.id, 'slider');
    if (!slider) return baseChildren;
    const bulletCount = sliderSnapCounts[slider.id] || slider.children?.find(c => c.name === 'slides')?.children?.length || 1;
    const bulletTemplate = baseChildren[0];
    return Array.from({ length: bulletCount }, (_, i) => ({
      ...bulletTemplate,
      id: bulletTemplate.id,
      _bulletKey: `${bulletTemplate.id}-${i}`,
    }));
  }, [isEditMode, layer.name, layer.id, baseChildren, sliderSnapCounts]);

  // For slider layers, strip inactive pagination/navigation children entirely
  const effectiveChildren = useMemo(() => {
    if (layer.name !== 'slider' || !children?.length) return children;
    return filterDisabledSliderLayers(children, layer.settings);
  }, [layer.name, layer.settings, children]);

  // Use sortable for drag and drop
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    id: layer.id,
    disabled: !enableDragDrop || isEditing || isLockedByOther,
    data: {
      layer,
    },
  });

  // Canvas slider: init Swiper on slider layers and handle slide navigation
  const sliderRef = useRef<HTMLElement | null>(null);
  useCanvasSlider(sliderRef, layer, isEditMode);

  const startEditing = (clickX?: number, clickY?: number) => {
    // Enable inline editing for text layers (both rich text and plain text)
    if (textEditable && isEditMode && !isLockedByOther) {
      setEditingLayerId(layer.id);
      // Store click coordinates if provided
      if (typeof clickX === 'number' && typeof clickY === 'number') {
        setEditingClickCoords({ x: clickX, y: clickY });
      } else {
        setEditingClickCoords(null);
      }
      // For rich text, pass the Tiptap JSON content; for plain text, pass string
      const textVar = layer.variables?.text;
      if (textVar?.type === 'dynamic_rich_text') {
        setEditingContent(JSON.stringify(textVar.data.content));
      } else {
        setEditingContent(typeof textContent === 'string' ? textContent : '');
      }
    }
  };

  // Open file manager for image layers on double-click
  const openImageFileManager = useCallback(() => {
    if (!isEditMode || isLockedByOther || !onLayerUpdate) return;

    // Get current asset ID for highlighting in file manager
    const currentAssetId = isAssetVariable(layer.variables?.image?.src)
      ? getAssetId(layer.variables?.image?.src)
      : null;

    openFileManager(
      (asset) => {
        // Validate asset type - allow both images and icons (SVGs)
        const isImage = asset.mime_type && isAssetOfType(asset.mime_type, ASSET_CATEGORIES.IMAGES);
        const isSvg = asset.mime_type && isAssetOfType(asset.mime_type, ASSET_CATEGORIES.ICONS);

        if (!isImage && !isSvg) {
          toast.error('Invalid asset type', {
            description: 'Please select an image or SVG file.',
          });
          return false; // Don't close file manager
        }

        // Update layer with new image asset
        onLayerUpdate(layer.id, {
          variables: {
            ...layer.variables,
            image: {
              src: createAssetVariable(asset.id),
              alt: layer.variables?.image?.alt || createDynamicTextVariable(''),
            },
          },
        });
      },
      currentAssetId,
      [ASSET_CATEGORIES.IMAGES, ASSET_CATEGORIES.ICONS]
    );
  }, [isEditMode, isLockedByOther, onLayerUpdate, layer, openFileManager]);

  const finishEditing = useCallback(() => {
    if (editingLayerId === layer.id) {
      setEditingLayerId(null);
    }
  }, [editingLayerId, layer.id, setEditingLayerId]);

  // Handle content change from CanvasTextEditor
  const handleEditorChange = useCallback((newContent: any) => {
    if (!onLayerUpdate) return;

    // Use callback form to ensure we get the latest layer data
    const updates: Partial<Layer> = {
      variables: {
        ...layer.variables,
        text: {
          type: 'dynamic_rich_text',
          data: { content: newContent },
        },
      },
    };

    onLayerUpdate(layer.id, updates);
  }, [layer.id, layer.variables, onLayerUpdate]);

  const style = enableDragDrop ? {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  } : undefined;

  // Show projection indicator if this is being dragged over
  const showProjection = projected && activeLayerId && activeLayerId !== layer.id;

  // Build className with editor states if in edit mode
  // When layer tag is p and has text, add paragraph default classes (block, margin) so the wrapper displays correctly
  const paragraphClasses = htmlTag === 'p' && layer.variables?.text
    ? getTextStyleClasses(layer.textStyles, 'paragraph')
    : '';

  // Use clsx (not cn/twMerge) to preserve all layer classes intact.
  // twMerge incorrectly removes leading-* when text-[...] is present
  // because it treats font-size as overriding line-height. Our own
  // setBreakpointClass already handles property-aware conflict resolution.

  // <a> with display:flex is block-level (full width) unlike <button> which
  // shrink-wraps. Add w-fit to match button sizing unless width is explicit.
  const buttonNeedsFit = isButtonWithLink && (() => {
    const cls = Array.isArray(layer.classes) ? layer.classes : (layer.classes || '').split(' ');
    return !cls.some((c: string) => /^w-/.test(c.split(':').pop() || ''));
  })();

  const fullClassName = isEditMode ? clsx(
    classesString,
    paragraphClasses,
    SWIPER_CLASS_MAP[layer.name],
    enableDragDrop && !isEditing && !isLockedByOther && 'cursor-default',
    isDragging && 'opacity-30',
    showProjection && 'outline outline-1 outline-dashed outline-blue-400 bg-blue-50/10',
    isLockedByOther && 'opacity-90 pointer-events-none select-none',
    'ycode-layer'
  ) : clsx(classesString, paragraphClasses, SWIPER_CLASS_MAP[layer.name], buttonNeedsFit && 'w-fit');

  // Check if layer should be hidden (hide completely in both edit mode and public pages)
  if (layer.settings?.hidden) {
    return null;
  }

  // Evaluate conditional visibility (only in edit mode - SSR handles published pages)
  const conditionalVisibility = layer.variables?.conditionalVisibility;
  if (isEditMode && conditionalVisibility && conditionalVisibility.groups?.length > 0) {
    // Build page collection counts from the store
    const pageCollectionCounts: Record<string, number> = {};
    conditionalVisibility.groups.forEach(group => {
      group.conditions?.forEach(condition => {
        if (condition.source === 'page_collection' && condition.collectionLayerId) {
          // Use the layerData from the store for collection counts
          const storeData = useCollectionLayerStore.getState().layerData[condition.collectionLayerId];
          pageCollectionCounts[condition.collectionLayerId] = storeData?.length ?? 0;
        }
      });
    });

    const isVisible = evaluateVisibility(conditionalVisibility, {
      collectionLayerData,
      pageCollectionData: pageCollectionItemData,
      pageCollectionCounts,
    });
    if (!isVisible) {
      return null;
    }
  }

  // Prevent circular component rendering (A → B → A)
  if (layer.componentId && ancestorComponentIds?.has(layer.componentId)) {
    return null;
  }

  // Render element-specific content
  const renderContent = () => {
    // Component instances in EDIT MODE: render component's layers directly
    // Set the root layer's ID to the instance ID so SelectionOverlay can find
    // the element via [data-layer-id]. This matches published mode where
    // resolveComponents merges the component root into the instance layer.
    if (transformedComponentLayers && transformedComponentLayers.length > 0) {
      const layersWithInstanceId = [
        { ...transformedComponentLayers[0], id: layer.id },
        ...transformedComponentLayers.slice(1),
      ];

      // Resolve variableLinks: if this nested component instance links child variables
      // to parent variables, merge the parent's override/default values into the
      // instance overrides so children see the correct values.
      const effectiveOverrides = layer.componentOverrides?.variableLinks
        ? resolveVariableLinks(layer.componentOverrides, parentComponentOverrides, parentComponentVariables)
        : layer.componentOverrides;

      return (
        <LayerRenderer
          layers={layersWithInstanceId}
          {...sharedRendererProps}
          enableDragDrop={enableDragDrop}
          activeLayerId={activeLayerId}
          projected={projected}
          parentComponentLayerId={layer.id}
          parentComponentOverrides={effectiveOverrides}
          parentComponentVariables={component?.variables}
          ancestorComponentIds={effectiveAncestorIds}
        />
      );
    }

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
      Object.entries(otherAttributes).map(([key, value]) => {
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

    // Merge styles: base style + attribute style + dynamic CMS color bindings + background image vars
    const mergedStyle = { ...style, ...parsedAttrStyle, ...filteredDesignStyles, ...bgImageStyle };

    // Check if element is truly empty (no text, no children)
    const isEmpty = !textContent && (!children || children.length === 0);

    // Layers with a visible border or background shouldn't show the empty placeholder (canvas only)
    const hasVisualStyle = isEditMode && isEmpty && (
      (classesString && /\b(bg-|border-)/.test(classesString)) ||
      Object.keys(mergedStyle).some(k => k.startsWith('background') || k.startsWith('border'))
    );

    // Check if this is the Body layer (locked)
    const isLocked = layer.id === 'body';

    // Build props for the element
    const combinedRef = (node: HTMLElement | null) => {
      setNodeRef(node);
      if (isFilterLayer) {
        (filterLayerRef as React.MutableRefObject<HTMLDivElement | null>).current = node as HTMLDivElement | null;
      }
      if (layer.name === 'slider') {
        sliderRef.current = node;
      }
    };

    const elementProps: Record<string, unknown> = {
      ref: combinedRef,
      className: fullClassName,
      style: mergedStyle,
      'data-layer-id': layer.id,
      'data-layer-type': htmlTag,
      'data-is-empty': isEmpty ? 'true' : 'false',
      ...(hasVisualStyle && { 'data-has-visual': 'true' }),
      ...(enableDragDrop && !isEditing && !isLockedByOther ? { ...normalizedAttributes, ...listeners } : normalizedAttributes),
    };

    // When a button is rendered as <a>, apply link attributes directly
    if (isButtonWithLink && layer.variables?.link) {
      const btnLinkSettings = layer.variables.link;
      const btnLinkContext: LinkResolutionContext = {
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
      };
      const btnLinkHref = generateLinkHref(btnLinkSettings, btnLinkContext);
      if (btnLinkHref) {
        elementProps.href = btnLinkHref;
        elementProps.target = btnLinkSettings.target || '_self';
        const btnLinkRel = btnLinkSettings.rel || (btnLinkSettings.target === '_blank' ? 'noopener noreferrer' : undefined);
        if (btnLinkRel) elementProps.rel = btnLinkRel;
        if (btnLinkSettings.download) elementProps.download = btnLinkSettings.download;
      }
      elementProps.role = 'button';
      delete elementProps.type;
    }

    // Add data-gsap-hidden attribute for elements that should start hidden
    const hiddenInfo = hiddenLayerInfo?.find(info => info.layerId === layer.id);
    if (hiddenInfo) {
      // Set breakpoints as value (e.g., "mobile" or "mobile tablet") or empty for all
      elementProps['data-gsap-hidden'] = hiddenInfo.breakpoints || '';
    }

    // Handle alert elements (for form success/error messages)
    if (layer.alertType) {
      elementProps['data-alert-type'] = layer.alertType;
    }

    // Add slider data attributes for production/preview rendering (SliderInitializer)
    if (!isEditMode) {
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
    if (!isEditMode && layer.name === 'slideBullets') {
      const existingStyle = typeof elementProps.style === 'object' ? elementProps.style : {};
      elementProps.style = { ...existingStyle, visibility: 'hidden' as const };
    }

    // Hide elements that have display: hidden animation with on-load apply style (edit mode only)
    // Show them when selected or when a child is selected
    // Only hide on the breakpoints the animation applies to
    if (isEditMode && editorHiddenLayerIds?.has(layer.id)) {
      const hiddenBreakpoints = editorHiddenLayerIds.get(layer.id) || [];
      // Empty array means all breakpoints, otherwise check if current breakpoint matches
      const shouldHideOnBreakpoint = hiddenBreakpoints.length === 0 ||
        (editorBreakpoint && hiddenBreakpoints.includes(editorBreakpoint));

      if (shouldHideOnBreakpoint) {
        const isSelectedOrChildSelected = isSelected || (selectedLayerId && (() => {
          // Check if selectedLayerId is a descendant of this layer
          const checkDescendants = (children: Layer[] | undefined): boolean => {
            if (!children) return false;
            for (const child of children) {
              if (child.id === selectedLayerId) return true;
              if (checkDescendants(child.children)) return true;
            }
            return false;
          };
          return checkDescendants(layer.children);
        })());

        if (!isSelectedOrChildSelected) {
          const existingStyle = typeof elementProps.style === 'object' ? elementProps.style : {};
          elementProps.style = { ...existingStyle, display: 'none' };
        }
      }
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

    // Add editor event handlers if in edit mode (but not for context menu trigger)
    if (isEditMode && !isEditing) {
      const originalOnClick = elementProps.onClick as ((e: React.MouseEvent) => void) | undefined;
      elementProps.onClick = (e: React.MouseEvent) => {
        // Ignore keyboard-generated clicks (detail===0) when a text editor
        // is active inside this element (e.g. Space on a <button> triggers
        // native click activation which would steal focus from the editor)
        if (e.detail === 0) {
          const el = e.currentTarget as HTMLElement;
          if (el?.querySelector?.('[contenteditable="true"]')) {
            e.stopPropagation();
            return;
          }
        }
        // Block click if locked by another user
        if (isLockedByOther) {
          e.stopPropagation();
          e.preventDefault();
          console.warn(`Layer ${layer.id} is locked by another user`);
          return;
        }
        // Only handle if not a context menu trigger
        if (e.button !== 2) {
          e.stopPropagation();
          // Prevent default behavior for form elements in edit mode
          // - labels: would focus the associated input
          // - inputs (checkbox, radio): would toggle checked state
          // - select: would open the dropdown
          if (htmlTag === 'label' || htmlTag === 'input' || htmlTag === 'select') {
            e.preventDefault();
          }
          // If this layer is inside a component, select the component layer instead
          const layerIdToSelect = parentComponentLayerId || layer.id;

          onLayerClick?.(layerIdToSelect, e);
        }
        if (originalOnClick) {
          originalOnClick(e);
        }
      };
      elementProps.onDoubleClick = (e: React.MouseEvent) => {
        if (isLockedByOther) return;
        e.stopPropagation();

        // Image layers: open file manager for quick image replacement
        if (layer.name === 'image' || htmlTag === 'img') {
          openImageFileManager();
          return;
        }

        // Rich text with components or inline variables: open sheet editor instead of canvas editing
        if (textEditable) {
          const textVar = layer.variables?.text;
          const richContent = textVar?.type === 'dynamic_rich_text' ? textVar.data.content : null;
          if (richContent && hasComponentOrVariable(richContent)) {
            useEditorStore.getState().openRichTextSheet(layer.id);
            return;
          }
        }

        // Text-editable layers: start inline editing
        startEditing(e.clientX, e.clientY);
      };
      // Prevent context menu from bubbling
      elementProps.onContextMenu = (e: React.MouseEvent) => {
        e.stopPropagation();
      };
      // Hover handlers for explicit hover state management
      if (onLayerHover) {
        elementProps.onMouseEnter = (e: React.MouseEvent) => {
          e.stopPropagation();
          if (!isEditing && !isLockedByOther && layer.id !== 'body') {
            // If this layer is inside a component, hover the component layer instead
            const layerIdToHover = parentComponentLayerId || layer.id;
            onLayerHover(layerIdToHover);
          }
        };
        elementProps.onMouseLeave = (e: React.MouseEvent) => {
          // Don't stop propagation - allow parent to detect mouse entry
          // Use the event target's owner document (iframe's document) to query within iframe
          const doc = (e.currentTarget as HTMLElement).ownerDocument;
          if (!doc) {
            onLayerHover(null);
            return;
          }

          const { clientX, clientY } = e;
          const elementUnderMouse = doc.elementFromPoint(clientX, clientY);

          if (elementUnderMouse) {
            // Use closest() to traverse up the DOM tree to find the actual layer element
            // This ensures we get the correct layer even if cursor is over a deeply nested child
            const targetLayerElement = elementUnderMouse.closest('[data-layer-id]') as HTMLElement | null;
            if (targetLayerElement) {
              const targetLayerId = targetLayerElement.getAttribute('data-layer-id');
              // Only set hover if it's a different layer (not the one we're leaving)
              if (targetLayerId && targetLayerId !== layer.id && targetLayerId !== 'body') {
                onLayerHover(targetLayerId);
                return;
              }
            }
          }

          // Not moving to a layer (or moving outside canvas) - clear hover
          onLayerHover(null);
        };
      }
    }

    // Handle special cases for void/self-closing elements
    if (htmlTag === 'img') {
      // Use default image if URL is empty or invalid
      const finalImageUrl = imageUrl && imageUrl.trim() !== '' ? imageUrl : DEFAULT_ASSETS.IMAGE;

      // Generate optimized src and srcset for responsive images
      const optimizedSrc = getOptimizedImageUrl(finalImageUrl, 1920, 1920, 85);
      const srcset = generateImageSrcset(finalImageUrl);
      const sizes = getImageSizes();

      const imageProps: Record<string, any> = {
        ...elementProps,
        alt: imageAlt,
        src: optimizedSrc,
      };

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

      // Keep select uncontrolled while still supporting default selection
      // from layer attributes (e.g. collection-sourced default option).
      if ('value' in elementProps) {
        elementProps.defaultValue = elementProps.value;
        delete elementProps.value;
      }

      if (isEditMode && layer.settings?.optionsSource?.collectionId) {
        return (
          <Tag {...elementProps}>
            <option disabled value="">(Options from collection)</option>
          </Tag>
        );
      }
    }

    // Handle button inside form - set type="submit" only when not in edit mode (preview and published)
    if (htmlTag === 'button' && isInsideForm && !isEditMode) {
      // Only override if type is not explicitly set or is 'button'
      if (!normalizedAttributes.type || normalizedAttributes.type === 'button') {
        elementProps.type = 'submit';
      }
    }

    // Block form submission in edit mode
    if (htmlTag === 'form' && isEditMode) {
      elementProps.onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
      };
    }

    // Handle form submission when not in edit mode (preview and published)
    if (htmlTag === 'form' && !isEditMode) {
      const formId = layer.settings?.id;
      const formSettings = layer.settings?.form;

      elementProps.onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        const form = e.currentTarget;
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

            const asset = assetsById[assetId] || getAsset(assetId);
            iconHtml = asset?.content || '';
          }
        } else if (isFieldVariable(iconSrc)) {
          const resolvedValue = resolveFieldValue(iconSrc, collectionLayerData, pageCollectionItemData, effectiveLayerDataMap);
          if (resolvedValue && typeof resolvedValue === 'string') {
            const asset = assetsById[resolvedValue] || getAsset(resolvedValue);
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

          // Only add editor event handlers in edit mode (client-side only)
          if (isEditMode && !isEditing) {
            const originalOnClick = elementProps.onClick as ((e: React.MouseEvent) => void) | undefined;
            iframeProps.onClick = (e: React.MouseEvent) => {
              if (isLockedByOther) {
                e.stopPropagation();
                e.preventDefault();
                return;
              }
              if (e.button !== 2) {
                e.stopPropagation();
                onLayerClick?.(layer.id, e);
              }
              if (originalOnClick) {
                originalOnClick(e);
              }
            };
            iframeProps.onContextMenu = (e: React.MouseEvent) => {
              e.stopPropagation();
            };
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

      if (mediaSrc) {
        mediaProps.src = mediaSrc;
      }

      if (posterUrl && htmlTag === 'video') {
        mediaProps.poster = posterUrl;
      }

      // Handle special attributes that need to be set on the DOM element (not as props)
      // Volume must be set via JavaScript on the DOM element
      if ((htmlTag === 'audio' || htmlTag === 'video') && normalizedAttributes?.volume) {
        const originalRef = mediaProps.ref;
        const volumeValue = parseInt(normalizedAttributes.volume) / 100; // Convert 0-100 to 0-1

        mediaProps.ref = (element: HTMLAudioElement | HTMLVideoElement | null) => {
          // Call original ref if it exists
          if (originalRef) {
            if (typeof originalRef === 'function') {
              originalRef(element);
            } else {
              (originalRef as React.MutableRefObject<HTMLAudioElement | HTMLVideoElement | null>).current = element;
            }
          }

          // Set volume on the DOM element
          if (element) {
            element.volume = volumeValue;
          }
        };
      }

      return (
        <Tag {...mediaProps}>
          {textContent && textContent}
          {effectiveChildren && effectiveChildren.length > 0 && (
            <LayerRenderer
              layers={effectiveChildren}
              onLayerClick={onLayerClick}
              onLayerUpdate={onLayerUpdate}
              onLayerHover={onLayerHover}
              selectedLayerId={selectedLayerId}
              hoveredLayerId={hoveredLayerId}
              isEditMode={isEditMode}
              isPublished={isPublished}
              enableDragDrop={enableDragDrop}
              activeLayerId={activeLayerId}
              projected={projected}
              pageId={pageId}
              collectionItemData={collectionLayerData}
              collectionItemId={collectionLayerItemId}
              layerDataMap={effectiveLayerDataMap}
              pageCollectionItemId={pageCollectionItemId}
              pageCollectionItemData={pageCollectionItemData}
              pages={pages}
              folders={folders}
              collectionItemSlugs={collectionItemSlugs}
              isPreview={isPreview}
              translations={translations}
              anchorMap={anchorMap}
              resolvedAssets={resolvedAssets}
              hiddenLayerInfo={hiddenLayerInfo}
              editorHiddenLayerIds={editorHiddenLayerIds}
              editorBreakpoint={editorBreakpoint}
              currentLocale={currentLocale}
              availableLocales={availableLocales}
              localeSelectorFormat={localeSelectorFormat}
              liveLayerUpdates={liveLayerUpdates}
              isInsideForm={isInsideForm}
              parentFormSettings={parentFormSettings}
              components={componentsProp}
              ancestorComponentIds={effectiveAncestorIds}
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

    // Text-editable elements with inline editing using CanvasTextEditor
    if (textEditable && isEditing) {
      // Get current value for editor - use rich text content if available
      const textVar = layer.variables?.text;
      const editorValue = textVar?.type === 'dynamic_rich_text'
        ? textVar.data.content
        : textVar?.type === 'dynamic_text'
          ? textVar.data.content
          : '';

      return (
        <Tag
          {...elementProps}
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        >
          <CanvasTextEditor
            layer={layer}
            value={editorValue}
            onChange={handleEditorChange}
            onFinish={finishEditing}
            collectionItemData={collectionLayerData}
            clickCoords={editingClickCoords}
          />
        </Tag>
      );
    }

    // Collection layers - repeat the element for each item (design applies to each looped item)
    if (isCollectionLayer && isEditMode) {
      if (isLoadingLayerData) {
        return (
          <Tag {...elementProps}>
            <div className="w-full p-4">
              <ShimmerSkeleton
                count={3}
                height="60px"
                gap="1rem"
              />
            </div>
          </Tag>
        );
      }

      if (collectionItems.length === 0) {
        let emptyMessage = 'No collection items';
        if (!collectionId) {
          emptyMessage = 'No collection selected';
        } else if (sourceFieldType === 'multi_asset' && multiAssetSourceField) {
          emptyMessage = `The CMS item has no ${multiAssetSourceField.type}s`;
        }
        return (
          <Tag {...elementProps}>
            <div className="text-muted-foreground text-sm p-4 text-center">
              {emptyMessage}
            </div>
          </Tag>
        );
      }

      // Repeat the element for each collection item
      return (
        <>
          {collectionItems.map((item, index) => {
            // Get collection fields for reference resolution
            const collectionFields = collectionId ? fieldsByCollectionId[collectionId] || [] : [];

            // Resolve reference fields to add relationship paths (e.g., "refFieldId.targetFieldId")
            const enhancedItemValues = collectionFields.length > 0
              ? resolveReferenceFieldsSync(
                item.values || {},
                collectionFields,
                itemsByCollectionId,
                fieldsByCollectionId
              )
              : (item.values || {});

            // Merge parent collection data with enhanced item values
            // Parent data provides access to fields from outer collection layers
            // Enhanced item values (with resolved references) take precedence
            const mergedItemData = {
              ...collectionLayerData,
              ...enhancedItemValues,
            };

            // Build layer data map for layer-specific field resolution
            // Add this collection layer's enhanced data (with resolved references) to the map
            const updatedLayerDataMap = {
              ...effectiveLayerDataMap,
              [layer.id]: enhancedItemValues,
            };

            // Resolve per-item background image from CMS field variable → CSS variable (combined with gradient)
            let itemElementProps = elementProps;
            if (bgImageVariable && isFieldVariable(bgImageVariable) && bgImageVariable.data.field_id) {
              const resolvedBgAssetId = resolveFieldValue(bgImageVariable, mergedItemData, pageCollectionItemData, updatedLayerDataMap);
              if (resolvedBgAssetId) {
                const bgAsset = assetsById[resolvedBgAssetId] || getAsset(resolvedBgAssetId);
                const bgUrl = bgAsset?.public_url || resolvedBgAssetId;
                const cssUrl = bgUrl.startsWith('url(') ? bgUrl : `url(${bgUrl})`;
                itemElementProps = {
                  ...elementProps,
                  style: {
                    ...(elementProps.style as Record<string, unknown> || {}),
                    '--bg-img': combineBgValues(cssUrl, staticGradVars?.['--bg-img']),
                  },
                };
              }
            }

            return (
              <Tag
                key={item.id}
                {...itemElementProps}
                data-collection-item-id={item.id}
                data-layer-id={layer.id} // Keep same layer ID for all instances
              >
                {textContent && textContent}

                {effectiveChildren && effectiveChildren.length > 0 && (
                  <LayerRenderer
                    layers={effectiveChildren}
                    onLayerClick={onLayerClick}
                    onLayerUpdate={onLayerUpdate}
                    onLayerHover={onLayerHover}
                    selectedLayerId={selectedLayerId}
                    hoveredLayerId={hoveredLayerId}
                    isEditMode={isEditMode}
                    isPublished={isPublished}
                    enableDragDrop={enableDragDrop}
                    activeLayerId={activeLayerId}
                    projected={projected}
                    pageId={pageId}
                    collectionItemData={mergedItemData}
                    collectionItemId={item.id}
                    layerDataMap={updatedLayerDataMap}
                    pageCollectionItemId={pageCollectionItemId}
                    pageCollectionItemData={pageCollectionItemData}
                    hiddenLayerInfo={hiddenLayerInfo}
                    editorHiddenLayerIds={editorHiddenLayerIds}
                    editorBreakpoint={editorBreakpoint}
                    currentLocale={currentLocale}
                    availableLocales={availableLocales}
                    liveLayerUpdates={liveLayerUpdates}
                    parentComponentLayerId={parentComponentLayerId || (layer.componentId ? layer.id : undefined)}
                    parentComponentOverrides={parentComponentOverrides}
                    parentComponentVariables={parentComponentVariables}
                    editingComponentVariables={editingComponentVariables}
                    isInsideForm={isInsideForm || htmlTag === 'form'}
                    parentFormSettings={htmlTag === 'form' ? layer.settings?.form : parentFormSettings}
                    pages={pages}
                    folders={folders}
                    collectionItemSlugs={collectionItemSlugs}
                    isPreview={isPreview}
                    translations={translations}
                    anchorMap={anchorMap}
                    resolvedAssets={resolvedAssets}
                    components={componentsProp}
                    ancestorComponentIds={effectiveAncestorIds}
                  />
                )}
              </Tag>
            );
          })}
        </>
      );
    }

    // Special handling for locale selector wrapper (name='localeSelector')
    if (layer.name === 'localeSelector' && !isEditMode && availableLocales && availableLocales.length > 0) {
      // Extract current page slug from URL (LocaleSelector handles this internally)
      const currentPageSlug = typeof window !== 'undefined'
        ? window.location.pathname.slice(1).replace(/^ycode\/preview\/?/, '')
        : '';

      // Get format setting from this layer to pass to children
      const format = layer.settings?.locale?.format || 'locale';

      return (
        <Tag {...elementProps} style={mergedStyle}>
          {textContent && textContent}

          {/* Render children with format prop */}
          {effectiveChildren && effectiveChildren.length > 0 && (
            <LayerRenderer
              layers={effectiveChildren}
              onLayerClick={onLayerClick}
              onLayerUpdate={onLayerUpdate}
              onLayerHover={onLayerHover}
              selectedLayerId={selectedLayerId}
              hoveredLayerId={hoveredLayerId}
              isEditMode={isEditMode}
              isPublished={isPublished}
              enableDragDrop={enableDragDrop}
              activeLayerId={activeLayerId}
              projected={projected}
              pageId={pageId}
              collectionItemData={collectionLayerData}
              collectionItemId={collectionLayerItemId}
              layerDataMap={effectiveLayerDataMap}
              pageCollectionItemId={pageCollectionItemId}
              pageCollectionItemData={pageCollectionItemData}
              pages={pages}
              folders={folders}
              collectionItemSlugs={collectionItemSlugs}
              isPreview={isPreview}
              translations={translations}
              anchorMap={anchorMap}
              resolvedAssets={resolvedAssets}
              hiddenLayerInfo={hiddenLayerInfo}
              editorHiddenLayerIds={editorHiddenLayerIds}
              editorBreakpoint={editorBreakpoint}
              currentLocale={currentLocale}
              availableLocales={availableLocales}
              localeSelectorFormat={format}
              liveLayerUpdates={liveLayerUpdates}
              parentComponentLayerId={layer.componentId ? layer.id : parentComponentLayerId}
              parentComponentOverrides={parentComponentOverrides}
              parentComponentVariables={parentComponentVariables}
              editingComponentVariables={editingComponentVariables}
              isInsideForm={isInsideForm || htmlTag === 'form'}
              parentFormSettings={htmlTag === 'form' ? layer.settings?.form : parentFormSettings}
              components={componentsProp}
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

    // In edit mode, slides wrapper shows only the slide containing the selection
    // Regular elements with text and/or children
    return (
      <Tag {...elementProps}>
        {/* Collaboration indicators - only show in edit mode */}
        {isEditMode && isLockedByOther && (
          <LayerLockIndicator layerId={layer.id} layerName={layer.name} />
        )}
        {isEditMode && isSelected && !isLockedByOther && (
          <EditingIndicator layerId={layer.id} className="absolute -top-8 right-0 z-20" />
        )}

        {textContent && textContent}

        {/* Render children */}
        {effectiveChildren && effectiveChildren.length > 0 && (
          <LayerRenderer
            layers={effectiveChildren}
            onLayerClick={onLayerClick}
            onLayerUpdate={onLayerUpdate}
            onLayerHover={onLayerHover}
            selectedLayerId={selectedLayerId}
            hoveredLayerId={hoveredLayerId}
            isEditMode={isEditMode}
            isPublished={isPublished}
            enableDragDrop={enableDragDrop}
            activeLayerId={activeLayerId}
            projected={projected}
            pageId={pageId}
            collectionItemData={collectionLayerData}
            collectionItemId={collectionLayerItemId}
            layerDataMap={effectiveLayerDataMap}
            pageCollectionItemId={pageCollectionItemId}
            pageCollectionItemData={pageCollectionItemData}
            hiddenLayerInfo={hiddenLayerInfo}
            editorHiddenLayerIds={editorHiddenLayerIds}
            editorBreakpoint={editorBreakpoint}
            currentLocale={currentLocale}
            availableLocales={availableLocales}
            localeSelectorFormat={localeSelectorFormat}
            liveLayerUpdates={liveLayerUpdates}
            parentComponentLayerId={parentComponentLayerId || (layer.componentId ? layer.id : undefined)}
            parentComponentOverrides={parentComponentOverrides}
            parentComponentVariables={parentComponentVariables}
            editingComponentVariables={editingComponentVariables}
            isInsideForm={isInsideForm || htmlTag === 'form'}
            parentFormSettings={htmlTag === 'form' ? layer.settings?.form : parentFormSettings}
            pages={pages}
            folders={folders}
            collectionItemSlugs={collectionItemSlugs}
            isPreview={isPreview}
            translations={translations}
            anchorMap={anchorMap}
            resolvedAssets={resolvedAssets}
            components={componentsProp}
            ancestorComponentIds={effectiveAncestorIds}
          />
        )}
      </Tag>
    );
  };

  // For collection layers in edit mode, return early without context menu wrapper
  // (Context menu doesn't work properly with Fragments)
  if (isCollectionLayer && isEditMode) {
    return renderContent();
  }

  // Wrap with context menu in edit mode
  // Don't wrap layers inside component instances (they're not directly editable)
  let content = renderContent();

  // Wrap with link if layer has link settings (published mode only)
  // In edit mode, links are not interactive to allow layer selection
  // Skip for buttons — they render as <a> directly (see isButtonWithLink)
  const linkSettings = layer.variables?.link;
  const shouldWrapWithLink = !isEditMode && !isButtonWithLink && isValidLinkSettings(linkSettings);

  if (shouldWrapWithLink && linkSettings) {
    // Build link context for layer-level link resolution
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
    };
    const linkHref = generateLinkHref(linkSettings, layerLinkContext);

    if (linkHref) {
      const linkTarget = linkSettings.target || '_self';
      const linkRel = linkSettings.rel || (linkTarget === '_blank' ? 'noopener noreferrer' : undefined);
      const linkDownload = linkSettings.download;

      content = (
        <a
          href={linkHref}
          target={linkTarget}
          rel={linkRel}
          download={linkDownload || undefined}
          className="contents"
        >
          {content}
        </a>
      );
    }
  }

  if (isEditMode && pageId && !isEditing && !parentComponentLayerId) {
    const isLocked = layer.id === 'body';

    return (
      <LayerContextMenu
        layerId={layer.id}
        pageId={pageId}
        isLocked={isLocked}
        onLayerSelect={onLayerClick}
        selectedLayerId={selectedLayerId}
        liveLayerUpdates={liveLayerUpdates}
        liveComponentUpdates={liveComponentUpdates}
      >
        {content}
      </LayerContextMenu>
    );
  }

  return content;
};

export default LayerRenderer;
