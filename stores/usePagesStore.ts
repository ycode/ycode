'use client';

import { create } from 'zustand';
import type { Layer, Page, PageLayers, PageFolder, PageItemDuplicateResult, CollectionItemWithValues } from '../types';
import { pagesApi, pageLayersApi, foldersApi } from '../lib/api';
import { getLayerFromTemplate, getBlockName } from '../lib/templates/blocks';
import { cloneDeep } from 'lodash';
import {
  canHaveChildren,
  canAddChild,
  regenerateIdsWithInteractionRemapping,
  canMoveLayer,
  findLayerById,
  createComponentViaApi,
  replaceLayerWithComponentInstance,
  collectAllSettingsIds,
  generateUniqueSettingsId,
  resetBindingsAfterMove,
  resetBindingsForDeletedCollection,
  resetBindingsForDeletedField,
} from '../lib/layer-utils';
import { generateId } from '../lib/utils';
import { getDescendantFolderIds, isHomepage, findHomepage, findNextSelection } from '../lib/page-utils';
import { updateLayersWithStyle, detachStyleFromLayers } from '../lib/layer-style-utils';
import { updateLayersWithComponent, detachComponentFromLayers } from '../lib/component-utils';
import { useComponentsStore, triggerThumbnailGeneration } from './useComponentsStore';

interface PagesState {
  pages: Page[];
  folders: PageFolder[];
  draftsByPageId: Record<string, PageLayers>;
  isLoading: boolean;
  error: string | null;
}

interface PagesActions {
  // State Setters
  setPages: (pages: Page[]) => void;
  setFolders: (folders: PageFolder[]) => void;
  setPagesAndDrafts: (pages: Page[], drafts: PageLayers[]) => void;
  setError: (error: string | null) => void;

  // Loading Operations
  loadPages: () => Promise<void>;
  loadFolders: () => Promise<void>;
  loadDraft: (pageId: string) => Promise<void>;
  loadAllDrafts: () => Promise<void>;

  // Page CRUD Operations
  createPage: (pageData: Omit<Page, 'id' | 'created_at' | 'updated_at' | 'deleted_at'>) => Promise<{ success: boolean; data?: Page; error?: string; tempId?: string }>;
  updatePage: (pageId: string, updates: Partial<Page>) => Promise<{ success: boolean; error?: string }>;
  duplicatePage: (pageId: string) => Promise<PageItemDuplicateResult<Page>>;
  deletePage: (pageId: string, currentPageId?: string | null) => Promise<{ success: boolean; error?: string; currentPageDeleted?: boolean; nextPageId?: string | null }>;

  // Folder CRUD Operations
  createFolder: (folderData: Omit<PageFolder, 'id' | 'created_at' | 'updated_at' | 'deleted_at'>) => Promise<{ success: boolean; data?: PageFolder; error?: string; tempId?: string }>;
  updateFolder: (folderId: string, updates: Partial<PageFolder>) => Promise<{ success: boolean; error?: string }>;
  duplicateFolder: (folderId: string) => Promise<PageItemDuplicateResult<PageFolder>>;
  deleteFolder: (folderId: string, currentPageId?: string | null) => Promise<{ success: boolean; error?: string; currentPageAffected?: boolean; nextPageId?: string | null; deletedPageIds?: string[] }>;

  // Page/Folder Operations
  batchReorderPagesAndFolders: (pages: Page[], folders: PageFolder[]) => Promise<{ success: boolean; error?: string }>;

  // Draft Operations
  initDraft: (page: Page, initialLayers?: Layer[]) => void;
  updateLayerClasses: (pageId: string, layerId: string, classes: string) => void;
  saveDraft: (pageId: string) => Promise<void>;
  publishPage: (pageId: string) => Promise<void>;
  addLayer: (pageId: string, parentLayerId: string | null, layerName: string) => void;
  addLayerWithId: (pageId: string, parentLayerId: string | null, layer: Layer) => void;

  // Layer Operations
  addLayerFromTemplate: (pageId: string, parentLayerId: string | null, templateId: string, insertPosition?: { siblingId: string; position: 'above' | 'below' }) => { newLayerId: string; parentToExpand: string | null } | null;
  deleteLayer: (pageId: string, layerId: string) => void;
  deleteLayers: (pageId: string, layerIds: string[]) => void; // New batch delete
  updateLayer: (pageId: string, layerId: string, updates: Partial<Layer>) => void;
  moveLayer: (pageId: string, layerId: string, targetParentId: string | null, targetIndex: number) => boolean;
  addPage: (page: Page) => void;
  updatePageLocal: (pageId: string, updates: Partial<Page>) => void;
  removePage: (pageId: string) => void;
  setDraftLayers: (pageId: string, layers: Layer[]) => void;
  copyLayer: (pageId: string, layerId: string) => Layer | null;
  copyLayers: (pageId: string, layerIds: string[]) => Layer[]; // New batch copy
  duplicateLayer: (pageId: string, layerId: string) => Layer | null;
  duplicateLayers: (pageId: string, layerIds: string[]) => Layer[]; // New batch duplicate
  pasteAfter: (pageId: string, targetLayerId: string, layerToPaste: Layer) => Layer | null;
  pasteInside: (pageId: string, targetLayerId: string, layerToPaste: Layer) => Layer | null;

  // Layer Style Actions
  updateStyleOnLayers: (styleId: string, newClasses: string, newDesign?: Layer['design']) => void;
  detachStyleFromAllLayers: (styleId: string) => void;

  // Component Actions
  createComponentFromLayer: (pageId: string, layerId: string, componentName: string) => Promise<string | null>;
  updateComponentOnLayers: (componentId: string, newLayers: Layer[]) => void;
  detachComponentFromAllLayers: (componentId: string) => void;

  // CMS Binding Cleanup Actions
  cleanupDeletedCollection: (collectionId: string) => void;
  cleanupDeletedField: (fieldId: string) => void;

  // Page collection item actions (for dynamic pages)
  updatePageCollectionItem: (pageId: string, updatedItem: CollectionItemWithValues) => void;
  refetchPageCollectionItem: (pageId: string) => Promise<void>;
}

type PagesStore = PagesState & PagesActions;

/**
 * Tracks pages that were just synced from MCP (server-side).
 * The autosave watcher checks this to avoid overwriting MCP's DB writes
 * with stale local state.
 */
const mcpSyncedPages = new Set<string>();

export function markPageMcpSynced(pageId: string): void {
  mcpSyncedPages.add(pageId);
}

export function consumePageMcpSync(pageId: string): boolean {
  if (mcpSyncedPages.has(pageId)) {
    mcpSyncedPages.delete(pageId);
    return true;
  }
  return false;
}

function updateLayerInTree(tree: Layer[], layerId: string, updater: (l: Layer) => Layer): Layer[] {
  return tree.map((node) => {
    if (node.id === layerId) {
      return updater(node);
    }

    if (node.children && node.children.length > 0) {
      return { ...node, children: updateLayerInTree(node.children, layerId, updater) };
    }

    return node;
  });
}

/**
 * Reorder pages and folders together within each parent/depth group after deletion
 * Ensures no gaps in the order sequence
 * Mimics backend reorderSiblings logic
 */
function reorderPagesAndFoldersTogether(
  pages: Page[],
  folders: PageFolder[]
): { pages: Page[]; folders: PageFolder[] } {
  // Separate error/deleted pages (excluded from reordering but preserved in result)
  const errorPages = pages.filter(p => p.error_page !== null);
  const deletedPages = pages.filter(p => p.deleted_at !== null);
  const regularPages = pages.filter(p => p.error_page === null && p.deleted_at === null);

  // Group items by parent_id AND depth (matching backend logic)
  const groupsByParentAndDepth = new Map<string, { pages: Page[]; folders: PageFolder[] }>();

  // Helper to create group key
  const getGroupKey = (parentId: string | null, depth: number) => `${parentId || 'root'}:${depth}`;

  // Group regular pages (exclude error pages and deleted pages from reordering)
  for (const page of regularPages) {
    const key = getGroupKey(page.page_folder_id, page.depth);
    if (!groupsByParentAndDepth.has(key)) {
      groupsByParentAndDepth.set(key, { pages: [], folders: [] });
    }
    groupsByParentAndDepth.get(key)!.pages.push(page);
  }

  // Group folders (exclude deleted folders from reordering)
  for (const folder of folders) {
    if (folder.deleted_at !== null) {
      continue;
    }
    const key = getGroupKey(folder.page_folder_id, folder.depth);
    if (!groupsByParentAndDepth.has(key)) {
      groupsByParentAndDepth.set(key, { pages: [], folders: [] });
    }
    groupsByParentAndDepth.get(key)!.folders.push(folder);
  }

  const reorderedPages: Page[] = [];
  const reorderedFolders: PageFolder[] = [];

  // Reorder each group (pages and folders together)
  for (const [groupKey, group] of groupsByParentAndDepth) {
    // Combine pages and folders with type markers
    const combined = [
      ...group.pages.map(p => ({ item: p, type: 'page' as const, order: p.order || 0 })),
      ...group.folders.map(f => ({ item: f, type: 'folder' as const, order: f.order || 0 })),
    ];

    // Sort by current order
    combined.sort((a, b) => a.order - b.order);

    // Reassign sequential order values to all items (0, 1, 2, ...)
    combined.forEach((entry, index) => {
      if (entry.type === 'page') {
        reorderedPages.push({ ...entry.item, order: index } as Page);
      } else {
        reorderedFolders.push({ ...entry.item, order: index } as PageFolder);
      }
    });
  }

  // Merge reordered pages with error pages and deleted pages (preserve them)
  const allPages = [...reorderedPages, ...errorPages, ...deletedPages];

  return { pages: allPages, folders: reorderedFolders };
}

function findLayerInTree(tree: Layer[], layerId: string): Layer | null {
  for (const node of tree) {
    if (node.id === layerId) return node;
    if (node.children) {
      const found = findLayerInTree(node.children, layerId);
      if (found) return found;
    }
  }
  return null;
}

export const usePagesStore = create<PagesStore>((set, get) => ({
  pages: [],
  folders: [],
  draftsByPageId: {},
  isLoading: false,
  error: null,

  setPages: (pages) => set({ pages }),
  setFolders: (folders) => set({ folders }),

  setPagesAndDrafts: (pages, drafts) => {
    // Build a map of pageId -> PageLayers
    const draftsMap: Record<string, PageLayers> = {};

    drafts.forEach((draft) => {
      draftsMap[draft.page_id] = draft;
    });

    // For pages that don't have drafts in the database, initialize empty drafts
    pages.forEach((page) => {
      if (!draftsMap[page.id]) {
        draftsMap[page.id] = {
          id: `draft-${page.id}`,
          page_id: page.id,
          layers: [],
          is_published: false,
          created_at: new Date().toISOString(),
          deleted_at: null,
        };
      }
    });

    set({ pages, draftsByPageId: draftsMap });

    // Initialize version tracking for all drafts
    import('@/lib/version-tracking').then(({ initializeVersionTracking }) => {
      Object.entries(draftsMap).forEach(([pageId, draft]) => {
        initializeVersionTracking('page_layers', pageId, draft.layers);
      });
    }).catch((err) => {
      console.error('Failed to initialize version tracking:', err);
    });
  },

  loadPages: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await pagesApi.getAll();
      if (response.error) {
        console.error('[usePagesStore.loadPages] Error loading pages:', response.error);
        set({ error: response.error, isLoading: false });
        return;
      }
      const pages = response.data || [];

      // Note: Default homepage with draft layers is created during migrations (20250101000002_create_page_layers_table.ts)

      set({ pages, isLoading: false });
    } catch (error) {
      console.error('[usePagesStore.loadPages] Exception loading pages:', error);
      set({ error: 'Failed to load pages', isLoading: false });
    }
  },

  loadFolders: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await foldersApi.getAll();
      if (response.error) {
        console.error('[usePagesStore.loadFolders] Error loading folders:', response.error);
        set({ error: response.error, isLoading: false });
        return;
      }
      const folders = response.data || [];
      set({ folders, isLoading: false });
    } catch (error) {
      console.error('[usePagesStore.loadFolders] Exception loading folders:', error);
      set({ error: 'Failed to load folders', isLoading: false });
    }
  },

  loadDraft: async (pageId) => {
    // Check if we already have a draft with unsaved changes
    const existingDraft = get().draftsByPageId[pageId];

    set({ isLoading: true, error: null });
    try {
      const response = await pageLayersApi.getDraft(pageId);
      if (response.error) {
        set({ error: response.error, isLoading: false });
        return;
      }
      if (response.data) {
        // If we had local changes, we need to decide what to do
        // For now, we'll prefer server data when explicitly loading (e.g., page switch)
        // but log a warning if we're overwriting local changes
        if (existingDraft &&
            JSON.stringify(existingDraft.layers) !== JSON.stringify(response.data.layers)) {
          console.warn('⚠️ loadDraft: Overwriting local changes with server data');
        }

        set((state) => ({
          draftsByPageId: { ...state.draftsByPageId, [pageId]: response.data! },
          isLoading: false,
        }));

        // Initialize version tracking with loaded state (awaited to ensure it completes before edits)
        try {
          const { initializeVersionTracking } = await import('@/lib/version-tracking');
          initializeVersionTracking('page_layers', pageId, response.data!.layers);
        } catch (err) {
          console.error('Failed to initialize version tracking:', err);
        }
      }
    } catch (error) {
      set({ error: 'Failed to load draft', isLoading: false });
    }
  },

  loadAllDrafts: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await pageLayersApi.getAllDrafts();
      if (response.error) {
        set({ error: response.error, isLoading: false });
        return;
      }

      // Build a map of pageId -> PageLayers
      const draftsMap: Record<string, PageLayers> = {};

      if (response.data) {
        response.data.forEach((draft) => {
          draftsMap[draft.page_id] = draft;
        });
      }

      // For pages that don't have drafts in the database, initialize empty drafts
      const pages = get().pages;
      pages.forEach((page) => {
        if (!draftsMap[page.id]) {
          draftsMap[page.id] = {
            id: `draft-${page.id}`,
            page_id: page.id,
            layers: [],
            is_published: false,
            created_at: new Date().toISOString(),
            deleted_at: null,
          };
        }
      });

      set((state) => ({
        draftsByPageId: { ...state.draftsByPageId, ...draftsMap },
        isLoading: false,
      }));

      // Initialize version tracking for all loaded drafts
      try {
        const { initializeVersionTracking } = await import('@/lib/version-tracking');
        Object.entries(draftsMap).forEach(([pageId, draft]) => {
          initializeVersionTracking('page_layers', pageId, draft.layers);
        });
      } catch (err) {
        console.error('Failed to initialize version tracking for drafts:', err);
      }
    } catch (error) {
      set({ error: 'Failed to load drafts', isLoading: false });
    }
  },

  initDraft: (page, initialLayers = []) => {
    const draft: PageLayers = {
      id: `draft-${page.id}`,
      page_id: page.id,
      layers: initialLayers,
      is_published: false,
      created_at: new Date().toISOString(),
      deleted_at: null,
    };
    set((state) => ({ draftsByPageId: { ...state.draftsByPageId, [page.id]: draft } }));

    // Initialize version tracking for this draft
    import('@/lib/version-tracking').then(({ initializeVersionTracking }) => {
      initializeVersionTracking('page_layers', page.id, initialLayers);
    }).catch((err) => {
      console.error('Failed to initialize version tracking:', err);
    });
  },

  updateLayerClasses: (pageId, layerId, classes) => {
    const { draftsByPageId } = get();
    const draft = draftsByPageId[pageId];
    if (! draft) return;
    const newLayers = updateLayerInTree(draft.layers, layerId, (l) => ({ ...l, classes }));
    set({ draftsByPageId: { ...draftsByPageId, [pageId]: { ...draft, layers: newLayers } } });
  },

  saveDraft: async (pageId) => {
    const { draftsByPageId } = get();
    const draft = draftsByPageId[pageId];
    if (! draft) return;

    // Capture the layers we're about to save
    const layersBeingSaved = draft.layers;

    set({ isLoading: true, error: null });
    try {
      const response = await pageLayersApi.updateDraft(
        pageId,
        draft.layers
      );

      if (response.error) {
        set({ error: response.error, isLoading: false });
        return;
      }
      if (response.data) {
        // IMPORTANT: Only update state if layers haven't changed since we started saving
        // This prevents race conditions where new changes are overwritten by stale server data
        const currentDraft = get().draftsByPageId[pageId];
        const currentLayersJSON = JSON.stringify(currentDraft?.layers || []);
        const savedLayersJSON = JSON.stringify(layersBeingSaved);

        if (currentLayersJSON === savedLayersJSON) {
          // Safe to update - no changes made during save
          // IMPORTANT: Only update metadata, keep existing layers to avoid triggering re-renders
          set((state) => ({
            draftsByPageId: {
              ...state.draftsByPageId,
              [pageId]: {
                ...response.data!,
                layers: currentDraft!.layers, // Keep existing layers reference
              }
            },
            isLoading: false,
          }));

          // Record version for undo/redo only if layers match what we saved
          // This ensures we don't create version records for stale data
          import('@/lib/version-tracking').then(({ recordVersionViaApi }) => {
            recordVersionViaApi('page_layers', pageId, layersBeingSaved);
          }).catch((err) => {
            console.error('Failed to record version:', err);
          });
        } else {
          // Layers changed during save - keep local changes, but update metadata
          // This happens if user made changes (or undo/redo) while save was in-flight
          set((state) => ({
            draftsByPageId: {
              ...state.draftsByPageId,
              [pageId]: {
                ...response.data!,
                layers: currentDraft!.layers, // Keep current layers, not server's
              }
            },
            isLoading: false,
          }));

          // DO NOT record version - the saved state is stale
          // The new state will trigger another auto-save which will record its own version
        }

        // After successfully saving the draft, generate and save CSS from ALL pages
        try {
          const { generateAndSaveCSS } = await import('@/lib/client/cssGenerator');

          // Collect layers from ALL pages for comprehensive CSS generation
          const allLayers: Layer[] = [];
          const allDrafts = get().draftsByPageId;
          Object.values(allDrafts).forEach((pageDraft) => {
            if (pageDraft.layers) {
              allLayers.push(...pageDraft.layers);
            }
          });

          await generateAndSaveCSS(allLayers);
        } catch (cssError) {
          console.error('Failed to generate CSS after save:', cssError);
          // Don't fail the save operation if CSS generation fails
        }
      }
    } catch (error) {
      console.error('Failed to save draft:', error);
      set({ error: 'Failed to save draft', isLoading: false });
    }
  },

  setError: (error) => set({ error }),

  publishPage: async (pageId) => {
    set({ isLoading: true, error: null });
    try {
      const response = await fetch('/ycode/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageIds: [pageId] }),
      });
      const result = await response.json();
      if (!response.ok || result.error) {
        set({ error: result.error || 'Failed to publish page', isLoading: false });
        return;
      }
      // Reload pages to update published status
      await get().loadPages();
      set({ isLoading: false });
    } catch (error) {
      set({ error: 'Failed to publish page', isLoading: false });
    }
  },

  addLayer: (pageId, parentLayerId, layerName) => {
    const { draftsByPageId, pages } = get();
    let draft = draftsByPageId[pageId];

    // Initialize draft if it doesn't exist
    if (!draft) {
      const page = pages.find(p => p.id === pageId);
      if (!page) return;

      draft = {
        id: `draft-${pageId}`,
        page_id: pageId,
        layers: [],
        is_published: false,
        created_at: new Date().toISOString(),
        deleted_at: null,
      };
    }

    const newLayer: Layer = {
      id: generateId('lyr'),
      name: layerName,
      classes: '',
      children: layerName === 'div' || layerName === 'section' || layerName === 'container' ? [] : undefined,
    };

    let newLayers: Layer[];

    if (!parentLayerId) {
      // Add to root
      newLayers = [...draft.layers, newLayer];
    } else {
      // Add as child to parent
      newLayers = updateLayerInTree(draft.layers, parentLayerId, (parent) => ({
        ...parent,
        children: [...(parent.children || []), newLayer],
      }));
    }

    set({
      draftsByPageId: {
        ...draftsByPageId,
        [pageId]: { ...draft, layers: newLayers }
      }
    });
  },

  addLayerFromTemplate: (pageId, parentLayerId, templateId, insertPosition) => {
    const { draftsByPageId, pages } = get();
    let draft = draftsByPageId[pageId];

    // Initialize draft if it doesn't exist
    if (!draft) {
      const page = pages.find(p => p.id === pageId);
      if (!page) return null;

      draft = {
        id: `draft-${pageId}`,
        page_id: pageId,
        layers: [],
        is_published: false,
        created_at: new Date().toISOString(),
        deleted_at: null,
      };
    }

    // Get the template and block info
    const template = getLayerFromTemplate(templateId);
    if (!template) {
      console.error(`Template ${templateId} not found`);
      return null;
    }

    const displayName = getBlockName(templateId);

    // Collect all existing settings IDs from the draft to generate unique IDs
    const existingSettingsIds = collectAllSettingsIds(draft.layers);
    // Track IDs used during this normalization (for templates with multiple elements)
    const usedSettingsIds = new Set<string>(existingSettingsIds);

    // Form elements use a wrapper div - don't set customName so it shows as "Block"
    const formWrapperTypes = ['input', 'textarea', 'select', 'checkbox', 'radio'];
    const isFormWrapper = formWrapperTypes.includes(templateId);

    // Track old→new settings.id mappings so we can update 'for' attributes on labels
    const idMappings = new Map<string, string>();

    // Set the display name for the root layer and generate unique settings IDs
    const normalizeLayer = (layer: Layer, isRoot: boolean = true): Layer => {
      const normalized = { ...layer };

      if (isRoot && displayName && !isFormWrapper) {
        normalized.customName = displayName;
      }

      // Generate unique settings.id if the layer has one
      if (normalized.settings?.id) {
        const originalId = normalized.settings.id;
        const uniqueId = generateUniqueSettingsId(originalId, usedSettingsIds);
        usedSettingsIds.add(uniqueId);
        normalized.settings = {
          ...normalized.settings,
          id: uniqueId,
        };
        if (originalId !== uniqueId) {
          idMappings.set(originalId, uniqueId);
        }
      }

      // Recursively normalize children
      if (normalized.children) {
        normalized.children = normalized.children.map(child => normalizeLayer(child, false));
      }

      // Ensure classes is a string
      if (Array.isArray(normalized.classes)) {
        normalized.classes = normalized.classes.join(' ');
      }

      return normalized;
    };

    // Update 'for' attributes on labels to match the new unique settings IDs
    const updateForAttributes = (layer: Layer): Layer => {
      const updated = { ...layer };
      if (updated.attributes?.for && idMappings.has(updated.attributes.for)) {
        updated.attributes = {
          ...updated.attributes,
          for: idMappings.get(updated.attributes.for),
        };
      }
      if (updated.children) {
        updated.children = updated.children.map(child => updateForAttributes(child));
      }
      return updated;
    };

    let newLayer = normalizeLayer(template, true);
    // Fix label 'for' attributes to point to the new unique IDs
    if (idMappings.size > 0) {
      newLayer = updateForAttributes(newLayer);
    }
    const newLayerId = newLayer.id;

    // Detect if we're adding a Section layer
    const isAddingSection = templateId === 'section' || newLayer.name === 'section';

    let newLayers: Layer[];
    let parentToExpand: string | null = null;

    if (! parentLayerId) {
      // Add to root
      newLayers = [...draft.layers, newLayer];
    } else {
      // Special handling for Section layers - they can only be at Body level
      if (isAddingSection) {
        // Sections can only be added at Body level
        // Find the Body layer (root container)
        const bodyLayer = draft.layers.find(l => l.id === 'body' || l.name === 'body');

        if (bodyLayer) {
          // Add Section as a child of Body
          newLayers = updateLayerInTree(draft.layers, bodyLayer.id, (body) => ({
            ...body,
            children: [...(body.children || []), newLayer],
          }));
          parentToExpand = bodyLayer.id;
        } else {
          // Fallback: add to root if no Body layer found
          newLayers = [...draft.layers, newLayer];
        }
      } else {
        // Find the parent layer and its parent
        const findLayerWithParent = (tree: Layer[], id: string, parent: Layer | null = null): { layer: Layer; parent: Layer | null } | null => {
          for (const node of tree) {
            if (node.id === id) return { layer: node, parent };
            if (node.children) {
              const found = findLayerWithParent(node.children, id, node);
              if (found) return found;
            }
          }
          return null;
        };

        const result = findLayerWithParent(draft.layers, parentLayerId);

        // When adding a form element and the selected node's parent is a form,
        // add as sibling after the selected node (not as a child of it).
        // This way new form fields appear at the same level inside the form.
        const shouldAddAsSiblingInForm = isFormWrapper && result?.parent?.name === 'form';

        // Check if parent can have children or if link nesting would occur
        const cannotAddAsChild = shouldAddAsSiblingInForm || (result && (
          !canHaveChildren(result.layer, newLayer.name) ||
          !canAddChild(result.layer, newLayer)
        ));

        if (cannotAddAsChild) {

          // If parent exists (not root level), insert after the selected layer
          if (result.parent) {
            newLayers = updateLayerInTree(draft.layers, result.parent.id, (grandparent) => {
              const children = grandparent.children || [];
              const selectedIndex = children.findIndex(c => c.id === parentLayerId);
              const newChildren = [...children];
              newChildren.splice(selectedIndex + 1, 0, newLayer);
              return { ...grandparent, children: newChildren };
            });
            // Expand the parent of the selected layer (grandparent)
            parentToExpand = result.parent.id;
          } else {
            // Selected layer is at root level, insert after it
            const selectedIndex = draft.layers.findIndex(l => l.id === parentLayerId);
            newLayers = [...draft.layers];
            newLayers.splice(selectedIndex + 1, 0, newLayer);
          }
        } else {
          // Add as child to parent
          newLayers = updateLayerInTree(draft.layers, parentLayerId, (parent) => {
            const children = parent.children || [];
            
            // If insertPosition is provided, insert at the specified sibling position
            if (insertPosition) {
              const siblingIndex = children.findIndex(c => c.id === insertPosition.siblingId);
              if (siblingIndex !== -1) {
                const newChildren = [...children];
                // Insert above = at sibling's index, below = after sibling
                const insertIndex = insertPosition.position === 'above' ? siblingIndex : siblingIndex + 1;
                newChildren.splice(insertIndex, 0, newLayer);
                return { ...parent, children: newChildren };
              }
            }
            
            // Default: append to end
            return { ...parent, children: [...children, newLayer] };
          });
          // Expand the parent that we're adding into
          parentToExpand = parentLayerId;
        }
      }
    }

    set({
      draftsByPageId: {
        ...draftsByPageId,
        [pageId]: { ...draft, layers: newLayers }
      }
    });

    return { newLayerId, parentToExpand };
  },

  deleteLayer: (pageId, layerId) => {
    const { draftsByPageId } = get();
    const draft = draftsByPageId[pageId];
    if (! draft) return;

    // Find layer by ID
    const findLayer = (tree: Layer[], id: string): Layer | null => {
      for (const node of tree) {
        if (node.id === id) return node;
        if (node.children) {
          const found = findLayer(node.children, id);
          if (found) return found;
        }
      }
      return null;
    };

    const layerToDelete = findLayer(draft.layers, layerId);

    // Prevent deleting body layer
    if (layerToDelete?.id === 'body') {
      console.warn('Cannot delete body layer');
      return;
    }

    // Check if this is a pagination wrapper - if so, we need to disable pagination on the collection
    const paginationFor = layerToDelete?.attributes?.['data-pagination-for'];

    // Helper: Remove from tree (supports both children and items)
    const removeFromTree = (tree: Layer[]): Layer[] => {
      return tree
        .filter(node => node.id !== layerId)
        .map(node => {
          if (!node.children) return node;
          return { ...node, children: removeFromTree(node.children) };
        });
    };

    // Helper: Update a layer in tree by ID
    const updateInTree = (tree: Layer[], targetId: string, updater: (l: Layer) => Layer): Layer[] => {
      return tree.map(node => {
        if (node.id === targetId) {
          return updater(node);
        }
        if (node.children) {
          return { ...node, children: updateInTree(node.children, targetId, updater) };
        }
        return node;
      });
    };

    // Start with the current layers
    let newLayers = draft.layers;

    // If this is a pagination wrapper, disable pagination on the collection layer first
    if (paginationFor) {
      const collectionLayer = findLayer(draft.layers, paginationFor);
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

    // Now remove the layer
    newLayers = removeFromTree(newLayers);

    // Use functional update to ensure we're working with the latest state
    set((state) => ({
      draftsByPageId: {
        ...state.draftsByPageId,
        [pageId]: {
          ...state.draftsByPageId[pageId],
          layers: newLayers
        }
      }
    }));
  },

  deleteLayers: (pageId, layerIds) => {
    const { draftsByPageId } = get();
    const draft = draftsByPageId[pageId];
    if (!draft || layerIds.length === 0) return;

    // Filter out body and locked layers
    const validIds = new Set<string>();
    const findLayer = (tree: Layer[], id: string): Layer | null => {
      for (const node of tree) {
        if (node.id === id) return node;
        if (node.children) {
          const found = findLayer(node.children, id);
          if (found) return found;
        }
      }
      return null;
    };

    // Check each layer ID
    for (const layerId of layerIds) {
      if (layerId === 'body') continue; // Skip body
      const layer = findLayer(draft.layers, layerId);
      if (layer && layer.id !== 'body') {
        validIds.add(layerId);
      }
    }

    if (validIds.size === 0) {
      console.warn('No valid layers to delete');
      return;
    }

    // Helper: Check if a node is a descendant of any in the delete set
    const isDescendantOfDeleted = (tree: Layer[], nodeId: string, deletedIds: Set<string>): boolean => {
      for (const node of tree) {
        if (deletedIds.has(node.id)) {
          // Check if nodeId is in this node's descendants
          const hasDescendant = (children: Layer[]): boolean => {
            for (const child of children) {
              if (child.id === nodeId) return true;
              if (child.children && hasDescendant(child.children)) return true;
            }
            return false;
          };
          if (node.children && hasDescendant(node.children)) return true;
        }
        if (node.children && isDescendantOfDeleted(node.children, nodeId, deletedIds)) {
          return true;
        }
      }
      return false;
    };

    // Remove parent-child duplicates (if parent is selected, don't separately delete children)
    const finalIds = new Set<string>();
    for (const id of validIds) {
      if (!isDescendantOfDeleted(draft.layers, id, validIds)) {
        finalIds.add(id);
      }
    }

    // Helper: Update a layer in tree by ID
    const updateInTree = (tree: Layer[], targetId: string, updater: (l: Layer) => Layer): Layer[] => {
      return tree.map(node => {
        if (node.id === targetId) {
          return updater(node);
        }
        if (node.children) {
          return { ...node, children: updateInTree(node.children, targetId, updater) };
        }
        return node;
      });
    };

    // Start with current layers
    let newLayers = draft.layers;

    // Check if any of the deleted layers are pagination wrappers
    // If so, disable pagination on the associated collection layers
    for (const id of finalIds) {
      const layer = findLayer(draft.layers, id);
      const paginationFor = layer?.attributes?.['data-pagination-for'];
      if (paginationFor) {
        const collectionLayer = findLayer(draft.layers, paginationFor);
        // Only update if collection variable exists with an id
        if (collectionLayer?.variables?.collection?.id) {
          newLayers = updateInTree(newLayers, paginationFor, (l) => ({
            ...l,
            variables: {
              ...l.variables,
              collection: {
                ...l.variables!.collection!,
                pagination: {
                  mode: 'pages' as const,
                  items_per_page: 10,
                  ...(l.variables?.collection?.pagination || {}),
                  enabled: false,
                },
              },
            },
          }));
        }
      }
    }

    // Helper: Remove multiple IDs from tree
    const removeMultipleFromTree = (tree: Layer[]): Layer[] => {
      return tree
        .filter(node => !finalIds.has(node.id))
        .map(node => {
          if (!node.children) return node;
          return { ...node, children: removeMultipleFromTree(node.children) };
        });
    };

    // Remove the layers
    newLayers = removeMultipleFromTree(newLayers);

    set((state) => ({
      draftsByPageId: {
        ...state.draftsByPageId,
        [pageId]: {
          ...state.draftsByPageId[pageId],
          layers: newLayers
        }
      }
    }));
  },

  updateLayer: (pageId, layerId, updates) => {

    const { draftsByPageId } = get();
    const draft = draftsByPageId[pageId];
    if (! draft) {
      console.warn('⚠️ [usePagesStore] No draft found for page:', pageId);
      return;
    }

    const newLayers = updateLayerInTree(draft.layers, layerId, (layer) => ({
      ...layer,
      ...updates,
    }));

    set({
      draftsByPageId: {
        ...draftsByPageId,
        [pageId]: { ...draft, layers: newLayers }
      }
    });
  },

  moveLayer: (pageId, layerId, targetParentId, targetIndex) => {
    const { draftsByPageId } = get();
    const draft = draftsByPageId[pageId];
    if (! draft) return false;

    // Helper: Find layer by ID in tree
    const findLayer = (layers: Layer[], id: string): Layer | null => {
      for (const layer of layers) {
        if (layer.id === id) return layer;
        if (layer.children) {
          const found = findLayer(layer.children, id);
          if (found) return found;
        }
      }
      return null;
    };

    // Helper: Check if targetId is a descendant of layerId (prevent circular nesting)
    const isDescendant = (parentId: string, childId: string): boolean => {
      const parent = findLayer(draft.layers, parentId);
      if (!parent || !parent.children) return false;

      for (const child of parent.children) {
        if (child.id === childId) return true;
        if (child.children && isDescendant(child.id, childId)) return true;
      }
      return false;
    };

    // Validation: Check ancestor restrictions
    if (!canMoveLayer(draft.layers, layerId, targetParentId)) {
      console.warn('Cannot move layer - ancestor restriction violated');
      return false;
    }

    // Validation: Cannot move into self or descendants (circular reference)
    if (targetParentId === layerId || isDescendant(layerId, targetParentId || '')) {
      console.warn('Cannot create circular reference');
      return false;
    }

    // Validation: Target parent must be able to have children (if not null)
    if (targetParentId) {
      const targetParent = findLayer(draft.layers, targetParentId);
      if (!targetParent || !canHaveChildren(targetParent)) {
        console.warn('Can only drop into layers that can have children');
        return false;
      }
    }

    // Get the layer being moved
    const layerToMove = findLayer(draft.layers, layerId);
    if (!layerToMove) return false;

    // Helper: Remove layer from tree
    const removeLayer = (layers: Layer[]): Layer[] => {
      return layers
        .filter(node => node.id !== layerId)
        .map(node => ({
          ...node,
          children: node.children ? removeLayer(node.children) : undefined,
        }));
    };

    // Helper: Insert layer at specific position
    const insertLayer = (layers: Layer[], parentId: string | null, index: number, layer: Layer): Layer[] => {
      if (parentId === null) {
        // Insert at root level
        const newLayers = [...layers];
        newLayers.splice(index, 0, layer);
        return newLayers;
      }

      // Insert into parent's children
      return layers.map(node => {
        if (node.id === parentId) {
          const children = node.children || [];
          const newChildren = [...children];
          newChildren.splice(index, 0, layer);
          return { ...node, children: newChildren };
        }
        if (node.children) {
          return { ...node, children: insertLayer(node.children, parentId, index, layer) };
        }
        return node;
      });
    };

    // Remove layer from current position
    let newLayers = removeLayer(draft.layers);

    // Insert at new position
    newLayers = insertLayer(newLayers, targetParentId, targetIndex, layerToMove);

    // Reset invalid CMS bindings after move
    newLayers = resetBindingsAfterMove(newLayers, layerId);

    set({
      draftsByPageId: {
        ...draftsByPageId,
        [pageId]: { ...draft, layers: newLayers }
      }
    });

    return true;
  },

  addLayerWithId: (pageId, parentLayerId, layer) => {
    const { pages, draftsByPageId } = get();
    let draft = draftsByPageId[pageId];

    // Initialize draft if it doesn't exist
    if (!draft) {
      const page = pages.find(p => p.id === pageId);
      if (!page) return;

      draft = {
        id: `draft-${pageId}`,
        page_id: pageId,
        layers: [],
        is_published: false,
        created_at: new Date().toISOString(),
        deleted_at: null,
      };
    }

    let newLayers: Layer[];

    if (! parentLayerId) {
      // Add to root
      newLayers = [...draft.layers, layer];
    } else {
      // Add as child to parent
      newLayers = updateLayerInTree(draft.layers, parentLayerId, (parent) => ({
        ...parent,
        children: [...(parent.children || []), layer],
      }));
    }

    set({
      draftsByPageId: {
        ...draftsByPageId,
        [pageId]: { ...draft, layers: newLayers }
      }
    });
  },

  addPage: (page: Page) => {
    const { pages } = get();
    set({ pages: [...pages, page] });
  },

  updatePageLocal: (pageId: string, updates: Partial<Page>) => {
    const { pages } = get();
    const updatedPages = pages.map(page =>
      page.id === pageId ? { ...page, ...updates } : page
    );
    set({ pages: updatedPages });
  },

  removePage: (pageId: string) => {
    const { pages, draftsByPageId } = get();
    const updatedPages = pages.filter(page => page.id !== pageId);
    const { [pageId]: removedDraft, ...remainingDrafts } = draftsByPageId;
    set({
      pages: updatedPages,
      draftsByPageId: remainingDrafts
    });
  },

  setDraftLayers: (pageId, layers) => {

    const { draftsByPageId } = get();
    const draft = draftsByPageId[pageId];
    if (!draft) {
      console.error('❌ SET DRAFT LAYERS: No draft found for page', pageId);
      return;
    }

    set({
      draftsByPageId: {
        ...draftsByPageId,
        [pageId]: { ...draft, layers },
      },
    });

  },

  copyLayer: (pageId, layerId) => {
    const { draftsByPageId } = get();
    const draft = draftsByPageId[pageId];
    if (!draft) return null;

    const layer = findLayerById(draft.layers, layerId);
    if (!layer) return null;

    return cloneDeep(layer);
  },

  duplicateLayer: (pageId, layerId) => {
    const { draftsByPageId, copyLayer } = get();
    const draft = draftsByPageId[pageId];
    if (!draft) return null;

    // Copy the layer
    const layerCopy = copyLayer(pageId, layerId);
    if (!layerCopy) return null;

    // Regenerate IDs and remap self-targeted interactions
    const newLayer = regenerateIdsWithInteractionRemapping(layerCopy);

    // Find parent and index of the original layer
    const findParentAndIndex = (
      layers: Layer[],
      targetId: string,
      parent: Layer | null = null,
      index: number = 0
    ): { parent: Layer | null; index: number } | null => {
      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        if (layer.id === targetId) {
          return { parent, index: i };
        }
        if (layer.children && layer.children.length > 0) {
          const found = findParentAndIndex(layer.children, targetId, layer, i);
          if (found) return found;
        }
      }
      return null;
    };

    const result = findParentAndIndex(draft.layers, layerId);
    if (!result) return null;

    // Insert the duplicate after the original layer
    const insertAfter = (layers: Layer[], parentLayer: Layer | null, insertIndex: number): Layer[] => {
      if (parentLayer === null) {
        // Insert at root level
        const newLayers = [...layers];
        newLayers.splice(insertIndex + 1, 0, newLayer);
        return newLayers;
      }

      // Find and update the parent
      return layers.map(layer => {
        if (layer.id === parentLayer.id) {
          const children = [...(layer.children || [])];
          children.splice(insertIndex + 1, 0, newLayer);
          return { ...layer, children };
        }

        if (layer.children && layer.children.length > 0) {
          return { ...layer, children: insertAfter(layer.children, parentLayer, insertIndex) };
        }

        return layer;
      });
    };

    const newLayers = insertAfter(draft.layers, result.parent, result.index);

    // Use functional update to ensure latest state
    set((state) => ({
      draftsByPageId: {
        ...state.draftsByPageId,
        [pageId]: { ...state.draftsByPageId[pageId], layers: newLayers },
      },
    }));

    return newLayer;
  },

  copyLayers: (pageId, layerIds) => {
    const { copyLayer } = get();
    const layers: Layer[] = [];

    for (const layerId of layerIds) {
      if (layerId === 'body') continue; // Skip body
      const layer = copyLayer(pageId, layerId);
      if (layer) {
        layers.push(layer);
      }
    }

    return layers;
  },

  duplicateLayers: (pageId, layerIds) => {
    const { draftsByPageId, copyLayer } = get();
    const draft = draftsByPageId[pageId];
    if (!draft || layerIds.length === 0) return [];

    const duplicatedLayers: Layer[] = [];

    // Filter out body and locked layers
    const validIds: string[] = [];
    const findLayer = (tree: Layer[], id: string): Layer | null => {
      for (const node of tree) {
        if (node.id === id) return node;
        if (node.children) {
          const found = findLayer(node.children, id);
          if (found) return found;
        }
      }
      return null;
    };

    // Check each layer ID
    for (const layerId of layerIds) {
      if (layerId === 'body') continue; // Skip body
      const layer = findLayer(draft.layers, layerId);
      if (layer && layer.id !== 'body') {
        validIds.push(layerId);
      }
    }

    if (validIds.length === 0) {
      console.warn('No valid layers to duplicate');
      return [];
    }

    // Duplicate each layer
    let newLayers = draft.layers;
    for (const layerId of validIds) {
      const layerCopy = copyLayer(pageId, layerId);
      if (!layerCopy) continue;

      // Regenerate IDs and remap self-targeted interactions
      const newLayer = regenerateIdsWithInteractionRemapping(layerCopy);

      // Find parent and index of the original layer
      const findParentAndIndex = (
        layers: Layer[],
        targetId: string,
        parent: Layer | null = null,
        index: number = 0
      ): { parent: Layer | null; index: number } | null => {
        for (let i = 0; i < layers.length; i++) {
          const layer = layers[i];
          if (layer.id === targetId) {
            return { parent, index: i };
          }
          if (layer.children && layer.children.length > 0) {
            const found = findParentAndIndex(layer.children, targetId, layer, i);
            if (found) return found;
          }
        }
        return null;
      };

      const result = findParentAndIndex(newLayers, layerId);
      if (!result) continue;

      // Insert the duplicate after the original layer
      const insertAfter = (layers: Layer[], parentLayer: Layer | null, insertIndex: number): Layer[] => {
        if (parentLayer === null) {
          // Insert at root level
          const updated = [...layers];
          updated.splice(insertIndex + 1, 0, newLayer);
          return updated;
        }

        // Find and update the parent
        return layers.map(layer => {
          if (layer.id === parentLayer.id) {
            const children = [...(layer.children || [])];
            children.splice(insertIndex + 1, 0, newLayer);
            return { ...layer, children };
          }

          if (layer.children && layer.children.length > 0) {
            return { ...layer, children: insertAfter(layer.children, parentLayer, insertIndex) };
          }

          return layer;
        });
      };

      newLayers = insertAfter(newLayers, result.parent, result.index);
      duplicatedLayers.push(newLayer);
    }

    // Use functional update to ensure latest state
    set((state) => ({
      draftsByPageId: {
        ...state.draftsByPageId,
        [pageId]: { ...state.draftsByPageId[pageId], layers: newLayers },
      },
    }));

    return duplicatedLayers;
  },

  pasteAfter: (pageId, targetLayerId, layerToPaste) => {
    const { draftsByPageId } = get();
    const draft = draftsByPageId[pageId];
    if (!draft) return null;

    // Regenerate IDs and remap self-targeted interactions
    const newLayer = regenerateIdsWithInteractionRemapping(cloneDeep(layerToPaste));

    // Find parent and index of the target layer
    // Must check BOTH children AND items when both exist
    const findParentAndIndex = (
      layers: Layer[],
      targetId: string,
      parent: Layer | null = null,
      propertyName: 'children' | 'items' | null = null
    ): { parent: Layer | null; index: number; propertyName: 'children' | 'items' | null } | null => {
      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];

        if (layer.id === targetId) {
          return { parent, index: i, propertyName };
        }

        // Search only children array
        if (layer.children && layer.children.length > 0) {
          const found = findParentAndIndex(layer.children, targetId, layer, 'children');
          if (found) return found;
        }
      }

      return null;
    };

    const result = findParentAndIndex(draft.layers, targetLayerId);
    if (!result) {
      console.error('❌ TARGET LAYER NOT FOUND:', targetLayerId);
      return null;
    }

    // Don't allow pasting at root level (outside body) — redirect into body
    if (result.parent === null) {
      const bodyLayer = draft.layers.find(l => l.id === 'body' || l.name === 'body');
      if (bodyLayer) {
        const newLayers = draft.layers.map(layer => {
          if (layer.id === bodyLayer.id) {
            return { ...layer, children: [...(layer.children || []), newLayer] };
          }
          return layer;
        });

        const finalLayers = resetBindingsAfterMove(newLayers, newLayer.id);
        set((state) => ({
          draftsByPageId: {
            ...state.draftsByPageId,
            [pageId]: { ...state.draftsByPageId[pageId], layers: finalLayers },
          },
        }));
        return newLayer;
      }
    }

    // Insert after the target layer
    const insertAfter = (
      layers: Layer[],
      parentLayer: Layer | null,
      insertIndex: number,
      targetPropertyName: 'children' | 'items' | null
    ): Layer[] => {
      if (parentLayer === null) {
        // Insert at root level
        const newLayers = [...layers];
        newLayers.splice(insertIndex + 1, 0, newLayer);
        return newLayers;
      }

      // Find and update the parent
      return layers.map(layer => {
        if (layer.id === parentLayer.id) {
          const children = [...(layer.children || [])];
          children.splice(insertIndex + 1, 0, newLayer);
          return { ...layer, children };
        }

        // Recursively search in children
        if (layer.children && layer.children.length > 0) {
          return { ...layer, children: insertAfter(layer.children, parentLayer, insertIndex, targetPropertyName) };
        }

        return layer;
      });
    };

    let newLayers = insertAfter(draft.layers, result.parent, result.index, result.propertyName);

    // Reset invalid CMS bindings on the pasted layer
    newLayers = resetBindingsAfterMove(newLayers, newLayer.id);

    // Use functional update to ensure latest state
    set((state) => ({
      draftsByPageId: {
        ...state.draftsByPageId,
        [pageId]: { ...state.draftsByPageId[pageId], layers: newLayers },
      },
    }));

    return newLayer;
  },

  createPage: async (pageData) => {
    const { pages, folders, draftsByPageId } = get();

    // Generate temporary ID for optimistic update
    const tempId = `temp-page-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const tempPublishKey = `temp-${Date.now()}`;

    // Create temporary page object
    const tempPage: Page = {
      id: tempId,
      ...pageData,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
    };

    // Create temporary draft with Body layer
    const tempDraft: PageLayers = {
      id: `draft-${tempId}`,
      page_id: tempId,
      layers: [{
        id: 'body',
        name: 'body',
        classes: '',
        children: [],
      }],
      is_published: false,
      created_at: new Date().toISOString(),
      deleted_at: null,
    };

    // Check if inserting at specific order (siblings with order >= newOrder means inserting, not appending)
    const newOrder = pageData.order || 0;
    const hasSiblingsAfter = pages.some(p =>
      p.page_folder_id === pageData.page_folder_id &&
      p.depth === pageData.depth &&
      p.order >= newOrder &&
      p.error_page === null && // Exclude error pages
      p.deleted_at === null // Exclude deleted pages
    ) || folders.some(f =>
      f.page_folder_id === pageData.page_folder_id &&
      f.depth === pageData.depth &&
      f.order >= newOrder &&
      f.deleted_at === null // Exclude deleted folders
    );

    // Optimistic update: Increment orders of siblings that come after, then insert new page at correct position
    let updatedPages = pages;
    let updatedFolders = folders;

    if (hasSiblingsAfter) {
      // Increment order for siblings that come after (exclude error pages and deleted items)
      updatedPages = pages.map(p => {
        if (
          p.page_folder_id === pageData.page_folder_id &&
          p.depth === pageData.depth &&
          p.order >= newOrder &&
          p.error_page === null && // Exclude error pages
          p.deleted_at === null // Exclude deleted pages
        ) {
          return { ...p, order: p.order + 1 };
        }
        return p;
      });

      updatedFolders = folders.map(f => {
        if (
          f.page_folder_id === pageData.page_folder_id &&
          f.depth === pageData.depth &&
          f.order >= newOrder &&
          f.deleted_at === null // Exclude deleted folders
        ) {
          return { ...f, order: f.order + 1 };
        }
        return f;
      });
    }

    // Insert new page at correct position: find first page sibling with order > newOrder (after incrementing)
    const siblingPages = updatedPages.filter(p =>
      p.page_folder_id === pageData.page_folder_id &&
      p.depth === pageData.depth &&
      p.error_page === null &&
      p.deleted_at === null
    );

    // Sort sibling pages by order to find insertion point
    const sortedSiblingPages = [...siblingPages].sort((a, b) => (a.order || 0) - (b.order || 0));

    // Find the first page sibling with order > newOrder (this is where we insert before)
    const nextPageSibling = sortedSiblingPages.find(p => (p.order || 0) > newOrder);

    if (nextPageSibling) {
      // Insert before the next page sibling
      const nextPageIndex = updatedPages.findIndex(p => p.id === nextPageSibling.id);
      updatedPages = [
        ...updatedPages.slice(0, nextPageIndex),
        tempPage,
        ...updatedPages.slice(nextPageIndex),
      ];
    } else {
      // No next page sibling - insert after the last page sibling with order <= newOrder
      const lastPageSibling = [...sortedSiblingPages].reverse().find(p => (p.order || 0) <= newOrder);
      if (lastPageSibling) {
        const lastPageIndex = updatedPages.findIndex(p => p.id === lastPageSibling.id);
        updatedPages = [
          ...updatedPages.slice(0, lastPageIndex + 1),
          tempPage,
          ...updatedPages.slice(lastPageIndex + 1),
        ];
      } else {
        // No page siblings in this folder, just append
        updatedPages = [...updatedPages, tempPage];
      }
    }

    // Optimistic update: Add to UI immediately
    set({
      pages: updatedPages,
      folders: updatedFolders,
      draftsByPageId: { ...draftsByPageId, [tempId]: tempDraft },
      isLoading: true,
      error: null
    });

    try {
      // Sanitize pageData for API call: filter out temporary folder IDs
      // Temporary IDs start with "temp-" and can't be inserted as UUIDs
      // Keep original pageData for optimistic update, but use sanitized version for API
      const sanitizedPageData = {
        ...pageData,
        page_folder_id: pageData.page_folder_id && pageData.page_folder_id.startsWith('temp-')
          ? null
          : pageData.page_folder_id,
      };

      const response = await pagesApi.create(sanitizedPageData);

      if (response.error) {
        console.error('[usePagesStore.createPage] Error:', response.error);
        // Rollback: Remove temp page
        set({
          pages: pages, // Original pages without temp
          draftsByPageId: draftsByPageId, // Original drafts without temp
          error: response.error,
          isLoading: false
        });
        return { success: false, error: response.error };
      }

      if (response.data) {
        // Replace temp page with real one from database
        const { pages: currentPages, draftsByPageId: currentDrafts } = get();
        const updatedPages = currentPages.map(p => p.id === tempId ? response.data! : p);

        // Replace temp draft with real one (keeping the same structure but with real ID)
        const updatedDrafts = { ...currentDrafts };
        delete updatedDrafts[tempId];
        updatedDrafts[response.data.id] = {
          ...tempDraft,
          id: `draft-${response.data.id}`,
          page_id: response.data.id,
        };

        set({
          pages: updatedPages,
          draftsByPageId: updatedDrafts,
          isLoading: false
        });

        return { success: true, data: response.data, tempId };
      }

      return { success: false, error: 'No data returned' };
    } catch (error) {
      console.error('[usePagesStore.createPage] Exception:', error);
      const errorMsg = error instanceof Error ? error.message : 'Failed to create page';
      // Rollback: Remove temp page
      set({
        pages: pages,
        draftsByPageId: draftsByPageId,
        error: errorMsg,
        isLoading: false
      });
      return { success: false, error: errorMsg };
    }
  },

  updatePage: async (pageId, updates) => {
    const { pages } = get();

    // Store original state for rollback
    const originalPages = pages;

    // Find the page to update
    const pageToUpdate = pages.find(p => p.id === pageId);
    if (!pageToUpdate) {
      return { success: false, error: 'Page not found' };
    }

    // Optimistic update: Update UI immediately
    let updatedPages = pages.map(p =>
      p.id === pageId ? { ...p, ...updates, updated_at: new Date().toISOString() } : p
    );

    // If setting as index page, optimistically transfer from existing index page
    if (updates.is_index === true && !pageToUpdate.is_index) {
      const targetFolderId = updates.page_folder_id !== undefined ? updates.page_folder_id : pageToUpdate.page_folder_id;

      // Find existing index page in the same folder
      const existingIndexPage = pages.find(p =>
        p.id !== pageId &&
        p.is_index &&
        p.page_folder_id === targetFolderId
      );

      if (existingIndexPage) {
        // Generate slug for the old index page (same logic as backend)
        const generateSlug = (name: string) => {
          const baseSlug = name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
          return baseSlug || `page-${Date.now()}`;
        };

        let newSlug = generateSlug(existingIndexPage.name);

        // Check if slug exists, add timestamp if needed
        const slugExists = pages.some(p =>
          p.id !== existingIndexPage.id &&
          p.slug === newSlug &&
          p.is_published === existingIndexPage.is_published
        );

        if (slugExists) {
          newSlug = `${newSlug}-${Date.now()}`;
        }

        // Update both pages optimistically
        updatedPages = updatedPages.map(p => {
          if (p.id === existingIndexPage.id) {
            return { ...p, is_index: false, slug: newSlug, updated_at: new Date().toISOString() };
          }
          return p;
        });
      }
    }

    set({
      pages: updatedPages,
      isLoading: true,
      error: null
    });

    try {
      const response = await pagesApi.update(pageId, updates);

      if (response.error) {
        console.error('[usePagesStore.updatePage] Error:', response.error);
        // Rollback optimistic update
        set({
          pages: originalPages,
          error: response.error,
          isLoading: false
        });
        return { success: false, error: response.error };
      }

      if (response.data) {
        // If is_index was updated, reload all pages to sync with server
        // (in case slug generation differs from our optimistic version)
        if (updates.is_index !== undefined) {
          await get().loadPages();
        } else {
          // Replace optimistic update with server data
          const { pages: currentPages } = get();
          const finalPages = currentPages.map(p =>
            p.id === pageId ? response.data! : p
          );

          set({
            pages: finalPages,
            isLoading: false
          });
        }

        return { success: true };
      }

      // Rollback if no data returned
      set({
        pages: originalPages,
        isLoading: false
      });
      return { success: false, error: 'No data returned' };
    } catch (error) {
      console.error('[usePagesStore.updatePage] Exception:', error);
      const errorMsg = error instanceof Error ? error.message : 'Failed to update page';
      // Rollback optimistic update
      set({
        pages: originalPages,
        error: errorMsg,
        isLoading: false
      });
      return { success: false, error: errorMsg };
    }
  },

  duplicatePage: async (pageId) => {
    const { pages, folders, draftsByPageId } = get();

    // Find the original page
    const originalPage = pages.find(p => p.id === pageId);
    if (!originalPage) {
      return { success: false, error: 'Page not found' };
    }

    // Dynamic pages cannot be duplicated
    if (originalPage.is_dynamic) {
      return { success: false, error: 'Dynamic pages cannot be duplicated' };
    }

    // Generate temporary ID for optimistic update
    const tempId = `temp-page-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const tempPublishKey = `temp-${Date.now()}`;
    const newOrder = originalPage.order + 1;

    // Create temporary duplicated page
    const tempPage: Page = {
      id: tempId,
      name: `${originalPage.name} (Copy)`,
      slug: `${originalPage.slug}-copy-${Date.now()}`,
      is_published: false,
      page_folder_id: originalPage.page_folder_id,
      order: newOrder, // Place right after original
      depth: originalPage.depth,
      is_index: false,
      is_dynamic: originalPage.is_dynamic,
      error_page: originalPage.error_page,
      settings: originalPage.settings || {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
    };

    // Optimistic update: Increment order for all siblings that come after the original
    // This matches the backend behavior
    // Exclude error pages from order updates
    const updatedPages = pages.map(p => {
      // If it's a sibling (same parent and depth) with order >= newOrder, increment its order
      if (
        p.page_folder_id === originalPage.page_folder_id &&
        p.depth === originalPage.depth &&
        p.order >= newOrder &&
        p.error_page === null // Exclude error pages
      ) {
        return { ...p, order: p.order + 1 };
      }
      return p;
    });

    // Insert the temp page
    const pageIndex = updatedPages.findIndex(p => p.id === pageId);
    updatedPages.splice(pageIndex + 1, 0, tempPage);

    // Also increment order for folders that come after
    const updatedFolders = folders.map(f => {
      // If it's a sibling folder (same parent and depth) with order >= newOrder, increment its order
      if (
        f.page_folder_id === originalPage.page_folder_id &&
        f.depth === originalPage.depth &&
        f.order >= newOrder
      ) {
        return { ...f, order: f.order + 1 };
      }
      return f;
    });

    // Create temporary draft with same layers as original (if exists)
    const originalDraft = draftsByPageId[pageId];
    const tempDraft = originalDraft ? {
      ...originalDraft,
      id: `draft-${tempId}`,
      page_id: tempId,
      is_published: false,
      created_at: new Date().toISOString(),
    } : undefined;

    const updatedDrafts = tempDraft
      ? { ...draftsByPageId, [tempId]: tempDraft }
      : draftsByPageId;

    set({
      pages: updatedPages,
      folders: updatedFolders,
      draftsByPageId: updatedDrafts,
      isLoading: true,
      error: null
    });

    // Store original state for rollback
    const originalPages = pages;
    const originalFolders = folders;
    const originalDrafts = draftsByPageId;

    // Return temp page immediately so it can be selected
    // Also return metadata to find the real page after reload
    const duplicateMetadata = {
      tempId: tempId,
      originalName: originalPage.name,
      parentFolderId: originalPage.page_folder_id,
      expectedName: `${originalPage.name} (Copy)`,
    };

    // Start API call in background (don't await immediately)
    (async () => {
      try {
        const response = await fetch(`/ycode/api/pages/${pageId}/duplicate`, {
          method: 'POST',
        });

        const result = await response.json();

        if (result.error || !result.data) {
          console.error('[usePagesStore.duplicatePage] Error:', result.error);
          // Rollback: Remove temp page and restore original order
          set({
            pages: originalPages,
            folders: originalFolders,
            draftsByPageId: originalDrafts,
            error: result.error,
            isLoading: false
          });
          return;
        }

        // Success! Reload all data from database to get updated order values
        // (The backend increments the order of siblings when duplicating)
        try {
          const [pagesResponse, foldersResponse] = await Promise.all([
            fetch('/ycode/api/pages'),
            fetch('/ycode/api/folders')
          ]);

          const pagesData = await pagesResponse.json();
          const foldersData = await foldersResponse.json();

          if (pagesData.data && foldersData.data) {
            const realPages = pagesData.data as Page[];
            const realFolders = foldersData.data as PageFolder[];

            // Handle draft for the duplicated page
            const { draftsByPageId: currentDrafts } = get();
            const finalDrafts = { ...currentDrafts };

            // If there was a temp draft, replace it with the real one
            if (finalDrafts[tempId]) {
              const tempDraftData = finalDrafts[tempId];
              delete finalDrafts[tempId];
              finalDrafts[result.data.id] = {
                ...tempDraftData,
                id: `draft-${result.data.id}`,
                page_id: result.data.id,
              };
            }

            // Update state with real data from database
            set({
              pages: realPages,
              folders: realFolders,
              draftsByPageId: finalDrafts,
              isLoading: false
            });
          } else {
            // If fetch failed, just turn off loading
            set({ isLoading: false });
          }
        } catch (fetchError) {
          console.error('[usePagesStore.duplicatePage] Failed to reload data:', fetchError);
          set({ isLoading: false });
        }
      } catch (error) {
        console.error('[usePagesStore.duplicatePage] Exception:', error);
        const errorMsg = error instanceof Error ? error.message : 'Failed to duplicate page';
        // Rollback: Remove temp page and restore original order
        set({
          pages: originalPages,
          folders: originalFolders,
          draftsByPageId: originalDrafts,
          error: errorMsg,
          isLoading: false
        });
      }
    })();

    // Return immediately with temp page so UI can select it
    return {
      success: true,
      data: tempPage,
      metadata: duplicateMetadata
    };
  },

  deletePage: async (pageId, currentPageId?: string | null) => {
    const { pages, folders, draftsByPageId } = get();

    // Find the page
    const pageToDelete = pages.find(p => p.id === pageId);
    if (!pageToDelete) {
      return { success: false, error: 'Page not found' };
    }

    // Check if page is the homepage (root index page)
    if (isHomepage(pageToDelete)) {
      console.warn('Cannot delete homepage: root folder must have an index page');
      return { success: false, error: 'The homepage cannot be deleted' };
    }

    const isCurrentPage = currentPageId === pageId;

    // Store original state for rollback
    const originalState = {
      pages,
      folders,
      draftsByPageId,
    };

    // Optimistic update: Remove from UI immediately
    const filteredPages = pages.filter(p => p.id !== pageId);
    const { pages: updatedPages, folders: updatedFolders } = reorderPagesAndFoldersTogether(filteredPages, folders);
    const updatedDrafts = { ...draftsByPageId };
    delete updatedDrafts[pageId];

    // Calculate next page to select optimistically (before API call)
    const nextSelection = findNextSelection(pageId, 'page', updatedPages, updatedFolders);
    // Ensure we select a page, not a folder
    let nextPageId: string | null = null;
    if (nextSelection) {
      const isPage = updatedPages.some(p => p.id === nextSelection && p.error_page === null);
      if (isPage) {
        nextPageId = nextSelection;
      }
    }
    // Fallback: if no sibling page found and current page was deleted, select homepage or first page
    if (!nextPageId && isCurrentPage) {
      const regularPages = updatedPages.filter(p => p.error_page === null);
      if (regularPages.length > 0) {
        const homePage = findHomepage(regularPages);
        nextPageId = (homePage || regularPages[0]).id;
      }
    }

    // Apply optimistic update
    set({
      pages: updatedPages,
      folders: updatedFolders,
      draftsByPageId: updatedDrafts,
      isLoading: true,
      error: null,
    });

    // Temp pages should not be deletable (deletion is disabled in UI)
    // This is a defensive check in case deletion is called programmatically
    const isTempPage = pageId.startsWith('temp-page-');
    if (isTempPage) {
      set({
        ...originalState,
        error: 'Cannot delete a page that is still being created',
        isLoading: false,
      });
      return { success: false, error: 'Cannot delete a page that is still being created' };
    }

    try {
      const response = await pagesApi.delete(pageId);

      if (response.error) {
        console.error('[usePagesStore.deletePage] Error:', response.error);
        set({
          ...originalState,
          error: response.error,
          isLoading: false,
        });
        return { success: false, error: response.error };
      }

      set({ isLoading: false });

      return {
        success: true,
        currentPageDeleted: isCurrentPage,
        nextPageId,
      };
    } catch (error) {
      console.error('[usePagesStore.deletePage] Exception:', error);
      const errorMsg = error instanceof Error ? error.message : 'Failed to delete page';
      set({
        ...originalState,
        error: errorMsg,
        isLoading: false,
      });
      return { success: false, error: errorMsg };
    }
  },

  createFolder: async (folderData) => {
    const { folders, pages } = get();

    // Generate temporary ID for optimistic update
    const tempId = `temp-folder-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Create temporary folder object
    const tempFolder: PageFolder = {
      id: tempId,
      ...folderData,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
    };

    // If inserting at a specific order (not max + 1), increment sibling orders
    // Check if there are siblings with order >= newOrder (means we're inserting, not appending)
    const newOrder = folderData.order || 0;
    const hasSiblingsAfter = pages.some(p =>
      p.page_folder_id === folderData.page_folder_id &&
      p.depth === folderData.depth &&
      p.order >= newOrder &&
      p.error_page === null // Exclude error pages
    ) || folders.some(f =>
      f.page_folder_id === folderData.page_folder_id &&
      f.depth === folderData.depth &&
      f.order >= newOrder
    );

    // Optimistic update: Increment orders of siblings that come after, then add new folder
    let updatedPages = pages;
    let updatedFolders = folders;

    if (hasSiblingsAfter) {
      // Increment order for all siblings (pages and folders) that come after
      // Exclude error pages from order updates
      updatedPages = pages.map(p => {
        if (
          p.page_folder_id === folderData.page_folder_id &&
          p.depth === folderData.depth &&
          p.order >= newOrder &&
          p.error_page === null // Exclude error pages
        ) {
          return { ...p, order: p.order + 1 };
        }
        return p;
      });

      updatedFolders = folders.map(f => {
        if (
          f.page_folder_id === folderData.page_folder_id &&
          f.depth === folderData.depth &&
          f.order >= newOrder
        ) {
          return { ...f, order: f.order + 1 };
        }
        return f;
      });
    }

    // Add new folder to the list
    updatedFolders = [...updatedFolders, tempFolder];

    // Optimistic update: Add to UI immediately
    set({
      folders: updatedFolders,
      pages: updatedPages,
      isLoading: true,
      error: null
    });

    try {
      const response = await foldersApi.create(folderData);

      if (response.error) {
        console.error('[usePagesStore.createFolder] Error:', response.error);
        // Rollback: Remove temp folder
        set({
          folders: folders, // Original folders without temp
          error: response.error,
          isLoading: false
        });
        return { success: false, error: response.error };
      }

      if (response.data) {
        // Replace temp folder with real one from database
        const { folders: currentFolders, pages: currentPages } = get();
        const updatedFolders = currentFolders.map(f => f.id === tempId ? response.data! : f);

        // Update any pages and folders that were created with the temp folder ID
        // Find pages and folders that reference the temp folder ID and update them to use the real folder ID
        const pagesToUpdate = currentPages.filter(p => p.page_folder_id === tempId);
        const foldersToUpdate = currentFolders.filter(f => f.page_folder_id === tempId && f.id !== response.data!.id);

        if (pagesToUpdate.length > 0 || foldersToUpdate.length > 0) {
          // Update pages optimistically
          const updatedPages = currentPages.map(p =>
            p.page_folder_id === tempId ? { ...p, page_folder_id: response.data!.id } : p
          );

          // Update folders optimistically
          const updatedFoldersWithChildren = updatedFolders.map(f =>
            f.page_folder_id === tempId && f.id !== response.data!.id
              ? { ...f, page_folder_id: response.data!.id }
              : f
          );

          // Update pages and folders in database
          const updatePromises = [
            ...pagesToUpdate.map(page =>
              pagesApi.update(page.id, { page_folder_id: response.data!.id })
            ),
            ...foldersToUpdate.map(folder =>
              foldersApi.update(folder.id, { page_folder_id: response.data!.id })
            ),
          ];

          // Don't await - let it happen in background
          Promise.all(updatePromises).catch(error => {
            console.error('[usePagesStore.createFolder] Error updating children with new folder ID:', error);
          });

          set({
            folders: updatedFoldersWithChildren,
            pages: updatedPages,
            isLoading: false
          });
        } else {
          set({
            folders: updatedFolders,
            isLoading: false
          });
        }

        return { success: true, data: response.data, tempId };
      }

      return { success: false, error: 'No data returned' };
    } catch (error) {
      console.error('[usePagesStore.createFolder] Exception:', error);
      const errorMsg = error instanceof Error ? error.message : 'Failed to create folder';
      // Rollback: Remove temp folder
      set({
        folders: folders,
        error: errorMsg,
        isLoading: false
      });
      return { success: false, error: errorMsg };
    }
  },

  updateFolder: async (folderId, updates) => {
    const { folders } = get();

    // Store original state for rollback
    const originalFolders = folders;

    // Find the folder to update
    const folderToUpdate = folders.find(f => f.id === folderId);
    if (!folderToUpdate) {
      return { success: false, error: 'Folder not found' };
    }

    // Optimistic update: Update UI immediately
    const updatedFolders = folders.map(f =>
      f.id === folderId ? { ...f, ...updates, updated_at: new Date().toISOString() } : f
    );

    set({
      folders: updatedFolders,
      isLoading: true,
      error: null
    });

    try {
      const response = await foldersApi.update(folderId, updates);

      if (response.error) {
        console.error('[usePagesStore.updateFolder] Error:', response.error);
        // Rollback optimistic update
        set({
          folders: originalFolders,
          error: response.error,
          isLoading: false
        });
        return { success: false, error: response.error };
      }

      if (response.data) {
        // Replace optimistic update with server data
        const { folders: currentFolders } = get();
        const finalFolders = currentFolders.map(f =>
          f.id === folderId ? response.data! : f
        );

        set({
          folders: finalFolders,
          isLoading: false
        });

        return { success: true };
      }

      // Rollback if no data returned
      set({
        folders: originalFolders,
        isLoading: false
      });
      return { success: false, error: 'No data returned' };
    } catch (error) {
      console.error('[usePagesStore.updateFolder] Exception:', error);
      const errorMsg = error instanceof Error ? error.message : 'Failed to update folder';
      // Rollback optimistic update
      set({
        folders: originalFolders,
        error: errorMsg,
        isLoading: false
      });
      return { success: false, error: errorMsg };
    }
  },

  duplicateFolder: async (folderId) => {
    const { folders, pages, draftsByPageId } = get();

    // Find the original folder
    const originalFolder = folders.find(f => f.id === folderId);
    if (!originalFolder) {
      return { success: false, error: 'Folder not found' };
    }

    // Store original state for rollback
    const originalFolders = folders;
    const originalPages = pages;
    const originalDrafts = draftsByPageId;

    // Build optimistic duplicates for the entire hierarchy
    const timestamp = Date.now();
    const tempIdMap = new Map<string, string>(); // Map original ID to temp ID
    const tempFolders: PageFolder[] = [];
    const tempPages: Page[] = [];
    const tempDrafts: Record<string, PageLayers> = {};

    // Helper to generate temp IDs
    const generateTempId = (type: 'folder' | 'page', index: number) => {
      return `temp-${type}-${timestamp}-${index}-${Math.random().toString(36).substr(2, 9)}`;
    };

    // Recursive function to duplicate folder hierarchy optimistically
    const duplicateFolderHierarchy = (
      currentFolderId: string,
      newParentId: string | null,
      folderCounter: { count: number },
      pageCounter: { count: number }
    ) => {
      // Get all child folders
      const childFolders = folders.filter(f => f.page_folder_id === currentFolderId);

      // Get all child pages
      const childPages = pages.filter(p => p.page_folder_id === currentFolderId);

      // Duplicate child folders
      childFolders.forEach(folder => {
        const tempFolderId = generateTempId('folder', folderCounter.count++);
        tempIdMap.set(folder.id, tempFolderId);

        // Generate unique timestamp for each folder (matching backend pattern)
        const folderTimestamp = Date.now() + Math.random();
        const folderSlug = `folder-${Math.floor(folderTimestamp)}`;

        const tempFolder: PageFolder = {
          ...folder,
          id: tempFolderId,
          page_folder_id: newParentId,
          slug: folderSlug,
          is_published: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        tempFolders.push(tempFolder);

        // Recursively duplicate this folder's contents
        duplicateFolderHierarchy(folder.id, tempFolderId, folderCounter, pageCounter);
      });

      // Duplicate child pages
      childPages.forEach(page => {
        const tempPageId = generateTempId('page', pageCounter.count++);
        tempIdMap.set(page.id, tempPageId);

        // Generate unique timestamp for each page (matching backend pattern)
        const pageTimestamp = Date.now() + Math.random();
        const pageSlug = page.is_index ? '' : `page-${Math.floor(pageTimestamp)}`;

        const tempPage: Page = {
          ...page,
          id: tempPageId,
          page_folder_id: newParentId,
          slug: pageSlug,
          is_published: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        tempPages.push(tempPage);

        // Duplicate draft if exists
        const originalDraft = draftsByPageId[page.id];
        if (originalDraft) {
          tempDrafts[tempPageId] = {
            ...originalDraft,
            id: `draft-${tempPageId}`,
            page_id: tempPageId,
            is_published: false,
            created_at: new Date().toISOString(),
          };
        }
      });
    };

    // Create the root duplicate folder
    const rootTempId = generateTempId('folder', 0);
    const rootTempFolder: PageFolder = {
      ...originalFolder,
      id: rootTempId,
      name: `${originalFolder.name} (Copy)`,
      slug: `folder-${timestamp}`, // Match backend pattern
      is_published: false,
      order: originalFolder.order + 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    tempIdMap.set(folderId, rootTempId);
    tempFolders.push(rootTempFolder);

    // Recursively build all child duplicates
    duplicateFolderHierarchy(folderId, rootTempId, { count: 1 }, { count: 0 });

    // Insert root folder right after the original
    const folderIndex = folders.findIndex(f => f.id === folderId);
    const updatedFolders = [...folders];
    updatedFolders.splice(folderIndex + 1, 0, ...tempFolders);

    // Add all temp pages
    const updatedPages = [...pages, ...tempPages];

    // Merge drafts
    const updatedDrafts = { ...draftsByPageId, ...tempDrafts };

    // Optimistic update: Show all duplicates immediately
    set({
      folders: updatedFolders,
      pages: updatedPages,
      draftsByPageId: updatedDrafts,
      isLoading: true,
      error: null
    });

    // Return temp folder immediately so it can be selected
    // Also return metadata to find the real folder after reload
    const duplicateMetadata = {
      tempId: rootTempId,
      originalName: originalFolder.name,
      parentFolderId: originalFolder.page_folder_id,
      expectedName: `${originalFolder.name} (Copy)`,
    };

    // Start API call in background (don't await immediately)
    (async () => {
      try {
        const response = await fetch(`/ycode/api/folders/${folderId}/duplicate`, {
          method: 'POST',
        });

        const result = await response.json();

        if (result.error || !result.data) {
          console.error('[usePagesStore.duplicateFolder] Error:', result.error);
          // Rollback: Restore original state
          set({
            folders: originalFolders,
            pages: originalPages,
            draftsByPageId: originalDrafts,
            error: result.error,
            isLoading: false
          });
          return;
        }

        // Success! Now fetch fresh data and replace ALL temp items with real ones
        // Since we can't reliably match by slug (backend generates different timestamps),
        // we'll just replace all temp items with all new real items
        try {
          // Fetch fresh data from database
          const [pagesResponse, foldersResponse] = await Promise.all([
            fetch('/ycode/api/pages'),
            fetch('/ycode/api/folders')
          ]);

          const pagesData = await pagesResponse.json();
          const foldersData = await foldersResponse.json();

          if (pagesData.data && foldersData.data) {
            const realPages = pagesData.data as Page[];
            const realFolders = foldersData.data as PageFolder[];

            // Update state with real data from database
            set({
              pages: realPages,
              folders: realFolders,
              isLoading: false
            });
          } else {
            // If fetch failed, just turn off loading
            set({ isLoading: false });
          }
        } catch (error) {
          console.error('[usePagesStore.duplicateFolder] Failed to fetch real data:', error);
          // Keep temp items if fetch fails
          set({ isLoading: false });
        }
      } catch (error) {
        console.error('[usePagesStore.duplicateFolder] Exception:', error);
        const errorMsg = error instanceof Error ? error.message : 'Failed to duplicate folder';
        // Rollback: Restore original state
        set({
          folders: originalFolders,
          pages: originalPages,
          draftsByPageId: originalDrafts,
          error: errorMsg,
          isLoading: false
        });
      }
    })();

    // Return immediately with temp folder so UI can select it
    return {
      success: true,
      data: rootTempFolder,
      metadata: duplicateMetadata
    };
  },

  deleteFolder: async (folderId, currentPageId?: string | null) => {
    const { folders, pages, draftsByPageId } = get();

    // Find the folder
    const folderToDelete = folders.find(f => f.id === folderId);
    if (!folderToDelete) {
      return { success: false, error: 'Folder not found' };
    }

    // Store original state for rollback
    const originalFolders = folders;
    const originalPages = pages;
    const originalDrafts = draftsByPageId;

    // Temp folders should not be deletable (deletion is disabled in UI)
    // This is a defensive check in case deletion is called programmatically
    const isTempFolder = folderId.startsWith('temp-folder-');
    if (isTempFolder) {
      return { success: false, error: 'Cannot delete a folder that is still being created' };
    }

    // Get all descendant folder IDs using the utility function
    const descendantFolderIds = getDescendantFolderIds(folderId, folders);
    const allFolderIds = [folderId, ...descendantFolderIds];

    // Check if current page is affected
    const currentPage = currentPageId ? pages.find(p => p.id === currentPageId) : null;
    const isCurrentPageAffected = !!(currentPage && currentPage.page_folder_id && allFolderIds.includes(currentPage.page_folder_id));

    // Calculate what will be deleted
    const filteredFolders = folders.filter(f => !allFolderIds.includes(f.id));
    const deletedPageIds = pages.filter(p => p.page_folder_id && allFolderIds.includes(p.page_folder_id)).map(p => p.id);
    const filteredPages = pages.filter(p => !p.page_folder_id || !allFolderIds.includes(p.page_folder_id));

    // Reorder pages and folders together to eliminate gaps in the order sequence
    const { pages: updatedPages, folders: updatedFolders } = reorderPagesAndFoldersTogether(filteredPages, filteredFolders);

    // Remove drafts for deleted pages
    const updatedDrafts = { ...draftsByPageId };
    deletedPageIds.forEach(pageId => {
      delete updatedDrafts[pageId];
    });

    // Optimistic update: Remove from UI immediately
    set({
      folders: updatedFolders,
      pages: updatedPages,
      draftsByPageId: updatedDrafts,
      isLoading: true,
      error: null
    });

    try {
      // Delete from API
      const response = await foldersApi.delete(folderId);

      if (response.error) {
        console.error('[usePagesStore.deleteFolder] Error:', response.error);
        // Rollback optimistic update
        set({
          folders: originalFolders,
          pages: originalPages,
          draftsByPageId: originalDrafts,
          error: response.error,
          isLoading: false
        });
        return { success: false, error: response.error };
      }

      set({ isLoading: false });

      // Determine next page to select if current was affected
      // Filter out error pages - they should not be selected
      const regularPages = updatedPages.filter(p => p.error_page === null);
      let nextPageId: string | null = null;
      if (isCurrentPageAffected && regularPages.length > 0) {
        const homePage = findHomepage(regularPages);
        nextPageId = (homePage || regularPages[0]).id;
      }

      return {
        success: true,
        currentPageAffected: isCurrentPageAffected,
        nextPageId,
        deletedPageIds,
      };
    } catch (error) {
      console.error('[usePagesStore.deleteFolder] Exception:', error);
      const errorMsg = error instanceof Error ? error.message : 'Failed to delete folder';
      // Rollback optimistic update
      set({
        folders: originalFolders,
        pages: originalPages,
        draftsByPageId: originalDrafts,
        error: errorMsg,
        isLoading: false
      });
      return { success: false, error: errorMsg };
    }
  },

  batchReorderPagesAndFolders: async (updatedPages, updatedFolders) => {
    const { pages, folders } = get();

    // Store original state for rollback
    const originalPages = pages;
    const originalFolders = folders;

    // Filter out error pages from reordering operations
    const regularPagesOnly = updatedPages.filter(page => page.error_page === null);

    try {
      // Optimistically update the UI (only update regular pages, keep error pages as-is)
      const errorPages = pages.filter(p => p.error_page !== null);
      const mergedPages = [...regularPagesOnly, ...errorPages];

      set({
        pages: mergedPages,
        folders: updatedFolders,
        isLoading: true,
      });

      // Batch update pages (only regular pages)
      const pageUpdatePromises = regularPagesOnly.map(async (page) => {
        const originalPage = originalPages.find(p => p.id === page.id);
        if (!originalPage) return;

        // Only update if something changed
        if (
          originalPage.page_folder_id !== page.page_folder_id ||
          originalPage.order !== page.order ||
          originalPage.depth !== page.depth
        ) {
          await pagesApi.update(page.id, {
            page_folder_id: page.page_folder_id,
            order: page.order,
            depth: page.depth,
          });
        }
      });

      // Batch update folders
      const folderUpdatePromises = updatedFolders.map(async (folder) => {
        const originalFolder = originalFolders.find(f => f.id === folder.id);
        if (!originalFolder) return;

        // Only update if something changed
        if (
          originalFolder.page_folder_id !== folder.page_folder_id ||
          originalFolder.order !== folder.order ||
          originalFolder.depth !== folder.depth
        ) {
          await foldersApi.update(folder.id, {
            page_folder_id: folder.page_folder_id,
            order: folder.order,
            depth: folder.depth,
          });
        }
      });

      // Wait for all updates to complete
      await Promise.all([...pageUpdatePromises, ...folderUpdatePromises]);

      set({ isLoading: false });

      return { success: true };
    } catch (error) {
      console.error('[usePagesStore.batchReorderPagesAndFolders] Exception:', error);
      const errorMsg = error instanceof Error ? error.message : 'Failed to reorder items';

      // Rollback optimistic update
      set({
        pages: originalPages,
        folders: originalFolders,
        error: errorMsg,
        isLoading: false,
      });

      return { success: false, error: errorMsg };
    }
  },

  pasteInside: (pageId, targetLayerId, layerToPaste) => {
    const { draftsByPageId } = get();
    const draft = draftsByPageId[pageId];
    if (!draft) return null;

    // Regenerate IDs and remap self-targeted interactions
    const newLayer = regenerateIdsWithInteractionRemapping(cloneDeep(layerToPaste));

    // Insert as last child of target layer
    const insertInside = (layers: Layer[]): Layer[] => {
      return layers.map(layer => {
        if (layer.id === targetLayerId) {
          const updated = { ...layer, children: [...(layer.children || []), newLayer] };
          return updated;
        }

        // Recursively search in children
        if (layer.children && layer.children.length > 0) {
          return { ...layer, children: insertInside(layer.children) };
        }

        return layer;
      });
    };

    let newLayers = insertInside(draft.layers);

    // Reset invalid CMS bindings on the pasted layer
    newLayers = resetBindingsAfterMove(newLayers, newLayer.id);

    // Use functional update to ensure latest state
    set((state) => ({
      draftsByPageId: {
        ...state.draftsByPageId,
        [pageId]: { ...state.draftsByPageId[pageId], layers: newLayers },
      },
    }));

    return newLayer;
  },

  /**
   * Update all layers using a specific style across all pages
   * Used when a style is updated
   * Updates the classes/design on layers that have the style applied
   */
  updateStyleOnLayers: (styleId, newClasses, newDesign) => {
    const { draftsByPageId } = get();

    const updatedDrafts = { ...draftsByPageId };

    Object.keys(updatedDrafts).forEach(pageId => {
      const draft = updatedDrafts[pageId];
      updatedDrafts[pageId] = {
        ...draft,
        layers: updateLayersWithStyle(draft.layers, styleId, newClasses, newDesign),
      };
    });

    set({ draftsByPageId: updatedDrafts });
  },

  /**
   * Detach a style from all layers across all pages
   * Used when a style is deleted
   * Keeps current classes/design values but removes the style link
   */
  detachStyleFromAllLayers: (styleId) => {
    const { draftsByPageId } = get();

    const updatedDrafts = { ...draftsByPageId };

    Object.keys(updatedDrafts).forEach(pageId => {
      const draft = updatedDrafts[pageId];
      updatedDrafts[pageId] = {
        ...draft,
        layers: detachStyleFromLayers(draft.layers, styleId),
      };
    });

    set({ draftsByPageId: updatedDrafts });
  },

  /**
   * Create a component from a layer
   * Extracts the layer tree and creates a component
   * Then replaces the original layer with a component instance
   *
   * IMPORTANT: componentId is preserved in nested layers to support nested components
   */
  createComponentFromLayer: async (pageId, layerId, componentName) => {
    const { draftsByPageId, copyLayer } = get();
    const draft = draftsByPageId[pageId];
    if (!draft) return null;

    const layerToCopy = copyLayer(pageId, layerId);
    if (!layerToCopy) return null;

    const newComponent = await createComponentViaApi(componentName, [layerToCopy]);
    if (!newComponent) return null;

    // Add to components store
    const { useComponentsStore } = await import('./useComponentsStore');
    const componentsState = useComponentsStore.getState();
    componentsState.setComponents([newComponent, ...componentsState.components]);

    // Replace layer with component instance
    const newLayers = replaceLayerWithComponentInstance(draft.layers, layerId, newComponent.id);

    set({
      draftsByPageId: {
        ...draftsByPageId,
        [pageId]: { ...draft, layers: newLayers },
      },
    });

    // Generate thumbnail in the background (fire-and-forget)
    triggerThumbnailGeneration(newComponent.id, newComponent.layers, componentsState.components);

    return newComponent.id;
  },

  /**
   * Update all layers using a specific component across all pages
   * Used when a component is updated
   */
  updateComponentOnLayers: (componentId, newLayers) => {
    const { draftsByPageId } = get();

    const updatedDrafts = { ...draftsByPageId };

    Object.keys(updatedDrafts).forEach(pageId => {
      const draft = updatedDrafts[pageId];
      updatedDrafts[pageId] = {
        ...draft,
        layers: updateLayersWithComponent(draft.layers, componentId, newLayers),
      };
    });

    set({ draftsByPageId: updatedDrafts });
  },

  /**
   * Detach a component from all layers across all pages
   * Used when a component is deleted
   * Replaces component instances with the component's actual children layers
   */
  detachComponentFromAllLayers: (componentId) => {
    const { draftsByPageId } = get();
    const { getComponentById } = useComponentsStore.getState();

    // Get the component data to extract its layers
    const component = getComponentById(componentId);

    const updatedDrafts = { ...draftsByPageId };

    Object.keys(updatedDrafts).forEach(pageId => {
      const draft = updatedDrafts[pageId];
      updatedDrafts[pageId] = {
        ...draft,
        layers: detachComponentFromLayers(draft.layers, componentId, component || undefined),
      };
    });

    set({ draftsByPageId: updatedDrafts });
  },

  /**
   * Reset CMS bindings referencing a deleted collection across all page drafts.
   * Clears collection sources and field variables that reference the collection.
   */
  cleanupDeletedCollection: (collectionId) => {
    const { draftsByPageId } = get();
    const updatedDrafts = { ...draftsByPageId };

    Object.keys(updatedDrafts).forEach(pageId => {
      const draft = updatedDrafts[pageId];
      const cleaned = resetBindingsForDeletedCollection(draft.layers, collectionId);
      if (cleaned !== draft.layers) {
        updatedDrafts[pageId] = { ...draft, layers: cleaned };
      }
    });

    set({ draftsByPageId: updatedDrafts });
  },

  /**
   * Reset CMS bindings referencing a deleted field across all page drafts.
   * Clears field variables, inline variables, and design bindings that use the field.
   */
  cleanupDeletedField: (fieldId) => {
    const { draftsByPageId } = get();
    const updatedDrafts = { ...draftsByPageId };

    Object.keys(updatedDrafts).forEach(pageId => {
      const draft = updatedDrafts[pageId];
      const cleaned = resetBindingsForDeletedField(draft.layers, fieldId);
      if (cleaned !== draft.layers) {
        updatedDrafts[pageId] = { ...draft, layers: cleaned };
      }
    });

    set({ draftsByPageId: updatedDrafts });
  },

  updatePageCollectionItem: (pageId, updatedItem) => {
    set((state) => {
      const draft = state.draftsByPageId[pageId];
      if (!draft) return state;

      return {
        draftsByPageId: {
          ...state.draftsByPageId,
          [pageId]: {
            ...draft,
            collectionItem: updatedItem,
          },
        },
      };
    });
  },

  refetchPageCollectionItem: async (pageId) => {
    const state = get();
    const page = state.pages.find(p => p.id === pageId);

    if (!page?.is_dynamic || !page.settings?.cms?.collection_id) {
      return;
    }

    // Get the current collection item from the draft
    const draft = state.draftsByPageId[pageId];
    const currentItem = (draft as any)?.collectionItem as CollectionItemWithValues | undefined;

    if (!currentItem) {
      return; // No item to refetch
    }

    try {
      // Fetch fresh collection item data
      const response = await fetch(`/ycode/api/pages/${pageId}/collection-item?itemId=${currentItem.id}`);
      const result = await response.json();

      if (result.data) {
        state.updatePageCollectionItem(pageId, result.data);
      }
    } catch (error) {
      console.error('[usePagesStore.refetchPageCollectionItem] Error:', error);
    }
  },
}));
