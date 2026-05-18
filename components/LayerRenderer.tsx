'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import LayerLockIndicator from '@/components/collaboration/LayerLockIndicator';
import EditingIndicator from '@/components/collaboration/EditingIndicator';
import { useCollaborationPresenceStore, getResourceLockKey, RESOURCE_TYPES } from '@/stores/useCollaborationPresenceStore';
import { useAuthStore } from '@/stores/useAuthStore';
import type { Layer, Locale, ComponentVariable, FormSettings, LinkSettings, Breakpoint, CollectionItemWithValues, Component } from '@/types';
import type { UseLiveLayerUpdatesReturn } from '@/hooks/use-live-layer-updates';
import type { UseLiveComponentUpdatesReturn } from '@/hooks/use-live-component-updates';
import { getLayerHtmlTag, getClassesString, getText, resolveFieldValue, isTextEditable, isTextContentLayer, isRichTextLayer, getCollectionVariable, evaluateVisibility, findAncestorByName, filterDisabledSliderLayers, getLayerCmsFieldBinding, findLayerById } from '@/lib/layer-utils';
import { getMapIframeProps, DEFAULT_MAP_SETTINGS, resolveMarkerColor } from '@/lib/map-utils';
import { SWIPER_CLASS_MAP, SWIPER_DATA_ATTR_MAP } from '@/lib/slider-constants';
import { useCanvasSlider } from '@/hooks/use-canvas-slider';
import { resolveFieldFromSources } from '@/lib/cms-variables-utils';
import { getDynamicTextContent, getImageUrlFromVariable, getVideoUrlFromVariable, getIframeUrlFromVariable, isFieldVariable, isAssetVariable, isStaticTextVariable, isDynamicTextVariable, getAssetId, getStaticTextContent, createAssetVariable, createDynamicTextVariable, resolveDesignStyles } from '@/lib/variable-utils';
import { getTranslatedAssetId, getTranslatedText, applyCmsTranslations, injectTranslatedText } from '@/lib/localisation-utils';
import { isValidLinkSettings } from '@/lib/link-utils';
import { DEFAULT_ASSETS, ASSET_CATEGORIES, isAssetOfType } from '@/lib/asset-utils';
import { parseMultiAssetFieldValue, buildAssetVirtualValues } from '@/lib/multi-asset-utils';
import { parseMultiReferenceValue, resolveReferenceFieldsSync } from '@/lib/collection-utils';
import { MULTI_ASSET_COLLECTION_ID } from '@/lib/collection-field-utils';
import { buildImageSizes, generateImageSrcset, getOptimizedImageUrl, parseImageDimension } from '@/lib/asset-utils';
import { useEditorStore } from '@/stores/useEditorStore';
import { toast } from 'sonner';
import { resolveInlineVariablesFromData } from '@/lib/inline-variables';
import { renderRichText, hasBlockElementsWithInlineVariables, getTextStyleClasses, flattenTiptapParagraphs, type RichTextLinkContext, type RenderComponentBlockFn } from '@/lib/text-format-utils';
import { hasComponentOrVariable } from '@/lib/tiptap-utils';
import LayerContextMenu from '@/app/(builder)/ycode/components/LayerContextMenu';
import CanvasTextEditor from '@/app/(builder)/ycode/components/CanvasTextEditor';
import { useComponentsStore } from '@/stores/useComponentsStore';
import { getComponentVariantLayers } from '@/lib/component-variant-utils';
import { useCollectionLayerStore } from '@/stores/useCollectionLayerStore';
import { useCurrentUserStore } from '@/stores/useCurrentUserStore';
import { useFilterStore } from '@/stores/useFilterStore';
import { useCollectionsStore } from '@/stores/useCollectionsStore';
import { useAssetsStore } from '@/stores/useAssetsStore';
import { useColorVariablesStore } from '@/stores/useColorVariablesStore';
import { ShimmerSkeleton } from '@/components/ui/shimmer-skeleton';
import { combineBgValues, mergeStaticBgVars } from '@/lib/tailwind-class-mapper';
import { clsx } from 'clsx';
import PaginatedCollection from '@/components/PaginatedCollection';
import LoadMoreCollection from '@/components/LoadMoreCollection';
import FilterableCollection from '@/components/FilterableCollection';
import LocaleSelector from '@/components/layers/LocaleSelector';
import AuthForm from '@/components/layers/AuthForm';
import UserStatus from '@/components/layers/UserStatus';
import Icon from '@/components/ui/icon';
import { usePagesStore } from '@/stores/usePagesStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { generateLinkHref, resolveLinkAttrs, isLinkAtCollectionBoundary, type LinkResolutionContext } from '@/lib/link-utils';
import { collectEditorHiddenLayerIds, type HiddenLayerInfo } from '@/lib/animation-utils';
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
  /** Ordered ids of the dynamic page's collection — powers `next-item` / `previous-item` link keywords. */
  pageCollectionSortedItemIds?: string[];
  hiddenLayerInfo?: HiddenLayerInfo[]; // Layer IDs with breakpoint info for animations
  editorHiddenLayerIds?: Map<string, Breakpoint[]>; // Layer IDs to hide on canvas (edit mode only) with breakpoint info
  editorBreakpoint?: Breakpoint; // Current breakpoint in editor
  currentLocale?: Locale | null;
  availableLocales?: Locale[];
  localeSelectorFormat?: 'locale' | 'code'; // Format for locale selector label (inherited from parent)
  liveLayerUpdates?: UseLiveLayerUpdatesReturn | null; // For collaboration broadcasts
  liveComponentUpdates?: UseLiveComponentUpdatesReturn | null; // For component collaboration broadcasts
  parentComponentLayerId?: string; // ID of the parent component layer (if rendering inside a component)
  parentComponentId?: string; // ID of the parent component (mirror of parentComponentLayerId for double-click-to-edit)
  parentComponentOverrides?: Layer['componentOverrides']; // Override values from parent component instance
  parentComponentVariables?: ComponentVariable[]; // Component's variables for default value lookup
  editingComponentVariables?: ComponentVariable[]; // Variables when directly editing a component
  isInsideForm?: boolean; // Whether this layer is inside a form (for button type handling)
  isInsideLink?: boolean; // Whether this layer is inside an ancestor <a> (prevents nested <a> tags)
  parentFormSettings?: FormSettings; // Form settings from parent form layer
  pages?: any[]; // Pages for link resolution
  folders?: any[]; // Folders for link resolution
  collectionItemSlugs?: Record<string, string>; // Maps collection_item_id -> slug value for link resolution
  isPreview?: boolean; // Whether we're in preview mode (prefix links with /ycode/preview)
  translations?: Record<string, any> | null; // Translations for localized URL generation
  anchorMap?: Record<string, string>; // Pre-built map of layerId -> anchor value for O(1) lookups
  /** Pre-resolved assets (asset_id -> { url, width, height }) for SSR resolution */
  resolvedAssets?: Record<string, { url: string; width?: number | null; height?: number | null }>;
  /** Components for resolving embedded component nodes in rich-text (preview/published) */
  components?: Component[];
  /** Component IDs in the rendering chain, used to prevent circular loops through collection rich-text data */
  ancestorComponentIds?: Set<string>;
  /** Whether these layers are direct children of a slides wrapper (adds swiper-slide class) */
  isSlideChild?: boolean;
  /** Server-side settings (for preview/published pages where Zustand store is not available) */
  serverSettings?: Record<string, unknown>;
  /** When true, the component root layer (layer.id === parentComponentLayerId) renders its own context menu */
  componentRootContextMenu?: boolean;
  /** Called when a component instance is double-clicked on the canvas (edit mode only). */
  onComponentEdit?: (componentId: string, instanceLayerId: string) => void;
  /**
   * Layer id of the LCP candidate image. When this image renders it gets
   * `loading="eager"` + `fetchpriority="high"` regardless of any
   * `attributes.loading` value, so the browser prioritizes the hero image
   * over the rest of the page. Computed server-side by PageRenderer.
   */
  lcpCandidateLayerId?: string | null;
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
  pageCollectionSortedItemIds,
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
  parentComponentId,
  parentComponentOverrides,
  parentComponentVariables,
  editingComponentVariables,
  isInsideForm = false,
  isInsideLink = false,
  parentFormSettings,
  pages: pagesProp,
  folders: foldersProp,
  isPreview = false,
  translations,
  anchorMap: anchorMapProp,
  resolvedAssets,
  components: componentsProp,
  ancestorComponentIds,
  isSlideChild: isSlideChildProp,
  serverSettings,
  componentRootContextMenu,
  onComponentEdit,
  lcpCandidateLayerId,
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
        pageCollectionSortedItemIds={pageCollectionSortedItemIds}
        hiddenLayerInfo={hiddenLayerInfo}
        editorHiddenLayerIds={editorHiddenLayerIds}
        editorBreakpoint={editorBreakpoint}
        currentLocale={currentLocale}
        availableLocales={availableLocales}
        localeSelectorFormat={localeSelectorFormat}
        liveLayerUpdates={liveLayerUpdates}
        liveComponentUpdates={liveComponentUpdates}
        parentComponentLayerId={parentComponentLayerId}
        parentComponentId={parentComponentId}
        parentComponentOverrides={parentComponentOverrides}
        parentComponentVariables={parentComponentVariables}
        editingComponentVariables={editingComponentVariables}
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
        componentRootContextMenu={componentRootContextMenu}
        onComponentEdit={onComponentEdit}
        lcpCandidateLayerId={lcpCandidateLayerId}
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
const LayerItemImpl: React.FC<{
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
  /** Ordered ids of the dynamic page's collection — powers `next-item` / `previous-item` link keywords. */
  pageCollectionSortedItemIds?: string[];
  hiddenLayerInfo?: HiddenLayerInfo[];
  editorHiddenLayerIds?: Map<string, Breakpoint[]>;
  editorBreakpoint?: Breakpoint;
  currentLocale?: Locale | null;
  availableLocales?: Locale[];
  localeSelectorFormat?: 'locale' | 'code';
  liveLayerUpdates?: UseLiveLayerUpdatesReturn | null;
  liveComponentUpdates?: UseLiveComponentUpdatesReturn | null;
  parentComponentLayerId?: string; // ID of the parent component layer (if this layer is inside a component)
  parentComponentId?: string; // ID of the parent component (mirrors parentComponentLayerId)
  parentComponentOverrides?: Layer['componentOverrides']; // Override values from parent component instance
  parentComponentVariables?: ComponentVariable[]; // Component's variables for default value lookup
  editingComponentVariables?: ComponentVariable[]; // Variables when directly editing a component
  isInsideForm?: boolean; // Whether this layer is inside a form
  isInsideLink?: boolean; // Whether this layer is inside an ancestor <a>
  parentFormSettings?: FormSettings; // Form settings from parent form layer
  pages?: any[]; // Pages for link resolution
  folders?: any[]; // Folders for link resolution
  collectionItemSlugs?: Record<string, string>; // Maps collection_item_id -> slug value for link resolution
  isPreview?: boolean; // Whether we're in preview mode
  translations?: Record<string, any> | null; // Translations for localized URL generation
  anchorMap?: Record<string, string>; // Pre-built map of layerId -> anchor value
  resolvedAssets?: Record<string, { url: string; width?: number | null; height?: number | null }>;
  components?: Component[];
  ancestorComponentIds?: Set<string>;
  isSlideChild?: boolean;
  serverSettings?: Record<string, unknown>;
  componentRootContextMenu?: boolean;
  onComponentEdit?: (componentId: string, instanceLayerId: string) => void;
  lcpCandidateLayerId?: string | null;
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
  pageCollectionSortedItemIds,
  hiddenLayerInfo,
  editorHiddenLayerIds,
  editorBreakpoint,
  currentLocale,
  availableLocales,
  localeSelectorFormat,
  liveLayerUpdates,
  liveComponentUpdates,
  parentComponentLayerId,
  parentComponentId,
  parentComponentOverrides,
  parentComponentVariables,
  editingComponentVariables,
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
  onComponentEdit,
  ancestorComponentIds,
  isSlideChild,
  serverSettings,
  componentRootContextMenu,
  lcpCandidateLayerId,
}) => {
  const previewUserId = usePagesStore((s) => s.previewUserId);
  const isPreviewMode = useEditorStore((s) => s.isPreviewMode);
  const currentUserProfile = useCurrentUserStore((s) => s.profile);

  // Subscribe to selection state from the store for reactive updates without
  // forcing the entire LayerRenderer tree to re-render when selection changes
  const isSelected = useEditorStore((state) => state.selectedLayerId === layer.id);
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
    ...(currentUserProfile ? { current_user: currentUserProfile } : {}),
  }), [layerDataMap, layer._layerDataMap, currentUserProfile]);
  // Track component scope for circular reference detection (works in both edit and published modes)
  const effectiveAncestorIds = useMemo(() => {
    if (!layer.componentId) return ancestorComponentIds;
    const set = new Set(ancestorComponentIds);
    set.add(layer.componentId);
    return set;
  }, [ancestorComponentIds, layer.componentId]);
  const getAssetFromStore = useAssetsStore((state) => state.getAsset);
  const assetsById = useAssetsStore((state) => state.assetsById);
  const settingsByKey = useSettingsStore((state) => state.settingsByKey);
  const colorVariables = useColorVariablesStore((state) => state.colorVariables);
  const timezone = (settingsByKey.timezone as string | null) ?? 'UTC';

  // Create asset resolver that checks pre-resolved assets first (SSR), then falls back to store
  const getAsset = useCallback((id: string) => {
    if (resolvedAssets?.[id]) {
      const { url, width, height } = resolvedAssets[id];
      if (url.startsWith('<')) {
        return { public_url: null, content: url };
      }
      return { public_url: url, width, height };
    }
    return getAssetFromStore(id);
  }, [resolvedAssets, getAssetFromStore]);
  const openFileManager = useEditorStore((state) => state.openFileManager);
  const storeComponents = useComponentsStore((state) => state.components);
  const allComponents = storeComponents.length > 0 ? storeComponents : (componentsProp ?? []);

  // Shared props passed to nested LayerRenderer calls (component instances & rich-text components)
  // selectedLayerId and hoveredLayerId are omitted: each SingleLayerRenderer subscribes
  // directly to useEditorStore for selection state to avoid cascading re-renders.
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
    pageCollectionSortedItemIds,
    hiddenLayerInfo,
    editorHiddenLayerIds,
    editorBreakpoint,
    currentLocale,
    availableLocales,
    localeSelectorFormat,
    liveLayerUpdates,
    liveComponentUpdates,
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
    onComponentEdit,
    lcpCandidateLayerId,
  // selectedLayerId and hoveredLayerId kept in the object for SSR/published mode
  // but excluded from deps so changes don't cascade re-renders in edit mode.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [isEditMode, isPublished, onLayerClick, onLayerUpdate, onLayerHover, pageId, collectionLayerData, collectionLayerItemId, effectiveLayerDataMap, pageCollectionItemId, pageCollectionItemData, pageCollectionSortedItemIds, hiddenLayerInfo, editorHiddenLayerIds, editorBreakpoint, currentLocale, availableLocales, localeSelectorFormat, liveLayerUpdates, liveComponentUpdates, isInsideForm, isInsideLink, parentFormSettings, pages, folders, collectionItemSlugs, isPreview, translations, anchorMap, resolvedAssets, componentsProp, serverSettings, onComponentEdit, lcpCandidateLayerId]);

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
            <AnimationInitializer
              layers={uniqueLayers}
              injectInitialCSS
            />
          </>
        )}
      </React.Fragment>
      );
    },
    [layer.id, sharedRendererProps, isEditMode]
  );

  let htmlTag = getLayerHtmlTag(layer);

  const isSimpleTextLayer = isTextContentLayer(layer);

  // Check if we need to override the tag for rich text with block elements
  // Tags like <p>, <h1>-<h6> cannot contain block elements like <ul>/<ol>
  const textVariable = layer.variables?.text;
  let useSpanForParagraphs = false;

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
        const variableDef = componentVariables.find(v => v.id === linkedVariableId);
        const overrideCategory = variableDef?.type === 'rich_text' ? 'rich_text' : 'text';
        const overrideValue = parentComponentOverrides?.[overrideCategory]?.[linkedVariableId];
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
      // Block-level expansion (lists, tables, embedded components) cannot live
      // inside <p>/<h*>/<span>; switch the wrapper to a <div> regardless of
      // whether this is a simple text layer or a richText layer.
      htmlTag = 'div';
    } else if (!isSimpleTextLayer && (textVariable?.type === 'dynamic_rich_text' || (textVariable as any)?.id)) {
      // For non-simple-text layers with rich-text content but no block
      // expansion, render paragraphs as <span class="block"> to keep them
      // valid inside the existing wrapper.
      useSpanForParagraphs = true;
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
    && !isInsideForm
    && !isInsideLink
    && isValidLinkSettings(layer.variables?.link);
  if (isButtonWithLink) {
    htmlTag = 'a';
  }

  // Divs with link settings render as <a> directly instead of being
  // wrapped in <a class="contents"><div>…</div></a>.
  // Only match actual div layers (layer.name === 'div'), not other layers
  // whose tag was forced to 'div' by earlier overrides (e.g. headings with lists).
  const isDivWithLink = !isButtonWithLink
    && !isInsideLink
    && layer.name === 'div'
    && htmlTag === 'div'
    && layer.id !== 'body'
    && !(isEditing && textEditable)
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
    const checkboxGroupNames: Record<string, string> = {};
    const inputs = container.querySelectorAll('input, select, textarea');
    inputs.forEach(el => {
      const inputEl = el as HTMLInputElement;
      const inputLayerId = inputEl.closest('[data-layer-id]')?.getAttribute('data-layer-id');
      if (!inputLayerId) return;
      const nameAttr = inputEl.getAttribute('name');
      const paramName = nameAttr || (inputLayerId.startsWith('lyr-') ? inputLayerId.slice(4) : inputLayerId);
      nameMap[inputLayerId] = paramName;
      reverseMap[paramName] = inputLayerId;
      if (inputEl.type === 'checkbox' || inputEl.type === 'radio') {
        const cbMatch = inputLayerId.match(/^(.+)-(?:cb|rb)-.+-input$/);
        if (cbMatch) {
          checkboxGroupNames[cbMatch[1]] = (nameAttr || '').replace(/\[\]$/, '') || cbMatch[1];
        }
      }
    });
    for (const [baseId, baseName] of Object.entries(checkboxGroupNames)) {
      nameMap[baseId] = baseName;
      reverseMap[baseName] = baseId;
    }
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
      if (!inputEl) {
        const cbInputs = container.querySelectorAll(
          `[data-layer-id^="${inputLayerId}-cb-"] input[type="checkbox"], [data-layer-id^="${inputLayerId}-rb-"] input[type="radio"]`
        );
        if (cbInputs.length > 0) {
          const checkedSet = new Set(value.split(','));
          cbInputs.forEach(cb => {
            (cb as HTMLInputElement).checked = checkedSet.has((cb as HTMLInputElement).value);
          });
        }
        return;
      }
      if (inputEl.type === 'checkbox') {
        inputEl.checked = value === inputEl.value || value === 'true';
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
      const checkboxGroups: Record<string, string[]> = {};
      const inputs = container.querySelectorAll('input, select, textarea');
      inputs.forEach(el => {
        const inputEl = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        const inputLayerId = inputEl.closest('[data-layer-id]')?.getAttribute('data-layer-id');
        if (!inputLayerId) return;
        const nameAttr = inputEl.getAttribute('name');
        if (nameAttr) nameMap[inputLayerId] = nameAttr;
        if (inputEl.type === 'checkbox' || inputEl.type === 'radio') {
          const checked = (inputEl as HTMLInputElement).checked;
          const val = checked ? ((inputEl as HTMLInputElement).value || 'true') : '';
          inputValues[inputLayerId] = val;
          const cbMatch = inputLayerId.match(/^(.+)-(?:cb|rb)-.+-input$/);
          if (cbMatch) {
            const baseId = cbMatch[1];
            if (!checkboxGroups[baseId]) checkboxGroups[baseId] = [];
            if (val) checkboxGroups[baseId].push(val);
            if (nameAttr) nameMap[baseId] = nameAttr.replace(/\[\]$/, '');
          }
        } else {
          inputValues[inputLayerId] = inputEl.value;
        }
      });
      for (const [baseId, values] of Object.entries(checkboxGroups)) {
        inputValues[baseId] = values.join(',');
      }
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
    // Special handling for locale selector label.
    // Runs in both edit and runtime modes so the builder canvas reflects the
    // active locale chosen via the header dropdown — otherwise the label
    // would show stale placeholder text while the rest of the canvas updates.
    if (layer.key === 'localeSelectorLabel') {
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
        pageCollectionSortedItemIds,
      };

    // Check for component variable override or default value
    // This handles both:
    // 1. Component instances on a page (parentComponentVariables is set)
    // 2. Directly editing a component (editingComponentVariables is set)
    const componentVariables = parentComponentVariables || editingComponentVariables;
    const linkedVariableId = textVariable?.id;
    if (linkedVariableId && componentVariables) {
      const variableDef = componentVariables.find(v => v.id === linkedVariableId);
      const overrideCategory = variableDef?.type === 'rich_text' ? 'rich_text' : 'text';
      const overrideValue = parentComponentOverrides?.[overrideCategory]?.[linkedVariableId];
      const valueToRender = overrideValue ?? variableDef?.default_value;

      if (valueToRender !== undefined) {
        // Value is typed as ComponentVariableValue - check if it's a text variable (has 'type' property)
        if ('type' in valueToRender && valueToRender.type === 'dynamic_rich_text') {
          return renderRichText(valueToRender as any, collectionLayerData, pageCollectionItemData || undefined, layer.textStyles, useSpanForParagraphs, isEditMode, linkContext, timezone, effectiveLayerDataMap, allComponents, renderComponentBlock, effectiveAncestorIds, isSimpleTextLayer);
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
      // For heading/text elements, flatten multi-paragraph content into single paragraph with <br>
      const variable = isSimpleTextLayer
        ? { ...textVariable, data: { ...textVariable.data, content: flattenTiptapParagraphs(textVariable.data.content) } }
        : textVariable;
      return renderRichText(variable as any, collectionLayerData, pageCollectionItemData || undefined, layer.textStyles, useSpanForParagraphs, isEditMode, linkContext, timezone, effectiveLayerDataMap, allComponents, renderComponentBlock, effectiveAncestorIds, isSimpleTextLayer);
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
  // This enables animations to target the correct elements when multiple instances exist.
  //
  // Also inject translations for the active locale: in edit mode the component
  // is re-resolved here from the store, bypassing the canvas-level
  // injectTranslatedText pass on the serialized page layers. Without injecting
  // here, component content would always render in the default language even
  // when the user previews a non-default locale on a page.
  // If this nested-component instance has its variant choice driven by a
  // parent component variable, resolve the effective variant id from the
  // parent's override (or the variable's default). Mirrors the SSR branch in
  // `applyComponentOverrides`; without this the canvas keeps using the
  // baked-in `componentVariantId` and ignores instance-level overrides.
  const effectiveVariantId = useMemo(() => {
    const linkedId = layer.componentVariantVariableId;
    if (!linkedId) return layer.componentVariantId;
    const variableDef = parentComponentVariables?.find(v => v.id === linkedId);
    const overrideValue = parentComponentOverrides?.variant?.[linkedId];
    const value = (overrideValue ?? variableDef?.default_value) as { variant_id?: string } | undefined;
    return value?.variant_id ?? layer.componentVariantId;
  }, [layer.componentVariantVariableId, layer.componentVariantId, parentComponentVariables, parentComponentOverrides]);

  const transformedComponentLayers = useMemo(() => {
    if (!isEditMode || !component) return null;
    // Pick the variant the instance is bound to (silently falls back to the
    // first variant when the requested one was deleted).
    const variantLayers = getComponentVariantLayers(component, effectiveVariantId);
    if (!variantLayers.length) return null;
    const transformed = transformLayerIdsForInstance(variantLayers, layer.id);
    if (!currentLocale || currentLocale.is_default || !translations) {
      return transformed;
    }
    return injectTranslatedText(transformed, pageId || component.id, translations, {
      includeIncomplete: true,
      defaultMasterComponentId: component.id,
    });
  }, [isEditMode, component, layer.id, effectiveVariantId, currentLocale, translations, pageId]);

  // Collect hidden layer IDs from the component's transformed layers
  // Needed because Canvas computes editorHiddenLayerIds from serializeLayers (different ID transform)
  const componentEditorHiddenLayerIds = useMemo(() => {
    if (!transformedComponentLayers || !editorHiddenLayerIds) return editorHiddenLayerIds;
    const componentHidden = collectEditorHiddenLayerIds(transformedComponentLayers);
    if (componentHidden.size === 0) return editorHiddenLayerIds;
    const merged = new Map(editorHiddenLayerIds);
    componentHidden.forEach((breakpoints, layerId) => {
      merged.set(layerId, breakpoints);
    });
    return merged;
  }, [transformedComponentLayers, editorHiddenLayerIds]);

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
    if (!collectionId) return [];

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
    } else if (sourceFieldType === 'inverse_reference' && sourceFieldId) {
      // Inverse reference: filter items whose reference field value matches the parent item ID
      const parentId = collectionLayerItemId || pageCollectionItemId;
      if (!parentId) return [];
      items = allCollectionItems.filter(item => {
        const fieldValue = item.values[sourceFieldId];
        if (!fieldValue) return false;
        // Single reference: exact match
        if (fieldValue === parentId) return true;
        // Multi-reference: check if JSON array contains the parent ID
        const ids = parseMultiReferenceValue(fieldValue);
        return ids.includes(parentId);
      });
    } else if (!sourceFieldId) {
      // Multi-asset without a selected field has no items to render
      items = sourceFieldType === 'multi_asset' ? [] : allCollectionItems;
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
  }, [collectionId, allCollectionItems, sourceFieldId, sourceFieldType, sourceFieldSource, collectionLayerData, pageCollectionItemData, collectionLayerItemId, pageCollectionItemId, getAsset, collectionVariable?.filters, isEditMode]);

  const optionsSourceSort = layer.settings?.optionsSource;

  // Subscribe to the linked sort-by/sort-order input layers' default `value`
  // attribute so the canvas re-fetches when the user changes the default in the
  // SelectOptionsSettings panel. On the canvas there is no live `<select>`
  // value, so the layer attribute drives the effective sort.
  //
  // The lookup is scoped to the current page's draft (via the `pageId` prop)
  // because the input layer always lives on the same page as the collection
  // layer that references it. Walking every draft on every store update would
  // cause every collection layer on the canvas to do an O(tree) search per
  // keystroke for unrelated pages.
  const sortByInputDefaultValue = usePagesStore((state) => {
    const inputLayerId = collectionVariable?.sort_by_inputLayerId;
    if (!inputLayerId || !pageId) return undefined;
    const draft = state.draftsByPageId[pageId];
    if (!draft) return undefined;
    const found = findLayerById(draft.layers, inputLayerId);
    return found?.attributes?.value;
  });

  const sortOrderInputDefaultValue = usePagesStore((state) => {
    const inputLayerId = collectionVariable?.sort_order_inputLayerId;
    if (!inputLayerId || !pageId) return undefined;
    const draft = state.draftsByPageId[pageId];
    if (!draft) return undefined;
    const found = findLayerById(draft.layers, inputLayerId);
    return found?.attributes?.value;
  });

  useEffect(() => {
    if (!isEditMode) return;
    if (!collectionVariable?.id) return;
    // Skip fetching for multi-asset collections (they don't have real collection data)
    if (collectionVariable.source_field_type === 'multi_asset') return;
    if (collectionVariable.id === MULTI_ASSET_COLLECTION_ID) return;
    if (isLoadingLayerData) return;

    // Checkbox wrappers store sort config in settings.optionsSource, not in the collection variable
    let sortBy = optionsSourceSort?.sortFieldId || collectionVariable.sort_by;
    let sortOrder = optionsSourceSort?.sortOrder || collectionVariable.sort_order;

    // Mirror runtime behavior on the canvas: when the sort is bound to an
    // input layer, use that layer's default `value` as the effective sort.
    if (collectionVariable.sort_by_inputLayerId && typeof sortByInputDefaultValue === 'string' && sortByInputDefaultValue.trim() && sortByInputDefaultValue.trim().toLowerCase() !== 'none') {
      sortBy = sortByInputDefaultValue.trim();
    }
    if (collectionVariable.sort_order_inputLayerId) {
      const normalized = (sortOrderInputDefaultValue || '').toString().trim().toLowerCase();
      if (normalized === 'asc' || normalized === 'desc') {
        sortOrder = normalized;
      }
    }

    fetchLayerData(
      layer.id,
      collectionVariable.id,
      sortBy,
      sortOrder,
      collectionVariable.limit,
      collectionVariable.offset,
      undefined,
      collectionVariable.userScope,
      collectionVariable.userScopeFieldId
    );
  }, [
    isEditMode,
    collectionVariable?.id,
    collectionVariable?.source_field_type,
    collectionVariable?.sort_by,
    collectionVariable?.sort_order,
    collectionVariable?.sort_by_inputLayerId,
    collectionVariable?.sort_order_inputLayerId,
    collectionVariable?.limit,
    collectionVariable?.offset,
    collectionVariable?.userScope,
    collectionVariable?.userScopeFieldId,
    isPreviewMode,
    optionsSourceSort?.sortFieldId,
    optionsSourceSort?.sortOrder,
    sortByInputDefaultValue,
    sortOrderInputDefaultValue,
    isLoadingLayerData,
    fetchLayerData,
    layer.id,
  ]);

  // For component instances in edit mode, use the component's layers as children
  // For published pages, children are already resolved server-side
  const baseChildren = (isEditMode && component && component.layers) ? component.layers : layer.children;

  // Replicate the single bullet template for each slide on canvas.
  // The count comes from Swiper's snap grid (set by useCanvasSlider).
  //
  // Only `slideBullets` layers actually consume `sliderSnapCounts`. Subscribing
  // unconditionally would force every layer on the canvas (700+ on heavy pages)
  // to re-render whenever any slider's snap count changed — and worse, the map
  // reference is recreated on every set, so all subscribers fire even when their
  // specific slider is untouched. We pin non-bullet layers to `null` so Zustand
  // bails out via `Object.is` and only true subscribers re-render.
  const isSlideBulletsLayer = layer.name === 'slideBullets';
  const sliderSnapCounts = useEditorStore(
    (s) => isSlideBulletsLayer ? s.sliderSnapCounts : null
  );
  const children = useMemo(() => {
    if (!isEditMode || !isSlideBulletsLayer || !baseChildren?.length) return baseChildren;
    const currentPageId = useEditorStore.getState().currentPageId;
    if (!currentPageId) return baseChildren;
    const allLayers = usePagesStore.getState().draftsByPageId[currentPageId]?.layers;
    if (!allLayers) return baseChildren;
    const slider = findAncestorByName(allLayers, layer.id, 'slider');
    if (!slider) return baseChildren;
    const bulletCount = (sliderSnapCounts?.[slider.id]) || slider.children?.find(c => c.name === 'slides')?.children?.length || 1;
    const bulletTemplate = baseChildren[0];
    return Array.from({ length: bulletCount }, (_, i) => ({
      ...bulletTemplate,
      id: bulletTemplate.id,
      _bulletKey: `${bulletTemplate.id}-${i}`,
    }));
  }, [isEditMode, isSlideBulletsLayer, layer.id, baseChildren, sliderSnapCounts]);

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
  if (!isEditMode && htmlTag === 'a' && subtreeHasInteractiveDescendants) {
    htmlTag = 'div';
  }

  // Use sortable for drag and drop
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    id: layer.id,
    disabled: !enableDragDrop || isEditing || isLockedByOther || !!(currentLocale && !currentLocale.is_default),
    data: {
      layer,
    },
  });

  // Canvas slider: init Swiper on slider layers and handle slide navigation
  const sliderRef = useRef<HTMLElement | null>(null);
  useCanvasSlider(sliderRef, layer, isEditMode);

  // Block inline canvas editing while in a non-default locale: source layer
  // text must only be edited via the default locale. Translations are saved
  // through the right-sidebar Translate panel instead.
  const isLocalizingLayer = !!(currentLocale && !currentLocale.is_default);

  const startEditing = (clickX?: number, clickY?: number) => {
    // Enable inline editing for text layers (both rich text and plain text)
    if (textEditable && isEditMode && !isLockedByOther && !isLocalizingLayer) {
      setEditingLayerId(layer.id);
      // Clear sublayer selection when entering edit mode
      useEditorStore.getState().setActiveSublayerIndex(null);
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

  // For rich text elements, add paragraph default classes when tag is <p>
  // Skip for heading/text — they render their own tag directly
  const paragraphClasses = !isSimpleTextLayer && htmlTag === 'p' && layer.variables?.text
    ? getTextStyleClasses(layer.textStyles, 'paragraph')
    : '';

  // Use clsx (not cn/twMerge) to preserve all layer classes intact.
  // twMerge incorrectly removes leading-* when text-[...] is present
  // because it treats font-size as overriding line-height. Our own
  // setBreakpointClass already handles property-aware conflict resolution.

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

  const fullClassName = isEditMode ? clsx(
    classesString,
    paragraphClasses,
    SWIPER_CLASS_MAP[layer.name],
    isSlideChild && 'swiper-slide',
    buttonNeedsFit && 'w-fit',
    buttonNeedsTextCenter && 'text-center',
    enableDragDrop && !isEditing && !isLockedByOther && 'cursor-default',
    isDragging && 'opacity-30',
    showProjection && 'outline outline-1 outline-dashed outline-blue-400 bg-blue-50/10',
    isLockedByOther && 'opacity-90 pointer-events-none select-none',
    'ycode-layer'
  ) : clsx(classesString, paragraphClasses, SWIPER_CLASS_MAP[layer.name], isSlideChild && 'swiper-slide', buttonNeedsFit && 'w-fit', buttonNeedsTextCenter && 'text-center');

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

  // Shared link resolution context — only built once, reused by button links,
  // <a> layer links, and link wrappers. Skipped in edit mode (no resolution needed).
  const layerLinkContext: LinkResolutionContext | undefined = isEditMode ? undefined : {
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

      const needsRootContextMenu = isEditMode && !!pageId && !isEditing && !parentComponentLayerId;

      return (
        <LayerRenderer
          layers={layersWithInstanceId}
          {...sharedRendererProps}
          editorHiddenLayerIds={componentEditorHiddenLayerIds}
          enableDragDrop={enableDragDrop}
          activeLayerId={activeLayerId}
          projected={projected}
          parentComponentLayerId={layer.id}
          parentComponentId={layer.componentId}
          parentComponentOverrides={effectiveOverrides}
          parentComponentVariables={component?.variables}
          ancestorComponentIds={effectiveAncestorIds}
          componentRootContextMenu={needsRootContextMenu || undefined}
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
      ...(!isEditMode && { suppressHydrationWarning: true }),
    };

    // Apply link attributes for elements rendered as <a> (buttons with links or <a> layers)
    if (htmlTag === 'a' && layer.variables?.link) {
      if (isButtonWithLink) {
        elementProps.role = 'button';
        delete elementProps.type;
      }
      if (layerLinkContext && isValidLinkSettings(layer.variables.link)) {
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
      // Set breakpoints as value (e.g., "mobile" or "mobile tablet") or empty for all
      elementProps['data-gsap-hidden'] = hiddenInfo.breakpoints || '';
    }

    // Handle alert elements (for form success/error messages)
    // Hidden by default in published/preview mode; form submission JS reveals them.
    if (layer.alertType) {
      elementProps['data-alert-type'] = layer.alertType;
      if (!isEditMode) {
        const existingStyle = (typeof elementProps.style === 'object' && elementProps.style) || {};
        elementProps.style = { ...existingStyle, display: 'none' };
      }
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
    // Inside component instances, always hide (internal layers can't be individually selected)
    if (isEditMode && editorHiddenLayerIds?.has(layer.id)) {
      const hiddenBreakpoints = editorHiddenLayerIds.get(layer.id) || [];
      const shouldHideOnBreakpoint = hiddenBreakpoints.length === 0 ||
        (editorBreakpoint && hiddenBreakpoints.includes(editorBreakpoint));

      if (shouldHideOnBreakpoint) {
        const shouldHide = parentComponentLayerId || (() => {
          const storeSelectedId = useEditorStore.getState().selectedLayerId;
          const isSelectedOrChildSelected = isSelected || (storeSelectedId && (() => {
            const checkDescendants = (children: Layer[] | undefined): boolean => {
              if (!children) return false;
              for (const child of children) {
                if (child.id === storeSelectedId) return true;
                if (checkDescendants(child.children)) return true;
              }
              return false;
            };
            return checkDescendants(layer.children);
          })());
          return !isSelectedOrChildSelected;
        })();

        if (shouldHide) {
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

    // Select with placeholder: set defaultValue so React shows the placeholder option
    if (htmlTag === 'select' && !elementProps.value) {
      const hasPlaceholder = effectiveLayer.children?.some(
        (c) => c.name === 'option' && c.settings?.isPlaceholder
      );
      if (hasPlaceholder) {
        elementProps.defaultValue = '';
      }
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

        // Component instance (or any layer inside one): open the master
        // component for editing. Mirrors the "Edit component" sidebar button.
        const componentEditTargetId = layer.componentId || parentComponentId;
        const componentEditInstanceLayerId = layer.componentId ? layer.id : parentComponentLayerId;
        if (onComponentEdit && componentEditTargetId && componentEditInstanceLayerId) {
          onComponentEdit(componentEditTargetId, componentEditInstanceLayerId);
          return;
        }

        // Any element with CMS field binding: open collection item editor
        const cmsBinding = getLayerCmsFieldBinding(layer);
        if (cmsBinding) {
          let targetCollectionId: string | null = null;
          let targetItemId: string | undefined;

          if (cmsBinding.source === 'collection' && cmsBinding.collection_layer_id && collectionItemId) {
            const layerConfig = useCollectionLayerStore.getState().layerConfig;
            targetCollectionId = layerConfig[cmsBinding.collection_layer_id]?.collectionId || null;
            targetItemId = collectionItemId;
          } else if (pageCollectionItemId) {
            const currentPageId = useEditorStore.getState().currentPageId;
            const currentPage = usePagesStore.getState().pages.find((p) => p.id === currentPageId);
            targetCollectionId = currentPage?.settings?.cms?.collection_id || null;
            targetItemId = pageCollectionItemId;
          }

          if (targetCollectionId && targetItemId) {
            useEditorStore.getState().openCollectionItemSheet(targetCollectionId, targetItemId);
            return;
          }
        }

        // Image layers: open file manager for quick image replacement
        if (layer.name === 'image' || htmlTag === 'img') {
          openImageFileManager();
          return;
        }

        // RichText layers: always open sheet editor (block-level content needs full toolbar)
        if (isRichTextLayer(layer)) {
          useEditorStore.getState().setActiveSublayerIndex(null);
          useEditorStore.getState().openRichTextSheet(layer.id);
          return;
        }

        // Text/Heading with components or inline variables: open sheet editor
        if (textEditable) {
          const textVar = layer.variables?.text;
          const richContent = textVar?.type === 'dynamic_rich_text' ? textVar.data.content : null;
          if (richContent && hasComponentOrVariable(richContent)) {
            useEditorStore.getState().openRichTextSheet(layer.id);
            return;
          }
        }

        // Text/Heading layers: start inline editing
        startEditing(e.clientX, e.clientY);
      };
      // Prevent context menu from bubbling — but let it propagate for layers
      // inside a component so it reaches the component root's ContextMenuTrigger
      if (!parentComponentLayerId) {
        elementProps.onContextMenu = (e: React.MouseEvent) => {
          e.stopPropagation();
        };
      }
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
      // whatever the user/template set (defaults to lazy).
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
      // In edit mode, keep checked as a controlled prop (canvas inputs aren't interactive)
      // so defaults update in real-time. In published mode, convert to defaultChecked
      // so the input remains uncontrolled and users can interact with it.
      if ('checked' in elementProps) {
        if (isEditMode) {
          elementProps.readOnly = true;
        } else {
          elementProps.defaultChecked = elementProps.checked;
          delete elementProps.checked;
        }
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

      // Drop null/undefined value so the select can fall back to defaultValue
      // (React warns about a null value prop on <select>).
      if ('value' in elementProps && elementProps.value == null) {
        delete elementProps.value;
      }

      // In edit mode, keep value controlled (canvas selects aren't interactive)
      // so the rendered selection reflects default changes in real time.
      // In preview/published, convert to defaultValue so the field is uncontrolled
      // and users can pick a different option.
      if ('value' in elementProps) {
        if (isEditMode) {
          elementProps.onChange = () => {};
        } else {
          elementProps.defaultValue = elementProps.value;
          delete elementProps.value;
        }
      }

      if (isEditMode && layer.settings?.optionsSource?.collectionId) {
        const placeholderChild = effectiveLayer.children?.find(
          (c) => c.name === 'option' && c.settings?.isPlaceholder
        );
        const editPlaceholder = (
          placeholderChild?.variables?.text?.type === 'dynamic_text'
            ? placeholderChild.variables.text.data.content
            : null
        ) || '(Options from collection)';
        return (
          <Tag {...elementProps}>
            <option disabled value="">{editPlaceholder}</option>
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

    // Handle Map layers — provider-aware iframe
    if (layer.name === 'map') {
      const mapSettings = { ...DEFAULT_MAP_SETTINGS, ...layer.settings?.map,
        mapbox: { ...DEFAULT_MAP_SETTINGS.mapbox, ...layer.settings?.map?.mapbox },
        google: { ...DEFAULT_MAP_SETTINGS.google, ...layer.settings?.map?.google },
      };
      const provider = mapSettings.provider;
      const tokenKey = provider === 'google' ? 'google_maps_embed_api_key' : 'mapbox_access_token';
      const mapToken = (settingsByKey[tokenKey] || serverSettings?.[tokenKey]) as string | undefined;

      if (!mapToken) {
        const label = provider === 'google' ? 'Google Map API key' : 'Mapbox token';
        return (
          <div
            data-layer-id={layer.id}
            data-layer-type="map"
            className={fullClassName}
            style={mergedStyle}
            {...(isEditMode && !isEditing ? elementProps : {})}
          >
            <div className="flex items-center justify-center h-full bg-muted text-muted-foreground text-xs">
              {label} not configured
            </div>
          </div>
        );
      }

      const cvList = colorVariables.length > 0
        ? colorVariables
        : (serverSettings?.color_variables as import('@/types').ColorVariable[] || []);
      const resolvedSettings = {
        ...mapSettings,
        markerColor: resolveMarkerColor(mapSettings.markerColor, cvList),
      };
      const iframeProps = getMapIframeProps(resolvedSettings, mapToken);

      return (
        <div
          data-layer-id={layer.id}
          data-layer-type="map"
          className={fullClassName}
          style={mergedStyle}
          {...(isEditMode && !isEditing ? elementProps : {})}
        >
          <iframe
            {...(iframeProps.type === 'src'
              ? { src: iframeProps.src, referrerPolicy: 'no-referrer-when-downgrade' as const }
              : { srcDoc: iframeProps.srcDoc, sandbox: 'allow-scripts allow-same-origin' }
            )}
            className={isEditMode ? 'pointer-events-none' : ''}
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
              pageCollectionSortedItemIds={pageCollectionSortedItemIds}
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
              localeSelectorFormat={layer.name === 'localeSelector' ? (layer.settings?.locale?.format || 'locale') : localeSelectorFormat}
              liveLayerUpdates={liveLayerUpdates}
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

    // Resolved parent-component context to pass to child LayerRenderers.
    // Innermost component wins so double-click-to-edit targets the correct component.
    const childParentComponentLayerId = layer.componentId ? layer.id : parentComponentLayerId;
    const childParentComponentId = layer.componentId || parentComponentId;

    // Special handling for auth form (name='auth_form')
    if (layer.name === 'auth_form') {
      const authType = layer.settings?.auth?.type || 'login';

      if (isEditMode) {
        return (
          <div {...elementProps} style={mergedStyle}>
            {/* Collaboration indicators */}
            {isLockedByOther && <LayerLockIndicator layerId={layer.id} layerName={layer.name} />}
            {isSelected && !isLockedByOther && <EditingIndicator layerId={layer.id} className="absolute -top-8 right-0 z-20" />}

            {textContent && textContent}
            {effectiveChildren && effectiveChildren.length > 0 && (
              <LayerRenderer
                layers={effectiveChildren}
                {...sharedRendererProps}
                isInsideForm={true}
                parentComponentLayerId={childParentComponentLayerId}
                parentComponentId={childParentComponentId}
              />
            )}
          </div>
        );
      }

      // In published/preview mode, render the AuthForm component
      return (
        <AuthForm
          type={authType as 'login' | 'register'}
          className={fullClassName}
          style={mergedStyle}
          layerId={layer.id}
          redirectUrl={layer.settings?.auth?.redirectUrl}
        >
          {effectiveChildren && effectiveChildren.length > 0 && (
            <LayerRenderer
              layers={effectiveChildren}
              {...sharedRendererProps}
              isInsideForm={true}
              parentComponentLayerId={childParentComponentLayerId}
              parentComponentId={childParentComponentId}
            />
          )}
        </AuthForm>
      );
    }

    // Special handling for User Status component
    if (layer.name === 'user_status') {
      const loginUrl = layer.settings?.auth?.loginUrl || '/login';
      const profileLinks = layer.settings?.auth?.profileLinks || [];

      if (isEditMode) {
        return (
          <div
            {...elementProps} style={mergedStyle}
            className={clsx(fullClassName, 'flex items-center gap-2 border border-dashed border-primary/30 p-1 rounded')}
          >
             {/* Collaboration indicators */}
             {isLockedByOther && <LayerLockIndicator layerId={layer.id} layerName={layer.name} />}
             {isSelected && !isLockedByOther && <EditingIndicator layerId={layer.id} className="absolute -top-8 right-0 z-20" />}
             
             <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center">
               <Icon name="user" className="size-4 text-primary" />
             </div>
             <span className="text-xs font-medium">User Status</span>
          </div>
        );
      }

      return (
        <UserStatus
          key={`${layer.id}-${previewUserId}-${isPreviewMode}`}
          className={fullClassName}
          style={mergedStyle}
          loginUrl={loginUrl}
          profileLinks={profileLinks}
        />
      );
    }

    // Collection layers - repeat the element for each item (design applies to each looped item)
    if (isCollectionLayer) {
      if (isEditMode) {
        if (isLoadingLayerData) {
          if (isSlideChild) return null;
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

              // Apply CMS translations to this item's values when localizing
              const baseItemValues = item.values || {};
              const translatedItemValues = (currentLocale && !currentLocale.is_default && translations)
                ? applyCmsTranslations(item.id, baseItemValues, collectionFields, translations, { includeIncomplete: true })
                : baseItemValues;

              // Resolve reference fields
              const enhancedItemValues = collectionFields.length > 0
                ? resolveReferenceFieldsSync(
                  translatedItemValues,
                  collectionFields,
                  itemsByCollectionId,
                  fieldsByCollectionId
                )
                : translatedItemValues;

              const mergedItemData = {
                ...collectionLayerData,
                ...enhancedItemValues,
              };

              const updatedLayerDataMap = {
                ...effectiveLayerDataMap,
                [layer.id]: enhancedItemValues,
              };

              let itemElementProps = elementProps;
              if (bgImageVariable && isFieldVariable(bgImageVariable) && bgImageVariable.data.field_id) {
                const bgPageData = sourceFieldType === 'multi_asset'
                  ? { ...pageCollectionItemData, ...enhancedItemValues }
                  : pageCollectionItemData;
                const resolvedBgAssetId = resolveFieldValue(bgImageVariable, mergedItemData, bgPageData, updatedLayerDataMap);
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

              // For checkbox/radio wrappers, always inject checked attribute
              const checkboxDefaultIds = layer.settings?.optionsSource?.defaultItemIds;
              const radioDefaultId = layer.settings?.optionsSource?.defaultItemId;
              const isOptionsSourceLayer = !!layer.settings?.optionsSource?.collectionId;
              const itemChildren = (isOptionsSourceLayer && effectiveChildren)
                ? effectiveChildren.map(child => {
                  if (child.name !== 'input') return child;
                  if (child.attributes?.type === 'checkbox') {
                    const isChecked = checkboxDefaultIds?.includes(item.id) ? 'true' : 'false';
                    return { ...child, attributes: { ...child.attributes, checked: isChecked } };
                  }
                  if (child.attributes?.type === 'radio') {
                    const isChecked = radioDefaultId === item.id ? 'true' : 'false';
                    return { ...child, attributes: { ...child.attributes, checked: isChecked } };
                  }
                  return child;
                })
                : effectiveChildren;

              return (
                <Tag
                  key={item.id}
                  {...itemElementProps}
                  data-collection-item-id={item.id}
                  data-layer-id={layer.id}
                >
                  {textContent && textContent}

                  {itemChildren && itemChildren.length > 0 && (
                    <LayerRenderer
                      layers={itemChildren}
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
                      pageCollectionItemData={
                        sourceFieldType === 'multi_asset' && sourceFieldSource === 'page'
                          ? { ...pageCollectionItemData, ...enhancedItemValues }
                          : pageCollectionItemData
                      }
                      pageCollectionSortedItemIds={pageCollectionSortedItemIds}
                      hiddenLayerInfo={hiddenLayerInfo}
                      editorHiddenLayerIds={editorHiddenLayerIds}
                      editorBreakpoint={editorBreakpoint}
                      currentLocale={currentLocale}
                      availableLocales={availableLocales}
                      liveLayerUpdates={liveLayerUpdates}
                      parentComponentLayerId={childParentComponentLayerId}
                      parentComponentId={childParentComponentId}
                      parentComponentOverrides={parentComponentOverrides}
                      parentComponentVariables={parentComponentVariables}
                      editingComponentVariables={editingComponentVariables}
                      isInsideForm={isInsideForm || htmlTag === 'form'}
                      isInsideLink={isInsideLink || htmlTag === 'a'}
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
                      isSlideChild={layer.name === 'slides'}
                      serverSettings={serverSettings}
                      onComponentEdit={onComponentEdit}
                      lcpCandidateLayerId={lcpCandidateLayerId}
                    />
                  )}
                </Tag>
              );
            })}
          </>
        );
      }

      // In non-edit mode (preview/published), collections are handled by the server
      // transformation into _fragments. If we still see a 'collection' layer here
      // without an item ID, it means it's a template element - render nothing.
      if (!isEditMode && !layer._collectionItemId) {
        return null;
      }
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
              pageCollectionSortedItemIds={pageCollectionSortedItemIds}
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
              parentComponentLayerId={childParentComponentLayerId}
              parentComponentId={childParentComponentId}
              parentComponentOverrides={parentComponentOverrides}
              parentComponentVariables={parentComponentVariables}
              editingComponentVariables={editingComponentVariables}
              isInsideForm={isInsideForm || htmlTag === 'form'}
              isInsideLink={isInsideLink || htmlTag === 'a'}
              parentFormSettings={htmlTag === 'form' ? layer.settings?.form : parentFormSettings}
              components={componentsProp}
              ancestorComponentIds={effectiveAncestorIds}
              serverSettings={serverSettings}
              onComponentEdit={onComponentEdit}
              lcpCandidateLayerId={lcpCandidateLayerId}
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
            pageCollectionSortedItemIds={pageCollectionSortedItemIds}
            hiddenLayerInfo={hiddenLayerInfo}
            editorHiddenLayerIds={editorHiddenLayerIds}
            editorBreakpoint={editorBreakpoint}
            currentLocale={currentLocale}
            availableLocales={availableLocales}
            localeSelectorFormat={localeSelectorFormat}
            liveLayerUpdates={liveLayerUpdates}
            parentComponentLayerId={childParentComponentLayerId}
            parentComponentId={childParentComponentId}
            parentComponentOverrides={parentComponentOverrides}
            parentComponentVariables={parentComponentVariables}
            editingComponentVariables={editingComponentVariables}
            isInsideForm={isInsideForm || htmlTag === 'form'}
            isInsideLink={isInsideLink || htmlTag === 'a'}
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
            isSlideChild={layer.name === 'slides'}
            serverSettings={serverSettings}
            onComponentEdit={onComponentEdit}
            lcpCandidateLayerId={lcpCandidateLayerId}
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

  // Component instances render without a wrapper element so they participate
  // directly in the parent's layout (required for divide-* utilities).
  // The component root handles its own context menu via componentRootContextMenu.
  if (transformedComponentLayers) {
    return renderContent();
  }

  // Wrap with context menu in edit mode
  // Don't wrap layers inside component instances (they're not directly editable)
  let content = renderContent();

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
    if (isEditMode) {
      content = (
        <a className="contents">
          {content}
        </a>
      );
    } else if (layerLinkContext) {
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
  }

  const isComponentRoot = componentRootContextMenu && parentComponentLayerId && layer.id === parentComponentLayerId;
  if (isEditMode && pageId && !isEditing && (!parentComponentLayerId || isComponentRoot)) {
    const isLocked = layer.id === 'body';

    return (
      <LayerContextMenu
        layerId={layer.id}
        pageId={pageId}
        isLocked={isLocked}
        onLayerSelect={onLayerClick}
        liveLayerUpdates={liveLayerUpdates}
        liveComponentUpdates={liveComponentUpdates}
      >
        {content}
      </LayerContextMenu>
    );
  }

  return content;
};

/**
 * Bail out on prop drift that doesn't affect this specific LayerItem's render:
 * - `selectedLayerId` / `hoveredLayerId`: each LayerItem subscribes to the
 *   editor store directly for its own selection state, so a global selection
 *   change should only re-render the two affected rows (old + new), not the
 *   entire tree.
 * - everything else falls back to shallow equality, which catches genuine
 *   layer/data changes via stable refs from the stores.
 */
const layerItemPropsAreEqual = (
  prev: Readonly<React.ComponentProps<typeof LayerItemImpl>>,
  next: Readonly<React.ComponentProps<typeof LayerItemImpl>>
): boolean => {
  const prevRec = prev as unknown as Record<string, unknown>;
  const nextRec = next as unknown as Record<string, unknown>;
  for (const key in nextRec) {
    if (key === 'selectedLayerId' || key === 'hoveredLayerId') continue;
    if (prevRec[key] !== nextRec[key]) return false;
  }
  for (const key in prevRec) {
    if (key === 'selectedLayerId' || key === 'hoveredLayerId') continue;
    if (!(key in nextRec)) return false;
  }
  return true;
};

const LayerItem = React.memo(LayerItemImpl, layerItemPropsAreEqual);

export default LayerRenderer;
