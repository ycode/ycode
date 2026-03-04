/**
 * Layer utilities for rendering and manipulation
 */

import { Layer, FieldVariable, CollectionVariable, CollectionItemWithValues, CollectionField, Component, ComponentVariable, Breakpoint, LayerVariables, DesignColorVariable, BoundColorStop } from '@/types';
import { generateId } from '@/lib/utils';
import { iconExists, IconProps } from '@/components/ui/icon';
import { getBlockIcon, getBlockName } from '@/lib/templates/blocks';
import { resolveInlineVariablesFromData } from '@/lib/inline-variables';
import { applyComponentOverrides } from '@/lib/resolve-components';
import { resolveFieldFromSources } from '@/lib/cms-variables-utils';
import { parseMultiReferenceValue } from '@/lib/collection-utils';
import { getInheritedValue } from '@/lib/tailwind-class-mapper';
import { cloneDeep } from 'lodash';
import { layerHasLink, hasLinkInTree, hasRichTextLinks } from '@/lib/link-utils';

// Alias for backwards compatibility within this file
const hasLinkSettings = layerHasLink;

/**
 * Strip UI-only properties from layers before comparison/hashing
 * These properties (like 'open') are used for UI state and shouldn't trigger version changes
 */
export function stripUIProperties(layers: Layer[]): Layer[] {
  return layers.map(layer => {
    const { open, ...layerWithoutUI } = layer;
    if (layer.children && layer.children.length > 0) {
      return {
        ...layerWithoutUI,
        children: stripUIProperties(layer.children)
      };
    }
    return layerWithoutUI;
  });
}

/**
 * Check if a value is a FieldVariable
 */
export function isFieldVariable(value: any): value is FieldVariable {
  return value && typeof value === 'object' && value.type === 'field' && value.data?.field_id;
}

/**
 * Check if a layer can be copied based on its restrictions
 */
export function canCopyLayer(layer: Layer): boolean {
  return layer.restrictions?.copy !== false;
}

/**
 * Check if a layer can be deleted based on its restrictions
 */
export function canDeleteLayer(layer: Layer): boolean {
  return layer.restrictions?.delete !== false;
}

/**
 * Get the ancestor layer matching a callback condition
 * Traverses up the tree from the given layer until a matching ancestor is found
 * Uses a flat map for efficient O(1) parent lookups
 */
export function findAncestor(
  layers: Layer[],
  layerId: string,
  predicate: (layer: Layer) => boolean
): Layer | null {
  // Build flat maps for efficient lookups
  const layerMap = new Map<string, Layer>();
  const parentMap = new Map<string, string>();

  const buildMaps = (nodes: Layer[], parentId: string | null = null) => {
    for (const node of nodes) {
      layerMap.set(node.id, node);
      if (parentId) {
        parentMap.set(node.id, parentId);
      }
      if (node.children) {
        buildMaps(node.children, node.id);
      }
    }
  };

  buildMaps(layers);

  // Check if the layer exists
  const currentLayer = layerMap.get(layerId);
  if (!currentLayer) return null;

  // Traverse up the tree using the parent map
  let parentId = parentMap.get(layerId);
  while (parentId) {
    const parent = layerMap.get(parentId);
    if (parent && predicate(parent)) {
      return parent;
    }
    parentId = parentMap.get(parentId);
  }

  return null;
}

/**
 * Find the ancestor layer with a specific name
 */
export function findAncestorByName(layers: Layer[], layerId: string, ancestorName: string): Layer | null {
  return findAncestor(layers, layerId, (layer) => layer.name === ancestorName);
}

/**
 * Check if a layer can be moved to a new parent based on ancestor restrictions and link nesting
 */
export function canMoveLayer(layers: Layer[], layerId: string, newParentId: string | null): boolean {
  const layer = findLayerById(layers, layerId);
  if (!layer) return false;

  // Check link nesting restrictions (can't have <a> inside <a>)
  if (newParentId !== null) {
    const newParent = findLayerById(layers, newParentId);
    if (newParent && !canAddChild(newParent, layer)) {
      return false;
    }

    // Also check if any ancestor of the new parent has link settings
    const hasLinkAncestor = findAncestor(layers, newParentId, (ancestor) => layerHasLink(ancestor));
    if (hasLinkAncestor && hasLinkInTree(layer)) {
      return false;
    }
  }

  // No ancestor restriction - can move anywhere (as long as link nesting is valid)
  if (!layer.restrictions?.ancestor) return true;

  const requiredAncestor = layer.restrictions.ancestor;

  // Find current ancestor with the required name
  const currentAncestor = findAncestorByName(layers, layerId, requiredAncestor);

  // If moving to root (newParentId is null), check if we need an ancestor
  if (newParentId === null) {
    // Can only move to root if no ancestor is required
    return !currentAncestor;
  }

  // Find the ancestor in the new location
  const newParent = findLayerById(layers, newParentId);
  if (!newParent) return false;

  // Check if new parent is the required ancestor
  if (newParent.name === requiredAncestor) {
    return true;
  }

  // Check if new parent is a descendant of the required ancestor
  const newParentAncestor = findAncestorByName(layers, newParentId, requiredAncestor);

  // Can move if both current and new location share the same ancestor
  return currentAncestor?.id === newParentAncestor?.id;
}

/**
 * Get collection variable from layer (checks variables first, then fallback)
 */
export function getCollectionVariable(layer: Layer): CollectionVariable | null {
  return layer.variables?.collection ?? null;
}

/** Input-type layer names that can be linked to filter conditions */
const FILTER_INPUT_TYPES = ['input', 'select', 'textarea', 'checkbox', 'radio'];

/**
 * Check if a layer is an input-type element that is a descendant of a 'filter' layer.
 * Used to validate element picker targets for collection filter linking.
 */
export function isInputInsideFilter(layerId: string, layers: Layer[]): boolean {
  const findWithAncestors = (
    searchLayers: Layer[],
    ancestors: Layer[]
  ): boolean => {
    for (const layer of searchLayers) {
      if (layer.id === layerId) {
        if (!FILTER_INPUT_TYPES.includes(layer.name)) return false;
        return ancestors.some(a => a.name === 'filter');
      }
      if (layer.children) {
        if (findWithAncestors(layer.children, [...ancestors, layer])) {
          return true;
        }
      }
    }
    return false;
  };
  return findWithAncestors(layers, []);
}

/**
 * Get all input-type layers inside 'filter' layers from a layer tree.
 * Returns array of { layerId, layerName, filterLayerId } for use in pickers/dropdowns.
 */
export function getFilterInputLayers(layers: Layer[]): Array<{ layerId: string; layerName: string; customName?: string; filterLayerId: string }> {
  const results: Array<{ layerId: string; layerName: string; customName?: string; filterLayerId: string }> = [];

  const walk = (searchLayers: Layer[], filterLayerId: string | null) => {
    for (const layer of searchLayers) {
      const currentFilterId = layer.name === 'filter' ? layer.id : filterLayerId;
      if (currentFilterId && FILTER_INPUT_TYPES.includes(layer.name)) {
        results.push({
          layerId: layer.id,
          layerName: layer.name,
          customName: layer.customName,
          filterLayerId: currentFilterId,
        });
      }
      if (layer.children) {
        walk(layer.children, currentFilterId);
      }
    }
  };
  walk(layers, null);
  return results;
}

/**
 * Find a layer by ID in a tree structure
 * Recursively searches through layer tree
 */
export function findLayerById(layers: Layer[], id: string): Layer | null {
  for (const layer of layers) {
    if (layer.id === id) return layer;
    if (layer.children) {
      const found = findLayerById(layer.children, id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Collect all element IDs from a layer tree (both settings.id and attributes.id)
 * Used for generating unique IDs for new elements
 */
export function collectAllSettingsIds(layers: Layer[]): Set<string> {
  const ids = new Set<string>();

  const traverse = (layerList: Layer[]) => {
    for (const layer of layerList) {
      if (layer.settings?.id) {
        ids.add(layer.settings.id);
      }
      // Also collect attributes.id for backward compatibility
      if (layer.attributes?.id) {
        ids.add(layer.attributes.id);
      }
      if (layer.children) {
        traverse(layer.children);
      }
    }
  };

  traverse(layers);
  return ids;
}

/**
 * Generate a unique settings ID based on a base ID
 * If "contact-form" exists, returns "contact-form-2", then "contact-form-3", etc.
 */
export function generateUniqueSettingsId(baseId: string, existingIds: Set<string>): string {
  if (!existingIds.has(baseId)) {
    return baseId;
  }

  let counter = 2;
  while (existingIds.has(`${baseId}-${counter}`)) {
    counter++;
  }

  return `${baseId}-${counter}`;
}

/**
 * Helper to find a layer and its parent
 * @param layers - Root layers array
 * @param targetId - ID of the layer to find
 * @param parent - Current parent (for recursion)
 * @returns Object with layer and its parent, or null if not found
 */
export function findLayerWithParent(layers: Layer[], targetId: string, parent: Layer | null = null): { layer: Layer; parent: Layer | null } | null {
  for (const layer of layers) {
    if (layer.id === targetId) {
      return { layer, parent };
    }
    if (layer.children) {
      const found = findLayerWithParent(layer.children, targetId, layer);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Find parent collection layer by traversing up the tree
 * @param layers - Root layers array
 * @param layerId - ID of the layer to start from
 * @returns The nearest parent layer that is a collection layer, or null
 */
export function findParentCollectionLayer(layers: Layer[], layerId: string): Layer | null {
  // Helper to find a layer and its parent chain
  const findLayerWithParents = (layers: Layer[], targetId: string, parent: Layer | null = null): { layer: Layer; parent: Layer | null } | null => {
    for (const layer of layers) {
      if (layer.id === targetId) {
        return { layer, parent };
      }
      if (layer.children) {
        const found = findLayerWithParents(layer.children, targetId, layer);
        if (found) return found;
      }
    }
    return null;
  };

  // Find the target layer and its parent
  const result = findLayerWithParents(layers, layerId);
  if (!result) return null;

  // Traverse up the parent chain looking for a collection layer
  let current = result.parent;
  while (current) {
    // Check if this layer has a collection binding
    const hasCollectionVariable = !!getCollectionVariable(current);

    if (hasCollectionVariable) {
      return current;
    }

    // Move up to the next parent
    const parentResult = findLayerWithParents(layers, current.id);
    current = parentResult ? parentResult.parent : null;
  }

  return null;
}

/**
 * Find all parent collection layers by traversing up the tree
 * @param layers - Root layers array
 * @param layerId - ID of the layer to start from
 * @returns Array of parent collection layers, ordered from nearest to farthest
 */
export function findAllParentCollectionLayers(layers: Layer[], layerId: string): Layer[] {
  const result: Layer[] = [];

  // Helper to find a layer and its parent chain
  const findLayerWithParents = (layers: Layer[], targetId: string, parent: Layer | null = null): { layer: Layer; parent: Layer | null } | null => {
    for (const layer of layers) {
      if (layer.id === targetId) {
        return { layer, parent };
      }
      if (layer.children) {
        const found = findLayerWithParents(layer.children, targetId, layer);
        if (found) return found;
      }
    }
    return null;
  };

  // Find the target layer and its parent
  const layerResult = findLayerWithParents(layers, layerId);
  if (!layerResult) return result;

  // Traverse up the parent chain collecting all collection layers
  let current = layerResult.parent;
  while (current) {
    // Check if this layer has a collection binding
    const hasCollectionVariable = !!getCollectionVariable(current);

    if (hasCollectionVariable) {
      result.push(current);
    }

    // Move up to the next parent
    const parentResult = findLayerWithParents(layers, current.id);
    current = parentResult ? parentResult.parent : null;
  }

  return result;
}

/**
 * Check if a layer can have editable text content
 * @param layer - Layer to check
 * @returns True if the layer is text-editable
 */
export function isTextEditable(layer: Layer): boolean {
  return layer.restrictions?.editText ?? false;
}

/**
 * Get the HTML tag name for a layer
 */
export function getHtmlTag(layer: Layer): string {
  // Priority 1: Check settings.tag override
  if (layer.settings?.tag) {
    return layer.settings.tag;
  }

  // Priority 2: Use name property (new system)
  if (layer.name) {
    return layer.name;
  }

  // Default
  return 'div';
}

/**
 * Get classes as string (support both string and array formats)
 * Does NOT use cn()/twMerge because our own setBreakpointClass already
 * handles property-aware conflict resolution. twMerge incorrectly removes
 * leading-* classes when text-[...] is present (it treats font-size as
 * overriding line-height, which is wrong for arbitrary values).
 */
export function getClassesString(layer: Layer): string {
  if (Array.isArray(layer.classes)) {
    return layer.classes.join(' ');
  }
  return layer.classes || '';
}

/**
 * Get text content from layer (from variables.text)
 */
export function getText(layer: Layer): string | undefined {
  const textVariable = layer.variables?.text;
  if (textVariable && textVariable.type === 'dynamic_text') {
    return textVariable.data.content;
  }
  return undefined;
}

/**
 * Check if a layer can have a link added
 * @param layer - The layer to check
 * @param allLayers - All layers in the current context (page or component)
 * @param type - Type of link to add: 'layer' (layer-level link) or 'richText' (rich text links)
 * @returns Object with canHaveLinks boolean and optional issue details
 */
export function canLayerHaveLink(
  layer: Layer,
  allLayers: Layer[],
  type: 'layer' | 'richText' = 'layer'
): { canHaveLinks: boolean; issue?: { type: 'self' | 'ancestor' | 'child' | 'richText'; layerName?: string } } {
  if (type === 'layer') {
    // Checking if a layer-level link can be added
    // Can't add layer link if the layer has rich text links
    if (hasRichTextLinks(layer)) {
      return {
        canHaveLinks: false,
        issue: { type: 'richText' }
      };
    }

    // Can't add layer link if any ancestor has link settings
    const hasAncestorWithLink = findAncestor(
      allLayers,
      layer.id,
      (ancestor) => hasLinkSettings(ancestor)
    );

    if (hasAncestorWithLink) {
      return {
        canHaveLinks: false,
        issue: { type: 'ancestor', layerName: getLayerName(hasAncestorWithLink) }
      };
    }

    // Can't add layer link if any child has link settings or rich text links
    if (layer.children && layer.children.length > 0) {
      const hasChildWithLink = layer.children.some(child => hasLinkInTree(child));
      if (hasChildWithLink) {
        return {
          canHaveLinks: false,
          issue: { type: 'child' }
        };
      }
    }

    return { canHaveLinks: true };
  }

  // Checking if rich text links can be added
  // Can't add rich text links if the layer itself is a link
  if (hasLinkSettings(layer)) {
    return {
      canHaveLinks: false,
      issue: { type: 'self', layerName: getLayerName(layer) }
    };
  }

  // Can't add rich text links if any ancestor has link settings
  const hasAncestorWithLink = findAncestor(
    allLayers,
    layer.id,
    (ancestor) => hasLinkSettings(ancestor)
  );

  if (hasAncestorWithLink) {
    return {
      canHaveLinks: false,
      issue: { type: 'ancestor', layerName: getLayerName(hasAncestorWithLink) }
    };
  }

  // Can't add rich text links if any child has link settings or rich text links
  if (layer.children && layer.children.length > 0) {
    const hasChildWithLink = layer.children.some(child => hasLinkInTree(child));
    if (hasChildWithLink) {
      return {
        canHaveLinks: false,
        issue: { type: 'child' }
      };
    }
  }

  return { canHaveLinks: true };
}

/**
 * Check if a layer can have a specific child layer
 * @param parent - The parent layer
 * @param child - The child layer to check
 * @returns true if the child can be added to the parent
 */
export function canAddChild(parent: Layer, child: Layer): boolean {
  // Links cannot be nested (can't have <a> inside <a>)
  if (layerHasLink(parent) && hasLinkInTree(child)) {
    return false;
  }

  if (layerHasLink(child) && layerHasLink(parent)) {
    return false;
  }

  return true;
}

/**
 * Check if a layer can have children based on its name/type
 */
export function canHaveChildren(layer: Layer, childLayerType?: string): boolean {
  // Component instances cannot have children added to them
  // Children can only be edited in the master component
  if (layer.componentId) {
    return false;
  }

  const blocksWithoutChildren = [
    'icon', 'image', 'audio', 'video', 'iframe',
    'text', 'span', 'label', 'hr',
    'input', 'textarea', 'select', 'checkbox', 'radio',
    'htmlEmbed', 'richText',
  ];

  // Sections cannot contain other sections
  if (layer.name === 'section' && childLayerType === 'section') {
    return false;
  }

  return !blocksWithoutChildren.includes(layer.name ?? '');
}

/**
 * Remove a layer by ID from a tree structure
 * Returns a new array with the layer removed
 */
export function removeLayerById(layers: Layer[], id: string): Layer[] {
  return layers
    .filter(layer => layer.id !== id)
    .map(layer => {
      if (layer.children) {
        return {
          ...layer,
          children: removeLayerById(layer.children, id)
        };
      }
      return layer;
    });
}

/**
 * Reorder siblings within the same parent.
 * Moves a layer to be above or below a target sibling.
 *
 * @param layers - The full layer tree
 * @param movedLayerId - ID of the layer being moved
 * @param targetSiblingId - ID of the sibling to drop relative to
 * @param position - Whether to place above or below the target
 * @returns Updated layer tree with reordered children, or original if move fails
 */
export function reorderSiblings(
  layers: Layer[],
  movedLayerId: string,
  targetSiblingId: string,
  position: 'above' | 'below'
): Layer[] {
  // Don't move if same layer
  if (movedLayerId === targetSiblingId) {
    return layers;
  }

  // Find the parent containing both layers
  const findParentWithChild = (
    layerList: Layer[],
    childId: string,
    parent: Layer | null = null
  ): { parent: Layer | null; index: number } | null => {
    for (let i = 0; i < layerList.length; i++) {
      if (layerList[i].id === childId) {
        return { parent, index: i };
      }
      if (layerList[i].children) {
        const found = findParentWithChild(layerList[i].children!, childId, layerList[i]);
        if (found) return found;
      }
    }
    return null;
  };

  const movedInfo = findParentWithChild(layers, movedLayerId);
  const targetInfo = findParentWithChild(layers, targetSiblingId);

  // Both must exist and have the same parent
  if (!movedInfo || !targetInfo) {
    console.warn('[reorderSiblings] Could not find one or both layers');
    return layers;
  }

  const movedParentId = movedInfo.parent?.id ?? null;
  const targetParentId = targetInfo.parent?.id ?? null;

  if (movedParentId !== targetParentId) {
    console.warn('[reorderSiblings] Layers have different parents - cannot reorder');
    return layers;
  }

  // Deep clone the tree to avoid mutations
  const cloneLayer = (layer: Layer): Layer => ({
    ...layer,
    children: layer.children ? layer.children.map(cloneLayer) : undefined,
  });
  const newLayers = layers.map(cloneLayer);

  // Find the parent in the cloned tree
  const parentLayer = movedParentId
    ? findLayerById(newLayers, movedParentId)
    : null;

  const childrenArray = parentLayer ? parentLayer.children : newLayers;

  if (!childrenArray) {
    console.warn('[reorderSiblings] Parent has no children array');
    return layers;
  }

  // Find current indices
  const movedIndex = childrenArray.findIndex(l => l.id === movedLayerId);
  const targetIndex = childrenArray.findIndex(l => l.id === targetSiblingId);

  if (movedIndex === -1 || targetIndex === -1) {
    console.warn('[reorderSiblings] Could not find indices in children array');
    return layers;
  }

  // Remove the moved layer
  const [movedLayer] = childrenArray.splice(movedIndex, 1);

  // Calculate new index (account for the removal)
  let newIndex = targetIndex;
  if (movedIndex < targetIndex) {
    // Moving down - target index shifted by -1 due to removal
    newIndex = position === 'above' ? targetIndex - 1 : targetIndex;
  } else {
    // Moving up - target index unchanged
    newIndex = position === 'above' ? targetIndex : targetIndex + 1;
  }

  // Ensure newIndex is valid
  newIndex = Math.max(0, Math.min(newIndex, childrenArray.length));

  // Insert at new position
  childrenArray.splice(newIndex, 0, movedLayer);

  return newLayers;
}

/**
 * Get all sibling layer IDs for a given layer.
 *
 * @param layers - The full layer tree
 * @param layerId - ID of the layer to find siblings for
 * @returns Array of sibling layer IDs (excluding the layer itself)
 */
export function getSiblingIds(layers: Layer[], layerId: string): string[] {
  const findSiblings = (
    layerList: Layer[],
    targetId: string,
    parent: Layer | null = null
  ): string[] | null => {
    for (const layer of layerList) {
      if (layer.id === targetId) {
        // Found it - return sibling IDs from the same level
        const siblings = parent?.children ?? layerList;
        return siblings.filter(l => l.id !== targetId).map(l => l.id);
      }
      if (layer.children) {
        const found = findSiblings(layer.children, targetId, layer);
        if (found) return found;
      }
    }
    return null;
  };

  return findSiblings(layers, layerId) ?? [];
}

/**
 * Resolve field variable value from collection item data
 * Uses variables structure for collection binding
 * @param fieldVariable - FieldVariable with field_id, source, and optional collection_layer_id
 * @param collectionItemData - Merged collection layer data (field_id → value)
 * @param pageCollectionItemData - Page collection data for dynamic pages
 * @param layerDataMap - Optional map of layer ID → item data (for layer-specific resolution)
 * @returns The resolved value or undefined if not found
 */
export function resolveFieldValue(
  fieldVariable: FieldVariable,
  collectionItemData?: Record<string, string>,
  pageCollectionItemData?: Record<string, string> | null,
  layerDataMap?: Record<string, Record<string, string>>
): string | undefined {
  const { field_id, source, collection_layer_id, relationships = [] } = fieldVariable.data;
  if (!field_id) {
    return undefined;
  }

  // Build full field path for nested references
  const fieldPath = relationships.length > 0
    ? [field_id, ...relationships].join('.')
    : field_id;

  // Use source-aware resolution with layer-specific support
  return resolveFieldFromSources(
    fieldPath,
    source,
    collectionItemData,
    pageCollectionItemData,
    collection_layer_id,
    layerDataMap
  );
}

/**
 * Get text content with field binding resolution
 * Uses variables.text (DynamicTextVariable) with inline variables
 */
export function getTextWithBinding(
  layer: Layer,
  collectionItemData?: Record<string, string>,
  timezone: string = 'UTC'
): string | undefined {
  // Check variables.text (DynamicTextVariable with inline variables)
  const textVariable = layer.variables?.text;
  if (textVariable && textVariable.type === 'dynamic_text') {
    const content = textVariable.data.content;
    if (content.includes('<ycode-inline-variable>')) {
      // Resolve inline variables with timezone-aware date formatting
      return resolveInlineVariablesFromData(content, collectionItemData, null, timezone);
    }
    return content;
  }

  return undefined;
}

/**
 * Sort collection items based on layer sorting settings
 * @param items - Array of collection items to sort
 * @param collectionVariable - Collection variable containing sorting preferences
 * @param fields - Array of collection fields for field-based sorting
 * @returns Sorted array of collection items
 */
export function sortCollectionItems(
  items: CollectionItemWithValues[],
  collectionVariable: CollectionVariable | null,
  fields: CollectionField[]
): CollectionItemWithValues[] {
  // If no collection variable or no items, return as-is
  if (!collectionVariable || items.length === 0) {
    return items;
  }

  const sortBy = collectionVariable.sort_by;
  const sortOrder = collectionVariable.sort_order || 'asc';

  // Create a copy to avoid mutating the original array
  const sortedItems = [...items];

  // No sorting - return database order (as-is)
  if (!sortBy || sortBy === 'none') {
    return sortedItems;
  }

  // Manual sorting - sort by manual_order field
  if (sortBy === 'manual') {
    return sortedItems.sort((a, b) => a.manual_order - b.manual_order);
  }

  // Random sorting - shuffle the array
  if (sortBy === 'random') {
    for (let i = sortedItems.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [sortedItems[i], sortedItems[j]] = [sortedItems[j], sortedItems[i]];
    }
    return sortedItems;
  }

  // Field-based sorting - sortBy is a field ID
  return sortedItems.sort((a, b) => {
    const aValue = a.values[sortBy] || '';
    const bValue = b.values[sortBy] || '';

    // Try to parse as numbers if possible
    const aNum = parseFloat(String(aValue));
    const bNum = parseFloat(String(bValue));

    if (!isNaN(aNum) && !isNaN(bNum)) {
      // Numeric comparison
      return sortOrder === 'asc' ? aNum - bNum : bNum - aNum;
    }

    // String comparison
    const comparison = String(aValue).localeCompare(String(bValue));
    return sortOrder === 'asc' ? comparison : -comparison;
  });
}

/**
 * Layout type derived from layer's design properties
 */
export type LayoutType = 'columns' | 'rows' | 'grid' | 'hidden' | null;

/**
 * Get the layout type for a layer at a specific breakpoint
 * Takes into account CSS inheritance (desktop → tablet → mobile)
 *
 * @param layer - The layer to check
 * @param breakpoint - The breakpoint to check (default: 'desktop')
 * @returns The layout type ('columns', 'rows', 'grid', 'hidden') or null if not a layout layer
 */
export function getLayoutTypeForBreakpoint(
  layer: Layer,
  breakpoint: Breakpoint = 'desktop'
): LayoutType {
  const classes = Array.isArray(layer.classes)
    ? layer.classes
    : (layer.classes || '').split(' ').filter(Boolean);

  if (classes.length === 0) {
    // Fallback to design object if no classes
    const design = layer.design?.layout;
    if (!design?.isActive) return null;

    const display = design.display;
    const flexDirection = design.flexDirection;

    if (display === 'hidden') return 'hidden';
    if (display === 'grid' || display === 'Grid') return 'grid';
    if (display === 'flex' || display === 'Flex') {
      if (flexDirection === 'column' || flexDirection === 'column-reverse') {
        return 'rows';
      }
      return 'columns';
    }
    return null;
  }

  // Use inheritance to get the display value for the breakpoint
  const { value: displayClass } = getInheritedValue(classes, 'display', breakpoint);
  const { value: flexDirectionClass } = getInheritedValue(classes, 'flexDirection', breakpoint);

  // getInheritedValue returns full class names like 'flex-col', 'flex-row', 'grid', 'flex'
  const display = displayClass || '';
  const flexDirection = flexDirectionClass || '';

  if (display === 'hidden') return 'hidden';
  if (display === 'grid') return 'grid';
  if (display === 'flex' || display === 'inline-flex') {
    // Check for column direction
    // Tailwind classes: 'flex-col', 'flex-col-reverse'
    if (flexDirection === 'flex-col' || flexDirection === 'flex-col-reverse') {
      return 'rows';
    }
    // Default flex is row direction (flex-row, flex-row-reverse, or no direction class)
    return 'columns';
  }

  return null;
}

/**
 * Get the display name for a layout type
 */
export function getLayoutTypeName(layoutType: LayoutType): string | null {
  switch (layoutType) {
    case 'columns': return 'Columns';
    case 'rows': return 'Rows';
    case 'grid': return 'Grid';
    case 'hidden': return 'Hidden';
    default: return null;
  }
}

// Layout custom names that should use breakpoint-aware icons/names
const LAYOUT_CUSTOM_NAMES = ['Columns', 'Rows', 'Grid'];

/**
 * Get the icon name (for `components/ui/Icon.tsx`) for a layer
 *
 * @param layer - The layer to get the icon for
 * @param defaultIcon - Fallback icon (default: 'box')
 * @param breakpoint - Optional breakpoint for layout-aware icons
 */
export function getLayerIcon(
  layer: Layer,
  defaultIcon: IconProps['name'] = 'box',
  breakpoint?: Breakpoint
): IconProps['name'] {
  // Body layers
  if (layer.id === 'body') return 'layout';

  // Component layers
  if (layer.componentId) return 'component';

  // Collection layers
  if (getCollectionVariable(layer)) {
    return 'database';
  }

  // Text layers
  if (layer.name === 'text') {
    return ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(layer.settings?.tag || '') ? 'heading' : 'text';
  }

  // Layout layers (Columns, Rows, Grid) - breakpoint-aware icons
  if (layer.customName && LAYOUT_CUSTOM_NAMES.includes(layer.customName)) {
    if (breakpoint) {
      const layoutType = getLayoutTypeForBreakpoint(layer, breakpoint);
      if (layoutType === 'columns') return 'columns';
      if (layoutType === 'rows') return 'rows';
      if (layoutType === 'grid') return 'grid';
      if (layoutType === 'hidden') return 'eye-off';
    }
    // Fallback to custom name when no breakpoint
    if (layer.customName === 'Columns') return 'columns';
    if (layer.customName === 'Rows') return 'rows';
    if (layer.customName === 'Grid') return 'grid';
  }

  // Other named layers
  if (layer.customName === 'Container') return 'container';

  // Input elements - use type-specific icons for checkbox and radio
  if (layer.name === 'input' && layer.attributes?.type) {
    if (layer.attributes.type === 'checkbox') return 'checkbox';
    if (layer.attributes.type === 'radio') return 'radio';
  }

  // Fallback to block icon (based on name)
  return getBlockIcon(layer.name, defaultIcon);
}

/**
 * Get the label for a layer (for display in the UI)
 *
 * @param layer - The layer to get the name for
 * @param context - Optional context (component_name, collection_name, source_field_name)
 * @param breakpoint - Optional breakpoint for layout-aware names
 */
export function getLayerName(
  layer: Layer,
  context?: {
    component_name?: string | undefined | null;
    collection_name?: string | undefined | null;
    /** When collection is bound to a field (reference/multi-reference/multi-asset), the field name */
    source_field_name?: string | undefined | null;
  },
  breakpoint?: Breakpoint
): string {
  // Special case for Body layer
  if (layer.id === 'body') {
    return 'Body';
  }

  // Use component name if this is a component instance
  if (layer.componentId) {
    return context?.component_name || 'Component';
  }

  // Use field name or collection name in parentheses after "Collection"
  if (getCollectionVariable(layer)) {
    const label = context?.source_field_name ?? context?.collection_name;
    return label ? `Collection (${label})` : 'Collection';
  }

  // Layout layers (Columns, Rows, Grid) - breakpoint-aware names
  if (breakpoint && layer.customName && LAYOUT_CUSTOM_NAMES.includes(layer.customName)) {
    const layoutType = getLayoutTypeForBreakpoint(layer, breakpoint);
    const layoutName = getLayoutTypeName(layoutType);
    if (layoutName) {
      return layoutName;
    }
  }

  // Use custom name if available
  if (layer.customName) {
    return layer.customName;
  }

  // Input elements - use type-specific names for checkbox and radio
  if (layer.name === 'input' && layer.attributes?.type) {
    if (layer.attributes.type === 'checkbox') return 'Checkbox';
    if (layer.attributes.type === 'radio') return 'Radio';
  }

  return getBlockName(layer.name) || 'Layer';
}

/**
 * Get the HTML tag name for a layer
 */
export function getLayerHtmlTag(layer: Layer): string {
  // Body layer should render as div (actual <body> is managed by Next.js)
  if (layer.id === 'body' || layer.name === 'body') {
    return 'div';
  }

  if (layer.settings?.tag) {
    return layer.settings.tag;
  }

  return layer.name || 'div';
}

/**
 * Apply limit and offset to collection items (after sorting)
 * @param items - Array of collection items
 * @param limit - Maximum number of items to show
 * @param offset - Number of items to skip
 * @returns Filtered array of collection items
 */
export function applyLimitOffset(
  items: CollectionItemWithValues[],
  limit?: number,
  offset?: number
): CollectionItemWithValues[] {
  let result = [...items];

  // Apply offset first (skip items)
  if (offset && offset > 0) {
    result = result.slice(offset);
  }

  // Apply limit (take first N items)
  if (limit && limit > 0) {
    result = result.slice(0, limit);
  }

  return result;
}

/**
 * Check if layer has only a single inline variable (and optional whitespace)
 * Used to determine if double-click should open collection item editor
 * @param layer - Layer to check
 * @returns True if layer has exactly one inline variable and no other text
 */
export function hasSingleInlineVariable(layer: Layer): boolean {
  const textVariable = layer.variables?.text;

  if (!textVariable || textVariable.type !== 'dynamic_text') {
    return false;
  }

  const content = textVariable.data.content;

  // Match all inline variable tags
  const regex = /<ycode-inline-variable>[\s\S]*?<\/ycode-inline-variable>/g;
  const matches = content.match(regex);

  if (!matches || matches.length !== 1) {
    return false; // Not exactly one variable
  }

  // Remove the variable tag and check if only whitespace remains
  const withoutVariable = content.replace(regex, '').trim();
  return withoutVariable === '';
}

/**
 * Regenerate interaction and tween IDs, and optionally remap layer_id references
 * @param interactions - Array of interactions to process
 * @param layerIdMap - Optional map of old layer IDs to new layer IDs for remapping
 * @returns New array of interactions with regenerated IDs
 */
export function regenerateInteractionIds(
  interactions: Layer['interactions'],
  layerIdMap?: Map<string, string>
): Layer['interactions'] {
  if (!interactions || interactions.length === 0) return interactions;

  return interactions.map(interaction => ({
    ...interaction,
    id: generateId('int'), // Regenerate interaction ID
    tweens: interaction.tweens.map(tween => ({
      ...tween,
      id: generateId('twn'), // Regenerate tween ID
      layer_id: layerIdMap?.has(tween.layer_id)
        ? layerIdMap.get(tween.layer_id)!
        : tween.layer_id, // Keep external layer references unchanged
    })),
  }));
}

/**
 * Regenerate layer IDs, interaction IDs, tween IDs, and remap self-targeted interactions
 * When duplicating/pasting layers, all IDs must be regenerated to avoid conflicts
 */
export function regenerateIdsWithInteractionRemapping(layer: Layer): Layer {
  // Track old layer ID -> new layer ID mapping
  const idMap = new Map<string, string>();

  // First pass: generate new layer IDs and build mapping
  const generateNewIds = (l: Layer): Layer => {
    const newId = generateId('lyr');
    idMap.set(l.id, newId);

    return {
      ...l,
      id: newId,
      children: l.children?.map(generateNewIds),
    };
  };

  const layerWithNewIds = generateNewIds(layer);

  // Second pass: regenerate interaction/tween IDs and remap layer_id references
  const remapInteractions = (l: Layer): Layer => {
    let updatedLayer = l;

    // If layer has interactions, regenerate IDs and remap tween layer_ids
    if (l.interactions && l.interactions.length > 0) {
      updatedLayer = {
        ...updatedLayer,
        interactions: regenerateInteractionIds(l.interactions, idMap),
      };
    }

    // Recursively process children
    if (updatedLayer.children) {
      updatedLayer = {
        ...updatedLayer,
        children: updatedLayer.children.map(remapInteractions),
      };
    }

    return updatedLayer;
  };

  return remapInteractions(layerWithNewIds);
}

/**
 * Collection layer info for conditional visibility
 */
export interface CollectionLayerInfo {
  layerId: string;
  layerName: string;
  collectionId: string;
}

/**
 * Find all collection layers in a layer tree
 * Used for page collections dropdown in conditional visibility
 * Only finds top-level collection layers (direct layers bound to CMS collections),
 * not nested ones or reference field collections.
 * @param layers - Root layers array
 * @param topLevelOnly - If true, only returns the first collection layer found in each branch
 * @returns Array of collection layer info
 */
export function findAllCollectionLayers(layers: Layer[], topLevelOnly: boolean = true): CollectionLayerInfo[] {
  const result: CollectionLayerInfo[] = [];

  const traverse = (layerList: Layer[], foundCollectionInBranch: boolean = false) => {
    for (const layer of layerList) {
      const collectionVariable = getCollectionVariable(layer);

      // If this layer is a collection layer
      if (collectionVariable) {
        // Only add if we haven't found a collection parent in this branch (for topLevelOnly mode)
        if (!topLevelOnly || !foundCollectionInBranch) {
          // Use customName if set, otherwise fallback to 'Collection'
          // Don't use layer.name as it's just the element type (e.g., 'div', 'section')
          result.push({
            layerId: layer.id,
            layerName: layer.customName || 'Collection',
            collectionId: collectionVariable.id,
          });
        }
        // Continue traversing children, but mark that we've found a collection in this branch
        if (layer.children) {
          traverse(layer.children, true);
        }
      } else {
        // Not a collection layer, continue traversing
        if (layer.children) {
          traverse(layer.children, foundCollectionInBranch);
        }
      }
    }
  };

  traverse(layers);
  return result;
}

/**
 * Context for evaluating visibility conditions
 */
export interface VisibilityContext {
  /** Field values from collection layer item (field_id -> value) */
  collectionLayerData?: Record<string, string>;
  /** Field values from page collection (for dynamic pages) */
  pageCollectionData?: Record<string, string> | null;
  /** Item counts for each collection layer on the page (layerId -> count) */
  pageCollectionCounts?: Record<string, number>;
  /** Field definitions for type-aware comparison */
  collectionFields?: CollectionField[];
}

/**
 * Evaluate a single visibility condition
 * @param condition - The condition to evaluate
 * @param context - The context containing field values and collection counts
 * @returns True if condition is met, false otherwise
 */
function evaluateCondition(
  condition: import('@/types').VisibilityCondition,
  context: VisibilityContext
): boolean {
  const { collectionLayerData, pageCollectionData, pageCollectionCounts } = context;

  if (condition.source === 'page_collection') {
    // Page collection conditions
    const count = pageCollectionCounts?.[condition.collectionLayerId || ''] ?? 0;

    switch (condition.operator) {
      case 'has_items':
        return count > 0;
      case 'has_no_items':
        return count === 0;
      case 'item_count': {
        const compareValue = condition.compareValue ?? 0;
        const compareOp = condition.compareOperator ?? 'eq';
        switch (compareOp) {
          case 'eq': return count === compareValue;
          case 'lt': return count < compareValue;
          case 'lte': return count <= compareValue;
          case 'gt': return count > compareValue;
          case 'gte': return count >= compareValue;
          default: return count === compareValue;
        }
      }
      default:
        return true;
    }
  }

  // Collection field conditions - use source-aware resolution
  if (condition.source === 'collection_field') {
    const fieldId = condition.fieldId;
    if (!fieldId) return true;

    // Use source-aware resolution (collection layer data first, then page data)
    const rawValue = resolveFieldFromSources(fieldId, undefined, collectionLayerData, pageCollectionData);
    const value = String(rawValue ?? '');
    const compareValue = String(condition.value ?? '');
    const fieldType = condition.fieldType || 'text';

    // Check if value is present (non-empty)
    const isPresent = rawValue !== undefined && rawValue !== null && rawValue !== '';

    switch (condition.operator) {
      // Text operators
      case 'is':
        if (fieldType === 'boolean') {
          return value.toLowerCase() === compareValue.toLowerCase();
        }
        if (fieldType === 'number') {
          return parseFloat(value) === parseFloat(compareValue);
        }
        return value === compareValue;

      case 'is_not':
        if (fieldType === 'number') {
          return parseFloat(value) !== parseFloat(compareValue);
        }
        return value !== compareValue;

      case 'contains':
        return value.toLowerCase().includes(compareValue.toLowerCase());

      case 'does_not_contain':
        return !value.toLowerCase().includes(compareValue.toLowerCase());

      case 'is_present':
        return isPresent;

      case 'is_empty':
        return !isPresent;

      // Number operators
      case 'lt':
        return parseFloat(value) < parseFloat(compareValue);

      case 'lte':
        return parseFloat(value) <= parseFloat(compareValue);

      case 'gt':
        return parseFloat(value) > parseFloat(compareValue);

      case 'gte':
        return parseFloat(value) >= parseFloat(compareValue);

      // Date operators
      case 'is_before': {
        const dateValue = new Date(value);
        const compareDateValue = new Date(compareValue);
        return dateValue < compareDateValue;
      }

      case 'is_after': {
        const dateValue = new Date(value);
        const compareDateValue = new Date(compareValue);
        return dateValue > compareDateValue;
      }

      case 'is_between': {
        const dateValue = new Date(value);
        const startDate = new Date(compareValue);
        const endDate = new Date(condition.value2 ?? '');
        return dateValue >= startDate && dateValue <= endDate;
      }

      case 'is_not_empty':
        return isPresent;

      // Reference operators
      case 'is_one_of': {
        try {
          const allowedIds = JSON.parse(compareValue || '[]');
          if (!Array.isArray(allowedIds)) return false;
          // For multi-reference, value might be an array or JSON string
          const valueIds = parseMultiReferenceValue(value);
          if (valueIds.length > 0) {
            return valueIds.some((id: string) => allowedIds.includes(id));
          }
          return allowedIds.includes(value);
        } catch {
          return false;
        }
      }

      case 'is_not_one_of': {
        try {
          const excludedIds = JSON.parse(compareValue || '[]');
          if (!Array.isArray(excludedIds)) return true;
          // For multi-reference, value might be an array or JSON string
          const valueIds = parseMultiReferenceValue(value);
          if (valueIds.length > 0) {
            return !valueIds.some((id: string) => excludedIds.includes(id));
          }
          return !excludedIds.includes(value);
        } catch {
          return true;
        }
      }

      case 'exists':
        return isPresent;

      case 'does_not_exist':
        return !isPresent;

      // Multi-reference operators
      case 'contains_all_of': {
        try {
          const requiredIds = JSON.parse(compareValue || '[]');
          if (!Array.isArray(requiredIds)) return false;
          const valueIds = parseMultiReferenceValue(value);
          return requiredIds.every((id: string) => valueIds.includes(id));
        } catch {
          return false;
        }
      }

      case 'contains_exactly': {
        try {
          const requiredIds = JSON.parse(compareValue || '[]');
          if (!Array.isArray(requiredIds)) return false;
          const valueIds = parseMultiReferenceValue(value);
          // Check exact match (same items, regardless of order)
          return requiredIds.length === valueIds.length &&
                 requiredIds.every((id: string) => valueIds.includes(id));
        } catch {
          return false;
        }
      }

      // For multi-reference has_items / has_no_items - check if array has items
      // Note: 'has_items' and 'has_no_items' for page_collection are handled elsewhere
      // Here we handle them for multi-reference fields
      case 'has_items': {
        // For page_collection source, this is handled by PageCollectionOperator logic
        // For collection_field source with multi_reference, check array length
        if (condition.source === 'collection_field') {
          const arr = parseMultiReferenceValue(value);
          return arr.length > 0 || isPresent;
        }
        // For page_collection, handled by pageCollectionCounts
        return true;
      }

      case 'has_no_items': {
        if (condition.source === 'collection_field') {
          const arr = parseMultiReferenceValue(value);
          // If parsed as array, check length; otherwise fall back to presence check
          if (Array.isArray(value) || (typeof value === 'string' && value.startsWith('['))) {
            return arr.length === 0;
          }
          return !isPresent;
        }
        return true;
      }

      // Multi-reference item_count - compare the count of references
      case 'item_count': {
        if (condition.source === 'collection_field' && condition.fieldType === 'multi_reference') {
          let count = 0;
          try {
            const arr = JSON.parse(value || '[]');
            count = Array.isArray(arr) ? arr.length : 0;
          } catch {
            count = 0;
          }
          const compareVal = condition.compareValue ?? 0;
          const compareOp = condition.compareOperator ?? 'eq';
          switch (compareOp) {
            case 'eq': return count === compareVal;
            case 'lt': return count < compareVal;
            case 'lte': return count <= compareVal;
            case 'gt': return count > compareVal;
            case 'gte': return count >= compareVal;
            default: return count === compareVal;
          }
        }
        // For page_collection, this is handled earlier in the function
        return true;
      }

      default:
        return true;
    }
  }

  return true;
}

/**
 * Evaluate conditional visibility for a layer
 * Groups are AND'd together; conditions within a group are OR'd
 *
 * @param conditionalVisibility - The visibility rules from layer.variables
 * @param context - The context containing field values and collection counts
 * @returns True if layer should be visible, false if it should be hidden
 */
export function evaluateVisibility(
  conditionalVisibility: import('@/types').ConditionalVisibility | undefined,
  context: VisibilityContext
): boolean {
  // No conditional visibility set - layer is visible
  if (!conditionalVisibility || !conditionalVisibility.groups || conditionalVisibility.groups.length === 0) {
    return true;
  }

  // Evaluate each group (AND logic between groups)
  for (const group of conditionalVisibility.groups) {
    if (!group.conditions || group.conditions.length === 0) {
      continue; // Empty group is truthy (skipped)
    }

    // Evaluate conditions within group (OR logic)
    let groupResult = false;
    for (const condition of group.conditions) {
      if (evaluateCondition(condition, context)) {
        groupResult = true;
        break; // Short-circuit: one true condition makes the group true
      }
    }

    // If any group is false, the whole visibility is false (AND logic)
    if (!groupResult) {
      return false;
    }
  }

  // All groups passed
  return true;
}

/**
 * Build a map of layer IDs to their root component layer ID
 * This helps know which layers belong to which component instance
 */
function buildComponentMap(layers: Layer[], componentMap: Record<string, string> = {}, currentComponentRootId: string | null = null): Record<string, string> {
  layers.forEach(layer => {
    // If this is a component instance root, track it
    const rootId = layer.componentId ? layer.id : currentComponentRootId;

    // Map all descendants to this component root
    if (rootId) {
      componentMap[layer.id] = rootId;
    }

    // Recursively process children
    if (layer.children && layer.children.length > 0) {
      buildComponentMap(layer.children, componentMap, rootId);
    }
  });

  return componentMap;
}

/**
 * Remap layer IDs in interactions based on an ID mapping
 */
function remapInteractionLayerIds(
  interactions: Layer['interactions'],
  idMap: Map<string, string>
): Layer['interactions'] {
  if (!interactions) return interactions;

  return interactions.map(interaction => ({
    ...interaction,
    tweens: interaction.tweens.map(tween => ({
      ...tween,
      layer_id: idMap.get(tween.layer_id) || tween.layer_id,
    })),
  }));
}

/**
 * Transform component layers with instance-specific IDs
 * This ensures each component instance has unique layer IDs for proper targeting
 */
function transformLayersForInstance(
  layers: Layer[],
  instanceLayerId: string
): Layer[] {
  // Build ID map: original ID -> instance-specific ID
  const idMap = new Map<string, string>();

  // First pass: collect all layer IDs and generate new ones
  const collectIds = (layerList: Layer[]) => {
    for (const layer of layerList) {
      const newId = `${instanceLayerId}_${layer.id}`;
      idMap.set(layer.id, newId);
      if (layer.children) {
        collectIds(layer.children);
      }
    }
  };
  collectIds(layers);

  // Second pass: transform layers with new IDs and remapped interactions
  const transformLayer = (layer: Layer): Layer => {
    const newId = idMap.get(layer.id) || layer.id;

    const transformedLayer: Layer = {
      ...layer,
      id: newId,
    };

    // Remap interaction IDs and tween layer_id references
    if (layer.interactions && layer.interactions.length > 0) {
      transformedLayer.interactions = layer.interactions.map(interaction => ({
        ...interaction,
        id: `${instanceLayerId}_${interaction.id}`,
        tweens: interaction.tweens.map(tween => ({
          ...tween,
          layer_id: idMap.get(tween.layer_id) || tween.layer_id,
        })),
      }));
    }

    // Recursively transform children
    if (layer.children && layer.children.length > 0) {
      transformedLayer.children = layer.children.map(transformLayer);
    }

    return transformedLayer;
  };

  return layers.map(transformLayer);
}

/**
 * Resolve component instances in layer tree
 * Replaces layers with componentId with the actual component layers
 * Also applies instance-specific ID transformations to ensure unique IDs per instance
 */
function resolveComponentsInLayers(
  layers: Layer[],
  components: Component[],
  parentComponentVariables?: ComponentVariable[],
  parentOverrides?: Layer['componentOverrides'],
): Layer[] {
  // First, resolve variableLinks at this level using applyComponentOverrides
  // This handles nested component instances whose variableLinks point to parentComponentVariables
  const effectiveLayers = parentComponentVariables?.length
    ? applyComponentOverrides(layers, parentOverrides, parentComponentVariables)
    : layers;

  return effectiveLayers.map(layer => {
    // If this layer is a component instance, populate its children from the component
    if (layer.componentId) {
      const component = components.find(c => c.id === layer.componentId);

      if (component && component.layers && component.layers.length > 0) {
        // The component's first layer is the actual content (Section, etc.)
        const componentContent = component.layers[0];

        // Transform all component children with instance-specific IDs
        // This ensures unique layer IDs when multiple instances of the same component exist
        const transformedChildren = componentContent.children
          ? transformLayersForInstance(componentContent.children, layer.id)
          : [];

        // Recursively resolve any nested components within the transformed children
        // Pass current component's variables and this instance's overrides
        const resolvedChildren = resolveComponentsInLayers(
          transformedChildren, components, component.variables, layer.componentOverrides,
        );

        // Build ID map for remapping root layer interactions
        // The root layer's ID becomes the instance ID, so remap any self-references
        const idMap = new Map<string, string>();
        if (componentContent.id !== layer.id) {
          idMap.set(componentContent.id, layer.id);
        }
        // Also add mappings for all child IDs (for root layer interactions targeting children)
        if (componentContent.children) {
          const collectChildIds = (children: Layer[]) => {
            for (const child of children) {
              idMap.set(child.id, `${layer.id}_${child.id}`);
              if (child.children) {
                collectChildIds(child.children);
              }
            }
          };
          collectChildIds(componentContent.children);
        }

        // Remap interaction layer IDs for root layer interactions
        const remappedInteractions = idMap.size > 0
          ? remapInteractionLayerIds(componentContent.interactions, idMap)
          : componentContent.interactions;

        // Apply component variable overrides and defaults to resolved children
        const overriddenChildren = applyComponentOverrides(
          resolvedChildren,
          layer.componentOverrides,
          component.variables,
        );

        // Return the wrapper with the component's content merged in
        // IMPORTANT: Keep componentId so LayerRenderer knows this is a component instance
        const resolved = {
          ...layer,
          ...componentContent, // Merge the component's properties (classes, design, etc.)
          id: layer.id, // Keep the instance's ID
          componentId: layer.componentId, // Keep the original componentId for selection
          componentOverrides: layer.componentOverrides, // Keep instance overrides
          interactions: remappedInteractions, // Use remapped interactions
          children: overriddenChildren,
        };

        return resolved;
      }
    }

    // Recursively process children
    if (layer.children && layer.children.length > 0) {
      return {
        ...layer,
        children: resolveComponentsInLayers(layer.children, components, parentComponentVariables, parentOverrides),
      };
    }

    return layer;
  });
}

/**
 * Serialize layers by resolving component instances
 * Returns both the resolved layers and a map of layer IDs to their component root IDs
 */
export function serializeLayers(
  layers: Layer[],
  components: Component[] = [],
  editingComponentVariables?: ComponentVariable[],
): { layers: Layer[]; componentMap: Record<string, string> } {
  // First build the component map (before resolving)
  const componentMap = buildComponentMap(layers);

  // Then resolve component instances
  const resolvedLayers = resolveComponentsInLayers(layers, components, editingComponentVariables);

  // Deep clone to avoid mutations
  return {
    layers: JSON.parse(JSON.stringify(resolvedLayers)),
    componentMap,
  };
}

/**
 * Assign order classes to a newly added layer if siblings have responsive order classes.
 * This ensures new layers appear at the end when the parent has responsive ordering.
 *
 * IMPORTANT: This checks for order classes on ALL responsive breakpoints (tablet AND mobile),
 * not just the current breakpoint. This handles the case where a layer is added on Desktop
 * but siblings have tablet/mobile order overrides.
 *
 * @param layers - The full layer tree
 * @param parentId - The parent layer ID where the new layer was added
 * @param newLayerId - The ID of the newly added layer
 * @param _breakpoint - The current breakpoint (kept for API compatibility, but we check all breakpoints)
 * @returns Updated layer tree, or original if no changes needed
 */
export function assignOrderClassToNewLayer(
  layers: Layer[],
  parentId: string,
  newLayerId: string,
  _breakpoint: 'desktop' | 'tablet' | 'mobile'
): Layer[] {
  // Define all responsive breakpoints to check
  const breakpointConfigs = [
    { name: 'tablet', prefix: 'max-lg:' },
    { name: 'mobile', prefix: 'max-md:' },
  ];

  // Helper to normalize classes to string
  const normalizeClasses = (classes: string | string[] | undefined): string => {
    if (!classes) return '';
    return Array.isArray(classes) ? classes.join(' ') : classes;
  };

  // Helper to check if a class string has order classes for a specific prefix
  const hasOrderClassForPrefix = (classes: string | string[] | undefined, prefix: string): boolean => {
    const normalized = normalizeClasses(classes);
    const regex = new RegExp(`${prefix.replace(':', '\\:')}order-\\d+`);
    return regex.test(normalized);
  };

  // Helper to get the order value from classes for a specific prefix
  const getOrderValueForPrefix = (classes: string | string[] | undefined, prefix: string): number | null => {
    const normalized = normalizeClasses(classes);
    const regex = new RegExp(`${prefix.replace(':', '\\:')}order-(\\d+)`);
    const match = normalized.match(regex);
    return match ? parseInt(match[1], 10) : null;
  };

  // Recursively find the parent and process
  function processLayers(layerList: Layer[]): Layer[] {
    return layerList.map(layer => {
      if (layer.id === parentId && layer.children && layer.children.length > 0) {
        // Found the parent - check each breakpoint for order classes
        const siblings = layer.children.filter(c => c.id !== newLayerId);
        const newLayer = layer.children.find(c => c.id === newLayerId);

        if (!newLayer) {
          return layer;
        }

        // Collect order classes to add for each breakpoint
        const orderClassesToAdd: string[] = [];

        for (const config of breakpointConfigs) {
          const hasOrderedSiblings = siblings.some(c => hasOrderClassForPrefix(c.classes, config.prefix));

          if (hasOrderedSiblings) {
            // Find the highest order value among siblings for this breakpoint
            let maxOrder = -1;
            siblings.forEach(sibling => {
              const orderValue = getOrderValueForPrefix(sibling.classes, config.prefix);
              if (orderValue !== null && orderValue > maxOrder) {
                maxOrder = orderValue;
              }
            });

            // Assign the next order value
            const newOrderValue = maxOrder + 1;
            orderClassesToAdd.push(`${config.prefix}order-${newOrderValue}`);
          }
        }

        if (orderClassesToAdd.length === 0) {
          // No siblings have order classes for any breakpoint
          return layer;
        }

        // Update the new layer with order classes
        const updatedChildren = layer.children.map(child => {
          if (child.id === newLayerId) {
            const currentClasses = normalizeClasses(child.classes);
            const newClasses = orderClassesToAdd.join(' ');
            return {
              ...child,
              classes: currentClasses ? `${currentClasses} ${newClasses}` : newClasses,
            };
          }
          return child;
        });

        return {
          ...layer,
          children: updatedChildren,
        };
      }

      // Recursively process children
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

/**
 * Creates a component via API and returns the result
 */
export async function createComponentViaApi(
  componentName: string,
  layers: Layer[]
): Promise<Component | null> {
  try {
    const response = await fetch('/ycode/api/components', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: componentName,
        layers: layers.map(layer => cloneDeep(layer)),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error || errorMessage;
      } catch {
        errorMessage = errorText || errorMessage;
      }
      console.error('Failed to create component:', errorMessage);
      return null;
    }

    const result = await response.json();

    if (result.error || !result.data) {
      console.error('Failed to create component:', result.error);
      return null;
    }

    return result.data;
  } catch (error) {
    console.error('Failed to create component:', error);
    return null;
  }
}

/**
 * Replaces a layer with a component instance in a layer tree
 */
export function replaceLayerWithComponentInstance(
  layers: Layer[],
  layerId: string,
  componentId: string
): Layer[] {
  return layers.map((layer) => {
    if (layer.id === layerId) {
      return {
        ...layer,
        componentId,
        children: [],
      };
    }
    if (layer.children) {
      return {
        ...layer,
        children: replaceLayerWithComponentInstance(layer.children, layerId, componentId),
      };
    }
    return layer;
  });
}

// ─── CMS Data-Binding Reset Utilities ─────────────────────────────────

/** Regex for matching inline variable tags (duplicated from inline-variables to avoid circular imports) */
const INLINE_VAR_REGEX = /<ycode-inline-variable>([\s\S]*?)<\/ycode-inline-variable>/g;

/**
 * Represents the collection context available at a specific position in the layer tree.
 * Maps collection layer IDs to their collection IDs.
 */
type CollectionContext = Map<string, string>;

/**
 * Build the collection context (available collection layers + their collection IDs)
 * for a given position in the tree by traversing ancestors.
 */
function buildCollectionContext(layers: Layer[], layerId: string): CollectionContext {
  const ctx: CollectionContext = new Map();
  const parents = findAllParentCollectionLayers(layers, layerId);

  for (const parent of parents) {
    const cv = getCollectionVariable(parent);
    if (cv?.id) {
      ctx.set(parent.id, cv.id);
    }
  }

  return ctx;
}

/**
 * Check if a FieldVariable references a collection context (via collection_layer_id or source).
 * Returns true if the binding is collection-sourced.
 */
function isCollectionBoundField(fv: FieldVariable): boolean {
  return fv.data?.source === 'collection' || !!fv.data?.collection_layer_id;
}

/**
 * Check if a FieldVariable is valid given the available collection context.
 * A binding is invalid if it references a collection_layer_id not present in the context.
 */
function isFieldVariableValid(fv: FieldVariable, ctx: CollectionContext): boolean {
  if (!isCollectionBoundField(fv)) return true;

  // If it references a specific collection layer, that layer must be in context
  if (fv.data?.collection_layer_id) {
    return ctx.has(fv.data.collection_layer_id);
  }

  // source='collection' but no specific layer: valid if any collection ancestor exists
  return ctx.size > 0;
}

/**
 * Strip inline variable tags from a text string that reference invalid collection bindings.
 * Returns the cleaned string or null if unchanged.
 */
function stripInvalidInlineVariables(text: string, ctx: CollectionContext): string | null {
  if (!text) return null;

  let changed = false;
  const result = text.replace(INLINE_VAR_REGEX, (match, content) => {
    try {
      const parsed = JSON.parse(content.trim());
      if (parsed.type === 'field' && parsed.data) {
        const fv = parsed as FieldVariable;
        if (isCollectionBoundField(fv) && !isFieldVariableValid(fv, ctx)) {
          changed = true;
          return '';
        }
      }
    } catch {
      // Not valid JSON, leave as-is
    }
    return match;
  });

  return changed ? result : null;
}

/**
 * Strip invalid field variables from a DesignColorVariable.
 * Returns cleaned variable or undefined to remove it entirely.
 */
function cleanDesignColorVariable(dcv: DesignColorVariable, ctx: CollectionContext): DesignColorVariable | undefined {
  let changed = false;
  const result = { ...dcv };

  // Clean solid field
  if (result.field && isCollectionBoundField(result.field) && !isFieldVariableValid(result.field, ctx)) {
    result.field = undefined;
    changed = true;
  }

  // Clean linear stops
  if (result.linear?.stops) {
    const cleanedStops = result.linear.stops.map((stop: BoundColorStop) => {
      if (stop.field && isCollectionBoundField(stop.field) && !isFieldVariableValid(stop.field, ctx)) {
        changed = true;
        const { field: _, ...rest } = stop;
        return rest;
      }
      return stop;
    });
    if (changed) result.linear = { ...result.linear, stops: cleanedStops };
  }

  // Clean radial stops
  if (result.radial?.stops) {
    let radialChanged = false;
    const cleanedStops = result.radial.stops.map((stop: BoundColorStop) => {
      if (stop.field && isCollectionBoundField(stop.field) && !isFieldVariableValid(stop.field, ctx)) {
        radialChanged = true;
        const { field: _, ...rest } = stop;
        return rest;
      }
      return stop;
    });
    if (radialChanged) {
      result.radial = { ...result.radial, stops: cleanedStops };
      changed = true;
    }
  }

  return changed ? result : dcv;
}

/**
 * Reset invalid CMS bindings on a single layer's variables.
 * Returns updated variables or null if nothing changed.
 */
function resetLayerVariableBindings(variables: LayerVariables | undefined, ctx: CollectionContext): LayerVariables | null {
  if (!variables) return null;

  let changed = false;
  const updated = { ...variables };

  // --- Collection variable itself: don't touch (the collection source stays) ---

  // --- Conditional visibility: reset field conditions referencing unavailable collection layers ---
  if (updated.conditionalVisibility?.groups) {
    const cleanedGroups = updated.conditionalVisibility.groups.map(group => {
      const cleanedConditions = group.conditions.filter(c => {
        if (c.source === 'page_collection' && c.collectionLayerId) {
          return ctx.has(c.collectionLayerId);
        }
        return true;
      });
      if (cleanedConditions.length !== group.conditions.length) {
        changed = true;
        return { ...group, conditions: cleanedConditions };
      }
      return group;
    });
    if (changed) {
      updated.conditionalVisibility = { groups: cleanedGroups };
    }
  }

  // --- Text variable: strip invalid inline variables from content ---
  if (updated.text) {
    if (updated.text.type === 'dynamic_text' && typeof updated.text.data?.content === 'string') {
      const cleaned = stripInvalidInlineVariables(updated.text.data.content, ctx);
      if (cleaned !== null) {
        updated.text = { ...updated.text, data: { content: cleaned } };
        changed = true;
      }
    }
    if (updated.text.type === 'dynamic_rich_text' && typeof updated.text.data?.content === 'object') {
      const cleanedText = cleanTiptapContent(updated.text.data.content, ctx);
      if (cleanedText !== null) {
        updated.text = { ...updated.text, data: { content: cleanedText } };
        changed = true;
      }
    }
  }

  // --- Image variable ---
  if (updated.image) {
    const imgSrc = updated.image.src;
    if (imgSrc && imgSrc.type === 'field') {
      const fv = imgSrc as FieldVariable;
      if (isCollectionBoundField(fv) && !isFieldVariableValid(fv, ctx)) {
        updated.image = { ...updated.image, src: { type: 'asset', data: { asset_id: null } } };
        changed = true;
      }
    }
    // Clean alt inline variables
    if (updated.image.alt?.type === 'dynamic_text' && typeof updated.image.alt.data?.content === 'string') {
      const cleaned = stripInvalidInlineVariables(updated.image.alt.data.content, ctx);
      if (cleaned !== null) {
        updated.image = { ...updated.image, alt: { ...updated.image.alt, data: { content: cleaned } } };
        changed = true;
      }
    }
  }

  // --- Audio variable ---
  if (updated.audio?.src) {
    const fv = updated.audio.src;
    if (fv.type === 'field' && isCollectionBoundField(fv as FieldVariable) && !isFieldVariableValid(fv as FieldVariable, ctx)) {
      updated.audio = { ...updated.audio, src: { type: 'asset', data: { asset_id: null } } };
      changed = true;
    }
  }

  // --- Video variable ---
  if (updated.video?.src) {
    const fv = updated.video.src;
    if (fv.type === 'field' && isCollectionBoundField(fv as FieldVariable) && !isFieldVariableValid(fv as FieldVariable, ctx)) {
      updated.video = { ...updated.video, src: undefined };
      changed = true;
    }
  }
  if (updated.video?.poster) {
    const fv = updated.video.poster;
    if (fv.type === 'field' && isCollectionBoundField(fv as FieldVariable) && !isFieldVariableValid(fv as FieldVariable, ctx)) {
      updated.video = { ...updated.video, poster: undefined };
      changed = true;
    }
  }

  // --- Iframe variable: strip inline variables from src ---
  if (updated.iframe?.src?.type === 'dynamic_text' && typeof updated.iframe.src.data?.content === 'string') {
    const cleaned = stripInvalidInlineVariables(updated.iframe.src.data.content, ctx);
    if (cleaned !== null) {
      updated.iframe = { ...updated.iframe, src: { ...updated.iframe.src, data: { content: cleaned } } };
      changed = true;
    }
  }

  // --- Link variable ---
  if (updated.link) {
    // URL inline variables
    if (updated.link.url?.type === 'dynamic_text' && typeof updated.link.url.data?.content === 'string') {
      const cleaned = stripInvalidInlineVariables(updated.link.url.data.content, ctx);
      if (cleaned !== null) {
        updated.link = { ...updated.link, url: { ...updated.link.url, data: { content: cleaned } } };
        changed = true;
      }
    }
    // Field link
    if (updated.link.field && isCollectionBoundField(updated.link.field) && !isFieldVariableValid(updated.link.field, ctx)) {
      updated.link = { ...updated.link, type: 'url', field: undefined };
      changed = true;
    }
    // Email inline variables
    if (updated.link.email?.type === 'dynamic_text' && typeof updated.link.email.data?.content === 'string') {
      const cleaned = stripInvalidInlineVariables(updated.link.email.data.content, ctx);
      if (cleaned !== null) {
        updated.link = { ...updated.link, email: { ...updated.link.email, data: { content: cleaned } } };
        changed = true;
      }
    }
    // Phone inline variables
    if (updated.link.phone?.type === 'dynamic_text' && typeof updated.link.phone.data?.content === 'string') {
      const cleaned = stripInvalidInlineVariables(updated.link.phone.data.content, ctx);
      if (cleaned !== null) {
        updated.link = { ...updated.link, phone: { ...updated.link.phone, data: { content: cleaned } } };
        changed = true;
      }
    }
  }

  // --- Design color bindings ---
  if (updated.design) {
    const designKeys = ['backgroundColor', 'color', 'borderColor', 'divideColor', 'textDecorationColor'] as const;
    let designChanged = false;
    const newDesign = { ...updated.design };

    for (const key of designKeys) {
      const dcv = newDesign[key];
      if (dcv) {
        const cleaned = cleanDesignColorVariable(dcv, ctx);
        if (cleaned !== dcv) {
          (newDesign as Record<string, DesignColorVariable | undefined>)[key] = cleaned;
          designChanged = true;
        }
      }
    }

    if (designChanged) {
      updated.design = newDesign;
      changed = true;
    }
  }

  return changed ? updated : null;
}

/**
 * Clean Tiptap JSON content by removing dynamicVariable nodes with invalid bindings.
 * Returns cleaned content or null if unchanged.
 */
function cleanTiptapContent(content: object, ctx: CollectionContext): object | null {
  if (!content || typeof content !== 'object') return null;

  let changed = false;
  const doc = content as { type?: string; content?: any[] };

  if (!doc.content || !Array.isArray(doc.content)) return null;

  const cleanedBlocks = doc.content.map((block: any) => {
    if (!block.content || !Array.isArray(block.content)) return block;

    const cleanedNodes = block.content.filter((node: any) => {
      if (node.type === 'dynamicVariable' && node.attrs?.variable) {
        const fv = node.attrs.variable as FieldVariable;
        if (fv.type === 'field' && isCollectionBoundField(fv) && !isFieldVariableValid(fv, ctx)) {
          changed = true;
          return false;
        }
      }
      return true;
    });

    if (cleanedNodes.length !== block.content.length) {
      return { ...block, content: cleanedNodes };
    }
    return block;
  });

  return changed ? { ...doc, content: cleanedBlocks } : null;
}

/**
 * Recursively reset invalid CMS data bindings on a layer subtree.
 * Checks each layer's bindings against the collection context available at its position.
 *
 * @param layers - The full layer tree (for context building)
 * @param subtree - The layer subtree to clean (modified in-place conceptually, returns new tree)
 * @param parentContext - Optional pre-built context from parent (optimization for batch ops)
 * @returns Updated subtree with invalid bindings removed
 */
export function resetInvalidBindings(
  layers: Layer[],
  subtree: Layer[],
  parentContext?: CollectionContext
): Layer[] {
  return subtree.map(layer => {
    // Build context for this layer's position
    const ctx = parentContext
      ? new Map(parentContext)
      : buildCollectionContext(layers, layer.id);

    // If this layer itself is a collection layer, add it to context for its children
    const cv = getCollectionVariable(layer);
    const childCtx = new Map(ctx);
    if (cv?.id) {
      childCtx.set(layer.id, cv.id);
    }

    // Reset variables on this layer
    const cleanedVars = resetLayerVariableBindings(layer.variables, ctx);

    // Recursively clean children
    let cleanedChildren = layer.children;
    if (layer.children && layer.children.length > 0) {
      cleanedChildren = resetInvalidBindings(layers, layer.children, childCtx);
    }

    if (cleanedVars || cleanedChildren !== layer.children) {
      return {
        ...layer,
        variables: cleanedVars || layer.variables,
        children: cleanedChildren,
      };
    }

    return layer;
  });
}

/**
 * Reset CMS bindings on a layer and its descendants after it has been moved to a new position.
 * Should be called after the layer tree has been updated with the new position.
 *
 * @param layers - The full updated layer tree
 * @param movedLayerId - ID of the moved layer
 * @returns Updated layer tree with invalid bindings reset
 */
export function resetBindingsAfterMove(layers: Layer[], movedLayerId: string): Layer[] {
  const movedLayer = findLayerById(layers, movedLayerId);
  if (!movedLayer) return layers;

  // Build context at the moved layer's new position
  const ctx = buildCollectionContext(layers, movedLayerId);

  // Clean the moved layer and its subtree
  const cleanedSubtree = resetInvalidBindings(layers, [movedLayer], ctx);
  const cleanedLayer = cleanedSubtree[0];

  if (cleanedLayer === movedLayer) return layers;

  // Replace the moved layer in the tree
  return replaceLayerInTree(layers, movedLayerId, cleanedLayer);
}

/**
 * Reset CMS bindings on all descendants of a layer whose collection source has changed.
 * Strips any binding that references the changed collection layer (by collection_layer_id)
 * or implicitly depends on it (source='collection' without a specific layer ID).
 *
 * @param layers - The full layer tree
 * @param collectionLayerId - ID of the layer whose collection source changed
 * @returns Updated layer tree
 */
export function resetBindingsOnCollectionSourceChange(layers: Layer[], collectionLayerId: string): Layer[] {
  const layer = findLayerById(layers, collectionLayerId);
  if (!layer) return layers;

  // Reset the layer's own bindings (filters, sort, conditional visibility)
  let updated = resetCollectionLayerOwnBindings(layer);
  let changed = updated !== layer;

  // Strip bindings on all descendants that reference this collection layer
  if (updated.children && updated.children.length > 0) {
    const cleanedChildren = stripBindingsForCollectionLayer(updated.children, collectionLayerId);
    if (cleanedChildren !== updated.children) {
      updated = { ...updated, children: cleanedChildren };
      changed = true;
    }
  }

  if (!changed) return layers;

  return replaceLayerInTree(layers, collectionLayerId, updated);
}

/**
 * Recursively strip CMS bindings that reference a specific collection layer.
 * Used when that collection layer's source has changed, making all existing field bindings invalid.
 * Also resets nested collection sources that depend on the changed parent (source_field_source='collection').
 */
function stripBindingsForCollectionLayer(subtree: Layer[], collectionLayerId: string): Layer[] {
  let treeChanged = false;

  const result = subtree.map(layer => {
    let changed = false;
    let updated = layer;

    // Check if this is a nested collection layer whose source depends on the changed parent
    // A nested collection has a source_field_id (gets items from a parent's reference/multi-reference field)
    const cv = getCollectionVariable(layer);
    if (cv?.source_field_id) {
      // This nested collection gets its data from the parent collection — reset its source
      updated = {
        ...updated,
        variables: {
          ...updated.variables,
          collection: { id: '', source_field_id: undefined, source_field_type: undefined, source_field_source: undefined },
        },
      };
      changed = true;

      // Reset the nested collection's own bindings (filters, sort, conditional visibility)
      updated = resetCollectionLayerOwnBindings(updated);

      // Reset all bindings inside the nested collection that reference it,
      // then cascade further into any deeper nested collections
      if (updated.children && updated.children.length > 0) {
        const cleanedChildren = stripBindingsForCollectionLayer(updated.children, layer.id);
        if (cleanedChildren !== updated.children) {
          updated = { ...updated, children: cleanedChildren };
        }
      }

      treeChanged = true;
      return updated;
    }

    // Reset field variable bindings on this layer
    if (updated.variables) {
      const cleaned = resetVariablesForCollectionLayer(updated.variables, collectionLayerId);
      if (cleaned) {
        updated = { ...updated, variables: cleaned };
        changed = true;
      }
    }

    // Recurse into children
    if (layer.children && layer.children.length > 0) {
      const cleanedChildren = stripBindingsForCollectionLayer(
        changed ? updated.children || [] : layer.children,
        collectionLayerId
      );
      if (cleanedChildren !== layer.children) {
        updated = { ...updated, children: cleanedChildren };
        changed = true;
      }
    }

    if (changed) treeChanged = true;
    return changed ? updated : layer;
  });

  return treeChanged ? result : subtree;
}

/**
 * Reset a collection layer's own bindings that depend on its collection source.
 * Clears filters, sort-by-field, and collection_field conditional visibility.
 */
function resetCollectionLayerOwnBindings(layer: Layer): Layer {
  let updated = layer;

  // Reset collection filters and field-based sort
  if (updated.variables?.collection) {
    const cv = updated.variables.collection;
    const hasFilters = cv.filters?.groups?.length;
    const hasFieldSort = cv.sort_by && cv.sort_by !== 'none' && cv.sort_by !== 'manual' && cv.sort_by !== 'random';

    if (hasFilters || hasFieldSort) {
      updated = {
        ...updated,
        variables: {
          ...updated.variables,
          collection: {
            ...cv,
            filters: undefined,
            sort_by: undefined,
            sort_order: undefined,
          },
        },
      };
    }
  }

  // Reset conditional visibility conditions that reference collection fields
  if (updated.variables?.conditionalVisibility?.groups) {
    let visChanged = false;
    const cleanedGroups = updated.variables.conditionalVisibility.groups.map(group => {
      const cleanedConditions = group.conditions.filter(c => {
        if (c.source === 'collection_field') {
          visChanged = true;
          return false;
        }
        return true;
      });
      return visChanged ? { ...group, conditions: cleanedConditions } : group;
    });

    if (visChanged) {
      updated = {
        ...updated,
        variables: {
          ...updated.variables,
          conditionalVisibility: { groups: cleanedGroups },
        },
      };
    }
  }

  return updated;
}

/**
 * Check if a FieldVariable references a specific collection layer (directly or implicitly).
 */
function fieldReferencesCollectionLayer(fv: FieldVariable, collectionLayerId: string): boolean {
  if (!isCollectionBoundField(fv)) return false;

  // Direct reference to the collection layer
  if (fv.data?.collection_layer_id === collectionLayerId) return true;

  // Implicit reference: source='collection' without a specific layer ID
  // means it uses the nearest ancestor collection — which is the one being changed
  if (fv.data?.source === 'collection' && !fv.data?.collection_layer_id) return true;

  return false;
}

/**
 * Reset variable bindings on a single layer that reference a specific collection layer.
 * Returns updated variables or null if unchanged.
 */
function resetVariablesForCollectionLayer(variables: LayerVariables, collectionLayerId: string): LayerVariables | null {
  let changed = false;
  const updated = { ...variables };

  // --- Conditional visibility ---
  if (updated.conditionalVisibility?.groups) {
    let visChanged = false;
    const cleanedGroups = updated.conditionalVisibility.groups.map(group => {
      const cleanedConditions = group.conditions.filter(c => {
        if (c.source === 'page_collection' && c.collectionLayerId === collectionLayerId) {
          visChanged = true;
          return false;
        }
        return true;
      });
      return visChanged ? { ...group, conditions: cleanedConditions } : group;
    });
    if (visChanged) {
      updated.conditionalVisibility = { groups: cleanedGroups };
      changed = true;
    }
  }

  // --- Text variable ---
  if (updated.text) {
    if (updated.text.type === 'dynamic_text' && typeof updated.text.data?.content === 'string') {
      const cleaned = stripInlineVarsForCollectionLayer(updated.text.data.content, collectionLayerId);
      if (cleaned !== null) {
        updated.text = { ...updated.text, data: { content: cleaned } };
        changed = true;
      }
    }
    if (updated.text.type === 'dynamic_rich_text' && typeof updated.text.data?.content === 'object') {
      const cleaned = cleanTiptapForCollectionLayer(updated.text.data.content, collectionLayerId);
      if (cleaned !== null) {
        updated.text = { ...updated.text, data: { content: cleaned } };
        changed = true;
      }
    }
  }

  // --- Image ---
  if (updated.image) {
    if (updated.image.src?.type === 'field' && fieldReferencesCollectionLayer(updated.image.src as FieldVariable, collectionLayerId)) {
      updated.image = { ...updated.image, src: { type: 'asset', data: { asset_id: null } } };
      changed = true;
    }
    if (updated.image.alt?.type === 'dynamic_text' && typeof updated.image.alt.data?.content === 'string') {
      const cleaned = stripInlineVarsForCollectionLayer(updated.image.alt.data.content, collectionLayerId);
      if (cleaned !== null) {
        updated.image = { ...updated.image, alt: { ...updated.image.alt, data: { content: cleaned } } };
        changed = true;
      }
    }
  }

  // --- Audio ---
  if (updated.audio?.src?.type === 'field' && fieldReferencesCollectionLayer(updated.audio.src as FieldVariable, collectionLayerId)) {
    updated.audio = { ...updated.audio, src: { type: 'asset', data: { asset_id: null } } };
    changed = true;
  }

  // --- Video ---
  if (updated.video?.src?.type === 'field' && fieldReferencesCollectionLayer(updated.video.src as FieldVariable, collectionLayerId)) {
    updated.video = { ...updated.video, src: undefined };
    changed = true;
  }
  if (updated.video?.poster?.type === 'field' && fieldReferencesCollectionLayer(updated.video.poster as FieldVariable, collectionLayerId)) {
    updated.video = { ...updated.video, poster: undefined };
    changed = true;
  }

  // --- Iframe ---
  if (updated.iframe?.src?.type === 'dynamic_text' && typeof updated.iframe.src.data?.content === 'string') {
    const cleaned = stripInlineVarsForCollectionLayer(updated.iframe.src.data.content, collectionLayerId);
    if (cleaned !== null) {
      updated.iframe = { ...updated.iframe, src: { ...updated.iframe.src, data: { content: cleaned } } };
      changed = true;
    }
  }

  // --- Link ---
  if (updated.link) {
    if (updated.link.field && fieldReferencesCollectionLayer(updated.link.field, collectionLayerId)) {
      updated.link = { ...updated.link, type: 'url', field: undefined };
      changed = true;
    }
    const linkToCheck = updated.link;
    for (const key of ['url', 'email', 'phone'] as const) {
      const linkVar = linkToCheck[key];
      if (linkVar?.type === 'dynamic_text' && typeof linkVar.data?.content === 'string') {
        const cleaned = stripInlineVarsForCollectionLayer(linkVar.data.content, collectionLayerId);
        if (cleaned !== null) {
          updated.link = { ...updated.link, [key]: { ...linkVar, data: { content: cleaned } } };
          changed = true;
        }
      }
    }
  }

  // --- Design color bindings ---
  if (updated.design) {
    const designKeys = ['backgroundColor', 'color', 'borderColor', 'divideColor', 'textDecorationColor'] as const;
    let designChanged = false;
    const newDesign = { ...updated.design };

    for (const key of designKeys) {
      const dcv = newDesign[key];
      if (dcv) {
        const cleaned = cleanDesignColorForCollectionLayer(dcv, collectionLayerId);
        if (cleaned !== dcv) {
          (newDesign as Record<string, DesignColorVariable | undefined>)[key] = cleaned;
          designChanged = true;
        }
      }
    }

    if (designChanged) {
      updated.design = newDesign;
      changed = true;
    }
  }

  return changed ? updated : null;
}

/** Strip inline variable tags referencing a specific collection layer from a text string. */
function stripInlineVarsForCollectionLayer(text: string, collectionLayerId: string): string | null {
  if (!text) return null;
  let changed = false;

  const result = text.replace(INLINE_VAR_REGEX, (match, content) => {
    try {
      const parsed = JSON.parse(content.trim());
      if (parsed.type === 'field' && parsed.data) {
        if (fieldReferencesCollectionLayer(parsed as FieldVariable, collectionLayerId)) {
          changed = true;
          return '';
        }
      }
    } catch { /* not valid JSON */ }
    return match;
  });

  return changed ? result : null;
}

/** Clean Tiptap content by removing dynamicVariable nodes referencing a specific collection layer. */
function cleanTiptapForCollectionLayer(content: object, collectionLayerId: string): object | null {
  if (!content || typeof content !== 'object') return null;
  const doc = content as { type?: string; content?: any[] };
  if (!doc.content || !Array.isArray(doc.content)) return null;

  let changed = false;
  const cleanedBlocks = doc.content.map((block: any) => {
    if (!block.content || !Array.isArray(block.content)) return block;

    const cleanedNodes = block.content.filter((node: any) => {
      if (node.type === 'dynamicVariable' && node.attrs?.variable) {
        const fv = node.attrs.variable as FieldVariable;
        if (fv.type === 'field' && fieldReferencesCollectionLayer(fv, collectionLayerId)) {
          changed = true;
          return false;
        }
      }
      return true;
    });

    return cleanedNodes.length !== block.content.length ? { ...block, content: cleanedNodes } : block;
  });

  return changed ? { ...doc, content: cleanedBlocks } : null;
}

/** Clean a DesignColorVariable for a collection layer source change. */
function cleanDesignColorForCollectionLayer(dcv: DesignColorVariable, collectionLayerId: string): DesignColorVariable {
  let changed = false;
  const result = { ...dcv };

  if (result.field?.type === 'field' && fieldReferencesCollectionLayer(result.field, collectionLayerId)) {
    result.field = undefined;
    changed = true;
  }

  if (result.linear?.stops) {
    const cleanedStops = result.linear.stops.map(stop => {
      if (stop.field?.type === 'field' && fieldReferencesCollectionLayer(stop.field, collectionLayerId)) {
        changed = true;
        const { field: _, ...rest } = stop;
        return rest;
      }
      return stop;
    });
    if (changed) result.linear = { ...result.linear, stops: cleanedStops };
  }

  if (result.radial?.stops) {
    let radialChanged = false;
    const cleanedStops = result.radial.stops.map(stop => {
      if (stop.field?.type === 'field' && fieldReferencesCollectionLayer(stop.field, collectionLayerId)) {
        radialChanged = true;
        const { field: _, ...rest } = stop;
        return rest;
      }
      return stop;
    });
    if (radialChanged) {
      result.radial = { ...result.radial, stops: cleanedStops };
      changed = true;
    }
  }

  return changed ? result : dcv;
}

/**
 * Reset CMS bindings that reference a deleted collection across all layers.
 *
 * @param layers - The full layer tree
 * @param deletedCollectionId - ID of the deleted collection
 * @returns Updated layer tree
 */
export function resetBindingsForDeletedCollection(layers: Layer[], deletedCollectionId: string): Layer[] {
  return layers.map(layer => {
    let updated = layer;
    let changed = false;

    // If this layer has a collection binding to the deleted collection, clear it
    const cv = getCollectionVariable(layer);
    if (cv?.id === deletedCollectionId) {
      updated = {
        ...updated,
        variables: {
          ...updated.variables,
          collection: { id: '' },
        },
      };
      changed = true;
    }

    // Reset field variables referencing this collection's fields
    if (updated.variables) {
      const cleanedVars = resetFieldsForDeletedCollection(updated.variables, deletedCollectionId);
      if (cleanedVars) {
        updated = { ...updated, variables: cleanedVars };
        changed = true;
      }
    }

    // Recursively process children
    if (layer.children && layer.children.length > 0) {
      const cleanedChildren = resetBindingsForDeletedCollection(
        changed ? updated.children || [] : layer.children,
        deletedCollectionId
      );
      if (cleanedChildren !== layer.children) {
        updated = { ...updated, children: cleanedChildren };
        changed = true;
      }
    }

    return changed ? updated : layer;
  });
}

/**
 * Reset field variables in a LayerVariables that reference a specific collection_layer_id
 * which had a specific deleted collection. This is a helper used internally.
 */
function resetFieldsForDeletedCollection(
  variables: LayerVariables,
  deletedCollectionId: string
): LayerVariables | null {
  // For deleted collections, we need to walk the full tree and find bindings
  // whose collection_layer_id points to a layer that had this collection.
  // However, since the collection source is already cleared above, the main
  // resetInvalidBindings flow handles descendant cleanup.
  // This function is a no-op placeholder for direct field_id references
  // (which don't directly store collection IDs).
  return null;
}

/**
 * Reset CMS bindings that reference a deleted field across all layers.
 *
 * @param layers - The full layer tree
 * @param deletedFieldId - ID of the deleted field
 * @returns Updated layer tree
 */
export function resetBindingsForDeletedField(layers: Layer[], deletedFieldId: string): Layer[] {
  return layers.map(layer => {
    let updated = layer;
    let changed = false;

    if (updated.variables) {
      const cleanedVars = resetVariablesForDeletedField(updated.variables, deletedFieldId);
      if (cleanedVars) {
        updated = { ...updated, variables: cleanedVars };
        changed = true;
      }
    }

    if (layer.children && layer.children.length > 0) {
      const cleanedChildren = resetBindingsForDeletedField(
        changed ? updated.children || [] : layer.children,
        deletedFieldId
      );
      if (cleanedChildren !== layer.children) {
        updated = { ...updated, children: cleanedChildren };
        changed = true;
      }
    }

    return changed ? updated : layer;
  });
}

/**
 * Reset all variable bindings on a layer that reference a specific deleted field.
 * Returns updated variables or null if unchanged.
 */
function resetVariablesForDeletedField(variables: LayerVariables, deletedFieldId: string): LayerVariables | null {
  let changed = false;
  const updated = { ...variables };

  const fieldRefersToDeleted = (fv: FieldVariable): boolean => {
    if (fv.data?.field_id === deletedFieldId) return true;
    if (fv.data?.relationships?.includes(deletedFieldId)) return true;
    return false;
  };

  // --- Image ---
  if (updated.image?.src && updated.image.src.type === 'field') {
    if (fieldRefersToDeleted(updated.image.src as FieldVariable)) {
      updated.image = { ...updated.image, src: { type: 'asset', data: { asset_id: null } } };
      changed = true;
    }
  }

  // --- Audio ---
  if (updated.audio?.src && updated.audio.src.type === 'field') {
    if (fieldRefersToDeleted(updated.audio.src as FieldVariable)) {
      updated.audio = { ...updated.audio, src: { type: 'asset', data: { asset_id: null } } };
      changed = true;
    }
  }

  // --- Video ---
  if (updated.video?.src && updated.video.src.type === 'field') {
    if (fieldRefersToDeleted(updated.video.src as FieldVariable)) {
      updated.video = { ...updated.video, src: undefined };
      changed = true;
    }
  }
  if (updated.video?.poster && updated.video.poster.type === 'field') {
    if (fieldRefersToDeleted(updated.video.poster as FieldVariable)) {
      updated.video = { ...updated.video, poster: undefined };
      changed = true;
    }
  }

  // --- Link field ---
  if (updated.link?.field && fieldRefersToDeleted(updated.link.field)) {
    updated.link = { ...updated.link, type: 'url', field: undefined };
    changed = true;
  }

  // --- Text: strip inline variables referencing the deleted field ---
  if (updated.text) {
    if (updated.text.type === 'dynamic_text' && typeof updated.text.data?.content === 'string') {
      const cleaned = stripInlineVariablesForDeletedField(updated.text.data.content, deletedFieldId);
      if (cleaned !== null) {
        updated.text = { ...updated.text, data: { content: cleaned } };
        changed = true;
      }
    }
    if (updated.text.type === 'dynamic_rich_text' && typeof updated.text.data?.content === 'object') {
      const cleaned = cleanTiptapContentForDeletedField(updated.text.data.content, deletedFieldId);
      if (cleaned !== null) {
        updated.text = { ...updated.text, data: { content: cleaned } };
        changed = true;
      }
    }
  }

  // --- Inline variables in URL/email/phone ---
  for (const key of ['url', 'email', 'phone'] as const) {
    const linkVar = updated.link?.[key];
    if (linkVar?.type === 'dynamic_text' && typeof linkVar.data?.content === 'string') {
      const cleaned = stripInlineVariablesForDeletedField(linkVar.data.content, deletedFieldId);
      if (cleaned !== null) {
        updated.link = { ...updated.link!, [key]: { ...linkVar, data: { content: cleaned } } };
        changed = true;
      }
    }
  }

  // --- Image alt inline variables ---
  if (updated.image?.alt?.type === 'dynamic_text' && typeof updated.image.alt.data?.content === 'string') {
    const cleaned = stripInlineVariablesForDeletedField(updated.image.alt.data.content, deletedFieldId);
    if (cleaned !== null) {
      updated.image = { ...updated.image, alt: { ...updated.image.alt, data: { content: cleaned } } };
      changed = true;
    }
  }

  // --- Design color bindings ---
  if (updated.design) {
    const designKeys = ['backgroundColor', 'color', 'borderColor', 'divideColor', 'textDecorationColor'] as const;
    let designChanged = false;
    const newDesign = { ...updated.design };

    for (const dKey of designKeys) {
      const dcv = newDesign[dKey];
      if (dcv) {
        const cleaned = cleanDesignColorForDeletedField(dcv, deletedFieldId);
        if (cleaned !== dcv) {
          (newDesign as Record<string, DesignColorVariable | undefined>)[dKey] = cleaned;
          designChanged = true;
        }
      }
    }

    if (designChanged) {
      updated.design = newDesign;
      changed = true;
    }
  }

  // --- Conditional visibility ---
  if (updated.conditionalVisibility?.groups) {
    let visChanged = false;
    const cleanedGroups = updated.conditionalVisibility.groups.map(group => {
      const cleanedConditions = group.conditions.filter(c => {
        if (c.source === 'collection_field' && c.fieldId === deletedFieldId) {
          visChanged = true;
          return false;
        }
        return true;
      });
      return visChanged ? { ...group, conditions: cleanedConditions } : group;
    });

    if (visChanged) {
      updated.conditionalVisibility = { groups: cleanedGroups };
      changed = true;
    }
  }

  // --- Collection filters (references deleted field) ---
  if (updated.collection?.filters?.groups) {
    let filterChanged = false;
    const cleanedGroups = updated.collection.filters.groups.map(group => {
      const cleanedConditions = group.conditions.filter(c => {
        if (c.fieldId === deletedFieldId) {
          filterChanged = true;
          return false;
        }
        return true;
      });
      return filterChanged ? { ...group, conditions: cleanedConditions } : group;
    });

    if (filterChanged) {
      updated.collection = { ...updated.collection, filters: { groups: cleanedGroups } };
      changed = true;
    }
  }

  return changed ? updated : null;
}

/**
 * Strip inline variable tags from text that reference a specific deleted field.
 */
function stripInlineVariablesForDeletedField(text: string, deletedFieldId: string): string | null {
  if (!text) return null;

  let changed = false;
  const result = text.replace(INLINE_VAR_REGEX, (match, content) => {
    try {
      const parsed = JSON.parse(content.trim());
      if (parsed.type === 'field' && parsed.data) {
        if (parsed.data.field_id === deletedFieldId || parsed.data.relationships?.includes(deletedFieldId)) {
          changed = true;
          return '';
        }
      }
    } catch {
      // Not valid JSON
    }
    return match;
  });

  return changed ? result : null;
}

/**
 * Clean Tiptap JSON content by removing dynamicVariable nodes referencing a deleted field.
 */
function cleanTiptapContentForDeletedField(content: object, deletedFieldId: string): object | null {
  if (!content || typeof content !== 'object') return null;

  let changed = false;
  const doc = content as { type?: string; content?: any[] };

  if (!doc.content || !Array.isArray(doc.content)) return null;

  const cleanedBlocks = doc.content.map((block: any) => {
    if (!block.content || !Array.isArray(block.content)) return block;

    const cleanedNodes = block.content.filter((node: any) => {
      if (node.type === 'dynamicVariable' && node.attrs?.variable) {
        const fv = node.attrs.variable;
        if (fv.type === 'field' && fv.data) {
          if (fv.data.field_id === deletedFieldId || fv.data.relationships?.includes(deletedFieldId)) {
            changed = true;
            return false;
          }
        }
      }
      return true;
    });

    if (cleanedNodes.length !== block.content.length) {
      return { ...block, content: cleanedNodes };
    }
    return block;
  });

  return changed ? { ...doc, content: cleanedBlocks } : null;
}

/**
 * Clean a DesignColorVariable for a deleted field.
 */
function cleanDesignColorForDeletedField(dcv: DesignColorVariable, deletedFieldId: string): DesignColorVariable {
  let changed = false;
  const result = { ...dcv };

  if (result.field?.type === 'field' && (result.field.data?.field_id === deletedFieldId || result.field.data?.relationships?.includes(deletedFieldId))) {
    result.field = undefined;
    changed = true;
  }

  if (result.linear?.stops) {
    const cleanedStops = result.linear.stops.map(stop => {
      if (stop.field?.type === 'field' && (stop.field.data?.field_id === deletedFieldId || stop.field.data?.relationships?.includes(deletedFieldId))) {
        changed = true;
        const { field: _, ...rest } = stop;
        return rest;
      }
      return stop;
    });
    if (changed) result.linear = { ...result.linear, stops: cleanedStops };
  }

  if (result.radial?.stops) {
    let radialChanged = false;
    const cleanedStops = result.radial.stops.map(stop => {
      if (stop.field?.type === 'field' && (stop.field.data?.field_id === deletedFieldId || stop.field.data?.relationships?.includes(deletedFieldId))) {
        radialChanged = true;
        const { field: _, ...rest } = stop;
        return rest;
      }
      return stop;
    });
    if (radialChanged) {
      result.radial = { ...result.radial, stops: cleanedStops };
      changed = true;
    }
  }

  return changed ? result : dcv;
}

/**
 * Helper to replace a single layer in the tree by ID.
 */
function replaceLayerInTree(layers: Layer[], layerId: string, replacement: Layer): Layer[] {
  return layers.map(layer => {
    if (layer.id === layerId) return replacement;
    if (layer.children) {
      const updatedChildren = replaceLayerInTree(layer.children, layerId, replacement);
      if (updatedChildren !== layer.children) {
        return { ...layer, children: updatedChildren };
      }
    }
    return layer;
  });
}

/**
 * Find the parent layer and sibling index for a target layer ID
 * @returns Parent layer (null if root-level) and the index within the parent's children
 */
export function findParentAndIndex(
  layers: Layer[],
  targetId: string,
  parent: Layer | null = null
): { parent: Layer | null; index: number } | null {
  for (let i = 0; i < layers.length; i++) {
    if (layers[i].id === targetId) {
      return { parent, index: i };
    }
    if (layers[i].children && layers[i].children!.length > 0) {
      const found = findParentAndIndex(layers[i].children!, targetId, layers[i]);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Insert a layer after a target position identified by parent and index
 */
export function insertLayerAfter(
  layers: Layer[],
  parentLayer: Layer | null,
  insertIndex: number,
  newLayer: Layer
): Layer[] {
  if (parentLayer === null) {
    const newList = [...layers];
    newList.splice(insertIndex + 1, 0, newLayer);
    return newList;
  }
  return layers.map(l => {
    if (l.id === parentLayer.id) {
      const children = [...(l.children || [])];
      children.splice(insertIndex + 1, 0, newLayer);
      return { ...l, children };
    }
    if (l.children && l.children.length > 0) {
      return { ...l, children: insertLayerAfter(l.children, parentLayer, insertIndex, newLayer) };
    }
    return l;
  });
}

/**
 * Recursively update a layer's properties by ID
 */
export function updateLayerProps(
  layers: Layer[],
  targetId: string,
  props: Partial<Layer>
): Layer[] {
  return layers.map(layer => {
    if (layer.id === targetId) {
      return { ...layer, ...props };
    }
    if (layer.children && layer.children.length > 0) {
      return { ...layer, children: updateLayerProps(layer.children, targetId, props) };
    }
    return layer;
  });
}
