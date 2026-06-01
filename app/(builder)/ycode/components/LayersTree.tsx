'use client';

/**
 * LayersTree Component - Advanced Hierarchical Tree with Smart Drop Zones
 *
 * Custom @dnd-kit implementation with:
 * - Smart 25/50/25 drop zone detection
 * - Container-aware drop behavior
 * - Visual hierarchy indicators
 * - Descendant validation
 * - Custom drag overlays with offset
 * - Depth-aware positioning
 */

// 1. React/Next.js
import React, { useMemo, useState, useCallback, useEffect, useRef, useLayoutEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

// 2. External libraries
import { DndContext, DragOverlay, DragStartEvent, DragEndEvent, DragOverEvent, DragMoveEvent, PointerSensor, useSensor, useSensors, pointerWithin, closestCenter, useDraggable, useDroppable } from '@dnd-kit/core';
import type { CollisionDetection } from '@dnd-kit/core';
import { Layers as LayersIcon, Component as ComponentIcon } from 'lucide-react';

// 4. Internal components
import LayerContextMenu from './LayerContextMenu';

// 5. Stores
import { useEditorStore } from '@/stores/useEditorStore';
import { useLayerStylesStore } from '@/stores/useLayerStylesStore';
import { useComponentsStore } from '@/stores/useComponentsStore';
import { useCollectionsStore } from '@/stores/useCollectionsStore';
import { useLocalisationStore } from '@/stores/useLocalisationStore';

import { usePagesStore } from '@/stores/usePagesStore';
import { useCollaborationPresenceStore, getResourceLockKey, RESOURCE_TYPES } from '@/stores/useCollaborationPresenceStore';
import { useAuthStore } from '@/stores/useAuthStore';

// 6. Utils/lib
import { cn } from '@/lib/utils';
import { flattenTree, type FlattenedItem } from '@/lib/tree-utilities';
import { canHaveChildren, getCollectionVariable, isTextContentLayer, isRichTextLayer, hasRichTextContent, getRichTextSublayers, getTextStyleSublayers, canMoveLayer, updateLayerProps, filterDisabledSliderLayers, getLayerCmsFieldBinding, extractBlockText } from '@/lib/layer-utils';
import { getLayerIcon, getLayerName } from '@/lib/layer-display-utils';
import { getBlockName } from '@/lib/templates/blocks';
import { MULTI_ASSET_COLLECTION_ID } from '@/lib/collection-field-utils';
import { hasStyleOverrides } from '@/lib/layer-style-utils';
import { getUserInitials, getDisplayName } from '@/lib/collaboration-utils';
import { getBreakpointPrefix } from '@/lib/breakpoint-utils';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { CollaboratorBadge } from '@/components/collaboration/CollaboratorBadge';
import { DropLineIndicator } from '@/components/DropIndicators';

// 7. Types
import type { Layer, Breakpoint } from '@/types';
import type { UseLiveLayerUpdatesReturn } from '@/hooks/use-live-layer-updates';
import type { UseLiveComponentUpdatesReturn } from '@/hooks/use-live-component-updates';
import Icon from '@/components/ui/icon';

/**
 * Pointer-first collision detection for vertical tree rows.
 * Uses pointerWithin to accurately detect which row the cursor is over,
 * falling back to closestCenter when the pointer is between rows or in gaps.
 */
const pointerFirstCollision: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) {
    return pointerCollisions;
  }
  return closestCenter(args);
};

/** Calculate drop position (above/below/inside) based on cursor Y within a row. */
function calcDropPosition(
  relativeY: number,
  isContainer: boolean,
  hasVisibleChildren: boolean,
): 'above' | 'below' | 'inside' {
  if (isContainer) {
    const edge = hasVisibleChildren ? 0.15 : 0.10;
    if (relativeY < edge) return 'above';
    if (relativeY > 1 - edge) return 'below';
    return 'inside';
  }
  return relativeY < 0.5 ? 'above' : 'below';
}

/**
 * Get display label for a layer - returns text content for text layers, otherwise layer name.
 * Uses extractBlockText (same function that powers RichText sublayer labels).
 */
function getLayerDisplayLabel(
  layer: Layer,
  context?: {
    component_name?: string | undefined | null;
    collection_name?: string | undefined | null;
    source_field_name?: string | undefined | null;
  },
  breakpoint?: Breakpoint
): string {
  // For text content layers (heading/text), skip customName early return if it matches
  // the default block name so we can show actual text content instead.
  // Rich Text parent elements always use their static label.
  const isTextLayer = isTextContentLayer(layer);
  const hasUserRename = layer.customName && layer.customName !== (getBlockName(layer.name) || '');

  if (hasUserRename) {
    return layer.customName!;
  }

  // Component instances: prefer the component's name over the underlying
  // block's default customName (e.g. a `section` layer converted to a
  // component would otherwise display as "Section" instead of the
  // component's actual name).
  if (!isTextLayer && !layer.componentId && layer.customName) {
    return layer.customName;
  }

  if (isTextLayer) {
    const textVar = layer.variables?.text as { type: string; data?: { content?: unknown } } | undefined;
    if (textVar) {
      let textContent = '';
      if (textVar.type === 'dynamic_rich_text' && textVar.data?.content) {
        textContent = extractBlockText(textVar.data.content);
      } else if ((textVar.type === 'dynamic_text' || textVar.type === 'static_text') && textVar.data?.content) {
        textContent = String(textVar.data.content);
      }

      const trimmed = textContent.trim();
      if (trimmed) {
        return trimmed.length > 30 ? trimmed.slice(0, 30) + '...' : trimmed;
      }
    }
  }

  return getLayerName(layer, context, breakpoint);
}

interface LayerTreeStoreValues {
  getComponentById: ReturnType<typeof useComponentsStore.getState>['getComponentById'];
  collections: ReturnType<typeof useCollectionsStore.getState>['collections'];
  fieldsByCollectionId: ReturnType<typeof useCollectionsStore.getState>['fields'];
  selectLayerWithSublayer: ReturnType<typeof useEditorStore.getState>['selectLayerWithSublayer'];
  editingComponentId: string | null;
  interactionTriggerLayerIds: string[];
  interactionTargetLayerIds: string[];
  activeInteractionTriggerLayerId: string | null;
  activeInteractionTargetLayerIds: string[];
  activeUIState: string;
}

const LayerTreeStoreContext = React.createContext<LayerTreeStoreValues>(null!);

interface LayersTreeProps {
  layers: Layer[];
  onLayerSelect: (layerId: string) => void;
  onReorder: (newLayers: Layer[], movedLayerId?: string) => void;
  pageId: string;
  liveLayerUpdates?: UseLiveLayerUpdatesReturn | null;
  liveComponentUpdates?: UseLiveComponentUpdatesReturn | null;
  readOnly?: boolean;
}

const ROW_HEIGHT = 32;

interface DndInfo {
  attributes: Record<string, unknown>;
  listeners: Record<string, unknown>;
  setRowElement: (el: HTMLDivElement | null) => void;
}

const DndInfoContext = React.createContext<React.MutableRefObject<DndInfo>>(null!);

interface VirtualLayerRowProps {
  nodeId: string;
  isRenaming: boolean;
  isLocalizing: boolean;
  translateY: number;
  children: React.ReactNode;
}

/**
 * Wrapper that owns dnd-kit hooks so the inner memoized LayerRow
 * is shielded from DndContext re-renders. Passes dnd info via a
 * stable ref context so LayerRow can apply it to its content div.
 */
function VirtualLayerRow({ nodeId, isRenaming, isLocalizing, translateY, children }: VirtualLayerRowProps) {
  const { setNodeRef: setDropRef } = useDroppable({ id: nodeId });
  const { attributes, listeners, setNodeRef: setDragRef } = useDraggable({
    id: nodeId,
    disabled: isRenaming || isLocalizing,
  });

  const elementRef = useRef<HTMLDivElement | null>(null);
  const dragRefFn = useRef(setDragRef);
  const dropRefFn = useRef(setDropRef);
  dragRefFn.current = setDragRef;
  dropRefFn.current = setDropRef;

  // Stable ref callback — identity never changes
  const setRowElement = useCallback((el: HTMLDivElement | null) => {
    elementRef.current = el;
    dragRefFn.current(el);
    dropRefFn.current(el);
  }, []);

  const dndInfoRef = useRef<DndInfo>({
    attributes: attributes as unknown as Record<string, unknown>,
    listeners: listeners as unknown as Record<string, unknown>,
    setRowElement,
  });
  dndInfoRef.current.attributes = attributes as unknown as Record<string, unknown>;
  dndInfoRef.current.listeners = listeners as unknown as Record<string, unknown>;

  // Re-register DOM element when dnd-kit ref setters change
  useLayoutEffect(() => {
    if (elementRef.current) {
      setDragRef(elementRef.current);
      setDropRef(elementRef.current);
    }
  }, [setDragRef, setDropRef]);

  return (
    <DndInfoContext.Provider value={dndInfoRef}>
      <div
        style={{
          position: 'absolute',
          // Position rows with `top` rather than `transform: translateY`. A
          // transformed ancestor becomes the containing block for the row's
          // `position: sticky` background, which Safari composites incorrectly
          // in a virtualized list — promoting stale, oversized GPU layers that
          // paint the blue selection over (and far beyond) the row, hiding the
          // layer names. Using `top` avoids the transform entirely.
          top: translateY,
          left: 0,
          width: '100%',
          height: ROW_HEIGHT,
        }}
      >
        {children}
      </div>
    </DndInfoContext.Provider>
  );
}

interface LayerRowProps {
  node: FlattenedItem;
  isSelected: boolean;
  isChildOfSelected: boolean;
  isLastVisibleDescendant: boolean;
  hasVisibleChildren: boolean;
  canHaveChildren: boolean;
  isOver: boolean;
  isDragging: boolean;
  isDragActive: boolean;
  dropPosition: 'above' | 'below' | 'inside' | null;
  highlightedDepths: string;
  onSelect: (id: string) => void;
  onMultiSelect: (id: string, modifiers: { meta: boolean; shift: boolean }) => void;
  onToggle: (id: string) => void;
  pageId: string;
  liveLayerUpdates?: UseLiveLayerUpdatesReturn | null;
  liveComponentUpdates?: UseLiveComponentUpdatesReturn | null;
  activeBreakpoint: Breakpoint;
  isRenaming: boolean;
  onRenameStart: (id: string) => void;
  onRenameConfirm: (id: string, newName: string | null) => void;
  onToggleVisibility: (id: string) => void;
  readOnly?: boolean;
}

// Helper to check if a node is a descendant of another
function isDescendant(
  node: FlattenedItem,
  target: FlattenedItem,
  allNodes: FlattenedItem[]
): boolean {
  if (node.id === target.id) return true;

  const parent = allNodes.find((n) => n.id === target.parentId);
  if (!parent) return false;

  return isDescendant(node, parent, allNodes);
}

// LayerRow Component - Individual draggable/droppable tree node
// Memoized to prevent unnecessary re-renders on hover state changes
const LayerRow = React.memo(function LayerRow({
  node,
  isSelected,
  isChildOfSelected,
  isLastVisibleDescendant,
  hasVisibleChildren,
  canHaveChildren,
  isOver,
  isDragging,
  isDragActive,
  dropPosition,
  highlightedDepths,
  onSelect,
  onMultiSelect,
  onToggle,
  pageId,
  liveLayerUpdates,
  liveComponentUpdates,
  activeBreakpoint,
  isRenaming,
  onRenameStart,
  onRenameConfirm,
  onToggleVisibility,
  readOnly,
}: LayerRowProps) {
  const {
    getComponentById,
    collections,
    fieldsByCollectionId,
    selectLayerWithSublayer,
    editingComponentId,
    interactionTriggerLayerIds,
    interactionTargetLayerIds,
    activeInteractionTriggerLayerId,
    activeInteractionTargetLayerIds,
    activeUIState,
  } = React.useContext(LayerTreeStoreContext);
  const isStateActive = activeUIState !== 'neutral';

  // Disable layer drag/drop and add buttons in non-default locales — the tree
  // becomes a read-only map of the page while translating.
  const isLocalizing = useLocalisationStore((state) => {
    const id = state.selectedLocaleId;
    if (!id) return false;
    const locale = state.locales.find((l) => l.id === id);
    return !!(locale && !locale.is_default);
  });

  const dndInfo = React.useContext(DndInfoContext);
  const { attributes, listeners, setRowElement } = dndInfo.current;

  const renameInputRef = React.useRef<HTMLInputElement>(null);
  const renameReadyRef = React.useRef(false);

  // Focus input when rename mode activates
  React.useEffect(() => {
    if (isRenaming) {
      renameReadyRef.current = false;
      const tryFocus = () => {
        if (renameInputRef.current && document.activeElement !== renameInputRef.current) {
          renameInputRef.current.focus();
          const len = renameInputRef.current.value.length;
          renameInputRef.current.setSelectionRange(len, len);
        }
        if (document.activeElement === renameInputRef.current) {
          renameReadyRef.current = true;
        }
      };
      tryFocus();
      const t1 = setTimeout(tryFocus, 50);
      const t2 = setTimeout(tryFocus, 150);
      return () => { clearTimeout(t1); clearTimeout(t2); renameReadyRef.current = false; };
    } else {
      renameReadyRef.current = false;
    }
  }, [isRenaming]);

  const hasChildren = node.layer.children && node.layer.children.length > 0;
  const isCollapsed = node.collapsed || false;

  // Check if this is a component instance
  const appliedComponent = node.layer.componentId ? getComponentById(node.layer.componentId) : null;
  const isComponentInstance = !!appliedComponent;

  // Get collection name if this is a collection layer
  const collectionVariable = getCollectionVariable(node.layer);
  const finalCollectionName = collectionVariable?.id && collectionVariable.id !== MULTI_ASSET_COLLECTION_ID
    ? collections.find(c => c.id === collectionVariable.id)?.name
    : undefined;
  const sourceFieldName = collectionVariable?.source_field_id
    ? (Object.values(fieldsByCollectionId).flat().find((f) => f.id === collectionVariable.source_field_id)?.name ?? null)
    : null;

  // Component instances should not show children in the tree (unless editing master)
  // Children can only be edited via "Edit master component"
  const shouldHideChildren = isComponentInstance && !editingComponentId;
  const hasContentSublayers = hasRichTextContent(node.layer);
  const hasStyleSublayers = isTextContentLayer(node.layer) && getTextStyleSublayers(node.layer).length > 0;
  const hasSublayers = hasContentSublayers || hasStyleSublayers;
  const effectiveHasChildren = (hasChildren && !shouldHideChildren) || hasSublayers;

  // Use purple ONLY for component instances (not for all layers when editing a component)
  const usePurpleStyle = isComponentInstance;

  // Get icon name from blocks template system (breakpoint-aware)
  const layerIcon = getLayerIcon(node.layer, 'box', activeBreakpoint);

  // Check if layer is locked by another user (using unified resource locks)
  const currentUserId = useAuthStore((state) => state.user?.id);
  const lockKey = getResourceLockKey(RESOURCE_TYPES.LAYER, node.id);
  const lock = useCollaborationPresenceStore((state) => state.resourceLocks[lockKey]);
  // Access lock directly from state to avoid stale closure issues
  const lockOwnerUser = useCollaborationPresenceStore((state) => {
    const currentLock = state.resourceLocks[lockKey];
    return currentLock?.user_id ? state.users[currentLock.user_id] : null;
  });
  const isLockedByOther = !!(lock && lock.user_id !== currentUserId && Date.now() <= lock.expires_at);

  // Check if this is the Body layer (locked)
  const isLocked = node.layer.id === 'body';

  // Hover is driven by CSS :hover (via `group-hover/row:` on the wrapper) so
  // each mouseover/leave doesn't queue a React commit. Background colors for
  // both states are computed once per render and applied through CSS variables.
  const canHover = !isDragActive && !isDragging && !isLockedByOther;

  const rowBg = isSelected && !usePurpleStyle && !isStateActive
    ? 'var(--primary)'
    : isSelected && !usePurpleStyle && isStateActive
      ? '#8dd92f'
      : isSelected && usePurpleStyle
        ? 'rgb(168 85 247)'
        : isChildOfSelected && !usePurpleStyle && !isStateActive
          ? 'color-mix(in oklch, var(--primary) 15%, var(--background))'
          : isChildOfSelected && !usePurpleStyle && isStateActive
            ? 'color-mix(in oklch, #8dd92f 15%, var(--background))'
            : isChildOfSelected && usePurpleStyle
              ? 'color-mix(in oklch, rgb(168 85 247) 10%, var(--background))'
              : 'transparent';

  const rowHoverBg = !canHover || isSelected
    ? rowBg
    : isChildOfSelected && !usePurpleStyle && !isStateActive
      ? 'color-mix(in oklch, var(--primary) 20%, var(--background))'
      : isChildOfSelected && !usePurpleStyle && isStateActive
        ? 'color-mix(in oklch, #8dd92f 20%, var(--background))'
        : isChildOfSelected && usePurpleStyle
          ? rowBg
          : 'color-mix(in oklch, var(--foreground) 8%, var(--background))';

  // The icon area sits on top of the row content, so its background must be
  // opaque to hide long layer names that scroll behind it. When the row itself
  // has no background, fall back to the panel background.
  const deriveIconBg = (bg: string) => bg === 'transparent' ? 'var(--background)' : bg;

  const iconBg = deriveIconBg(rowBg);
  const iconHoverBg = deriveIconBg(rowHoverBg);

  // Sublayer rows (content blocks or text style targets)
  if (node.sublayer) {
    const handleSublayerClick = () => {
      if (node.sublayer!.kind === 'content') {
        selectLayerWithSublayer(node.layer.id, {
          textStyleKey: node.sublayer!.styleKey ?? null,
          sublayerIndex: node.index,
          listItemIndex: null,
        });
      } else if (node.sublayer!.kind === 'listItem') {
        const parentBlockIdx = node.parentId?.match(/__sub_(\d+)$/)?.[1];
        selectLayerWithSublayer(node.layer.id, {
          textStyleKey: 'listItem',
          sublayerIndex: parentBlockIdx !== undefined ? parseInt(parentBlockIdx, 10) : node.index,
          listItemIndex: node.sublayer!.itemIndex ?? null,
        });
      } else {
        selectLayerWithSublayer(node.layer.id, {
          textStyleKey: node.sublayer!.styleKey ?? null,
          sublayerIndex: null,
          listItemIndex: null,
        });
      }
    };

    const hasExpandableChildren = node.canHaveChildren;
    const isSubCollapsed = node.collapsed || false;

    return (
      <div className="relative flex" style={{ width: '100%', minWidth: '100%' }}>
        {/* Background layer - stays fixed */}
        <div className="absolute inset-0 pointer-events-none z-0">
          <div
            className={cn(
              'sticky left-0 h-full',
              isSelected && !isStateActive && 'bg-primary rounded-lg',
              isSelected && isStateActive && 'bg-[#8dd92f] rounded-lg',
              !isSelected && isChildOfSelected && !isStateActive && 'dark:bg-primary/15 bg-primary/10',
              !isSelected && isChildOfSelected && isStateActive && 'dark:bg-[#8dd92f]/15 bg-[#8dd92f]/10',
              !isSelected && isChildOfSelected && isLastVisibleDescendant && 'rounded-b-lg',
              !isSelected && isChildOfSelected && !isLastVisibleDescendant && 'rounded-none',
              !isSelected && !isChildOfSelected && 'rounded-lg',
            )}
            style={{ width: 'var(--tree-available-width)' }}
          />
        </div>

        {/* Content layer */}
        <div className="relative z-10 flex w-full min-w-full flex-1">
          {node.depth > 0 && (
            <>
              {Array.from({ length: node.depth }).map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    'absolute z-10 top-0 bottom-0 w-px pointer-events-none',
                    (isChildOfSelected || isSelected) ? 'dark:bg-white/10 bg-neutral-900/10' : 'dark:bg-secondary bg-neutral-900/10',
                  )}
                  style={{ left: `${i * 14 + 16}px` }}
                />
              ))}
            </>
          )}
          <div
            className={cn(
              'group relative flex items-center h-8 cursor-pointer',
              isSelected && !isStateActive && 'text-primary-foreground',
              isSelected && isStateActive && 'text-black',
              !isSelected && isChildOfSelected && 'text-current/70',
              !isSelected && !isChildOfSelected && 'text-secondary-foreground/80 dark:text-muted-foreground',
            )}
            style={{ width: 'max-content', minWidth: '100%' }}
            onClick={handleSublayerClick}
          >
            {/* Indent spacer */}
            <div style={{ width: `${node.depth * 14 + 8}px`, flex: 'none' }} />

            {/* Content area */}
            <div
              className="flex items-center flex-1"
              style={{ maxWidth: 'var(--tree-available-width)' }}
            >
              {hasExpandableChildren ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle(node.id);
                  }}
                  className={cn(
                    'w-4 h-4 flex items-center justify-center shrink-0',
                    isSubCollapsed ? '' : 'rotate-90',
                  )}
                >
                  <Icon name="chevronRight" className={cn('size-2.5 opacity-50', isSelected && 'opacity-80')} />
                </button>
              ) : (
                <div className="w-4 h-4 shrink-0" />
              )}
              <Icon
                name={node.sublayer.icon as any}
                className={cn('size-3 mx-1.5 shrink-0', isSelected ? 'opacity-70' : 'opacity-40')}
              />
              <span className={cn('flex-1 text-2xs truncate select-none min-w-0', isSelected ? 'opacity-90' : 'opacity-60')}>
                {node.sublayer.label}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <LayerContextMenu
      layerId={node.id}
      pageId={pageId}
      isLocked={isLocked}
      onLayerSelect={onSelect}
      liveLayerUpdates={liveLayerUpdates}
      liveComponentUpdates={liveComponentUpdates}
      editingComponentId={editingComponentId}
      readOnly={readOnly}
    >
      <div
        className="relative flex group/row"
        style={{ width: '100%', minWidth: '100%' }}
      >
        {/* Background layer - stays fixed when scrolling horizontally */}
        <div className="absolute inset-0 pointer-events-none z-0">
          <div
            className={cn(
              'sticky left-0 h-full bg-(--row-bg) group-hover/row:bg-(--row-hover-bg)',
              isSelected && !hasVisibleChildren && 'rounded-lg',
              isSelected && hasVisibleChildren && 'rounded-t-lg',
              !isSelected && isChildOfSelected && !isLastVisibleDescendant && 'rounded-none',
              !isSelected && isChildOfSelected && isLastVisibleDescendant && 'rounded-b-lg',
              !isSelected && !isChildOfSelected && 'rounded-lg',
            )}
            style={{
              width: 'var(--tree-available-width)',
              '--row-bg': rowBg,
              '--row-hover-bg': rowHoverBg,
            } as React.CSSProperties}
          />
        </div>

        {/* Drop inside indicator - same sizing as background layer */}
        {isOver && dropPosition === 'inside' && (
          <div className="absolute inset-0 pointer-events-none z-40">
            <div
              className="sticky left-0 h-full rounded-lg border-[1.5px] border-primary animate-in fade-in duration-100"
              style={{ width: 'var(--tree-available-width)' }}
            />
          </div>
        )}

        {/* Content layer - scrolls horizontally */}
        <div className="relative z-10 flex w-full min-w-full flex-1">
          {/* Vertical connector lines */}
          {node.depth > 0 && (
            <>
              {Array.from({ length: node.depth }).map((_, i) => {
                const shouldHighlight = (isSelected || isChildOfSelected) && highlightedDepths.includes(`,${i},`);
                return (
                  <div
                    key={i}
                    className={cn(
                      'absolute z-10 top-0 bottom-0 w-px pointer-events-none',
                      shouldHighlight && 'bg-white/30',
                      isSelected && 'bg-white/10!',
                      isChildOfSelected && 'dark:bg-white/10 bg-neutral-900/10',
                      !shouldHighlight && !isChildOfSelected && 'dark:bg-secondary bg-neutral-900/10',
                    )}
                    style={{
                      left: `${i * 14 + 16}px`,
                    }}
                  />
                );
              })}
            </>
          )}

          {/* Drop Indicators */}
          {isOver && dropPosition === 'above' && (
            <DropLineIndicator position="above" offsetLeft={node.depth > 0 ? (node.depth - 1) * 14 + 17.5 : 4} />
          )}
          {isOver && dropPosition === 'below' && (() => {
            const effectiveDepth = (hasVisibleChildren && !node.collapsed) ? node.depth + 1 : node.depth;
            return (
              <DropLineIndicator position="below" offsetLeft={effectiveDepth > 0 ? (effectiveDepth - 1) * 14 + 17.5 : 4} />
            );
          })()}

          {/* Main Row */}
          <div
            ref={setRowElement}
            {...(isRenaming ? {} : attributes)}
            {...(isRenaming ? {} : listeners)}
            data-drag-active={isDragActive}
            data-layer-id={node.id}
            className={cn(
              'group relative flex items-center h-8 outline-none focus:outline-none',
              isLockedByOther ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
              isSelected && 'text-primary-foreground',
              isSelected && isStateActive && 'text-black',
              isSelected && usePurpleStyle && 'text-white',
              !isSelected && !isChildOfSelected && 'text-secondary-foreground/80 dark:text-muted-foreground',
              !isSelected && isChildOfSelected && 'text-current/70',
            )}
            style={{ width: 'max-content', minWidth: '100%' }}
            onClick={(e) => {
              if (isRenaming) return;
              if (isLockedByOther) {
                e.stopPropagation();
                e.preventDefault();
                return;
              }
              onSelect(node.id);
            }}
          >
          {/* Indent spacer */}
          <div style={{ width: `${node.depth * 14 + 8}px`, flex: 'none' }} />

          {/* Content area - fixed max-width so names truncate, scroll is for hierarchy */}
          <div className="flex items-center flex-1" style={{ maxWidth: 'var(--tree-available-width)' }}>
            {/* Expand/Collapse Button */}
            {(node.canHaveChildren || hasSublayers) ? (
              effectiveHasChildren ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!shouldHideChildren) {
                      onToggle(node.id);
                    }
                  }}
                  className={cn(
                    'w-4 h-4 flex items-center justify-center shrink-0',
                    isCollapsed ? '' : 'rotate-90',
                    shouldHideChildren && 'opacity-30 cursor-not-allowed'
                  )}
                  disabled={shouldHideChildren}
                >
                  <Icon name="chevronRight" className={cn('size-2.5 opacity-50', isSelected && 'opacity-80')} />
                </button>
              ) : (
                <div className="w-4 h-4 shrink-0" />
              )
            ) : (
              <div className="w-4 h-4 shrink-0 flex items-center justify-center">
                <div className={cn('ml-px w-1.5 h-px bg-white opacity-0', isSelected && 'opacity-0')} />
              </div>
            )}

            {/* Layer Icon */}
            {isComponentInstance ? (
              <Icon name="component" className="size-3 mx-1.5 shrink-0" />
            ) : layerIcon ? (
              <Icon
                name={layerIcon}
                className={cn(
                  'size-3 mx-1.5 opacity-50 shrink-0',
                  isSelected && 'opacity-100',
                )}
              />
            ) : (
              <div
                className={cn(
                  'size-3 bg-secondary rounded mx-1.5 shrink-0',
                  isSelected && 'opacity-10 dark:bg-white'
                )}
              />
            )}

            {/* Label / Inline Rename Input */}
            {isRenaming ? (
              <Input
                ref={renameInputRef}
                variant="rename-selected"
                data-renaming
                className="grow mr-2"
                defaultValue={node.layer.customName || ''}
                placeholder={getLayerDisplayLabel({ ...node.layer, customName: undefined }, {
                  component_name: appliedComponent?.name,
                  collection_name: finalCollectionName,
                  source_field_name: sourceFieldName ?? undefined,
                }, activeBreakpoint)}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  if (!renameReadyRef.current) return;
                  const val = e.currentTarget.value.trim();
                  onRenameConfirm(node.id, val || null);
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    const val = (e.target as HTMLInputElement).value.trim();
                    onRenameConfirm(node.id, val || null);
                  } else if (e.key === 'Escape') {
                    onRenameConfirm(node.id, node.layer.customName || null);
                  }
                }}
              />
            ) : (
              <span
                className="flex-1 text-xs font-medium truncate select-none min-w-0"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (node.id !== 'body') {
                    onRenameStart(node.id);
                  }
                }}
              >
                {getLayerDisplayLabel(node.layer, {
                  component_name: appliedComponent?.name,
                  collection_name: finalCollectionName,
                  source_field_name: sourceFieldName ?? undefined,
                }, activeBreakpoint)}
              </span>
            )}
          </div>

          {/* Right icons overlay - sticky to right edge, starts after chevron+icon area */}
          <div
            className="absolute top-0 bottom-0 right-0 flex justify-end pointer-events-none"
            style={{ left: `${node.depth * 14 + 8 + 36}px` }}
          >
            <div
              className="sticky right-0 h-full flex items-center pointer-events-auto gap-0.5 px-1 rounded-r-lg bg-(--icon-bg) group-hover/row:bg-(--icon-hover-bg)"
              style={{
                '--icon-bg': iconBg,
                '--icon-hover-bg': iconHoverBg,
              } as React.CSSProperties}
            >
              {isLockedByOther && (
                <div className="mr-1 shrink-0">
                  <CollaboratorBadge
                    collaborator={{
                      userId: lockOwnerUser?.user_id || '',
                      email: lockOwnerUser?.email,
                      color: lockOwnerUser?.color,
                    }}
                    size="xs"
                    tooltipPrefix="Editing by"
                  />
                </div>
              )}

              {interactionTriggerLayerIds.includes(node.id) && (
                <Icon
                  name="zap"
                  className={cn(
                    'size-3 mr-1 shrink-0',
                    activeInteractionTriggerLayerId === node.id ? 'text-white/80' : 'text-white/40'
                  )}
                />
              )}

              {interactionTargetLayerIds.includes(node.id) && !interactionTriggerLayerIds.includes(node.id) && (
                <Icon
                  name="zap-outline"
                  className={cn(
                    'size-3 mr-1 shrink-0',
                    activeInteractionTargetLayerIds.includes(node.id) ? 'text-white/70' : 'text-white/40'
                  )}
                />
              )}

              {node.id !== 'body' && !isRenaming && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleVisibility(node.id);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className={cn(
                    'items-center justify-center shrink-0 mr-1 rounded cursor-pointer',
                    node.layer.settings?.hidden
                      ? cn(
                        'size-6 flex opacity-60',
                        isSelected ? 'opacity-80 hover:opacity-100' : 'hover:opacity-100'
                      )
                      : cn(
                        'size-0 hidden group-hover:flex group-hover:size-6 group-hover:opacity-40',
                        isSelected ? 'group-hover:opacity-60' : '',
                        'hover:opacity-100!'
                      ),
                  )}
                  aria-label={node.layer.settings?.hidden ? 'Show element' : 'Hide element'}
                >
                  <Icon
                    name={node.layer.settings?.hidden ? 'eye-off' : 'eye'}
                    className="size-3"
                  />
                </button>
              )}
            </div>
          </div>
        </div>
        </div>
      </div>
    </LayerContextMenu>
  );
});

// EndDropZone Component - Drop target for adding layers at the end (bottom of Body)
function EndDropZone({
  isDragActive,
  isOver,
  editingComponentId,
}: {
  isDragActive: boolean;
  isOver: boolean;
  editingComponentId: string | null;
}) {
  const { setNodeRef } = useDroppable({
    id: 'end-drop-zone',
  });

  if (!isDragActive) return null;

  return (
    <div
      ref={setNodeRef}
      className="relative h-8 flex items-center"
    >
      {isOver && (
        <div
          className="absolute top-0 left-0 right-0 h-[1.5px] z-50 ml-2 bg-primary"
        >
          <div
            className="absolute -bottom-0.75 -left-[5.5px] size-2 rounded-full border-[1.5px] bg-neutral-950 border-primary"
          />
        </div>
      )}
    </div>
  );
}

// Helper function to collect collapsed layer IDs from layer tree
function collectCollapsedIds(layers: Layer[]): Set<string> {
  const collapsed = new Set<string>();

  function traverse(layerList: Layer[]) {
    layerList.forEach(layer => {
      // If open is explicitly false, it's collapsed
      if (layer.open === false) {
        collapsed.add(layer.id);
      }
      if (layer.children) {
        traverse(layer.children);
      }
    });
  }

  traverse(layers);
  return collapsed;
}

/**
 * Build a stable string key fingerprinting the explicit `open` flags in the
 * layer tree. Used as an effect dep so we only resync local `collapsedIds`
 * state when collapse-relevant data actually changes — not on every keystroke
 * that creates a fresh `layers` array reference.
 */
function collectCollapseKey(layers: Layer[]): string {
  const parts: string[] = [];
  function traverse(layerList: Layer[]) {
    for (const layer of layerList) {
      if (layer.open === false) {
        parts.push(layer.id);
      }
      if (layer.children && layer.children.length > 0) {
        traverse(layer.children);
      }
    }
  }
  traverse(layers);
  return parts.join('|');
}

// Helper function to update a layer's open state in the tree
function updateLayerOpenState(layers: Layer[], layerId: string, isOpen: boolean): Layer[] {
  return layers.map(layer => {
    if (layer.id === layerId) {
      return {
        ...layer,
        open: isOpen,
      };
    }
    if (layer.children) {
      return {
        ...layer,
        children: updateLayerOpenState(layer.children, layerId, isOpen),
      };
    }
    return layer;
  });
}

// Helper to find a layer's parent chain in the tree
function findParentChain(layers: Layer[], targetId: string, parentId: string | null = null): string[] | null {
  for (const layer of layers) {
    if (layer.id === targetId) {
      return parentId ? [parentId] : [];
    }

    if (layer.children) {
      const childResult = findParentChain(layer.children, targetId, layer.id);
      if (childResult !== null) {
        return parentId ? [parentId, ...childResult] : childResult;
      }
    }
  }

  return null;
}

// Helper to batch update multiple layers' open state
function setLayersOpen(layers: Layer[], idsToOpen: Set<string>): Layer[] {
  return layers.map(layer => {
    const shouldOpen = idsToOpen.has(layer.id);
    const hasChildren = layer.children && layer.children.length > 0;

    if (shouldOpen || hasChildren) {
      return {
        ...layer,
        ...(shouldOpen && { open: true }),
        ...(hasChildren && { children: setLayersOpen(layer.children!, idsToOpen) }),
      };
    }

    return layer;
  });
}

// Main LayersTree Component
export default function LayersTree({
  layers,
  onLayerSelect,
  onReorder,
  pageId,
  liveLayerUpdates,
  liveComponentUpdates,
  readOnly = false,
}: LayersTreeProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<'above' | 'below' | 'inside' | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => collectCollapsedIds(layers));
  const pointerYRef = useRef<number>(0);
  const ghostRef = useRef<HTMLDivElement>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [shouldScrollToSelected, setShouldScrollToSelected] = useState(false);

  // Track actual cursor position via native pointer events during drag.
  // Updates pointerYRef (for drop-position calc) and ghost element position directly via DOM.
  useEffect(() => {
    if (!activeId) return;
    const handlePointerMove = (e: PointerEvent) => {
      pointerYRef.current = e.clientY;
      if (ghostRef.current) {
        ghostRef.current.style.transform = `translate(${e.clientX + 12}px, ${e.clientY}px)`;
      }
    };
    window.addEventListener('pointermove', handlePointerMove);
    return () => window.removeEventListener('pointermove', handlePointerMove);
  }, [activeId]);

  // Pull selection and breakpoint from editor store
  const selectedLayerId = useEditorStore((s) => s.selectedLayerId);
  const storeSelectedLayerIds = useEditorStore((s) => s.selectedLayerIds);
  const lastSelectedLayerId = useEditorStore((s) => s.lastSelectedLayerId);
  const toggleSelection = useEditorStore((s) => s.toggleSelection);
  const selectRange = useEditorStore((s) => s.selectRange);
  const editingComponentId = useEditorStore((s) => s.editingComponentId);
  const activeBreakpoint = useEditorStore((s) => s.activeBreakpoint);
  const storeActiveSublayerIndex = useEditorStore((s) => s.activeSublayerIndex);
  const storeActiveTextStyleKey = useEditorStore((s) => s.activeTextStyleKey);
  const storeActiveListItemIndex = useEditorStore((s) => s.activeListItemIndex);
  const selectLayerWithSublayer = useEditorStore((s) => s.selectLayerWithSublayer);
  const interactionTriggerLayerIds = useEditorStore((s) => s.interactionTriggerLayerIds);
  const interactionTargetLayerIds = useEditorStore((s) => s.interactionTargetLayerIds);
  const activeInteractionTriggerLayerId = useEditorStore((s) => s.activeInteractionTriggerLayerId);
  const activeInteractionTargetLayerIds = useEditorStore((s) => s.activeInteractionTargetLayerIds);
  const activeUIState = useEditorStore((s) => s.activeUIState);
  const leftSidebarWidth = useEditorStore((s) => s.leftSidebarWidth);

  const isLocalizing = useLocalisationStore((state) => {
    const id = state.selectedLocaleId;
    if (!id) return false;
    const locale = state.locales.find((l) => l.id === id);
    return !!(locale && !locale.is_default);
  });

  const getComponentById = useComponentsStore((s) => s.getComponentById);

  const collections = useCollectionsStore((s) => s.collections);
  const fieldsByCollectionId = useCollectionsStore((s) => s.fields);
  const collectionItems = useCollectionsStore((s) => s.items);

  const layerTreeStoreValues = useMemo<LayerTreeStoreValues>(() => ({
    getComponentById,
    collections,
    fieldsByCollectionId,
    selectLayerWithSublayer,
    editingComponentId,
    interactionTriggerLayerIds,
    interactionTargetLayerIds,
    activeInteractionTriggerLayerId,
    activeInteractionTargetLayerIds,
    activeUIState,
  }), [
    getComponentById, collections, fieldsByCollectionId,
    selectLayerWithSublayer, editingComponentId,
    interactionTriggerLayerIds, interactionTargetLayerIds,
    activeInteractionTriggerLayerId, activeInteractionTargetLayerIds,
    activeUIState,
  ]);

  // CMS data for resolving rich text sublayers from actual CMS item content
  const currentPageCollectionItemId = useEditorStore((state) => state.currentPageCollectionItemId);
  const pages = usePagesStore((state) => state.pages);
  const currentPage = useMemo(() => pages.find(p => p.id === pageId), [pages, pageId]);
  const pageCollectionId = currentPage?.is_dynamic ? currentPage.settings?.cms?.collection_id ?? null : null;
  const pageCollectionItemValues = useMemo(() => {
    if (!pageCollectionId || !currentPageCollectionItemId) return null;
    const items = collectionItems[pageCollectionId];
    if (!items) return null;
    const item = items.find(i => i.id === currentPageCollectionItemId);
    return item?.values ?? null;
  }, [pageCollectionId, currentPageCollectionItemId, collectionItems]);

  const selectedLayerIds = storeSelectedLayerIds;

  // Flatten the tree for rendering (sorted by CSS order on responsive breakpoints)
  const flattenedNodes = useMemo(
    () => {
      const visibleLayers = filterDisabledSliderLayers(layers);
      const flattened = flattenTree(visibleLayers, null, 0, collapsedIds, activeBreakpoint);

      // Validate no duplicate IDs in flattened array
      if (process.env.NODE_ENV === 'development') {
        const seenIds = new Map<string, { parentId: string | null; depth: number; index: number }>();
        const duplicates: Array<{ id: string; locations: Array<{ parentId: string | null; depth: number; index: number }> }> = [];

        flattened.forEach((node, idx) => {
          if (seenIds.has(node.id)) {
            // Find existing duplicate entry or create new one
            let dupEntry = duplicates.find(d => d.id === node.id);
            if (!dupEntry) {
              dupEntry = {
                id: node.id,
                locations: [seenIds.get(node.id)!]
              };
              duplicates.push(dupEntry);
            }
            dupEntry.locations.push({ parentId: node.parentId, depth: node.depth, index: node.index });
          }
          seenIds.set(node.id, { parentId: node.parentId, depth: node.depth, index: node.index });
        });

        if (duplicates.length > 0) {
          console.error('❌ DUPLICATE IDs IN FLATTENED NODES:');
          duplicates.forEach(dup => {
            console.error(`  ID: ${dup.id}`);
            console.error(`  Found at:`, dup.locations);
          });
          console.error('Full layers structure:', JSON.stringify(layers, null, 2));

          // Also check the source layers structure for duplicates
          const layerIds = new Set<string>();
          function checkLayerDuplicates(layerList: Layer[], path: string = 'root'): void {
            layerList.forEach((layer, idx) => {
              const currentPath = `${path}[${idx}]`;
              if (layerIds.has(layer.id)) {
                console.error(`  Also found in source at: ${currentPath}`);
              }
              layerIds.add(layer.id);
              if (layer.children) {
                checkLayerDuplicates(layer.children, `${currentPath}.children`);
              }
            });
          }
          checkLayerDuplicates(layers);
        }
      }

      // Inject sublayer nodes for expanded text elements
      const withSublayers: FlattenedItem[] = [];
      for (const node of flattened) {
        withSublayers.push(node);
        if (!collapsedIds.has(node.id)) {
          let subIdx = 0;

          // Content sublayers (TipTap blocks) for richText
          // Each content block may have inline mark children (bold, italic, etc.)
          if (isRichTextLayer(node.layer)) {
            let cmsContent: any = undefined;
            const cmsBinding = getLayerCmsFieldBinding(node.layer);
            if (cmsBinding && pageCollectionItemValues) {
              const rawValue = pageCollectionItemValues[cmsBinding.field_id];
              if (rawValue) cmsContent = rawValue;
            }
            const contentSubs = getRichTextSublayers(node.layer, cmsContent);

            const pushSublayer = (sub: typeof contentSubs[number], parentId: string, depth: number, idSuffix: string) => {
              const hasChildren = !!(sub.children && sub.children.length > 0);
              const id = `${parentId}${idSuffix}`;
              withSublayers.push({
                id,
                layer: node.layer,
                depth,
                parentId,
                index: subIdx,
                collapsed: hasChildren ? collapsedIds.has(id) : undefined,
                canHaveChildren: hasChildren,
                sublayer: sub,
              });
              subIdx++;

              if (hasChildren && !collapsedIds.has(id)) {
                let listItemCounter = 0;
                sub.children!.forEach((childSub, childIdx) => {
                  let childSuffix: string;
                  if (childSub.kind === 'listItem') {
                    childSuffix = `__item_${listItemCounter++}`;
                  } else if (childSub.type === 'tableRow') {
                    childSuffix = `__row_${childIdx}`;
                  } else if (childSub.type === 'tableCell' || childSub.type === 'tableHeader') {
                    childSuffix = `__cell_${childIdx}`;
                  } else {
                    childSuffix = `__mark_${childSub.styleKey}`;
                  }
                  pushSublayer(childSub, id, depth + 1, childSuffix);
                });
              }
            };

            contentSubs.forEach((sub) => {
              pushSublayer(sub, node.id, node.depth + 1, `__sub_${subIdx}`);
            });
          }

          // Style sublayers for text/heading only (richText nests them under content blocks)
          if (isTextContentLayer(node.layer)) {
            const styleSubs = getTextStyleSublayers(node.layer);
            styleSubs.forEach((sub) => {
              withSublayers.push({
                id: `${node.id}__style_${sub.styleKey}`,
                layer: node.layer,
                depth: node.depth + 1,
                parentId: node.id,
                index: subIdx,
                canHaveChildren: false,
                sublayer: sub,
              });
              subIdx++;
            });
          }
        }
      }

      return withSublayers;
    },
    [layers, collapsedIds, activeBreakpoint, pageCollectionItemValues]
  );

  // Calculate which depth levels should be highlighted (selected containers)
  const highlightedDepths = useMemo(() => {
    const depths: number[] = [];
    const selectedIds = selectedLayerId ? [selectedLayerId, ...selectedLayerIds] : selectedLayerIds;

    selectedIds.forEach(id => {
      const node = flattenedNodes.find(n => n.id === id);
      if (node && node.canHaveChildren && !depths.includes(node.depth)) {
        depths.push(node.depth);
      }
    });

    return `,${depths.join(',')},`;
  }, [flattenedNodes, selectedLayerId, selectedLayerIds]);

  // Get the currently active node being dragged
  const activeNode = useMemo(
    () => flattenedNodes.find((node) => node.id === activeId),
    [activeId, flattenedNodes]
  );

  // Get collection label for active node (for drag overlay): field name or collection name
  const activeNodeCollectionContext = useMemo(() => {
    if (!activeNode) return { collection_name: undefined as string | undefined, source_field_name: undefined as string | undefined };
    const collectionVariable = getCollectionVariable(activeNode.layer);
    const collectionName = collectionVariable?.id && collectionVariable.id !== MULTI_ASSET_COLLECTION_ID
      ? collections.find(c => c.id === collectionVariable.id)?.name
      : undefined;
    const sourceFieldName = collectionVariable?.source_field_id
      ? (Object.values(fieldsByCollectionId).flat().find((f) => f.id === collectionVariable.source_field_id)?.name ?? undefined)
      : undefined;
    return { collection_name: collectionName, source_field_name: sourceFieldName };
  }, [activeNode, collections, fieldsByCollectionId]);

  // Inline rename handlers
  const renamingLayerId = useEditorStore((state) => state.renamingLayerId);
  const setRenamingLayerId = useEditorStore((state) => state.setRenamingLayerId);
  const updateLayer = usePagesStore((state) => state.updateLayer);
  const updateComponentDraft = useComponentsStore((state) => state.updateComponentDraft);

  const handleRenameStart = useCallback((id: string) => {
    setRenamingLayerId(id);
  }, [setRenamingLayerId]);

  const handleRenameConfirm = useCallback((id: string, newName: string | null) => {
    const value = newName || undefined;

    // Update layer first so the label shows the new name immediately
    if (editingComponentId) {
      const { componentDrafts } = useComponentsStore.getState();
      const variantId = useEditorStore.getState().editingComponentVariantId;
      const variantDrafts = componentDrafts[editingComponentId];
      const targetVariantId = (variantId && variantDrafts?.[variantId]) ? variantId : (variantDrafts ? Object.keys(variantDrafts)[0] : null);
      if (targetVariantId && variantDrafts) {
        const compLayers = variantDrafts[targetVariantId] || [];
        updateComponentDraft(editingComponentId, targetVariantId, updateLayerProps(compLayers, id, { customName: value }));
      }
    } else {
      updateLayer(pageId, id, { customName: value });
    }

    setRenamingLayerId(null);
  }, [editingComponentId, pageId, updateLayer, updateComponentDraft, setRenamingLayerId]);

  const handleToggleVisibility = useCallback((id: string) => {
    const node = flattenedNodes.find(n => n.id === id);
    if (!node) return;

    const currentSettings = node.layer.settings || {};
    const newHidden = !currentSettings.hidden;
    const updates: Partial<Layer> = {
      settings: { ...currentSettings, hidden: newHidden }
    };

    if (editingComponentId) {
      const { componentDrafts } = useComponentsStore.getState();
      const variantId = useEditorStore.getState().editingComponentVariantId;
      const variantDrafts = componentDrafts[editingComponentId];
      const targetVariantId = (variantId && variantDrafts?.[variantId]) ? variantId : (variantDrafts ? Object.keys(variantDrafts)[0] : null);
      if (targetVariantId && variantDrafts) {
        const compLayers = variantDrafts[targetVariantId] || [];
        updateComponentDraft(editingComponentId, targetVariantId, updateLayerProps(compLayers, id, updates));
      }
    } else {
      updateLayer(pageId, id, updates);
    }
  }, [editingComponentId, pageId, updateLayer, updateComponentDraft, flattenedNodes]);

  // Configure sensors for drag detection
  const defaultSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required to start drag
      },
    })
  );
  const noSensors = useSensors();
  const sensors = readOnly ? noSensors : defaultSensors;

  const handleMultiSelect = useCallback((id: string, modifiers: { meta: boolean; shift: boolean }) => {
    if (id === 'body') {
      onLayerSelect(id);
      return;
    }

    if (modifiers.meta) {
      toggleSelection(id);
    } else if (modifiers.shift) {
      const lastId = useEditorStore.getState().lastSelectedLayerId;
      if (lastId) selectRange(lastId, id, flattenedNodes);
    }
  }, [toggleSelection, selectRange, flattenedNodes, onLayerSelect]);

  // Sync collapsedIds state when collapse flags change (from external updates).
  // Depend on a derived key instead of the `layers` reference so the tree
  // doesn't rebuild this Set on every keystroke when only text/style changed.
  const collapseKey = useMemo(() => collectCollapseKey(layers), [layers]);
  useEffect(() => {
    setCollapsedIds(collectCollapsedIds(layers));
    // `layers` is intentionally excluded — we re-sync only when the derived
    // collapse fingerprint changes, not on every layer-tree mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapseKey]);

  // Listen for expand events from ElementLibrary
  useEffect(() => {
    const handleExpandLayer = (event: CustomEvent) => {
      const { layerId } = event.detail;
      if (layerId && collapsedIds.has(layerId)) {
        setCollapsedIds((prev) => {
          const next = new Set(prev);
          next.delete(layerId);
          return next;
        });

        // Persist the change to the layer tree
        const updatedLayers = updateLayerOpenState(layers, layerId, true);
        onReorder(updatedLayers);
      }
    };

    window.addEventListener('expandLayer', handleExpandLayer as EventListener);
    return () => window.removeEventListener('expandLayer', handleExpandLayer as EventListener);
  }, [collapsedIds, layers, onReorder]);

  // Listen for toggle collapse all layers event (Option + L shortcut)
  // When collapsed: shows body + first level elements expanded, but collapses their children (second level+)
  // When expanded: expands all layers
  useEffect(() => {
    const handleToggleCollapseAll = () => {
      // Collect IDs at different levels
      // First level = top-level layers in the tree (children of body)
      // Second level+ = children of first level elements and deeper
      const secondLevelAndDeeperIds: string[] = [];

      const collectChildIds = (children: Layer[]) => {
        for (const layer of children) {
          if (layer.children && layer.children.length > 0) {
            secondLevelAndDeeperIds.push(layer.id);
            collectChildIds(layer.children);
          }
        }
      };

      // For each first-level layer, collect its children (second level and deeper)
      for (const layer of layers) {
        if (layer.children && layer.children.length > 0) {
          // Collect children of this first-level layer (these are second level)
          collectChildIds(layer.children);
        }
      }

      // Check if any second-level+ layers are expanded
      const anySecondLevelExpanded = secondLevelAndDeeperIds.some(id => !collapsedIds.has(id));

      if (anySecondLevelExpanded || secondLevelAndDeeperIds.length === 0) {
        // Collapse: collapse second level and deeper (hide their children)
        // First level elements stay expanded, showing their direct children
        // But those children (second level) are collapsed
        const idsToCollapse = new Set(secondLevelAndDeeperIds);
        setCollapsedIds(idsToCollapse);
        // Persist to layer tree
        let updatedLayers = layers;
        // Keep first level expanded
        for (const layer of layers) {
          if (layer.children && layer.children.length > 0) {
            updatedLayers = updateLayerOpenState(updatedLayers, layer.id, true);
          }
        }
        // Collapse second level and deeper
        for (const id of secondLevelAndDeeperIds) {
          updatedLayers = updateLayerOpenState(updatedLayers, id, false);
        }
        onReorder(updatedLayers);
      } else {
        // Expand all
        setCollapsedIds(new Set());
        // Persist to layer tree - expand everything
        const collectAllIdsWithChildren = (layerList: Layer[]): string[] => {
          const ids: string[] = [];
          for (const layer of layerList) {
            if (layer.children && layer.children.length > 0) {
              ids.push(layer.id);
              ids.push(...collectAllIdsWithChildren(layer.children));
            }
          }
          return ids;
        };
        const allIds = collectAllIdsWithChildren(layers);
        let updatedLayers = layers;
        for (const id of allIds) {
          updatedLayers = updateLayerOpenState(updatedLayers, id, true);
        }
        onReorder(updatedLayers);
      }
    };

    window.addEventListener('toggleCollapseAllLayers', handleToggleCollapseAll);
    return () => window.removeEventListener('toggleCollapseAllLayers', handleToggleCollapseAll);
  }, [collapsedIds, layers, onReorder]);

  // Track previous selectedLayerId to only run when it actually changes
  const prevSelectedLayerIdRef = useRef<string | null>(null);

  // Auto-expand parents when layer is selected (e.g., from canvas click)
  useEffect(() => {
    // Only run if selectedLayerId actually changed
    if (!selectedLayerId || prevSelectedLayerIdRef.current === selectedLayerId) {
      prevSelectedLayerIdRef.current = selectedLayerId;
      return;
    }

    prevSelectedLayerIdRef.current = selectedLayerId;

    // Check if layer is already visible
    const isVisible = flattenedNodes.some(n => n.id === selectedLayerId);
    if (isVisible) {
      // Already visible - just trigger scroll
      setShouldScrollToSelected(true);
      return;
    }

    // Find which parents need to be expanded
    const parentChain = findParentChain(layers, selectedLayerId);
    if (!parentChain) return;

    const parentsToExpand = parentChain.filter(id => collapsedIds.has(id));
    if (parentsToExpand.length === 0) return;

    // Expand all collapsed parents in one pass
    const updatedLayers = setLayersOpen(layers, new Set(parentsToExpand));
    onReorder(updatedLayers);

    // Trigger scroll after expansion (will happen after re-render)
    setShouldScrollToSelected(true);
  }, [selectedLayerId, flattenedNodes, collapsedIds, layers, onReorder]);

  // Reset scroll trigger after it's been applied
  useEffect(() => {
    if (shouldScrollToSelected) {
      // Reset after a short delay to allow the scroll to complete
      const timeout = setTimeout(() => setShouldScrollToSelected(false), 500);
      return () => clearTimeout(timeout);
    }
  }, [shouldScrollToSelected]);

  // Virtualizer: discover the nearest scroll-container ancestor.
  // Held in state (not a ref) so resolving it triggers a re-render — the
  // virtualizer only rebinds its scroll element on render, and a ref write
  // alone leaves it stuck with a null element (blank tree, intermittently
  // on Safari where the rescue re-render often loses the timing race).
  const [scrollContainer, setScrollContainer] = useState<HTMLElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    let el = wrapperRef.current?.parentElement ?? null;
    while (el) {
      const style = getComputedStyle(el);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') break;
      el = el.parentElement;
    }
    const scroller = el;
    if (!scroller) return;

    // Bind the virtualizer's scroll element only once it has a measurable
    // height. The virtualizer reads the viewport height once on bind; if that
    // read is 0 (Safari before layout settles, or while the Layers tab is
    // hidden), it computes an empty range and renders no rows — and if the
    // 0→height ResizeObserver tick is missed (a Safari quirk) the tree stays
    // blank with just the selection bar. Waiting for a non-zero height makes
    // the first viewport read reliable across browsers.
    if (scroller.clientHeight > 0) {
      setScrollContainer(scroller);
      return;
    }
    const ro = new ResizeObserver(() => {
      if (scroller.clientHeight > 0) {
        setScrollContainer(scroller);
        ro.disconnect();
      }
    });
    ro.observe(scroller);
    return () => ro.disconnect();
  }, []);

  const treeAvailableWidth = leftSidebarWidth - 32;
  const maxDepth = useMemo(() => flattenedNodes.reduce((max, n) => Math.max(max, n.depth), 0), [flattenedNodes]);

  const virtualizer = useVirtualizer({
    count: flattenedNodes.length,
    getScrollElement: () => scrollContainer,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  // Scroll to selected layer only if not already visible
  useEffect(() => {
    if (!shouldScrollToSelected || !selectedLayerId) return;

    const idx = flattenedNodes.findIndex(n => n.id === selectedLayerId);
    if (idx < 0) return;

    const scrollEl = scrollContainer;
    if (!scrollEl) {
      virtualizer.scrollToIndex(idx, { align: 'center', behavior: 'smooth' });
      return;
    }

    const SCROLL_MARGIN = 64;
    const virtualItems = virtualizer.getVirtualItems();
    const item = virtualItems.find(v => v.index === idx);

    let needsVerticalScroll = true;
    if (item) {
      const wrapperTop = wrapperRef.current?.getBoundingClientRect().top ?? 0;
      const scrollTop = scrollEl.getBoundingClientRect().top;
      const itemScreenTop = wrapperTop + item.start;
      const viewTop = scrollTop + SCROLL_MARGIN;
      const viewBottom = scrollTop + scrollEl.clientHeight - SCROLL_MARGIN;

      if (itemScreenTop >= viewTop && itemScreenTop + ROW_HEIGHT <= viewBottom) {
        needsVerticalScroll = false;
      }
    }

    if (needsVerticalScroll) {
      const isAbove = idx * ROW_HEIGHT < scrollEl.scrollTop;
      virtualizer.scrollToIndex(idx, { align: isAbove ? 'start' : 'end' });
    }

    const timeout = setTimeout(() => {
      const wrapperEl = wrapperRef.current;
      if (!wrapperEl || !scrollEl) return;

      if (needsVerticalScroll) {
        const wrapperRect = wrapperEl.getBoundingClientRect();
        const scrollRect = scrollEl.getBoundingClientRect();
        const wrapperOffset = wrapperRect.top - scrollRect.top + scrollEl.scrollTop;
        const itemTop = wrapperOffset + idx * ROW_HEIGHT;
        const targetScroll = itemTop - (scrollEl.clientHeight / 2) + (ROW_HEIGHT / 2);
        scrollEl.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
      }

      // Horizontal scroll: align to parent's parent layer's chevron - 2px
      const node = flattenedNodes[idx];
      const targetLeft = node && node.depth > 0 ? (node.depth - 2) * 14 - 2 : 0;
      if (Math.abs(scrollEl.scrollLeft - targetLeft) > 1) {
        scrollEl.scrollTo({ left: targetLeft, behavior: 'smooth' });
      }
    }, 100);

    return () => clearTimeout(timeout);
  }, [shouldScrollToSelected, selectedLayerId, flattenedNodes, virtualizer, scrollContainer]);

  const setHoveredLayerIdFromStore = useEditorStore((s) => s.setHoveredLayerId);

  // Hover delegation via passive native listener — zero cost during mouseover
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    let hoverId: string | null = null;

    const onOver = (e: MouseEvent) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-layer-id]');
      const id = row?.dataset.layerId ?? null;
      if (id !== hoverId) {
        hoverId = id;
        setHoveredLayerIdFromStore(id);
      }
    };

    const onLeave = () => {
      if (hoverId !== null) {
        hoverId = null;
        setHoveredLayerIdFromStore(null);
      }
    };

    el.addEventListener('mouseover', onOver, { passive: true });
    el.addEventListener('mouseleave', onLeave, { passive: true });
    return () => {
      el.removeEventListener('mouseover', onOver);
      el.removeEventListener('mouseleave', onLeave);
    };
  }, [setHoveredLayerIdFromStore]);

  // Handle drag start
  const handleDragStart = useCallback((event: DragStartEvent) => {
    // Prevent starting a new drag while processing the previous one
    if (isProcessing) {
      return;
    }

    const draggedId = event.active.id as string;
    const draggedNode = flattenedNodes.find(n => n.id === draggedId);

    if (draggedNode?.sublayer) return;

    // Clear hover state when dragging starts
    setHoveredLayerIdFromStore(null);

    setActiveId(draggedId);
    onLayerSelect(draggedId);
  }, [flattenedNodes, onLayerSelect, isProcessing, setHoveredLayerIdFromStore]);

  // Compute drop position for a given node + pointer Y.
  // Shared by handleDragOver (on target change) and handleDragMove (on every pointer move).
  const computeDropPosition = useCallback((
    overRect: { top: number; height: number },
    overNode: FlattenedItem,
    activeNodeLayer?: { name: string } | null,
  ): 'above' | 'below' | 'inside' => {
    const offsetY = pointerYRef.current - overRect.top;
    const relativeY = Math.max(0, Math.min(1, offsetY / overRect.height));

    const isDraggingSection = activeNodeLayer?.name === 'section';
    const isOverBody = overNode.id === 'body' || overNode.layer.name === 'body';
    const isContainerType = overNode.canHaveChildren && !(isDraggingSection && !isOverBody);
    const hasVisibleChildren = !!(overNode.layer.children?.length) && !collapsedIds.has(overNode.id);

    return calcDropPosition(relativeY, isContainerType, hasVisibleChildren);
  }, [collapsedIds]);

  // Handle drag over - standard 25/50/25 drop zone detection
  const handleDragOver = useCallback((event: DragOverEvent) => {
    const overId = event.over?.id as string | null;

    if (!overId || !event.over?.rect) {
      setOverId(null);
      setDropPosition(null);
      return;
    }

    // Handle drop at the end of the list (after all layers)
    if (overId === 'end-drop-zone') {
      const activeNode = activeId ? flattenedNodes.find((n) => n.id === activeId) : null;

      // For Sections, allow dropping at end (will be placed as last child of Body)
      // For other layers, also allow (will be placed as last child of Body)
      setOverId(overId);
      setDropPosition('below'); // Will be treated as "after last item"
      return;
    }

    const overNode = flattenedNodes.find((n) => n.id === overId);
    const activeNode = activeId ? flattenedNodes.find((n) => n.id === activeId) : null;

    if (!overNode) {
      setDropPosition(null);
      return;
    }

    // CRITICAL: Prevent dropping outside Body layer
    // If hovering over Body itself, only allow "inside" drops
    if (overNode.id === 'body') {
      setOverId(overId);
      setDropPosition('inside');
      return;
    }

    const position = computeDropPosition(event.over.rect, overNode, activeNode?.layer);
    const isDraggingSection = activeNode && activeNode.layer.name === 'section';

    // CRITICAL: When dragging a Section, prevent it from being dropped inside ANY container except Body
    // Check if the target node's parent is NOT Body (Section can only be at Body level)
    if (isDraggingSection && (position === 'above' || position === 'below')) {
      const targetParentId = overNode.parentId;

      // If the parent is not Body, don't allow Section to be dropped here
      if (targetParentId && targetParentId !== 'body') {
        const parentNode = flattenedNodes.find(n => n.id === targetParentId);
        const parentIsBody = parentNode?.id === 'body' || parentNode?.layer.name === 'body';

        if (!parentIsBody) {
          // Hovering over a child of a non-Body container - don't show drop indicator
          setOverId(null);
          setDropPosition(null);
          return;
        }
      }
    }

    // CRITICAL: Prevent reordering within same parent from moving outside parent
    // If dragging an element within its own parent, "above/below" should only reorder
    // within that parent, not escape to the parent's parent level
    if (activeNode && (position === 'above' || position === 'below')) {
      const targetParentId = overNode.parentId;
      const currentParentId = activeNode.parentId;

      // Hovering over the container that IS the current parent with above/below
      // would escape to the grandparent level — force "inside" instead
      if (overNode.id === currentParentId && canHaveChildren(overNode.layer)) {
        setOverId(overId);
        setDropPosition('inside');
        return;
      }

      // ADDITIONAL CHECK: If both are siblings but the target's parent is different from
      // what the drop would result in, block it
      // This catches the edge case where "above" first child would place at parent level
      if (currentParentId === targetParentId && currentParentId !== null) {
        // Same parent - check if this would actually change the parent
        // For "above" on first child or "below" on last child, the actual placement
        // would be at parent level (escaping the container)

        // Find all siblings in this container
        const siblingsInParent = flattenedNodes.filter(n => n.parentId === currentParentId);

        // Check if target is first child and we're going "above"
        // OR if target is last child and we're going "below"
        const isFirstSibling = overNode.index === 0;
        const isLastSibling = overNode.index === siblingsInParent.length - 1;

        // CRITICAL: Check what the actual resulting parent would be
        // If position is "above" first child, it would use overNode.parentId which might escape
        // We need to ensure this doesn't change the parent level

        if (position === 'above' && isFirstSibling) {
          // This would place ABOVE the first child
          // In the tree, this means same parent (which is fine)
          // But we need to make sure the depth stays the same
        }

        if (position === 'below' && isLastSibling) {
          // This would place BELOW the last child
          // Should stay at same level
        }

        // Allow reordering within same parent
      } else if (currentParentId !== targetParentId) {
        // Different parents - this is a cross-container move
        // Block if it would place at root level (outside Body)
        if (targetParentId === null) {
          // Don't show ANY drop indicator - cancel the entire hover state
          setOverId(null);
          setDropPosition(null);
          return;
        }
        // Otherwise allow cross-container move - show indicator
      }
    }

    // Check ancestor restrictions
    if (activeNode && position) {
      const targetParentId = position === 'inside' ? overNode.id : overNode.parentId;

      // Check if the layer can be moved to the new parent based on ancestor restrictions
      if (!canMoveLayer(layers, activeNode.id, targetParentId)) {
        // Cannot move due to ancestor restrictions - don't show drop indicator
        setOverId(null);
        setDropPosition(null);
        return;
      }
    }

    setOverId(overId);
    setDropPosition(position);
  }, [flattenedNodes, activeId, layers, computeDropPosition]);

  // Recalculate drop position on every pointer movement.
  // onDragOver only fires when the target element changes, so without this
  // the position would be locked to wherever the cursor entered the row.
  const handleDragMove = useCallback((event: DragMoveEvent) => {
    const currentOverId = event.over?.id as string | null;
    if (!currentOverId || !event.over?.rect || currentOverId === 'end-drop-zone' || currentOverId === 'body') return;

    const overNode = flattenedNodes.find((n) => n.id === currentOverId);
    if (!overNode) return;

    const activeNode = activeId ? flattenedNodes.find((n) => n.id === activeId) : null;
    let position = computeDropPosition(event.over.rect, overNode, activeNode?.layer);

    // When dragging over own parent, force "inside" to prevent escaping
    if (activeNode && (position === 'above' || position === 'below') &&
        overNode.id === activeNode.parentId && canHaveChildren(overNode.layer)) {
      position = 'inside';
    }

    setDropPosition(position);
  }, [flattenedNodes, activeId, computeDropPosition]);

  // Handle drag end - perform the actual reorder
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      if (!over || active.id === over.id) {
        setActiveId(null);
        setOverId(null);
        setDropPosition(null);
        return;
      }

      // Set processing flag to prevent concurrent drags
      setIsProcessing(true);

      const activeNode = flattenedNodes.find((n) => n.id === active.id);

      // Handle drop at the end of the list
      if (over.id === 'end-drop-zone') {
        if (!activeNode) {
          setActiveId(null);
          setOverId(null);
          setDropPosition(null);
          setIsProcessing(false);
          return;
        }

        // Find the Body layer to add as its last child
        const bodyLayer = flattenedNodes.find(n => n.id === 'body' || n.layer.name === 'body');

        if (bodyLayer) {
          // Get all current children of Body
          const bodyChildren = flattenedNodes.filter(n => n.parentId === bodyLayer.id);
          const maxIndex = bodyChildren.length > 0
            ? Math.max(...bodyChildren.map(n => n.index))
            : -1;

          // Place as last child of Body
          const newLayers = rebuildTree(
            flattenedNodes,
            activeNode.id,
            bodyLayer.id,
            maxIndex + 1
          );

          onReorder(newLayers, activeNode.id);
        }

        setActiveId(null);
        setOverId(null);
        setDropPosition(null);

        setTimeout(() => setIsProcessing(false), 0);
        return;
      }

      const overNode = flattenedNodes.find((n) => n.id === over.id);

      if (!activeNode || !overNode) {
        setActiveId(null);
        setOverId(null);
        setDropPosition(null);

        setIsProcessing(false);
        return;
      }

      // Prevent moving into self or descendant
      if (isDescendant(activeNode, overNode, flattenedNodes)) {
        setActiveId(null);
        setOverId(null);
        setDropPosition(null);

        setIsProcessing(false);
        return;
      }

      // Calculate target parent based on drop position
      let targetParentId: string | null;
      if (dropPosition === 'inside') {
        targetParentId = overNode.id;
      } else {
        targetParentId = overNode.parentId;
      }

      // Check ancestor restrictions before allowing the move
      if (!canMoveLayer(layers, activeNode.id, targetParentId)) {
        console.warn(`Cannot move layer ${activeNode.id} - ancestor restriction violated`);
        setActiveId(null);
        setOverId(null);
        setDropPosition(null);

        setIsProcessing(false);
        return;
      }

      // Handle drop based on dropPosition
      let newParentId: string | null;
      let newOrder: number;

      if (dropPosition === 'above') {
        // Drop above the target - same parent, same order as target
        newParentId = overNode.parentId;
        newOrder = overNode.index;

        // CRITICAL: Prevent placement at root level (parentId: null)
        // Everything must be inside Body
        if (newParentId === null) {
          setActiveId(null);
          setOverId(null);
          setDropPosition(null);
  
          setIsProcessing(false);
          return;
        }

        // Prevent Section from being placed outside Body
        // BUT allow reordering Sections when both are already at Body level
        if (activeNode.layer.name === 'section') {
          const parentNode = flattenedNodes.find(n => n.id === newParentId);
          const isParentBody = parentNode?.layer.name === 'body' || parentNode?.id === 'body';

          if (!isParentBody) {
            setActiveId(null);
            setOverId(null);
            setDropPosition(null);
    
            setIsProcessing(false);
            return;
          }
        }
      } else if (dropPosition === 'inside') {
        // Drop inside the target - target becomes parent
        // Validate that target can accept children
        if (!overNode.canHaveChildren) {
          setActiveId(null);
          setOverId(null);
          setDropPosition(null);
  
          setIsProcessing(false);
          return;
        }

        // Prevent dropping Section inside another Section
        if (activeNode.layer.name === 'section' && overNode.layer.name === 'section') {
          setActiveId(null);
          setOverId(null);
          setDropPosition(null);
  
          setIsProcessing(false);
          return;
        }

        // Prevent dropping Section inside any layer that's not Body
        if (activeNode.layer.name === 'section' && overNode.layer.name !== 'body') {
          setActiveId(null);
          setOverId(null);
          setDropPosition(null);
  
          setIsProcessing(false);
          return;
        }

        // Target container becomes the new parent
        newParentId = overNode.id;

        // Place as LAST child (at the end of the container's children)
        const childrenOfOver = flattenedNodes.filter(n => n.parentId === overNode.id);
        newOrder = childrenOfOver.length > 0
          ? Math.max(...childrenOfOver.map(n => n.index)) + 1
          : 0;
      } else {
        // Drop below the target (default)
        newParentId = overNode.parentId;
        newOrder = overNode.index + 1;

        // CRITICAL: Prevent placement at root level (parentId: null)
        // Everything must be inside Body
        if (newParentId === null) {
          setActiveId(null);
          setOverId(null);
          setDropPosition(null);
  
          setIsProcessing(false);
          return;
        }

        // Prevent Section from being placed outside Body
        // BUT allow reordering Sections when both are already at Body level
        if (activeNode.layer.name === 'section') {
          const parentNode = flattenedNodes.find(n => n.id === newParentId);
          const isParentBody = parentNode?.layer.name === 'body' || parentNode?.id === 'body';

          if (!isParentBody) {
            setActiveId(null);
            setOverId(null);
            setDropPosition(null);
    
            setIsProcessing(false);
            return;
          }
        }
      }

      // Check if this is a within-parent reorder on a non-desktop breakpoint
      // If so, use CSS order classes instead of changing DOM structure
      const isWithinParentReorder = activeNode.parentId === newParentId;
      const isResponsiveBreakpoint = activeBreakpoint !== 'desktop';

      let newLayers: Layer[];

      if (isWithinParentReorder && isResponsiveBreakpoint) {
        // Apply CSS order classes for responsive visual reordering
        // This keeps DOM structure intact but changes visual order on this breakpoint
        newLayers = applyResponsiveOrderClasses(
          layers,
          newParentId!,
          activeNode.id,
          newOrder,
          activeBreakpoint as 'tablet' | 'mobile'
        );
      } else {
        // Standard DOM structure change (affects all breakpoints)
        newLayers = rebuildTree(flattenedNodes, activeNode.id, newParentId, newOrder);
      }

      // Pass movedLayerId when parent changed (cross-parent move needs binding reset)
      const parentChanged = activeNode.parentId !== newParentId;
      onReorder(newLayers, parentChanged ? activeNode.id : undefined);
      setActiveId(null);
      setOverId(null);
      setDropPosition(null);

      // Use setTimeout to reset processing flag after state updates complete
      setTimeout(() => setIsProcessing(false), 0);
    },
    [flattenedNodes, dropPosition, onReorder, layers, activeBreakpoint]
  );

  // Handle drag cancel
  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setOverId(null);
    setDropPosition(null);
  }, []);

  // Handle expand/collapse toggle
  const handleToggle = useCallback((id: string) => {
    // Determine the new state
    const isCurrentlyCollapsed = collapsedIds.has(id);
    const willBeOpen = isCurrentlyCollapsed; // If collapsed, will open; if open, will collapse

    // Update local state
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (isCurrentlyCollapsed) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

    // Only persist for real layers (virtual sublayer nodes are local UI state only)
    const isVirtualNode = id.includes('__sub_') || id.includes('__style_') || id.includes('__mark_') || id.includes('__item_');
    if (!isVirtualNode) {
      const updatedLayers = updateLayerOpenState(layers, id, willBeOpen);
      onReorder(updatedLayers);
    }
  }, [layers, onReorder, collapsedIds]);

  // Handle layer selection
  const handleSelect = useCallback(
    (id: string) => {
      onLayerSelect(id);
    },
    [onLayerSelect]
  );

  const nodeSelectionData = useMemo(() => {
    const selectedIdsSet = new Set(selectedLayerIds);
    if (selectedLayerId) selectedIdsSet.add(selectedLayerId);

    // When a sublayer (content or style) is active, treat it as selected
    // and demote the parent layer to "has selected child"
    const hasContentSublayerActive = storeActiveSublayerIndex !== null && selectedLayerId !== null;
    const hasStyleSublayerActive = storeActiveTextStyleKey !== null && selectedLayerId !== null;
    const hasSublayerActive = hasContentSublayerActive || hasStyleSublayerActive;
    let activeSublayerNodeId: string | null = null;

    if (hasContentSublayerActive && storeActiveTextStyleKey === 'listItem' && storeActiveListItemIndex !== null) {
      const listItemMatch = flattenedNodes.find(
        n => n.sublayer && n.sublayer.kind === 'listItem' && n.sublayer.itemIndex === storeActiveListItemIndex
          && n.layer.id === selectedLayerId
          && n.parentId?.endsWith(`__sub_${storeActiveSublayerIndex}`)
      );
      activeSublayerNodeId = listItemMatch?.id ?? null;
    } else if (hasContentSublayerActive) {
      const contentMatch = flattenedNodes.find(
        n => n.sublayer && n.sublayer.kind === 'content' && n.parentId === selectedLayerId && n.index === storeActiveSublayerIndex
      );
      activeSublayerNodeId = contentMatch?.id ?? null;
    }

    // Fall through to style matching when no content sublayer matched (non-CMS rich text)
    if (!activeSublayerNodeId && hasStyleSublayerActive) {
      activeSublayerNodeId = flattenedNodes.find(
        n => n.sublayer && n.sublayer.kind === 'style' && n.sublayer.styleKey === storeActiveTextStyleKey && n.layer.id === selectedLayerId
      )?.id ?? null;
    }

    // Build a parent lookup map for O(1) access
    const nodeById = new Map<string, FlattenedItem>();
    flattenedNodes.forEach(node => nodeById.set(node.id, node));

    // Effective selected set: exclude the parent layer when a sublayer is active
    const effectiveSelectedSet = new Set(selectedIdsSet);
    if (hasSublayerActive && activeSublayerNodeId) {
      effectiveSelectedSet.delete(selectedLayerId!);
      effectiveSelectedSet.add(activeSublayerNodeId);
    }

    // For each node, compute: isChildOfSelected, parentSelectedId
    const childOfSelectedMap = new Map<string, string | null>(); // nodeId -> parentSelectedId

    flattenedNodes.forEach(node => {
      if (effectiveSelectedSet.has(node.id)) {
        childOfSelectedMap.set(node.id, null); // Selected nodes are not "child of selected"
        return;
      }

      // Walk up parent chain to see if any ancestor is selected
      let current: FlattenedItem | undefined = node;
      while (current && current.parentId) {
        if (effectiveSelectedSet.has(current.parentId)) {
          childOfSelectedMap.set(node.id, current.parentId);
          return;
        }
        current = nodeById.get(current.parentId);
      }
      childOfSelectedMap.set(node.id, null);
    });

    // Find last visible descendants for each selected parent
    const lastDescendantMap = new Map<string, string>(); // parentSelectedId -> lastDescendantId

    effectiveSelectedSet.forEach(selectedId => {
      // Find all descendants of this selected node
      const descendants: string[] = [];
      flattenedNodes.forEach(node => {
        if (childOfSelectedMap.get(node.id) === selectedId) {
          descendants.push(node.id);
        }
      });
      if (descendants.length > 0) {
        lastDescendantMap.set(selectedId, descendants[descendants.length - 1]);
      }
    });

    // Build final map for each node
    const result = new Map<string, {
      isSelected: boolean;
      isChildOfSelected: boolean;
      isLastVisibleDescendant: boolean;
      hasVisibleChildren: boolean;
    }>();

    flattenedNodes.forEach(node => {
      const parentSelectedId = childOfSelectedMap.get(node.id) ?? null;
      const isChildOfSelected = parentSelectedId !== null;
      const isLastVisibleDescendant = parentSelectedId !== null &&
        lastDescendantMap.get(parentSelectedId!) === node.id;
      const isSublayerNode = !!node.sublayer;
      let hasVisibleChildren: boolean;

      if (isSublayerNode) {
        // Virtual sublayer nodes: visible children = expandable and not collapsed
        hasVisibleChildren = node.canHaveChildren && !collapsedIds.has(node.id);
      } else {
        // Real layer nodes: check actual children and sublayer presence
        const hasAnySublayers = hasRichTextContent(node.layer)
          || (isTextContentLayer(node.layer) && getTextStyleSublayers(node.layer).length > 0);
        hasVisibleChildren = (!collapsedIds.has(node.id)) && (
          !!(node.layer.children && node.layer.children.length > 0) || hasAnySublayers
        );
      }

      result.set(node.id, {
        isSelected: effectiveSelectedSet.has(node.id),
        isChildOfSelected,
        isLastVisibleDescendant,
        hasVisibleChildren,
      });
    });

    return result;
  }, [flattenedNodes, selectedLayerIds, selectedLayerId, collapsedIds, storeActiveSublayerIndex, storeActiveTextStyleKey, storeActiveListItemIndex]);

  return (
    <LayerTreeStoreContext.Provider value={layerTreeStoreValues}>
    <DndContext
      sensors={sensors}
      collisionDetection={pointerFirstCollision}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div ref={wrapperRef} style={{ height: virtualizer.getTotalSize(), position: 'relative', minWidth: maxDepth > 0 ? `${maxDepth * 14 + 8 + treeAvailableWidth}px` : undefined }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const node = flattenedNodes[virtualRow.index];
          const selectionData = nodeSelectionData.get(node.id)!;

          // `highlightedDepths` is only consumed when drawing the connector
          // lines on selected / child-of-selected rows. Other rows would
          // otherwise re-render on every selection change just because the
          // string flipped — pin them to the empty token so React.memo bails.
          const rowHighlightedDepths = (selectionData.isSelected || selectionData.isChildOfSelected)
            ? highlightedDepths
            : ',,';

          return (
            <VirtualLayerRow
              key={node.id}
              nodeId={node.id}
              isRenaming={renamingLayerId === node.id}
              isLocalizing={isLocalizing}
              translateY={virtualRow.start}
            >
              <LayerRow
                node={node}
                isSelected={selectionData.isSelected}
                isChildOfSelected={selectionData.isChildOfSelected}
                isLastVisibleDescendant={selectionData.isLastVisibleDescendant}
                hasVisibleChildren={selectionData.hasVisibleChildren}
                canHaveChildren={node.canHaveChildren}
                isOver={overId === node.id}
                isDragging={activeId === node.id}
                isDragActive={!!activeId}
                dropPosition={overId === node.id ? dropPosition : null}
                highlightedDepths={rowHighlightedDepths}
                onSelect={handleSelect}
                onMultiSelect={handleMultiSelect}
                onToggle={handleToggle}
                pageId={pageId}
                liveLayerUpdates={liveLayerUpdates}
                liveComponentUpdates={liveComponentUpdates}
                activeBreakpoint={activeBreakpoint}
                isRenaming={renamingLayerId === node.id}
                onRenameStart={handleRenameStart}
                onRenameConfirm={handleRenameConfirm}
                onToggleVisibility={handleToggleVisibility}
                readOnly={readOnly}
              />
            </VirtualLayerRow>
          );
        })}

        {/* Drop zone at the end for dropping layers at the bottom */}
        <div style={{ position: 'absolute', top: virtualizer.getTotalSize(), left: 0, width: '100%' }}>
          <EndDropZone
            isDragActive={!!activeId}
            isOver={overId === 'end-drop-zone'}
            editingComponentId={editingComponentId}
          />
        </div>
      </div>

      {/* Empty DragOverlay to suppress dnd-kit default ghost */}
      <DragOverlay dropAnimation={null}>{null}</DragOverlay>

      {/* Custom drag ghost positioned at actual cursor via DOM ref */}
      {activeNode && (
        <div
          ref={ghostRef}
          className="fixed top-0 left-0 z-50 flex items-center text-white text-xs h-8 rounded-lg pointer-events-none"
          style={{ transform: 'translate(-9999px, -9999px)' }}
        >
          {(() => {
            const draggedComponent = activeNode.layer.componentId ? getComponentById(activeNode.layer.componentId) : null;
            const layerIcon = getLayerIcon(activeNode.layer, 'box', activeBreakpoint);
            const isActiveNodeSelected = selectedLayerIds.includes(activeNode.id) || selectedLayerId === activeNode.id;

            return (
              <>
                {draggedComponent ? (
                  <ComponentIcon className="w-3 h-3 shrink-0 mx-1.5 opacity-75" />
                ) : layerIcon ? (
                  <Icon
                    name={layerIcon}
                    className={cn(
                      'size-3 mx-1.5 opacity-50 shrink-0',
                      isActiveNodeSelected && 'opacity-100',
                    )}
                  />
                ) : (
                  <div className="size-3 bg-white/10 rounded mx-1.5 shrink-0" />
                )}
              </>
            );
          })()}
          <span>
            {getLayerDisplayLabel(activeNode.layer, {
              component_name: activeNode.layer.componentId ? getComponentById(activeNode.layer.componentId)?.name : null,
              collection_name: activeNodeCollectionContext.collection_name,
              source_field_name: activeNodeCollectionContext.source_field_name,
            }, activeBreakpoint)}
          </span>
        </div>
      )}
      <div className="min-h-10" />
    </DndContext>
    </LayerTreeStoreContext.Provider>
  );
}

// Helper function to rebuild tree structure after reordering
function rebuildTree(
  flattenedNodesRaw: FlattenedItem[],
  movedId: string,
  newParentId: string | null,
  newOrder: number
): Layer[] {
  // Exclude virtual sublayer nodes — they don't represent real layers
  const flattenedNodes = flattenedNodesRaw.filter(n => !n.sublayer);

  // Create a map of original layers to preserve all properties
  const originalLayerMap = new Map<string, Layer>();

  function collectLayers(layers: Layer[]) {
    layers.forEach(layer => {
      originalLayerMap.set(layer.id, layer);
      if (layer.children) {
        collectLayers(layer.children);
      }
    });
  }

  // Collect all layers from the flattened nodes
  flattenedNodes.forEach(node => {
    if (!originalLayerMap.has(node.id)) {
      collectLayers([node.layer]);
    }
  });

  // Create set of all visible node IDs (nodes that appear in flattened tree)
  const visibleNodeIds = new Set(flattenedNodes.map(n => n.id));

  // Create working copy of nodes with updated parent/index
  const nodeCopy = flattenedNodes.map(n => ({
    ...n,
    layer: originalLayerMap.get(n.id)! // Use original layer to preserve all properties
  }));

  // Find the moved node
  const movedNode = nodeCopy.find(n => n.id === movedId);
  if (!movedNode) {
    console.error('❌ REBUILD ERROR: Moved node not found!');
    return [];
  }

  // Update moved node's parent and index
  movedNode.parentId = newParentId;
  movedNode.index = newOrder;

  // Group nodes by parent
  const byParent = new Map<string | null, FlattenedItem[]>();
  nodeCopy.forEach(node => {
    const parent = node.parentId;
    if (!byParent.has(parent)) {
      byParent.set(parent, []);
    }
    byParent.get(parent)!.push(node);
  });

  // Sort each group by index and reassign indices
  byParent.forEach((children, parentId) => {
    // Sort by current index first
    children.sort((a, b) => a.index - b.index);

    // If this group contains the moved node, reorder it
    const movedNodeInGroup = children.find(n => n.id === movedId);
    if (movedNodeInGroup) {
      // Remove moved node from its current position
      const movedIndex = children.findIndex(n => n.id === movedId);
      children.splice(movedIndex, 1);

      // Insert at new position
      let insertIndex = 0;
      for (let i = 0; i < children.length; i++) {
        if (children[i].index < newOrder) {
          insertIndex = i + 1;
        } else {
          break;
        }
      }

      children.splice(insertIndex, 0, movedNodeInGroup);
    }

    // Reassign sequential indices
    children.forEach((child, idx) => {
      child.index = idx;
    });
  });

  // Build tree recursively, preserving properties but rebuilding structure
  // First, create a Set of all layer IDs in the visible tree (to detect moved layers)
  const allVisibleLayerIds = new Set(nodeCopy.map(n => n.id));

  function buildNode(nodeId: string): Layer {
    const node = nodeCopy.find(n => n.id === nodeId);
    const originalLayer = originalLayerMap.get(nodeId);

    if (!originalLayer) {
      console.error('❌ REBUILD ERROR: Original layer not found:', nodeId);
      return { id: nodeId, name: 'div', classes: '' };
    }

    // Get children from byParent (for visible nodes) OR from original layer (for collapsed)
    const childrenFromByParent = byParent.get(nodeId) || [];
    const originalChildren = originalLayer.children || [];

    // Preserve all layer properties EXCEPT children
    const { children: _, ...layerWithoutChildren } = originalLayer;
    const result: Layer = { ...layerWithoutChildren };

    // Decision: rebuild children OR preserve original?
    // - If this node is in the visible tree, rebuild from byParent
    // - If this node is NOT visible (hidden/collapsed), preserve original children
    const isNodeVisible = visibleNodeIds.has(nodeId);
    const isCollapsed = originalLayer.open === false;

    if (isNodeVisible) {
      // Node is visible - rebuild children from byParent to reflect the drag operation
      if (childrenFromByParent.length > 0) {
        // Build new/moved children from byParent
        const newChildren = childrenFromByParent.map(child => buildNode(child.id));

        if (isCollapsed && originalChildren.length > 0) {
          // Layer is collapsed - merge new children with original hidden children
          // IMPORTANT: Exclude children that were moved to other visible locations
          const newChildIds = new Set(childrenFromByParent.map(c => c.id));
          const preservedChildren = originalChildren.filter(c =>
            !newChildIds.has(c.id) && !allVisibleLayerIds.has(c.id)
          );
          result.children = [...newChildren, ...preservedChildren];
        } else {
          // Layer is expanded - use only byParent children (complete visible tree)
          result.children = newChildren;
        }
      } else {
        // No children in byParent - check if original had children
        // If original had children, they must be collapsed, so preserve them
        // But exclude any that appear in the visible tree (they were moved out)
        if (originalChildren.length > 0) {
          const preservedChildren = originalChildren.filter(c => !allVisibleLayerIds.has(c.id));
          if (preservedChildren.length > 0) {
            result.children = preservedChildren;
          }
        }
        // else: truly no children, don't set children property
      }
    } else {
      // Node is not visible (inside collapsed parent) - preserve original children completely
      if (originalChildren.length > 0) {
        result.children = originalChildren;
      }
    }

    return result;
  }

  // Build root level
  const rootNodes = byParent.get(null) || [];
  const result = rootNodes.map(node => buildNode(node.id));

  // Validate no duplicate IDs in the rebuilt tree
  if (process.env.NODE_ENV === 'development') {
    const allIds = new Set<string>();
    const duplicateInfo: Array<{ id: string; paths: string[] }> = [];

    function validateNoDuplicates(layers: Layer[], path: string = 'root'): void {
      layers.forEach((layer, idx) => {
        const currentPath = `${path}[${idx}]`;
        if (allIds.has(layer.id)) {
          let dupEntry = duplicateInfo.find(d => d.id === layer.id);
          if (!dupEntry) {
            dupEntry = { id: layer.id, paths: [] };
            duplicateInfo.push(dupEntry);
          }
          dupEntry.paths.push(currentPath);
        }
        allIds.add(layer.id);
        if (layer.children) {
          validateNoDuplicates(layer.children, `${currentPath}.children`);
        }
      });
    }

    validateNoDuplicates(result);

    if (duplicateInfo.length > 0) {
      console.error('❌ DUPLICATE IDs IN REBUILT TREE:');
      duplicateInfo.forEach(dup => {
        console.error(`  ID: ${dup.id} found at paths:`, dup.paths);
      });
      console.error('  movedId:', movedId);
      console.error('  newParentId:', newParentId);
    }
  }

  return result;
}

/**
 * Apply CSS order classes to reorder children visually for a specific breakpoint.
 * Instead of changing DOM structure, this applies order-{n} classes with breakpoint prefixes.
 *
 * @param layers - The full layer tree
 * @param parentId - The parent whose children should be reordered
 * @param movedChildId - The child that was moved
 * @param newIndex - The new visual index for the moved child
 * @param breakpoint - The active breakpoint (tablet or mobile)
 * @returns Updated layer tree with order classes applied
 */
function applyResponsiveOrderClasses(
  layers: Layer[],
  parentId: string,
  movedChildId: string,
  newIndex: number,
  breakpoint: 'tablet' | 'mobile'
): Layer[] {
  const prefix = getBreakpointPrefix(breakpoint); // max-lg: or max-md:

  // Helper to normalize classes to string
  const normalizeClasses = (classes: string | string[] | undefined): string => {
    if (!classes) return '';
    return Array.isArray(classes) ? classes.join(' ') : classes;
  };

  // Helper to remove existing order classes for this breakpoint
  const removeOrderClasses = (classes: string): string => {
    return classes
      .split(' ')
      .filter(cls => {
        // Remove order classes for this breakpoint
        if (prefix && cls.startsWith(prefix)) {
          const baseClass = cls.slice(prefix.length);
          return !baseClass.startsWith('order-');
        }
        // For desktop (no prefix), we don't touch those
        return true;
      })
      .join(' ');
  };

  // Helper to add order class
  const addOrderClass = (classes: string | string[] | undefined, order: number): string => {
    const normalized = normalizeClasses(classes);
    const cleaned = removeOrderClasses(normalized);
    const orderClass = `${prefix}order-${order}`;
    return cleaned ? `${cleaned} ${orderClass}` : orderClass;
  };

  // Recursively process the tree
  function processLayers(layerList: Layer[]): Layer[] {
    return layerList.map(layer => {
      if (layer.id === parentId && layer.children) {
        // Found the parent - reorder its children with order classes
        const children = [...layer.children];

        // Find the moved child's current index
        const currentIndex = children.findIndex(c => c.id === movedChildId);
        if (currentIndex === -1) {
          // Child not found, return as is
          return layer;
        }

        // Calculate new order values
        // We need to assign order values so the moved child appears at newIndex
        const updatedChildren = children.map((child, idx) => {
          let visualOrder: number;

          if (child.id === movedChildId) {
            // The moved child gets the target position
            visualOrder = newIndex;
          } else if (idx < currentIndex && idx >= newIndex) {
            // Children that need to shift right (moved child went before them)
            visualOrder = idx + 1;
          } else if (idx > currentIndex && idx <= newIndex) {
            // Children that need to shift left (moved child went after them)
            visualOrder = idx - 1;
          } else {
            // Children not affected by the move
            visualOrder = idx;
          }

          return {
            ...child,
            classes: addOrderClass(child.classes, visualOrder),
            children: child.children ? processLayers(child.children) : undefined,
          };
        });

        return {
          ...layer,
          children: updatedChildren,
        };
      }

      // Not the parent, but process children recursively
      if (layer.children) {
        return {
          ...layer,
          children: processLayers(layer.children),
        };
      }

      return layer;
    });
  }

  return processLayers(layers);
}
