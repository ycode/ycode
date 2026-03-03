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
import { useRouter } from 'next/navigation';

// 2. Internal components
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
import { checkCircularReference } from '@/lib/component-utils';

// Right sidebar is always visible in editor mode - load eagerly to avoid delay
import RightSidebar from '../components/RightSidebar';

// Lazy-loaded components (heavy, not needed on initial render)
const CMS = lazy(() => import('../components/CMS'));
const CollectionItemSheet = lazy(() => import('../components/CollectionItemSheet'));
const FileManagerDialog = lazy(() => import('../components/FileManagerDialog'));
const KeyboardShortcutsDialog = lazy(() => import('../components/KeyboardShortcutsDialog'));
const CreateComponentDialog = lazy(() => import('../components/CreateComponentDialog'));
const DragPreviewPortal = lazy(() => import('@/components/DragPreviewPortal'));

// Collaboration components (lazy-loaded)
const RealtimeCursors = lazy(() => import('@/components/realtime-cursors').then(m => ({ default: m.RealtimeCursors })));

// 3. Hooks
// useCanvasCSS removed - now handled by iframe with Tailwind JIT CDN
import { useEditorUrl } from '@/hooks/use-editor-url';
import { useLiveLayerUpdates } from '@/hooks/use-live-layer-updates';
import { useLivePageUpdates } from '@/hooks/use-live-page-updates';
import { useLiveComponentUpdates } from '@/hooks/use-live-component-updates';
import { useLiveLayerStyleUpdates } from '@/hooks/use-live-layer-style-updates';

// 4. Stores
import { useAuthStore } from '@/stores/useAuthStore';
import { useClipboardStore } from '@/stores/useClipboardStore';
import { useEditorStore } from '@/stores/useEditorStore';
import { usePagesStore, consumePageMcpSync } from '@/stores/usePagesStore';
import { useComponentsStore } from '@/stores/useComponentsStore';
import { useLayerStylesStore } from '@/stores/useLayerStylesStore';
import { useCollaborationPresenceStore, getResourceLockKey, RESOURCE_TYPES } from '@/stores/useCollaborationPresenceStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useCollectionsStore } from '@/stores/useCollectionsStore';
import { useAssetsStore } from '@/stores/useAssetsStore';
import { useFontsStore } from '@/stores/useFontsStore';
import { useLocalisationStore } from '@/stores/useLocalisationStore';
import { useMigrationStore } from '@/stores/useMigrationStore';
import { useVersionsStore } from '@/stores/useVersionsStore';
// Collaboration temporarily disabled
// import { useCollaborationPresenceStore } from '@/stores/useCollaborationPresenceStore';

// 6. Utils/lib
import { findHomepage } from '@/lib/page-utils';
import { findLayerById, getClassesString, removeLayerById, canCopyLayer, canDeleteLayer, regenerateIdsWithInteractionRemapping, findParentAndIndex, insertLayerAfter, updateLayerProps } from '@/lib/layer-utils';
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
  const { routeType, resourceId, sidebarTab, navigateToLayers, navigateToCollection, navigateToCollections, navigateToComponent, urlState, updateQueryParams } = useEditorUrl();

  // Optimize store subscriptions - use selective selectors to prevent unnecessary re-renders
  const signOut = useAuthStore((state) => state.signOut);
  const user = useAuthStore((state) => state.user);
  const authInitialized = useAuthStore((state) => state.initialized);

  const selectedLayerId = useEditorStore((state) => state.selectedLayerId);
  const selectedLayerIds = useEditorStore((state) => state.selectedLayerIds);
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
  const builderDataPreloaded = useEditorStore((state) => state.builderDataPreloaded);
  const setBuilderDataPreloaded = useEditorStore((state) => state.setBuilderDataPreloaded);
  const collectionItemSheet = useEditorStore((state) => state.collectionItemSheet);
  const closeCollectionItemSheet = useEditorStore((state) => state.closeCollectionItemSheet);
  const fileManager = useEditorStore((state) => state.fileManager);
  const closeFileManager = useEditorStore((state) => state.closeFileManager);
  const createComponentDialog = useEditorStore((state) => state.createComponentDialog);
  const openCreateComponentDialog = useEditorStore((state) => state.openCreateComponentDialog);
  const closeCreateComponentDialog = useEditorStore((state) => state.closeCreateComponentDialog);

  const collections = useCollectionsStore((state) => state.collections);
  const selectedCollectionId = useCollectionsStore((state) => state.selectedCollectionId);

  const updateLayer = usePagesStore((state) => state.updateLayer);
  const draftsByPageId = usePagesStore((state) => state.draftsByPageId);
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
  const copyToClipboard = useClipboardStore((state) => state.copyLayer);
  const cutToClipboard = useClipboardStore((state) => state.cutLayer);
  const copyStyleToClipboard = useClipboardStore((state) => state.copyStyle);
  const pasteStyleFromClipboard = useClipboardStore((state) => state.pasteStyle);

  const componentIsSaving = useComponentsStore((state) => state.isSaving);
  const components = useComponentsStore((state) => state.components);

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
  const lastLayersByPageRef = useRef<Map<string, string>>(new Map());
  const previousPageIdRef = useRef<string | null>(null);
  const previousResourceIdRef = useRef<string | null>(null); // Track URL resourceId changes
  const hasInitializedLayerFromUrlRef = useRef(false);
  const previousIsEditingRef = useRef<boolean | undefined>(undefined);

  // Collaboration hooks - enable realtime sync for layers and pages
  const liveLayerUpdates = useLiveLayerUpdates(currentPageId);
  // useLivePageUpdates initializes page sync subscriptions by being called
  const _livePageUpdates = useLivePageUpdates();
  // Component and layer style sync hooks
  const liveComponentUpdates = useLiveComponentUpdates();
  const liveLayerStyleUpdates = useLiveLayerStyleUpdates();

  // Collaboration presence - set current user for syncing
  const setCurrentCollaborationUser = useCollaborationPresenceStore((state) => state.setCurrentUser);
  useEffect(() => {
    if (user) {
      const avatarUrl = user.user_metadata?.avatar_url || null;
      setCurrentCollaborationUser(user.id, user.email || '', avatarUrl);
    }
  }, [user, setCurrentCollaborationUser]);

  // Sidebar tab from store - immediately synced when tab changes in LeftSidebar
  const activeSidebarTab = useEditorStore((state) => state.activeSidebarTab);
  // Use store-based tab for instant UI feedback, fallback to URL-based for initial load
  const activeTab = activeSidebarTab || sidebarTab;

  // Combined saving state - either page or component
  const isCurrentlySaving = editingComponentId ? componentIsSaving : isSaving;

  // Helper: Get current layers (from page or component)
  const getCurrentLayers = useCallback((): Layer[] => {
    if (editingComponentId) {
      const { componentDrafts } = useComponentsStore.getState();
      return componentDrafts[editingComponentId] || [];
    }
    if (currentPageId) {
      const draft = draftsByPageId[currentPageId];
      return draft ? draft.layers : [];
    }
    return [];
  }, [editingComponentId, currentPageId, draftsByPageId]);

  // Helper: Update current layers (page or component)
  const updateCurrentLayers = useCallback((newLayers: Layer[]) => {
    if (editingComponentId) {
      const { updateComponentDraft } = useComponentsStore.getState();
      updateComponentDraft(editingComponentId, newLayers);
    } else if (currentPageId) {
      setDraftLayers(currentPageId, newLayers);
    }
  }, [editingComponentId, currentPageId, setDraftLayers]);

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
        const draft = draftsByPageId[currentPageId];
        if (!draft || !draft.layers) {
          return; // Draft not loaded yet, wait for next render
        }
      } else if (isComponentRoute && editingComponentId) {
        const componentDrafts = useComponentsStore.getState().componentDrafts;
        if (!componentDrafts[editingComponentId]) {
          return; // Component draft not loaded yet
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
        const draft = draftsByPageId[currentPageId];
        if (draft && draft.layers) {
          hasInitializedLayerFromUrlRef.current = true;
        }
      } else if (isComponentRoute && editingComponentId) {
        const componentDrafts = useComponentsStore.getState().componentDrafts;
        if (componentDrafts[editingComponentId]) {
          hasInitializedLayerFromUrlRef.current = true;
        }
      }
    }
  }, [urlState.layerId, resourceId, routeType, setSelectedLayerId, currentPageId, editingComponentId, draftsByPageId, getCurrentLayers]);

  // Sync selected layer to URL (but only after initialization from URL, skip when in page settings mode or during edit mode transition)
  useEffect(() => {
    // Skip if we just transitioned away from edit mode - navigation already includes all params
    if (justExitedEditMode) {
      return;
    }

    const isPageOrLayersRoute = routeType === 'page' || routeType === 'layers';
    const isComponentRoute = routeType === 'component';

    if ((isPageOrLayersRoute || isComponentRoute) && !urlState.isEditing && hasInitializedLayerFromUrlRef.current) {
      const layerParam = selectedLayerId || undefined;
      // Only update if the layer has actually changed from URL
      if (urlState.layerId !== layerParam) {
        updateQueryParams({ layer: layerParam });
      }
    }
  }, [selectedLayerId, routeType, updateQueryParams, urlState.layerId, urlState.isEditing, justExitedEditMode]);

  // Generate initial CSS if draft_css is empty (one-time check after data loads)
  const initialCssCheckRef = useRef(false);
  const settingsLoaded = useSettingsStore((state) => state.settings.length > 0);
  const draftsCount = Object.keys(draftsByPageId).length;

  useEffect(() => {
    // Early return if already checked - this must be the FIRST check
    if (initialCssCheckRef.current) {
      return;
    }

    // Wait for all initial data to be loaded
    if (!migrationsComplete || draftsCount === 0 || !settingsLoaded) {
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
  }, [migrationsComplete, draftsCount, settingsLoaded]);

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
            setBuilderDataPreloaded(true); // Allow UI to render even on error
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
            setAssets(response.data.assets || []);
            setAssetFolders(response.data.assetFolders || []);
            setFonts(response.data.fonts || []);

            // Load async data in parallel
            const asyncTasks = [];

            // Add collections preloading if we have collections
            if (response.data.collections && response.data.collections.length > 0) {
              asyncTasks.push(preloadCollectionsAndItems(response.data.collections));
            }

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
    } else if (routeType === 'component' && resourceId && !isExitingComponentModeRef.current) {
      const { getComponentById, loadComponentDraft } = useComponentsStore.getState();
      const component = getComponentById(resourceId);
      if (component && editingComponentId !== resourceId) {
        const { setEditingComponentId } = useEditorStore.getState();
        // Use currentPageId if available, otherwise find homepage as fallback
        const returnPageId = currentPageId || (pages.length > 0 ? (findHomepage(pages)?.id || pages[0]?.id) : null);
        setEditingComponentId(resourceId, returnPageId);
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
  }, [migrationsComplete, pages.length, components.length, collections.length, routeType, resourceId, currentPageId, editingComponentId, pages, components, collections, setCurrentPageId, setSelectedLayerId, navigateToLayers, navigateToCollection, navigateToCollections, urlState.layerId]);

  // Auto-select Body layer when switching pages (not when draft updates)
  useEffect(() => {
    // Only select Body if the page ID actually changed and no layer is specified in URL
    if (currentPageId && currentPageId !== previousPageIdRef.current) {
      // Update the ref to track this page FIRST
      previousPageIdRef.current = currentPageId;

      // Check if draft is loaded
      if (draftsByPageId[currentPageId] && !urlState.layerId) {
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
        // If Body is locked, keep selection as null - user can click on an unlocked layer
      }
      // If urlState.layerId exists, let the URL initialization effect handle it
    }
  }, [currentPageId, draftsByPageId, setSelectedLayerId, urlState.layerId]);

  // Get selected layer
  const selectedLayer = useMemo(() => {
    if (!currentPageId || !selectedLayerId) return null;
    const draft = draftsByPageId[currentPageId];
    if (!draft) return null;
    const stack: Layer[] = [...draft.layers];
    while (stack.length) {
      const node = stack.shift()!;
      if (node.id === selectedLayerId) return node;
      if (node.children) stack.push(...node.children);
    }
    return null;
  }, [currentPageId, selectedLayerId, draftsByPageId]);

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

  // Delete selected layer
  const deleteSelectedLayer = useCallback(() => {
    if (!selectedLayerId) return;

    // Find the next layer to select before deleting
    const layers = getCurrentLayers();
    const layerToDelete = findLayerById(layers, selectedLayerId);

    // Check if layer can be deleted
    if (layerToDelete && !canDeleteLayer(layerToDelete)) {
      return;
    }

    const nextLayerId = findNextLayerToSelect(layers, selectedLayerId);

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

      newLayers = removeLayerById(newLayers, selectedLayerId);
      updateCurrentLayers(newLayers);
      setSelectedLayerId(nextLayerId);
    } else if (currentPageId) {
      // Delete from page (pagination sync handled in usePagesStore.deleteLayer)
      deleteLayer(currentPageId, selectedLayerId);
      setSelectedLayerId(nextLayerId);

      // Broadcast delete to other collaborators
      if (liveLayerUpdates) {
        liveLayerUpdates.broadcastLayerDelete(currentPageId, selectedLayerId);
      }
    }
  }, [selectedLayerId, editingComponentId, currentPageId, getCurrentLayers, updateCurrentLayers, deleteLayer, setSelectedLayerId, liveLayerUpdates]);

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
    if (!currentPageId || !draftsByPageId[currentPageId]) {
      return;
    }

    const draft = draftsByPageId[currentPageId];
    const currentLayersJSON = JSON.stringify(draft.layers);
    const lastLayersJSON = lastLayersByPageRef.current.get(currentPageId);

    // Only trigger save if layers actually changed for THIS page
    if (lastLayersJSON && lastLayersJSON !== currentLayersJSON) {
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

    // Update the ref for next comparison (store per page)
    lastLayersByPageRef.current.set(currentPageId, currentLayersJSON);
    // NOTE: No cleanup here — clearing the save timeout on every re-run caused a race
    // condition where saves scheduled during an in-flight save were cancelled when
    // saveDraft updated draftsByPageId metadata, triggering this effect's cleanup.
  }, [currentPageId, draftsByPageId, debouncedSave]);

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
    const { saveComponentDraft, clearComponentDraft, getComponentById, saveTimeouts, loadComponentDraft } = useComponentsStore.getState();
    const { updateComponentOnLayers } = usePagesStore.getState();

    if (!editingComponentId || isExitingComponentModeRef.current) return;

    // Set flag to prevent re-entry during exit
    isExitingComponentModeRef.current = true;

    try {
      // Clear any pending auto-save timeout to avoid duplicate saves
      if (saveTimeouts[editingComponentId]) {
        clearTimeout(saveTimeouts[editingComponentId]);
      }

      // Immediately save component draft (ensures all changes are persisted)
      await saveComponentDraft(editingComponentId);

      // Get the updated component to get its layers
      const updatedComponent = getComponentById(editingComponentId);
      if (updatedComponent) {
        // Update all instances across pages with the new layers
        await updateComponentOnLayers(editingComponentId, updatedComponent.layers);

        // Broadcast component layers update to collaborators
        if (liveComponentUpdates) {
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
          const { componentNavigationStack } = useEditorStore.getState();
          const newStack = [...componentNavigationStack];
          newStack.pop(); // Remove child component entry

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
            returnDestination.layerId || undefined // layerId - restore the layer
          );

          // Restore layer selection if specified
          if (returnDestination.layerId) {
            setLayerIdFromStore(returnDestination.layerId);
          }
        }
      } else {
        // Returning to a page
        // Exit edit mode to clear the state and pop the stack
        setEditingComponentId(null, null);

        // Small delay to ensure state clears
        await new Promise(resolve => setTimeout(resolve, 10));
        // Returning to a page (or no stack entry)
        let targetPageId = returnToPageId;
        if (!targetPageId) {
          // No return page - use homepage or first available page
          const homePage = findHomepage(pages);
          const defaultPage = homePage || pages[0];
          targetPageId = defaultPage?.id || null;
        }

        if (!targetPageId) {
          console.warn('[handleExitComponentEditMode] No target page found, cannot exit component edit mode');
          return;
        }

        // Navigate to the target page, including the layer ID in the URL
        // This ensures the URL sync effect will restore the correct layer
        navigateToLayers(
          targetPageId,
          undefined, // view - use current
          undefined, // rightTab - use current
          returnToLayerId || returnDestination?.layerId || undefined // layerId - restore the original layer
        );
      }

      // Wait for navigation to complete
      await new Promise(resolve => setTimeout(resolve, 100));
    } finally {
      // Clear flag after exit completes
      isExitingComponentModeRef.current = false;
    }

    // Selection will be restored by the URL sync effect
  }, [navigateToLayers, navigateToComponent, liveComponentUpdates, pages]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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

      // Note: Undo/Redo shortcuts (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, Cmd/Ctrl+Y) are handled in CenterCanvas.tsx
      // This prevents duplication and ensures they work both in the main window and inside the iframe

      // Layer-specific shortcuts (only work on layers tab)
      if (activeTab === 'layers') {
        // A - Toggle Element Library (when on layers tab and not typing)
        if (e.key === 'a' && !isInputFocused && !e.metaKey && !e.ctrlKey && !e.altKey) {
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
        if (e.shiftKey && e.metaKey && e.code === 'KeyH') {
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

        // Escape - Select parent layer
        if (e.key === 'Escape' && (currentPageId || editingComponentId) && selectedLayerId) {
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
        if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && (currentPageId || editingComponentId) && selectedLayerId && !isInputFocused) {
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
        if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
          if (!isInputFocused && (currentPageId || editingComponentId)) {
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
                    copyToClipboard(copiedLayers[0], currentPageId || '');
                  }
                } else if (currentPageId) {
                  const copiedLayers = copyLayersFromStore(currentPageId, selectedLayerIds);
                  if (copiedLayers.length > 0) {
                    copyToClipboard(copiedLayers[0], currentPageId);
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
        if ((e.metaKey || e.ctrlKey) && e.key === 'x') {
          if (!isInputFocused && (currentPageId || editingComponentId)) {
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
                    cutToClipboard(copiedLayers[0], currentPageId || '');
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
                    cutToClipboard(copiedLayers[0], currentPageId);
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
        if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
          if (!isInputFocused && (currentPageId || editingComponentId)) {
            e.preventDefault();
            // Use clipboard store for paste (works with context menu)
            if (clipboardLayer && selectedLayerId) {
              // In component edit mode, paste into component drafts
              if (editingComponentId) {
                const circularError = checkCircularReference(editingComponentId, clipboardLayer, components);
                if (circularError) {
                  toast.error('Infinite component loop detected', { description: circularError });
                  return;
                }
                
                const layers = getCurrentLayers();
                const newLayer = regenerateIdsWithInteractionRemapping(cloneDeep(clipboardLayer));
                const result = findParentAndIndex(layers, selectedLayerId);
                if (result) {
                  updateCurrentLayers(insertLayerAfter(layers, result.parent, result.index, newLayer));
                }
              } else if (currentPageId) {
                // If body is selected, paste inside body (not after it)
                if (selectedLayerId === 'body') {
                  pasteInside(currentPageId, selectedLayerId, clipboardLayer);
                } else {
                  pasteAfter(currentPageId, selectedLayerId, clipboardLayer);
                }
              }
            }
          }
        }

        // Duplicate: Cmd/Ctrl + D (supports multi-select)
        if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
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

        // Delete: Delete or Backspace (supports multi-select)
        if ((e.key === 'Delete' || e.key === 'Backspace')) {
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
        if (e.altKey && e.metaKey && e.code === 'KeyC') {
          if (!isInputFocused && (currentPageId || editingComponentId) && selectedLayerId) {
            e.preventDefault();
            const layers = getCurrentLayers();
            const layer = findLayerById(layers, selectedLayerId);
            if (layer) {
              const classes = getClassesString(layer);
              copyStyleToClipboard(classes, layer.design, layer.styleId, layer.styleOverrides);
            }
          }
        }

        // Paste Style: Option + Cmd + V
        // Use e.code for physical key detection (e.key produces special chars with Option)
        if (e.altKey && e.metaKey && e.code === 'KeyV') {
          if (!isInputFocused && (currentPageId || editingComponentId) && selectedLayerId) {
            e.preventDefault();
            const style = pasteStyleFromClipboard();
            if (style) {
              const styleProps = {
                classes: style.classes,
                design: style.design,
                styleId: style.styleId,
                styleOverrides: style.styleOverrides,
              };

              if (editingComponentId) {
                updateCurrentLayers(updateLayerProps(getCurrentLayers(), selectedLayerId, styleProps));
              } else if (currentPageId) {
                updateLayer(currentPageId, selectedLayerId, styleProps);
              }
            }
          }
        }

        // Create Component: Option + Cmd + K
        if (e.altKey && e.metaKey && e.code === 'KeyK') {
          if (!isInputFocused && currentPageId && selectedLayerId && !editingComponentId) {
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
        if (e.altKey && e.metaKey && e.code === 'KeyB') {
          if (!isInputFocused && currentPageId && selectedLayerId && !editingComponentId) {
            e.preventDefault();
            const layers = getCurrentLayers();
            const layer = findLayerById(layers, selectedLayerId);
            if (layer?.componentId) {
              const { getComponentById } = useComponentsStore.getState();
              const component = getComponentById(layer.componentId);

              if (!component || !component.layers || component.layers.length === 0) {
                // If component not found or has no layers, just remove the componentId
                updateLayer(currentPageId, selectedLayerId, {
                  componentId: undefined,
                  componentOverrides: undefined,
                });
              } else {
                // Replace layer with component's layers (detach)
                const draft = draftsByPageId[currentPageId];
                if (draft) {
                  const replaceLayerWithComponentLayers = (layers: Layer[]): Layer[] => {
                    return layers.flatMap(currentLayer => {
                      if (currentLayer.id === selectedLayerId) {
                        // Deep clone and regenerate IDs
                        const clonedLayers = JSON.parse(JSON.stringify(component.layers));
                        return clonedLayers.map((l: Layer) => ({
                          ...l,
                          id: crypto.randomUUID(),
                          children: l.children ? regenerateChildIds(l.children) : undefined,
                        }));
                      }
                      if (currentLayer.children) {
                        return { ...currentLayer, children: replaceLayerWithComponentLayers(currentLayer.children) };
                      }
                      return currentLayer;
                    });
                  };

                  const regenerateChildIds = (children: Layer[]): Layer[] => {
                    return children.map(child => ({
                      ...child,
                      id: crypto.randomUUID(),
                      children: child.children ? regenerateChildIds(child.children) : undefined,
                    }));
                  };

                  const newLayers = replaceLayerWithComponentLayers(draft.layers);
                  setDraftLayers(currentPageId, newLayers);
                  setSelectedLayerId(null);
                }
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
    selectedLayerId,
    selectedLayerIds,
    currentPageId,
    editingComponentId,
    draftsByPageId,
    setSelectedLayerId,
    getCurrentLayers,
    updateCurrentLayers,
    copyLayersFromStore,
    copyLayerFromStore,
    copyToClipboard,
    cutToClipboard,
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
        currentPage={routeType === 'settings' || routeType === 'profile' || routeType === 'forms' || routeType === 'integrations' ? undefined : currentPage}
        currentPageId={routeType === 'settings' || routeType === 'profile' || routeType === 'forms' || routeType === 'integrations' ? null : currentPageId}
        pages={routeType === 'settings' || routeType === 'profile' || routeType === 'forms' || routeType === 'integrations' ? [] : pages}
        setCurrentPageId={routeType === 'settings' || routeType === 'profile' || routeType === 'forms' || routeType === 'integrations' ? () => {} : setCurrentPageId}
        isSaving={routeType === 'settings' || routeType === 'localization' || routeType === 'profile' || routeType === 'forms' || routeType === 'integrations' ? false : isCurrentlySaving}
        hasUnsavedChanges={routeType === 'settings' || routeType === 'localization' || routeType === 'profile' || routeType === 'forms' || routeType === 'integrations' ? false : hasUnsavedChanges}
        lastSaved={routeType === 'settings' || routeType === 'localization' || routeType === 'profile' || routeType === 'forms' || routeType === 'integrations' ? null : lastSaved}
        isPublishing={routeType === 'settings' || routeType === 'localization' || routeType === 'profile' || routeType === 'forms' || routeType === 'integrations' ? false : isPublishing}
        setIsPublishing={routeType === 'settings' || routeType === 'localization' || routeType === 'profile' || routeType === 'forms' || routeType === 'integrations' ? () => {} : setIsPublishing}
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
            {/* Left Sidebar - Pages & Layers (hidden in preview mode and CMS) */}
            {!isPreviewMode && (
              <div className={activeTab === 'cms' ? 'hidden' : 'contents'}>
                <LeftSidebar
                  selectedLayerId={selectedLayerId}
                  selectedLayerIds={selectedLayerIds}
                  onLayerSelect={setSelectedLayerId}
                  currentPageId={currentPageId}
                  onPageSelect={setCurrentPageId}
                  liveLayerUpdates={liveLayerUpdates}
                  liveComponentUpdates={liveComponentUpdates}
                />
              </div>
            )}

            {/* CMS View - kept mounted for instant switching */}
            <div className={activeTab === 'cms' ? 'flex flex-1 min-w-0 overflow-hidden' : 'hidden'}>
              <Suspense fallback={null}>
                <CMS />
              </Suspense>
            </div>

            {/* Design View - kept mounted for instant switching */}
            <div className={activeTab !== 'cms' ? 'contents' : 'hidden'}>
              {/* Center Canvas - Preview */}
              <CenterCanvas
                selectedLayerId={selectedLayerId}
                currentPageId={currentPageId}
                viewportMode={viewportMode}
                setViewportMode={setViewportMode}
                onExitComponentEditMode={handleExitComponentEditMode}
                liveLayerUpdates={liveLayerUpdates}
                liveComponentUpdates={liveComponentUpdates}
              />

              {/* Right Sidebar - Properties (hidden in preview mode) */}
              {!isPreviewMode && (
                <RightSidebar
                  selectedLayerId={selectedLayerId}
                  onLayerUpdate={(layerId, updates) => {
                    // If editing component, update component draft
                    if (editingComponentId) {
                      const { componentDrafts, updateComponentDraft } = useComponentsStore.getState();
                      const layers = componentDrafts[editingComponentId] || [];

                      // Find and update layer in tree
                      const updateLayerInTree = (tree: Layer[]): Layer[] => {
                        return tree.map(layer => {
                          if (layer.id === layerId) {
                            return { ...layer, ...updates };
                          }
                          if (layer.children) {
                            return { ...layer, children: updateLayerInTree(layer.children) };
                          }
                          return layer;
                        });
                      };

                      const updatedLayers = updateLayerInTree(layers);
                      updateComponentDraft(editingComponentId, updatedLayers);
                    } else if (currentPageId) {
                      // Regular page mode
                      updateLayer(currentPageId, layerId, updates);

                      // Broadcast to other collaborators
                      if (liveLayerUpdates) {
                        liveLayerUpdates.broadcastLayerUpdate(layerId, updates);
                      }
                    }
                  }}
                />
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
            const componentId = await createComponentFromLayer(
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
