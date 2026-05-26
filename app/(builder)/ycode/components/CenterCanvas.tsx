'use client';

/**
 * Center Canvas - Preview Area with Canvas
 *
 * Shows live preview of the website being built.
 *
 * - Editor mode: Uses Canvas (React) with iframe for style isolation
 * - Preview mode: Uses iframe loading the actual SSR-rendered page
 *
 * @see ./Canvas.tsx for the editor canvas implementation
 */

// 1. React/Next.js
import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';

// 2. External libraries
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';

// 3. ShadCN UI
import Icon from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';

// 4. Hooks
import { useEditorUrl } from '@/hooks/use-editor-url';
import { useEditComponent } from '@/hooks/use-edit-component';
import { useZoom } from '@/hooks/use-zoom';
import { useUndoRedo } from '@/hooks/use-undo-redo';

// 5. Stores
import { useEditorStore } from '@/stores/useEditorStore';
import { usePagesStore } from '@/stores/usePagesStore';
import { useComponentsStore } from '@/stores/useComponentsStore';
import { useCollectionsStore } from '@/stores/useCollectionsStore';
import { useCollectionLayerStore } from '@/stores/useCollectionLayerStore';
import { useCurrentUserStore } from '@/stores/useCurrentUserStore';
import { useLocalisationStore } from '@/stores/useLocalisationStore';
import { useAssetsStore } from '@/stores/useAssetsStore';
import { useCanvasTextEditorStore } from '@/stores/useCanvasTextEditorStore';

// 4b. Internal components
import Canvas from './Canvas';
import { CollectionFieldSelector } from './CollectionFieldSelector';
import SelectionOverlay from '@/components/SelectionOverlay';
import RichTextLinkPopover from './RichTextLinkPopover';
import PageSelector from './PageSelector';
import CollectionItemSelector from './CollectionItemSelector';
import RichTextEditorSheet from './RichTextEditorSheet';

// 6. Utils
import { buildLocalizedSlugPath, buildLocalizedDynamicPageUrl } from '@/lib/page-utils';
import { getTranslationValue, applyCmsTranslations, extractLayerTranslatableItemsShallow } from '@/lib/localisation-utils';
import { cn } from '@/lib/utils';
import { getCollectionVariable, canDeleteLayer, findLayerById, findParentCollectionLayer, canLayerHaveLink, updateLayerProps, removeRichTextSublayer, isRichTextLayer, getLayerCmsFieldBinding } from '@/lib/layer-utils';
import { CANVAS_BORDER, CANVAS_PADDING, updateViewportOverrides } from '@/lib/canvas-utils';
import { BREAKPOINTS } from '@/lib/breakpoint-utils';
import { buildFieldGroupsForLayer, flattenFieldGroups, filterFieldGroupsByType, SIMPLE_TEXT_FIELD_TYPES } from '@/lib/collection-field-utils';
import { buildFieldVariableData } from '@/lib/variable-format-utils';
import { getRichTextValue } from '@/lib/tiptap-utils';
import { DropContainerIndicator, DropLineIndicator } from '@/components/DropIndicators';
import { DragCaptureOverlay } from '@/components/DragCaptureOverlay';
import ElementPickerOverlay from './ElementPickerOverlay';
import { setDragCursor, clearDragCursor } from '@/lib/drag-cursor';

// 7. Types
import type { Layer, Page, CollectionField, Asset } from '@/types';
import {
  DropdownMenu,
  DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

type ViewportMode = 'desktop' | 'tablet' | 'mobile';

import type { UseLiveLayerUpdatesReturn } from '@/hooks/use-live-layer-updates';
import type { UseLiveComponentUpdatesReturn } from '@/hooks/use-live-component-updates';
import { useCanvasDropDetection } from '@/hooks/use-canvas-drop-detection';
import { useCanvasSiblingReorder } from '@/hooks/use-canvas-sibling-reorder';

interface CenterCanvasProps {
  currentPageId: string | null;
  viewportMode: ViewportMode;
  setViewportMode: (mode: ViewportMode) => void;
  onLayerSelect?: (layerId: string) => void;
  onLayerDeselect?: () => void;
  onExitComponentEditMode?: () => void;
  liveLayerUpdates?: UseLiveLayerUpdatesReturn | null;
  liveComponentUpdates?: UseLiveComponentUpdatesReturn | null;
}

// Viewport widths are derived from BREAKPOINTS to avoid sitting on exact
// breakpoint boundaries where CSS zoom sub-pixel rounding can toggle styles.
const MOBILE_MAX_WIDTH = BREAKPOINTS.find(bp => bp.value === 'mobile')!.maxWidth!;

const viewportSizes: Record<ViewportMode, { width: string; label: string; icon: string }> = {
  desktop: { width: '1366px', label: 'Desktop', icon: '🖥️' },
  tablet: { width: `${MOBILE_MAX_WIDTH + 10}px`, label: 'Tablet', icon: '📱' },
  mobile: { width: '375px', label: 'Mobile', icon: '📱' },
};

interface ViewportZoomControlsProps {
  viewportMode: ViewportMode;
  zoom: number;
  onViewportChange: (mode: ViewportMode) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onZoomToFit: () => void;
  onAutofit: () => void;
}

/** Shared viewport toggle + zoom dropdown used in both the canvas and preview toolbars. */
function ViewportZoomControls({
  viewportMode,
  zoom,
  onViewportChange,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onZoomToFit,
  onAutofit,
}: ViewportZoomControlsProps) {
  return (
    <div className="flex justify-center gap-2">
      <Tabs value={viewportMode} onValueChange={(v) => onViewportChange(v as ViewportMode)}>
        <TabsList className="w-50">
          <TabsTrigger value="desktop" title="Desktop View">Desktop</TabsTrigger>
          <TabsTrigger value="tablet" title="Tablet View">Tablet</TabsTrigger>
          <TabsTrigger value="mobile" title="Mobile View">Phone</TabsTrigger>
        </TabsList>
      </Tabs>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="input"
            size="sm"
            className="w-18"
          >
            <span className="flex-1 text-center">{Math.round(zoom)}%</span>
            <Icon name="chevronDown" className="size-2.5! opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          side="bottom"
          sideOffset={4}
          avoidCollisions={false}
          collisionPadding={0}
          className="max-h-75! w-38"
        >
          <DropdownMenuItem onClick={onZoomIn}>
            Zoom in
            <DropdownMenuShortcut>⌘+</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onZoomOut}>
            Zoom out
            <DropdownMenuShortcut>⌘-</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onResetZoom}>
            Zoom to 100%
            <DropdownMenuShortcut>⌘0</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onZoomToFit}>
            Fit height
            <DropdownMenuShortcut>⌘1</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onAutofit}>
            Fit width
            <DropdownMenuShortcut>⌘2</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// Component editing canvas sizing
const COMPONENT_CANVAS_PADDING = 0;

// Import the drop target type from the store
import type { CanvasDropTarget } from '@/stores/useEditorStore';

/**
 * Canvas Drop Indicator Overlay
 *
 * Subscribes to store directly to avoid re-rendering the parent CenterCanvas component.
 * Renders drop indicators inside the scaled canvas div during drag-and-drop.
 */
interface CanvasDropIndicatorOverlayProps {
  iframeElement: HTMLIFrameElement | null;
}

function CanvasDropIndicatorOverlay({
  iframeElement,
}: CanvasDropIndicatorOverlayProps) {
  // Subscribe to store directly - only this component re-renders on changes
  const isDraggingToCanvas = useEditorStore((state) => state.isDraggingToCanvas);
  const dropTarget = useEditorStore((state) => state.canvasDropTarget);

  if (!isDraggingToCanvas || !dropTarget || !iframeElement) return null;

  // Use display name from drop target (already computed during hit-testing)
  const displayName = dropTarget.targetDisplayName || '';

  // Find element in iframe and calculate position
  const iframeDoc = iframeElement.contentDocument;
  if (!iframeDoc) return null;

  const targetElement = iframeDoc.querySelector(`[data-layer-id="${dropTarget.layerId}"]`) as HTMLElement;
  if (!targetElement) return null;

  // Get element rect in iframe's internal coordinate system
  const elementRect = targetElement.getBoundingClientRect();

  const top = elementRect.top;
  const left = elementRect.left;
  const width = elementRect.width;
  const height = elementRect.height;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-visible z-50">
      <div
        style={{
          position: 'absolute',
          // Use transform for GPU-accelerated positioning
          transform: `translate(${left}px, ${top}px)`,
          width: `${width}px`,
          height: `${height}px`,
          // Hint to browser for GPU layer promotion
          willChange: 'transform',
          // Ensure it's on its own compositing layer
          contain: 'layout style',
        }}
      >
        {dropTarget.position === 'inside' ? (
          <DropContainerIndicator
            label={`Add in ${displayName}`}
            variant="dashed"
          />
        ) : (
          <DropLineIndicator position={dropTarget.position} />
        )}
      </div>
    </div>
  );
}

/**
 * Canvas Sibling Reorder Effect
 *
 * Applies CSS transforms to siblings in the iframe during drag to show
 * a real-time preview of the reordered layout. Also makes the dragged
 * element semi-transparent.
 *
 * This is implemented as an effect-only component (no visible render)
 * because we're manipulating iframe DOM directly for performance.
 */
interface CanvasSiblingReorderOverlayProps {
  iframeElement: HTMLIFrameElement | null;
}

function CanvasSiblingReorderOverlay({
  iframeElement,
}: CanvasSiblingReorderOverlayProps) {
  // Subscribe to store for drag state
  const isDragging = useEditorStore((state) => state.isDraggingLayerOnCanvas);
  const draggedId = useEditorStore((state) => state.draggedLayerId);
  const parentId = useEditorStore((state) => state.draggedLayerParentId);
  const originalIndex = useEditorStore((state) => state.draggedLayerOriginalIndex);
  const siblingIds = useEditorStore((state) => state.siblingLayerIds);
  const dropTarget = useEditorStore((state) => state.canvasSiblingDropTarget);

  const projectedIndex = dropTarget?.projectedIndex ?? null;

  // State for visual indicator positions
  const [parentRect, setParentRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [dropLineY, setDropLineY] = useState<number | null>(null);
  const [dropzoneHeight, setDropzoneHeight] = useState<number>(0);
  const [dropzoneWidth, setDropzoneWidth] = useState<number>(0);
  const [dropzoneLeft, setDropzoneLeft] = useState<number>(0);

  // Cache element references and heights to avoid repeated DOM queries
  const cachedDataRef = useRef<{
    elements: Map<string, HTMLElement>;
    heights: Map<string, number>;
    tops: Map<string, number>;
    draggedHeight: number;
    draggedWidth: number;
    draggedLeft: number;
    parentElement: HTMLElement | null;
  } | null>(null);

  // Track previous projected index to avoid unnecessary updates
  const prevProjectedIndexRef = useRef<number | null>(null);

  // Store siblingIds in a ref for cleanup (since store clears them before cleanup runs)
  const siblingIdsRef = useRef<string[]>([]);

  // Change cursor to "grabbing" when dragging
  useEffect(() => {
    if (!isDragging) return;

    const iframeDoc = iframeElement?.contentDocument;
    // Pass both iframe document and iframe element for comprehensive cursor setting
    setDragCursor(iframeDoc, iframeElement);

    return () => {
      clearDragCursor(iframeDoc);
    };
  }, [isDragging, iframeElement]);

  // Cache elements and heights when drag starts
  useEffect(() => {
    if (!iframeElement) return;

    const iframeDoc = iframeElement.contentDocument;
    if (!iframeDoc) return;

    if (isDragging && draggedId && siblingIds.length > 0) {
      // Store siblingIds in ref for cleanup (before store clears them)
      siblingIdsRef.current = [...siblingIds];

      // Build cache on drag start
      const elements = new Map<string, HTMLElement>();
      const heights = new Map<string, number>();
      const tops = new Map<string, number>();
      let draggedHeight = 0;
      let draggedWidth = 0;
      let draggedLeft = 0;

      siblingIds.forEach(id => {
        const el = iframeDoc.querySelector(`[data-layer-id="${id}"]`) as HTMLElement;
        if (el) {
          elements.set(id, el);
          const rect = el.getBoundingClientRect();
          heights.set(id, rect.height);
          tops.set(id, rect.top);
          if (id === draggedId) {
            draggedHeight = rect.height;
            draggedWidth = rect.width;
            draggedLeft = rect.left;
          }
        }
      });

      // Find and cache parent element
      let parentElement: HTMLElement | null = null;
      if (parentId) {
        parentElement = iframeDoc.querySelector(`[data-layer-id="${parentId}"]`) as HTMLElement;
      }

      cachedDataRef.current = { elements, heights, tops, draggedHeight, draggedWidth, draggedLeft, parentElement };
      prevProjectedIndexRef.current = null;

      // Set dropzone dimensions to match dragged element
      setDropzoneHeight(draggedHeight);
      setDropzoneWidth(draggedWidth);
      setDropzoneLeft(draggedLeft);

      // Set initial parent rect
      if (parentElement) {
        const rect = parentElement.getBoundingClientRect();
        setParentRect({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
      }
    } else {
      // Clear cache and visual state when drag ends
      cachedDataRef.current = null;
      prevProjectedIndexRef.current = null;
      setParentRect(null);
      setDropLineY(null);
      setDropzoneHeight(0);
      setDropzoneWidth(0);
      setDropzoneLeft(0);
    }
  }, [iframeElement, isDragging, draggedId, parentId, siblingIds]);

  // Update dropzone box position and shift siblings when projectedIndex changes
  useEffect(() => {
    const cache = cachedDataRef.current;
    if (!cache || !isDragging || originalIndex === null) {
      return;
    }

    // For free-drag behavior: if projectedIndex is null during active drag,
    // keep the last valid projected index (preserve visual state)
    if (projectedIndex === null && prevProjectedIndexRef.current !== null) {
      // Still dragging but cursor moved outside valid positions - keep current visual state
      return;
    }

    const currentProjectedIndex = projectedIndex ?? originalIndex;

    // Skip if projected index hasn't changed
    if (currentProjectedIndex === prevProjectedIndexRef.current) {
      return;
    }

    // Check if this is the FIRST positioning (no previous index)
    // On first positioning, skip transition to avoid "jump" animation
    const isFirstPositioning = prevProjectedIndexRef.current === null;
    prevProjectedIndexRef.current = currentProjectedIndex;

    const { elements, heights, tops, draggedHeight } = cache;

    // Calculate dropzone Y position (where the blue box should appear)
    // The dropzone ALWAYS shows - at original position when first dragging,
    // then moves as you drag to different positions
    let lineY: number | null = null;

    if (currentProjectedIndex === originalIndex) {
      // Dropzone at original position (element "picked up", its spot is available)
      const draggedId = siblingIds[originalIndex];
      const draggedTop = tops.get(draggedId);
      if (draggedTop !== undefined) {
        lineY = draggedTop;
      }
    } else {
      const isDraggingDown = currentProjectedIndex > originalIndex;

      if (isDraggingDown) {
        // When dragging down, elements have shifted UP
        // The dropzone appears after the last shifted-up element
        if (currentProjectedIndex < siblingIds.length) {
          const targetId = siblingIds[currentProjectedIndex];
          const targetTop = tops.get(targetId);
          const targetHeight = heights.get(targetId);
          if (targetTop !== undefined && targetHeight !== undefined) {
            // Position at bottom of the target element, minus its shift
            lineY = targetTop + targetHeight - draggedHeight;
          }
        } else {
          // Dropping at the end
          const lastId = siblingIds[siblingIds.length - 1];
          const lastTop = tops.get(lastId);
          const lastHeight = heights.get(lastId);
          if (lastTop !== undefined && lastHeight !== undefined) {
            lineY = lastTop + lastHeight - draggedHeight;
          }
        }
      } else {
        // When dragging up, dropzone appears at the target position
        if (currentProjectedIndex < siblingIds.length) {
          const targetId = siblingIds[currentProjectedIndex];
          const targetTop = tops.get(targetId);
          if (targetTop !== undefined) {
            lineY = targetTop;
          }
        }
      }
    }
    setDropLineY(lineY);

    // Apply transforms to shift siblings and make space for dropzone
    siblingIds.forEach((layerId, index) => {
      const el = elements.get(layerId);
      if (!el) return;

      // The dragged element itself - hide it completely
      // Its position becomes the dropzone (element is "picked up")
      if (layerId === draggedId) {
        el.style.opacity = '0';
        // Only animate opacity after first frame to avoid initial "pop"
        el.style.transition = isFirstPositioning ? 'none' : 'opacity 100ms ease-out';
        return;
      }

      // Calculate shift amount based on direction of movement
      let shiftAmount = 0;

      if (currentProjectedIndex !== originalIndex) {
        const isDraggingDown = currentProjectedIndex > originalIndex;

        if (isDraggingDown) {
          // Dragging DOWN: elements between original and projected shift UP to fill gap
          // Elements at projected and after shift DOWN for dropzone (dropzone height = dragged element height)
          if (index > originalIndex && index <= currentProjectedIndex) {
            // These elements shift UP to fill the gap left by dragged element
            shiftAmount = -draggedHeight;
          }
          if (index > currentProjectedIndex) {
            // These elements shift DOWN for the dropzone
            // Since dropzone height = draggedHeight, net shift is 0
            shiftAmount = 0;
          }
        } else {
          // Dragging UP: elements between projected and original shift DOWN
          if (index >= currentProjectedIndex && index < originalIndex) {
            // These elements shift DOWN to make room for dropzone (dropzone height = dragged element height)
            shiftAmount = draggedHeight;
          }
        }
      }

      // Only animate after first frame to avoid initial "jump"
      el.style.transition = isFirstPositioning ? 'none' : 'transform 150ms ease-out';
      el.style.willChange = 'transform';
      el.style.transform = shiftAmount !== 0 ? `translate3d(0, ${shiftAmount}px, 0)` : '';
    });
  }, [isDragging, draggedId, originalIndex, siblingIds, projectedIndex]);

  // Cleanup effect - reset styles when drag ends with smooth animation
  // Uses siblingIdsRef because store clears siblingIds before this effect runs
  useEffect(() => {
    if (!iframeElement) return;

    const iframeDoc = iframeElement.contentDocument;
    if (!iframeDoc) return;

    // Only clean up when drag ends - use ref since store already cleared siblingIds
    if (!isDragging && siblingIdsRef.current.length > 0) {
      // Remove transforms INSTANTLY (no transition) to prevent "jump" on drop
      // The DOM reorder changes element positions, so animating transforms causes glitches
      siblingIdsRef.current.forEach(id => {
        const el = iframeDoc.querySelector(`[data-layer-id="${id}"]`) as HTMLElement;
        if (el) {
          el.style.transition = 'none';
          el.style.opacity = '1';
          el.style.transform = '';
          el.style.willChange = '';
        }
      });

      // Clear the ref after cleanup
      siblingIdsRef.current = [];
    }
  }, [iframeElement, isDragging]);

  // Don't render anything if not dragging
  if (!isDragging || !parentRect) return null;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-visible z-50">
      {/* Blue dropzone box - shows where element will be inserted */}
      {dropLineY !== null && dropzoneHeight > 0 && dropzoneWidth > 0 && (
        <div
          className="animate-in fade-in duration-100"
          style={{
            position: 'absolute',
            transform: `translate(${dropzoneLeft}px, ${dropLineY}px)`,
            width: `${dropzoneWidth}px`,
            height: `${dropzoneHeight}px`,
            willChange: 'transform',
            transition: 'transform 150ms ease-out',
          }}
        >
          <div className="absolute inset-0 bg-blue-100 rounded-sm border border-blue-300 border-dashed" />
        </div>
      )}
    </div>
  );

  // This component doesn't render anything visible - it only applies effects
  return null;
}

const CenterCanvas = React.memo(function CenterCanvas({
  currentPageId,
  viewportMode,
  setViewportMode,
  onLayerSelect,
  onLayerDeselect,
  onExitComponentEditMode,
  liveLayerUpdates,
  liveComponentUpdates,
}: CenterCanvasProps) {
  const selectedLayerId = useEditorStore((state) => state.selectedLayerId);

  const [showAddBlockPanel, setShowAddBlockPanel] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [previewContentHeight, setPreviewContentHeight] = useState(0);
  const [previewContainerHeight, setPreviewContainerHeight] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // State for iframe element (for SelectionOverlay)
  const [canvasIframeElement, setCanvasIframeElement] = useState<HTMLIFrameElement | null>(null);

  // Track iframe content size from iframe reports
  const [reportedContentHeight, setReportedContentHeight] = useState(0);
  const [reportedContentWidth, setReportedContentWidth] = useState(0);

  // Track container height for dynamic alignment
  const [containerHeight, setContainerHeight] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);

  // Track whether zoom calculation is ready (prevents flash of wrong zoom on initial load)
  const [isCanvasReady, setIsCanvasReady] = useState(false);

  // Optimize store subscriptions - use selective selectors (scoped to current page only)
  const currentDraft = usePagesStore((state) => currentPageId ? state.draftsByPageId[currentPageId] : null);
  const addLayerFromTemplate = usePagesStore((state) => state.addLayerFromTemplate);
  const updateLayer = usePagesStore((state) => state.updateLayer);
  const deleteLayer = usePagesStore((state) => state.deleteLayer);
  const deleteLayers = usePagesStore((state) => state.deleteLayers);
  const setDraftLayers = usePagesStore((state) => state.setDraftLayers);
  const pages = usePagesStore((state) => state.pages);
  const folders = usePagesStore((state) => state.folders);

  const setSelectedLayerId = useEditorStore((state) => state.setSelectedLayerId);
  const selectedLayerIds = useEditorStore((state) => state.selectedLayerIds);
  const getReturnDestination = useEditorStore((state) => state.getReturnDestination);
  const clearSelection = useEditorStore((state) => state.clearSelection);
  const setActiveSidebarTab = useEditorStore((state) => state.setActiveSidebarTab);
  const selectLayerWithSublayer = useEditorStore((state) => state.selectLayerWithSublayer);

  const selectedLocaleId = useLocalisationStore((state) => state.selectedLocaleId);
  const translations = useLocalisationStore((state) => state.translations);
  const locales = useLocalisationStore((state) => state.locales);
  // Derive the selected locale here (instead of via getSelectedLocale()) so it
  // is in scope for callbacks defined below — non-default locales gate every
  // canvas mutation handler into a no-op (read-only translation mode).
  const selectedLocale = useMemo(
    () => (selectedLocaleId ? locales.find((l) => l.id === selectedLocaleId) ?? null : null),
    [selectedLocaleId, locales]
  );
  const activeUIState = useEditorStore((state) => state.activeUIState);
  const editingComponentId = useEditorStore((state) => state.editingComponentId);
  const editingComponentVariantId = useEditorStore((state) => state.editingComponentVariantId);
  const setCurrentPageId = useEditorStore((state) => state.setCurrentPageId);
  const returnToPageId = useEditorStore((state) => state.returnToPageId);
  const currentPageCollectionItemId = useEditorStore((state) => state.currentPageCollectionItemId);
  const setCurrentPageCollectionItemId = useEditorStore((state) => state.setCurrentPageCollectionItemId);
  const setHoveredLayerId = useEditorStore((state) => state.setHoveredLayerId);
  const isPreviewMode = useEditorStore((state) => state.isPreviewMode);
  const previewUserId = usePagesStore((state) => state.previewUserId);
  const fetchCurrentUserProfile = useCurrentUserStore((s) => s.fetchProfile);

  // Sync simulated user profile to client store for variable resolution
  useEffect(() => {
    fetchCurrentUserProfile(previewUserId);
  }, [previewUserId, fetchCurrentUserProfile]);
  const activeSidebarTab = useEditorStore((state) => state.activeSidebarTab);
  const activeInteractionTriggerLayerId = useEditorStore((state) => state.activeInteractionTriggerLayerId);
  const activeInteractionTargetLayerIds = useEditorStore((state) => state.activeInteractionTargetLayerIds);
  const richTextSheetLayerId = useEditorStore((state) => state.richTextSheetLayerId);
  const closeRichTextSheet = useEditorStore((state) => state.closeRichTextSheet);
  const activeSublayerIndex = useEditorStore((state) => state.activeSublayerIndex);
  const setActiveSublayerIndex = useEditorStore((state) => state.setActiveSublayerIndex);
  const activeListItemIndex = useEditorStore((state) => state.activeListItemIndex);
  const elementPicker = useEditorStore((state) => state.elementPicker);
  const stopElementPicker = useEditorStore((state) => state.stopElementPicker);
  const assets = useAssetsStore((state) => state.assets);

  // Note: Canvas drag-and-drop state is handled by useCanvasDropDetection hook
  // and CanvasDropIndicatorOverlay component (they subscribe to store directly)

  // Text editor toolbar state from store
  const isTextEditing = useCanvasTextEditorStore((state) => state.isEditing);
  const editingLayerId = useCanvasTextEditorStore((state) => state.editingLayerId);
  const textEditorActiveMarks = useCanvasTextEditorStore((state) => state.activeMarks);
  const toggleBold = useCanvasTextEditorStore((state) => state.toggleBold);
  const toggleItalic = useCanvasTextEditorStore((state) => state.toggleItalic);
  const toggleUnderline = useCanvasTextEditorStore((state) => state.toggleUnderline);
  const toggleStrike = useCanvasTextEditorStore((state) => state.toggleStrike);
  const toggleSubscript = useCanvasTextEditorStore((state) => state.toggleSubscript);
  const toggleSuperscript = useCanvasTextEditorStore((state) => state.toggleSuperscript);
  const setHeading = useCanvasTextEditorStore((state) => state.setHeading);
  const focusEditor = useCanvasTextEditorStore((state) => state.focusEditor);
  const requestFinishEditing = useCanvasTextEditorStore((state) => state.requestFinish);
  const addFieldVariable = useCanvasTextEditorStore((state) => state.addFieldVariable);
  const textEditor = useCanvasTextEditorStore((state) => state.editor);

  // State for variable dropdown in text editor toolbar
  const [textEditorVariableDropdownOpen, setTextEditorVariableDropdownOpen] = useState(false);
  const [textEditorLinkPopoverOpen, setTextEditorLinkPopoverOpen] = useState(false);

  // Exit text edit mode if a different layer is selected
  useEffect(() => {
    if (isTextEditing && editingLayerId && selectedLayerId !== editingLayerId) {
      requestFinishEditing();
    }
  }, [isTextEditing, editingLayerId, selectedLayerId, requestFinishEditing]);

  // Close rich text sheet if a different layer is selected. Flushing the
  // pending translation save first ensures the last keystroke is persisted
  // when the user changes selection mid-edit. The flush function is defined
  // later in this component, so we go through a ref to keep effect ordering
  // and avoid a "use-before-declaration" cycle.
  const flushRichTextTranslationSaveRef = useRef<() => void>(() => { });
  useEffect(() => {
    if (richTextSheetLayerId && selectedLayerId !== richTextSheetLayerId) {
      flushRichTextTranslationSaveRef.current();
      closeRichTextSheet();
    }
  }, [richTextSheetLayerId, selectedLayerId, closeRichTextSheet]);

  // Draft loading is owned by LeftSidebar (wrapped in startTransition).
  // The store-level in-flight guard in loadDraft makes any concurrent call
  // a no-op if LeftSidebar is not mounted.

  // Reset content height when page changes to force Canvas to recalculate
  useEffect(() => {
    setReportedContentHeight(0);
  }, [currentPageId]);

  // Reset content width when switching components
  useEffect(() => {
    setReportedContentWidth(0);
  }, [editingComponentId]);

  const collectionItemsFromStore = useCollectionsStore((state) => state.items);
  const collectionsFromStore = useCollectionsStore((state) => state.collections);
  const collectionFieldsFromStore = useCollectionsStore((state) => state.fields);

  // Collection layer store for independent layer data
  const referencedItems = useCollectionLayerStore((state) => state.referencedItems);
  const fetchReferencedCollectionsBatch = useCollectionLayerStore((state) => state.fetchReferencedCollectionsBatch);

  const mergedCollectionItems = useMemo(
    () => ({ ...collectionItemsFromStore, ...referencedItems }),
    [collectionItemsFromStore, referencedItems],
  );

  const { urlState, navigateToLayers, navigateToPage, navigateToPageEdit, updateQueryParams } = useEditorUrl();
  const components = useComponentsStore((state) => state.components);
  const componentDrafts = useComponentsStore((state) => state.componentDrafts);
  // Resolve the active variant id while editing a component. The editor store
  // is the source of truth; falls back to the first persisted variant when
  // the URL/state references a stale id.
  const activeComponentVariantId = useMemo(() => {
    if (!editingComponentId) return null;
    const drafts = componentDrafts[editingComponentId];
    if (!drafts) return editingComponentVariantId || null;
    if (editingComponentVariantId && drafts[editingComponentVariantId]) return editingComponentVariantId;
    return Object.keys(drafts)[0] || null;
  }, [editingComponentId, editingComponentVariantId, componentDrafts]);
  // Get editing component's variables for default value display
  // Depends on `components` array to react to variable changes
  const editingComponentVariables = useMemo(() => {
    if (!editingComponentId) return undefined;
    const component = components.find(c => c.id === editingComponentId);
    return component?.variables;
  }, [editingComponentId, components]);

  // Undo/Redo hook - tracks versions for the current entity (page or component)
  const undoRedoEntityType = editingComponentId ? 'component' : 'page_layers';
  const undoRedoEntityId = editingComponentId || currentPageId;
  const {
    canUndo,
    canRedo,
    undo: performUndo,
    redo: performRedo,
    isLoading: isUndoRedoLoading,
  } = useUndoRedo({
    entityType: undoRedoEntityType,
    entityId: undoRedoEntityId,
    autoInit: true,
  });

  // Parse viewport width
  const viewportWidth = useMemo(() => {
    return parseInt(viewportSizes[viewportMode].width);
  }, [viewportMode]);

  // Calculate default iframe height to fill canvas — track current container height
  // so the white canvas always fills all the available vertical space, even when the
  // surrounding panels (sidebar, inspector, etc.) resize the canvas container.
  const defaultCanvasHeight = useMemo(() => {
    if (!containerHeight) return 600;
    return Math.max(0, containerHeight - CANVAS_PADDING);
  }, [containerHeight]);

  // Effective iframe height: max of reported content and canvas height
  // This ensures Body fills canvas (min-height: 100%), but iframe shrinks when content is removed
  const iframeContentHeight = useMemo(() => {
    // When editing a component, use content height + padding (don't force-fill container)
    if (editingComponentId && reportedContentHeight > 0) {
      return reportedContentHeight + COMPONENT_CANVAS_PADDING;
    }
    // Use max of reported content and canvas height
    // When content is small: iframe = canvas height, Body fills it with min-height: 100%
    // When content is large: iframe = content height, and shrinks when content is deleted
    return Math.max(reportedContentHeight, defaultCanvasHeight);
  }, [reportedContentHeight, defaultCanvasHeight, editingComponentId]);

  // Effective canvas width: content-based for component editing, viewport-based for pages
  const effectiveCanvasWidth = useMemo(() => {
    if (editingComponentId && reportedContentWidth > 0) {
      const padded = reportedContentWidth + COMPONENT_CANVAS_PADDING;
      return Math.min(padded, viewportWidth);
    }
    return viewportWidth;
  }, [editingComponentId, reportedContentWidth, viewportWidth]);

  // Calculate content height for zoom calculations
  // Use actual iframe content height for both modes
  // This allows "Fit height" to zoom based on document content, not viewport
  const zoomContentHeight = iframeContentHeight;

  // Initialize zoom hook
  const {
    zoom,
    zoomMode,
    zoomIn,
    zoomOut,
    setZoomTo,
    resetZoom,
    zoomToFit,
    autofit,
    handleZoomGesture,
  } = useZoom({
    containerRef: canvasContainerRef,
    contentWidth: effectiveCanvasWidth,
    contentHeight: zoomContentHeight,
    minZoom: 10,
    maxZoom: 1000,
    zoomStep: 10,
    shortcutsEnabled: !isPreviewMode,
  });

  // Independent zoom for the preview (second useZoom instance, active only in preview mode)
  const previewContentWidth = parseInt(viewportSizes[viewportMode].width);
  const {
    zoom: previewZoom,
    zoomMode: previewZoomMode,
    zoomIn: previewZoomIn,
    zoomOut: previewZoomOut,
    resetZoom: previewResetZoom,
    zoomToFit: previewZoomToFit,
    autofit: previewAutofit,
  } = useZoom({
    containerRef: previewContainerRef,
    contentWidth: previewContentWidth,
    contentHeight: previewContentHeight || defaultCanvasHeight,
    minZoom: 10,
    maxZoom: 1000,
    zoomStep: 10,
    shortcutsEnabled: isPreviewMode,
    iframeRef,
  });

  // Size the iframe element to exactly fill the visible canvas area at the
  // current zoom. The iframe's native scrolling then handles document content
  // taller than this — giving a single, properly-bounded scrollbar inside the
  // canvas instead of an (invisible) outer container scroll. Content height
  // (iframeContentHeight) still drives Fit Height zoom calc separately.
  const finalIframeHeight = useMemo(() => {
    if (editingComponentId) return iframeContentHeight;
    if (!containerHeight || zoom <= 0) return iframeContentHeight;

    return (containerHeight - CANVAS_PADDING) / (zoom / 100);
  }, [iframeContentHeight, containerHeight, zoom, editingComponentId]);

  // Same logic as finalIframeHeight, applied to the preview iframe. Sizing the
  // wrapper to the measured scrollHeight is unstable on pages that pin absolute
  // elements to the viewport (e.g. `bottom: -6rem` with no positioned ancestor)
  // — once `h-full` is restored after measurement, those elements extend past
  // the wrapper. Sizing to the visible container area instead lets the iframe
  // scroll internally and keeps the scrollbar bounded and accurate.
  const finalPreviewIframeHeight = useMemo(() => {
    if (!previewContainerHeight || previewZoom <= 0) return 0;
    return (previewContainerHeight - CANVAS_PADDING) / (previewZoom / 100);
  }, [previewContainerHeight, previewZoom]);

  const previewObserverRef = useRef<ResizeObserver | null>(null);

  /** Measure the preview iframe content and set up a ResizeObserver for re-measurement */
  const setupPreviewMeasurement = useCallback(() => {
    previewObserverRef.current?.disconnect();
    previewObserverRef.current = null;

    try {
      const iframe = iframeRef.current;
      const doc = iframe?.contentDocument;
      if (!iframe || !doc?.body) return;

      const wrapper = iframe.parentElement as HTMLElement | null;
      const containerEl = previewContainerRef.current;
      const refHeight = containerEl
        ? containerEl.clientHeight - CANVAS_PADDING
        : 0;

      if (refHeight > 0) {
        updateViewportOverrides(doc, refHeight);
      }

      let debounceTimer: ReturnType<typeof setTimeout> | undefined;

      const observeBodyChildren = () => {
        Array.from(doc.body.children).forEach(el => {
          if (el instanceof HTMLElement) observer.observe(el);
        });
      };

      const observer = new ResizeObserver(() => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => remeasure(), 100);
      });

      const remeasure = () => {
        try {
          if (!wrapper) return;

          const freshContainerEl = previewContainerRef.current;
          const freshRefHeight = freshContainerEl
            ? freshContainerEl.clientHeight - CANVAS_PADDING
            : refHeight;

          if (freshRefHeight <= 0) return;

          updateViewportOverrides(doc, freshRefHeight);

          // Disconnect observer before temporary style changes — setting
          // body/html height to auto causes h-full children to resize,
          // which fires the observer and creates a feedback loop.
          observer.disconnect();

          const prevBodyH = doc.body.style.height;
          const prevHtmlH = doc.documentElement.style.height;
          doc.body.style.height = 'auto';
          doc.documentElement.style.height = 'auto';
          void doc.body.offsetHeight;

          const bodyScrollH = doc.body.scrollHeight;

          doc.body.style.height = prevBodyH;
          doc.documentElement.style.height = prevHtmlH;
          void doc.body.offsetHeight;

          observeBodyChildren();

          if (bodyScrollH > 0) {
            setPreviewContentHeight(bodyScrollH);
          }
        } catch { /* cross-origin */ }
      };

      remeasure();

      const images = Array.from(doc.querySelectorAll('img'));
      const pendingImages = images.filter(img => !img.complete);

      if (pendingImages.length > 0) {
        let remaining = pendingImages.length;
        const onImageReady = () => {
          remaining--;
          if (remaining <= 0) remeasure();
        };
        pendingImages.forEach(img => {
          img.addEventListener('load', onImageReady, { once: true });
          img.addEventListener('error', onImageReady, { once: true });
        });
      }

      observeBodyChildren();

      previewObserverRef.current = observer;
    } catch {
      // Cross-origin — fall back to 0
    }
  }, []);

  // Re-measure and recalculate zoom when viewport changes
  const prevViewportMode = useRef(viewportMode);
  useEffect(() => {
    if (prevViewportMode.current !== viewportMode) {
      window.dispatchEvent(new CustomEvent('viewportChange'));

      // Small delay to ensure container dimensions are updated after width change.
      // useZoom auto-recalculates for the current mode (fit/autofit/custom) when
      // content dimensions change, so we only need to re-measure here.
      setTimeout(() => {
        if (isPreviewMode) {
          setupPreviewMeasurement();
        }
      }, 50);

      prevViewportMode.current = viewportMode;
    }
  }, [viewportMode, isPreviewMode, setupPreviewMeasurement]);

  // Scroll canvas to selected element if it's off-screen
  const prevCanvasLayerIdRef = useRef<string | null>(null);
  const isInitialScrollRef = useRef(true);

  const scrollCanvasToLayer = useCallback((layerId: string, smooth: boolean, force = false) => {
    if (!canvasIframeElement) return;

    const iframeDoc = canvasIframeElement.contentDocument;
    const iframeWin = canvasIframeElement.contentWindow;
    if (!iframeDoc || !iframeWin) return;

    const el = iframeDoc.querySelector(`[data-layer-id="${layerId}"]`) as HTMLElement;
    if (!el) return;

    // Scrolling happens inside the iframe (the iframe element is sized to the
    // visible canvas area; its own document handles overflow). All coordinates
    // here are in the iframe's coordinate system, so zoom doesn't apply.
    const scrollEl = iframeDoc.scrollingElement || iframeDoc.documentElement;
    const elRect = el.getBoundingClientRect();
    const currentScroll = scrollEl.scrollTop;
    const viewHeight = scrollEl.clientHeight;

    const elTopInDoc = currentScroll + elRect.top;
    const elBottomInDoc = elTopInDoc + elRect.height;
    const viewTop = currentScroll;
    const viewBottom = viewTop + viewHeight;

    if (!force && elTopInDoc >= viewTop && elBottomInDoc <= viewBottom) return;

    const fitsInView = elRect.height <= viewHeight;
    const targetScroll = fitsInView
      ? elTopInDoc - viewHeight / 2 + elRect.height / 2
      : elTopInDoc;
    // scrollEl.scrollTo starts the animation more reliably than iframeWin.scrollTo
    // across browsers, which avoids a noticeable lag before smooth scrolling begins.
    scrollEl.scrollTo({ top: Math.max(0, targetScroll), behavior: smooth ? 'smooth' : 'auto' });
  }, [canvasIframeElement]);

  const scrollCanvasToLayerRef = useRef(scrollCanvasToLayer);
  scrollCanvasToLayerRef.current = scrollCanvasToLayer;

  useEffect(() => {
    if (!selectedLayerId) {
      prevCanvasLayerIdRef.current = null;
      return;
    }

    if (!canvasIframeElement || !isCanvasReady) return;

    if (prevCanvasLayerIdRef.current === selectedLayerId) return;
    prevCanvasLayerIdRef.current = selectedLayerId;

    const isInitial = isInitialScrollRef.current;
    isInitialScrollRef.current = false;

    let attempts = 0;
    const maxAttempts = 20;
    let timeoutId: number | undefined;

    const tryScroll = () => {
      const iframeDoc = canvasIframeElement.contentDocument;
      const el = iframeDoc?.querySelector(`[data-layer-id="${selectedLayerId}"]`) as HTMLElement | null;
      if (!el) {
        attempts++;
        if (attempts < maxAttempts) {
          timeoutId = window.setTimeout(tryScroll, 100);
        }
        return;
      }
      scrollCanvasToLayer(selectedLayerId, !isInitial);
    };

    // Try synchronously first — the layer is almost always already in the DOM
    // when selection changes, so we can start scrolling immediately. Only the
    // initial selection on page load needs a deferred attempt while layers mount.
    if (isInitial) {
      timeoutId = window.setTimeout(tryScroll, 200);
    } else {
      tryScroll();
    }

    return () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, [selectedLayerId, canvasIframeElement, isCanvasReady, scrollCanvasToLayer]);

  // Re-scroll when content height changes during initial load (images loading shifts layout)
  const canvasReadyTimeRef = useRef<number | null>(null);
  useEffect(() => {
    if (isCanvasReady && !canvasReadyTimeRef.current) {
      canvasReadyTimeRef.current = Date.now();
    }
  }, [isCanvasReady]);

  useEffect(() => {
    if (!selectedLayerId || !canvasIframeElement || !isCanvasReady || !reportedContentHeight) return;

    const readyTime = canvasReadyTimeRef.current;
    if (!readyTime || Date.now() - readyTime > 5000) return;

    const timeout = setTimeout(() => {
      scrollCanvasToLayer(selectedLayerId, false, true);
    }, 100);
    return () => clearTimeout(timeout);
  }, [reportedContentHeight, selectedLayerId, canvasIframeElement, isCanvasReady, scrollCanvasToLayer]);

  // Scroll to selected layer after breakpoint change (uses ref to avoid stale zoom closure)
  useEffect(() => {
    if (isPreviewMode || !selectedLayerId || !canvasIframeElement || !isCanvasReady) return;

    const timeout = setTimeout(() => {
      scrollCanvasToLayerRef.current(selectedLayerId, true, true);
    }, 300);
    return () => clearTimeout(timeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewportMode]);

  // Track container dimensions for dynamic alignment
  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;

    const updateContainerDimensions = () => {
      const height = container.clientHeight;
      const width = container.clientWidth;
      setContainerHeight(height);
      setContainerWidth(width);

      // Mark canvas ready once we have valid dimensions
      if (height > 0 && width > 0 && !isCanvasReady) {
        // Use rAF to ensure zoom calculation has applied before revealing
        requestAnimationFrame(() => {
          setIsCanvasReady(true);
        });
      }
    };

    updateContainerDimensions();
    const resizeObserver = new ResizeObserver(updateContainerDimensions);
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [isCanvasReady]);

  // Track preview container height so the preview iframe wrapper can be sized
  // to fit the visible area (mirrors the canvas container tracking).
  useEffect(() => {
    const container = previewContainerRef.current;
    if (!container) return;

    const update = () => setPreviewContainerHeight(container.clientHeight);
    update();
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [isPreviewMode]);

  const layers = useMemo(() => {
    // If editing a component, show the active variant's layers
    if (editingComponentId && activeComponentVariantId) {
      return componentDrafts[editingComponentId]?.[activeComponentVariantId] || [];
    }

    // Otherwise show page layers
    if (!currentPageId) {
      return [];
    }

    return currentDraft ? currentDraft.layers : [];
  }, [editingComponentId, activeComponentVariantId, componentDrafts, currentPageId, currentDraft]);

  // Check if we're waiting for a draft to load (page selected but no draft yet)
  const isDraftLoading = useMemo(() => {
    if (editingComponentId) return false;
    if (!currentPageId) return false;
    return !currentDraft;
  }, [editingComponentId, currentPageId, currentDraft]);

  // Check if canvas is empty (only Body layer with no children)
  const isCanvasEmpty = useMemo(() => {
    if (layers.length === 0) return false; // No layers at all - handled separately

    // Find Body layer
    const bodyLayer = layers.find(layer => layer.id === 'body' || layer.name === 'body');

    if (!bodyLayer) return false;

    // Check if Body has no children or empty children array
    const hasNoChildren = !bodyLayer.children || bodyLayer.children.length === 0;

    // Canvas is empty if we only have Body with no children
    return layers.length === 1 && hasNoChildren;
  }, [layers]);

  // Fetch collection data for all collection layers in the page
  const fetchLayerData = useCollectionLayerStore((state) => state.fetchLayerData);
  const fetchPage = useCollectionLayerStore((state) => state.fetchPage);
  const invalidationKey = useCollectionLayerStore((state) => state.invalidationKey);
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Extract the fetch params for every collection layer in one tree walk. The
  // params reference changes whenever `layers` changes, but the derived
  // `collectionLayersKey` string only changes when collection-relevant settings
  // change — so the actual fetch effect can ignore unrelated edits (typing,
  // styling) and only fire on real collection changes.
  const collectionFetchParams = useMemo(() => {
    const params: Array<{
      layerId: string;
      collectionId: string;
      sortBy: string | undefined;
      sortOrder: 'asc' | 'desc' | undefined;
      limit: number | undefined;
      offset: number | undefined;
      userScope: boolean | undefined;
      userScopeFieldId: string | undefined;
    }> = [];
    const traverse = (layerList: Layer[]) => {
      layerList.forEach((layer) => {
        const collectionVariable = getCollectionVariable(layer);
        if (collectionVariable?.id) {
          const opts = layer.settings?.optionsSource;
          params.push({
            layerId: layer.id,
            collectionId: collectionVariable.id,
            sortBy: opts?.sortFieldId || collectionVariable.sort_by || undefined,
            sortOrder: opts?.sortOrder || collectionVariable.sort_order || undefined,
            limit: collectionVariable.limit ?? undefined,
            offset: collectionVariable.offset ?? undefined,
            userScope: collectionVariable.userScope || undefined,
            userScopeFieldId: collectionVariable.userScopeFieldId || undefined,
          });
        }
        if (layer.children && layer.children.length > 0) {
          traverse(layer.children);
        }
      });
    };
    traverse(layers);
    return params;
  }, [layers]);

  // Stable string key used as the effect dependency so unrelated layer edits
  // (text content, design changes) don't re-arm the debounced fetch timer.
  const collectionLayersKey = useMemo(
    () => collectionFetchParams
      .map((p) => `${p.layerId}:${p.collectionId}:${p.sortBy ?? ''}:${p.sortOrder ?? ''}:${p.limit ?? ''}:${p.offset ?? ''}:${p.userScope ?? ''}:${p.userScopeFieldId ?? ''}:${previewUserId ?? ''}:${isPreviewMode}`)
      .join('|'),
    [collectionFetchParams, previewUserId, isPreviewMode],
  );

  // Keep latest params reachable from inside the debounced timer without
  // needing to add the (unstable) array reference to the effect deps.
  const collectionFetchParamsRef = useRef(collectionFetchParams);
  collectionFetchParamsRef.current = collectionFetchParams;

  // Debounce the fetch to prevent duplicate calls during rapid updates
  useEffect(() => {
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current);
    }

    fetchTimeoutRef.current = setTimeout(() => {
      const params = collectionFetchParamsRef.current;
      params.forEach((p) => {
        fetchLayerData(p.layerId, p.collectionId, p.sortBy, p.sortOrder, p.limit, p.offset, undefined, p.userScope, p.userScopeFieldId);
      });
      fetchTimeoutRef.current = null;
    }, 100);

    return () => {
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current);
        fetchTimeoutRef.current = null;
      }
    };
  }, [collectionLayersKey, fetchLayerData, invalidationKey]);

  // Get current page
  const currentPage = useMemo(() => pages.find(p => p.id === currentPageId), [pages, currentPageId]);

  // Get collection ID from current page if it's dynamic
  const collectionId = useMemo(() => {
    if (!currentPage?.is_dynamic) return null;
    return currentPage.settings?.cms?.collection_id || null;
  }, [currentPage]);

  const pageCollectionItem = useMemo(() => {
    if (!currentPage?.is_dynamic) {
      return null;
    }

    // First, check if we have an optimistically updated item in the draft
    if (currentPageId) {
      if (currentDraft && (currentDraft as any).collectionItem) {
        return (currentDraft as any).collectionItem;
      }
    }

    // Fall back to fetching from collections store
    const collectionId = currentPage.settings?.cms?.collection_id;
    if (!collectionId || !currentPageCollectionItemId) {
      return null;
    }
    const itemsForCollection = collectionItemsFromStore[collectionId] || [];
    return itemsForCollection.find((item) => item.id === currentPageCollectionItemId) || null;
  }, [currentPage, currentPageId, currentPageCollectionItemId, collectionItemsFromStore, currentDraft]);

  // Page collection fields (used for Canvas props and reference loading)
  const pageCollectionFields = useMemo(() => {
    if (!currentPage?.is_dynamic) {
      return [];
    }
    const collectionId = currentPage.settings?.cms?.collection_id;
    if (!collectionId) {
      return [];
    }
    return collectionFieldsFromStore[collectionId] || [];
  }, [currentPage, collectionFieldsFromStore]);

  // Get parent collection layer for the layer being edited (for inline variables in text editor)
  const editingLayerParentCollection = useMemo(() => {
    if (!editingLayerId || !currentPageId) return null;

    // Get layers from either the active component variant draft or page draft
    let layersToSearch: Layer[] = [];
    if (editingComponentId && activeComponentVariantId) {
      layersToSearch = componentDrafts[editingComponentId]?.[activeComponentVariantId] || [];
    } else {
      layersToSearch = currentDraft ? currentDraft.layers : [];
    }

    if (!layersToSearch.length) return null;

    return findParentCollectionLayer(layersToSearch, editingLayerId);
  }, [editingLayerId, editingComponentId, activeComponentVariantId, componentDrafts, currentPageId, currentDraft]);

  // Build field groups for the canvas text editor's inline variable selection
  // Components are page-agnostic, so exclude dynamic page-collection fields when editing a component
  const fieldGroups = useMemo(() => {
    if (!editingLayerId) return undefined;
    let layers: Layer[] = [];
    if (editingComponentId && activeComponentVariantId) {
      layers = componentDrafts[editingComponentId]?.[activeComponentVariantId] || [];
    } else if (currentPageId) {
      layers = currentDraft ? currentDraft.layers : [];
    }
    if (!layers.length) return undefined;
    const page = editingComponentId ? null : currentPage;
    return buildFieldGroupsForLayer(editingLayerId, layers, page, collectionFieldsFromStore, collectionsFromStore);
  }, [editingLayerId, editingComponentId, activeComponentVariantId, componentDrafts, currentPageId, currentDraft, currentPage, collectionFieldsFromStore, collectionsFromStore]);

  const textFieldGroups = useMemo(
    () => filterFieldGroupsByType(fieldGroups, SIMPLE_TEXT_FIELD_TYPES),
    [fieldGroups],
  );

  // Create assets map for Canvas (asset ID -> asset)
  const assetsMap = useMemo(() => {
    const map: Record<string, Asset> = {};
    assets.forEach(asset => {
      map[asset.id] = asset;
    });
    return map;
  }, [assets]);

  // Handle any click inside the canvas (closes ElementLibrary panel and other popovers)
  const handleCanvasClick = useCallback(() => {
    window.dispatchEvent(new CustomEvent('closeElementLibrary'));
    window.dispatchEvent(new CustomEvent('canvasClick'));
  }, []);

  // Canvas callback handlers
  const handleCanvasLayerClick = useCallback((layerId: string, event?: React.MouseEvent) => {
    // Skip selection changes during drag operations
    const { isDraggingLayerOnCanvas, isDraggingToCanvas, elementPicker: picker } = useEditorStore.getState();
    if (isDraggingLayerOnCanvas || isDraggingToCanvas) {
      return;
    }

    // Element picker mode: intercept click to select an element
    if (picker?.active && picker.onSelect) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      if (picker.validate && !picker.validate(layerId)) {
        toast.error('Please select an input element inside a Filter form.');
        return;
      }
      picker.onSelect(layerId);
      return;
    }

    if (!isPreviewMode) {
      // Switch to Layers tab when a layer is clicked on canvas
      setActiveSidebarTab('layers');

      // Detect if clicked on a text style element or a richText sublayer block
      let textStyleKey: string | null = null;
      let blockIndex: number | null = null;
      let listItemIndex: number | null = null;

      if (event) {
        let target = event.target as HTMLElement;
        let blockLevelStyleKey: string | null = null;

        // Walk up the DOM tree to find data-style, data-block-index, data-list-item-index.
        // The textStyleKey from the element with data-block-index is the actual content
        // block type (e.g. blockquote), not an inner element's style (e.g. paragraph).
        while (target && target !== event.currentTarget) {
          const styleAttr = target.getAttribute?.('data-style');
          if (styleAttr && !textStyleKey) {
            textStyleKey = styleAttr;
          }
          if (listItemIndex === null) {
            const listItemAttr = target.getAttribute?.('data-list-item-index');
            if (listItemAttr !== null) listItemIndex = parseInt(listItemAttr, 10);
          }
          if (blockIndex === null) {
            const blockAttr = target.getAttribute?.('data-block-index');
            if (blockAttr !== null) {
              blockIndex = parseInt(blockAttr, 10);
              if (styleAttr) blockLevelStyleKey = styleAttr;
            }
          }
          target = target.parentElement as HTMLElement;
        }

        // Prefer the block-level style over structural inner elements (e.g.
        // paragraph inside blockquote), but keep inline marks and sub-block
        // styles like listItem that shouldn't be overridden by their container
        const INNER_STYLE_KEYS = new Set(['bold', 'italic', 'underline', 'strike', 'link', 'subscript', 'superscript']);
        if (blockLevelStyleKey && (!textStyleKey || !INNER_STYLE_KEYS.has(textStyleKey))) {
          textStyleKey = blockLevelStyleKey;
        }
      }

      // For non-CMS-bound rich text, sublayers are style-based (unique types),
      // so skip block-level sublayerIndex/listItemIndex — only set textStyleKey
      let resolvedSublayerIndex = Number.isFinite(blockIndex) ? blockIndex : null;
      let resolvedListItemIndex = Number.isFinite(listItemIndex) ? listItemIndex : null;
      if (resolvedSublayerIndex !== null && textStyleKey) {
        const layers = editingComponentId && activeComponentVariantId
          ? (componentDrafts[editingComponentId]?.[activeComponentVariantId] || [])
          : (currentDraft?.layers || []);
        const layer = findLayerById(layers, layerId);
        if (layer && isRichTextLayer(layer) && !getLayerCmsFieldBinding(layer)) {
          resolvedSublayerIndex = null;
          resolvedListItemIndex = null;
        }
      }

      selectLayerWithSublayer(layerId, {
        textStyleKey,
        sublayerIndex: resolvedSublayerIndex,
        listItemIndex: resolvedListItemIndex,
      });
    }
  }, [isPreviewMode, setActiveSidebarTab, selectLayerWithSublayer, editingComponentId, activeComponentVariantId, componentDrafts, currentDraft]);

  const handleCanvasLayerUpdate = useCallback((layerId: string, updates: Partial<Layer>) => {
    // Block all source-layer mutations from the canvas while in a non-default
    // locale. The Translate panel writes through the translations table instead
    // of mutating the layer tree.
    if (selectedLocale && !selectedLocale.is_default) return;

    if (editingComponentId && activeComponentVariantId) {
      const { componentDrafts, updateComponentDraft } = useComponentsStore.getState();
      const currentDraft = componentDrafts[editingComponentId]?.[activeComponentVariantId] || [];
      updateComponentDraft(editingComponentId, activeComponentVariantId, updateLayerProps(currentDraft, layerId, updates));
    } else if (currentPageId) {
      updateLayer(currentPageId, layerId, updates);
    }
  }, [editingComponentId, activeComponentVariantId, currentPageId, updateLayer, selectedLocale]);

  const handleCanvasDeleteLayer = useCallback(() => {
    if (!selectedLayerId || !currentPageId) return;
    // Block layer deletion in non-default locales (read-only canvas).
    if (selectedLocale && !selectedLocale.is_default) return;

    // Handle sublayer deletion (remove TipTap block, not the whole layer)
    if (activeSublayerIndex !== null) {
      if (!currentDraft) return;
      const richTextLayer = findLayerById(currentDraft.layers, selectedLayerId);
      if (!richTextLayer) return;
      const updates = removeRichTextSublayer(richTextLayer, activeSublayerIndex);
      if (!updates) return;
      updateLayer(currentPageId, selectedLayerId, updates);
      setActiveSublayerIndex(null);
      return;
    }

    // Check if multi-select
    if (selectedLayerIds.length > 1) {
      // Check restrictions for all layers
      if (currentDraft) {
        const layersToCheck = selectedLayerIds.map(id => findLayerById(currentDraft.layers, id)).filter(Boolean) as Layer[];
        const canDeleteAll = layersToCheck.every(layer => canDeleteLayer(layer));

        if (canDeleteAll) {
          deleteLayers(currentPageId, selectedLayerIds);
          clearSelection();
        }
      }
    } else {
      // Single layer deletion - check restrictions
      if (currentDraft) {
        const layer = findLayerById(currentDraft.layers, selectedLayerId);
        if (!layer || !canDeleteLayer(layer)) {
          return;
        }
        deleteLayer(currentPageId, selectedLayerId);
        setSelectedLayerId(null);
      }
    }
  }, [selectedLayerId, currentPageId, selectedLayerIds, currentDraft, deleteLayers, clearSelection, deleteLayer, setSelectedLayerId, activeSublayerIndex, setActiveSublayerIndex, updateLayer, selectedLocale]);

  const handleCanvasGapUpdate = useCallback((layerId: string, gapValue: string) => {
    if (!currentPageId) return;
    if (selectedLocale && !selectedLocale.is_default) return;

    // Find the layer and update its gap class
    if (!currentDraft) return;

    const layer = findLayerById(currentDraft.layers, layerId);
    if (!layer) return;

    // Get current classes
    const currentClasses = Array.isArray(layer.classes) ? layer.classes : (layer.classes?.split(' ') || []);

    // Remove existing gap classes
    const filteredClasses = currentClasses.filter((cls: string) => !cls.startsWith('gap-'));

    // Add new gap class
    const newClasses = [...filteredClasses, `gap-[${gapValue}]`];

    // Update the layer
    updateLayer(currentPageId, layerId, { classes: newClasses });
  }, [currentPageId, currentDraft, updateLayer, selectedLocale]);

  // Rich text sheet for canvas double-click (layers with components/variables)
  // Build field groups using the sheet target layer (not the canvas text editor layer)
  // Components are page-agnostic, so exclude dynamic page-collection fields when editing a component
  const richTextSheetFieldGroups = useMemo(() => {
    if (!richTextSheetLayerId || !currentPageId) return undefined;
    let layers: Layer[] = [];
    if (editingComponentId && activeComponentVariantId) {
      layers = componentDrafts[editingComponentId]?.[activeComponentVariantId] || [];
    } else {
      layers = currentDraft ? currentDraft.layers : [];
    }
    if (!layers.length) return undefined;
    const page = editingComponentId ? null : currentPage;
    return buildFieldGroupsForLayer(richTextSheetLayerId, layers, page, collectionFieldsFromStore, collectionsFromStore);
  }, [richTextSheetLayerId, editingComponentId, activeComponentVariantId, componentDrafts, currentPageId, currentDraft, currentPage, collectionFieldsFromStore, collectionsFromStore]);

  // Track the current value locally so the value prop always matches the editor's
  // internal state. This prevents the editor's sync effect from resetting content
  // when other deps (fields, allFields) change.
  const [richTextSheetValue, setRichTextSheetValue] = useState<any>(null);

  // Translation context for the rich-text sheet. When the user is browsing the
  // canvas in a non-default locale and a rich-text layer is the sheet target,
  // we redirect read/write through the translations table instead of mutating
  // the source layer. This is what makes the rich-text editor act as the
  // translation surface for rich text (no plain-textarea fallback in the sidebar).
  const richTextTranslationContext = useMemo(() => {
    if (!richTextSheetLayerId || !selectedLocale || selectedLocale.is_default) return null;
    const sourceLayers: Layer[] = editingComponentId && activeComponentVariantId
      ? (componentDrafts[editingComponentId]?.[activeComponentVariantId] || [])
      : (currentDraft?.layers || []);
    const layer = findLayerById(sourceLayers, richTextSheetLayerId);
    if (!layer || !isRichTextLayer(layer)) return null;
    const sourceType: 'page' | 'component' = editingComponentId ? 'component' : 'page';
    const sourceId = editingComponentId || currentPageId;
    if (!sourceId) return null;
    const items = extractLayerTranslatableItemsShallow(layer, sourceType, sourceId);
    const item = items.find((i) => i.content_type === 'richtext');
    if (!item) return null;
    return { item };
  }, [richTextSheetLayerId, selectedLocale, editingComponentId, activeComponentVariantId, componentDrafts, currentDraft, currentPageId]);

  useEffect(() => {
    if (!richTextSheetLayerId) {
      setRichTextSheetValue(null);
      return;
    }

    // Localization mode: only show the saved translation. Per spec we don't
    // surface the default-locale source inside the editor — the user types the
    // translation from scratch (the source is visible on the canvas).
    if (richTextTranslationContext && selectedLocaleId) {
      const stored = useLocalisationStore
        .getState()
        .getTranslationByKey(selectedLocaleId, richTextTranslationContext.item.key)?.content_value;
      if (stored && stored.trim()) {
        try {
          setRichTextSheetValue(JSON.parse(stored));
          return;
        } catch {
          // fall through to empty doc
        }
      }
      setRichTextSheetValue({ type: 'doc', content: [{ type: 'paragraph' }] });
      return;
    }

    const compId = useEditorStore.getState().editingComponentId;
    const variantId = useEditorStore.getState().editingComponentVariantId;
    const source = (() => {
      if (compId) {
        const drafts = useComponentsStore.getState().componentDrafts[compId];
        if (!drafts) return null;
        return drafts[variantId ?? ''] ?? drafts[Object.keys(drafts)[0]] ?? null;
      }
      return usePagesStore.getState().draftsByPageId[currentPageId ?? '']?.layers ?? null;
    })();
    const layer = source ? findLayerById(source as Layer[], richTextSheetLayerId) : null;
    setRichTextSheetValue(getRichTextValue(layer?.variables));
  // Only re-derive when the sheet target layer (or translation context) changes,
  // not on every draft update.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [richTextSheetLayerId, richTextTranslationContext, selectedLocaleId]);

  // Debounced save for translation writes — the rich-text editor fires onChange
  // on every keystroke, so we coalesce writes to avoid spamming the API and
  // racing the optimistic create with concurrent updates.
  const richTextTranslationSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const richTextTranslationPendingValueRef = useRef<{ key: string; value: string; localeId: string } | null>(null);

  const flushRichTextTranslationSave = useCallback(() => {
    if (richTextTranslationSaveTimerRef.current) {
      clearTimeout(richTextTranslationSaveTimerRef.current);
      richTextTranslationSaveTimerRef.current = null;
    }
    const pending = richTextTranslationPendingValueRef.current;
    if (!pending) return;
    // Drop the pending save if the user switched locale or selection while
    // typing — we only want to persist edits authored against the locale they
    // were typed for.
    if (!richTextTranslationContext || !selectedLocaleId) return;
    if (pending.key !== richTextTranslationContext.item.key) return;
    if (pending.localeId !== selectedLocaleId) return;
    const item = richTextTranslationContext.item;
    const store = useLocalisationStore.getState();
    const latest = store.getTranslationByKey(selectedLocaleId, item.key);
    const previousValue = latest?.content_value || '';
    if (pending.value === previousValue) {
      richTextTranslationPendingValueRef.current = null;
      return;
    }
    richTextTranslationPendingValueRef.current = null;
    const savePromise = latest
      ? store.updateTranslation(latest, { content_value: pending.value, is_completed: true })
      : store.createTranslation({
        locale_id: selectedLocaleId,
        source_type: item.source_type as 'page' | 'component',
        source_id: item.source_id,
        content_key: item.content_key,
        content_type: 'richtext',
        content_value: pending.value,
        is_completed: true,
      });
    savePromise.catch((error) => console.error('Failed to save rich text translation:', error));
  }, [richTextTranslationContext, selectedLocaleId]);

  // Keep the flush ref pointing at the latest closure so the early
  // close-on-different-selection effect can flush without a forward reference.
  useEffect(() => {
    flushRichTextTranslationSaveRef.current = flushRichTextTranslationSave;
  }, [flushRichTextTranslationSave]);

  const handleRichTextSheetChange = useCallback((value: any) => {
    if (!richTextSheetLayerId) return;
    setRichTextSheetValue(value);

    if (richTextTranslationContext && selectedLocaleId) {
      const finalValue = value ? JSON.stringify(value) : '';
      richTextTranslationPendingValueRef.current = {
        key: richTextTranslationContext.item.key,
        value: finalValue,
        localeId: selectedLocaleId,
      };
      if (richTextTranslationSaveTimerRef.current) {
        clearTimeout(richTextTranslationSaveTimerRef.current);
      }
      richTextTranslationSaveTimerRef.current = setTimeout(() => {
        flushRichTextTranslationSave();
      }, 400);
      return;
    }

    const textVariable = value && (typeof value === 'object' || (typeof value === 'string' && value.trim())) ? {
      type: 'dynamic_rich_text' as const,
      data: {
        content: typeof value === 'object' ? value : {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }],
        },
      },
    } : undefined;

    const compId = useEditorStore.getState().editingComponentId;
    const variantId = useEditorStore.getState().editingComponentVariantId;
    if (compId) {
      const { componentDrafts: drafts, updateComponentDraft } = useComponentsStore.getState();
      const variantDrafts = drafts[compId];
      if (!variantDrafts) return;
      const targetVariantId = variantId && variantDrafts[variantId] ? variantId : Object.keys(variantDrafts)[0];
      if (!targetVariantId) return;
      const currentDraft = variantDrafts[targetVariantId];
      const layer = findLayerById(currentDraft, richTextSheetLayerId);
      updateComponentDraft(compId, targetVariantId, updateLayerProps(currentDraft, richTextSheetLayerId, {
        variables: { ...layer?.variables, text: textVariable },
      }));
    } else {
      const pageId = useEditorStore.getState().currentPageId;
      if (!pageId) return;
      const draft = usePagesStore.getState().draftsByPageId[pageId];
      const layer = draft ? findLayerById(draft.layers, richTextSheetLayerId) : null;
      updateLayer(pageId, richTextSheetLayerId, {
        variables: { ...layer?.variables, text: textVariable },
      });
    }
  }, [richTextSheetLayerId, updateLayer, richTextTranslationContext, selectedLocaleId, flushRichTextTranslationSave]);

  // Handle iframe ready callback (for SelectionOverlay)
  const handleIframeReady = useCallback((iframeElement: HTMLIFrameElement) => {
    setCanvasIframeElement(iframeElement);
  }, []);

  // Handle layer hover from Canvas (for SelectionOverlay)
  const handleCanvasLayerHover = useCallback((layerId: string | null) => {
    setHoveredLayerId(layerId);
  }, [setHoveredLayerId]);

  // Open the master component when a component instance is double-clicked.
  // Mirrors the "Edit component" sidebar button.
  const editComponent = useEditComponent();
  const handleCanvasComponentEdit = useCallback((componentId: string, instanceLayerId: string) => {
    const instanceLayer = findLayerById(layers, instanceLayerId);
    editComponent(componentId, {
      returnToLayerId: instanceLayerId,
      variantId: instanceLayer?.componentVariantId,
    });
  }, [editComponent, layers]);

  // Undo/Redo handlers
  // Note: We don't auto-save after undo/redo to preserve the redo stack
  // The state will be saved when the user makes the next change
  const handleUndo = useCallback(async () => {
    if (!canUndo || isUndoRedoLoading) return;
    await performUndo();
  }, [canUndo, isUndoRedoLoading, performUndo]);

  const handleRedo = useCallback(async () => {
    if (!canRedo || isUndoRedoLoading) return;
    await performRedo();
  }, [canRedo, isUndoRedoLoading, performRedo]);

  // Handle drop callback for useCanvasDropDetection
  const handleCanvasDrop = useCallback((
    elementType: string,
    source: 'elements' | 'layouts' | 'components',
    dropTarget: { layerId: string; position: 'above' | 'below' | 'inside'; parentId: string | null }
  ) => {
    if (!currentPageId) return;
    // Block element insertion in non-default locales (read-only canvas).
    if (selectedLocale && !selectedLocale.is_default) return;

    if (source === 'elements') {
      // Determine insert position based on drop target
      // If dropping 'inside', no sibling positioning needed
      // If dropping 'above' or 'below', we need to specify the sibling position
      const insertPosition = (dropTarget.position === 'above' || dropTarget.position === 'below')
        ? { siblingId: dropTarget.layerId, position: dropTarget.position as 'above' | 'below' }
        : undefined;

      const result = addLayerFromTemplate(currentPageId, dropTarget.parentId, elementType, insertPosition);
      if (result) {
        setSelectedLayerId(result.newLayerId);
        // Expand parent if needed
        if (result.parentToExpand) {
          window.dispatchEvent(new CustomEvent('expandLayer', {
            detail: { layerId: result.parentToExpand }
          }));
        }
        // Broadcast to collaborators
        if (liveLayerUpdates) {
          const freshDraft = usePagesStore.getState().draftsByPageId[currentPageId];
          if (freshDraft) {
            const findLayerWithParent = (layersList: Layer[], id: string, parent: Layer | null = null): { layer: Layer; parent: Layer | null } | null => {
              for (const layer of layersList) {
                if (layer.id === id) return { layer, parent };
                if (layer.children) {
                  const found = findLayerWithParent(layer.children, id, layer);
                  if (found) return found;
                }
              }
              return null;
            };
            const found = findLayerWithParent(freshDraft.layers, result.newLayerId);
            if (found?.layer) {
              const actualParentId = found.parent?.id || null;
              liveLayerUpdates.broadcastLayerAdd(currentPageId, actualParentId, elementType, found.layer);
            }
          }
        }
      }
    } else if (source === 'layouts') {
      // TODO: Add layout using similar logic
    } else if (source === 'components') {
      // TODO: Add component using similar logic
    }
  }, [currentPageId, addLayerFromTemplate, setSelectedLayerId, liveLayerUpdates, selectedLocale]);

  // Use the canvas drop detection hook for throttled hit-testing
  useCanvasDropDetection({
    iframeElement: canvasIframeElement,
    zoom,
    layers,
    pageId: currentPageId,
    onDrop: handleCanvasDrop,
  });

  // Handle layer reorder callback for sibling reordering on canvas
  const handleLayerReorder = useCallback((newLayers: Layer[]) => {
    if (!currentPageId) return;

    // If editing component, would need to update component draft instead
    if (editingComponentId) {
      // TODO: Support component editing
      return;
    }

    setDraftLayers(currentPageId, newLayers);
  }, [currentPageId, editingComponentId, setDraftLayers]);

  // Use the canvas sibling reorder hook for drag-to-reorder within same parent
  // Disable during text edit mode so text selection works
  useCanvasSiblingReorder({
    iframeElement: canvasIframeElement,
    zoom,
    layers,
    pageId: currentPageId,
    selectedLayerId,
    disabled: isTextEditing,
    onReorder: handleLayerReorder,
    onLayerSelect: setSelectedLayerId,
  });

  // Calculate parent layer ID for selection overlay (one level up from selected)
  const parentLayerId = useMemo(() => {
    if (!selectedLayerId || !currentPageId) return null;

    // Get layers from either the active variant draft or page draft
    let layersToSearch: Layer[] = [];
    if (editingComponentId && activeComponentVariantId) {
      layersToSearch = componentDrafts[editingComponentId]?.[activeComponentVariantId] || [];
    } else {
      layersToSearch = currentDraft ? currentDraft.layers : [];
    }

    if (!layersToSearch.length) return null;

    const findParentId = (layers: Layer[], targetId: string, parentId: string | null = null): string | null | undefined => {
      for (const layer of layers) {
        if (layer.id === targetId) {
          return parentId;
        }
        if (layer.children && layer.children.length > 0) {
          const result = findParentId(layer.children, targetId, layer.id);
          if (result !== undefined) {
            return result;
          }
        }
      }
      return undefined;
    };

    const result = findParentId(layersToSearch, selectedLayerId);
    if (result === undefined) return null;

    const selectedLayer = findLayerById(layersToSearch, selectedLayerId);
    if (selectedLayer?.name === 'slide') return null;

    return result;
  }, [selectedLayerId, currentPageId, editingComponentId, activeComponentVariantId, componentDrafts, currentDraft]);

  // Get selected layer name for drag preview
  const selectedLayerName = useMemo(() => {
    if (!selectedLayerId) return null;
    const layer = findLayerById(layers, selectedLayerId);
    // Use layer's name property (e.g., 'div', 'section', 'heading')
    return layer?.name || null;
  }, [selectedLayerId, layers]);

  // Translations map for the active locale (used to inject into the canvas)
  const localeTranslations = useMemo(() => {
    return selectedLocaleId ? translations[selectedLocaleId] : undefined;
  }, [selectedLocaleId, translations]);

  // True when the user is browsing the canvas in a non-default locale.
  // The canvas becomes a read-only translation view in this state.
  const isLocalizing = !!(selectedLocale && !selectedLocale.is_default);

  // Subscribe to translation loading state so we can show a spinner overlay
  // while translations for the active locale are being fetched.
  const isLoadingTranslations = useLocalisationStore((state) => state.isLoading.loadTranslations);

  // Translate the dynamic page's CMS item values when localizing so layers
  // bound to CMS fields render the translated values.
  const translatedPageCollectionItem = useMemo(() => {
    if (!pageCollectionItem || !isLocalizing || !localeTranslations) {
      return pageCollectionItem;
    }
    return {
      ...pageCollectionItem,
      values: applyCmsTranslations(
        pageCollectionItem.id,
        pageCollectionItem.values || {},
        pageCollectionFields,
        localeTranslations,
        { includeIncomplete: true }
      ),
    };
  }, [pageCollectionItem, pageCollectionFields, isLocalizing, localeTranslations]);

  // Build preview URL for preview mode
  const previewUrl = useMemo(() => {
    if (!currentPage) return '';

    // Error pages use special preview route
    if (currentPage.error_page !== null) {
      return `/ycode/preview/error-pages/${currentPage.error_page}`;
    }

    // Get collection item slug value for dynamic pages (with translation support)
    const collectionItemSlug = currentPage.is_dynamic && currentPageCollectionItemId
      ? (() => {
        const collectionId = currentPage.settings?.cms?.collection_id;
        const slugFieldId = currentPage.settings?.cms?.slug_field_id;

        if (!collectionId || !slugFieldId) return null;

        const collectionItems = collectionItemsFromStore[collectionId] || [];
        const selectedItem = collectionItems.find(item => item.id === currentPageCollectionItemId);

        if (!selectedItem || !selectedItem.values) return null;

        let slugValue = selectedItem.values[slugFieldId];

        // If locale is selected, check for translated slug
        if (localeTranslations && slugValue) {
          const collectionFields = collectionFieldsFromStore[collectionId] || [];
          const slugField = collectionFields.find(f => f.id === slugFieldId);

          if (slugField) {
            // Build translation key: field:key:{key} or field:id:{id}
            const contentKey = slugField.key
              ? `field:key:${slugField.key}`
              : `field:id:${slugField.id}`;
            const translationKey = `cms:${currentPageCollectionItemId}:${contentKey}`;
            const translation = localeTranslations[translationKey];

            const translatedSlug = getTranslationValue(translation);
            if (translatedSlug) {
              slugValue = translatedSlug;
            }
          }
        }

        return slugValue || null;
      })()
      : null;

    // Build localized path with translated slugs
    const path = currentPage.is_dynamic
      ? buildLocalizedDynamicPageUrl(currentPage, folders, collectionItemSlug, selectedLocale, localeTranslations)
      : buildLocalizedSlugPath(currentPage, folders, 'page', selectedLocale, localeTranslations);

    let url = `/ycode/preview${path === '/' ? '' : path}`;

    // Append preview user ID to force iframe reload and signal backend
    if (previewUserId) {
      const separator = url.includes('?') ? '&' : '?';
      url += `${separator}ycode_preview_user_id=${previewUserId}`;
    }

    return url;
  }, [currentPage, folders, currentPageCollectionItemId, collectionItemsFromStore, collectionFieldsFromStore, selectedLocale, localeTranslations, previewUserId]);

  // Reload preview iframe every time preview mode opens (covers all change sources:
  // layer edits, component updates, CMS, layer styles, color variables, etc.)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  useEffect(() => {
    if (!isPreviewMode || !previewUrl) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    setIsPreviewLoading(true);
    iframe.src = previewUrl;

    return () => {
      previewObserverRef.current?.disconnect();
      previewObserverRef.current = null;
    };
  }, [isPreviewMode, previewUrl]);

  // Autofit when entering preview mode (not on every breakpoint change)
  const prevIsPreviewMode = useRef(false);
  useEffect(() => {
    if (isPreviewMode && !prevIsPreviewMode.current) {
      previewAutofit();
    }
    prevIsPreviewMode.current = isPreviewMode;
  }, [isPreviewMode, previewAutofit]);

  const handlePreviewLoad = useCallback(() => {
    setIsPreviewLoading(false);
    setupPreviewMeasurement();
  }, [setupPreviewMeasurement]);

  // Get return page for component edit mode
  const returnToPage = useMemo(() => {
    return returnToPageId ? pages.find(p => p.id === returnToPageId) : null;
  }, [returnToPageId, pages]);

  // Handle page selection
  const handlePageSelect = useCallback((pageId: string) => {
    if (pageId === currentPageId) return;

    // Set to body directly so the layer sync effect won't trigger a second URL update
    setSelectedLayerId('body');
    setCurrentPageId(pageId);

    if (urlState.isEditing) {
      navigateToPageEdit(pageId);
    } else if (activeSidebarTab === 'pages') {
      navigateToPage(pageId, undefined, undefined, 'body');
    } else {
      navigateToLayers(pageId, undefined, undefined, 'body');
    }
  }, [currentPageId, setSelectedLayerId, setCurrentPageId, activeSidebarTab, urlState.isEditing, navigateToLayers, navigateToPage, navigateToPageEdit]);

  // Fetch referenced collection items recursively when layers with reference fields are detected
  useEffect(() => {
    // Recursively find all referenced collection IDs by following reference chains
    const findAllReferencedCollections = (
      fieldsMap: Record<string, CollectionField[]>,
      visited: Set<string> = new Set()
    ): Set<string> => {
      const referencedIds = new Set<string>();

      const processFields = (fields: CollectionField[]) => {
        fields.forEach((field) => {
          if (field.type === 'reference' && field.reference_collection_id) {
            const refId = field.reference_collection_id;
            if (!visited.has(refId)) {
              referencedIds.add(refId);
              visited.add(refId);

              // Recursively check the referenced collection's fields
              const refFields = fieldsMap[refId];
              if (refFields) {
                processFields(refFields);
              }
            }
          }
        });
      };

      // Process all loaded collection fields
      Object.values(fieldsMap).forEach(processFields);

      return referencedIds;
    };

    // Start with loaded fields
    const allReferencedIds = findAllReferencedCollections(collectionFieldsFromStore);

    // Also check page collection fields
    if (pageCollectionFields) {
      pageCollectionFields.forEach((field) => {
        if (field.type === 'reference' && field.reference_collection_id) {
          allReferencedIds.add(field.reference_collection_id);
        }
      });
    }

    // One batch call per re-render covers every referenced collection; the
    // store dedupes against already-loaded IDs so repeat calls are cheap.
    if (allReferencedIds.size > 0) {
      fetchReferencedCollectionsBatch(Array.from(allReferencedIds));
    }
  }, [collectionFieldsFromStore, pageCollectionFields, fetchReferencedCollectionsBatch, invalidationKey]);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    if (isPreviewMode) return; // No undo/redo in preview mode

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't interfere with text input fields
      const target = e.target as HTMLElement;
      const isInputFocused = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if (isInputFocused) return;

      // Check for Cmd/Ctrl + Z (undo) and Cmd/Ctrl + Shift + Z (redo)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();

        if (e.shiftKey) {
          // Redo: Cmd/Ctrl + Shift + Z
          handleRedo();
        } else {
          // Undo: Cmd/Ctrl + Z
          handleUndo();
        }
        return;
      }

      // Check for Cmd/Ctrl + Y (redo alternative)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isPreviewMode, handleUndo, handleRedo]);

  return (
    <div className="flex-1 min-w-0 flex flex-col relative">
      {/* Top Bar */}
      <div className="grid grid-cols-3 items-center p-4 border-b bg-background">
        {/* Page Selector or Back to Page Button */}
        {editingComponentId ? (
          <Button
            variant="purple"
            size="sm"
            onClick={onExitComponentEditMode}
            className="gap-1 w-fit"
          >
            <Icon name="arrowLeft" />
            {(() => {
              const returnDestination = getReturnDestination();
              if (returnDestination && returnDestination.name) {
                return returnDestination.type === 'page'
                  ? `Return to ${returnDestination.name}`
                  : `Return to ${returnDestination.name}`;
              }
              // Fallback: Try to get name from stores if stack entry exists but name is empty
              if (returnDestination) {
                if (returnDestination.type === 'page') {
                  const page = pages.find(p => p.id === returnDestination.id);
                  if (page) return `Return to ${page.name}`;
                } else {
                  const component = components.find(c => c.id === returnDestination.id);
                  if (component) return `Return to ${component.name}`;
                }
              }
              // Final fallback to old behavior if stack is empty
              return `Back to ${returnToPage ? returnToPage.name : 'Homepage'}`;
            })()}
          </Button>
        ) : (
          <div className="flex items-center gap-1.5">
            <PageSelector
              value={currentPageId}
              onValueChange={handlePageSelect}
              includeErrorPages
              align="start"
              className="w-40 text-muted-foreground"
              popoverClassName="min-w-60"
            />

            {/* Collection item selector for dynamic pages */}
            {currentPage?.is_dynamic && collectionId && (
              <CollectionItemSelector
                collectionId={collectionId}
                value={currentPageCollectionItemId}
                onValueChange={setCurrentPageCollectionItemId}
              />
            )}
          </div>
        )}

        {/* Viewport Controls */}
        <ViewportZoomControls
          viewportMode={viewportMode}
          zoom={zoom}
          onViewportChange={setViewportMode}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onResetZoom={resetZoom}
          onZoomToFit={zoomToFit}
          onAutofit={autofit}
        />

        {/* Undo/Redo Buttons (hidden in preview mode) */}
        {!isPreviewMode && (
          <div className="flex justify-end gap-0">
            <Button
              size="sm"
              variant="ghost"
              onClick={handleUndo}
              disabled={!canUndo || isUndoRedoLoading}
              title="Undo (⌘Z)"
            >
              <Icon name="undo" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleRedo}
              disabled={!canRedo || isUndoRedoLoading}
              title="Redo (⌘⇧Z)"
            >
              <Icon name="redo" />
            </Button>
          </div>
        )}
      </div>

      {/* Text Editor Toolbar - shown when editing text */}
      {isTextEditing && !isPreviewMode && (
        <div className="absolute top-0 h-16.25 left-0 right-0 z-50 flex items-center justify-center gap-2 px-4 bg-background border-b">
          {/* Heading/Paragraph Dropdown - hidden for heading and text elements (they use the Tag selector in the sidebar) */}
          {selectedLayerName !== 'heading' && selectedLayerName !== 'text' && (
            <Select
              value={
                textEditorActiveMarks.headingLevel
                  ? `h${textEditorActiveMarks.headingLevel}`
                  : 'paragraph'
              }
              onValueChange={(value) => {
                if (value === 'paragraph') {
                  setHeading(null);
                } else {
                  const level = parseInt(value.replace('h', '')) as 1 | 2 | 3 | 4 | 5 | 6;
                  setHeading(level);
                }
              }}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="paragraph">Paragraph</SelectItem>
                <SelectItem value="h1">Heading 1</SelectItem>
                <SelectItem value="h2">Heading 2</SelectItem>
                <SelectItem value="h3">Heading 3</SelectItem>
                <SelectItem value="h4">Heading 4</SelectItem>
                <SelectItem value="h5">Heading 5</SelectItem>
                <SelectItem value="h6">Heading 6</SelectItem>
              </SelectContent>
            </Select>
          )}

          {/* Link Button */}
          {textEditor && (() => {
            // Find the current layer being edited
            let editingLayer: Layer | null = null;
            let layersToSearch: Layer[] = [];
            if (editingLayerId) {
              if (editingComponentId && activeComponentVariantId) {
                layersToSearch = componentDrafts[editingComponentId]?.[activeComponentVariantId] || [];
              } else if (currentPageId) {
                layersToSearch = currentDraft ? currentDraft.layers : [];
              }
              editingLayer = findLayerById(layersToSearch, editingLayerId);
            }

            // Check if layer can have rich text links
            const { canHaveLinks } = editingLayer
              ? canLayerHaveLink(editingLayer, layersToSearch, 'richText')
              : { canHaveLinks: true };

            return canHaveLinks ? (
              <ToggleGroup
                type="single"
                size="xs"
                variant="secondary"
                spacing={1}
              >
                <RichTextLinkPopover
                  editor={textEditor}
                  fieldGroups={fieldGroups}
                  allFields={collectionFieldsFromStore}
                  collections={collectionsFromStore}
                  isInsideCollectionLayer={!!editingLayerParentCollection}
                  layer={editingLayer}
                  open={textEditorLinkPopoverOpen}
                  onOpenChange={setTextEditorLinkPopoverOpen}
                  disabled={false}
                  trigger={
                    <ToggleGroupItem
                      value="link"
                      data-state={textEditorActiveMarks.richTextLink ? 'on' : 'off'}
                      asChild
                    >
                      <button
                        type="button" title="Link"
                        className="w-auto min-w-0 shrink-0"
                      >
                        <Icon name="link" className="size-3" />
                      </button>
                    </ToggleGroupItem>
                  }
                />
              </ToggleGroup>
            ) : (
              <ToggleGroup
                type="single" size="xs"
                variant="secondary" spacing={1}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <ToggleGroupItem
                      value="link" disabled
                      asChild
                    >
                      <button type="button" className="w-auto min-w-0 shrink-0">
                        <Icon name="link" className="size-3" />
                      </button>
                    </ToggleGroupItem>
                  </TooltipTrigger>
                  <TooltipContent>Links cannot be nested</TooltipContent>
                </Tooltip>
              </ToggleGroup>
            );
          })()}

          {/* Text formatting */}
          <ToggleGroup
            type="multiple"
            size="xs"
            variant="secondary"
            spacing={1}
          >
            <ToggleGroupItem
              value="bold"
              data-state={textEditorActiveMarks.bold ? 'on' : 'off'}
              onMouseDown={(e) => {
                e.preventDefault();
                toggleBold();
              }}
              title="Bold (⌘B)"
            >
              <Icon name="bold" className="size-3" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="italic"
              data-state={textEditorActiveMarks.italic ? 'on' : 'off'}
              onMouseDown={(e) => {
                e.preventDefault();
                toggleItalic();
              }}
              title="Italic (⌘I)"
            >
              <Icon name="italic" className="size-3" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="underline"
              data-state={textEditorActiveMarks.underline ? 'on' : 'off'}
              onMouseDown={(e) => {
                e.preventDefault();
                toggleUnderline();
              }}
              title="Underline (⌘U)"
            >
              <Icon name="underline" className="size-3" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="strike"
              data-state={textEditorActiveMarks.strike ? 'on' : 'off'}
              onMouseDown={(e) => {
                e.preventDefault();
                toggleStrike();
              }}
              title="Strikethrough"
            >
              <Icon name="strikethrough" className="size-3" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="superscript"
              data-state={textEditorActiveMarks.superscript ? 'on' : 'off'}
              onMouseDown={(e) => {
                e.preventDefault();
                toggleSuperscript();
              }}
              title="Superscript"
            >
              <Icon name="superscript" className="size-3" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="subscript"
              data-state={textEditorActiveMarks.subscript ? 'on' : 'off'}
              onMouseDown={(e) => {
                e.preventDefault();
                toggleSubscript();
              }}
              title="Subscript"
            >
              <Icon name="subscript" className="size-3" />
            </ToggleGroupItem>
          </ToggleGroup>

          {/* Inline Variable Button */}
          {textFieldGroups.length > 0 && (
            <ToggleGroup
              type="single"
              size="xs"
              variant="secondary"
              spacing={1}
            >
              <DropdownMenu
                open={textEditorVariableDropdownOpen}
                onOpenChange={setTextEditorVariableDropdownOpen}
              >
                <DropdownMenuTrigger asChild>
                  <ToggleGroupItem value="variable" asChild>
                    <button
                      type="button" title="Insert Variable"
                      className="w-auto min-w-0 shrink-0"
                    >
                      <Icon name="database" className="size-3" />
                    </button>
                  </ToggleGroupItem>
                </DropdownMenuTrigger>

                {fieldGroups && (
                  <DropdownMenuContent
                    className="w-56 py-1 px-1 max-h-none!"
                    align="start"
                    sideOffset={4}
                  >
                    <CollectionFieldSelector
                      fieldGroups={textFieldGroups}
                      allFields={collectionFieldsFromStore}
                      collections={collectionsFromStore}
                      onSelect={(fieldId, relationshipPath, source) => {
                        const flatFields = flattenFieldGroups(fieldGroups);
                        const field = flatFields.find(f => f.id === fieldId);
                        addFieldVariable(
                          buildFieldVariableData(fieldId, relationshipPath, field?.type ?? null, source),
                          flatFields,
                          collectionFieldsFromStore
                        );
                        setTextEditorVariableDropdownOpen(false);
                      }}
                    />
                  </DropdownMenuContent>
                )}
              </DropdownMenu>
            </ToggleGroup>
          )}

          {/*<span className="text-xs text-muted-foreground mr-0.5">*/}
          {/*  Press <kbd className="mx-0.5 px-1.5 py-0.75 bg-secondary rounded text-[10px] text-foreground">ESC</kbd> to*/}
          {/*</span>*/}

          {/*<Button size="xs" variant="secondary" onClick={() => {*/}
          {/*    requestFinishEditing();*/}
          {/*  }}>*/}
          {/*  Close*/}
          {/*</Button>*/}
        </div>
      )}

      {/* Canvas Area */}
      <div
        ref={canvasContainerRef}
        className="flex-1 relative overflow-hidden bg-neutral-50 dark:bg-neutral-950/80 select-none"
      >
        {/* Loading skeleton overlay when draft is being fetched */}
        {isDraftLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-neutral-50/80 dark:bg-neutral-950/80 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <div className="w-8 h-8 border-2 border-current border-t-transparent rounded-full animate-spin" />
              <span className="text-sm">Loading page...</span>
            </div>
          </div>
        )}

        {/* Selection overlay - renders outlines on top of the iframe */}
        {!isPreviewMode && activeSidebarTab !== 'pages' && canvasIframeElement && (
          <SelectionOverlay
            iframeElement={canvasIframeElement}
            containerElement={scrollContainerRef.current}
            selectedLayerId={selectedLayerId}
            parentLayerId={parentLayerId}
            zoom={zoom}
            activeSublayerIndex={activeSublayerIndex}
            activeListItemIndex={activeListItemIndex}
          />
        )}

        {/* Drag capture overlay - prevents iframe from swallowing mouse events during drag */}
        {!isPreviewMode && <DragCaptureOverlay />}

        {/* Element picker SVG connector overlay */}
        <ElementPickerOverlay iframeElement={canvasIframeElement} zoom={zoom} />

        {/* Translation loading overlay — shown while translations for the
            active locale are being fetched. Mirrors the preview-mode overlay
            below for visual consistency. */}
        {isLocalizing && isLoadingTranslations && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-background/80">
            <Spinner />
          </div>
        )}

        {/* Scrollable container with hidden scrollbars (editor canvas) */}
        <div
          ref={scrollContainerRef}
          className={cn(
            'absolute inset-0 z-0 overflow-auto',
            elementPicker?.active && 'cursor-crosshair'
          )}
          style={{
            opacity: isCanvasReady ? 1 : 0,
            scrollbarWidth: 'none', // Firefox
            msOverflowStyle: 'none', // IE/Edge
            WebkitOverflowScrolling: 'touch',
          }}
          onClick={handleCanvasClick}
        >
          {/* Hide scrollbars for Webkit browsers */}
          <style jsx>{`
            div::-webkit-scrollbar {
              display: none;
            }
          `}</style>

          {/* Editor mode: Scaled canvas with zoom controls - always in DOM, never resized */}
          <div
            style={{
              position: 'relative',
              minWidth: '100%',
              minHeight: '100%',
              // When editing a component, center the canvas inside the scroll area.
              // Page editing keeps default block flow so absolute overlays anchor at the top.
              ...(editingComponentId
                ? { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }
                : null),
            }}
          >
              <div
                style={{
                  // Width: exact scaled size, min 100% to fill viewport horizontally
                  width: `${effectiveCanvasWidth * (zoom / 100) + CANVAS_PADDING}px`,
                  minWidth: '100%',
                  // Height: scaled iframe size + canvas padding. finalIframeHeight is
                  // already stretched to fill the viewport at any zoom level, so the
                  // white canvas always fills the available height.
                  height: `${finalIframeHeight * (zoom / 100) + CANVAS_PADDING}px`,
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'center',
                  paddingTop: `${CANVAS_BORDER}px`,
                  position: 'relative',
                }}
              >
                <div
                  className={editingComponentId ? 'relative' : 'bg-white shadow-3xl relative'}
                  style={{
                    zoom: zoom / 100,
                    width: `${effectiveCanvasWidth}px`,
                    height: `${finalIframeHeight}px`,
                    flexShrink: 0, // Prevent shrinking - maintain fixed size
                    // No transition to prevent shifts
                    transition: 'none',
                    // Clip overflow when canvas is smaller than iframe (component editing)
                    overflow: editingComponentId ? 'hidden' : undefined,
                  }}
                >
                  {/* Inner wrapper: keep iframe at viewport width for natural content rendering */}
                  <div
                    style={{
                      width: editingComponentId && effectiveCanvasWidth < viewportWidth
                        ? `${viewportWidth}px`
                        : '100%',
                      height: '100%',
                    }}
                  >
                  {/* Canvas for editor */}
                  {layers.length > 0 ? (
                    <>
                      <Canvas
                        key={`editor-${currentPageId}`}
                        layers={layers}
                        components={components}
                        selectedLayerId={selectedLayerId}
                        hoveredLayerId={null}
                        breakpoint={viewportMode}
                        activeUIState={activeUIState}
                        editingComponentId={editingComponentId || null}
                        collectionItems={mergedCollectionItems}
                        collectionFields={collectionFieldsFromStore}
                        pageCollectionItem={translatedPageCollectionItem}
                        pageCollectionFields={pageCollectionFields}
                        currentLocale={selectedLocale}
                        availableLocales={locales}
                        translations={localeTranslations}
                        assets={assetsMap}
                        pageId={currentPageId || ''}
                        onLayerClick={handleCanvasLayerClick}
                        onLayerUpdate={handleCanvasLayerUpdate}
                        onDeleteLayer={handleCanvasDeleteLayer}
                        onContentHeightChange={setReportedContentHeight}
                        onContentWidthChange={editingComponentId ? setReportedContentWidth : undefined}
                        onGapUpdate={handleCanvasGapUpdate}
                        onZoomGesture={handleZoomGesture}
                        onZoomIn={zoomIn}
                        onZoomOut={zoomOut}
                        onResetZoom={resetZoom}
                        onZoomToFit={zoomToFit}
                        onAutofit={autofit}
                        onUndo={handleUndo}
                        onRedo={handleRedo}
                        liveLayerUpdates={liveLayerUpdates}
                        liveComponentUpdates={liveComponentUpdates}
                        onIframeReady={handleIframeReady}
                        onLayerHover={handleCanvasLayerHover}
                        onCanvasClick={handleCanvasClick}
                        onComponentEdit={handleCanvasComponentEdit}
                        editingComponentVariables={editingComponentVariables}
                        forceVisibleLayerIds={activeInteractionTriggerLayerId ? activeInteractionTargetLayerIds : undefined}
                        zoom={zoom}
                        referenceViewportHeight={defaultCanvasHeight}
                      />

                      {/* Drop indicator overlay - subscribes to store directly */}
                      <CanvasDropIndicatorOverlay iframeElement={canvasIframeElement} />

                      {/* Sibling reorder indicator overlay - for drag-to-reorder on canvas */}
                      <CanvasSiblingReorderOverlay iframeElement={canvasIframeElement} />

                      {/* Empty overlay when only Body with no children */}
                      {isCanvasEmpty && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                          <div className="pointer-events-auto">
                            <Empty className="bg-transparent border-0 text-neutral-900">
                              <EmptyContent>
                                <EmptyMedia variant="icon" className="size-9 mb-0 bg-neutral-900/5">
                                  <Icon name="layout" className="size-3 text-neutral-900" />
                                </EmptyMedia>
                                <EmptyHeader>
                                  <EmptyTitle className="text-sm">Start building</EmptyTitle>
                                  <EmptyDescription>
                                    Add your first block to begin creating your page.
                                  </EmptyDescription>
                                </EmptyHeader>
                                <Button
                                  onClick={(e) => {
                                    // Stop propagation to prevent canvas click handler from
                                    // dispatching closeElementLibrary and immediately closing the panel
                                    e.stopPropagation();
                                    // Open ElementLibrary with layouts tab active
                                    window.dispatchEvent(new CustomEvent('toggleElementLibrary', {
                                      detail: { tab: 'layouts' }
                                    }));
                                  }}
                                  size="sm"
                                  variant="secondary"
                                  className="bg-neutral-900/5 hover:bg-neutral-900/10 text-neutral-900"
                                >
                                  <Icon name="plus" />
                                  Add layout
                                </Button>
                              </EmptyContent>
                            </Empty>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center p-12">
                      <div className="text-center max-w-md relative">
                        <div className="w-20 h-20 bg-linear-to-br from-blue-100 to-blue-50 rounded-2xl mx-auto mb-6 flex items-center justify-center">
                          <Icon name="layout" className="w-10 h-10 text-blue-500" />
                        </div>
                        <h2 className="text-2xl font-bold text-gray-900 mb-3">
                          Start building
                        </h2>
                        <p className="text-gray-600 mb-8">
                          Add your first block to begin creating your page.
                        </p>
                        <div className="relative inline-block">
                          <Button
                            onClick={() => setShowAddBlockPanel(!showAddBlockPanel)}
                            size="lg"
                            className="gap-2"
                            disabled={!!(selectedLocale && !selectedLocale.is_default)}
                          >
                            <Icon name="plus" className="w-5 h-5" />
                            Add Block
                          </Button>

                          {/* Add Block Panel */}
                          {showAddBlockPanel && currentPageId && (
                            <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 z-50 bg-white border border-gray-200 rounded-lg shadow-2xl min-w-60">
                              <div className="p-2">
                                <div className="text-xs text-gray-500 px-3 py-2 mb-1 font-medium">Choose a block</div>

                                <Button
                                  onClick={() => {
                                    // Always add inside Body container
                                    const result = addLayerFromTemplate(currentPageId, 'body', 'div');
                                    if (result && liveLayerUpdates) {
                                      // Get FRESH state and find actual parent
                                      const freshDraft = usePagesStore.getState().draftsByPageId[currentPageId];
                                      if (freshDraft) {
                                        const findLayerWithParent = (layers: Layer[], id: string, parent: Layer | null = null): { layer: Layer; parent: Layer | null } | null => {
                                          for (const l of layers) {
                                            if (l.id === id) return { layer: l, parent };
                                            if (l.children) {
                                              const found = findLayerWithParent(l.children, id, l);
                                              if (found) return found;
                                            }
                                          }
                                          return null;
                                        };
                                        const found = findLayerWithParent(freshDraft.layers, result.newLayerId);
                                        if (found?.layer) {
                                          const actualParentId = found.parent?.id || null;
                                          liveLayerUpdates.broadcastLayerAdd(currentPageId, actualParentId, 'div', found.layer);
                                        }
                                      }
                                    }
                                    setShowAddBlockPanel(false);
                                  }}
                                  variant="ghost"
                                  className="w-full justify-start gap-3 px-3 py-3 h-auto"
                                >
                                  <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center shrink-0">
                                    <Icon name="container" className="w-5 h-5 text-gray-700" />
                                  </div>
                                  <div className="text-left">
                                    <div className="text-sm font-semibold text-gray-900">Div</div>
                                    <div className="text-xs text-gray-500">Container element</div>
                                  </div>
                                </Button>

                                <Button
                                  onClick={() => {
                                    // Always add inside Body container
                                    const result = addLayerFromTemplate(currentPageId, 'body', 'heading');
                                    if (result && liveLayerUpdates) {
                                      // Get FRESH state and find actual parent
                                      const freshDraft = usePagesStore.getState().draftsByPageId[currentPageId];
                                      if (freshDraft) {
                                        const findLayerWithParent = (layers: Layer[], id: string, parent: Layer | null = null): { layer: Layer; parent: Layer | null } | null => {
                                          for (const l of layers) {
                                            if (l.id === id) return { layer: l, parent };
                                            if (l.children) {
                                              const found = findLayerWithParent(l.children, id, l);
                                              if (found) return found;
                                            }
                                          }
                                          return null;
                                        };
                                        const found = findLayerWithParent(freshDraft.layers, result.newLayerId);
                                        if (found?.layer) {
                                          const actualParentId = found.parent?.id || null;
                                          liveLayerUpdates.broadcastLayerAdd(currentPageId, actualParentId, 'heading', found.layer);
                                        }
                                      }
                                    }
                                    setShowAddBlockPanel(false);
                                  }}
                                  variant="ghost"
                                  className="w-full justify-start gap-3 px-3 py-3 h-auto"
                                >
                                  <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center shrink-0">
                                    <Icon name="heading" className="w-5 h-5 text-gray-700" />
                                  </div>
                                  <div className="text-left">
                                    <div className="text-sm font-semibold text-gray-900">Heading</div>
                                    <div className="text-xs text-gray-500">Title text</div>
                                  </div>
                                </Button>

                                <Button
                                  onClick={() => {
                                    // Always add inside Body container
                                    const result = addLayerFromTemplate(currentPageId, 'body', 'text');
                                    if (result && liveLayerUpdates) {
                                      // Get FRESH state and find actual parent
                                      const freshDraft = usePagesStore.getState().draftsByPageId[currentPageId];
                                      if (freshDraft) {
                                        const findLayerWithParent = (layers: Layer[], id: string, parent: Layer | null = null): { layer: Layer; parent: Layer | null } | null => {
                                          for (const l of layers) {
                                            if (l.id === id) return { layer: l, parent };
                                            if (l.children) {
                                              const found = findLayerWithParent(l.children, id, l);
                                              if (found) return found;
                                            }
                                          }
                                          return null;
                                        };
                                        const found = findLayerWithParent(freshDraft.layers, result.newLayerId);
                                        if (found?.layer) {
                                          const actualParentId = found.parent?.id || null;
                                          liveLayerUpdates.broadcastLayerAdd(currentPageId, actualParentId, 'text', found.layer);
                                        }
                                      }
                                    }
                                    setShowAddBlockPanel(false);
                                  }}
                                  variant="ghost"
                                  className="w-full justify-start gap-3 px-3 py-3 h-auto"
                                >
                                  <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center shrink-0">
                                    <Icon name="type" className="w-5 h-5 text-gray-700" />
                                  </div>
                                  <div className="text-left">
                                    <div className="text-sm font-semibold text-gray-900">Paragraph</div>
                                    <div className="text-xs text-gray-500">Body text</div>
                                  </div>
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  </div>
                </div>
              </div>
            </div>
        </div>

      </div>

      {/* Preview panel - fixed overlay covering sidebars + canvas below the main header.
          Always rendered so the iframe stays mounted (no reload on toggle). */}
      <div
        className="flex flex-col bg-neutral-50 dark:bg-neutral-950"
        style={{
          position: 'fixed',
          top: '3.5rem', // h-14 header height
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 50,
          display: isPreviewMode ? 'flex' : 'none',
        }}
      >
        {/* Preview toolbar */}
        <div className="shrink-0 grid grid-cols-3 items-center p-4 border-b bg-background">
          <div />
          <ViewportZoomControls
            viewportMode={viewportMode}
            zoom={previewZoom}
            onViewportChange={setViewportMode}
            onZoomIn={previewZoomIn}
            onZoomOut={previewZoomOut}
            onResetZoom={previewResetZoom}
            onZoomToFit={previewZoomToFit}
            onAutofit={previewAutofit}
          />
          <div className="flex justify-end">
            {previewUrl && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => window.open(previewUrl, '_blank')}
              >
                Open in new tab
                <Icon name="external-link" />
              </Button>
            )}
          </div>
        </div>

        {/* Preview iframe area */}
        <div
          ref={previewContainerRef}
          className="flex-1 relative flex items-start overflow-auto"
          style={{ padding: `${CANVAS_BORDER}px` }}
        >
          {isPreviewLoading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-background">
              <Spinner />
            </div>
          )}
          <div
            className="bg-white shadow-3xl relative mx-auto my-auto"
            style={{
              zoom: previewZoom / 100,
              width: viewportMode === 'desktop' && previewZoomMode === 'autofit'
                ? '100%'
                : viewportSizes[viewportMode].width,
              minWidth: viewportMode === 'desktop' && previewZoomMode === 'autofit'
                ? viewportSizes[viewportMode].width
                : undefined,
              height: finalPreviewIframeHeight > 0 ? `${finalPreviewIframeHeight}px` : '100%',
              flexShrink: 0,
              transition: 'none',
            }}
          >
            {layers.length > 0 && isPreviewMode ? (
              <iframe
                ref={iframeRef}
                src={previewUrl}
                className="w-full h-full border-0"
                title="Preview"
                tabIndex={-1}
                onLoad={handlePreviewLoad}
              />
            ) : layers.length === 0 && isPreviewMode ? (
              <div className="w-full h-full flex items-center justify-center p-12">
                <div className="text-center max-w-md">
                  <div className="w-20 h-20 bg-linear-to-br from-blue-100 to-blue-50 rounded-2xl mx-auto mb-6 flex items-center justify-center">
                    <Icon name="layout" className="w-10 h-10 text-blue-500" />
                  </div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-3">
                    No content
                  </h2>
                  <p className="text-gray-600">
                    This page has no content to preview.
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Rich text sheet for canvas double-click on layers with components/variables */}
      {richTextSheetValue && (
        <RichTextEditorSheet
          open={!!richTextSheetLayerId}
          onOpenChange={(open) => {
            if (!open) {
              flushRichTextTranslationSave();
              closeRichTextSheet();
            }
          }}
          title="Content editor"
          description={richTextTranslationContext && selectedLocale
            ? `Translate to ${selectedLocale.label}`
            : 'Element content'}
          value={richTextSheetValue}
          onChange={handleRichTextSheetChange}
          fieldGroups={richTextSheetFieldGroups}
          allFields={collectionFieldsFromStore}
          collections={collectionsFromStore}
        />
      )}
    </div>
  );
});

export default CenterCanvas;
