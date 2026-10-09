'use client';

/**
 * Canvas Component
 *
 * Renders the layer editor canvas using an embedded iframe with Tailwind Browser CDN.
 * The iframe provides complete style isolation while allowing React-based layer rendering.
 *
 * Architecture:
 * - An iframe is created with Tailwind Browser CDN loaded
 * - React components are rendered into the iframe via ReactDOM.createRoot
 * - Communication happens via direct function calls (no postMessage needed)
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createRoot, Root } from 'react-dom/client';
import gsap from 'gsap';

import LayerRenderer from '@/components/LayerRenderer';
import { serializeLayers, getClassesString } from '@/lib/layer-utils';
import { collectEditorHiddenLayerIds, collectKeptHiddenLayerIds, type HiddenLayerInfo } from '@/lib/animation-utils';
import { getCanvasIframeHtml, updateViewportOverrides, measureContentExtent, isNonContentLayer, getClippedLayerRect } from '@/lib/canvas-utils';
import { CanvasPortalProvider } from '@/lib/canvas-portal-context';
import { cn } from '@/lib/utils';
import { loadSwiperCss } from '@/lib/slider-utils';
import { resolveReferenceFieldsSync } from '@/lib/collection-utils';
import { extractStyleBlockContents } from '@/lib/parse-head-html';
import { useEditorStore } from '@/stores/useEditorStore';
import { useFontsStore } from '@/stores/useFontsStore';
import { useCssVariablesStore } from '@/stores/useCssVariablesStore';
import { usePagesStore } from '@/stores/usePagesStore';
import { useSettingsStore } from '@/stores/useSettingsStore';

import { applyCmsTranslations, injectTranslatedText, translateComponentOverrides } from '@/lib/localisation-utils';

import type { Layer, Component, CollectionItemWithValues, CollectionField, Breakpoint, Asset, ComponentVariable, Locale, Translation } from '@/types';
import type { UseLiveLayerUpdatesReturn } from '@/hooks/use-live-layer-updates';
import type { UseLiveComponentUpdatesReturn } from '@/hooks/use-live-component-updates';

interface CanvasProps {
  /** Layers to render */
  layers: Layer[];
  /** Components for resolving component instances */
  components: Component[];
  /** Currently selected layer ID */
  selectedLayerId: string | null;
  /** Currently hovered layer ID */
  hoveredLayerId: string | null;
  /** Current breakpoint/viewport mode */
  breakpoint: Breakpoint;
  /** Active UI state for preview (hover, focus, etc.) */
  activeUIState: 'neutral' | 'hover' | 'focus' | 'active' | 'disabled' | 'current';
  /** Whether a component is being edited */
  editingComponentId: string | null;
  /** Collection items by collection ID */
  collectionItems: Record<string, CollectionItemWithValues[]>;
  /** Collection fields by collection ID */
  collectionFields: Record<string, CollectionField[]>;
  /** Collection item for dynamic page preview */
  pageCollectionItem?: CollectionItemWithValues | null;
  /** Collection fields for dynamic page */
  pageCollectionFields?: CollectionField[];
  /** Assets map */
  assets: Record<string, Asset>;
  /** Page ID */
  pageId: string;
  /** Callback when a layer is clicked */
  onLayerClick?: (layerId: string, event?: React.MouseEvent) => void;
  /** Callback when a layer is updated */
  onLayerUpdate?: (layerId: string, updates: Partial<Layer>) => void;
  /** Callback when delete key is pressed */
  onDeleteLayer?: () => void;
  /** Callback when content height changes */
  onContentHeightChange?: (height: number) => void;
  /** Callback when content width changes (used in component editing mode) */
  onContentWidthChange?: (width: number) => void;
  /** Callback when gap is updated */
  onGapUpdate?: (layerId: string, gapValue: string) => void;
  /** Callback when zoom gesture is detected */
  onZoomGesture?: (delta: number) => void;
  /** Callback when zoom in is triggered (Cmd++) */
  onZoomIn?: () => void;
  /** Callback when zoom out is triggered (Cmd+-) */
  onZoomOut?: () => void;
  /** Callback when reset zoom is triggered (Cmd+0) */
  onResetZoom?: () => void;
  /** Callback when zoom to fit is triggered (Cmd+1) */
  onZoomToFit?: () => void;
  /** Callback when autofit is triggered (Cmd+2) */
  onAutofit?: () => void;
  /** Callback when undo is triggered (Cmd+Z) */
  onUndo?: () => void;
  /** Callback when redo is triggered (Cmd+Shift+Z) */
  onRedo?: () => void;
  /** Live layer updates for collaboration */
  liveLayerUpdates?: UseLiveLayerUpdatesReturn | null;
  /** Live component updates for collaboration */
  liveComponentUpdates?: UseLiveComponentUpdatesReturn | null;
  /** Callback when iframe is ready, provides the iframe element */
  onIframeReady?: (iframeElement: HTMLIFrameElement) => void;
  /** Callback when a layer is hovered (for external overlay) */
  onLayerHover?: (layerId: string | null) => void;
  /** Callback when any click occurs inside the canvas (for closing panels) */
  onCanvasClick?: () => void;
  /** Callback when a component instance is double-clicked on the canvas */
  onComponentEdit?: (componentId: string, instanceLayerId: string) => void;
  /** Component variables when editing a component (for default value display) */
  editingComponentVariables?: ComponentVariable[];
  /** Layer IDs to force-show even if they have display:hidden apply_styles */
  forceVisibleLayerIds?: string[];
  /** Current canvas zoom percentage (100 = 100%) */
  zoom?: number;
  /** Fixed viewport height for stable measurement of content using vh/svh/dvh units */
  referenceViewportHeight?: number;
  /** Currently selected locale (controls translation injection on the canvas) */
  currentLocale?: Locale | null;
  /** All available locales (forwarded to LocaleSelector layers) */
  availableLocales?: Locale[];
  /** Translation map for the current locale (keyed by translatable key) */
  translations?: Record<string, Translation> | null;
}

/**
 * Inner component that renders inside the iframe
 */
interface CanvasContentProps {
  layers: Layer[];
  selectedLayerId: string | null;
  hoveredLayerId: string | null;
  pageId: string;
  pageCollectionItemId?: string;
  pageCollectionItemData: Record<string, string> | null;
  onLayerClick: (layerId: string, event?: React.MouseEvent) => void;
  onLayerUpdate?: (layerId: string, updates: Partial<Layer>) => void;
  onLayerHover: (layerId: string | null) => void;
  liveLayerUpdates?: UseLiveLayerUpdatesReturn | null;
  liveComponentUpdates?: UseLiveComponentUpdatesReturn | null;
  editingComponentVariables?: ComponentVariable[];
  editingComponentId?: string | null;
  editorHiddenLayerIds?: Map<string, Breakpoint[]>;
  /** `settings.hidden` layers kept in the DOM (collapsed) instead of omitted — reveal targets and keepInHtml */
  hiddenLayerInfo?: HiddenLayerInfo[];
  editorBreakpoint?: Breakpoint;
  zoom?: number;
  onComponentEdit?: (componentId: string, instanceLayerId: string) => void;
  currentLocale?: Locale | null;
  availableLocales?: Locale[];
  translations?: Record<string, Translation> | null;
}

function CanvasContent({
  layers,
  selectedLayerId,
  hoveredLayerId,
  pageId,
  pageCollectionItemId,
  pageCollectionItemData,
  onLayerClick,
  onLayerUpdate,
  onLayerHover,
  liveLayerUpdates,
  liveComponentUpdates,
  editingComponentVariables,
  editingComponentId,
  editorHiddenLayerIds,
  hiddenLayerInfo,
  editorBreakpoint,
  zoom = 100,
  onComponentEdit,
  currentLocale,
  availableLocales,
  translations,
}: CanvasContentProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

  // Seed ancestor set with the component being edited so its own rich-text
  // collection data cannot re-embed itself (prevents infinite loops)
  const initialAncestorIds = useMemo(
    () => editingComponentId ? new Set([editingComponentId]) : undefined,
    [editingComponentId]
  );

  // Select body layer when clicking on empty canvas space.
  // The #canvas-body div uses display:contents so it has no box — clicks on
  // empty space land on the iframe <body> (or sometimes <html> / one of the
  // display:contents wrappers), which is outside the React root and therefore
  // outside the layer onClick chain. We attach a native listener on the iframe
  // document so any click that doesn't end up on an actual layer element
  // (i.e. nothing with [data-layer-id] except the body wrapper itself) falls
  // through to selecting the Body layer.
  useEffect(() => {
    if (!bodyRef.current) return;
    const iframeDoc = bodyRef.current.ownerDocument;
    const iframeBody = iframeDoc.body;

    setPortalContainer(iframeBody);

    const handleBodyClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Walk up from the click target. If we find any layer element with
      // data-layer-id !== 'body', that layer's own onClick handles selection
      // and we should ignore this fallthrough. Otherwise the click landed on
      // empty body space (or html / the display:contents wrappers) and we
      // select the Body layer.
      const layerEl = target.closest?.('[data-layer-id]') as HTMLElement | null;
      if (layerEl && layerEl.getAttribute('data-layer-id') !== 'body') return;
      onLayerClick('body');
    };

    iframeDoc.addEventListener('click', handleBodyClick);
    return () => iframeDoc.removeEventListener('click', handleBodyClick);
  }, [onLayerClick]);

  const bodyLayer = layers.find(l => l.id === 'body');
  const bodyClasses = bodyLayer ? getClassesString(bodyLayer) : '';
  const childLayers = bodyLayer
    ? [...(bodyLayer.children || []), ...layers.filter(l => l.id !== 'body')]
    : layers;

  // Move body layer classes from #canvas-body to the iframe's <body> element
  useEffect(() => {
    if (!bodyRef.current) return;
    const iframeBody = bodyRef.current.ownerDocument.body;
    const resolvedClasses = editingComponentId
      ? 'bg-transparent relative'
      : (bodyClasses || 'bg-white');
    const classes = resolvedClasses.split(/\s+/).filter(Boolean);
    if (classes.length > 0) {
      iframeBody.classList.add(...classes);
      classes.forEach(c => bodyRef.current?.classList.remove(c));
    }
    return () => {
      if (classes.length > 0) {
        iframeBody.classList.remove(...classes);
      }
    };
  }, [bodyClasses, editingComponentId]);

  const portalValue = useMemo(
    () => ({ container: portalContainer, zoom }),
    [portalContainer, zoom]
  );

  return (
    <CanvasPortalProvider value={portalValue}>
      <div
        ref={bodyRef}
        id="canvas-body"
        data-layer-id="body"
        className="contents"
      >
        <LayerRenderer
          layers={childLayers}
          isEditMode={true}
          isPublished={false}
          selectedLayerId={selectedLayerId}
          hoveredLayerId={hoveredLayerId}
          onLayerClick={onLayerClick}
          onLayerUpdate={onLayerUpdate}
          onLayerHover={onLayerHover}
          pageId={pageId}
          pageCollectionItemId={pageCollectionItemId}
          pageCollectionItemData={pageCollectionItemData}
          liveLayerUpdates={liveLayerUpdates}
          liveComponentUpdates={liveComponentUpdates}
          editingComponentVariables={editingComponentVariables}
          editorHiddenLayerIds={editorHiddenLayerIds}
          hiddenLayerInfo={hiddenLayerInfo}
          editorBreakpoint={editorBreakpoint}
          ancestorComponentIds={initialAncestorIds}
          onComponentEdit={onComponentEdit}
          currentLocale={currentLocale}
          availableLocales={availableLocales}
          translations={translations}
        />
      </div>
    </CanvasPortalProvider>
  );
}

/**
 * Canvas Component
 * Uses an embedded iframe with Tailwind Browser CDN for style generation
 */
const Canvas = React.memo(function Canvas({
  layers,
  components,
  selectedLayerId,
  hoveredLayerId,
  breakpoint,
  activeUIState,
  editingComponentId,
  collectionItems,
  collectionFields,
  pageCollectionItem,
  pageCollectionFields,
  assets,
  pageId,
  onLayerClick,
  onLayerUpdate,
  onDeleteLayer,
  onContentHeightChange,
  onContentWidthChange,
  onGapUpdate,
  onZoomGesture,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onZoomToFit,
  onAutofit,
  onUndo,
  onRedo,
  liveLayerUpdates,
  liveComponentUpdates,
  onIframeReady,
  onLayerHover,
  onCanvasClick,
  onComponentEdit,
  editingComponentVariables,
  forceVisibleLayerIds,
  zoom = 100,
  referenceViewportHeight,
  currentLocale,
  availableLocales,
  translations,
}: CanvasProps) {
  // Refs
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const rootRef = useRef<Root | null>(null);
  const mountPointRef = useRef<HTMLDivElement | null>(null);

  // State
  const [iframeReady, setIframeReady] = useState(false);

  // Entrance-animation signal. Driven off the nonce (bumped on every remote
  // update) while the actual ids are read lazily from the store, so identical id
  // arrays across consecutive remote updates still trigger the animation.
  const canvasEnterNonce = useEditorStore((state) => state.canvasEnterNonce);

  // Layer ids already animated in this page session. Prevents duplicate signals
  // (e.g. the realtime broadcast followed by the authoritative page_changed
  // snapshot) from replaying the same entrance. Reset on page change below.
  const animatedEnterIdsRef = useRef<Set<string>>(new Set());

  // Translate component-instance override values before serialization so that
  // `resolveComponents` (inside serializeLayers) propagates per-instance
  // translations through the override pipeline. Runs only when a non-default
  // locale is active.
  const layersForSerialization = useMemo(() => {
    if (!currentLocale || currentLocale.is_default || !translations) return layers;
    const lookupPageId = pageId || (editingComponentId ?? '');
    if (!lookupPageId) return layers;
    return translateComponentOverrides(layers, lookupPageId, translations, { includeIncomplete: true });
  }, [layers, currentLocale, translations, pageId, editingComponentId]);

  // Resolve component instances in layers
  const { layers: resolvedLayers, componentMap } = useMemo(() => {
    return serializeLayers(layersForSerialization, components, editingComponentVariables);
  }, [layersForSerialization, components, editingComponentVariables]);

  // When a non-default locale is active, swap layer text and translatable
  // asset references with their translations so the canvas mirrors what the
  // server-rendered preview / published page would output. The injection runs
  // AFTER serializeLayers so component instance child IDs are already resolved
  // (injectTranslatedText reads _originalLayerId / _masterComponentId to look
  // up component-scoped translations).
  //
  // When the user is editing a component definition (editingComponentId set),
  // the rendered layers are the component's raw layers (not a resolved
  // instance), so they carry no _masterComponentId. Pass editingComponentId
  // as the default so translations stored under `component:{id}:...` apply.
  const localizedLayers = useMemo(() => {
    if (!currentLocale || currentLocale.is_default || !translations) {
      return resolvedLayers;
    }
    // pageId may be empty when editing a component without a page selected.
    // injectTranslatedText still needs a non-empty value to perform lookups.
    const lookupPageId = pageId || (editingComponentId ?? '');
    if (!lookupPageId) return resolvedLayers;
    // Builder canvas mirrors what the editor has saved, including in-progress
    // translations that are not yet marked complete. Production rendering
    // (page-fetcher) keeps the default behaviour and only ships completed ones.
    return injectTranslatedText(resolvedLayers, lookupPageId, translations, {
      includeIncomplete: true,
      defaultMasterComponentId: editingComponentId ?? undefined,
    });
  }, [resolvedLayers, currentLocale, translations, pageId, editingComponentId]);

  // Enrich page collection item data with reference field dotted keys
  // so variables like "refFieldId.targetFieldId" resolve on canvas.
  // Stabilize the reference: collectionItems gets a new ref whenever ANY collection changes,
  // but this output only depends on the page's specific collection — prevent unnecessary
  // root.render() calls in the iframe which are very expensive (~2-3s per full re-render).
  const enrichedPageCollectionItemDataRaw = useMemo(() => {
    const values = pageCollectionItem?.values;
    if (!values || !pageCollectionFields?.length) return values || null;
    // Translate referenced item values so relationship paths render in the
    // active locale on canvas (matches server-side page fetcher).
    const translateRefValues = (currentLocale && !currentLocale.is_default && translations)
      ? (refItemId: string, refValues: Record<string, string>, refFields: CollectionField[]) =>
        applyCmsTranslations(refItemId, refValues, refFields, translations, { includeIncomplete: true })
      : undefined;
    return resolveReferenceFieldsSync(
      values,
      pageCollectionFields,
      collectionItems,
      collectionFields,
      new Set(),
      translateRefValues
    );
  }, [pageCollectionItem?.values, pageCollectionFields, collectionItems, collectionFields, currentLocale, translations]);

  const enrichedPageCollectionItemDataRef = useRef(enrichedPageCollectionItemDataRaw);
  const enrichedPageCollectionItemDataKeyRef = useRef('');
  const enrichedPageCollectionItemData = useMemo(() => {
    const key = JSON.stringify(enrichedPageCollectionItemDataRaw);
    if (key !== enrichedPageCollectionItemDataKeyRef.current) {
      enrichedPageCollectionItemDataKeyRef.current = key;
      enrichedPageCollectionItemDataRef.current = enrichedPageCollectionItemDataRaw;
    }
    return enrichedPageCollectionItemDataRef.current;
  }, [enrichedPageCollectionItemDataRaw]);

  // Collect layer IDs that should be hidden on canvas (display: hidden with on-load)
  // Exclude layers that are force-visible (targets of the active interaction).
  // NOTE: this must NOT depend on selectedLayerId — it's a dependency of the
  // iframe root.render() effect, so adding selection here forces a full (slow)
  // iframe re-render on every click. Reveal-on-select is handled reactively
  // inside LayerRenderer instead.
  const editorHiddenLayerIds = useMemo(() => {
    const hiddenMap = collectEditorHiddenLayerIds(resolvedLayers);
    if (forceVisibleLayerIds && forceVisibleLayerIds.length > 0) {
      forceVisibleLayerIds.forEach(id => hiddenMap.delete(id));
    }
    return hiddenMap;
  }, [resolvedLayers, forceVisibleLayerIds]);

  // `settings.hidden` layers kept in HTML (reveal targets, keepInHtml) must exist
  // on canvas (collapsed via editorHiddenLayerIds above) so they can be selected
  // and edited. Everything else hidden stays unrendered.
  const hiddenLayerInfo = useMemo<HiddenLayerInfo[]>(() => {
    const ids = collectKeptHiddenLayerIds(resolvedLayers);
    return Array.from(ids, (layerId) => ({ layerId, breakpoints: null }));
  }, [resolvedLayers]);

  // Handle layer click with component resolution
  const handleLayerClick = useCallback((layerId: string, event?: React.MouseEvent) => {
    // Suppress stale left-clicks that fire on the canvas when a context menu
    // item is clicked and the menu dismisses (Radix click-through).
    // Only block when an event is present — onLayerSelect from handleOpenChange
    // passes no event and must always go through to select the right-clicked layer.
    if (event && useEditorStore.getState().isCanvasContextMenuOpen) return;

    const componentRootId = componentMap[layerId];
    const isPartOfComponent = !!componentRootId;
    const isEditingThisComponent = editingComponentId && componentRootId === editingComponentId;

    let targetLayerId = layerId;
    if (isPartOfComponent && !isEditingThisComponent) {
      targetLayerId = componentRootId;
    }

    onLayerClick?.(targetLayerId, event);
  }, [componentMap, editingComponentId, onLayerClick]);

  // Handle hover. We only forward the resolved id to the parent, which writes
  // it into the editor store. `SelectionOverlay` reads the store directly to
  // paint the outline, so we don't need any React state here — avoiding a
  // Canvas re-render on every hover.
  const handleLayerHover = useCallback((layerId: string | null) => {
    // Resolve component root for hover (same logic as click)
    let resolvedLayerId = layerId;
    if (layerId) {
      const componentRootId = componentMap[layerId];
      const isPartOfComponent = !!componentRootId;
      const isEditingThisComponent = editingComponentId && componentRootId === editingComponentId;

      if (isPartOfComponent && !isEditingThisComponent) {
        resolvedLayerId = componentRootId;
      }
    }

    onLayerHover?.(resolvedLayerId);
  }, [componentMap, editingComponentId, onLayerHover]);

  // Initialize iframe with Tailwind Browser CDN (only once)
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    // Guard against re-initialization
    if (rootRef.current) return;

    const initializeIframe = () => {
      const doc = iframe.contentDocument;
      if (!doc) return;

      // Double-check we haven't already initialized
      if (rootRef.current) return;

      // Write the initial HTML with Tailwind Browser CDN (shared template)
      doc.open();
      doc.write(getCanvasIframeHtml('canvas-mount'));
      doc.close();

      // Load minimal Swiper CSS (no layout overrides that conflict with Tailwind)
      loadSwiperCss(doc);

      // Load GSAP for animations in the canvas iframe
      const gsapScript = doc.createElement('script');
      gsapScript.src = 'https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js';
      gsapScript.onload = () => {
        const splitTextScript = doc.createElement('script');
        splitTextScript.src = 'https://cdn.jsdelivr.net/npm/gsap@3/dist/SplitText.min.js';
        splitTextScript.onload = () => {
          const initScript = doc.createElement('script');
          initScript.textContent = `
            if (typeof gsap !== 'undefined' && typeof SplitText !== 'undefined') {
              gsap.registerPlugin(SplitText);
            }
          `;
          doc.head.appendChild(initScript);
        };
        doc.head.appendChild(splitTextScript);
      };
      doc.head.appendChild(gsapScript);

      // Wait for Tailwind to initialize
      setTimeout(() => {
        // Final guard before creating root
        if (rootRef.current) return;

        const mountPoint = doc.getElementById('canvas-mount');
        if (mountPoint) {
          mountPointRef.current = mountPoint as HTMLDivElement;
          rootRef.current = createRoot(mountPoint);
          setIframeReady(true);
        }
      }, 100);
    };

    // Initialize when iframe loads
    iframe.onload = initializeIframe;

    // Trigger initial load if iframe is already ready
    if (iframe.contentDocument?.readyState === 'complete') {
      initializeIframe();
    }

    return () => {
      // Cleanup on unmount - defer to avoid unmounting during React's render phase
      const rootToUnmount = rootRef.current;
      rootRef.current = null;
      mountPointRef.current = null;
      setIframeReady(false);

      // Defer unmount to next frame to ensure we're outside React's render cycle
      if (rootToUnmount) {
        requestAnimationFrame(() => {
          try {
            rootToUnmount.unmount();
          } catch (error) {
            console.warn('Error unmounting canvas root:', error);
          }
        });
      }
    };
  }, []); // Empty deps - only run once on mount

  // Notify parent when iframe is ready
  useEffect(() => {
    if (iframeReady && iframeRef.current && onIframeReady) {
      onIframeReady(iframeRef.current);
    }
  }, [iframeReady, onIframeReady]);

  // Inject font CSS into the canvas iframe when fonts change
  const fontsCss = useFontsStore((state) => state.fontsCss);
  const injectFontsCss = useFontsStore((state) => state.injectFontsCss);

  useEffect(() => {
    if (!iframeReady || !iframeRef.current) return;
    const iframeDoc = iframeRef.current.contentDocument;
    injectFontsCss(iframeDoc);
  }, [iframeReady, fontsCss, injectFontsCss]);

  // Inject CSS variables (colors + sizes + percentages + numbers + fonts) into
  // the canvas iframe. `version` is bumped by the store on every change so the
  // selector recomputes only when the graph actually changes.
  const cssVarsVersion = useCssVariablesStore((state) => state.version);
  const cssVarsStylesheet = useMemo(
    () => useCssVariablesStore.getState().generateStylesheet(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cssVarsVersion]
  );

  useEffect(() => {
    if (!iframeReady || !iframeRef.current) return;
    const iframeDoc = iframeRef.current.contentDocument;
    if (!iframeDoc) return;

    const STYLE_ID = 'ycode-css-vars';
    let styleEl = iframeDoc.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = iframeDoc.createElement('style');
      styleEl.id = STYLE_ID;
      iframeDoc.head.appendChild(styleEl);
    }
    styleEl.textContent = cssVarsStylesheet;

    // Remove the legacy `ycode-color-vars` style element if a previous build
    // left it behind in this iframe.
    const legacy = iframeDoc.getElementById('ycode-color-vars');
    if (legacy && legacy !== styleEl) legacy.remove();
  }, [iframeReady, cssVarsStylesheet]);

  // Inject user-defined custom CSS from `<style>` blocks in head custom code
  // so `:root { --x: ... }` variables (and any other CSS) live-preview in the
  // canvas — matching the legacy `#custom-css-style` injection in IFrame.vue.
  // Page-editing context: global head + current page head custom code.
  // Component-editing context: global head only (no page bound to the canvas).
  // Scripts and other head HTML are intentionally ignored to keep the canvas
  // sandbox safe; full execution still happens on the published/preview site
  // via PageRenderer + CustomCodeInjector.
  const globalCustomCodeHead = useSettingsStore(
    (state) => state.settingsByKey['custom_code_head'] as string | null
  );
  const pageCustomCodeHead = usePagesStore((state) => {
    if (!pageId || editingComponentId) return null;
    const page = state.pages.find((p) => p.id === pageId);
    return page?.settings?.custom_code?.head || null;
  });

  const customHeadCss = useMemo(() => {
    const segments: string[] = [];
    const globalCss = extractStyleBlockContents(globalCustomCodeHead);
    if (globalCss) segments.push(globalCss);
    const pageCss = extractStyleBlockContents(pageCustomCodeHead);
    if (pageCss) segments.push(pageCss);
    return segments.join('\n');
  }, [globalCustomCodeHead, pageCustomCodeHead]);

  useEffect(() => {
    if (!iframeReady || !iframeRef.current) return;
    const iframeDoc = iframeRef.current.contentDocument;
    if (!iframeDoc) return;

    const STYLE_ID = 'ycode-custom-head-css';
    let styleEl = iframeDoc.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = iframeDoc.createElement('style');
      styleEl.id = STYLE_ID;
      iframeDoc.head.appendChild(styleEl);
    }
    styleEl.textContent = customHeadCss;
  }, [iframeReady, customHeadCss]);

  // Inject the server-compiled Tailwind stylesheet for the current page — the
  // same `generated_css` published pages inject via PageRenderer. The canvas's
  // Tailwind Browser CDN JIT is unreliable for large bulk inserts (AI/MCP page
  // builds), so it would leave layers unstyled ("black and white") until
  // publish. Injecting the precompiled CSS gives a reliable baseline; the CDN
  // still layers on top for live single-property edits made in the builder.
  // Skipped while editing a component (no page draft is bound to the canvas).
  const generatedCss = usePagesStore((state) =>
    pageId && !editingComponentId ? state.draftsByPageId[pageId]?.generated_css ?? '' : ''
  );

  useEffect(() => {
    if (!iframeReady || !iframeRef.current) return;
    const iframeDoc = iframeRef.current.contentDocument;
    if (!iframeDoc) return;

    const STYLE_ID = 'ycode-canvas-styles';
    let styleEl = iframeDoc.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!generatedCss) {
      styleEl?.remove();
      return;
    }
    if (!styleEl) {
      styleEl = iframeDoc.createElement('style');
      styleEl.id = STYLE_ID;
      iframeDoc.head.appendChild(styleEl);
    }
    styleEl.textContent = generatedCss;
  }, [iframeReady, generatedCss]);

  // Render content into iframe
  useEffect(() => {
    if (!iframeReady || !rootRef.current) return;

    rootRef.current.render(
      <CanvasContent
        layers={localizedLayers}
        selectedLayerId={selectedLayerId}
        hoveredLayerId={hoveredLayerId}
        pageId={pageId}
        pageCollectionItemId={pageCollectionItem?.id}
        pageCollectionItemData={enrichedPageCollectionItemData}
        onLayerClick={handleLayerClick}
        onLayerUpdate={onLayerUpdate}
        onLayerHover={handleLayerHover}
        liveLayerUpdates={liveLayerUpdates}
        liveComponentUpdates={liveComponentUpdates}
        editingComponentVariables={editingComponentVariables}
        editingComponentId={editingComponentId}
        editorHiddenLayerIds={editorHiddenLayerIds}
        hiddenLayerInfo={hiddenLayerInfo}
        editorBreakpoint={breakpoint}
        zoom={zoom}
        onComponentEdit={onComponentEdit}
        currentLocale={currentLocale}
        availableLocales={availableLocales}
        translations={translations}
      />
    );
  // selectedLayerId and hoveredLayerId are intentionally excluded from deps:
  // SingleLayerRenderer subscribes to the store directly for selection state,
  // so we don't need to re-render the entire iframe layer tree on selection changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    iframeReady,
    localizedLayers,
    editingComponentId,
    editingComponentVariables,
    pageId,
    pageCollectionItem?.id,
    enrichedPageCollectionItemData,
    handleLayerClick,
    onLayerUpdate,
    handleLayerHover,
    liveLayerUpdates,
    liveComponentUpdates,
    editorHiddenLayerIds,
    hiddenLayerInfo,
    breakpoint,
    zoom,
    onComponentEdit,
    currentLocale,
    availableLocales,
    translations,
  ]);

  // Forget animated ids when switching pages so a fresh page's remote edits can
  // animate (and a navigation itself never animates the whole tree).
  useEffect(() => {
    animatedEnterIdsRef.current = new Set();
  }, [pageId]);

  // Reveal newly-arrived remote layers (AI/MCP/collaborator) step by step: each
  // added layer fades in one after another in document order (container first,
  // then its contents), so a section visibly assembles itself instead of popping
  // in all at once. Local edits never set this signal, so they stay instant.
  useEffect(() => {
    if (canvasEnterNonce === 0 || !iframeReady || !iframeRef.current) return;

    const iframeDoc = iframeRef.current.contentDocument;
    const iframeWindow = iframeRef.current.contentWindow;
    const iframeGsap = (iframeWindow as unknown as { gsap?: typeof gsap } | null)?.gsap;
    if (!iframeDoc || !iframeWindow || !iframeGsap) return;

    const pending = useEditorStore
      .getState()
      .canvasEnterLayerIds.filter((id) => !animatedEnterIdsRef.current.has(id));
    if (pending.length === 0) return;

    // Respect reduced-motion: skip the animation, but still mark the ids so a
    // later duplicate signal doesn't try to animate them either.
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      pending.forEach((id) => animatedEnterIdsRef.current.add(id));
      return;
    }

    // The iframe's React root commits asynchronously; wait two frames so the new
    // nodes exist in the DOM before we query and animate them.
    let rafInner = 0;
    const rafOuter = iframeWindow.requestAnimationFrame(() => {
      rafInner = iframeWindow.requestAnimationFrame(() => {
        const nodes: HTMLElement[] = [];
        for (const id of pending) {
          animatedEnterIdsRef.current.add(id);
          // Skip layers hidden on canvas (on-load animation placeholders).
          if (editorHiddenLayerIds.has(id)) continue;
          const el = iframeDoc.querySelector(`[data-layer-id="${id}"]`) as HTMLElement | null;
          if (el) nodes.push(el);
        }
        if (nodes.length === 0) return;

        // Order by document position (parents before children, top to bottom) so
        // the reveal reads as the section being built piece by piece.
        nodes.sort((a, b) => {
          const relation = a.compareDocumentPosition(b);
          if (relation & 0x04) return -1; // DOCUMENT_POSITION_FOLLOWING: a precedes b
          if (relation & 0x02) return 1; // DOCUMENT_POSITION_PRECEDING: a follows b
          return 0;
        });

        // Keep the whole cascade within a bounded window so large sections still
        // finish quickly: shrink the per-item delay as the count grows.
        const REVEAL_WINDOW = 1.2;
        const stagger = Math.min(0.06, REVEAL_WINDOW / nodes.length);

        // autoAlpha (opacity-only) avoids transforms compounding through nested
        // added layers; each element simply fades in on its turn.
        iframeGsap.from(nodes, {
          autoAlpha: 0,
          duration: 0.35,
          stagger,
          ease: 'power1.out',
          clearProps: 'opacity,visibility',
        });
      });
    });

    return () => {
      iframeWindow.cancelAnimationFrame(rafOuter);
      if (rafInner) iframeWindow.cancelAnimationFrame(rafInner);
    };
    // Driven by the nonce; ids are read lazily from the store inside the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasEnterNonce, iframeReady]);

  // Handle keyboard events from iframe
  useEffect(() => {
    if (!iframeReady || !iframeRef.current) return;

    const doc = iframeRef.current.contentDocument;
    if (!doc) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputFocused = target.tagName === 'INPUT' ||
                             target.tagName === 'TEXTAREA' ||
                             target.isContentEditable;

      if ((e.key === 'Delete' || e.key === 'Backspace') && useEditorStore.getState().selectedLayerId && !isInputFocused) {
        e.preventDefault();
        onDeleteLayer?.();
        return;
      }

      // Undo/Redo shortcuts (Cmd/Ctrl + Z / Shift + Z, or Cmd/Ctrl + Y)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !isInputFocused) {
        e.preventDefault();
        if (e.shiftKey) {
          // Redo: Cmd/Ctrl + Shift + Z
          onRedo?.();
        } else {
          // Undo: Cmd/Ctrl + Z
          onUndo?.();
        }
        return;
      }

      // Redo alternative: Cmd/Ctrl + Y
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y' && !isInputFocused) {
        e.preventDefault();
        onRedo?.();
        return;
      }

      // Zoom shortcuts (Cmd/Ctrl + key)
      if (e.metaKey || e.ctrlKey) {
        // Cmd+0 - Reset zoom
        if (e.key === '0' && onResetZoom) {
          e.preventDefault();
          onResetZoom();
          return;
        }

        // Cmd++ or Cmd+= - Zoom in
        if ((e.key === '+' || e.key === '=') && onZoomIn) {
          e.preventDefault();
          onZoomIn();
          return;
        }

        // Cmd+- - Zoom out
        if (e.key === '-' && onZoomOut) {
          e.preventDefault();
          onZoomOut();
          return;
        }

        // Cmd+1 - Fit height
        if (e.key === '1' && onZoomToFit) {
          e.preventDefault();
          onZoomToFit();
          return;
        }

        // Cmd+2 - Fit width
        if (e.key === '2' && onAutofit) {
          e.preventDefault();
          onAutofit();
          return;
        }
      }

      // Forward keyboard events to parent window for global shortcuts
      // (copy, paste, undo, redo, copy style, paste style, etc.)
      if (!isInputFocused) {
        const syntheticEvent = new KeyboardEvent('keydown', {
          key: e.key,
          code: e.code,
          keyCode: e.keyCode,
          which: e.which,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
          bubbles: true,
          cancelable: true,
        });
        window.dispatchEvent(syntheticEvent);
      }
    };

    doc.addEventListener('keydown', handleKeyDown);
    return () => doc.removeEventListener('keydown', handleKeyDown);
  }, [iframeReady, onDeleteLayer, onResetZoom, onZoomIn, onZoomOut, onZoomToFit, onAutofit, onUndo, onRedo]);

  // Handle any click inside the iframe (capture phase to run before stopPropagation)
  useEffect(() => {
    if (!iframeReady || !iframeRef.current) return;

    const doc = iframeRef.current.contentDocument;
    if (!doc) return;

    const handleClick = () => {
      onCanvasClick?.();
    };

    // Use capture phase to ensure we catch clicks before stopPropagation
    doc.addEventListener('click', handleClick, true);
    return () => doc.removeEventListener('click', handleClick, true);
  }, [iframeReady, onCanvasClick]);

  // Content size reporting (height always, width when callback provided)
  // Uses a stabilization delay for height decreases to prevent transient
  // drops (e.g. iframe reloads inside the canvas) from causing scroll jumps.
  const lastReportedHeightRef = useRef(0);

  useEffect(() => {
    if (!iframeReady || !iframeRef.current || !onContentHeightChange) return;

    const doc = iframeRef.current.contentDocument;
    if (!doc) return;

    // Reset so the first measurement after a breakpoint switch reports immediately
    // instead of being delayed by the shrink timer
    lastReportedHeightRef.current = 0;

    let shrinkTimer: ReturnType<typeof setTimeout> | undefined;

    const reportHeight = (height: number) => {
      clearTimeout(shrinkTimer);
      const clamped = Math.max(height, 100);

      if (clamped >= lastReportedHeightRef.current) {
        lastReportedHeightRef.current = clamped;
        onContentHeightChange(clamped);
      } else {
        // Delay height decreases so transient dips don't cause scroll jumps
        shrinkTimer = setTimeout(() => {
          lastReportedHeightRef.current = clamped;
          onContentHeightChange(clamped);
        }, 150);
      }
    };

    const measureContent = () => {
      const body = doc.body;
      if (!body) return;

      // Component editing mode: measure bounding box of all visible layers
      // including absolutely positioned elements that extend beyond in-flow content
      if (onContentWidthChange) {
        const canvasBody = doc.getElementById('canvas-body');
        if (canvasBody && canvasBody.children.length > 0) {
          const bodyRect = body.getBoundingClientRect();
          const win = doc.defaultView;
          let maxChildWidth = 0;
          let maxChildBottom = 0;

          const allLayers = canvasBody.querySelectorAll('[data-layer-id]');
          allLayers.forEach(el => {
            const node = el as HTMLElement;
            const rect = node.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;
            // Ignore fixed overlays/backdrops (e.g. `fixed h-full`) — they track
            // the iframe height and would balloon the canvas. Revealed dropdowns
            // keep a real rect and are measured so the height recalculates.
            if (win && isNonContentLayer(node, win)) return;
            // Clamp to clipping ancestors so layers hidden by an overflow-hidden
            // container (e.g. stacked tab panels inside `max-h-[720px] overflow-hidden`)
            // don't inflate the measured extent with empty space.
            const clipped = win ? getClippedLayerRect(node, body, win) : rect;
            if (clipped.width <= 0 || clipped.height <= 0) return;
            maxChildWidth = Math.max(maxChildWidth, clipped.right - bodyRect.left);
            maxChildBottom = Math.max(maxChildBottom, clipped.bottom - bodyRect.top);
          });

          onContentWidthChange(maxChildWidth);
          reportHeight(maxChildBottom);
          return;
        }
      }

      // Override viewport-height units (vh, svh, dvh, lvh) with fixed pixel
      // values so layers using these units don't grow with the iframe height.
      if (referenceViewportHeight && referenceViewportHeight > 0) {
        updateViewportOverrides(doc, referenceViewportHeight);
      }

      // Page mode: use content extent (actual child bounds) rather than
      // scrollHeight, which inflates when body h-full fills the iframe.
      const extent = measureContentExtent(doc);
      if (extent > 0) {
        reportHeight(extent);
      }
    };

    // Measure after render — multiple passes to handle Tailwind CDN race.
    // Tailwind Browser CDN processes classes asynchronously via CSSOM APIs
    // (not DOM mutations), so the MutationObserver alone can't detect when
    // styles are applied. measureContentExtent is immune to iframe inflation,
    // so later passes safely converge to the correct value.
    const timeoutId = setTimeout(measureContent, 100);
    const lateTimeoutId = setTimeout(measureContent, 500);

    // Debounce observer to avoid measuring during transient DOM states
    let observerTimer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      clearTimeout(observerTimer);
      observerTimer = setTimeout(() => {
        requestAnimationFrame(measureContent);
      }, 80);
    });

    observer.observe(doc.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    // Also watch <head> for Tailwind CDN style injections that change layout
    // Without this, the initial measurement fires before CSS is applied,
    // and no body mutation triggers a re-measure after styles settle.
    if (doc.head) {
      observer.observe(doc.head, {
        childList: true,
        subtree: true,
      });
    }

    return () => {
      clearTimeout(timeoutId);
      clearTimeout(lateTimeoutId);
      clearTimeout(shrinkTimer);
      clearTimeout(observerTimer);
      observer.disconnect();
    };
  }, [iframeReady, onContentHeightChange, onContentWidthChange, localizedLayers, referenceViewportHeight, breakpoint]);

  // Handle zoom gestures from iframe (Ctrl+wheel, trackpad pinch)
  useEffect(() => {
    if (!iframeReady || !iframeRef.current || !onZoomGesture) return;

    const doc = iframeRef.current.contentDocument;
    if (!doc) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();

        // Positive deltaY means zoom out, negative means zoom in
        const delta = -e.deltaY;
        onZoomGesture(delta);

        return false;
      }
    };

    doc.addEventListener('wheel', handleWheel, { passive: false, capture: true });

    return () => {
      doc.removeEventListener('wheel', handleWheel, { capture: true });
    };
  }, [iframeReady, onZoomGesture]);

  return (
    <iframe
      ref={iframeRef}
      className={cn(
        'w-full h-full border-0',
        editingComponentId ? 'bg-transparent' : 'bg-white'
      )}
      title="Canvas Editor"
      tabIndex={-1}
    />
  );
}, (prev, next) => {
  const keys = Object.keys(next) as Array<keyof CanvasProps>;
  for (const key of keys) {
    if (key === 'selectedLayerId' || key === 'hoveredLayerId') continue;
    if (prev[key] !== next[key]) return false;
  }
  return true;
});

export default Canvas;
