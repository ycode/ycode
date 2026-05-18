'use client';

import { create } from 'zustand';
import { EditorState, UIState } from '../types';
import type { Layer, Breakpoint, Asset, AssetCategoryFilter } from '../types';
import { useCanvasTextEditorStore } from './useCanvasTextEditorStore';
import { usePagesStore } from './usePagesStore';
import { updateUrlQueryParam } from '@/hooks/use-editor-url';

// Debounce window for the `?layer=…` URL mirror. Long enough to coalesce
// rapid clicks (which would otherwise each trigger a Router-wide re-render
// through Next.js's patched `history.replaceState`), short enough that the
// URL is up-to-date by the time anyone copies it.
const LAYER_URL_DEBOUNCE_MS = 250;
let pendingLayerUrlTimer: ReturnType<typeof setTimeout> | null = null;
let pendingLayerUrlValue: string | null = null;

function scheduleLayerUrlUpdate(id: string | null): void {
  pendingLayerUrlValue = id;
  if (pendingLayerUrlTimer !== null) return;
  pendingLayerUrlTimer = setTimeout(() => {
    pendingLayerUrlTimer = null;
    updateUrlQueryParam('layer', pendingLayerUrlValue);
  }, LAYER_URL_DEBOUNCE_MS);
}
interface HistoryEntry {
  pageId: string;
  layers: Layer[];
  timestamp: number;
}

/**
 * Navigation stack entry for component editing breadcrumb
 */
export interface ComponentNavigationEntry {
  type: 'page' | 'component';
  id: string; // pageId or componentId
  name: string; // Display name for breadcrumb
  layerId?: string | null; // Layer to restore when returning
  variantId?: string | null; // Variant to restore when returning to a component
}

export type EditorSidebarTab = 'layers' | 'pages' | 'cms';

export type CanvasDropPosition = 'above' | 'below' | 'inside';

export interface CanvasDropTarget {
  layerId: string;
  position: CanvasDropPosition;
  parentId: string | null;
  /** Display name of the target layer for "Add in [Name]" label */
  targetDisplayName?: string;
}

export interface CanvasSiblingDropTarget {
  layerId: string;
  position: 'above' | 'below';
  /** Projected index where the dragged element would be inserted */
  projectedIndex: number;
}

export interface DragPosition {
  x: number;
  y: number;
}

interface EditorActions {
  setSelectedLayerId: (id: string | null) => void;
  setSelectedLayerIds: (ids: string[]) => void;
  addToSelection: (id: string) => void;
  toggleSelection: (id: string) => void;
  selectRange: (fromId: string, toId: string, flattenedLayers: any[]) => void;
  clearSelection: () => void;
  setCurrentPageId: (id: string | null) => void;
  setCurrentPageCollectionItemId: (id: string | null) => void;
  setLoading: (value: boolean) => void;
  setSaving: (value: boolean) => void;
  setActiveBreakpoint: (breakpoint: Breakpoint) => void;
  setActiveUIState: (state: UIState) => void;
  setActiveTextStyleKey: (key: string | null) => void;
  setEditingComponentId: (id: string | null, returnPageId?: string | null, returnToLayerId?: string | null) => void;
  setEditingComponentVariantId: (id: string | null) => void;
  pushComponentNavigation: (entry: ComponentNavigationEntry) => void;
  getReturnDestination: () => ComponentNavigationEntry | null;
  setBuilderDataPreloaded: (preloaded: boolean) => void;
  pushHistory: (pageId: string, layers: Layer[]) => void;
  undo: () => HistoryEntry | null;
  redo: () => HistoryEntry | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  setInteractionHighlights: (triggerIds: string[], targetIds: string[]) => void;
  setActiveInteraction: (triggerId: string | null, targetIds: string[]) => void;
  clearActiveInteraction: () => void;
  openCollectionItemSheet: (collectionId: string, itemId: string) => void;
  closeCollectionItemSheet: () => void;
  setHoveredLayerId: (id: string | null) => void;
  renamingLayerId: string | null;
  setRenamingLayerId: (id: string | null) => void;
  setPreviewMode: (enabled: boolean) => void;
  setActiveSidebarTab: (tab: EditorSidebarTab) => void;
  setLastDesignUrl: (url: string | null) => void;
  setPreviewReturn: (url: string | null, tab?: EditorSidebarTab | null) => void;
  openFileManager: (onSelect?: ((asset: Asset) => void | false) | null, assetId?: string | null, category?: AssetCategoryFilter) => void;
  closeFileManager: () => void;
  setKeyboardShortcutsOpen: (open: boolean) => void;
  openCreateComponentDialog: (layerId: string, defaultName: string) => void;
  closeCreateComponentDialog: () => void;
  // Canvas drag-and-drop actions (pointer-based)
  startCanvasDrag: (elementType: string, source: 'elements' | 'layouts' | 'components', elementName: string, initialPosition: DragPosition) => void;
  updateDragPosition: (position: DragPosition) => void;
  updateCanvasDropTarget: (target: CanvasDropTarget | null) => void;
  endCanvasDrag: () => void;
  // Canvas sibling reorder actions
  startCanvasLayerDrag: (layerId: string, layerName: string, parentId: string | null, originalIndex: number, siblingIds: string[], startPosition: { x: number; y: number }) => void;
  updateCanvasSiblingDropTarget: (target: CanvasSiblingDropTarget | null) => void;
  endCanvasLayerDrag: () => void;
  /** Open a RichTextEditorSheet for the given layer (triggered from iframe on double-click) */
  openRichTextSheet: (layerId: string) => void;
  closeRichTextSheet: () => void;
  setActiveSublayerIndex: (index: number | null) => void;
  setActiveListItemIndex: (index: number | null) => void;
  selectLayerWithSublayer: (layerId: string, sublayer: { textStyleKey: string | null; sublayerIndex: number | null; listItemIndex: number | null }) => void;
  // Element picker actions
  startElementPicker: (onSelect: (layerId: string) => void, validate?: (layerId: string) => boolean, originPosition?: { x: number; y: number }) => void;
  stopElementPicker: () => void;
}

interface EditorStoreWithHistory extends EditorState {
  history: HistoryEntry[];
  historyIndex: number;
  maxHistorySize: number;
  editingComponentId: string | null;
  // Currently selected variant id while editing a component. `null` means
  // "use the first variant" (also the default for components with a single
  // variant). Cleared whenever `editingComponentId` is cleared.
  editingComponentVariantId: string | null;
  returnToPageId: string | null;
  returnToLayerId: string | null; // Layer to restore when exiting component edit mode
  componentNavigationStack: ComponentNavigationEntry[]; // Breadcrumb stack for nested component editing
  currentPageCollectionItemId: string | null;
  builderDataPreloaded: boolean;
  interactionTriggerLayerIds: string[];
  interactionTargetLayerIds: string[];
  activeInteractionTriggerLayerId: string | null;
  activeInteractionTargetLayerIds: string[];
  activeTextStyleKey: string | null; // Currently active text style (e.g., 'bold', 'italic')
  collectionItemSheet: {
    open: boolean;
    collectionId: string;
    itemId: string;
  } | null;
  hoveredLayerId: string | null;
  isPreviewMode: boolean;
  activeSidebarTab: EditorSidebarTab;
  /** Last visited design route URL for restoring navigation */
  lastDesignUrl: string | null;
  /** URL and sidebar tab to return to when exiting preview from a non-design route */
  previewReturnUrl: string | null;
  previewReturnTab: EditorSidebarTab | null;
  fileManager: {
    open: boolean;
    onSelect: ((asset: Asset) => void | false) | null;
    assetId: string | null;
    category: AssetCategoryFilter;
  };
  keyboardShortcutsOpen: boolean;
  createComponentDialog: {
    open: boolean;
    layerId: string | null;
    defaultName: string;
  };
  // Canvas drag-and-drop state (pointer-based)
  isDraggingToCanvas: boolean;
  dragElementType: string | null;
  dragElementName: string | null;
  dragElementSource: 'elements' | 'layouts' | 'components' | null;
  dragPosition: DragPosition | null;
  canvasDropTarget: CanvasDropTarget | null;
  // Slider transition state (hides outlines during slide animation)
  isSliderAnimating: boolean;
  setSliderAnimating: (value: boolean) => void;
  // Sidebar resize state (hides outlines during resize drag)
  isSidebarResizing: boolean;
  setSidebarResizing: (value: boolean) => void;
  leftSidebarWidth: number;
  setLeftSidebarWidth: (value: number) => void;
  // Canvas context menu state (hides overlay while menu is open)
  isCanvasContextMenuOpen: boolean;
  setCanvasContextMenuOpen: (value: boolean) => void;
  // Swiper-calculated snap page counts per slider (used for bullet replication)
  sliderSnapCounts: Record<string, number>;
  setSliderSnapCount: (sliderId: string, count: number) => void;
  // Canvas sibling reorder state
  isDraggingLayerOnCanvas: boolean;
  draggedLayerId: string | null;
  draggedLayerName: string | null;
  draggedLayerParentId: string | null;
  draggedLayerOriginalIndex: number | null;
  siblingLayerIds: string[];
  canvasSiblingDropTarget: CanvasSiblingDropTarget | null;
  layerDragStartPosition: { x: number; y: number } | null;
  /** Layer ID whose content should be opened in a RichTextEditorSheet (set from iframe on double-click) */
  richTextSheetLayerId: string | null;
  /** Index of the selected sublayer within a richText element (null = no sublayer selected) */
  activeSublayerIndex: number | null;
  /** Index of the selected list item within its parent list (null = no list item selected) */
  activeListItemIndex: number | null;
  // Element picker state (for linking filter inputs to collection conditions)
  elementPicker: {
    active: boolean;
    onSelect: ((layerId: string) => void) | null;
    validate?: ((layerId: string) => boolean) | null;
    originPosition?: { x: number; y: number } | null;
  } | null;
  // Computed getters
  showTextStyleControls: () => boolean;
}

type EditorStore = EditorStoreWithHistory & EditorActions;

export const useEditorStore = create<EditorStore>((set, get) => ({
  selectedLayerId: null,
  selectedLayerIds: [],
  lastSelectedLayerId: null,
  currentPageId: null,
  isDragging: false,
  isLoading: false,
  isSaving: false,
  activeBreakpoint: 'desktop' as Breakpoint,
  activeUIState: 'neutral' as UIState,
  history: [],
  historyIndex: -1,
  maxHistorySize: 50,
  editingComponentId: null,
  editingComponentVariantId: null,
  returnToPageId: null,
  returnToLayerId: null,
  componentNavigationStack: [],
  currentPageCollectionItemId: null,
  builderDataPreloaded: false,
  interactionTriggerLayerIds: [],
  interactionTargetLayerIds: [],
  activeInteractionTriggerLayerId: null,
  activeInteractionTargetLayerIds: [],
  activeTextStyleKey: null,
  collectionItemSheet: null,
  hoveredLayerId: null,
  renamingLayerId: null,
  isPreviewMode: false,
  activeSidebarTab: 'layers' as EditorSidebarTab,
  lastDesignUrl: null,
  previewReturnUrl: null,
  previewReturnTab: null,
  fileManager: {
    open: false,
    onSelect: null,
    assetId: null,
    category: null,
  },
  keyboardShortcutsOpen: false,
  createComponentDialog: {
    open: false,
    layerId: null,
    defaultName: '',
  },
  // Canvas drag-and-drop initial state (pointer-based)
  isDraggingToCanvas: false,
  dragElementType: null,
  dragElementName: null,
  dragElementSource: null,
  dragPosition: null,
  canvasDropTarget: null,
  isSliderAnimating: false,
  setSliderAnimating: (value) => set({ isSliderAnimating: value }),
  isSidebarResizing: false,
  setSidebarResizing: (value) => set({ isSidebarResizing: value }),
  leftSidebarWidth: 256,
  setLeftSidebarWidth: (value) => set({ leftSidebarWidth: value }),
  isCanvasContextMenuOpen: false,
  setCanvasContextMenuOpen: (value) => set({ isCanvasContextMenuOpen: value }),
  sliderSnapCounts: {},
  setSliderSnapCount: (sliderId, count) => set((state) => {
    // Swiper fires `update` on every DOM mutation inside its wrapper, which
    // happens constantly in the iframe (Tailwind class injections, child
    // re-renders). Bail out when the count hasn't changed so subscribers
    // — notably slideBullets `LayerItem`s — don't re-render.
    if (state.sliderSnapCounts[sliderId] === count) return state;
    return { sliderSnapCounts: { ...state.sliderSnapCounts, [sliderId]: count } };
  }),
  // Canvas sibling reorder initial state
  isDraggingLayerOnCanvas: false,
  draggedLayerId: null,
  draggedLayerName: null,
  draggedLayerParentId: null,
  draggedLayerOriginalIndex: null,
  siblingLayerIds: [],
  canvasSiblingDropTarget: null,
  layerDragStartPosition: null,
  richTextSheetLayerId: null,
  activeSublayerIndex: null,
  activeListItemIndex: null,
  // Element picker initial state
  elementPicker: null,

  // Computed getter: Returns true when text style controls should be shown
  // This happens when:
  // 1. Canvas text editing is active, OR
  // 2. A text style is selected from the dropdown (e.g., bold, italic, custom style)
  showTextStyleControls: () => {
    const state = get();
    const isCanvasTextEditing = useCanvasTextEditorStore.getState().isEditing;
    return isCanvasTextEditing || !!state.activeTextStyleKey;
  },

  setSelectedLayerId: (id) => {
    set({
      selectedLayerId: id,
      selectedLayerIds: id ? [id] : [],
      lastSelectedLayerId: id,
      activeTextStyleKey: null,
      activeSublayerIndex: null,
      activeListItemIndex: null,
    });

    if (typeof window !== 'undefined') {
      const pathname = window.location.pathname;
      const isLayerRoute = /^\/ycode\/(layers|pages|components)\//.test(pathname);

      if (isLayerRoute) {
        // Debounce the URL update: Next.js's App Router patches
        // history.replaceState, so every direct call triggers a Router-wide
        // re-render (`useSearchParams` consumers, etc.). Coalescing rapid
        // selections keeps the `?layer=…` deep link accurate without paying
        // the cascade cost on every click.
        scheduleLayerUrlUpdate(id || null);
      }
    }
  },

  setSelectedLayerIds: (ids) => {
    // Update both for compatibility
    set({
      selectedLayerIds: ids,
      selectedLayerId: ids.length === 1 ? ids[0] : (ids.length > 0 ? ids[ids.length - 1] : null),
      lastSelectedLayerId: ids.length > 0 ? ids[ids.length - 1] : null
    });
  },

  addToSelection: (id) => {
    const { selectedLayerIds } = get();
    if (!selectedLayerIds.includes(id)) {
      const newIds = [...selectedLayerIds, id];
      set({
        selectedLayerIds: newIds,
        selectedLayerId: newIds.length === 1 ? newIds[0] : id,
        lastSelectedLayerId: id
      });
    }
  },

  toggleSelection: (id) => {
    const { selectedLayerIds } = get();
    let newIds: string[];

    if (selectedLayerIds.includes(id)) {
      // Remove from selection
      newIds = selectedLayerIds.filter(layerId => layerId !== id);
    } else {
      // Add to selection
      newIds = [...selectedLayerIds, id];
    }

    set({
      selectedLayerIds: newIds,
      selectedLayerId: newIds.length === 1 ? newIds[0] : (newIds.length > 0 ? newIds[newIds.length - 1] : null),
      lastSelectedLayerId: newIds.length > 0 ? id : null
    });
  },

  selectRange: (fromId, toId, flattenedLayers) => {
    // Find indices in flattened array
    const fromIndex = flattenedLayers.findIndex((node: any) => node.id === fromId);
    const toIndex = flattenedLayers.findIndex((node: any) => node.id === toId);

    if (fromIndex === -1 || toIndex === -1) return;

    // Get range (handle both directions)
    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);

    const rangeIds = flattenedLayers
      .slice(start, end + 1)
      .map((node: any) => node.id)
      .filter((id: string) => id !== 'body'); // Exclude body layer

    set({
      selectedLayerIds: rangeIds,
      selectedLayerId: rangeIds.length === 1 ? rangeIds[0] : toId,
      lastSelectedLayerId: toId
    });
  },

  clearSelection: () => {
    set({
      selectedLayerIds: [],
      selectedLayerId: null,
      lastSelectedLayerId: null
    });
  },

  setCurrentPageId: (id) => set({
    currentPageId: id,
    activeUIState: 'neutral', // Reset to neutral on page change
    currentPageCollectionItemId: null // Clear selected item when page changes
  }),
  setCurrentPageCollectionItemId: (id) => set({ currentPageCollectionItemId: id }),
  setLoading: (value) => set({ isLoading: value }),
  setSaving: (value) => set({ isSaving: value }),
  setActiveBreakpoint: (breakpoint) => set({ activeBreakpoint: breakpoint }),
  setActiveUIState: (state) => set({ activeUIState: state }),
  setActiveTextStyleKey: (key) => set({ activeTextStyleKey: key }),
  setEditingComponentId: (id, returnPageId = null, returnToLayerId = undefined) => {
    const state = get();

    // When entering component edit mode:
    // - If returnToLayerId is explicitly provided, use it
    // - Otherwise, use the current selected layer
    // When exiting (id === null), keep the stored returnToLayerId so exit handler can use it
    let layerToReturn: string | null;
    if (id !== null) {
      // Entering component mode
      if (returnToLayerId !== undefined) {
        // Explicitly provided
        layerToReturn = returnToLayerId;
      } else {
        // Fallback to current selection
        layerToReturn = state.selectedLayerId;
      }
    } else {
      // Exiting component mode - keep the stored value
      layerToReturn = state.returnToLayerId;
    }

    // Manage navigation stack for nested component editing
    // Note: Stack is pushed explicitly by callers (RightSidebar, LayerContextMenu) with proper names
    // This function only pops when exiting
    const newStack = [...state.componentNavigationStack];

    if (id === null) {
      // Exiting component mode - pop from stack
      newStack.pop();
    }

    set({
      editingComponentId: id,
      // Clear the active variant when leaving component edit mode; callers
      // entering edit mode are expected to set the variant explicitly
      // (`use-edit-component` does this once the draft has loaded).
      editingComponentVariantId: id === null ? null : get().editingComponentVariantId,
      returnToPageId: returnPageId,
      returnToLayerId: layerToReturn,
      componentNavigationStack: newStack,
    });
  },
  setEditingComponentVariantId: (id: string | null) => set({ editingComponentVariantId: id }),
  setBuilderDataPreloaded: (preloaded) => set({ builderDataPreloaded: preloaded }),

  /**
   * Push an entry to the component navigation stack (for breadcrumb)
   */
  pushComponentNavigation: (entry: ComponentNavigationEntry) => {
    const state = get();
    set({
      componentNavigationStack: [...state.componentNavigationStack, entry],
    });
  },

  /**
   * Get the return destination (top of stack) without popping
   */
  getReturnDestination: () => {
    const state = get();
    const stack = state.componentNavigationStack;
    return stack.length > 0 ? stack[stack.length - 1] : null;
  },

  pushHistory: (pageId, layers) => {
    const { history, historyIndex, maxHistorySize } = get();

    // Remove any entries after current index (if we're in the middle of history)
    const newHistory = history.slice(0, historyIndex + 1);

    // Add new entry
    newHistory.push({
      pageId,
      layers: JSON.parse(JSON.stringify(layers)), // Deep clone
      timestamp: Date.now(),
    });

    // Limit history size
    if (newHistory.length > maxHistorySize) {
      newHistory.shift();
    } else {
      set({ historyIndex: historyIndex + 1 });
    }

    set({ history: newHistory });
  },

  undo: () => {
    const { history, historyIndex } = get();
    if (historyIndex > 0) {
      set({ historyIndex: historyIndex - 1 });
      return history[historyIndex - 1];
    }
    return null;
  },

  redo: () => {
    const { history, historyIndex } = get();
    if (historyIndex < history.length - 1) {
      set({ historyIndex: historyIndex + 1 });
      return history[historyIndex + 1];
    }
    return null;
  },

  canUndo: () => {
    const { historyIndex } = get();
    return historyIndex > 0;
  },

  canRedo: () => {
    const { history, historyIndex } = get();
    return historyIndex < history.length - 1;
  },

  setInteractionHighlights: (triggerIds, targetIds) => set({
    interactionTriggerLayerIds: triggerIds,
    interactionTargetLayerIds: targetIds,
  }),

  setActiveInteraction: (triggerId, targetIds) => set({
    activeInteractionTriggerLayerId: triggerId,
    activeInteractionTargetLayerIds: targetIds,
  }),

  clearActiveInteraction: () => set({
    activeInteractionTriggerLayerId: null,
    activeInteractionTargetLayerIds: [],
  }),

  openCollectionItemSheet: (collectionId, itemId) => set({
    collectionItemSheet: {
      open: true,
      collectionId,
      itemId,
    },
  }),

  closeCollectionItemSheet: () => set({
    collectionItemSheet: null,
  }),

  setHoveredLayerId: (id) => set({ hoveredLayerId: id }),
  setRenamingLayerId: (id) => set({ renamingLayerId: id }),

  setPreviewMode: (enabled) => {
    set({ isPreviewMode: enabled });
    // Reset preview user when exiting preview mode
    if (!enabled) {
      usePagesStore.getState().setPreviewUserId(null);
      // Clear simulation cookie
      if (typeof document !== 'undefined') {
        document.cookie = 'ycode_preview_user_id=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
      }
    }
  },

  setActiveSidebarTab: (tab) => set({ activeSidebarTab: tab }),
  setLastDesignUrl: (url) => set({ lastDesignUrl: url }),
  setPreviewReturn: (url, tab) => set({ previewReturnUrl: url, previewReturnTab: tab ?? null }),

  openFileManager: (onSelect, assetId, category) => set({
    fileManager: {
      open: true,
      onSelect: onSelect ?? null,
      assetId: assetId ?? null,
      category: category ?? null,
    },
  }),

  closeFileManager: () => set({
    fileManager: {
      open: false,
      onSelect: null,
      assetId: null,
      category: null,
    },
  }),

  setKeyboardShortcutsOpen: (open) => set({ keyboardShortcutsOpen: open }),

  openCreateComponentDialog: (layerId, defaultName) => set({
    createComponentDialog: {
      open: true,
      layerId,
      defaultName,
    },
  }),

  closeCreateComponentDialog: () => set({
    createComponentDialog: {
      open: false,
      layerId: null,
      defaultName: '',
    },
  }),

  // Canvas drag-and-drop actions (pointer-based)
  startCanvasDrag: (elementType, source, elementName, initialPosition) => set({
    isDraggingToCanvas: true,
    dragElementType: elementType,
    dragElementName: elementName,
    dragElementSource: source,
    dragPosition: initialPosition,
    canvasDropTarget: null,
  }),

  updateDragPosition: (position) => set({
    dragPosition: position,
  }),

  updateCanvasDropTarget: (target) => set({
    canvasDropTarget: target,
  }),

  endCanvasDrag: () => set({
    isDraggingToCanvas: false,
    dragElementType: null,
    dragElementName: null,
    dragElementSource: null,
    dragPosition: null,
    canvasDropTarget: null,
  }),

  // Canvas sibling reorder actions
  startCanvasLayerDrag: (layerId, layerName, parentId, originalIndex, siblingIds, startPosition) => set({
    isDraggingLayerOnCanvas: true,
    draggedLayerId: layerId,
    draggedLayerName: layerName,
    draggedLayerParentId: parentId,
    draggedLayerOriginalIndex: originalIndex,
    siblingLayerIds: siblingIds,
    canvasSiblingDropTarget: null,
    layerDragStartPosition: startPosition,
  }),

  updateCanvasSiblingDropTarget: (target) => set({
    canvasSiblingDropTarget: target,
  }),

  endCanvasLayerDrag: () => set({
    isDraggingLayerOnCanvas: false,
    draggedLayerId: null,
    draggedLayerName: null,
    draggedLayerParentId: null,
    draggedLayerOriginalIndex: null,
    siblingLayerIds: [],
    canvasSiblingDropTarget: null,
    layerDragStartPosition: null,
  }),

  openRichTextSheet: (layerId) => set({ richTextSheetLayerId: layerId }),
  closeRichTextSheet: () => set({ richTextSheetLayerId: null }),
  setActiveSublayerIndex: (index) => set({ activeSublayerIndex: index }),
  setActiveListItemIndex: (index) => set({ activeListItemIndex: index }),

  selectLayerWithSublayer: (layerId, sublayer) => {
    set({
      selectedLayerId: layerId,
      selectedLayerIds: [layerId],
      lastSelectedLayerId: layerId,
      activeTextStyleKey: sublayer.textStyleKey,
      activeSublayerIndex: sublayer.sublayerIndex,
      activeListItemIndex: sublayer.listItemIndex,
    });

    if (typeof window !== 'undefined') {
      const pathname = window.location.pathname;
      const isLayerRoute = /^\/ycode\/(layers|pages|components)\//.test(pathname);
      if (isLayerRoute) {
        updateUrlQueryParam('layer', layerId);
      }
    }
  },

  // Element picker actions
  startElementPicker: (onSelect, validate, originPosition) => set({
    elementPicker: {
      active: true,
      onSelect,
      validate: validate ?? null,
      originPosition: originPosition ?? null,
    },
  }),

  stopElementPicker: () => set({
    elementPicker: null,
  }),
}));
