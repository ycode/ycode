/**
 * Shared CMS field-binding logic for the single `bind_layer_field` tool and the
 * `bind_field` batch operation: resolves which collection a layer binds to and
 * produces the layer variables that render the field.
 */

import type { CollectionField, Layer } from '@/types';
import { getFieldsByCollectionId } from '@/lib/repositories/collectionFieldRepository';
import { getAllGlobalVariables } from '@/lib/repositories/globalVariableRepository';
import { getPageById } from '@/lib/repositories/pageRepository';
import { applyFieldBinding, buildFieldData, fieldNotFoundError } from '@/lib/mcp/field-binding-core';
import type { BindingSource, BindingTarget } from '@/lib/mcp/field-binding-core';
import { GLOBALS_COLLECTION_ID, globalToPseudoField } from '@/lib/collection-field-utils';
import { findParentCollectionLayer } from '@/lib/layer-utils';

export * from '@/lib/mcp/field-binding-core';

/**
 * Resolve the collection a binding should pull from: the nearest ancestor
 * Collection List (source "collection"), the dynamic page's own collection
 * (source "page"), or the site-wide globals (source "global", any layer).
 * Returns the collection id plus, for the collection source, the ancestor list
 * layer id stamped onto the FieldVariable.
 */
export async function resolveBindingContext(
  layers: Layer[],
  layerId: string,
  pageId: string,
  source: BindingSource,
): Promise<{ collectionId: string; collectionLayerId?: string } | { error: string }> {
  if (source === 'global') {
    return { collectionId: GLOBALS_COLLECTION_ID };
  }

  if (source === 'collection') {
    const parent = findParentCollectionLayer(layers, layerId);
    if (!parent) {
      return { error: 'Layer is not inside a Collection List. Place it inside a bound "collection" element, or use source "page".' };
    }
    const collectionId = parent.variables?.collection?.id;
    if (!collectionId) {
      return { error: 'The ancestor Collection List is not bound yet. Call bind_collection_layer first.' };
    }
    return { collectionId, collectionLayerId: parent.id };
  }

  const page = await getPageById(pageId);
  const collectionId = page?.settings?.cms?.collection_id;
  if (!collectionId) {
    return { error: 'This page is not a dynamic CMS page. Bind it to a collection (update_page_settings.cms) or use source "collection".' };
  }
  return { collectionId };
}

export interface FieldBindingInput {
  field_id: string;
  source: BindingSource;
  target: BindingTarget;
  format?: string;
  prefix?: string;
  suffix?: string;
}

/** Per-call cache so a batch binding many layers fetches each collection's fields once. */
export type FieldCache = Map<string, Promise<CollectionField[]>>;

/** Fields of a collection, or the global variables as pseudo fields for GLOBALS_COLLECTION_ID. */
function getBindableFields(collectionId: string): Promise<CollectionField[]> {
  if (collectionId === GLOBALS_COLLECTION_ID) {
    return getAllGlobalVariables().then((globals) => globals.map(globalToPseudoField));
  }
  return getFieldsByCollectionId(collectionId);
}

export function getFieldsCached(collectionId: string, cache?: FieldCache): Promise<CollectionField[]> {
  if (!cache) return getBindableFields(collectionId);
  let pending = cache.get(collectionId);
  if (!pending) {
    pending = getBindableFields(collectionId);
    cache.set(collectionId, pending);
  }
  return pending;
}

/**
 * Resolve the field and compute the bound layer. Returns the updated layer and a
 * short summary, or an error describing why the layer cannot take the binding.
 */
export async function bindLayerToField(
  layers: Layer[],
  layer: Layer,
  pageId: string,
  input: FieldBindingInput,
  cache?: FieldCache,
): Promise<{ layer: Layer; summary: string; field: CollectionField } | { error: string }> {
  const ctx = await resolveBindingContext(layers, layer.id, pageId, input.source);
  if ('error' in ctx) return ctx;

  const fields = await getFieldsCached(ctx.collectionId, cache);
  const field = fields.find((f) => f.id === input.field_id);
  if (!field) {
    return { error: fieldNotFoundError(input.field_id, input.source) };
  }

  const fieldData = buildFieldData(field, input.source, ctx.collectionLayerId, input.format);
  return applyFieldBinding(layer, field, fieldData, input);
}
