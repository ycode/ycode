'use client';

/**
 * Element Library Slide-Out Panel
 *
 * Displays categorized list of available elements that can be added to the page.
 * Uses custom pointer-based drag-and-drop for cross-iframe dragging to canvas.
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { Component } from '@/types';
import Image from 'next/image';
import { getLayerFromTemplate, getBlockName, getBlockIcon, getLayoutTemplate, getLayoutCategory, getLayoutPreviewImage, getLayoutsByCategory, getAllLayoutKeys } from '@/lib/templates/blocks';
import { DEFAULT_ASSETS } from '@/lib/asset-constants';
import { canHaveChildren, assignOrderClassToNewLayer, collectAllSettingsIds, generateUniqueSettingsId } from '@/lib/layer-utils';
import { checkCircularReference, isCircularComponentReference } from '@/lib/component-utils';
import { cn, generateId } from '@/lib/utils';
import { toast } from 'sonner';
import { componentsApi } from '@/lib/api';
import type { Layer } from '@/types';
import ComponentCard from './ComponentCard';
import SaveLayoutDialog from './SaveLayoutDialog';
import { usePagesStore } from '@/stores/usePagesStore';
import { useEditorStore } from '@/stores/useEditorStore';
import { useComponentsStore } from '@/stores/useComponentsStore';
import { useEditorActions } from '@/hooks/use-editor-url';
import type { UseLiveLayerUpdatesReturn } from '@/hooks/use-live-layer-updates';

/**
 * Element Button with drag support
 * Uses simple mousedown handler to start drag
 */
interface ElementButtonProps {
  elementType: string;
  source: 'elements' | 'layouts' | 'components';
  name: string;
  icon: React.ComponentProps<typeof Icon>['name'];
  onClick: () => void;
  onDragStart: (e: React.MouseEvent, elementType: string, source: 'elements' | 'layouts' | 'components', name: string) => void;
  children?: React.ReactNode;
  className?: string;
  variant?: 'default' | 'card';
}

function ElementButton({
  elementType,
  source,
  name,
  icon,
  onClick,
  onDragStart,
  children,
  className,
  variant = 'default',
}: ElementButtonProps) {
  const isDraggingRef = useRef(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only handle left mouse button
    if (e.button !== 0) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const DRAG_THRESHOLD = 5;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (!isDraggingRef.current && distance > DRAG_THRESHOLD) {
        isDraggingRef.current = true;
        // Create a synthetic React event for the onDragStart callback
        onDragStart(e, elementType, source, name);
      }
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);

      // If we didn't drag, trigger click
      if (!isDraggingRef.current) {
        onClick();
      }

      isDraggingRef.current = false;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  if (variant === 'card') {
    return (
      <Button
        onMouseDown={handleMouseDown}
        size="sm"
        variant="secondary"
        className={cn(
          'justify-start flex-col items-start p-1.5 overflow-hidden hover:opacity-90 transition-opacity rounded-[10px] h-auto! cursor-grab active:cursor-grabbing select-none',
          className
        )}
      >
        {children}
      </Button>
    );
  }

  return (
    <Button
      onMouseDown={handleMouseDown}
      size="sm"
      variant="secondary"
      className={cn(
        'justify-start cursor-grab active:cursor-grabbing select-none',
        className
      )}
    >
      <Icon name={icon} />
      <span className="truncate">{name}</span>
    </Button>
  );
}

interface ElementLibraryProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: 'elements' | 'layouts' | 'components';
  liveLayerUpdates?: UseLiveLayerUpdatesReturn | null;
}

// Category definitions
const elementCategories: Record<string, string[]> = {
  Structure: ['section', 'container', 'div', 'hr', 'columns', 'rows', 'grid', 'collection'],
  Content: ['heading', 'text'],
  Actions: ['button'],
  Media: ['image', 'icon', 'video', 'audio'],
  Form: ['form', 'input', 'textarea', 'select', 'checkbox', 'radio', 'label', 'filter'],
  Utilities: ['slider', 'lightbox', 'localeSelector', 'htmlEmbed'],
};

/**
 * Check if a layer tree contains any inlined components
 */
function hasInlinedComponents(layer: Layer): boolean {
  if ((layer as any)._inlinedComponentName) return true;
  if (layer.children) {
    return layer.children.some(child => hasInlinedComponents(child));
  }
  return false;
}

/**
 * Process a layout layer tree to restore inlined components.
 * When a layout contains _inlinedComponentName, we create actual components
 * and replace the inlined content with component instances.
 */
async function restoreInlinedComponents(
  layer: Layer,
  existingComponents: { id: string; name: string }[],
  createdComponents: Map<string, string> // name -> componentId
): Promise<Layer> {
  const newLayer = { ...layer } as Layer & {
    _inlinedComponentName?: string;
    _inlinedComponentVariables?: any[];
  };

  // Check if this layer has inlined component data
  if (newLayer._inlinedComponentName && newLayer.children?.length) {
    const componentName = newLayer._inlinedComponentName;
    const componentVariables = newLayer._inlinedComponentVariables;

    // Check if we already created this component in this batch
    let componentId: string | undefined = createdComponents.get(componentName);

    if (!componentId) {
      // Check if a component with this name already exists
      const existing = existingComponents.find(c => c.name === componentName);

      if (existing) {
        componentId = existing.id;
      } else {
        // Create new component from inlined layers (including variables)
        try {
          // Debug: check if layers have interactions and log layer IDs
          const collectLayerIds = (layers: any[]): string[] => {
            const ids: string[] = [];
            for (const l of layers) {
              if (l.id) ids.push(l.id);
              if (l.children) ids.push(...collectLayerIds(l.children));
            }
            return ids;
          };
          const collectInteractionTargets = (layers: any[]): string[] => {
            const targets: string[] = [];
            for (const l of layers) {
              if (l.interactions) {
                for (const int of l.interactions) {
                  for (const tween of int.tweens || []) {
                    if (tween.layer_id) targets.push(tween.layer_id);
                  }
                }
              }
              if (l.children) targets.push(...collectInteractionTargets(l.children));
            }
            return targets;
          };

          const layerIds = collectLayerIds(newLayer.children || []);
          const interactionTargets = collectInteractionTargets(newLayer.children || []);
          const missingTargets = interactionTargets.filter(t => !layerIds.includes(t));

          if (missingTargets.length > 0) {
            console.warn(`[restoreInlinedComponents] ⚠️ Missing layer targets:`, missingTargets);
          }

          const result = await componentsApi.create({
            name: componentName,
            layers: newLayer.children,
            variables: componentVariables,
          });
          const newId = result.data?.id;
          if (newId) {
            componentId = newId;
            createdComponents.set(componentName, newId);
          }
        } catch (error) {
          console.error(`Failed to create component "${componentName}":`, error);
        }
      }
    }

    if (componentId) {
      // Convert to component instance
      newLayer.componentId = componentId;
      newLayer.children = []; // Clear inlined children
      delete newLayer._inlinedComponentName;
      delete newLayer._inlinedComponentVariables;
    }
  }

  // Recursively process children that weren't converted to component instances
  // Process sequentially to avoid race conditions when creating components
  if (newLayer.children?.length && !newLayer.componentId) {
    const processedChildren: Layer[] = [];
    for (const child of newLayer.children) {
      const processed = await restoreInlinedComponents(child, existingComponents, createdComponents);
      processedChildren.push(processed);
    }
    newLayer.children = processedChildren;
  }

  return newLayer;
}

export default function ElementLibrary({ isOpen, onClose, defaultTab = 'elements', liveLayerUpdates }: ElementLibraryProps) {
  const { addLayerFromTemplate, updateLayer, setDraftLayers, draftsByPageId, pages } = usePagesStore();
  const { currentPageId, selectedLayerId, setSelectedLayerId, editingComponentId, activeBreakpoint, pushComponentNavigation, startCanvasDrag, endCanvasDrag } = useEditorStore();
  const { components, componentDrafts, updateComponentDraft, deleteComponent, getDeletePreview, loadComponentDraft, getComponentById, loadComponents } = useComponentsStore();
  const { openComponent } = useEditorActions();

  // Delete component state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [componentToDelete, setComponentToDelete] = useState<Component | null>(null);
  const [deletePreviewInfo, setDeletePreviewInfo] = useState<{ pageCount: number; componentCount: number } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [activeTab, setActiveTab] = React.useState<'elements' | 'layouts' | 'components'>(() => {
    // Try to load from sessionStorage first
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('elementLibrary-activeTab');
      if (saved && ['elements', 'layouts', 'components'].includes(saved)) {
        return saved as 'elements' | 'layouts' | 'components';
      }
    }
    return defaultTab;
  });
  const [componentSearch, setComponentSearch] = useState('');

  const circularComponentIds = useMemo(() => {
    if (!editingComponentId) return new Set<string>();
    return new Set(
      components
        .filter(c => isCircularComponentReference(editingComponentId, c.id, components))
        .map(c => c.id)
    );
  }, [components, editingComponentId]);

  const matchingComponentIds = useMemo(() => {
    if (!componentSearch.trim()) return null;
    const query = componentSearch.toLowerCase();
    return new Set(
      components.filter(c => c.name.toLowerCase().includes(query)).map(c => c.id)
    );
  }, [components, componentSearch]);

  const hasComponentResults = !matchingComponentIds || matchingComponentIds.size > 0;

  const [isEditLayoutDialogOpen, setIsEditLayoutDialogOpen] = useState(false);
  const [editingLayoutKey, setEditingLayoutKey] = useState<string>('');
  const [editingLayoutName, setEditingLayoutName] = useState<string>('');
  const [editingLayoutCategory, setEditingLayoutCategory] = useState<string>('Custom');
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(() => {
    // Try to load from sessionStorage first
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('elementLibrary-collapsedCategories');
      if (saved) {
        try {
          return new Set(JSON.parse(saved));
        } catch (e) {
          // If parsing fails, fall through to default
        }
      }
    }
    // Initialize with all categories collapsed except "Navigation", "Hero", "Blog header" and "Blog posts"
    const allCategories = Object.keys(getLayoutsByCategory());
    return new Set(allCategories.filter(cat => cat !== 'Navigation' && cat !== 'Hero' && cat !== 'Blog header' && cat !== 'Blog posts'));
  });

  // Sync active tab when defaultTab prop changes (e.g., "Add layout" button, keyboard shortcut)
  React.useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab]);

  // Persist active tab to sessionStorage
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('elementLibrary-activeTab', activeTab);
    }
  }, [activeTab]);

  // Persist collapsed state to sessionStorage
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(
        'elementLibrary-collapsedCategories',
        JSON.stringify(Array.from(collapsedCategories))
      );
    }
  }, [collapsedCategories]);

  const toggleCategory = (category: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  // Handle drag start from element buttons
  // This is called when the mouse moves past the drag threshold
  const handleElementDragStart = useCallback((
    e: React.MouseEvent,
    elementType: string,
    source: 'elements' | 'layouts' | 'components',
    displayName: string
  ) => {
    // Set drag state in store - this triggers the DragPreviewPortal and hit-testing
    startCanvasDrag(elementType, source, displayName, { x: e.clientX, y: e.clientY });
    // Close sidebar when drag starts
    onClose();
  }, [startCanvasDrag, onClose]);

  const handleAddElement = (elementType: string) => {
    // If editing component, use component draft instead
    if (editingComponentId) {
      const layers = componentDrafts[editingComponentId] || [];
      const parentId = selectedLayerId || layers[0]?.id || 'body';

      // Create new layer from template
      const template = getLayerFromTemplate(elementType);
      const displayName = getBlockName(elementType);

      // Collect existing settings IDs to generate unique ones
      const existingSettingsIds = collectAllSettingsIds(layers);
      const usedSettingsIds = new Set<string>(existingSettingsIds);

      // Track old→new settings.id mappings so we can update 'for' attributes on labels
      const idMappings = new Map<string, string>();

      // Helper to normalize layer and generate unique settings IDs
      const normalizeLayerWithUniqueIds = (layer: any): any => {
        const normalized = { ...layer };

        // Generate unique settings.id if the layer has one
        if (normalized.settings?.id) {
          const originalId = normalized.settings.id;
          const uniqueId = generateUniqueSettingsId(originalId, usedSettingsIds);
          usedSettingsIds.add(uniqueId);
          normalized.settings = {
            ...normalized.settings,
            id: uniqueId,
          };
          // Track the mapping for updating 'for' attributes
          if (originalId !== uniqueId) {
            idMappings.set(originalId, uniqueId);
          }
        }

        // Recursively normalize children
        if (normalized.children) {
          normalized.children = normalized.children.map((child: any) => normalizeLayerWithUniqueIds(child));
        }

        return normalized;
      };

      // Update 'for' attributes on labels to match the new unique settings IDs
      const updateForAttributes = (layer: any): any => {
        const updated = { ...layer };
        if (updated.attributes?.for && idMappings.has(updated.attributes.for)) {
          updated.attributes = {
            ...updated.attributes,
            for: idMappings.get(updated.attributes.for),
          };
        }
        if (updated.children) {
          updated.children = updated.children.map((child: any) => updateForAttributes(child));
        }
        return updated;
      };

      let normalizedTemplate = normalizeLayerWithUniqueIds(template);
      // Fix label 'for' attributes to point to the new unique IDs
      if (idMappings.size > 0) {
        normalizedTemplate = updateForAttributes(normalizedTemplate);
      }
      // Form elements use a wrapper div that should show as "Block" in the Layers panel,
      // not inherit the element type name. The child elements already show their correct names.
      const formWrapperTypes = ['input', 'textarea', 'select', 'checkbox', 'radio'];
      const isFormWrapper = formWrapperTypes.includes(elementType);
      const newLayer = {
        ...normalizedTemplate,
        id: generateId('lyr'),
        customName: isFormWrapper ? undefined : (displayName || undefined),
      };

      // Detect if we're adding a Section layer
      const isAddingSection = elementType === 'section' || newLayer.name === 'section';

      // Find parent layer and check if it can have children
      const findLayerInTree = (tree: any[], targetId: string): any | null => {
        for (const node of tree) {
          if (node.id === targetId) return node;
          if (node.children) {
            const found = findLayerInTree(node.children, targetId);
            if (found) return found;
          }
        }
        return null;
      };

      const parentLayer = findLayerInTree(layers, parentId);

      // Find parent and add layer
      const addLayerToTree = (tree: any[], targetId: string, parentNode: any = null): { success: boolean; newLayers: any[]; newLayerId: string; parentToExpand: string | null } => {
        // Special handling for Section layers - add to Body level
        if (isAddingSection) {
          // Find the Body/root container
          const bodyLayer = tree.find(l => l.id === 'body' || l.name === 'body');
          if (bodyLayer) {
            const bodyIndex = tree.findIndex(l => l.id === bodyLayer.id);
            const updatedBody = {
              ...bodyLayer,
              children: [...(bodyLayer.children || []), newLayer]
            };
            return {
              success: true,
              newLayers: [...tree.slice(0, bodyIndex), updatedBody, ...tree.slice(bodyIndex + 1)],
              newLayerId: newLayer.id,
              parentToExpand: bodyLayer.id
            };
          }
        }

        // Regular logic for non-Section layers
        for (let i = 0; i < tree.length; i++) {
          const node = tree[i];
          if (node.id === targetId) {
            // When adding a form element and the selected node's parent is a form,
            // add as sibling after the selected node (not as a child of it).
            // This way new form fields appear at the same level inside the form.
            const shouldAddAsSibling = isFormWrapper && parentNode?.name === 'form';

            // Found target, check if it can have children
            if (canHaveChildren(node, newLayer.name) && !shouldAddAsSibling) {
              // Add as child
              const updatedNode = {
                ...node,
                children: [...(node.children || []), newLayer]
              };
              return {
                success: true,
                newLayers: [...tree.slice(0, i), updatedNode, ...tree.slice(i + 1)],
                newLayerId: newLayer.id,
                parentToExpand: targetId
              };
            } else {
              // Cannot have children (or should add as sibling), add as sibling after this node
              return {
                success: true,
                newLayers: [...tree.slice(0, i + 1), newLayer, ...tree.slice(i + 1)],
                newLayerId: newLayer.id,
                parentToExpand: parentNode ? parentNode.id : null
              };
            }
          }
          if (node.children) {
            const result = addLayerToTree(node.children, targetId, node);
            if (result.success) {
              return {
                success: true,
                newLayers: [
                  ...tree.slice(0, i),
                  { ...node, children: result.newLayers },
                  ...tree.slice(i + 1)
                ],
                newLayerId: result.newLayerId,
                parentToExpand: result.parentToExpand
              };
            }
          }
        }
        return { success: false, newLayers: tree, newLayerId: '', parentToExpand: null };
      };

      const result = addLayerToTree(layers, parentId);
      if (result.success) {
        // Apply order class to new layer if siblings have responsive order classes
        let finalLayers = result.newLayers;
        if (result.parentToExpand) {
          finalLayers = assignOrderClassToNewLayer(
            result.newLayers,
            result.parentToExpand,
            result.newLayerId,
            activeBreakpoint
          );
        }

        updateComponentDraft(editingComponentId, finalLayers);
        setSelectedLayerId(result.newLayerId);
        if (result.parentToExpand) {
          window.dispatchEvent(new CustomEvent('expandLayer', {
            detail: { layerId: result.parentToExpand }
          }));
        }
      }

      onClose();
      return;
    }

    // Regular page mode
    if (!currentPageId) return;

    // Determine parent (selected container or Body)
    let parentId = selectedLayerId || 'body';

    // Special handling for Section layers - always add to Body
    const isAddingSection = elementType === 'section';
    if (isAddingSection) {
      parentId = 'body';
    }

    // Add the layer using the template
    const result = addLayerFromTemplate(currentPageId, parentId, elementType);

    // Select the newly added layer
    if (result) {
      setSelectedLayerId(result.newLayerId);

      // Assign order class to new layer if siblings have responsive order classes
      if (result.parentToExpand) {
        const freshDraft = usePagesStore.getState().draftsByPageId[currentPageId];
        if (freshDraft) {
          const updatedLayers = assignOrderClassToNewLayer(
            freshDraft.layers,
            result.parentToExpand,
            result.newLayerId,
            activeBreakpoint
          );
          // Only update if layers actually changed
          if (updatedLayers !== freshDraft.layers) {
            setDraftLayers(currentPageId, updatedLayers);
          }
        }
      }

      // Broadcast layer add to other collaborators
      if (liveLayerUpdates && currentPageId) {
        // Get FRESH state from store (not stale draftsByPageId from render)
        const freshDraft = usePagesStore.getState().draftsByPageId[currentPageId];
        if (freshDraft) {
          // Find the new layer AND its actual parent (may differ from requested parentId)
          const findLayerWithParent = (layers: any[], id: string, parent: any = null): { layer: any; parent: any } | null => {
            for (const layer of layers) {
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
            // Use the ACTUAL parent ID where the layer was placed
            const actualParentId = found.parent?.id || null;
            liveLayerUpdates.broadcastLayerAdd(currentPageId, actualParentId, elementType, found.layer);
          }
        }
      }

      // Note: parentToExpand is handled by LayersTree component
      // We dispatch a custom event for LayersTree to listen to
      if (result.parentToExpand) {
        window.dispatchEvent(new CustomEvent('expandLayer', {
          detail: { layerId: result.parentToExpand }
        }));
      }
    }

    // Close the panel
    onClose();
  };

  const handleAddLayout = async (layoutKey: string) => {
    // If editing component, use component draft instead
    if (editingComponentId) {
      const layers = componentDrafts[editingComponentId] || [];

      // Get layout template first (we need it to check if it's a section)
      const layoutTemplate = getLayoutTemplate(layoutKey);
      if (!layoutTemplate) return;

      // Special handling for Section layouts - always add to Body/root level
      const isAddingSection = layoutTemplate.name === 'section';
      let parentId = selectedLayerId || layers[0]?.id || 'body';
      if (isAddingSection) {
        parentId = layers[0]?.id || 'body'; // Add to root/body level
      }

      // Collect existing settings IDs to generate unique ones
      const existingSettingsIds = collectAllSettingsIds(layers);
      const usedSettingsIds = new Set<string>(existingSettingsIds);

      // Track old→new settings.id mappings so we can update 'for' attributes on labels
      const idMappings = new Map<string, string>();

      // Helper to normalize layer and generate unique settings IDs
      const normalizeLayerWithUniqueIds = (layer: any): any => {
        const normalized = { ...layer };

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
          normalized.children = normalized.children.map((child: any) => normalizeLayerWithUniqueIds(child));
        }

        return normalized;
      };

      // Update 'for' attributes on labels to match the new unique settings IDs
      const updateForAttributes = (layer: any): any => {
        const updated = { ...layer };
        if (updated.attributes?.for && idMappings.has(updated.attributes.for)) {
          updated.attributes = {
            ...updated.attributes,
            for: idMappings.get(updated.attributes.for),
          };
        }
        if (updated.children) {
          updated.children = updated.children.map((child: any) => updateForAttributes(child));
        }
        return updated;
      };

      // getLayoutTemplate already handles ID regeneration and interaction remapping
      let newLayer = normalizeLayerWithUniqueIds(layoutTemplate);
      if (idMappings.size > 0) {
        newLayer = updateForAttributes(newLayer);
      }

      // Restore inlined components (create actual components from inlined data)
      if (hasInlinedComponents(newLayer)) {
        const createdComponents = new Map<string, string>();
        newLayer = await restoreInlinedComponents(
          newLayer,
          components.map(c => ({ id: c.id, name: c.name })),
          createdComponents
        );

        // Refresh components store if new components were created
        if (createdComponents.size > 0) {
          await loadComponents();
        }
      }

      // Find parent layer and check if it can have children
      const findLayerInTree = (tree: any[], targetId: string): any | null => {
        for (const node of tree) {
          if (node.id === targetId) return node;
          if (node.children) {
            const found = findLayerInTree(node.children, targetId);
            if (found) return found;
          }
        }
        return null;
      };

      const parentLayer = findLayerInTree(layers, parentId);

      // Find parent and add layer
      const addLayerToTree = (tree: any[], targetId: string, parentNode: any = null): { success: boolean; newLayers: any[]; newLayerId: string; parentToExpand: string | null } => {
        for (let i = 0; i < tree.length; i++) {
          const node = tree[i];
          if (node.id === targetId) {
            // Found target, check if it can have children
            if (canHaveChildren(node)) {
              // Add as child
              const updatedNode = {
                ...node,
                children: [...(node.children || []), newLayer]
              };
              return {
                success: true,
                newLayers: [...tree.slice(0, i), updatedNode, ...tree.slice(i + 1)],
                newLayerId: newLayer.id,
                parentToExpand: targetId
              };
            } else {
              // Cannot have children, add as sibling after this node
              return {
                success: true,
                newLayers: [...tree.slice(0, i + 1), newLayer, ...tree.slice(i + 1)],
                newLayerId: newLayer.id,
                parentToExpand: parentNode ? parentNode.id : null
              };
            }
          }
          if (node.children) {
            const result = addLayerToTree(node.children, targetId, node);
            if (result.success) {
              return {
                success: true,
                newLayers: [
                  ...tree.slice(0, i),
                  { ...node, children: result.newLayers },
                  ...tree.slice(i + 1)
                ],
                newLayerId: result.newLayerId,
                parentToExpand: result.parentToExpand
              };
            }
          }
        }
        return { success: false, newLayers: tree, newLayerId: '', parentToExpand: null };
      };

      const result = addLayerToTree(layers, parentId);
      if (result.success) {
        // Apply order class to new layer if siblings have responsive order classes
        let finalLayers = result.newLayers;
        if (result.parentToExpand) {
          finalLayers = assignOrderClassToNewLayer(
            result.newLayers,
            result.parentToExpand,
            result.newLayerId,
            activeBreakpoint
          );
        }

        updateComponentDraft(editingComponentId, finalLayers);
        setSelectedLayerId(result.newLayerId);
        if (result.parentToExpand) {
          window.dispatchEvent(new CustomEvent('expandLayer', {
            detail: { layerId: result.parentToExpand }
          }));
        }
      }

      onClose();
      return;
    }

    // Regular page mode
    if (!currentPageId) return;

    // Get layout template first (we need it to check if it's a section)
    const layoutTemplate = getLayoutTemplate(layoutKey);
    if (!layoutTemplate) return;

    // Determine parent (selected container or Body)
    // Special handling for Section layouts - always add to Body
    const isAddingSection = layoutTemplate.name === 'section';
    let parentId = selectedLayerId || 'body';
    if (isAddingSection) {
      parentId = 'body';
    }

    // Use the internal addLayerFromTemplate logic but with our layout
    const draft = usePagesStore.getState().draftsByPageId[currentPageId];
    if (!draft) {
      const page = usePagesStore.getState().pages.find(p => p.id === currentPageId);
      if (!page) return;
    }

    // Collect existing settings IDs to generate unique ones
    const existingSettingsIds = collectAllSettingsIds(draft?.layers || []);
    const usedSettingsIds = new Set<string>(existingSettingsIds);

    // Track old→new settings.id mappings so we can update 'for' attributes on labels
    const idMappings = new Map<string, string>();

    // Helper to normalize layer and generate unique settings IDs
    const normalizeLayerWithUniqueIds = (layer: any): any => {
      const normalized = { ...layer };

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
        normalized.children = normalized.children.map((child: any) => normalizeLayerWithUniqueIds(child));
      }

      return normalized;
    };

    // Update 'for' attributes on labels to match the new unique settings IDs
    const updateForAttributes = (layer: any): any => {
      const updated = { ...layer };
      if (updated.attributes?.for && idMappings.has(updated.attributes.for)) {
        updated.attributes = {
          ...updated.attributes,
          for: idMappings.get(updated.attributes.for),
        };
      }
      if (updated.children) {
        updated.children = updated.children.map((child: any) => updateForAttributes(child));
      }
      return updated;
    };

    // getLayoutTemplate already handles ID regeneration and interaction remapping
    let newLayer = normalizeLayerWithUniqueIds(layoutTemplate);
    if (idMappings.size > 0) {
      newLayer = updateForAttributes(newLayer);
    }

    // Restore inlined components (create actual components from inlined data)
    if (hasInlinedComponents(newLayer)) {
      const createdComponents = new Map<string, string>();
      newLayer = await restoreInlinedComponents(
        newLayer,
        components.map(c => ({ id: c.id, name: c.name })),
        createdComponents
      );

      // Refresh components store if new components were created
      if (createdComponents.size > 0) {
        await loadComponents();
      }
    }

    // Find parent layer
    const findLayerWithParent = (tree: any[], id: string, parent: any | null = null): { layer: any; parent: any | null } | null => {
      for (const node of tree) {
        if (node.id === id) return { layer: node, parent };
        if (node.children) {
          const found = findLayerWithParent(node.children, id, node);
          if (found) return found;
        }
      }
      return null;
    };

    const currentDraft = usePagesStore.getState().draftsByPageId[currentPageId] || {
      id: `draft-${currentPageId}`,
      page_id: currentPageId,
      layers: [],
      is_published: false,
      created_at: new Date().toISOString(),
      deleted_at: null,
    };

    const result = findLayerWithParent(currentDraft.layers, parentId);
    let newLayers;
    let parentToExpand: string | null = null;

    if (!result) {
      // Add to root
      newLayers = [...currentDraft.layers, newLayer];
    } else {
      // Check if parent can have children
      if (canHaveChildren(result.layer)) {
        // Add as child
        const updateLayerInTree = (tree: any[], layerId: string, updater: (l: any) => any): any[] => {
          return tree.map((node) => {
            if (node.id === layerId) {
              return updater(node);
            }
            if (node.children && node.children.length > 0) {
              return { ...node, children: updateLayerInTree(node.children, layerId, updater) };
            }
            return node;
          });
        };

        newLayers = updateLayerInTree(currentDraft.layers, parentId, (parent) => ({
          ...parent,
          children: [...(parent.children || []), newLayer],
        }));
        parentToExpand = parentId;
      } else {
        // Insert after the selected layer
        if (result.parent) {
          const updateLayerInTree = (tree: any[], layerId: string, updater: (l: any) => any): any[] => {
            return tree.map((node) => {
              if (node.id === layerId) {
                return updater(node);
              }
              if (node.children && node.children.length > 0) {
                return { ...node, children: updateLayerInTree(node.children, layerId, updater) };
              }
              return node;
            });
          };

          newLayers = updateLayerInTree(currentDraft.layers, result.parent.id, (grandparent) => {
            const children = grandparent.children || [];
            const selectedIndex = children.findIndex((c: any) => c.id === parentId);
            const newChildren = [...children];
            newChildren.splice(selectedIndex + 1, 0, newLayer);
            return { ...grandparent, children: newChildren };
          });
          parentToExpand = result.parent.id;
        } else {
          // Selected layer is at root level, insert after it
          const selectedIndex = currentDraft.layers.findIndex((l: any) => l.id === parentId);
          newLayers = [...currentDraft.layers];
          newLayers.splice(selectedIndex + 1, 0, newLayer);
        }
      }
    }

    // Assign order class to new layer if siblings have responsive order classes
    let finalLayers = newLayers;
    if (parentToExpand) {
      finalLayers = assignOrderClassToNewLayer(
        newLayers,
        parentToExpand,
        newLayer.id,
        activeBreakpoint
      );
    }

    // Update the draft with the new layers
    usePagesStore.getState().setDraftLayers(currentPageId, finalLayers);

    // Broadcast layout add to other collaborators - find actual parent
    if (liveLayerUpdates) {
      const findLayerWithParent = (layers: any[], id: string, parent: any = null): { layer: any; parent: any } | null => {
        for (const layer of layers) {
          if (layer.id === id) return { layer, parent };
          if (layer.children) {
            const found = findLayerWithParent(layer.children, id, layer);
            if (found) return found;
          }
        }
        return null;
      };
      const found = findLayerWithParent(newLayers, newLayer.id);
      const actualParentId = found?.parent?.id || null;
      liveLayerUpdates.broadcastLayerAdd(currentPageId, actualParentId, layoutKey, newLayer);
    }

    // Select the root layer of the layout
    setSelectedLayerId(newLayer.id);

    // Expand parent if needed
    if (parentToExpand) {
      window.dispatchEvent(new CustomEvent('expandLayer', {
        detail: { layerId: parentToExpand }
      }));
    }

    // Close the panel
    onClose();
  };

  const handleDeleteLayout = async (layoutKey: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering the add layout action

    if (!confirm(`Are you sure you want to delete the layout "${layoutKey}"?`)) {
      return;
    }

    try {
      const response = await fetch(`/ycode/api/layouts/${layoutKey}`, {
        method: 'DELETE',
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to delete layout');
      }

      // Refresh the page to reload layouts
      window.location.reload();
    } catch (error) {
      console.error('Failed to delete layout:', error);
      alert('Failed to delete layout. Check console for details.');
    }
  };

  const handleEditLayout = async (layoutKey: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering the add layout action

    // Get current category
    const category = getLayoutCategory(layoutKey) || 'Custom';

    // Convert layout-key to Layout Name
    const layoutName = layoutKey
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

    // Set state and open dialog
    setEditingLayoutKey(layoutKey);
    setEditingLayoutName(layoutName);
    setEditingLayoutCategory(category);
    setIsEditLayoutDialogOpen(true);
  };

  const handleConfirmEditLayout = async (layoutName: string, category: string, imageFile: File | null, oldLayoutKey?: string) => {
    if (!oldLayoutKey) return;

    try {
      // Generate new layout key from name
      const newLayoutKey = layoutName.toLowerCase().replace(/\s+/g, '-');

      // Call API to update layout
      const response = await fetch(`/ycode/api/layouts/${oldLayoutKey}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          newLayoutKey,
          newLayoutName: layoutName,
          category,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update layout');
      }

      // Refresh the page to reload layouts
      window.location.reload();
    } catch (error) {
      console.error('Failed to update layout:', error);
      throw error;
    }
  };

  const handleAddComponent = (componentId: string) => {
    // Find the component
    const component = components.find(c => c.id === componentId);
    if (!component) return;

    // Create a component instance layer directly
    const componentInstanceLayer: Layer = {
      id: generateId('lyr'),
      name: 'div',
      customName: component.name,
      componentId: component.id,
      classes: ['block'], // Ensure it renders as a block element
      children: [], // Will be populated by resolveComponents on published pages
    };

    // Helper to find parent layer
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

    // Helper to update layer in tree
    const updateLayerInTree = (tree: Layer[], layerId: string, updater: (l: Layer) => Layer): Layer[] => {
      return tree.map((node) => {
        if (node.id === layerId) {
          return updater(node);
        }
        if (node.children && node.children.length > 0) {
          return { ...node, children: updateLayerInTree(node.children, layerId, updater) };
        }
        return node;
      });
    };

    // If editing a component, add to component draft
    if (editingComponentId) {
      // Check for circular reference before adding
      const circularError = checkCircularReference(editingComponentId, componentInstanceLayer, components);
      if (circularError) {
        toast.error('Infinite component loop detected', { description: circularError });
        return;
      }

      const layers = componentDrafts[editingComponentId] || [];
      const parentId = selectedLayerId || layers[0]?.id;
      if (!parentId) return;

      const result = findLayerWithParent(layers, parentId);
      let newLayers: Layer[];
      let parentToExpand: string | null = null;

      if (!result) {
        newLayers = [...layers, componentInstanceLayer];
      } else if (canHaveChildren(result.layer)) {
        newLayers = updateLayerInTree(layers, parentId, (parent) => ({
          ...parent,
          children: [...(parent.children || []), componentInstanceLayer],
        }));
        parentToExpand = parentId;
      } else if (result.parent) {
        newLayers = updateLayerInTree(layers, result.parent.id, (grandparent) => {
          const children = grandparent.children || [];
          const selectedIndex = children.findIndex((c) => c.id === parentId);
          const newChildren = [...children];
          newChildren.splice(selectedIndex + 1, 0, componentInstanceLayer);
          return { ...grandparent, children: newChildren };
        });
        parentToExpand = result.parent.id;
      } else {
        const selectedIndex = layers.findIndex((l) => l.id === parentId);
        newLayers = [...layers];
        newLayers.splice(selectedIndex + 1, 0, componentInstanceLayer);
      }

      updateComponentDraft(editingComponentId, newLayers);
      setSelectedLayerId(componentInstanceLayer.id);

      if (parentToExpand) {
        window.dispatchEvent(new CustomEvent('expandLayer', {
          detail: { layerId: parentToExpand }
        }));
      }

      onClose();
      return;
    }

    // Page mode - require currentPageId
    if (!currentPageId) return;

    // Determine parent (selected container or Body)
    const parentId = selectedLayerId || 'body';

    const draft = usePagesStore.getState().draftsByPageId[currentPageId];
    if (!draft) return;

    const result = findLayerWithParent(draft.layers, parentId);
    let newLayers: Layer[];
    let parentToExpand: string | null = null;

    if (!result) {
      // Add to root
      newLayers = [...draft.layers, componentInstanceLayer];
    } else {
      // Check if parent can have children
      if (canHaveChildren(result.layer)) {
        newLayers = updateLayerInTree(draft.layers, parentId, (parent) => ({
          ...parent,
          children: [...(parent.children || []), componentInstanceLayer],
        }));
        parentToExpand = parentId;
      } else {
        // Insert after the selected layer
        if (result.parent) {
          newLayers = updateLayerInTree(draft.layers, result.parent.id, (grandparent) => {
            const children = grandparent.children || [];
            const selectedIndex = children.findIndex((c) => c.id === parentId);
            const newChildren = [...children];
            newChildren.splice(selectedIndex + 1, 0, componentInstanceLayer);
            return { ...grandparent, children: newChildren };
          });
          parentToExpand = result.parent.id;
        } else {
          // Selected layer is at root level, insert after it
          const selectedIndex = draft.layers.findIndex((l) => l.id === parentId);
          newLayers = [...draft.layers];
          newLayers.splice(selectedIndex + 1, 0, componentInstanceLayer);
        }
      }
    }

    // Update the draft with the new layers (this should trigger autosave)
    usePagesStore.getState().setDraftLayers(currentPageId, newLayers);

    // Broadcast component add to other collaborators - find actual parent
    if (liveLayerUpdates) {
      const found = findLayerWithParent(newLayers, componentInstanceLayer.id);
      const actualParentId = found?.parent?.id || null;
      liveLayerUpdates.broadcastLayerAdd(currentPageId, actualParentId, `component:${componentId}`, componentInstanceLayer);
    }

    // Select the new layer
    setSelectedLayerId(componentInstanceLayer.id);

    // Expand parent if needed
    if (parentToExpand) {
      window.dispatchEvent(new CustomEvent('expandLayer', {
        detail: { layerId: parentToExpand }
      }));
    }

    // Close the panel
    onClose();
  };

  const handleEditComponent = async (component: Component, e: React.MouseEvent) => {
    e.stopPropagation();

    const { setSelectedLayerId: setLayerId } = useEditorStore.getState();

    setLayerId(null);

    if (editingComponentId) {
      const currentComponent = getComponentById(editingComponentId);
      if (currentComponent) {
        pushComponentNavigation({
          type: 'component',
          id: editingComponentId,
          name: currentComponent.name,
          layerId: selectedLayerId,
        });
      }
    } else if (currentPageId) {
      const currentPage = pages.find((p) => p.id === currentPageId);
      if (currentPage) {
        pushComponentNavigation({
          type: 'page',
          id: currentPageId,
          name: currentPage.name,
          layerId: selectedLayerId,
        });
      }
    }

    await loadComponentDraft(component.id);
    openComponent(component.id, currentPageId, undefined, undefined);

    if (component.layers?.length) {
      setLayerId(component.layers[0].id);
    }

    onClose();
  };

  const handleDeleteClick = async (component: Component, e: React.MouseEvent) => {
    e.stopPropagation();
    setComponentToDelete(component);

    // Get preview of affected entities
    const preview = await getDeletePreview(component.id);
    if (preview) {
      const pageCount = preview.affectedEntities.filter(e => e.type === 'page').length;
      const componentCount = preview.affectedEntities.filter(e => e.type === 'component').length;
      setDeletePreviewInfo({ pageCount, componentCount });
    } else {
      setDeletePreviewInfo({ pageCount: 0, componentCount: 0 });
    }

    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!componentToDelete) return;

    setIsDeleting(true);
    try {
      await deleteComponent(componentToDelete.id);
    } catch (error) {
      console.error('Failed to delete component:', error);
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      setComponentToDelete(null);
      setDeletePreviewInfo(null);
    }
  };

  const componentName = componentToDelete?.name ?? '';
  let usageSuffix = 'This component is not used anywhere.';
  if (deletePreviewInfo && (deletePreviewInfo.pageCount > 0 || deletePreviewInfo.componentCount > 0)) {
    const parts: string[] = [];
    if (deletePreviewInfo.pageCount > 0) {
      parts.push(`${deletePreviewInfo.pageCount} ${deletePreviewInfo.pageCount === 1 ? 'page' : 'pages'}`);
    }
    if (deletePreviewInfo.componentCount > 0) {
      parts.push(`${deletePreviewInfo.componentCount} ${deletePreviewInfo.componentCount === 1 ? 'component' : 'components'}`);
    }
    usageSuffix = `This component is used in ${parts.join(' and ')}.`;
  }

  const deleteConfirmDescription = `Are you sure you want to delete "${componentName}"? ${usageSuffix}`;

  if (!isOpen) return null;

  return (
    <div className="fixed left-64 top-14 bottom-0 w-64 bg-background border-r z-50 flex flex-col">
        {/* Tabs */}
        <Tabs
          value={activeTab} onValueChange={(value) => setActiveTab(value as 'elements' | 'layouts' | 'components')}
          className="flex flex-col h-full overflow-hidden gap-0"
        >
          <div className="flex flex-col shrink-0 gap-2">
            <div className="p-4 pb-0">
              <TabsList className="w-full">
                <TabsTrigger value="elements">Elements</TabsTrigger>
                <TabsTrigger value="layouts">Layouts</TabsTrigger>
                <TabsTrigger value="components">Components</TabsTrigger>
              </TabsList>
            </div>

            <hr className="mt-2 mb-0 mx-4 shrink-0" />
          </div>

          <TabsContent value="elements" className="flex flex-col divide-y overflow-y-auto flex-1 px-4 pb-4 no-scrollbar">
            {Object.entries(elementCategories).map(([categoryName, elements]) => (
              <div key={categoryName} className="flex flex-col pb-5">
                <header className="py-5">
                  <Label>{categoryName}</Label>
                </header>
                <div className="grid grid-cols-2 gap-2">
                  {elements.map((el) => (
                    <ElementButton
                      key={el}
                      elementType={el}
                      source="elements"
                      name={getBlockName(el) || el}
                      icon={getBlockIcon(el)}
                      onClick={() => handleAddElement(el)}
                      onDragStart={handleElementDragStart}
                    />
                  ))}
                </div>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="layouts" className="flex flex-col overflow-y-auto flex-1 px-4 pb-4 no-scrollbar">
            {getAllLayoutKeys().length === 0 ? (
              <Empty>
                <EmptyTitle>No layouts available</EmptyTitle>
                <EmptyDescription>Pre-built page layouts will appear here</EmptyDescription>
              </Empty>
            ) : (
              <div className="flex flex-col divide-y pb-5">
                {Object.entries(getLayoutsByCategory()).map(([category, layoutKeys]) => {
                  const isCollapsed = collapsedCategories.has(category);

                  return (
                    <div key={category} className="flex flex-col">
                      <header
                        className="py-5 flex items-center gap-2 cursor-pointer hover:opacity-70 transition-opacity"
                        onClick={() => toggleCategory(category)}
                      >
                        <Icon
                          name="triangle-down"
                          className={cn(
                            'size-3 opacity-25 transition-transform',
                            isCollapsed && '-rotate-90'
                          )}
                        />
                        <Label className="cursor-pointer">{category}</Label>
                      </header>
                      {!isCollapsed && (
                        <div className="grid grid-cols-1 gap-1.5 pb-5">
                      {layoutKeys.map((layoutKey) => {
                        const previewImage = getLayoutPreviewImage(layoutKey);

                        return (
                          <ContextMenu key={layoutKey}>
                            <ContextMenuTrigger asChild>
                              <ElementButton
                                elementType={layoutKey}
                                source="layouts"
                                name={layoutKey}
                                icon="layout"
                                onClick={() => handleAddLayout(layoutKey)}
                                onDragStart={handleElementDragStart}
                                variant="card"
                              >
                                {previewImage && (
                                  <Image
                                    src={previewImage}
                                    width={640}
                                    height={262}
                                    alt="Layout preview"
                                    className="object-contain w-full h-full rounded pointer-events-none"
                                  />
                                )}
                              </ElementButton>
                            </ContextMenuTrigger>

                            <ContextMenuContent>
                              <ContextMenuItem onClick={() => handleAddLayout(layoutKey)}>
                                <Icon name="plus" className="size-3" />
                                Add to Canvas
                              </ContextMenuItem>

                              {process.env.NODE_ENV === 'development' && (
                                <>
                                  <ContextMenuSeparator />
                                  <ContextMenuItem onClick={(e) => handleEditLayout(layoutKey, e)}>
                                    <Icon name="pencil" className="size-3" />
                                    Edit
                                  </ContextMenuItem>
                                  <ContextMenuItem
                                    onClick={(e) => handleDeleteLayout(layoutKey, e)}
                                    className="text-red-500 focus:text-red-500"
                                  >
                                    <Icon name="trash" className="size-3" />
                                    Delete
                                  </ContextMenuItem>
                                </>
                              )}
                            </ContextMenuContent>
                          </ContextMenu>
                        );
                      })}
                    </div>
                      )}
                </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="components" className="flex flex-col overflow-y-auto flex-1 px-4 pb-4 no-scrollbar">
            {components.length === 0 ? (
              <Empty>
                <EmptyTitle>No components yet</EmptyTitle>
                <EmptyDescription>
                  Right-click a layer and select &quot;Create component&quot; to make it reusable
                </EmptyDescription>
              </Empty>
            ) : (
              <div className="flex flex-col pb-5">
                <div className="py-5 h-14 flex items-center gap-2">
                  <div className="relative flex-1">
                    <Icon name="search" className="absolute left-3.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground pointer-events-none" />
                    <Input
                      value={componentSearch}
                      onChange={(e) => setComponentSearch(e.target.value)}
                      placeholder="Search components..."
                      className="h-8 text-xs pl-9"
                    />
                  </div>
                </div>
                <div className="border-b border-border mb-4" />
                {!hasComponentResults && (
                  <Empty>
                    <EmptyMedia variant="icon">
                      <Icon name="component" className="size-4" />
                    </EmptyMedia>
                    <EmptyTitle>No matching components</EmptyTitle>
                  </Empty>
                )}
                <div className={cn('grid grid-cols-1 gap-1.5 pb-5', !hasComponentResults && 'hidden')}>
                  {components.map((component) => {
                    const isHidden = matchingComponentIds && !matchingComponentIds.has(component.id);
                    return (
                      <ComponentCard
                        key={component.id}
                        component={component}
                        className={cn(
                          circularComponentIds.has(component.id) && 'opacity-40',
                          isHidden && 'hidden',
                        )}
                        onClick={() => handleAddComponent(component.id)}
                        onMouseDown={(e) => {
                          if (e.button !== 0) return;
                          const startX = e.clientX;
                          const startY = e.clientY;
                          let dragging = false;

                          const handleMouseMove = (moveEvent: MouseEvent) => {
                            const dx = moveEvent.clientX - startX;
                            const dy = moveEvent.clientY - startY;
                            if (!dragging && Math.sqrt(dx * dx + dy * dy) > 5) {
                              dragging = true;
                              handleElementDragStart(e, component.id, 'components', component.name);
                            }
                          };

                          const handleMouseUp = () => {
                            document.removeEventListener('mousemove', handleMouseMove);
                            document.removeEventListener('mouseup', handleMouseUp);
                            if (!dragging) handleAddComponent(component.id);
                            dragging = false;
                          };

                          document.addEventListener('mousemove', handleMouseMove);
                          document.addEventListener('mouseup', handleMouseUp);
                        }}
                        actions={
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="size-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Icon name="more" className="size-3" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={(e) => handleEditComponent(component, e)}>Edit</DropdownMenuItem>
                              <DropdownMenuItem onClick={(e) => handleDeleteClick(component, e)}>Delete</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        }
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <SaveLayoutDialog
          open={isEditLayoutDialogOpen}
          onOpenChange={setIsEditLayoutDialogOpen}
          onConfirm={handleConfirmEditLayout}
          defaultName={editingLayoutName}
          defaultCategory={editingLayoutCategory}
          mode="edit"
          layoutKey={editingLayoutKey}
        />

        <ConfirmDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          title="Delete component"
          description={deleteConfirmDescription}
          confirmLabel={isDeleting ? 'Deleting...' : 'Delete'}
          confirmVariant="destructive"
          onConfirm={handleConfirmDelete}
          onCancel={() => {
            setComponentToDelete(null);
            setDeletePreviewInfo(null);
          }}
        />
    </div>
  );
}
