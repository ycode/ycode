/**
 * Component variant utilities.
 *
 * Kept in a small, dependency-free module so it can be imported from both
 * `lib/layer-utils.ts` and `lib/component-utils.ts` without creating a
 * circular import.
 */

import type { Component, Layer } from '@/types';

/**
 * Resolve the layer tree for a specific variant of a component.
 *
 * Falls back to the first variant when `variantId` is undefined or points at a
 * variant that no longer exists (e.g. it was deleted while instances were still
 * referencing it). Falls back to the legacy `component.layers` field for
 * components persisted before the variants migration.
 */
export function getComponentVariantLayers(
  component: Component,
  variantId?: string,
): Layer[] {
  const variants = component.variants;
  if (variants && variants.length > 0) {
    const match = variantId ? variants.find(v => v.id === variantId) : undefined;
    return (match ?? variants[0]).layers ?? [];
  }
  return component.layers ?? [];
}

/**
 * Display name for a component being edited, e.g. "Hero / Dark".
 * The variant is only included when the component has more than one.
 */
export function getComponentVariantLabel(component: Component, variantId?: string | null): string {
  const variants = component.variants ?? [];
  if (variants.length < 2) return component.name;
  const variant = variants.find(v => v.id === variantId) ?? variants[0];
  return `${component.name} / ${variant.name}`;
}

/**
 * Option for a variant-variable selector. `componentName` is included so
 * selectors can disambiguate the same variant name across different target
 * components when a generic Variant variable is linked from instances of more
 * than one nested component.
 */
export interface VariantVariableOption {
  variant_id: string;
  variant_name: string;
  component_id: string;
  component_name: string;
}

/**
 * Collect every (target component, variant) pair reachable through any layer
 * inside `parentComponent` whose `componentVariantVariableId` points at
 * `variableId`. Used by both the variables dialog (to pick a default variant)
 * and the override panel (to choose an override) to populate Selects.
 *
 * Walks every variant tree of the parent component, not just the primary one,
 * so a variant variable that is only linked from layers inside e.g. "Variant 2"
 * still surfaces options.
 */
export function collectVariantVariableOptions(
  parentComponent: Component | undefined,
  allComponents: Component[],
  variableId: string,
): VariantVariableOption[] {
  if (!parentComponent || !variableId) return [];

  const seenPairs = new Set<string>();
  const options: VariantVariableOption[] = [];

  const walk = (layers: Layer[]) => {
    for (const layer of layers) {
      if (
        layer.componentVariantVariableId === variableId
        && layer.componentId
      ) {
        const target = allComponents.find(c => c.id === layer.componentId);
        if (target?.variants && target.variants.length > 0) {
          for (const v of target.variants) {
            const key = `${target.id}::${v.id}`;
            if (seenPairs.has(key)) continue;
            seenPairs.add(key);
            options.push({
              variant_id: v.id,
              variant_name: v.name,
              component_id: target.id,
              component_name: target.name,
            });
          }
        }
      }
      if (layer.children?.length) walk(layer.children);
    }
  };

  const variantsToWalk = parentComponent.variants && parentComponent.variants.length > 0
    ? parentComponent.variants
    : [{ id: 'legacy', name: 'Default', layers: parentComponent.layers ?? [] }];

  for (const v of variantsToWalk) {
    if (Array.isArray(v.layers)) walk(v.layers);
  }

  return options;
}
