/**
 * Repository-backed context for the instance override builder in
 * `instance-overrides-core.ts`.
 */

import type { Layer } from '@/types';
import { getFieldsCached, resolveBindingContext } from '@/lib/mcp/field-binding';
import type { FieldCache } from '@/lib/mcp/field-binding';
import type { OverrideContext } from '@/lib/mcp/instance-overrides-core';
import { getCachedLayers } from '@/lib/mcp/page-layers';
import { getPageById } from '@/lib/repositories/pageRepository';

export * from '@/lib/mcp/instance-overrides-core';

/** Context for overriding the instance `instanceLayerId` on `pageId`; caches fields per collection. */
export function createOverrideContext(layers: Layer[], pageId: string, instanceLayerId: string): OverrideContext {
  const fieldCache: FieldCache = new Map();
  return {
    layers,
    pageId,
    instanceLayerId,
    resolveBinding: async (source) => {
      const binding = await resolveBindingContext(layers, instanceLayerId, pageId, source);
      if ('error' in binding) return binding;
      const fields = await getFieldsCached(binding.collectionId, fieldCache);
      return { collectionLayerId: binding.collectionLayerId, fields };
    },
    getPage: (id) => getPageById(id),
    getPageLayers: (id) => getCachedLayers(id),
  };
}
