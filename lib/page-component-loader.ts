import { collectReferencedComponentIds } from '@/lib/component-utils';
import { getComponentsByIds } from '@/lib/repositories/componentRepository';
import { isValidUUID } from '@/lib/utils';
import type { Component } from '@/types';

interface ComponentLoadContext {
  isPublished: boolean;
  tenantId?: string;
  byId: Map<string, Component>;
  /** Component IDs referenced by each loaded component */
  references: Map<string, Set<string>>;
  requested: Set<string>;
  inFlight: Map<string, Promise<void>>;
}

const componentLoadContexts = new WeakMap<Component[], ComponentLoadContext>();

/**
 * Create an empty component list that `ensureReferencedComponents` fills with
 * only the components a render references, instead of loading every component.
 */
export function createOnDemandComponentList(isPublished: boolean, tenantId?: string): Component[] {
  const components: Component[] = [];
  componentLoadContexts.set(components, {
    isPublished,
    tenantId,
    byId: new Map(),
    references: new Map(),
    requested: new Set(),
    inFlight: new Map(),
  });
  return components;
}

/**
 * Load the components referenced by `source` (and the components those embed)
 * into a list created by `createOnDemandComponentList`, in place.
 * No-op for any other list, which callers already hold in full.
 */
export async function ensureReferencedComponents(components: Component[], source: unknown): Promise<void> {
  const context = componentLoadContexts.get(components);
  if (!context) return;

  const seen = new Set<string>();
  let pending = collectReferencedComponentIds(source);

  while (pending.size > 0) {
    const toFetch: string[] = [];
    const waits: Promise<void>[] = [];
    for (const id of pending) {
      seen.add(id);
      if (!context.requested.has(id)) {
        if (isValidUUID(id)) toFetch.push(id);
        context.requested.add(id);
      } else {
        const inFlight = context.inFlight.get(id);
        if (inFlight) waits.push(inFlight);
      }
    }

    if (toFetch.length > 0) {
      const load = fetchIntoList(components, context, toFetch);
      for (const id of toFetch) context.inFlight.set(id, load);
      waits.push(load);
    }
    await Promise.all(waits);

    const next = new Set<string>();
    for (const id of pending) {
      for (const ref of context.references.get(id) ?? []) {
        if (!seen.has(ref)) next.add(ref);
      }
    }
    pending = next;
  }
}

async function fetchIntoList(components: Component[], context: ComponentLoadContext, ids: string[]): Promise<void> {
  try {
    const fetched = await getComponentsByIds(ids, context.isPublished, context.tenantId);
    for (const component of Object.values(fetched)) {
      if (context.byId.has(component.id)) continue;
      context.byId.set(component.id, component);
      context.references.set(
        component.id,
        collectReferencedComponentIds([component.layers, component.variants, component.variables]),
      );
      components.push(component);
    }
  } catch (error) {
    console.error('Failed to load components:', error);
  } finally {
    for (const id of ids) context.inFlight.delete(id);
  }
}
