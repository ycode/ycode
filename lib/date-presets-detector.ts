import { isDatePreset } from '@/lib/collection-field-utils';
import { getComponentVariantLayers } from '@/lib/component-variant-utils';
import type {
  Component,
  ConditionalVisibility,
  Layer,
  VisibilityCondition,
} from '@/types';

/**
 * Detects whether a layer tree uses time-dependent date presets (`$today`,
 * `$this_week`, etc.) anywhere in its conditional visibility rules or
 * collection filters. Used at publish time to flag pages whose rendered
 * output rolls over each day so the cron can invalidate just those.
 */

function conditionHasDatePreset(condition: VisibilityCondition): boolean {
  return isDatePreset(condition.value) || isDatePreset(condition.value2);
}

function visibilityHasDatePreset(visibility: ConditionalVisibility | undefined): boolean {
  if (!visibility?.groups) return false;
  for (const group of visibility.groups) {
    if (!group.conditions) continue;
    for (const condition of group.conditions) {
      if (conditionHasDatePreset(condition)) return true;
    }
  }
  return false;
}

/**
 * Walks a single layer and its descendants (including the layer trees of any
 * referenced components, all variants) looking for a date preset reference.
 * `visitedComponents` prevents infinite loops on circular component refs.
 */
function layerHasDatePresets(
  layer: Layer,
  componentsById: Map<string, Component>,
  visitedComponents: Set<string>,
): boolean {
  if (visibilityHasDatePreset(layer.variables?.conditionalVisibility)) return true;
  if (visibilityHasDatePreset(layer.variables?.collection?.filters)) return true;

  if (layer.componentId && !visitedComponents.has(layer.componentId)) {
    visitedComponents.add(layer.componentId);
    const component = componentsById.get(layer.componentId);
    if (component) {
      // Walk every variant — any variant carrying a preset means the page
      // could render it depending on which variant ends up selected.
      const variants = component.variants && component.variants.length > 0
        ? component.variants
        : [{ id: 'default', name: 'Default', layers: component.layers }];
      for (const variant of variants) {
        const variantLayers = getComponentVariantLayers(component, variant.id);
        for (const variantLayer of variantLayers) {
          if (layerHasDatePresets(variantLayer, componentsById, visitedComponents)) {
            return true;
          }
        }
      }
    }
  }

  if (layer.children) {
    for (const child of layer.children) {
      if (layerHasDatePresets(child, componentsById, visitedComponents)) return true;
    }
  }

  return false;
}

/**
 * Returns true when any layer in the tree (or any referenced component
 * variant) uses a date preset in conditional visibility or collection filters.
 */
export function pageHasDatePresets(
  layers: Layer[],
  componentsById: Map<string, Component>,
): boolean {
  const visited = new Set<string>();
  for (const layer of layers) {
    if (layerHasDatePresets(layer, componentsById, visited)) return true;
  }
  return false;
}
