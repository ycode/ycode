'use client';

/**
 * Ycode Builder Main Component
 *
 * Three-panel editor layout inspired by modern design tools
 *
 * This component is shared across ALL editor routes to prevent remounts:
 * - /ycode (base route)
 * - /ycode/pages/[id]/edit (page settings)
 * - /ycode/pages/[id]/layers (page layers)
 * - /ycode/collections/[id] (collections)
 * - /ycode/components/[id] (component editing)
 * - /ycode/settings (settings pages)
 * - /ycode/localization (localization pages)
 *
 * By using the same component instance everywhere, we prevent migration
 * checks and data reloads on every navigation.
 */

// 1. React/Next.js
import { useEffect, useState, useMemo, useRef, useCallback, Suspense, lazy } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
// 2. Internal components
import AiChatPanel from '../components/ai/AiChatPanel';
import CenterCanvas from '../components/CenterCanvas';
import HeaderBar from '../components/HeaderBar';
import LeftSidebar from '../components/LeftSidebar';
import SettingsContent from '../components/SettingsContent';
import LocalizationContent from '../components/LocalizationContent';
import ProfileContent from '../components/ProfileContent';
import IntegrationsContent from '../components/IntegrationsContent';
import MigrationChecker from '@/components/MigrationChecker';
import BuilderLoading from '@/components/BuilderLoading';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { checkCircularReference, detachSpecificLayerFromComponent } from '@/lib/component-utils';

// Right sidebar is always visible in editor mode - load eagerly to avoid delay
import RightPanel from '../components/RightPanel';

// Lazy-loaded components (heavy, not needed on initial render)
const CMS = lazy(() => import('../components/CMS'));
const CollectionItemSheet = lazy(() => import('../components/CollectionItemSheet'));
const FileManagerDialog = lazy(() => import('../components/FileManagerDialog'));
const KeyboardShortcutsDialog = lazy(() => import('../components/KeyboardShortcutsDialog'));
const CreateComponentDialog = lazy(() => import('../components/CreateComponentDialog'));
const CssVariablesEditorOverlay = lazy(() => import('../components/css-variables/CssVariablesEditorOverlay'));
const DragPreviewPortal = lazy(() => import('@/components/DragPreviewPortal'));

// Collaboration components (lazy-loaded)
const RealtimeCursors = lazy(() => import('@/components/realtime-cursors').then(m => ({ default: m.RealtimeCursors })));

// 3. Hooks
// useCanvasCSS removed - now handled by iframe with Tailwind JIT CDN
import { useEditorUrl } from '@/hooks/use-editor-url';
import { useLiveColorVariableUpdates } from '@/hooks/use-live-color-variable-updates';
import { useLiveFontUpdates } from '@/hooks/use-live-font-updates';
import { useLiveLayerUpdates } from '@/hooks/use-live-layer-updates';
import { useLivePageUpdates } from '@/hooks/use-live-page-updates';
import { useLiveComponentUpdates } from '@/hooks/use-live-component-updates';
import { useLiveLayerStyleUpdates } from '@/hooks/use-live-layer-style-updates';

// 4. Stores
import { useAgentSettingsStore } from '@/stores/useAgentSettingsStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useClipboardStore } from '@/stores/useClipboardStore';
import { useEditorStore } from '@/stores/useEditorStore';
import { usePagesStore, consumePageMcpSync } from '@/stores/usePagesStore';
import { useComponentsStore } from '@/stores/useComponentsStore';
import { useCanvasTextEditorStore } from '@/stores/useCanvasTextEditorStore';
import { useLayerStylesStore } from '@/stores/useLayerStylesStore';
import { useCollaborationPresenceStore, getResourceLockKey, RESOURCE_TYPES } from '@/stores/useCollaborationPresenceStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useCollectionsStore } from '@/stores/useCollectionsStore';
import { useAssetsStore } from '@/stores/useAssetsStore';
import { useFontsStore } from '@/stores/useFontsStore';
import { useLocalisationStore } from '@/stores/useLocalisationStore';
import { useMigrationStore } from '@/stores/useMigrationStore';
import { useVersionsStore } from '@/stores/useVersionsStore';
import { useRole } from '@/hooks/use-role';
import { useImportPaste } from '@/hooks/use-import-paste';
import type { ExternalPastePlacement } from '@/stores/useExternalPasteStore';
// Collaboration temporarily disabled
// import { useCollaborationPresenceStore } from '@/stores/useCollaborationPresenceStore';

// 6. Utils/lib
import { findHomepage } from '@/lib/page-utils';
import { hasTextSelection } from '@/lib/utils';
import { getStyleIds } from '@/lib/layer-style-resolve';
import { findLayerById, getClassesString, removeLayerById, canCopyLayer, canDeleteLayer, regenerateIdsWithInteractionRemapping, findParentAndIndex, insertLayerAfter, updateLayerProps, getLayerIndexes, removeRichTextSublayer, canPasteIntoParent, canHaveChildren, LINK_NESTING_ERROR } from '@/lib/layer-utils';
import { cloneDeep } from 'lodash';

// 5. Types
import type { Layer, Asset } from '@/types';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Alert, AlertTitle } from '@/components/ui/alert';

interface YCodeBuilderProps {
  children?: React.ReactNode;
}

export default function YCodeBuilder({ children }: YCodeBuilderProps = {} as YCodeBuilderProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { routeType, resourceId, sidebarTab, navigateToLayers, navigateToCollection, navigateToCollections, navigateToComponent, urlState, updateQueryParams } = useEditorUrl();

  // Role-based access
  const { isEditor, canEditStructure } = useRole();

  // Agent can be turned off in Settings → Agent; the builder then only shows
  // manual mode (RightPanel handles its own fallback, this gates the CMS panel).
  const agentEnabled = useAgentSettingsStore((state) => state.status?.agentEnabled ?? true);
  const canEditStructureRef = useRef(canEditStructure);
  canEditStructureRef.current = canEditStructure;

  // Optimize store subscriptions - use selective selectors to prevent unnecessary re-renders
  const signOut = useAuthStore((state) => state.signOut);
  const user = useAuthStore((state) => state.user);
  const authInitialized = useAuthStore((state) => state.initialized);

  const setSelectedLayerId = useEditorStore((state) => state.setSelectedLayerId);
  const clearSelection = useEditorStore((state) => state.clearSelection);
  const currentPageId = useEditorStore((state) => state.currentPageId);
  const setCurrentPageId = useEditorStore((state) => state.setCurrentPageId);
  const activeBreakpoint = useEditorStore((state) => state.activeBreakpoint);
  const setActiveBreakpoint = useEditorStore((state) => state.setActiveBreakpoint);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const canUndo = useEditorStore((state) => state.canUndo);
  const canRedo = useEditorStore((state) => state.canRedo);
  const editingComponentId = useEditorStore((state) => state.editingComponentId);
  const aiBuildingPageId = useEditorStore((state) => state.aiBuildingPageId);
  const aiBuildingComponentId = useEditorStore((state) => state.aiBuildingComponentId);
  const aiBuildingComponentVariantId = useEditorStore((state) => state.aiBuildingComponentVariantId);
  const pendingAiComponentExit = useEditorStore((state) => state.pendingAiComponentExit);
  const builderDataPreloaded = useEditorStore((state) => state.builderDataPreloaded);
  const setBuilderDataPreloaded = useEditorStore((state) => state.setBuilderDataPreloaded);
  const collectionItemSheet = useEditorStore((state) => state.collectionItemSheet);
  const closeCollectionItemSheet = useEditorStore((state) => state.closeCollectionItemSheet);
  const fileManager = useEditorStore((state) => state.fileManager);
  const closeFileManager = useEditorStore((state) => state.closeFileManager);
  const createComponentDialog = useEditorStore((state) => state.createComponentDialog);
  const openCreateComponentDialog = useEditorStore((state) => state.openCreateComponentDialog);
  const closeCreateComponentDialog = useEditorStore((state) => state.closeCreateComponentDialog);
  const activeSublayerIndex = useEditorStore((state) => state.activeSublayerIndex);
  const setActiveSublayerIndex = useEditorStore((state) => state.setActiveSublayerIndex);

  const collections = useCollectionsStore((state) => state.collections);
  const selectedCollectionId = useCollectionsStore((state) => state.selectedCollectionId);

  const updateLayer = usePagesStore((state) => state.updateLayer);
  const currentDraft = usePagesStore((state) => currentPageId ? state.draftsByPageId[currentPageId] : null);
  const draftsLoaded = usePagesStore((state) => Object.keys(state.draftsByPageId).length > 0);
  const deleteLayer = usePagesStore((state) => state.deleteLayer);
  const deleteLayers = usePagesStore((state) => state.deleteLayers);
  const saveDraft = usePagesStore((state) => state.saveDraft);
  const copyLayerFromStore = usePagesStore((state) => state.copyLayer);
  const copyLayersFromStore = usePagesStore((state) => state.copyLayers);
  const duplicateLayer = usePagesStore((state) => state.duplicateLayer);
  const duplicateLayersFromStore = usePagesStore((state) => state.duplicateLayers);
  const pasteAfter = usePagesStore((state) => state.pasteAfter);
  const pasteInside = usePagesStore((state) => state.pasteInside);
  const setDraftLayers = usePagesStore((state) => state.setDraftLayers);
  const loadPages = usePagesStore((state) => state.loadPages);
  const createComponentFromLayer = usePagesStore((state) => state.createComponentFromLayer);
  const pages = usePagesStore((state) => state.pages);

  const clipboardLayer = useClipboardStore((state) => state.clipboardLayer);
  const clipboardLayers = useClipboardStore((state) => state.clipboardLayers);
  const copyToClipboard = useClipboardStore((state) => state.copyLayer);
  const cutToClipboard = useClipboardStore((state) => state.cutLayer);
  const copyLayersToClipboard = useClipboardStore((state) => state.copyLayers);
  const cutLayersToClipboard = useClipboardStore((state) => state.cutLayers);
  const copyStyleToClipboard = useClipboardStore((state) => state.copyStyle);
  const pasteStyleFromClipboard = useClipboardStore((state) => state.pasteStyle);

  const componentIsSaving = useComponentsStore((state) => state.isSaving);
  const components = useComponentsStore((state) => state.components);
  // Track the active variant draft so layer-tracking refs (selection
  // restoration, dirty detection) react to variant edits.
  const editingComponentVariantId = useEditorStore((state) => state.editingComponentVariantId);
  const componentDraftLayers = useComponentsStore((state) => {
    if (!editingComponentId) return null;
    const drafts = state.componentDrafts[editingComponentId];
    if (!drafts) return null;
    const variantId = (editingComponentVariantId && drafts[editingComponentVariantId])
      ? editingComponentVariantId
      : Object.keys(drafts)[0];
    return variantId ? drafts[variantId] ?? null : null;
  });

  const migrationsComplete = useMigrationStore((state) => state.migrationsComplete);
  const setMigrationsComplete = useMigrationStore((state) => state.setMigrationsComplete);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [showPageDropdown, setShowPageDropdown] = useState(false);
  const [viewportMode, setViewportMode] = useState<'desktop' | 'tablet' | 'mobile'>(
    urlState.view || 'desktop'
  );
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Tracks the last-seen layers reference per page. Reference equality is
  // sufficient because store mutators always produce a new layers array on
  // actual changes (React relies on this for re-rendering).
  const lastLayersByPageRef = useRef<Map<string, Layer[]>>(new Map());
  const previousPageIdRef = useRef<string | null>(null);
  const previousResourceIdRef = useRef<string | null>(null); // Track URL resourceId changes
  const previousComponentResourceIdRef = useRef<string | null>(null); // Track URL component id changes
  const hasInitializedLayerFromUrlRef = useRef(false);
  const previousIsEditingRef = useRef<boolean | undefined>(undefined);

  // Collaboration hooks - enable realtime sync for layers and pages
  const liveLayerUpdates = useLiveLayerUpdates(currentPageId);
  // useLivePageUpdates initializes page sync subscriptions by being called
  const _livePageUpdates = useLivePageUpdates();
  // Component and layer style sync hooks
  const liveComponentUpdates = useLiveComponentUpdates();
  const liveLayerStyleUpdates = useLiveLayerStyleUpdates();
  // Refetch fonts when the AI agent installs one server-side
  useLiveFontUpdates();
  // Refetch color variables when the AI agent creates/updates tokens server-side
  useLiveColorVariableUpdates();

  // Collaboration presence - set current user for syncing
  const setCurrentCollaborationUser = useCollaborationPresenceStore((state) => state.setCurrentUser);
  useEffect(() => {
    if (user) {
      const avatarUrl = user.user_metadata?.avatar_url || null;
      setCurrentCollaborationUser(user.id, user.email || '', avatarUrl);
    }
  }, [user, setCurrentCollaborationUser]);

  // Redirect editors away from restricted routes
  useEffect(() => {
    if (!isEditor || !authInitialized) return;
    const restricted = routeType === 'settings' || routeType === 'integrations' || routeType === 'component';
    if (restricted) {
      const targetPageId = currentPageId || pages[0]?.id;
      if (targetPageId) {
        navigateToLayers(targetPageId);
      } else {
        router.replace('/ycode');
      }
    }
  }, [isEditor, authInitialized, routeType, currentPageId, pages, navigateToLayers, router]);

  // Sidebar tab from store - immediately synced when tab changes in LeftSidebar
  const activeSidebarTab = useEditorStore((state) => state.activeSidebarTab);
  // Use store-based tab for instant UI feedback, fallback to URL-based for initial load
  const activeTab = activeSidebarTab || sidebarTab;

  // Combined saving state - either page or component
  const isCurrentlySaving = editingComponentId ? componentIsSaving : isSaving;

  // Helper: Get current layers (from page or active component variant)
  const getCurrentLayers = useCallback((): Layer[] => {
    if (editingComponentId) {
      const { componentDrafts, getComponentDraftLayers } = useComponentsStore.getState();
      const drafts = componentDrafts[editingComponentId];
      const variantId = (editingComponentVariantId && drafts?.[editingComponentVariantId])
        ? editingComponentVariantId
        : (drafts ? Object.keys(drafts)[0] : null);
      return getComponentDraftLayers(editingComponentId, variantId);
    }
    if (currentPageId) {
      return currentDraft ? currentDraft.layers : [];
    }
    return [];
  }, [editingComponentId, editingComponentVariantId, currentPageId, currentDraft]);

  // Helper: Update current layers (page or active component variant)
  const updateCurrentLayers = useCallback((newLayers: Layer[]) => {
    if (editingComponentId) {
      const { componentDrafts, updateComponentDraft } = useComponentsStore.getState();
      const drafts = componentDrafts[editingComponentId];
      const variantId = (editingComponentVariantId && drafts?.[editingComponentVariantId])
        ? editingComponentVariantId
        : (drafts ? Object.keys(drafts)[0] : null);
      if (variantId) {
        updateComponentDraft(editingComponentId, variantId, newLayers);
      }
    } else if (currentPageId) {
      setDraftLayers(currentPageId, newLayers);
    }
  }, [editingComponentId, editingComponentVariantId, currentPageId, setDraftLayers]);

  // Import paste: insert layers produced by an import (Webflow / Figma).
  // Placement mirrors Ycode's own copy/paste: insert inside the selected layer
  // when it can hold children, otherwise drop in as a sibling next to it; with
  // nothing suitable selected, fall back to the page root (body).
  const insertImportedLayers = useCallback((layers: Layer[], placement?: ExternalPastePlacement) => {
    if (layers.length === 0 || !canEditStructure) return;

    // Explicit placement from the context menu's "Paste after / inside": honour
    // the chosen position relative to the target layer instead of the default
    // selection-based heuristic below.
    if (placement) {
      if (editingComponentId) {
        const circularError = checkCircularReference(editingComponentId, layers, components);
        if (circularError) {
          toast.error('Infinite component loop detected', { description: circularError });
          return;
        }
        const currentLayers = getCurrentLayers();
        const target = findLayerById(currentLayers, placement.layerId);
        if (!target) return;

        let updated: Layer[];
        if (placement.mode === 'inside') {
          if (layers.some(l => !canPasteIntoParent(currentLayers, target.id, l))) {
            toast.error(LINK_NESTING_ERROR.title, { description: LINK_NESTING_ERROR.description });
            return;
          }
          updated = updateLayerProps(currentLayers, target.id, {
            children: [...(target.children || []), ...layers],
          });
        } else {
          const result = findParentAndIndex(currentLayers, target.id);
          if (!result) return;
          if (
            result.parent &&
            layers.some(l => !canPasteIntoParent(currentLayers, result.parent!.id, l))
          ) {
            toast.error(LINK_NESTING_ERROR.title, { description: LINK_NESTING_ERROR.description });
            return;
          }
          updated = currentLayers;
          let index = result.index;
          for (const layer of layers) {
            updated = insertLayerAfter(updated, result.parent, index, layer);
            index += 1;
          }
        }
        updateCurrentLayers(updated);
        setSelectedLayerId(layers[0].id);
        return;
      }

      if (!currentPageId) return;
      if (placement.mode === 'inside') {
        for (const layer of layers) {
          if (!pasteInside(currentPageId, placement.layerId, layer)) {
            toast.error(LINK_NESTING_ERROR.title, { description: LINK_NESTING_ERROR.description });
            return;
          }
        }
      } else {
        let anchorId = placement.layerId;
        for (const layer of layers) {
          const pasted = pasteAfter(currentPageId, anchorId, layer);
          if (!pasted) {
            toast.error(LINK_NESTING_ERROR.title, { description: LINK_NESTING_ERROR.description });
            return;
          }
          anchorId = pasted.id;
        }
      }
      setSelectedLayerId(layers[0].id);
      return;
    }

    const selectedId = selectedLayerIdRef.current;

    // Component editor: the store paste actions are page-scoped, so operate
    // directly on the component's layer tree using the same rules.
    if (editingComponentId) {
      const circularError = checkCircularReference(editingComponentId, layers, components);
      if (circularError) {
        toast.error('Infinite component loop detected', { description: circularError });
        return;
      }
      const currentLayers = getCurrentLayers();
      const selected = selectedId ? findLayerById(currentLayers, selectedId) : null;

      let updated: Layer[];
      if (selected && canHaveChildren(selected)) {
        const appendInto = (nodes: Layer[]): Layer[] =>
          nodes.map(node =>
            node.id === selected.id
              ? { ...node, children: [...(node.children || []), ...layers] }
              : node.children && node.children.length > 0
                ? { ...node, children: appendInto(node.children) }
                : node,
          );
        updated = appendInto(currentLayers);
      } else if (selected) {
        const result = findParentAndIndex(currentLayers, selected.id);
        if (
          result?.parent &&
          layers.some(l => !canPasteIntoParent(currentLayers, result.parent!.id, l))
        ) {
          toast.error(LINK_NESTING_ERROR.title, { description: LINK_NESTING_ERROR.description });
          return;
        }
        const parent = result?.parent ?? null;
        let index = result ? result.index : currentLayers.length - 1;
        updated = currentLayers;
        for (const layer of layers) {
          updated = insertLayerAfter(updated, parent, index, layer);
          index += 1;
        }
      } else {
        updated = [...currentLayers, ...layers];
      }

      updateCurrentLayers(updated);
      setSelectedLayerId(layers[0].id);
      return;
    }

    if (!currentPageId) return;

    const currentLayers = getCurrentLayers();
    const selected = selectedId ? findLayerById(currentLayers, selectedId) : null;

    if (!selected || canHaveChildren(selected)) {
      // Inside the selected container — or the page root when nothing usable
      // is selected. pasteInside appends in order, preserving layer sequence.
      const targetId = selected
        ? selected.id
        : currentLayers.find(l => l.id === 'body' || l.name === 'body')?.id ?? 'body';
      for (const layer of layers) {
        if (!pasteInside(currentPageId, targetId, layer)) {
          toast.error(LINK_NESTING_ERROR.title, { description: LINK_NESTING_ERROR.description });
          return;
        }
      }
    } else {
      // Selected layer can't hold children — drop in next to it. Chain the
      // anchor through each pasted layer so the original order is kept.
      let anchorId = selected.id;
      for (const layer of layers) {
        const pasted = pasteAfter(currentPageId, anchorId, layer);
        if (!pasted) {
          toast.error(LINK_NESTING_ERROR.title, { description: LINK_NESTING_ERROR.description });
          return;
        }
        anchorId = pasted.id;
      }
    }

    setSelectedLayerId(layers[0].id);
  }, [canEditStructure, editingComponentId, components, currentPageId, getCurrentLayers, updateCurrentLayers, setSelectedLayerId, pasteInside, pasteAfter]);

  // Normal Ycode paste (internal clipboard) — extracted from keydown so it
  // can run inside the paste event handler after Figma detection fails.
  const handleNormalPaste = useCallback(() => {
    if (!canEditStructure) return;
    const selectedLayerId = selectedLayerIdRef.current;
    // In-memory fallback for when the OS clipboard bundle couldn't be written
    // (denied/too large). Supports the full multi-select selection.
    const layersToPaste = clipboardLayers.length > 0
      ? clipboardLayers
      : clipboardLayer
        ? [clipboardLayer]
        : [];
    if (layersToPaste.length === 0 || !selectedLayerId) return;

    if (editingComponentId) {
      let working = getCurrentLayers();
      let anchorId = selectedLayerId;
      for (const source of layersToPaste) {
        const circularError = checkCircularReference(editingComponentId, source, components);
        if (circularError) {
          toast.error('Infinite component loop detected', { description: circularError });
          return;
        }
        const result = findParentAndIndex(working, anchorId);
        if (!result) break;
        if (result.parent && !canPasteIntoParent(working, result.parent.id, source)) {
          toast.error(LINK_NESTING_ERROR.title, { description: LINK_NESTING_ERROR.description });
          return;
        }
        const newLayer = regenerateIdsWithInteractionRemapping(cloneDeep(source));
        working = insertLayerAfter(working, result.parent, result.index, newLayer);
        anchorId = newLayer.id;
      }
      updateCurrentLayers(working);
    } else if (currentPageId) {
      let anchorId = selectedLayerId;
      for (const source of layersToPaste) {
        const pastedLayer = anchorId === 'body'
          ? pasteInside(currentPageId, anchorId, source)
          : pasteAfter(currentPageId, anchorId, source);
        if (!pastedLayer) {
          toast.error(LINK_NESTING_ERROR.title, { description: LINK_NESTING_ERROR.description });
          return;
        }
        // Chain subsequent layers after the one just pasted (unless pasting
        // into body, where order is preserved by appending).
        if (anchorId !== 'body') anchorId = pastedLayer.id;
      }
    }
  }, [canEditStructure, clipboardLayer, clipboardLayers, editingComponentId, components, getCurrentLayers, updateCurrentLayers, currentPageId, pasteInside, pasteAfter]);

  useImportPaste({
    enabled: !!(currentPageId || editingComponentId),
    insertLayers: insertImportedLayers,
    onNormalPaste: handleNormalPaste,
  });

  // Check if Supabase is configured, redirect to setup if not
  const [supabaseConfigured, setSupabaseConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    const checkSupabaseConfig = async () => {
      try {
        const response = await fetch('/ycode/api/setup/status');
        const data = await response.json();

        if (!data.is_configured) {
          // Redirect to setup wizard
          router.push('/ycode/welcome');
          return;
        }

        setSupabaseConfigured(true);
      } catch (err) {
        console.error('Failed to check Supabase config:', err);
        // On error, redirect to setup to be safe
        router.push('/ycode/welcome');
      }
    };

    checkSupabaseConfig();
  }, [router]);

  // Sync viewportMode with activeBreakpoint in store
  useEffect(() => {
    setActiveBreakpoint(viewportMode);
  }, [viewportMode, setActiveBreakpoint]);

  // Sync preview mode from URL parameter
  const isPreviewMode = useEditorStore((state) => state.isPreviewMode);
  const setPreviewMode = useEditorStore((state) => state.setPreviewMode);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const previewParam = searchParams.get('preview');
    const shouldBeInPreview = previewParam === 'true';

    // Only update if there's an actual change to prevent unnecessary re-renders
    if (shouldBeInPreview !== isPreviewMode) {
      setPreviewMode(shouldBeInPreview);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlState, setPreviewMode]); // Remove isPreviewMode from deps to prevent loop

  // Track edit mode transitions to prevent effects from running during navigation
  const currentIsEditing = urlState.isEditing;
  const justExitedEditMode = previousIsEditingRef.current === true && currentIsEditing === false;

  // Update ref synchronously before effects run
  if (previousIsEditingRef.current !== currentIsEditing) {
    previousIsEditingRef.current = currentIsEditing;
  }

  // Sync viewport changes to URL (skip when in page settings mode or during edit mode transition)
  useEffect(() => {
    // Skip if we just transitioned away from edit mode - navigation already includes all params
    if (justExitedEditMode) {
      return;
    }

    if ((routeType === 'page' || routeType === 'layers') && !urlState.isEditing && urlState.view !== viewportMode) {
      updateQueryParams({ view: viewportMode });
    }
  }, [viewportMode, routeType, updateQueryParams, urlState.view, urlState.isEditing, justExitedEditMode]);

  // Reset layer initialization flag when route type changes
  useEffect(() => {
    // When switching between route types, reset initialization so new route can initialize properly
    hasInitializedLayerFromUrlRef.current = false;
  }, [routeType]);

  // Initialize selected layer from URL ONLY on initial load (not on subsequent URL changes)
  useEffect(() => {
    // Only run once when the builder first loads
    if (hasInitializedLayerFromUrlRef.current) {
      return;
    }

    // Handle layer selection for pages and components
    const isPageOrLayersRoute = routeType === 'page' || routeType === 'layers';
    const isComponentRoute = routeType === 'component';

    if ((isPageOrLayersRoute || isComponentRoute) && urlState.layerId) {
      // For pages, wait for draft. For components, wait for component draft
      if (isPageOrLayersRoute && currentPageId) {
        if (!currentDraft || !currentDraft.layers) {
          return; // Draft not loaded yet, wait for next render
        }
      } else if (isComponentRoute && editingComponentId) {
        if (!componentDraftLayers) {
          return; // Component draft not loaded yet, will re-run when it arrives
        }
      } else {
        return; // Not ready yet
      }

      // Validate that the layer exists in current page/component
      const layers = getCurrentLayers();
      const layerExists = findLayerById(layers, urlState.layerId);

      if (layerExists) {
        setSelectedLayerId(urlState.layerId);
      } else {
        // Layer not found - clear selection
        console.warn(`[Editor] Layer "${urlState.layerId}" not found on initial load, clearing selection`);
        setSelectedLayerId(null);
      }

      hasInitializedLayerFromUrlRef.current = true;
    } else if ((isPageOrLayersRoute || isComponentRoute) && !urlState.layerId) {
      // No layer in URL - mark as initialized so clicks will update URL from now on
      if (isPageOrLayersRoute && currentPageId) {
        if (currentDraft && currentDraft.layers) {
          hasInitializedLayerFromUrlRef.current = true;
        }
      } else if (isComponentRoute && editingComponentId) {
        if (componentDraftLayers) {
          hasInitializedLayerFromUrlRef.current = true;
        }
      }
    }
  }, [urlState.layerId, resourceId, routeType, setSelectedLayerId, currentPageId, editingComponentId, currentDraft, componentDraftLayers, getCurrentLayers]);

  // Sync selected layer to URL imperatively (avoids re-rendering YCodeBuilderMain on selection change)
  const urlSyncDepsRef = useRef({ routeType, updateQueryParams, urlLayerId: urlState.layerId, isEditing: urlState.isEditing });
  urlSyncDepsRef.current = { routeType, updateQueryParams, urlLayerId: urlState.layerId, isEditing: urlState.isEditing };

  useEffect(() => {
    let prevLayerId: string | null = null;
    const unsub = useEditorStore.subscribe((state) => {
      const layerId = state.selectedLayerId;
      if (layerId === prevLayerId) return;
      prevLayerId = layerId;

      if (!hasInitializedLayerFromUrlRef.current) return;
      const { routeType: rt, updateQueryParams: uqp, urlLayerId, isEditing } = urlSyncDepsRef.current;
      const isPageOrLayersRoute = rt === 'page' || rt === 'layers';
      const isComponentRoute = rt === 'component';
      if ((isPageOrLayersRoute || isComponentRoute) && !isEditing && layerId) {
        if (urlLayerId !== layerId) {
          uqp({ layer: layerId });
        }
      }
    });
    return unsub;
  }, []);

  // Generate initial CSS if draft_css is empty (one-time check after data loads)
  const initialCssCheckRef = useRef(false);
  const settingsLoaded = useSettingsStore((state) => state.settings.length > 0);
  useEffect(() => {
    // Early return if already checked - this must be the FIRST check
    if (initialCssCheckRef.current) {
      return;
    }

    // Wait for all initial data to be loaded
    if (!migrationsComplete || !draftsLoaded || !settingsLoaded) {
      return;
    }

    // Mark as checked immediately to prevent re-runs, even if we return early below
    initialCssCheckRef.current = true;

    // On initial load, check if draft_css exists in settings
    const { getSettingByKey } = useSettingsStore.getState();
    const existingDraftCSS = getSettingByKey('draft_css');

    // If draft_css exists and is not empty, skip initial generation
    if (existingDraftCSS && existingDraftCSS.trim().length > 0) {
      // Don't log here - this is expected behavior and happens once
      return;
    }

    // Generate initial CSS if it doesn't exist
    const generateInitialCSS = async () => {
      try {
        const { generateAndSaveCSS } = await import('@/lib/client/cssGenerator');

        // Collect layers from ALL pages for comprehensive CSS generation
        // Use current draftsByPageId from store at execution time
        const currentDrafts = usePagesStore.getState().draftsByPageId;
        const allLayers: Layer[] = [];
        Object.values(currentDrafts).forEach(draft => {
          if (draft.layers) {
            allLayers.push(...draft.layers);
          }
        });

        await generateAndSaveCSS(allLayers);
      } catch (error) {
        console.error('[Editor] Failed to generate initial CSS:', error);
      }
    };

    generateInitialCSS();
  }, [migrationsComplete, draftsLoaded, settingsLoaded]);

  // Add overflow-hidden to body when builder is mounted
  useEffect(() => {
    document.body.classList.add('overflow-hidden');
    return () => {
      document.body.classList.remove('overflow-hidden');
    };
  }, []);

  // Login state (when not authenticated)
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Ensure dark mode is applied for login screen on client-side navigation
  useEffect(() => {
    if (!user) {
      document.documentElement.classList.add('dark');
    }
  }, [user]);

  // After login, honor `?next=` (used by the OAuth consent flow to bounce
  // unauthenticated users through `/ycode` and back). Only same-origin
  // paths starting with `/ycode` are accepted to prevent open redirects.
  useEffect(() => {
    if (!user || !authInitialized) return;
    const next = searchParams?.get('next');
    if (!next) return;
    if (!next.startsWith('/ycode')) return;
    router.replace(next);
  }, [user, authInitialized, searchParams, router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError(null);

    const { signIn } = useAuthStore.getState();
    const result = await signIn(loginEmail, loginPassword);

    if (result.error) {
      setLoginError(result.error);
      setIsLoggingIn(false);
    }
    // If successful, user state will update and component will re-render with builder
  };

  // Track initial data load completion
  const initialLoadRef = useRef(false);

  useEffect(() => {
    if (migrationsComplete && !builderDataPreloaded && !initialLoadRef.current) {
      initialLoadRef.current = true;

      // Load everything in parallel using Promise.all
      const loadBuilderData = async () => {
        try {
          const { editorApi } = await import('@/lib/api');
          const response = await editorApi.init();

          if (response.error) {
            console.error('[Editor] Error loading initial data:', response.error);

            if (response.error === 'Not authenticated') {
              toast.error('You have been disconnected, please log in again');
              useAuthStore.getState().signOut();
            }

            setBuilderDataPreloaded(true);
            return;
          }

          if (response.data) {
            // Get store actions
            const { setPagesAndDrafts, setFolders } = usePagesStore.getState();
            const { setComponents } = useComponentsStore.getState();
            const { setStyles } = useLayerStylesStore.getState();
            const { setSettings } = useSettingsStore.getState();
            const { setLocales } = useLocalisationStore.getState();
            const { setAssets, setFolders: setAssetFolders } = useAssetsStore.getState();
            const { setFonts } = useFontsStore.getState();
            const { preloadCollectionsAndItems } = useCollectionsStore.getState();

            // Set synchronous data first
            setPagesAndDrafts(response.data.pages, response.data.drafts);
            setFolders(response.data.folders || []);
            setComponents(response.data.components);
            setStyles(response.data.styles);
            setSettings(response.data.settings);
            setLocales(response.data.locales || []);

            // Eager-load translations if the persisted selected locale is non-default
            // so the canvas reflects the locale on first paint instead of source content.
            const localisationState = useLocalisationStore.getState();
            const persistedLocaleId = localisationState.selectedLocaleId;
            if (persistedLocaleId) {
              const persistedLocale = localisationState.locales.find(l => l.id === persistedLocaleId);
              if (persistedLocale && !persistedLocale.is_default) {
                localisationState.loadTranslations(persistedLocaleId);
              }
            }
            setAssets(response.data.assets || []);
            setAssetFolders(response.data.assetFolders || []);
            setFonts(response.data.fonts || []);

            // Load async data in parallel
            const asyncTasks: Promise<unknown>[] = [];

            // Add collections preloading if we have collections
            if (response.data.collections && response.data.collections.length > 0) {
              asyncTasks.push(preloadCollectionsAndItems(response.data.collections));
            }

            // Load CSS variables graph (covers legacy color variables too via the façade)
            const { useCssVariablesStore } = await import('@/stores/useCssVariablesStore');
            asyncTasks.push(useCssVariablesStore.getState().loadGraph());

            // Load global variables (available as a binding source everywhere)
            const { useGlobalsStore } = await import('@/stores/useGlobalsStore');
            asyncTasks.push(useGlobalsStore.getState().loadGlobals());

            // Wait for all async tasks to complete
            if (asyncTasks.length > 0) {
              await Promise.all(asyncTasks);
            }

            // Mark data as preloaded - NOW UI can render
            setBuilderDataPreloaded(true);
          }
        } catch (error) {
          console.error('[Editor] Error loading builder data:', error);
          setBuilderDataPreloaded(true); // Allow UI to render even on error
        }
      };

      loadBuilderData();
    }
  }, [migrationsComplete, builderDataPreloaded, setBuilderDataPreloaded]);

  // Handle URL-based navigation after data loads
  useEffect(() => {
    const isPagesRoute = routeType === 'layers' || routeType === 'page' || !routeType;
    const isComponentRoute = routeType === 'component';
    const isCollectionRoute = routeType === 'collection';

    if (!migrationsComplete) return;
    if (isPagesRoute && pages.length === 0) return;
    if (isComponentRoute && components.length === 0) return;
    if (isCollectionRoute && collections.length === 0 && !builderDataPreloaded) return;

    // Reset the component-id tracker when leaving component routes so
    // re-entering the same component later is still detected as a change.
    if (!isComponentRoute) {
      previousComponentResourceIdRef.current = null;
    }

    // Handle route types: layers, page, collection, collections-base, component
    if ((routeType === 'layers' || routeType === 'page') && resourceId) {
      const page = pages.find(p => p.id === resourceId);
      // Only update currentPageId if the URL's resourceId actually changed
      // This prevents reverting when currentPageId was set manually before URL updates
      const resourceIdChanged = resourceId !== previousResourceIdRef.current;
      previousResourceIdRef.current = resourceId;

      if (page && resourceIdChanged && currentPageId !== resourceId) {
        setCurrentPageId(resourceId);
        // Only select body for layers mode if no layer is specified in URL
        if (routeType === 'layers' && !urlState.layerId) {
          setSelectedLayerId('body');
        }
      } else if (!page && pages.length > 0) {
        // Page not found - redirect to homepage
        const homePage = findHomepage(pages);
        const defaultPage = homePage || pages[0];
        if (defaultPage) {
          navigateToLayers(defaultPage.id);
        }
      }
    } else if (routeType === 'collection' && resourceId) {
      const storeState = useCollectionsStore.getState();

      // Skip if already selected (e.g. CMS just created a collection and set it)
      if (storeState.selectedCollectionId === resourceId) {
        // Already selected — nothing to do
      } else if (resourceId.startsWith('temp-')) {
        storeState.setSelectedCollectionId(resourceId);
      } else {
        const collectionExists = storeState.collections.some(c => c.id === resourceId);

        if (collectionExists) {
          storeState.setSelectedCollectionId(resourceId);
        } else if (storeState.collections.length > 0) {
          storeState.setSelectedCollectionId(storeState.collections[0].id);
          navigateToCollection(storeState.collections[0].id);
        } else {
          storeState.setSelectedCollectionId(null);
          navigateToCollections();
        }
      }
    } else if (routeType === 'collections-base') {
      // On base collections route, don't set a selected collection
    }

    // Ensure a currentPageId is set on non-design routes (CMS, Forms) so
    // preview can navigate to a page — default to homepage if unset
    if (!currentPageId && pages.length > 0) {
      const isNonDesignRoute = routeType === 'collection' || routeType === 'collections-base' || routeType === 'forms';
      if (isNonDesignRoute) {
        const homePage = findHomepage(pages);
        const defaultPage = homePage || pages[0];
        if (defaultPage) {
          setCurrentPageId(defaultPage.id);
        }
      }
    }

    if (routeType === 'component' && resourceId && !isExitingComponentModeRef.current) {
      // Only sync state from the URL when the URL's component id actually
      // changed. Otherwise this effect re-runs when editingComponentId is set
      // programmatically (e.g. entering a nested component) before the URL
      // updates, and reverts it back to the stale parent component id.
      const componentResourceChanged = resourceId !== previousComponentResourceIdRef.current;
      previousComponentResourceIdRef.current = resourceId;

      const { getComponentById, loadComponentDraft } = useComponentsStore.getState();
      const component = getComponentById(resourceId);
      if (component && editingComponentId !== resourceId && componentResourceChanged) {
        const { setEditingComponentId, setEditingComponentVariantId } = useEditorStore.getState();
        // Use currentPageId if available, otherwise find homepage as fallback
        const returnPageId = currentPageId || (pages.length > 0 ? (findHomepage(pages)?.id || pages[0]?.id) : null);
        setEditingComponentId(resourceId, returnPageId);
        // Restore the active variant from the URL when present so reloads land
        // back on the same variant. Falls back to the first variant when the
        // URL is missing/stale, matching `use-edit-component`.
        const variantFromUrl = urlState.variantId;
        const variantExists = variantFromUrl
          && component.variants?.some(v => v.id === variantFromUrl);
        const initialVariantId = variantExists
          ? variantFromUrl!
          : (component.variants && component.variants.length > 0 ? component.variants[0].id : null);
        setEditingComponentVariantId(initialVariantId);
        // Load component draft (async but we don't need to await in this context)
        loadComponentDraft(resourceId);
      }
    } else if (!currentPageId && !routeType && pages.length > 0) {
      // No URL resource and no current page - set default page and redirect to layers
      const homePage = findHomepage(pages);
      const defaultPage = homePage || pages[0];
      setCurrentPageId(defaultPage.id);
      setSelectedLayerId('body');
      // Redirect to layers route for the default page with default params
      // navigateToLayers will automatically include view=desktop, tab=design, layer=body
      navigateToLayers(defaultPage.id);
    }
    // `urlState.variantId` is read once at init; depending on it would fight the
    // effect below that mirrors the active variant back into the URL.
  }, [migrationsComplete, pages.length, components.length, collections.length, routeType, resourceId, currentPageId, editingComponentId, pages, components, collections, setCurrentPageId, setSelectedLayerId, navigateToLayers, navigateToCollection, navigateToCollections, urlState.layerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mirror the active component variant id into the URL while editing a
  // component, so reloads land back on the same variant. Uses
  // `updateQueryParams` to avoid a router push (no history entry).
  // Guard on `editingComponentId` so we don't wipe the URL's `?variant=`
  // param before the init effect has had a chance to read it.
  useEffect(() => {
    if (routeType !== 'component') return;
    if (!editingComponentId) return;
    updateQueryParams({ variant: editingComponentVariantId ?? null });
  }, [routeType, editingComponentId, editingComponentVariantId, updateQueryParams]);

  // Auto-select Body layer when switching pages (not when draft updates)
  useEffect(() => {
    // Only select Body if the page ID actually changed and no layer is specified in URL
    if (currentPageId && currentPageId !== previousPageIdRef.current) {
      // Update the ref to track this page FIRST
      previousPageIdRef.current = currentPageId;

      // Check if draft is loaded
      if (currentDraft && !urlState.layerId) {
        // Check if Body layer is locked by another user before auto-selecting
        const { resourceLocks, currentUserId } = useCollaborationPresenceStore.getState();
        const bodyLockKey = getResourceLockKey(RESOURCE_TYPES.LAYER, 'body');
        const bodyLock = resourceLocks[bodyLockKey];
        const isBodyLockedByOther = bodyLock &&
          bodyLock.user_id !== currentUserId &&
          Date.now() <= bodyLock.expires_at;

        // Only auto-select Body if it's not locked by someone else
        if (!isBodyLockedByOther) {
          setSelectedLayerId('body');
        }
      }
      // If urlState.layerId exists, let the URL initialization effect handle it
    }
  }, [currentPageId, currentDraft, setSelectedLayerId, urlState.layerId]);

  // When the AI starts editing a page other than the one open, switch to it so
  // the user watches the changes happen on the right page. Guarded so it never
  // yanks the user out of component editing or a non-page route, and it only
  // navigates once per target (currentPageId then matches aiBuildingPageId).
  useEffect(() => {
    if (!aiBuildingPageId || aiBuildingPageId === currentPageId) return;
    if (editingComponentId) return;
    if (routeType !== 'page' && routeType !== 'layers') return;
    if (!pages.some((page) => page.id === aiBuildingPageId)) return;
    setCurrentPageId(aiBuildingPageId);
    navigateToLayers(aiBuildingPageId);
  }, [aiBuildingPageId, currentPageId, editingComponentId, routeType, pages, setCurrentPageId, navigateToLayers]);

  // When the AI starts editing a component, auto-open that component's edit mode
  // so the user watches the changes happen in the right place (mirrors the page
  // flow above). Only fires on design routes — never yanks the user out of CMS,
  // forms, or settings — and navigates once per target (editingComponentId then
  // matches aiBuildingComponentId).
  useEffect(() => {
    if (!aiBuildingComponentId || aiBuildingComponentId === editingComponentId) return;
    if (routeType !== 'page' && routeType !== 'layers' && routeType !== 'component') return;

    const { getComponentById, loadComponentDraft } = useComponentsStore.getState();
    const component = getComponentById(aiBuildingComponentId);
    if (!component) return;

    const variantExists = aiBuildingComponentVariantId
      && component.variants?.some((v) => v.id === aiBuildingComponentVariantId);
    const variantId = variantExists
      ? aiBuildingComponentVariantId
      : (component.variants && component.variants.length > 0 ? component.variants[0].id : null);

    void (async () => {
      await loadComponentDraft(aiBuildingComponentId);
      const { setEditingComponentId, setEditingComponentVariantId } = useEditorStore.getState();
      setEditingComponentId(aiBuildingComponentId, currentPageId);
      setEditingComponentVariantId(variantId);
      navigateToComponent(aiBuildingComponentId, undefined, undefined, variantId ?? undefined);
    })();
  }, [aiBuildingComponentId, aiBuildingComponentVariantId, editingComponentId, routeType, currentPageId, navigateToComponent]);

  const selectedLayerIdRef = useRef<string | null>(null);
  const selectedLayerIdsRef = useRef<string[]>([]);

  useEffect(() => {
    const unsub = useEditorStore.subscribe((state) => {
      selectedLayerIdRef.current = state.selectedLayerId;
      selectedLayerIdsRef.current = state.selectedLayerIds;
    });
    selectedLayerIdRef.current = useEditorStore.getState().selectedLayerId;
    selectedLayerIdsRef.current = useEditorStore.getState().selectedLayerIds;
    return unsub;
  }, []);

  // Find the next layer to select after deletion
  // Priority: next sibling > previous sibling > parent
  const findNextLayerToSelect = (layers: Layer[], layerIdToDelete: string): string | null => {
    // Helper to find layer with its parent and siblings
    const findLayerContext = (
      tree: Layer[],
      targetId: string,
      parent: Layer | null = null
    ): { layer: Layer; parent: Layer | null; siblings: Layer[] } | null => {
      for (let i = 0; i < tree.length; i++) {
        const node = tree[i];

        if (node.id === targetId) {
          return { layer: node, parent, siblings: tree };
        }

        if (node.children) {
          const found = findLayerContext(node.children, targetId, node);
          if (found) return found;
        }
      }
      return null;
    };

    const context = findLayerContext(layers, layerIdToDelete);
    if (!context) return null;

    const { parent, siblings } = context;
    const currentIndex = siblings.findIndex(s => s.id === layerIdToDelete);

    // Try next sibling
    if (currentIndex < siblings.length - 1) {
      return siblings[currentIndex + 1].id;
    }

    // Try previous sibling
    if (currentIndex > 0) {
      return siblings[currentIndex - 1].id;
    }

    // Fall back to parent
    if (parent) {
      return parent.id;
    }

    // If no parent and no siblings, try to find any other layer
    const allLayers = layers.filter(l => l.id !== layerIdToDelete);
    if (allLayers.length > 0) {
      return allLayers[0].id;
    }

    return null;
  };

  // Delete selected layer — reads selectedLayerId from ref to avoid callback recreation on selection change
  const deleteSelectedLayer = useCallback(() => {
    const layerId = selectedLayerIdRef.current;
    if (!layerId) return;

    // Handle sublayer deletion (remove TipTap block, not the whole layer)
    if (activeSublayerIndex !== null) {
      const layers = getCurrentLayers();
      const richTextLayer = findLayerById(layers, layerId);
      if (!richTextLayer) return;

      const updates = removeRichTextSublayer(richTextLayer, activeSublayerIndex);
      if (!updates) return;

      if (currentPageId) {
        updateLayer(currentPageId, layerId, updates);
      } else if (editingComponentId) {
        const newLayers = layers.map(l => l.id === layerId ? { ...l, ...updates } : l);
        updateCurrentLayers(newLayers);
      }
      setActiveSublayerIndex(null);
      return;
    }

    // Find the next layer to select before deleting
    const layers = getCurrentLayers();
    const layerToDelete = findLayerById(layers, layerId);

    // Check if layer can be deleted
    if (layerToDelete && !canDeleteLayer(layerToDelete)) {
      return;
    }

    const nextLayerId = findNextLayerToSelect(layers, layerId);

    // Check if this is a pagination wrapper - if so, disable pagination on the collection
    const paginationFor = layerToDelete?.attributes?.['data-pagination-for'];

    if (editingComponentId) {
      // Delete from component draft
      let newLayers = layers;

      // If deleting a pagination wrapper, disable pagination on the collection layer
      if (paginationFor) {
        const collectionLayer = findLayerById(layers, paginationFor);
        // Only update if collection variable exists with an id
        if (collectionLayer?.variables?.collection?.id) {
          // Helper to update layer in tree
          const updateInTree = (tree: Layer[], targetId: string, updater: (l: Layer) => Layer): Layer[] => {
            return tree.map(layer => {
              if (layer.id === targetId) {
                return updater(layer);
              }
              if (layer.children) {
                return { ...layer, children: updateInTree(layer.children, targetId, updater) };
              }
              return layer;
            });
          };

          newLayers = updateInTree(newLayers, paginationFor, (layer) => ({
            ...layer,
            variables: {
              ...layer.variables,
              collection: {
                ...layer.variables!.collection!,
                pagination: {
                  mode: 'pages' as const,
                  items_per_page: 10,
                  ...(layer.variables?.collection?.pagination || {}),
                  enabled: false,
                },
              },
            },
          }));
        }
      }

      newLayers = removeLayerById(newLayers, layerId);
      updateCurrentLayers(newLayers);
      setSelectedLayerId(nextLayerId);
    } else if (currentPageId) {
      // Delete from page (pagination sync handled in usePagesStore.deleteLayer)
      deleteLayer(currentPageId, layerId);
      setSelectedLayerId(nextLayerId);

      // Broadcast delete to other collaborators
      if (liveLayerUpdates) {
        liveLayerUpdates.broadcastLayerDelete(currentPageId, layerId);
      }
    }
  }, [editingComponentId, currentPageId, getCurrentLayers, updateCurrentLayers, deleteLayer, setSelectedLayerId, liveLayerUpdates, activeSublayerIndex, setActiveSublayerIndex, updateLayer]);

  // Stable callback for layer updates - reads current state from stores to avoid
  // dependency on editingComponentId/currentPageId which would break React.memo
  const handleLayerUpdate = useCallback((layerId: string, updates: Partial<Layer>) => {
    const { editingComponentId: compId, editingComponentVariantId: variantId } = useEditorStore.getState();
    if (compId) {
      const { componentDrafts, updateComponentDraft } = useComponentsStore.getState();
      const variantDrafts = componentDrafts[compId];
      const targetVariantId = (variantId && variantDrafts?.[variantId])
        ? variantId
        : (variantDrafts ? Object.keys(variantDrafts)[0] : null);
      if (!targetVariantId || !variantDrafts) return;
      const layers = variantDrafts[targetVariantId] || [];
      const updateTree = (tree: Layer[]): Layer[] =>
        tree.map(l => {
          if (l.id === layerId) return { ...l, ...updates };
          if (l.children) return { ...l, children: updateTree(l.children) };
          return l;
        });
      updateComponentDraft(compId, targetVariantId, updateTree(layers));
    } else {
      const pageId = useEditorStore.getState().currentPageId;
      if (pageId) {
        usePagesStore.getState().updateLayer(pageId, layerId, updates);
        liveLayerUpdates?.broadcastLayerUpdate(layerId, updates);
      }
    }
  }, [liveLayerUpdates]);

  // Immediate save function (bypasses debouncing)
  const saveImmediately = useCallback(async (pageId: string) => {
    // Clear any pending debounced save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    setIsSaving(true);
    setHasUnsavedChanges(false);
    try {
      await saveDraft(pageId);
      setLastSaved(new Date());
    } catch (error) {
      console.error('Save failed:', error);
      setHasUnsavedChanges(true);
      throw error; // Re-throw for caller to handle
    } finally {
      setIsSaving(false);
    }
  }, [saveDraft]);

  // Debounced autosave function
  const debouncedSave = useCallback((pageId: string) => {
    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Set new timeout for 2 seconds
    saveTimeoutRef.current = setTimeout(async () => {
      setIsSaving(true);
      setHasUnsavedChanges(false);
      try {
        await saveDraft(pageId);
        setLastSaved(new Date());
      } catch (error) {
        console.error('Autosave failed:', error);
        setHasUnsavedChanges(true); // Restore unsaved flag on error
      } finally {
        setIsSaving(false);
      }
    }, 2000);
  }, [saveDraft]);

  // Save before navigating to a different page
  useEffect(() => {
    const handlePageChange = async () => {
      // If we have a previous page with unsaved changes, save it immediately
      if (previousPageIdRef.current &&
          previousPageIdRef.current !== currentPageId &&
          hasUnsavedChanges) {
        try {
          await saveImmediately(previousPageIdRef.current);
          setHasUnsavedChanges(false); // Clear unsaved flag after successful save
        } catch (error) {
          console.error('Failed to save before navigation:', error);
        }
      } else if (previousPageIdRef.current !== currentPageId) {
        // Switching to a different page without unsaved changes - clear the flag
        setHasUnsavedChanges(false);
      }

      // Update the ref to track current page
      previousPageIdRef.current = currentPageId;
    };

    handlePageChange();
  }, [currentPageId, hasUnsavedChanges, saveImmediately]);

  // Watch for draft changes and trigger autosave
  useEffect(() => {
    if (!currentPageId || !currentDraft) {
      return;
    }

    const currentLayers = currentDraft.layers;
    const lastLayers = lastLayersByPageRef.current.get(currentPageId);

    // Only trigger save if the layers array reference actually changed for THIS page
    if (lastLayers && lastLayers !== currentLayers) {
      if (consumePageMcpSync(currentPageId)) {
        // MCP already saved to DB — cancel any pending autosave and accept
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = null;
        }
        setHasUnsavedChanges(false);
      } else {
        setHasUnsavedChanges(true);
        debouncedSave(currentPageId);
      }
    }

    lastLayersByPageRef.current.set(currentPageId, currentLayers);
  }, [currentPageId, currentDraft, debouncedSave]);

  // Cleanup save timeout on unmount only
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
  }, []);

  // Listen for version saved event to clear unsaved flag
  useEffect(() => {
    const handleVersionSaved = (event: CustomEvent) => {
      const { entityType, entityId } = event.detail;
      if (entityType === 'page_layers' && entityId === currentPageId) {
        setHasUnsavedChanges(false);
      }
    };

    window.addEventListener('versionSaved', handleVersionSaved as EventListener);
    return () => {
      window.removeEventListener('versionSaved', handleVersionSaved as EventListener);
    };
  }, [currentPageId]);

  // Warn before closing browser with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Get current page
  const currentPage = useMemo(() => {
    if (!Array.isArray(pages)) return undefined;
    return pages.find(p => p.id === currentPageId);
  }, [pages, currentPageId]);

  // Build context-aware cursor room name
  // Cursors are scoped to the same context (tab + page/collection/component)
  const cursorRoomName = useMemo(() => {
    // Component editing takes priority - users editing same component see each other
    if (editingComponentId) {
      return `component-${editingComponentId}`;
    }

    // CMS tab - users viewing same collection see each other
    if (activeTab === 'cms' && selectedCollectionId) {
      return `cms-collection-${selectedCollectionId}`;
    }

    // Pages tab - users on same page in Pages view see each other
    if (activeTab === 'pages' && currentPageId) {
      return `pages-page-${currentPageId}`;
    }

    // Layers tab (default) - users on same page in Layers view see each other
    if (currentPageId) {
      return `layers-page-${currentPageId}`;
    }

    return null;
  }, [editingComponentId, activeTab, selectedCollectionId, currentPageId]);

  // Track if we're currently exiting component edit mode to prevent re-entry
  const isExitingComponentModeRef = useRef(false);

  // Exit component edit mode handler
  const handleExitComponentEditMode = useCallback(async () => {
    const { editingComponentId, returnToPageId, setEditingComponentId, returnToLayerId, getReturnDestination, setSelectedLayerId: setLayerIdFromStore } = useEditorStore.getState();
    const { saveComponentDraft, clearComponentDraft, getComponentById, loadComponentDraft } = useComponentsStore.getState();
    const { updateComponentOnLayers } = usePagesStore.getState();

    if (!editingComponentId || isExitingComponentModeRef.current) return;

    // Set flag to prevent re-entry during exit
    isExitingComponentModeRef.current = true;

    try {
      // Inline text editing commits its content lazily (on blur/unmount), so a
      // pending edit hasn't reached the component draft yet. Finish it now —
      // while edit mode is still active — so the latest content is written into
      // the draft (and marks it dirty) before we save below. Without this the
      // first exit persists stale content and the edit only "sticks" on a
      // subsequent attempt once the editor has already flushed.
      const { isEditing, requestFinish } = useCanvasTextEditorStore.getState();
      if (isEditing) {
        requestFinish();
      }

      // Clear any pending auto-save timeout to avoid duplicate saves. Read it
      // fresh because finishing inline editing above may have scheduled a new
      // one via updateComponentDraft.
      const pendingSaveTimeout = useComponentsStore.getState().saveTimeouts[editingComponentId];
      if (pendingSaveTimeout) {
        clearTimeout(pendingSaveTimeout);
      }

      // Capture whether this draft has any unpersisted edits before saving,
      // since saveComponentDraft will reset the dirty flag on success.
      const wasDirty = !!useComponentsStore.getState().componentDraftDirty[editingComponentId];

      // Immediately save component draft (ensures all changes are persisted).
      // This is a no-op if the draft is not dirty.
      await saveComponentDraft(editingComponentId);

      // Only sync across pages and broadcast when the user actually edited
      // the component during this editing session.
      if (wasDirty) {
        updateComponentOnLayers(editingComponentId);

        const updatedComponent = getComponentById(editingComponentId);
        if (updatedComponent && liveComponentUpdates) {
          liveComponentUpdates.broadcastComponentLayersUpdate(editingComponentId, updatedComponent.layers);
        }
      }

      // Clear component draft
      clearComponentDraft(editingComponentId);

      // Check navigation stack to determine return destination
      const returnDestination = getReturnDestination();

      if (returnDestination?.type === 'component') {
        // Returning to a parent component
        const parentComponent = getComponentById(returnDestination.id);
        if (parentComponent) {
          // Load the parent component draft FIRST
          await loadComponentDraft(returnDestination.id);

          // Pop the current component from the stack before transitioning
          const { componentNavigationStack, setEditingComponentVariantId: setVariant } = useEditorStore.getState();
          const newStack = [...componentNavigationStack];
          newStack.pop(); // Remove child component entry

          // Restore the parent's variant from the navigation entry
          const parentVariantId = returnDestination.variantId
            ?? (parentComponent.variants && parentComponent.variants.length > 0
              ? parentComponent.variants[0].id
              : null);
          setVariant(parentVariantId);

          // Transition directly to parent component (avoids showing page)
          // Manually update the stack to reflect the pop
          useEditorStore.setState({
            editingComponentId: returnDestination.id,
            returnToPageId: returnToPageId,
            returnToLayerId: returnDestination.layerId || null,
            componentNavigationStack: newStack,
          });

          // Navigate to the parent component
          navigateToComponent(
            returnDestination.id,
            undefined, // rightTab - use current
            returnDestination.layerId || undefined, // layerId - restore the layer
            parentVariantId // variant - restore the active variant
          );

          // Restore layer selection if specified
          if (returnDestination.layerId) {
            setLayerIdFromStore(returnDestination.layerId);
          }
        }
      } else {
        // Returning to a page (or no stack entry).
        //
        // `returnToPageId` is a snapshot taken when the user entered component
        // edit mode and isn't refreshed for non-page entry points (CMS,
        // Settings, etc.) or after the source page was deleted. In those cases
        // it would point at a stale/missing page and Next.js would silently
        // 404 — to the user it just looks like "preview opened the wrong
        // page". Validate it against the current pages list and silently fall
        // back to the homepage when it's no longer valid.
        const isValidReturnPage = returnToPageId
          && pages.some(p => p.id === returnToPageId);
        let targetPageId = isValidReturnPage ? returnToPageId : null;
        if (!targetPageId) {
          const homePage = findHomepage(pages);
          const defaultPage = homePage || pages[0];
          targetPageId = defaultPage?.id || null;
        }

        if (!targetPageId) {
          console.warn('[handleExitComponentEditMode] No target page found, cannot exit component edit mode');
          return;
        }

        // If we fell back, the saved `returnToLayerId` belongs to the original
        // (now-missing) page and would dangle on the homepage. Drop it.
        const layerToRestore = isValidReturnPage
          ? (returnToLayerId || returnDestination?.layerId || undefined)
          : undefined;

        // Clear edit mode state synchronously, then navigate.
        // The URL sync effect will restore the correct layer from the URL.
        setEditingComponentId(null, null);
        navigateToLayers(
          targetPageId,
          undefined,
          undefined,
          layerToRestore
        );
      }
    } finally {
      // Defer clearing the guard until after the URL update has propagated.
      // Otherwise the URL sync effect may re-run with the old `routeType ===
      // 'component'` (because router.push is async) while the guard is already
      // cleared, and re-enter component edit mode.
      setTimeout(() => {
        isExitingComponentModeRef.current = false;
      }, 0);
    }

    // Selection will be restored by the URL sync effect
  }, [navigateToLayers, navigateToComponent, liveComponentUpdates, pages]);

  // After an AI turn that opened component edit mode on its own (the user was on
  // a page and only mentioned/asked to edit a component), return the user to
  // their page so they aren't stranded in edit mode. The store sets
  // `pendingAiComponentExit` once the turn (including any review passes) settles.
  useEffect(() => {
    if (!pendingAiComponentExit) return;
    const { editingComponentId: activeComponentId, setPendingAiComponentExit } = useEditorStore.getState();
    setPendingAiComponentExit(false);
    if (activeComponentId) {
      void handleExitComponentEditMode();
    }
  }, [pendingAiComponentExit, handleExitComponentEditMode]);

  // Global keyboard shortcuts — reads selection from refs to avoid recreating handler on every selection change
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const selectedLayerId = selectedLayerIdRef.current;
      const selectedLayerIds = selectedLayerIdsRef.current;
      // Check if user is typing in an input/textarea
      const target = e.target as HTMLElement;
      const isInputFocused = target.tagName === 'INPUT' ||
                             target.tagName === 'TEXTAREA' ||
                             target.isContentEditable;

      // Save: Cmd/Ctrl + S
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault(); // Always prevent default browser save dialog
        if (editingComponentId) {
          // Component save is automatic via store, no manual save needed
          return;
        }
        if (currentPageId) {
          saveImmediately(currentPageId);
        }
      }

      // Open preview: Cmd/Ctrl + P — handled by HeaderBar via custom event
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault(); // Prevent the browser print dialog
        window.dispatchEvent(new CustomEvent('togglePreview'));
        return;
      }

      // Note: Undo/Redo shortcuts (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, Cmd/Ctrl+Y) are handled in CenterCanvas.tsx
      // This prevents duplication and ensures they work both in the main window and inside the iframe

      const isContentOnlyRole = !canEditStructureRef.current;

      // Layer-specific shortcuts (only work on layers tab)
      if (activeTab === 'layers') {
        // A - Toggle Element Library (when on layers tab and not typing)
        if (e.key === 'a' && !isInputFocused && !e.metaKey && !e.ctrlKey && !e.altKey) {
          if (isContentOnlyRole) return;
          e.preventDefault();
          // Dispatch custom event to toggle ElementLibrary
          window.dispatchEvent(new CustomEvent('toggleElementLibrary'));
          return;
        }

        // Option + L - Collapse/Expand all layers
        if (e.altKey && e.code === 'KeyL' && !isInputFocused) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('toggleCollapseAllLayers'));
          return;
        }

        // Shift + Cmd + H - Toggle layer visibility (Show/Hide)
        if (e.shiftKey && e.metaKey && e.code === 'KeyH' && !isContentOnlyRole) {
          if (!isInputFocused && (currentPageId || editingComponentId) && selectedLayerId) {
            e.preventDefault();
            const layers = getCurrentLayers();
            const layer = findLayerById(layers, selectedLayerId);
            if (layer) {
              const currentHidden = layer.settings?.hidden || false;
              if (editingComponentId) {
                // Update in component
                const updateLayerVisibility = (layers: Layer[]): Layer[] => {
                  return layers.map(l => {
                    if (l.id === selectedLayerId) {
                      return {
                        ...l,
                        settings: { ...l.settings, hidden: !currentHidden },
                      };
                    }
                    if (l.children) {
                      return { ...l, children: updateLayerVisibility(l.children) };
                    }
                    return l;
                  });
                };
                updateCurrentLayers(updateLayerVisibility(layers));
              } else if (currentPageId) {
                updateLayer(currentPageId, selectedLayerId, {
                  settings: { ...layer.settings, hidden: !currentHidden },
                });
              }
            }
          }
          return;
        }

        // Escape - Select parent layer (skip if a dialog is open)
        if (e.key === 'Escape' && !document.querySelector('[role="dialog"]') && (currentPageId || editingComponentId) && selectedLayerId) {
          e.preventDefault();

          const layers = getCurrentLayers();
          if (!layers.length) return;

          const findParent = (layers: Layer[], targetId: string, parent: Layer | null = null): Layer | null => {
            for (const layer of layers) {
              if (layer.id === targetId) {
                return parent;
              }
              if (layer.children) {
                const found = findParent(layer.children, targetId, layer);
                if (found !== undefined) return found;
              }
            }
            return undefined as any;
          };

          const parentLayer = findParent(layers, selectedLayerId);

          // If parent exists, select it. If no parent (root level), deselect
          if (parentLayer) {
            setSelectedLayerId(parentLayer.id);
          } else {
            // At root level or Body layer selected - deselect
            setSelectedLayerId(null);
          }

          return;
        }

        // Arrow Up/Down - Reorder layer within siblings
        if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !isContentOnlyRole && (currentPageId || editingComponentId) && selectedLayerId && !isInputFocused) {
          e.preventDefault();

          const layers = getCurrentLayers();
          if (!layers.length) return;

          const direction = e.key === 'ArrowUp' ? -1 : 1;

          // Find the layer, its parent, and its index within siblings
          const findLayerInfo = (
            layers: Layer[],
            targetId: string,
            parent: Layer | null = null
          ): { layer: Layer; parent: Layer | null; siblings: Layer[]; index: number } | null => {
            for (let i = 0; i < layers.length; i++) {
              const layer = layers[i];
              if (layer.id === targetId) {
                return { layer, parent, siblings: layers, index: i };
              }
              if (layer.children) {
                const found = findLayerInfo(layer.children, targetId, layer);
                if (found) return found;
              }
            }
            return null;
          };

          const info = findLayerInfo(layers, selectedLayerId);
          if (!info) return;

          const { siblings, index } = info;
          const newIndex = index + direction;

          // Check bounds
          if (newIndex < 0 || newIndex >= siblings.length) {
            return;
          }

          // Swap the layers
          const reorderLayers = (layers: Layer[]): Layer[] => {
            return layers.map(layer => {
              // If this is the parent containing our siblings, reorder them
              if (info.parent && layer.id === info.parent.id) {
                const newChildren = [...(layer.children || [])];
                // Swap
                [newChildren[index], newChildren[newIndex]] = [newChildren[newIndex], newChildren[index]];
                return { ...layer, children: newChildren };
              }

              // Recursively process children
              if (layer.children) {
                return { ...layer, children: reorderLayers(layer.children) };
              }

              return layer;
            });
          };

          let newLayers: Layer[];

          // If at root level, reorder root array directly
          if (!info.parent) {
            newLayers = [...layers];
            [newLayers[index], newLayers[newIndex]] = [newLayers[newIndex], newLayers[index]];
          } else {
            newLayers = reorderLayers(layers);
          }

          updateCurrentLayers(newLayers);

          return;
        }

        // Tab - Select next sibling layer (only when not in input)
        if (e.key === 'Tab' && !isInputFocused && (currentPageId || editingComponentId) && selectedLayerId) {
          e.preventDefault();

          const layers = getCurrentLayers();
          if (!layers.length) return;

          // Find the layer, its parent, and its index within siblings
          const findLayerInfo = (
            layers: Layer[],
            targetId: string,
            parent: Layer | null = null
          ): { layer: Layer; parent: Layer | null; siblings: Layer[]; index: number } | null => {
            for (let i = 0; i < layers.length; i++) {
              const layer = layers[i];
              if (layer.id === targetId) {
                return { layer, parent, siblings: layers, index: i };
              }
              if (layer.children) {
                const found = findLayerInfo(layer.children, targetId, layer);
                if (found) return found;
              }
            }
            return null;
          };

          const info = findLayerInfo(layers, selectedLayerId);
          if (!info) return;

          const { siblings, index } = info;

          // Check if there's a next sibling
          if (index + 1 < siblings.length) {
            const nextSibling = siblings[index + 1];
            setSelectedLayerId(nextSibling.id);
          }

          return;
        }

        // Copy: Cmd/Ctrl + C (supports multi-select)
        // Skip when the user has a plain-text selection so native copy works.
        if ((e.metaKey || e.ctrlKey) && e.key === 'c' && !isContentOnlyRole) {
          if (!isInputFocused && !hasTextSelection() && (currentPageId || editingComponentId)) {
            e.preventDefault();

            // Get layers from the correct context
            const layers = getCurrentLayers();

            if (selectedLayerIds.length > 1) {
              // Multi-select: copy all (check restrictions)
              const layersToCheck = selectedLayerIds.map(id => findLayerById(layers, id)).filter(Boolean) as Layer[];
              const canCopyAll = layersToCheck.every(layer => canCopyLayer(layer));

              if (canCopyAll) {
                // In component edit mode, copy from component drafts
                if (editingComponentId) {
                  const copiedLayers = layersToCheck.map(l => cloneDeep(l));
                  if (copiedLayers.length > 0) {
                    copyLayersToClipboard(copiedLayers, currentPageId || '');
                  }
                } else if (currentPageId) {
                  const copiedLayers = copyLayersFromStore(currentPageId, selectedLayerIds);
                  if (copiedLayers.length > 0) {
                    copyLayersToClipboard(copiedLayers, currentPageId);
                  }
                }
              }
            } else if (selectedLayerId) {
              // Single select - check restrictions
              const layer = findLayerById(layers, selectedLayerId);
              if (layer && canCopyLayer(layer)) {
                // In component edit mode, copy from component drafts
                if (editingComponentId) {
                  copyToClipboard(cloneDeep(layer), currentPageId || '');
                } else if (currentPageId) {
                  const copiedLayer = copyLayerFromStore(currentPageId, selectedLayerId);
                  if (copiedLayer) {
                    copyToClipboard(copiedLayer, currentPageId);
                  }
                }
              }
            }
          }
        }

        // Cut: Cmd/Ctrl + X (supports multi-select)
        // Skip when the user has a plain-text selection so native cut works.
        if ((e.metaKey || e.ctrlKey) && e.key === 'x' && !isContentOnlyRole) {
          if (!isInputFocused && !hasTextSelection() && (currentPageId || editingComponentId)) {
            e.preventDefault();

            // Get layers from the correct context
            const layers = getCurrentLayers();

            if (selectedLayerIds.length > 1) {
              // Multi-select: cut all (check restrictions)
              const layersToCheck = selectedLayerIds.map(id => findLayerById(layers, id)).filter(Boolean) as Layer[];
              const canCutAll = layersToCheck.every(layer => canCopyLayer(layer) && canDeleteLayer(layer));

              if (canCutAll) {
                // In component edit mode, cut from component drafts
                if (editingComponentId) {
                  const copiedLayers = layersToCheck.map(l => cloneDeep(l));
                  if (copiedLayers.length > 0) {
                    cutLayersToClipboard(copiedLayers, currentPageId || '');
                    // Remove layers from component draft
                    let newLayers = layers;
                    for (const layerId of selectedLayerIds) {
                      newLayers = removeLayerById(newLayers, layerId);
                    }
                    updateCurrentLayers(newLayers);
                    clearSelection();
                  }
                } else if (currentPageId) {
                  const copiedLayers = copyLayersFromStore(currentPageId, selectedLayerIds);
                  if (copiedLayers.length > 0) {
                    cutLayersToClipboard(copiedLayers, currentPageId);
                    deleteLayers(currentPageId, selectedLayerIds);
                    clearSelection();

                    // Broadcast deletes to other collaborators
                    if (liveLayerUpdates) {
                      selectedLayerIds.forEach(id => {
                        liveLayerUpdates.broadcastLayerDelete(currentPageId, id);
                      });
                    }
                  }
                }
              }
            } else if (selectedLayerId) {
              // Single select - check restrictions
              const layer = findLayerById(layers, selectedLayerId);
              if (layer && layer.id !== 'body' && canCopyLayer(layer) && canDeleteLayer(layer)) {
                // In component edit mode, cut from component drafts
                if (editingComponentId) {
                  cutToClipboard(cloneDeep(layer), currentPageId || '');
                  const newLayers = removeLayerById(layers, selectedLayerId);
                  updateCurrentLayers(newLayers);
                  setSelectedLayerId(null);
                } else if (currentPageId) {
                  const copiedLayer = copyLayerFromStore(currentPageId, selectedLayerId);
                  if (copiedLayer) {
                    cutToClipboard(copiedLayer, currentPageId);
                    deleteLayer(currentPageId, selectedLayerId);
                    setSelectedLayerId(null);

                    // Broadcast delete to other collaborators
                    if (liveLayerUpdates) {
                      liveLayerUpdates.broadcastLayerDelete(currentPageId, selectedLayerId);
                    }
                  }
                }
              }
            }
          }
        }

        // Paste: Cmd/Ctrl + V
        // Don't preventDefault here — let the browser fire the paste event so
        // the paste handler (use-import-paste) can read clipboardData. Webflow,
        // Figma and normal internal paste are all handled there.

        // Duplicate: Cmd/Ctrl + D (supports multi-select)
        if ((e.metaKey || e.ctrlKey) && e.key === 'd' && !isContentOnlyRole) {
          if (!isInputFocused && currentPageId) {
            e.preventDefault();
            if (selectedLayerIds.length > 1) {
              // Multi-select: duplicate all
              const duplicatedLayers = duplicateLayersFromStore(currentPageId, selectedLayerIds);
              // Broadcast each duplicated layer
              if (liveLayerUpdates && duplicatedLayers) {
                duplicatedLayers.forEach(layer => {
                  liveLayerUpdates.broadcastLayerAdd(currentPageId, null, 'duplicate', layer);
                });
              }
            } else if (selectedLayerId) {
              // Single select
              const duplicatedLayer = duplicateLayer(currentPageId, selectedLayerId);
              // Broadcast the duplicated layer
              if (liveLayerUpdates && duplicatedLayer) {
                liveLayerUpdates.broadcastLayerAdd(currentPageId, null, 'duplicate', duplicatedLayer);
              }
            }
          }
        }

        // F2 - Rename selected layer
        if (e.key === 'F2' && !isContentOnlyRole && !isInputFocused && (currentPageId || editingComponentId) && selectedLayerId && selectedLayerId !== 'body') {
          e.preventDefault();
          useEditorStore.getState().setRenamingLayerId(selectedLayerId);
          return;
        }

        // Delete: Delete or Backspace (supports multi-select)
        if ((e.key === 'Delete' || e.key === 'Backspace') && !isContentOnlyRole) {
          if (!isInputFocused && (currentPageId || editingComponentId)) {
            e.preventDefault();
            if (selectedLayerIds.length > 1) {
              // Multi-select: delete all
              if (editingComponentId) {
                // Delete multiple from component
                const layers = getCurrentLayers();

                // Filter out layers that cannot be deleted
                const deletableLayerIds = selectedLayerIds.filter(layerId => {
                  const layer = findLayerById(layers, layerId);
                  return layer && canDeleteLayer(layer);
                });

                if (deletableLayerIds.length === 0) return;

                let newLayers = layers;

                // Helper to update layer in tree
                const updateInTree = (tree: Layer[], targetId: string, updater: (l: Layer) => Layer): Layer[] => {
                  return tree.map(layer => {
                    if (layer.id === targetId) {
                      return updater(layer);
                    }
                    if (layer.children) {
                      return { ...layer, children: updateInTree(layer.children, targetId, updater) };
                    }
                    return layer;
                  });
                };

                // Check each layer for pagination wrappers and disable pagination on collection
                for (const layerId of deletableLayerIds) {
                  const layerToDelete = findLayerById(layers, layerId);
                  const paginationFor = layerToDelete?.attributes?.['data-pagination-for'];
                  if (paginationFor) {
                    const collectionLayer = findLayerById(layers, paginationFor);
                    // Only update if collection variable exists with an id
                    if (collectionLayer?.variables?.collection?.id) {
                      newLayers = updateInTree(newLayers, paginationFor, (layer) => ({
                        ...layer,
                        variables: {
                          ...layer.variables,
                          collection: {
                            ...layer.variables!.collection!,
                            pagination: {
                              mode: 'pages' as const,
                              items_per_page: 10,
                              ...(layer.variables?.collection?.pagination || {}),
                              enabled: false,
                            },
                          },
                        },
                      }));
                    }
                  }
                }

                for (const layerId of deletableLayerIds) {
                  newLayers = removeLayerById(newLayers, layerId);
                }
                updateCurrentLayers(newLayers);
                clearSelection();
              } else if (currentPageId) {
                // Filter out layers that cannot be deleted
                const layers = getCurrentLayers();
                const deletableLayerIds = selectedLayerIds.filter(layerId => {
                  const layer = findLayerById(layers, layerId);
                  return layer && canDeleteLayer(layer);
                });

                if (deletableLayerIds.length === 0) return;

                deleteLayers(currentPageId, deletableLayerIds);
                clearSelection();

                // Broadcast deletes to other collaborators
                if (liveLayerUpdates) {
                  selectedLayerIds.forEach(id => {
                    liveLayerUpdates.broadcastLayerDelete(currentPageId, id);
                  });
                }
              }
            } else if (selectedLayerId) {
              // Single select (deleteSelectedLayer already handles broadcasting)
              deleteSelectedLayer();
            }
          }
        }

        // Copy Style: Option + Cmd + C
        // Use e.code for physical key detection (e.key produces special chars with Option)
        if (e.altKey && e.metaKey && e.code === 'KeyC' && !isContentOnlyRole) {
          if (!isInputFocused && (currentPageId || editingComponentId) && selectedLayerId) {
            e.preventDefault();
            const layers = getCurrentLayers();
            const layer = findLayerById(layers, selectedLayerId);
            if (layer) {
              const classes = getClassesString(layer);
              const ids = getStyleIds(layer);
              copyStyleToClipboard(classes, layer.design, ids[0], layer.styleOverrides, ids);
            }
          }
        }

        // Paste Style: Option + Cmd + V
        // Use e.code for physical key detection (e.key produces special chars with Option)
        if (e.altKey && e.metaKey && e.code === 'KeyV' && !isContentOnlyRole) {
          if (!isInputFocused && (currentPageId || editingComponentId) && selectedLayerId) {
            e.preventDefault();
            const style = pasteStyleFromClipboard();
            if (style) {
              const styleProps = {
                classes: style.classes,
                design: style.design,
                styleId: style.styleIds?.[0] ?? style.styleId,
                styleIds: style.styleIds ?? (style.styleId ? [style.styleId] : undefined),
                styleOverrides: style.styleOverrides,
                styleOverridesByStyle: undefined,
              };

              if (editingComponentId) {
                updateCurrentLayers(updateLayerProps(getCurrentLayers(), selectedLayerId, styleProps));
              } else if (currentPageId) {
                updateLayer(currentPageId, selectedLayerId, styleProps);
              }
            }
          }
        }

        // Create Component: Option + Cmd + K (works on pages and inside a component)
        if (e.altKey && e.metaKey && e.code === 'KeyK' && !isContentOnlyRole) {
          if (!isInputFocused && currentPageId && selectedLayerId) {
            e.preventDefault();
            const layers = getCurrentLayers();
            const layer = findLayerById(layers, selectedLayerId);
            if (layer && !layer.componentId) {
              const defaultName = layer.customName || layer.name || 'Component';
              openCreateComponentDialog(selectedLayerId, defaultName);
            }
          }
        }

        // Detach from Component: Option + Cmd + B
        if (e.altKey && e.metaKey && e.code === 'KeyB' && !isContentOnlyRole) {
          if (!isInputFocused && currentPageId && selectedLayerId && !editingComponentId) {
            e.preventDefault();
            const layers = getCurrentLayers();
            const layer = findLayerById(layers, selectedLayerId);
            if (layer?.componentId) {
              const { getComponentById } = useComponentsStore.getState();
              const component = getComponentById(layer.componentId);
              const detachDraft = usePagesStore.getState().draftsByPageId[currentPageId];
              if (detachDraft) {
                const newLayers = detachSpecificLayerFromComponent(
                  detachDraft.layers,
                  selectedLayerId,
                  component || undefined
                );
                setDraftLayers(currentPageId, newLayers);
                setSelectedLayerId(null);
              }
            }
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeTab,
    currentPageId,
    editingComponentId,
    setSelectedLayerId,
    getCurrentLayers,
    updateCurrentLayers,
    copyLayersFromStore,
    copyLayerFromStore,
    copyToClipboard,
    cutToClipboard,
    copyLayersToClipboard,
    cutLayersToClipboard,
    clipboardLayer,
    pasteAfter,
    pasteInside,
    duplicateLayersFromStore,
    duplicateLayer,
    deleteLayers,
    deleteLayer,
    clearSelection,
    saveImmediately,
    updateLayer,
    copyStyleToClipboard,
    pasteStyleFromClipboard,
    deleteSelectedLayer,
    liveLayerUpdates,
    openCreateComponentDialog,
    setDraftLayers,
    components,
  ]);

  // Show loading screen while checking Supabase config
  if (supabaseConfigured === null) {
    return <BuilderLoading message="Checking configuration..." />;
  }

  // Show loading screen while checking authentication
  if (!authInitialized) {
    return <BuilderLoading message="Checking authentication..." />;
  }

  // Show login form if not authenticated
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-neutral-950 py-10">

        <svg
          className="size-5 fill-current absolute bottom-10"
          viewBox="0 0 24 24"
          version="1.1" xmlns="http://www.w3.org/2000/svg"
        >
          <g
            id="Symbols" stroke="none"
            strokeWidth="1" fill="none"
            fillRule="evenodd"
          >
            <g id="Sidebar" transform="translate(-30.000000, -30.000000)">
              <g id="Ycode">
                <g transform="translate(30.000000, 30.000000)">
                  <rect
                    id="Rectangle" x="0"
                    y="0" width="24"
                    height="24"
                  />
                  <path
                    id="CurrentFill" d="M11.4241533,0 L11.4241533,5.85877951 L6.024,8.978 L12.6155735,12.7868008 L10.951,13.749 L23.0465401,6.75101349 L23.0465401,12.6152717 L3.39516096,23.9856666 L3.3703726,24 L3.34318129,23.9827156 L0.96,22.4713365 L0.96,16.7616508 L3.36417551,18.1393242 L7.476,15.76 L0.96,11.9090099 L0.96,6.05375516 L11.4241533,0 Z"
                    className="fill-current"
                  />
                </g>
              </g>
            </g>
          </g>
        </svg>

        <div className="w-full max-w-sm animate-in fade-in slide-in-from-bottom-1 duration-700" style={{ animationFillMode: 'both' }}>

          <form onSubmit={handleLogin} className="flex flex-col gap-6">

            {loginError && (
              <Alert variant="destructive">
                <AlertTitle>{loginError}</AlertTitle>
              </Alert>
            )}

            <Field>
              <Label htmlFor="email">
                Email
              </Label>
              <Input
                type="email"
                id="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={isLoggingIn}
                required
              />
            </Field>

            <Field>
              <Label htmlFor="password">
                Password
              </Label>
              <Input
                type="password"
                id="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="••••••••"
                disabled={isLoggingIn}
                autoComplete="current-password"
                required
              />
            </Field>

            <Button
              type="submit"
              size="sm"
              disabled={isLoggingIn}
            >
              {isLoggingIn ? <Spinner /> : 'Sign In'}
            </Button>
          </form>

          <div className="mt-4 text-center">
            <p className="text-xs text-white/50">
              First time here?{' '}
              <Link href="/ycode/welcome" className="text-white/80">
                Complete setup
              </Link>
            </p>
          </div>
        </div>

      </div>
    );
  }

  // Check migrations first (BLOCKING) before showing builder
  if (!migrationsComplete) {
    return <MigrationChecker onComplete={() => setMigrationsComplete(true)} />;
  }

  // Wait for builder data to be preloaded (BLOCKING) - prevents race conditions
  if (!builderDataPreloaded) {
    return <BuilderLoading message="Loading builder data..." />;
  }

  // Authenticated - show builder (only after migrations AND data preload complete)
  return (
    <>
      <div className="h-screen flex flex-col">
      {/* Top Header Bar */}
      <HeaderBar
        user={user}
        signOut={signOut}
        showPageDropdown={showPageDropdown}
        setShowPageDropdown={setShowPageDropdown}
        currentPage={routeType === 'settings' || routeType === 'profile' || routeType === 'integrations' ? undefined : currentPage}
        currentPageId={routeType === 'settings' || routeType === 'profile' || routeType === 'integrations' ? null : currentPageId}
        pages={routeType === 'settings' || routeType === 'profile' || routeType === 'forms' || routeType === 'integrations' ? [] : pages}
        setCurrentPageId={routeType === 'settings' || routeType === 'profile' || routeType === 'forms' || routeType === 'integrations' ? () => {} : setCurrentPageId}
        isSaving={routeType === 'settings' || routeType === 'localization' || routeType === 'profile' || routeType === 'forms' || routeType === 'integrations' ? false : isCurrentlySaving}
        hasUnsavedChanges={routeType === 'settings' || routeType === 'localization' || routeType === 'profile' || routeType === 'forms' || routeType === 'integrations' ? false : hasUnsavedChanges}
        lastSaved={routeType === 'settings' || routeType === 'localization' || routeType === 'profile' || routeType === 'forms' || routeType === 'integrations' ? null : lastSaved}
        isPublishing={isPublishing}
        setIsPublishing={setIsPublishing}
        saveImmediately={routeType === 'settings' || routeType === 'localization' || routeType === 'profile' || routeType === 'forms' || routeType === 'integrations' ? async () => {} : saveImmediately}
        activeTab={routeType === 'settings' || routeType === 'localization' || routeType === 'profile' || routeType === 'forms' || routeType === 'integrations' ? 'pages' : activeTab}
        onExitComponentEditMode={handleExitComponentEditMode}
        onPublishSuccess={routeType === 'settings' || routeType === 'localization' || routeType === 'profile' || routeType === 'forms' || routeType === 'integrations' ? () => {} : () => {
          useCollectionsStore.getState().reloadCurrentItems();
        }}
        isSettingsRoute={routeType === 'settings' || routeType === 'localization' || routeType === 'profile' || routeType === 'forms' || routeType === 'integrations'}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Settings Route - Render Settings Content */}
        {routeType === 'settings' ? (
          <SettingsContent>{children}</SettingsContent>
        ) : routeType === 'localization' ? (
          <LocalizationContent>{children}</LocalizationContent>
        ) : routeType === 'profile' ? (
          <ProfileContent>{children}</ProfileContent>
        ) : routeType === 'forms' ? (
          <>{children}</>
        ) : routeType === 'integrations' ? (
          <IntegrationsContent>{children}</IntegrationsContent>
        ) : (
          <>
            {/* Left Sidebar - Pages & Layers
                - Hidden in CMS mode
                - For editor role: only shown when "Pages" tab is active */}
            <div className={activeTab === 'cms' || (isEditor && activeTab !== 'pages') ? 'hidden' : 'contents'}>
              <LeftSidebar
                onLayerSelect={(layerId) => {
                  setSelectedLayerId(layerId);
                  if (isEditor) {
                    useEditorStore.getState().setActiveSidebarTab('layers');
                  }
                }}
                currentPageId={currentPageId}
                onPageSelect={(pageId: string) => {
                  setCurrentPageId(pageId);
                  if (isEditor) {
                    useEditorStore.getState().setActiveSidebarTab('layers');
                  }
                }}
                liveLayerUpdates={liveLayerUpdates}
                liveComponentUpdates={liveComponentUpdates}
                readOnly={!canEditStructure}
              />
            </div>

            {/* CMS View - kept mounted for instant switching */}
            <div className={activeTab === 'cms' ? 'flex flex-1 min-w-0 overflow-hidden' : 'hidden'}>
              <Suspense fallback={null}>
                <CMS />
              </Suspense>
              {!isEditor && agentEnabled && (
                <div className="w-64 shrink-0 bg-background border-l flex flex-col h-full overflow-hidden">
                  <div className="px-4 pt-4 shrink-0">
                    <div className="flex h-8 items-center">
                      <span className="text-xs font-medium">Agent</span>
                    </div>
                    <hr className="mt-4" />
                  </div>
                  <AiChatPanel embedded />
                </div>
              )}
            </div>

            {/* Design View - kept mounted for instant switching */}
            <div className={activeTab !== 'cms' ? 'contents' : 'hidden'}>
              {/* Center Canvas - Preview */}
              <CenterCanvas
                currentPageId={currentPageId}
                viewportMode={viewportMode}
                setViewportMode={setViewportMode}
                onExitComponentEditMode={handleExitComponentEditMode}
                liveLayerUpdates={liveLayerUpdates}
                liveComponentUpdates={liveComponentUpdates}
              />

              {/* Right Sidebar - Agent (AI) / Human (properties) switch */}
              {!isEditor && (
                <RightPanel onLayerUpdate={handleLayerUpdate} />
              )}
            </div>
          </>
        )}
      </div>
    </div>

    {/* Collection Item Sheet - renders globally (lazy loaded) */}
    {collectionItemSheet && (
      <Suspense fallback={null}>
        <CollectionItemSheet
          open={collectionItemSheet.open}
          onOpenChange={(open) => {
            if (!open) closeCollectionItemSheet();
          }}
          collectionId={collectionItemSheet.collectionId}
          itemId={collectionItemSheet.itemId}
          onSuccess={() => {
            // Close sheet after successful save
            closeCollectionItemSheet();
          }}
        />
      </Suspense>
    )}

    {/* Collaboration: Realtime Cursors - scoped to context (tab + page/collection/component) */}
    {user && cursorRoomName && routeType !== 'settings' && routeType !== 'localization' && routeType !== 'profile' && routeType !== 'integrations' && (
      <Suspense fallback={null}>
        <RealtimeCursors
          roomName={cursorRoomName}
          username={user.user_metadata?.full_name || user.email?.split('@')[0] || 'Anonymous'}
        />
      </Suspense>
    )}

    {/* File Manager Dialog - Global reusable dialog */}
    {fileManager.open && (
      <Suspense fallback={null}>
        <FileManagerDialog
          open={fileManager.open}
          onOpenChange={(open: boolean) => {
            if (!open) closeFileManager();
          }}
          onAssetSelect={(asset: Asset) => {
            if (fileManager.onSelect) {
              const result = fileManager.onSelect(asset);
              // Close file manager unless callback returns false
              if (result !== false) {
                closeFileManager();
              }
            }
          }}
          assetId={fileManager.assetId}
          category={fileManager.category}
        />
      </Suspense>
    )}

    {/* CSS Variables Editor Overlay - opens on top of the design canvas */}
    <Suspense fallback={null}>
      <CssVariablesEditorOverlay />
    </Suspense>

    {/* Keyboard Shortcuts Dialog */}
    <Suspense fallback={null}>
      <KeyboardShortcutsDialog />
    </Suspense>

    {/* Create Component Dialog */}
    {createComponentDialog.open && createComponentDialog.layerId && currentPageId && (
      <Suspense fallback={null}>
        <CreateComponentDialog
          open={createComponentDialog.open}
          onOpenChange={(open) => {
            if (!open) closeCreateComponentDialog();
          }}
          onConfirm={async (componentName: string) => {
            // When editing a component master, extract into a nested component
            // via the components store; otherwise create from the page draft.
            const componentId = editingComponentId
              ? await useComponentsStore.getState().createComponentFromLayer(
                editingComponentId,
                createComponentDialog.layerId!,
                componentName
              )
              : await createComponentFromLayer(
                currentPageId,
                createComponentDialog.layerId!,
                componentName
              );
            if (componentId && liveComponentUpdates) {
              const { getComponentById } = useComponentsStore.getState();
              const component = getComponentById(componentId);
              if (component) {
                liveComponentUpdates.broadcastComponentCreate(component);
              }
            }
            closeCreateComponentDialog();
          }}
          layerName={createComponentDialog.defaultName}
        />
      </Suspense>
    )}

    {/* Toast notifications */}
    <Toaster />

    {/* Drag preview portal - follows cursor during element drag */}
    <Suspense fallback={null}>
      <DragPreviewPortal />
    </Suspense>

    </>
  );
}
