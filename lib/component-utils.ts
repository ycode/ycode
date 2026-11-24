/**
 * Component Utilities
 *
 * Core logic for applying, detaching, and managing components
 */

import type { Layer, Component } from '@/types';
import { generateId } from '@/lib/utils';
import { getComponentVariantLayers } from './component-variant-utils';
import { regenerateIdsWithInteractionRemapping } from './layer-utils';

/**
 * Extract component IDs from Tiptap JSON content (richTextComponent nodes).
 */
function collectComponentIdsFromTiptap(node: any, ids: Set<string>) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'richTextComponent' && node.attrs?.componentId) {
    ids.add(node.attrs.componentId);
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      collectComponentIdsFromTiptap(child, ids);
    }
  }
}

/**
 * Collect all component IDs referenced in a layer tree,
 * including components embedded in rich-text content.
 */
export function collectComponentIds(layers: Layer[]): Set<string> {
  const ids = new Set<string>();

  const traverse = (layerList: Layer[]) => {
    for (const layer of layerList) {
      if (layer.componentId) {
        ids.add(layer.componentId);
      }

      // Scan rich-text content for embedded components
      const textVar = layer.variables?.text;
      if (textVar && 'data' in textVar && (textVar as any).data?.content) {
        collectComponentIdsFromTiptap((textVar as any).data.content, ids);
      }

      // Scan component override text values (both text and rich_text categories)
      for (const category of ['text', 'rich_text'] as const) {
        const overrideTexts = layer.componentOverrides?.[category];
        if (overrideTexts) {
          for (const val of Object.values(overrideTexts)) {
            const content = (val as any)?.data?.content;
            if (content && typeof content === 'object') {
              collectComponentIdsFromTiptap(content, ids);
            }
          }
        }
      }

      if (layer.children && layer.children.length > 0) {
        traverse(layer.children);
      }
    }
  };

  traverse(layers);
  return ids;
}

/** `componentId` keys inside serialized JSON (e.g. rich text stored as a string), quotes escaped or not */
const SERIALIZED_COMPONENT_ID = /componentId\\*"\s*:\s*\\*"([^"\\]+)/g;

/**
 * Collect every component ID referenced anywhere in a value: instance layers,
 * overrides, variants, variable defaults and rich-text nodes (parsed or serialized).
 */
export function collectReferencedComponentIds(value: unknown, ids: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    if (value.includes('componentId')) {
      for (const match of value.matchAll(SERIALIZED_COMPONENT_ID)) ids.add(match[1]);
    }
    return ids;
  }
  if (!value || typeof value !== 'object') return ids;
  if (Array.isArray(value)) {
    for (const item of value) collectReferencedComponentIds(item, ids);
    return ids;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'componentId' && typeof child === 'string') {
      ids.add(child);
    } else {
      collectReferencedComponentIds(child, ids);
    }
  }
  return ids;
}

/**
 * Build a dependency graph of components
 * Returns a map where key is componentId and value is set of componentIds it depends on
 */
export function buildComponentDependencyGraph(
  components: Component[]
): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();

  for (const component of components) {
    const dependencies = collectComponentIds(component.layers || []);

    // Also scan variable default values for embedded components
    if (component.variables) {
      for (const variable of component.variables) {
        const content = (variable.default_value as any)?.data?.content;
        if (content && typeof content === 'object') {
          collectComponentIdsFromTiptap(content, dependencies);
        }
      }
    }

    graph.set(component.id, dependencies);
  }

  return graph;
}

/**
 * Check if adding a layer tree to a component would create a circular reference
 *
 * @param targetComponentId - The component being edited (receiving the layers)
 * @param layersToAdd - The layers being added/pasted
 * @param components - All available components
 * @returns Object with `wouldCycle` boolean and optional `cyclePath` for debugging
 */
export function wouldCreateCircularReference(
  targetComponentId: string,
  layersToAdd: Layer[],
  components: Component[]
): { wouldCycle: boolean; cyclePath?: string[] } {
  // Get all component IDs referenced in the layers being added
  const referencedComponentIds = collectComponentIds(layersToAdd);

  // If no components are referenced, no cycle possible
  if (referencedComponentIds.size === 0) {
    return { wouldCycle: false };
  }

  // Direct self-reference check
  if (referencedComponentIds.has(targetComponentId)) {
    return { wouldCycle: true, cyclePath: [targetComponentId, targetComponentId] };
  }

  // Build dependency graph for all components
  const graph = buildComponentDependencyGraph(components);

  // Check if any referenced component has a path back to targetComponentId
  // Using DFS to detect cycles
  for (const refId of referencedComponentIds) {
    const visited = new Set<string>();
    const path: string[] = [targetComponentId, refId];

    if (hasPathToComponent(refId, targetComponentId, graph, visited, path)) {
      return { wouldCycle: true, cyclePath: path };
    }
  }

  return { wouldCycle: false };
}

/** Check if embedding `componentId` inside `editingComponentId` would create a cycle. */
export function isCircularComponentReference(
  editingComponentId: string,
  componentId: string,
  components: Component[],
): boolean {
  if (componentId === editingComponentId) return true;
  const fakeLayer = { id: '_check', name: 'div', componentId } as Layer;
  return wouldCreateCircularReference(editingComponentId, [fakeLayer], components).wouldCycle;
}

/**
 * DFS helper to check if there's a path from `startId` to `targetId` through component dependencies
 */
function hasPathToComponent(
  startId: string,
  targetId: string,
  graph: Map<string, Set<string>>,
  visited: Set<string>,
  path: string[]
): boolean {
  if (startId === targetId) {
    return true;
  }

  if (visited.has(startId)) {
    return false;
  }

  visited.add(startId);

  const dependencies = graph.get(startId);
  if (!dependencies) {
    return false;
  }

  for (const depId of dependencies) {
    path.push(depId);
    if (hasPathToComponent(depId, targetId, graph, visited, path)) {
      return true;
    }
    path.pop();
  }

  return false;
}

/**
 * Get a human-readable description of a circular reference
 */
export function getCircularReferenceMessage(
  cyclePath: string[],
  components: Component[]
): string {
  const names = cyclePath.map(id => {
    const comp = components.find(c => c.id === id);
    return comp?.name || id;
  });

  return names.join(' → ');
}

/**
 * Check for circular reference and return error message if found
 * Returns null if no circular reference, or error message string if found
 *
 * @param targetComponentId - The component being edited
 * @param layersToAdd - The layers being added/pasted (can be single layer or array)
 * @param components - All available components
 * @returns Error message string if circular reference found, null otherwise
 */
export function checkCircularReference(
  targetComponentId: string,
  layersToAdd: Layer | Layer[],
  components: Component[]
): string | null {
  const layers = Array.isArray(layersToAdd) ? layersToAdd : [layersToAdd];
  const result = wouldCreateCircularReference(targetComponentId, layers, components);

  if (!result.wouldCycle) {
    return null;
  }

  return result.cyclePath
    ? getCircularReferenceMessage(result.cyclePath, components)
    : 'This action would create an infinite component loop';
}

/**
 * Build a fresh component-instance layer for a component. Mirrors the editor's
 * ElementLibrary "add component" flow: a plain block div carrying `componentId`
 * with empty children (the tree is expanded from the master at render time).
 *
 * @param component - The component to instantiate
 * @param options.variantId - Optional variant to select; ignored when it does not
 *   match one of the component's variants (render falls back to the first).
 * @param options.customName - Display name; defaults to the component name
 * @param options.id - Reuse an existing layer id (for in-place replacement);
 *   defaults to a freshly generated id
 */
export function buildComponentInstanceLayer(
  component: Component,
  options?: { variantId?: string; customName?: string; id?: string },
): Layer {
  const variantId = options?.variantId && component.variants?.some((v) => v.id === options.variantId)
    ? options.variantId
    : undefined;

  const layer: Layer = {
    id: options?.id ?? generateId('lyr'),
    name: 'div',
    customName: options?.customName ?? component.name,
    componentId: component.id,
    classes: ['block'], // Ensure it renders as a block element
    children: [], // Expanded from the master component at render time
  };

  if (variantId) {
    layer.componentVariantId = variantId;
  }

  return layer;
}

/**
 * Apply a component to a layer
 * Replaces the layer with a component instance (sets componentId)
 * Note: The actual layer tree is replaced during rendering, not here
 */
export function applyComponentToLayer(layer: Layer, component: Component): Layer {
  return {
    ...layer,
    componentId: component.id,
    componentOverrides: undefined, // Clear any previous overrides (reserved for future)
    // Keep the layer's own properties like id, customName, etc.
    // but when rendering, we'll use the component's layers
  };
}

// `getComponentVariantLayers` lives in `lib/component-variant-utils.ts` to
// avoid a circular import between this module and `lib/layer-utils.ts`.
export { getComponentVariantLayers } from './component-variant-utils';

/**
 * Detach component from a layer
 * Removes the component link but keeps the layer's own properties
 */
export function detachComponentFromLayer(layer: Layer): Layer {
  const { componentId, componentOverrides, ...rest } = layer;

  return {
    ...rest,
  } as Layer;
}

/**
 * Check if layer is a component instance
 */
export function isComponentInstance(layer: Layer): boolean {
  return !!layer.componentId;
}

/**
 * Returns true if the layer tree contains an instance of the given component.
 * Short-circuits on first match.
 */
export function containsComponent(layers: Layer[], componentId: string): boolean {
  for (const layer of layers) {
    if (layer.componentId === componentId) return true;
    if (layer.children && layer.children.length > 0) {
      if (containsComponent(layer.children, componentId)) return true;
    }
  }
  return false;
}

/**
 * Update all layers using a specific component
 * Recursively traverses layer tree and updates component instances
 * This is used when the master component is updated to sync all instances
 *
 * Preserves referential identity for subtrees that contain no matching instance,
 * so React reconciliation can skip untouched branches.
 */
export function updateLayersWithComponent(
  layers: Layer[],
  componentId: string,
): Layer[] {
  let changed = false;
  const result = layers.map(layer => {
    if (layer.componentId === componentId) {
      changed = true;
      return { ...layer };
    }

    if (layer.children && layer.children.length > 0) {
      const newChildren = updateLayersWithComponent(layer.children, componentId);
      if (newChildren !== layer.children) {
        changed = true;
        return { ...layer, children: newChildren };
      }
    }

    return layer;
  });

  return changed ? result : layers;
}

/**
 * Detach a component from all layers
 * Used when a component is deleted
 * Replaces component instances with the component's actual children layers (with new IDs)
 * @param layers - Layer tree to process
 * @param componentId - Component ID to detach
 * @param component - The component data (to get its children layers)
 * @returns Layer tree with component instances replaced by their content
 */
export function detachComponentFromLayers(
  layers: Layer[],
  componentId: string,
  component?: Component
): Layer[] {
  return layers.flatMap(layer => {
    // If this layer uses the component, replace it with the component's children
    if (layer.componentId === componentId) {
      return replaceLayerWithComponentChildren(layer, component);
    }

    // Recursively detach from children
    if (layer.children && layer.children.length > 0) {
      return [{
        ...layer,
        children: detachComponentFromLayers(layer.children, componentId, component),
      }];
    }

    return [layer];
  });
}

/**
 * Detach a specific layer instance from its component
 * Used in context menu "Detach from component" action
 * @param layers - Layer tree to process
 * @param layerId - Specific layer ID to detach
 * @param component - The component data (to get its children layers)
 * @returns Layer tree with the specific layer instance replaced by component's content
 */
export function detachSpecificLayerFromComponent(
  layers: Layer[],
  layerId: string,
  component?: Component
): Layer[] {
  return layers.flatMap(layer => {
    // If this is the specific layer to detach
    if (layer.id === layerId && layer.componentId) {
      return replaceLayerWithComponentChildren(layer, component);
    }

    // Recursively process children
    if (layer.children && layer.children.length > 0) {
      return [{
        ...layer,
        children: detachSpecificLayerFromComponent(layer.children, layerId, component),
      }];
    }

    return [layer];
  });
}

/**
 * Replace a layer with the component's children layers (with new IDs)
 * Shared logic for both detach operations
 * @param layer - The layer to replace
 * @param component - The component data (to get its children layers)
 * @returns Array of layers (component children with new IDs, or stripped layer)
 */
function replaceLayerWithComponentChildren(layer: Layer, component?: Component): Layer[] {
  // Use the layers of the variant the instance is actually using, falling back
  // to the primary variant (or legacy `component.layers`) when none is set.
  const variantLayers = component
    ? getComponentVariantLayers(component, layer.componentVariantId)
    : [];

  // If we don't have the component data, just strip the componentId
  if (!component || variantLayers.length === 0) {
    const { componentId: _, componentVariantId: __, componentOverrides: ___, ...rest } = layer;
    return [rest as Layer];
  }

  // Clone the variant's layers with new IDs and return them
  const cloned = JSON.parse(JSON.stringify(variantLayers)) as Layer[];
  return cloned.map(regenerateIdsWithInteractionRemapping);
}

/**
 * Count how many layers use a specific component
 * Useful for showing usage count in UI and delete confirmations
 */
export function countLayersUsingComponent(layers: Layer[], componentId: string): number {
  let count = 0;

  for (const layer of layers) {
    if (layer.componentId === componentId) {
      count++;
    }

    if (layer.children && layer.children.length > 0) {
      count += countLayersUsingComponent(layer.children, componentId);
    }
  }

  return count;
}

/**
 * Get all layer IDs using a specific component
 * Useful for UI highlights and bulk operations
 */
export function getLayerIdsUsingComponent(layers: Layer[], componentId: string): string[] {
  const ids: string[] = [];

  for (const layer of layers) {
    if (layer.componentId === componentId) {
      ids.push(layer.id);
    }

    if (layer.children && layer.children.length > 0) {
      ids.push(...getLayerIdsUsingComponent(layer.children, componentId));
    }
  }

  return ids;
}
