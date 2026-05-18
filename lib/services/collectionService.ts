/**
 * Collection Publishing Service
 *
 * Dedicated service for publishing collections using composite key architecture.
 * Provides transactional publishing with rollback capability.
 *
 * Key Features:
 * - Collections & Fields: Always published completely
 * - Items: Selective publishing (user can choose specific items)
 * - Values: Published automatically with their items
 * - Transactional: All-or-nothing approach with error handling
 */

import { withTransaction } from '../database/transaction';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { getCollectionById, hardDeleteCollection } from '@/lib/repositories/collectionRepository';
import { getFieldsByCollectionId } from '@/lib/repositories/collectionFieldRepository';
import { getItemsByCollectionId, getAllItemsByCollectionId, getItemById, getItemsByIds } from '@/lib/repositories/collectionItemRepository';
import { getValuesByItemId } from '@/lib/repositories/collectionItemValueRepository';

/**
 * Options for publishing a collection
 */
export interface PublishCollectionOptions {
  collectionId: string;
  itemIds?: string[]; // Optional: specific items to publish. If omitted, publish all
}

/**
 * Timing stats for an operation
 */
export interface OperationTiming {
  durationMs: number;
  count: number;
}

/**
 * Result of a collection publishing operation
 */
export interface PublishCollectionResult {
  success: boolean;
  collectionId: string;
  published: {
    collection: boolean;
    fieldsCount: number;
    itemsCount: number;
    valuesCount: number;
    deletedItemsCount: number;
    deletedItemSlugs: string[];
    renamedItemOldSlugs: string[];
  };
  timing?: {
    collections: OperationTiming;
    fields: OperationTiming;
    items: OperationTiming;
    values: OperationTiming;
  };
  errors?: string[];
}

/**
 * Batch publishing options
 */
export interface BatchPublishOptions {
  publishes: PublishCollectionOptions[];
}

/**
 * Batch publishing result
 */
export interface BatchPublishResult {
  results: PublishCollectionResult[];
  summary: {
    total: number;
    succeeded: number;
    failed: number;
  };
}

/**
 * Main entry point: Publish a single collection with optional item selection
 *
 * @param options - Publishing options
 * @returns Publishing result with counts and status
 *
 * @example
 * // Publish entire collection (all items)
 * const result = await publishCollection({ collectionId: 'abc-123' });
 *
 * // Publish collection with specific items only
 * const result = await publishCollection({
 *   collectionId: 'abc-123',
 *   itemIds: ['item-1', 'item-2', 'item-3']
 * });
 */
export async function publishCollectionWithItems(
  options: PublishCollectionOptions
): Promise<PublishCollectionResult> {
  const { collectionId, itemIds } = options;

  const result: PublishCollectionResult = {
    success: false,
    collectionId,
    published: {
      collection: false,
      fieldsCount: 0,
      itemsCount: 0,
      valuesCount: 0,
      deletedItemsCount: 0,
      deletedItemSlugs: [],
      renamedItemOldSlugs: [],
    },
    timing: {
      collections: { durationMs: 0, count: 0 },
      fields: { durationMs: 0, count: 0 },
      items: { durationMs: 0, count: 0 },
      values: { durationMs: 0, count: 0 },
    },
    errors: [],
  };

  try {
    // Check if the draft collection is soft-deleted (include deleted collections in query)
    const draftCollection = await getCollectionById(collectionId, false, true);

    // If draft is deleted, clean up both draft and published versions
    if (draftCollection && draftCollection.deleted_at) {
      await cleanupDeletedCollection(collectionId);
      result.success = true;
      return result;
    }

    // Validate the request
    await validatePublishRequest(collectionId, itemIds);

    // Execute publishing within transaction context
    await withTransaction(async () => {
      // Step 1: Publish collection metadata (skips if unchanged)
      const collectionStart = performance.now();
      const collectionChanged = await publishCollectionMetadata(collectionId);
      result.published.collection = collectionChanged;
      result.timing!.collections = {
        durationMs: Math.round(performance.now() - collectionStart),
        count: collectionChanged ? 1 : 0,
      };

      // Step 2: Publish all fields
      const fieldsStart = performance.now();
      const fieldsCount = await publishAllFields(collectionId);
      result.published.fieldsCount = fieldsCount;
      result.timing!.fields = {
        durationMs: Math.round(performance.now() - fieldsStart),
        count: fieldsCount,
      };

      // Step 3: Publish selected items
      const itemsStart = performance.now();
      const { itemsCount, valuesCount, itemsDurationMs, valuesDurationMs, renamedItemOldSlugs } = await publishSelectedItems(
        collectionId,
        itemIds
      );
      result.published.itemsCount = itemsCount;
      result.published.valuesCount = valuesCount;
      result.published.renamedItemOldSlugs = renamedItemOldSlugs;
      result.timing!.items = {
        durationMs: itemsDurationMs,
        count: itemsCount,
      };
      result.timing!.values = {
        durationMs: valuesDurationMs,
        count: valuesCount,
      };

      // Step 4: Clean up soft-deleted items in published version
      const cleanup = await cleanupDeletedPublishedItems(collectionId);
      result.published.deletedItemsCount = cleanup.deletedCount;
      result.published.deletedItemSlugs = cleanup.deletedSlugs;
      await cleanupDeletedPublishedFields(collectionId);
    });

    result.success = true;
  } catch (error) {
    result.success = false;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    result.errors = [errorMessage];
  }

  return result;
}

/**
 * Batch publish multiple collections
 *
 * @param options - Batch publishing options
 * @returns Batch result with summary
 *
 * @example
 * const result = await publishCollections({
 *   publishes: [
 *     { collectionId: 'abc-123' }, // All items
 *     { collectionId: 'def-456', itemIds: ['item-x'] } // Specific item
 *   ]
 * });
 */
export async function publishCollections(
  options: BatchPublishOptions
): Promise<BatchPublishResult> {
  const results: PublishCollectionResult[] = [];

  // Publish each collection sequentially to avoid conflicts
  for (const publishOptions of options.publishes) {
    const result = await publishCollectionWithItems(publishOptions);
    results.push(result);
  }

  // Calculate summary
  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  return {
    results,
    summary: {
      total: results.length,
      succeeded,
      failed,
    },
  };
}

/**
 * Validate publishing request
 * Ensures collection exists and item IDs are valid
 */
async function validatePublishRequest(
  collectionId: string,
  itemIds?: string[]
): Promise<void> {
  // Check if draft collection exists
  const draftCollection = await getCollectionById(collectionId, false);
  if (!draftCollection) {
    throw new Error(`Draft collection ${collectionId} not found`);
  }

  // If specific item IDs provided, validate they exist (batch fetch)
  if (itemIds && itemIds.length > 0) {
    const items = await getItemsByIds(itemIds, false);
    const foundIds = new Set(items.map(item => item.id));

    for (const itemId of itemIds) {
      if (!foundIds.has(itemId)) {
        throw new Error(`Draft item ${itemId} not found`);
      }
    }

    // Validate all items belong to the collection
    for (const item of items) {
      if (item.collection_id !== collectionId) {
        throw new Error(`Item ${item.id} does not belong to collection ${collectionId}`);
      }
    }
  }
}

/**
 * Publish collection metadata, skipping if unchanged
 * @returns true if collection was actually upserted
 */
async function publishCollectionMetadata(collectionId: string): Promise<boolean> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  // Get the draft version
  const draft = await getCollectionById(collectionId, false);
  if (!draft) {
    throw new Error('Draft collection not found');
  }

  // Get existing published version for comparison
  const published = await getCollectionById(collectionId, true);

  // Skip if published version exists and all fields match
  if (published &&
    published.name === draft.name &&
    JSON.stringify(published.sorting) === JSON.stringify(draft.sorting) &&
    published.order === draft.order) {
    return false;
  }

  // Upsert published version (composite key handles insert/update automatically)
  const { error } = await client
    .from('collections')
    .upsert({
      id: draft.id,
      name: draft.name,
      sorting: draft.sorting,
      order: draft.order,
      is_published: true,
      created_at: draft.created_at,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'id,is_published',
    });

  if (error) {
    throw new Error(`Failed to publish collection: ${error.message}`);
  }

  return true;
}

/**
 * Publish all fields for a collection, skipping unchanged fields
 * Uses batch upsert for efficiency
 *
 * @returns Number of fields actually published
 */
async function publishAllFields(collectionId: string): Promise<number> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  // Get all draft fields
  const draftFields = await getFieldsByCollectionId(collectionId, false);

  if (draftFields.length === 0) {
    return 0;
  }

  // Get published fields for comparison
  const publishedFields = await getFieldsByCollectionId(collectionId, true);
  const publishedById = new Map(publishedFields.map(f => [f.id, f]));

  // Only upsert fields that are new or changed
  const now = new Date().toISOString();
  const fieldsToUpsert: any[] = [];

  for (const field of draftFields) {
    const existing = publishedById.get(field.id);

    // Skip if published version exists and is identical
    if (
      existing &&
      existing.name === field.name &&
      existing.key === field.key &&
      existing.type === field.type &&
      existing.default === field.default &&
      existing.fillable === field.fillable &&
      existing.order === field.order &&
      existing.reference_collection_id === field.reference_collection_id &&
      existing.hidden === field.hidden &&
      existing.is_computed === field.is_computed &&
      JSON.stringify(existing.data) === JSON.stringify(field.data)
    ) {
      continue;
    }

    fieldsToUpsert.push({
      id: field.id,
      name: field.name,
      key: field.key,
      type: field.type,
      default: field.default,
      fillable: field.fillable,
      order: field.order,
      collection_id: field.collection_id,
      reference_collection_id: field.reference_collection_id,
      hidden: field.hidden,
      is_computed: field.is_computed,
      data: field.data,
      is_published: true,
      created_at: field.created_at,
      updated_at: now,
    });
  }

  if (fieldsToUpsert.length === 0) {
    return 0;
  }

  // Batch upsert changed fields
  const { error } = await client
    .from('collection_fields')
    .upsert(fieldsToUpsert, {
      onConflict: 'id,is_published', // Composite primary key
    });

  if (error) {
    throw new Error(`Failed to publish fields: ${error.message}`);
  }

  return fieldsToUpsert.length;
}

/**
 * Publish selected items and their values
 * Uses batch upsert for efficiency
 *
 * @param collectionId - Collection UUID
 * @param itemIds - Optional array of item IDs to publish. If omitted, publishes all items that need publishing
 * @returns Counts and timing of published items and values
 */
async function publishSelectedItems(
  collectionId: string,
  itemIds?: string[]
): Promise<{ itemsCount: number; valuesCount: number; itemsDurationMs: number; valuesDurationMs: number; renamedItemOldSlugs: string[] }> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  let itemsToPublish: string[];

  if (itemIds && itemIds.length > 0) {
    // Publish specific items
    itemsToPublish = itemIds;
  } else {
    // Publish all items that need publishing
    itemsToPublish = await getUnpublishedItemIds(collectionId);
  }

  if (itemsToPublish.length === 0) {
    return { itemsCount: 0, valuesCount: 0, itemsDurationMs: 0, valuesDurationMs: 0, renamedItemOldSlugs: [] };
  }

  // Batch fetch all draft items to publish
  const draftItems = await getItemsByIds(itemsToPublish, false);

  if (draftItems.length === 0) {
    return { itemsCount: 0, valuesCount: 0, itemsDurationMs: 0, valuesDurationMs: 0, renamedItemOldSlugs: [] };
  }

  // Separate publishable from non-publishable items
  const publishableItems = draftItems.filter(item => item.is_publishable);
  const nonPublishableItems = draftItems.filter(item => !item.is_publishable);

  // Remove published versions of non-publishable items
  if (nonPublishableItems.length > 0) {
    const nonPublishableIds = nonPublishableItems.map(item => item.id);
    await client
      .from('collection_items')
      .delete()
      .in('id', nonPublishableIds)
      .eq('is_published', true);
  }

  if (publishableItems.length === 0) {
    return { itemsCount: 0, valuesCount: 0, itemsDurationMs: 0, valuesDurationMs: 0, renamedItemOldSlugs: [] };
  }

  // Fetch existing published items for comparison
  const publishableIds = publishableItems.map(i => i.id);
  const publishedItems = await getItemsByIds(publishableIds, true);
  const publishedItemsById = new Map(publishedItems.map(i => [i.id, i]));

  // Time items upsert
  const itemsStart = performance.now();

  // Only upsert items that are new or changed
  const now = new Date().toISOString();
  const itemsToUpsert: any[] = [];
  const itemIdsToPublishValues: string[] = [];

  for (const item of publishableItems) {
    const existing = publishedItemsById.get(item.id);

    // Only compare content_hash when both sides have a value — null draft
    // hashes (pre-backfill items) would otherwise always appear "changed."
    // Value-level comparison in publishItemValuesBatch catches real changes.
    const hashChanged = item.content_hash != null
      && existing?.content_hash != null
      && existing.content_hash !== item.content_hash;

    const metadataChanged = !existing
      || existing.manual_order !== item.manual_order
      || existing.is_publishable !== item.is_publishable
      || hashChanged;

    if (!metadataChanged) {
      itemIdsToPublishValues.push(item.id);
      continue;
    }

    itemsToUpsert.push({
      id: item.id,
      collection_id: item.collection_id,
      manual_order: item.manual_order,
      is_publishable: item.is_publishable,
      is_published: true,
      content_hash: item.content_hash,
      created_at: item.created_at,
      updated_at: now,
    });
    itemIdsToPublishValues.push(item.id);
  }

  // Batch upsert changed items only
  if (itemsToUpsert.length > 0) {
    const { error: itemsError } = await client
      .from('collection_items')
      .upsert(itemsToUpsert, {
        onConflict: 'id,is_published', // Composite primary key
      });

    if (itemsError) {
      throw new Error(`Failed to publish items: ${itemsError.message}`);
    }
  }

  const itemsDurationMs = Math.round(performance.now() - itemsStart);

  // Snapshot old published slug values before overwriting (for rename detection)
  const renamedItemOldSlugs: string[] = [];
  try {
    const { data: slugField } = await client
      .from('collection_fields')
      .select('id')
      .eq('collection_id', collectionId)
      .eq('key', 'slug')
      .is('deleted_at', null)
      .limit(1)
      .single();

    if (slugField) {
      const { data: oldPublishedSlugs } = await client
        .from('collection_item_values')
        .select('item_id, value')
        .eq('field_id', slugField.id)
        .eq('is_published', true)
        .is('deleted_at', null)
        .in('item_id', itemIdsToPublishValues);

      const { data: draftSlugs } = await client
        .from('collection_item_values')
        .select('item_id, value')
        .eq('field_id', slugField.id)
        .eq('is_published', false)
        .is('deleted_at', null)
        .in('item_id', itemIdsToPublishValues);

      if (oldPublishedSlugs && draftSlugs) {
        const oldByItem = new Map(oldPublishedSlugs.map(s => [s.item_id, s.value as string]));
        const newByItem = new Map(draftSlugs.map(s => [s.item_id, s.value as string]));

        for (const [itemId, oldSlug] of oldByItem) {
          const newSlug = newByItem.get(itemId);
          if (oldSlug && newSlug && oldSlug !== newSlug) {
            renamedItemOldSlugs.push(oldSlug);
          }
        }
      }
    }
  } catch {
    // Non-fatal: slug rename detection failure doesn't block publish
  }

  // Time values publishing (pass all item IDs - values comparison happens inside)
  const valuesStart = performance.now();
  const valuesCount = await publishItemValuesBatch(itemIdsToPublishValues);
  const valuesDurationMs = Math.round(performance.now() - valuesStart);

  return { itemsCount: itemsToUpsert.length, valuesCount, itemsDurationMs, valuesDurationMs, renamedItemOldSlugs };
}

/**
 * Publish values for multiple items in batch, skipping unchanged values
 * Compares draft vs published by (id, field_id, value) before upserting
 *
 * @param itemIds - Array of item UUIDs
 * @returns Number of values actually published (changed)
 */
async function publishItemValuesBatch(itemIds: string[]): Promise<number> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  if (itemIds.length === 0) {
    return 0;
  }

  // Batch fetch all draft values
  const allDraftValues = await Promise.all(
    itemIds.map(itemId => getValuesByItemId(itemId, false))
  );
  const draftValues = allDraftValues.flat();

  if (draftValues.length === 0) {
    return 0;
  }

  // Batch fetch all published values for comparison
  const allPublishedValues = await Promise.all(
    itemIds.map(itemId => getValuesByItemId(itemId, true))
  );
  const publishedById = new Map(
    allPublishedValues.flat().map(v => [v.id, v.value])
  );

  // 1. Identify and delete orphaned values on the published side
  // These are values that exist in published but NOT in draft for the items we are publishing
  const draftValueIds = new Set(draftValues.map(v => v.id));
  const orphanedValueIds = allPublishedValues.flat()
    .filter(v => !draftValueIds.has(v.id))
    .map(v => v.id);

  if (orphanedValueIds.length > 0) {
    const { error: deleteError } = await client
      .from('collection_item_values')
      .delete()
      .in('id', orphanedValueIds)
      .eq('is_published', true);

    if (deleteError) {
      console.error('Failed to cleanup orphaned published values:', deleteError.message);
    }
  }

  // 2. Only upsert values that are new or changed
  const now = new Date().toISOString();
  const valuesToUpsert: Array<{
    id: string;
    item_id: string;
    field_id: string;
    value: string | null;
    is_published: boolean;
    created_at: string;
    updated_at: string;
  }> = [];

  for (const value of draftValues) {
    // Skip if published version exists with identical value
    if (publishedById.has(value.id) && publishedById.get(value.id) === value.value) {
      continue;
    }

    valuesToUpsert.push({
      id: value.id,
      item_id: value.item_id,
      field_id: value.field_id,
      value: value.value,
      is_published: true,
      created_at: value.created_at,
      updated_at: now,
    });
  }

  if (valuesToUpsert.length === 0) {
    return 0;
  }

  // Batch upsert changed values only
  const { error } = await client
    .from('collection_item_values')
    .upsert(valuesToUpsert, {
      onConflict: 'id,is_published',
    });

  if (error) {
    throw new Error(`Failed to publish item values: ${error.message}`);
  }

  return valuesToUpsert.length;
}

/**
 * Get list of item IDs that need publishing
 * An item needs publishing if:
 * - Published version doesn't exist, OR
 * - Draft data differs from published data
 */
async function getUnpublishedItemIds(collectionId: string): Promise<string[]> {
  // Get all draft items for this collection (with pagination for >1000 items)
  const draftItems = await getAllItemsByCollectionId(collectionId, false);

  const unpublishedItemIds: string[] = [];

  for (const draftItem of draftItems) {
    // Check if published version exists
    const publishedItem = await getItemById(draftItem.id, true);

    if (!publishedItem) {
      // Never published
      unpublishedItemIds.push(draftItem.id);
      continue;
    }

    // Check if draft differs from published (metadata)
    const metadataChanged =
      draftItem.manual_order !== publishedItem.manual_order;

    if (metadataChanged) {
      unpublishedItemIds.push(draftItem.id);
      continue;
    }

    // Check if values differ
    const valuesChanged = await hasValueChanges(draftItem.id);
    if (valuesChanged) {
      unpublishedItemIds.push(draftItem.id);
    }
  }

  return unpublishedItemIds;
}

/**
 * Check if draft values differ from published values
 */
async function hasValueChanges(itemId: string): Promise<boolean> {
  const draftValues = await getValuesByItemId(itemId, false);
  const publishedValues = await getValuesByItemId(itemId, true);

  // Create maps for comparison
  const draftMap = new Map(draftValues.map(v => [v.field_id, v.value]));
  const publishedMap = new Map(publishedValues.map(v => [v.field_id, v.value]));

  // Check if number of fields differs
  if (draftMap.size !== publishedMap.size) {
    return true;
  }

  // Check if any draft value differs from published
  for (const [fieldId, draftValue] of draftMap) {
    const publishedValue = publishedMap.get(fieldId);

    // Field doesn't exist in published or value differs
    if (publishedValue === undefined || draftValue !== publishedValue) {
      return true;
    }
  }

  return false;
}

/**
 * Clean up soft-deleted items in both draft and published versions.
 * Snapshots published slug values before deletion so the caller can
 * invalidate stale cached dynamic-page URLs.
 *
 * @returns Number of deleted items and their former published slug values
 */
async function cleanupDeletedPublishedItems(
  collectionId: string,
): Promise<{ deletedCount: number; deletedSlugs: string[] }> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  const deletedDraftItems = await getAllItemsByCollectionId(
    collectionId,
    false,
    true // Only deleted items
  );

  if (deletedDraftItems.length === 0) {
    return { deletedCount: 0, deletedSlugs: [] };
  }

  const deletedItemIds = deletedDraftItems.map(item => item.id);

  // Snapshot published slug values before deletion (for cache invalidation)
  let deletedSlugs: string[] = [];
  try {
    const { data: slugField } = await client
      .from('collection_fields')
      .select('id')
      .eq('collection_id', collectionId)
      .eq('key', 'slug')
      .is('deleted_at', null)
      .limit(1)
      .single();

    if (slugField) {
      const allSlugValues: Array<{ value: unknown }> = [];
      for (let i = 0; i < deletedItemIds.length; i += 500) {
        const batch = deletedItemIds.slice(i, i + 500);
        const { data } = await client
          .from('collection_item_values')
          .select('value')
          .eq('field_id', slugField.id)
          .eq('is_published', true)
          .is('deleted_at', null)
          .in('item_id', batch);
        if (data) allSlugValues.push(...data);
      }

      deletedSlugs = allSlugValues
        .map(sv => sv.value as string)
        .filter(Boolean);
    }
  } catch {
    // Non-fatal: proceed with deletion even if slug snapshot fails
  }

  // Batch hard delete published versions (CASCADE will delete values)
  for (let i = 0; i < deletedItemIds.length; i += 500) {
    const batch = deletedItemIds.slice(i, i + 500);
    await client
      .from('collection_items')
      .delete()
      .in('id', batch)
      .eq('is_published', true);
  }

  // Batch hard delete draft versions (CASCADE will delete values)
  for (let i = 0; i < deletedItemIds.length; i += 500) {
    const batch = deletedItemIds.slice(i, i + 500);
    await client
      .from('collection_items')
      .delete()
      .in('id', batch)
      .eq('is_published', false);
  }

  return { deletedCount: deletedItemIds.length, deletedSlugs };
}

/**
 * Clean up soft-deleted fields in both draft and published versions
 * Uses batch DELETE for efficiency
 * If a draft field is soft-deleted, permanently remove both draft and published versions
 * This also removes all associated collection_item_values via CASCADE
 */
async function cleanupDeletedPublishedFields(collectionId: string): Promise<void> {
  // Get all fields (including soft-deleted) from draft by querying directly
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  // Query for soft-deleted draft fields
  const { data: deletedDraftFields, error } = await client
    .from('collection_fields')
    .select('*')
    .eq('collection_id', collectionId)
    .eq('is_published', false)
    .not('deleted_at', 'is', null); // Only get deleted fields

  if (error || !deletedDraftFields || deletedDraftFields.length === 0) {
    return;
  }

  // Extract field IDs
  const deletedFieldIds = deletedDraftFields.map(field => field.id);

  // Batch hard delete published versions (CASCADE will delete values)
  await client
    .from('collection_fields')
    .delete()
    .in('id', deletedFieldIds)
    .eq('is_published', true);

  // Batch hard delete draft versions (CASCADE will delete values)
  await client
    .from('collection_fields')
    .delete()
    .in('id', deletedFieldIds)
    .eq('is_published', false);
}

/**
 * Clean up a soft-deleted collection and all its related data
 * Hard deletes both draft and published versions of the collection
 * CASCADE constraints will automatically delete all related fields, items, and values
 */
async function cleanupDeletedCollection(collectionId: string): Promise<void> {
  // Check if published version exists
  const publishedCollection = await getCollectionById(collectionId, true);

  if (publishedCollection) {
    // Hard delete the published version (CASCADE will delete all related data)
    await hardDeleteCollection(collectionId, true);
  }

  // Hard delete the draft version (CASCADE will delete all related data)
  await hardDeleteCollection(collectionId, false);
}

/**
 * Clean up all soft-deleted collections
 * Uses batch DELETE operations for efficiency
 * Called during publish operations to ensure deleted collections are permanently removed
 */
export async function cleanupDeletedCollections(): Promise<void> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  // Find all soft-deleted draft collections
  const { data: deletedCollections, error } = await client
    .from('collections')
    .select('id')
    .eq('is_published', false)
    .not('deleted_at', 'is', null);

  if (error) {
    throw new Error(`Failed to fetch deleted collections: ${error.message}`);
  }

  if (!deletedCollections || deletedCollections.length === 0) {
    return;
  }

  // Extract collection IDs
  const collectionIds = deletedCollections.map(c => c.id);

  // Batch delete published versions (CASCADE deletes all related data: fields, items, values)
  await client
    .from('collections')
    .delete()
    .in('id', collectionIds)
    .eq('is_published', true);

  // Batch delete draft versions (CASCADE deletes all related data: fields, items, values)
  await client
    .from('collections')
    .delete()
    .in('id', collectionIds)
    .eq('is_published', false);
}

/**
 * Get count of items needing publishing for a collection
 * Useful for UI indicators
 */
export async function getPublishableCount(collectionId: string): Promise<number> {
  const unpublishedItemIds = await getUnpublishedItemIds(collectionId);
  return unpublishedItemIds.length;
}

/**
 * Get counts of items needing publishing for multiple collections
 *
 * @param collectionIds - Array of collection UUIDs
 * @returns Map of collection ID to unpublished item count
 */
export async function getPublishableCounts(
  collectionIds: string[]
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};

  for (const collectionId of collectionIds) {
    try {
      counts[collectionId] = await getPublishableCount(collectionId);
    } catch {
      counts[collectionId] = 0;
    }
  }

  return counts;
}

/**
 * Check if a collection needs publishing
 * A collection needs publishing if:
 * - Published version doesn't exist, OR
 * - Collection metadata differs, OR
 * - Any fields differ, OR
 * - Any items need publishing
 */
export async function needsPublishing(collectionId: string): Promise<boolean> {
  // Check if published version exists
  const published = await getCollectionById(collectionId, true);
  if (!published) {
    return true;
  }

  // Check if collection metadata differs
  const draft = await getCollectionById(collectionId, false);
  if (!draft) {
    return false; // No draft, nothing to publish
  }

  const collectionChanged =
    draft.name !== published.name ||
    JSON.stringify(draft.sorting) !== JSON.stringify(published.sorting) ||
    draft.order !== published.order;

  if (collectionChanged) {
    return true;
  }

  // Check if any fields need publishing
  const draftFields = await getFieldsByCollectionId(collectionId, false);
  const publishedFields = await getFieldsByCollectionId(collectionId, true);

  if (draftFields.length !== publishedFields.length) {
    return true;
  }

  // Check if any items need publishing
  const unpublishedCount = await getPublishableCount(collectionId);
  if (unpublishedCount > 0) {
    return true;
  }

  return false;
}

/**
 * Group collection item IDs by their collection ID
 * Queries the database to find which collection each item belongs to
 *
 * @param itemIds - Array of collection item IDs
 * @returns Map of collection ID to array of item IDs
 */
export async function groupItemsByCollection(
  itemIds: string[]
): Promise<Map<string, string[]>> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  if (itemIds.length === 0) {
    return new Map();
  }

  const { data: items, error } = await client
    .from('collection_items')
    .select('id, collection_id')
    .eq('is_published', false)
    .in('id', itemIds);

  if (error) {
    throw new Error(`Failed to fetch collection items: ${error.message}`);
  }

  if (!items) {
    return new Map();
  }

  // Group items by collection
  const itemsByCollection = new Map<string, string[]>();

  items.forEach((item: any) => {
    const existing = itemsByCollection.get(item.collection_id) || [];
    existing.push(item.id);
    itemsByCollection.set(item.collection_id, existing);
  });

  return itemsByCollection;
}
