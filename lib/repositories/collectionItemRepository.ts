import { getSupabaseAdmin } from '@/lib/supabase-server';
import { SUPABASE_QUERY_LIMIT } from '@/lib/supabase-constants';
import type { CollectionItem, CollectionItemWithValues } from '@/types';
import { randomUUID } from 'crypto';
import { getFieldsByCollectionId } from '@/lib/repositories/collectionFieldRepository';
import { getValuesByFieldId, getValuesByItemIds } from '@/lib/repositories/collectionItemValueRepository';
import { castValue } from '../collection-utils';
import { findStatusFieldId, buildStatusValue } from '@/lib/collection-field-utils';

/**
 * Collection Item Repository
 *
 * Handles CRUD operations for collection items (EAV entities).
 * Items are the actual content entries in a collection.
 * Uses Supabase/PostgreSQL via admin client.
 *
 * NOTE: Uses composite primary key (id, is_published) architecture.
 * References parent collections using FK (collection_id).
 */

export interface QueryFilters {
  deleted?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
  itemIds?: string[]; // Filter to specific item IDs (for multi-reference pagination)
}

/**
 * Get top N items per collection for multiple collections in one query
 * Uses window function (ROW_NUMBER() OVER PARTITION BY) for efficient batch loading
 * @param collectionIds - Array of collection UUIDs
 * @param is_published - Filter for draft (false) or published (true) items. Defaults to false (draft).
 * @param limit - Number of items per collection. Defaults to 10.
 */
export async function getTopItemsPerCollection(
  collectionIds: string[],
  is_published: boolean = false,
  limit: number = 10
): Promise<CollectionItem[]> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  if (collectionIds.length === 0) {
    return [];
  }

  // Use raw SQL with window function to get top N items per collection
  const { data, error } = await client.rpc('get_top_items_per_collection', {
    p_collection_ids: collectionIds,
    p_is_published: is_published,
    p_limit: limit,
  });

  if (error) {
    // Fallback to manual approach if RPC doesn't exist yet
    let manualQuery = client
      .from('collection_items')
      .select('*')
      .in('collection_id', collectionIds)
      .eq('is_published', is_published)
      .is('deleted_at', null)
      .order('collection_id', { ascending: true })
      .order('manual_order', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(collectionIds.length * limit);

    // For published queries, only include publishable items
    if (is_published) {
      manualQuery = manualQuery.eq('is_publishable', true);
    }

    const { data: manualData, error: manualError } = await manualQuery;

    if (manualError) {
      throw new Error(`Failed to fetch items: ${manualError.message}`);
    }

    // Group by collection and take first N per collection
    const itemsByCollection: Record<string, CollectionItem[]> = {};
    manualData?.forEach(item => {
      if (!itemsByCollection[item.collection_id]) {
        itemsByCollection[item.collection_id] = [];
      }
      if (itemsByCollection[item.collection_id].length < limit) {
        itemsByCollection[item.collection_id].push(item);
      }
    });

    return Object.values(itemsByCollection).flat();
  }

  return data || [];
}

export interface CreateCollectionItemData {
  collection_id: string; // UUID
  manual_order?: number;
  is_published?: boolean;
  is_publishable?: boolean;
}

export interface UpdateCollectionItemData {
  manual_order?: number;
  is_publishable?: boolean;
}

/**
 * Get all items for a collection with pagination support
 * @param collection_id - Collection UUID
 * @param is_published - Filter for draft (false) or published (true) items. Defaults to false (draft).
 * @param filters - Optional query filters
 */
export async function getItemsByCollectionId(
  collection_id: string,
  is_published: boolean = false,
  filters?: QueryFilters
): Promise<{ items: CollectionItem[], total: number }> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  // If itemIds filter is provided, use those directly (for multi-reference fields)
  // If no items are linked, return early
  if (filters?.itemIds && filters.itemIds.length === 0) {
    return { items: [], total: 0 };
  }

  // If search is provided, find matching item IDs from values table
  let matchingItemIds: string[] | null = null;
  if (filters?.search && filters.search.trim()) {
    const searchTerm = `%${filters.search.trim()}%`;

    // Query collection_item_values for matching values (same published state)
    const { data: matchingValues, error: searchError } = await client
      .from('collection_item_values')
      .select('item_id')
      .ilike('value', searchTerm)
      .eq('is_published', is_published)
      .is('deleted_at', null);

    if (searchError) {
      throw new Error(`Failed to search items: ${searchError.message}`);
    }

    if (matchingValues) {
      // Get unique item IDs
      matchingItemIds = [...new Set(matchingValues.map(v => v.item_id))];

      // If no matches found, return early
      if (matchingItemIds.length === 0) {
        return { items: [], total: 0 };
      }
    }
  }

  // Combine itemIds filter with search results (intersection if both present)
  let filterIds: string[] | null = null;
  if (filters?.itemIds) {
    if (matchingItemIds !== null) {
      // Intersection: only IDs that are in both lists
      filterIds = filters.itemIds.filter(id => matchingItemIds!.includes(id));
      if (filterIds.length === 0) {
        return { items: [], total: 0 };
      }
    } else {
      filterIds = filters.itemIds;
    }
  } else if (matchingItemIds !== null) {
    filterIds = matchingItemIds;
  }

  // Build base query for counting
  let countQuery = client
    .from('collection_items')
    .select('*', { count: 'exact', head: true })
    .eq('collection_id', collection_id)
    .eq('is_published', is_published);

  // For published queries, only include publishable items
  if (is_published) {
    countQuery = countQuery.eq('is_publishable', true);
  }

  // Apply item ID filter to count query (from itemIds filter and/or search)
  if (filterIds !== null) {
    countQuery = countQuery.in('id', filterIds);
  }

  // Apply deleted filter to count query
  if (filters && 'deleted' in filters) {
    if (filters.deleted === false) {
      countQuery = countQuery.is('deleted_at', null);
    } else if (filters.deleted === true) {
      countQuery = countQuery.not('deleted_at', 'is', null);
    }
  } else {
    countQuery = countQuery.is('deleted_at', null);
  }

  // Execute count query
  const { count, error: countError } = await countQuery;

  if (countError) {
    throw new Error(`Failed to count collection items: ${countError.message}`);
  }

  // Build query for fetching items
  let query = client
    .from('collection_items')
    .select('*')
    .eq('collection_id', collection_id)
    .eq('is_published', is_published)
    .order('manual_order', { ascending: true })
    .order('created_at', { ascending: false });

  // For published queries, only include publishable items
  if (is_published) {
    query = query.eq('is_publishable', true);
  }

  // Apply item ID filter (from itemIds filter and/or search)
  if (filterIds !== null) {
    query = query.in('id', filterIds);
  }

  // Apply filters - only filter deleted_at when explicitly specified
  if (filters && 'deleted' in filters) {
    if (filters.deleted === false) {
      query = query.is('deleted_at', null);
    } else if (filters.deleted === true) {
      query = query.not('deleted_at', 'is', null);
    }
    // If deleted is explicitly undefined, include all items (no filter)
  } else {
    // No filters provided: default to excluding deleted items
    query = query.is('deleted_at', null);
  }

  // Apply pagination
  if (filters?.limit !== undefined) {
    query = query.limit(filters.limit);
  }
  if (filters?.offset !== undefined) {
    query = query.range(filters.offset, filters.offset + (filters.limit || 25) - 1);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch collection items: ${error.message}`);
  }

  return { items: data || [], total: count || 0 };
}

/**
 * Enrich draft items with computed status values for the Status field.
 * Injects `{ is_publishable, is_published, is_modified }` JSON into each item's
 * values map under the status field's ID, matching the old project's format.
 */
export async function enrichItemsWithStatus(
  items: CollectionItemWithValues[],
  collectionId: string,
  statusFieldId: string | null,
): Promise<void> {
  if (!statusFieldId || items.length === 0) return;

  const client = await getSupabaseAdmin();
  if (!client) throw new Error('Supabase client not configured');

  const itemIds = items.map(item => item.id);

  // Fetch published counterparts (id + content_hash) in one query
  const { data: publishedRows, error } = await client
    .from('collection_items')
    .select('id, content_hash')
    .in('id', itemIds)
    .eq('is_published', true)
    .is('deleted_at', null);

  if (error) throw new Error(`Failed to fetch published items for status: ${error.message}`);

  const publishedHashMap = new Map(
    (publishedRows || []).map(row => [row.id, row.content_hash])
  );

  for (const item of items) {
    const publishedHash = publishedHashMap.get(item.id);
    const hasPublishedVersion = publishedHash !== undefined;
    const isModified = hasPublishedVersion
      && item.content_hash != null
      && publishedHash != null
      && item.content_hash !== publishedHash;

    item.values[statusFieldId] = buildStatusValue(item.is_publishable, hasPublishedVersion, isModified);
  }
}

/**
 * Enrich a single item with computed status.
 * Fetches fields internally — use when the caller doesn't already have them.
 */
export async function enrichSingleItemWithStatus(
  item: CollectionItemWithValues,
  collectionId: string,
): Promise<void> {
  const fields = await getFieldsByCollectionId(collectionId, false);
  await enrichItemsWithStatus([item], collectionId, findStatusFieldId(fields));
}

/**
 * Get ALL items for a collection (with pagination to handle >1000 items)
 * Use this for publishing and other operations that need all items
 * @param includeDeleted - If true, only returns deleted items. If false/undefined, excludes deleted items.
 */
export async function getAllItemsByCollectionId(
  collection_id: string,
  is_published: boolean = false,
  includeDeleted: boolean = false
): Promise<CollectionItem[]> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  const allItems: CollectionItem[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let query = client
      .from('collection_items')
      .select('*')
      .eq('collection_id', collection_id)
      .eq('is_published', is_published)
      .order('manual_order', { ascending: true })
      .order('created_at', { ascending: false })
      .range(offset, offset + SUPABASE_QUERY_LIMIT - 1);

    // For published queries, only include publishable items
    if (is_published) {
      query = query.eq('is_publishable', true);
    }

    // Apply deleted filter
    if (includeDeleted) {
      query = query.not('deleted_at', 'is', null);
    } else {
      query = query.is('deleted_at', null);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch collection items: ${error.message}`);
    }

    if (data && data.length > 0) {
      allItems.push(...data);
      offset += data.length;
      hasMore = data.length === SUPABASE_QUERY_LIMIT;
    } else {
      hasMore = false;
    }
  }

  return allItems;
}

/**
 * Get item by ID
 * @param id - Item UUID
 * @param isPublished - Get draft (false) or published (true) version. Defaults to false (draft).
 */
export async function getItemById(id: string, isPublished: boolean = false): Promise<CollectionItem | null> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  const { data, error } = await client
    .from('collection_items')
    .select('*')
    .eq('id', id)
    .eq('is_published', isPublished)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to fetch collection item: ${error.message}`);
  }

  return data;
}

/**
 * Batch fetch items by IDs
 * @param ids - Array of item UUIDs
 * @param isPublished - Get draft (false) or published (true) items
 * @returns Array of items found
 */
export async function getItemsByIds(ids: string[], isPublished: boolean = false): Promise<CollectionItem[]> {
  if (ids.length === 0) {
    return [];
  }

  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  const { data, error } = await client
    .from('collection_items')
    .select('*')
    .in('id', ids)
    .eq('is_published', isPublished)
    .is('deleted_at', null);

  if (error) {
    throw new Error(`Failed to fetch collection items: ${error.message}`);
  }

  return data || [];
}

/**
 * Get item with all field values joined
 * Returns item with values as { field_id: value } object
 * @param id - Item UUID
 * @param is_published - Get draft (false) or published (true) values. Defaults to false (draft).
 */
export async function getItemWithValues(id: string, is_published: boolean = false): Promise<CollectionItemWithValues | null> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  // Get the item
  const item = await getItemById(id, is_published);
  if (!item) return null;

  // Build query for values with field type info
  let valuesQuery = client
    .from('collection_item_values')
    .select('value, field_id, collection_fields!inner(type)')
    .eq('item_id', id)
    .eq('is_published', is_published);

  // If the item itself is deleted, include deleted values (to show name in UI)
  // Otherwise, exclude deleted values
  if (!item.deleted_at) {
    valuesQuery = valuesQuery.is('deleted_at', null);
  }

  const { data: valuesData, error: valuesError } = await valuesQuery;

  if (valuesError) {
    throw new Error(`Failed to fetch item values: ${valuesError.message}`);
  }

  // Transform to { field_id: value } object, casting values by type
  const values: Record<string, any> = {};
  valuesData?.forEach((row: any) => {
    if (row.field_id) {
      const fieldType = row.collection_fields?.type;
      values[row.field_id] = castValue(row.value, fieldType || 'text');
    }
  });

  return {
    ...item,
    values,
  };
}

/**
 * Get multiple items with their values
 * @param collection_id - Collection UUID
 * @param is_published - Filter for draft (false) or published (true) items and values. Defaults to false (draft).
 * @param filters - Optional query filters
 */
export async function getItemsWithValues(
  collection_id: string,
  is_published: boolean = false,
  filters?: QueryFilters
): Promise<{ items: CollectionItemWithValues[], total: number }> {
  const { items, total } = await getItemsByCollectionId(collection_id, is_published, filters);

  if (items.length === 0) {
    return { items: [], total };
  }

  const itemIds = items.map(item => item.id);
  const valuesByItem = await getValuesByItemIds(itemIds, is_published);

  const itemsWithValues: CollectionItemWithValues[] = items.map(item => ({
    ...item,
    values: valuesByItem[item.id] || {},
  }));

  return { items: itemsWithValues, total };
}

/**
 * Get top N items with values for multiple collections in 2 queries
 * Uses optimized batch queries with PARTITION BY and WHERE IN.
 * Note: does NOT return accurate totals — callers should use collection.draft_items_count
 * or getItemsByCollectionId (which returns exact count) for accurate pagination.
 * @param collectionIds - Array of collection UUIDs
 * @param is_published - Filter for draft (false) or published (true). Defaults to false (draft).
 * @param limit - Number of items per collection. Defaults to 25.
 */
export async function getTopItemsWithValuesPerCollection(
  collectionIds: string[],
  is_published: boolean = false,
  limit: number = 25
): Promise<Record<string, { items: CollectionItemWithValues[] }>> {
  if (collectionIds.length === 0) {
    return {};
  }

  // Query 1: Get top N items per collection using window function
  const items = await getTopItemsPerCollection(collectionIds, is_published, limit);

  if (items.length === 0) {
    const result: Record<string, { items: CollectionItemWithValues[] }> = {};
    collectionIds.forEach(id => {
      result[id] = { items: [] };
    });
    return result;
  }

  // Query 2: Get all values for these items in one query
  const itemIds = items.map(item => item.id);
  const valuesByItem = await getValuesByItemIds(itemIds, is_published);

  // Combine items with their values
  const itemsWithValues: CollectionItemWithValues[] = items.map(item => ({
    ...item,
    values: valuesByItem[item.id] || {},
  }));

  // Group by collection_id
  const result: Record<string, { items: CollectionItemWithValues[] }> = {};

  collectionIds.forEach(id => {
    result[id] = { items: [] };
  });

  itemsWithValues.forEach(item => {
    if (!result[item.collection_id]) {
      result[item.collection_id] = { items: [] };
    }
    result[item.collection_id].items.push(item);
  });

  return result;
}

/**
 * Get the maximum ID value for the ID field in a collection
 * @param collection_id - Collection UUID
 * @param is_published - Filter for draft (false) or published (true) values. Defaults to false (draft).
 * @returns The maximum numeric ID value, or 0 if no IDs exist
 */
export async function getMaxIdValue(
  collection_id: string,
  is_published: boolean = false
): Promise<number> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  // Get all fields for the collection
  const fields = await getFieldsByCollectionId(collection_id, is_published);

  // Find the field with key = 'id'
  const idField = fields.find(field => field.key === 'id');

  if (!idField) {
    // No ID field exists, return 0
    return 0;
  }

  // Get all values for the ID field
  const idValues = await getValuesByFieldId(idField.id, is_published);

  if (idValues.length === 0) {
    return 0;
  }

  // Parse all ID values as numbers and find the maximum
  let maxId = 0;
  for (const value of idValues) {
    if (value.value) {
      const numericId = parseInt(value.value, 10);
      if (!isNaN(numericId) && numericId > maxId) {
        maxId = numericId;
      }
    }
  }

  return maxId;
}

/**
 * Bulk create items in a single INSERT
 * @param items - Array of items to create (id is auto-generated if not provided)
 */
export async function createItemsBulk(
  items: Array<CreateCollectionItemData & { id?: string }>
): Promise<CollectionItem[]> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  if (items.length === 0) return [];

  const now = new Date().toISOString();
  const itemsToInsert = items.map(item => ({
    id: item.id || randomUUID(),
    collection_id: item.collection_id,
    manual_order: item.manual_order ?? 0,
    is_published: item.is_published ?? false,
    is_publishable: item.is_publishable ?? true,
    created_at: now,
    updated_at: now,
  }));

  const { data, error } = await client
    .from('collection_items')
    .insert(itemsToInsert)
    .select();

  if (error) {
    throw new Error(`Failed to bulk create items: ${error.message}`);
  }

  return data || [];
}

/**
 * Create a new item
 */
export async function createItem(itemData: CreateCollectionItemData): Promise<CollectionItem> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  const id = randomUUID();
  const isPublished = itemData.is_published ?? false;

  const { data, error } = await client
    .from('collection_items')
    .insert({
      id,
      ...itemData,
      manual_order: itemData.manual_order ?? 0,
      is_published: isPublished,
      is_publishable: itemData.is_publishable ?? true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create collection item: ${error.message}`);
  }

  return data;
}

/**
 * Update an item
 * @param id - Item UUID
 * @param itemData - Data to update
 * @param isPublished - Which version to update: draft (false) or published (true). Defaults to false (draft).
 */
export async function updateItem(
  id: string,
  itemData: UpdateCollectionItemData,
  isPublished: boolean = false
): Promise<CollectionItem> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  const { data, error } = await client
    .from('collection_items')
    .update({
      ...itemData,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('is_published', isPublished)
    .is('deleted_at', null)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update collection item: ${error.message}`);
  }

  return data;
}

/**
 * Delete an item (soft delete)
 * Sets deleted_at timestamp to mark item as deleted in draft
 * Also soft deletes all associated draft collection_item_values
 * Only deletes the draft version by default.
 * @param id - Item UUID
 * @param isPublished - Which version to delete: draft (false) or published (true). Defaults to false (draft).
 */
export async function deleteItem(id: string, isPublished: boolean = false): Promise<void> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  const now = new Date().toISOString();

  // Soft delete the collection item
  const { error: itemError } = await client
    .from('collection_items')
    .update({
      deleted_at: now,
      updated_at: now,
    })
    .eq('id', id)
    .eq('is_published', isPublished)
    .is('deleted_at', null);

  if (itemError) {
    throw new Error(`Failed to delete collection item: ${itemError.message}`);
  }

  // Soft delete all collection_item_values for this item (same published state)
  const { error: valuesError } = await client
    .from('collection_item_values')
    .update({
      deleted_at: now,
      updated_at: now,
    })
    .eq('item_id', id)
    .eq('is_published', isPublished)
    .is('deleted_at', null);

  if (valuesError) {
    throw new Error(`Failed to delete collection item values: ${valuesError.message}`);
  }
}

/**
 * Hard delete an item
 * Permanently removes item and all associated collection_item_values via CASCADE
 * Used during publish to permanently remove soft-deleted items
 * @param id - Item UUID
 * @param isPublished - Which version to delete: draft (false) or published (true). Defaults to false (draft).
 */
export async function hardDeleteItem(id: string, isPublished: boolean = false): Promise<void> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  const { error } = await client
    .from('collection_items')
    .delete()
    .eq('id', id)
    .eq('is_published', isPublished);

  if (error) {
    throw new Error(`Failed to hard delete collection item: ${error.message}`);
  }
}

/**
 * Duplicate a collection item with its draft values
 * Creates a copy of the item with a new ID and modified values
 * @param itemId - UUID of the item to duplicate
 * @param isPublished - Whether to duplicate draft (false) or published (true) version. Defaults to false (draft).
 */
export async function duplicateItem(itemId: string, isPublished: boolean = false): Promise<CollectionItemWithValues> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  // Get the original item with its values
  const originalItem = await getItemWithValues(itemId, isPublished);
  if (!originalItem) {
    throw new Error('Item not found');
  }

  // Get collection fields to find field IDs by key
  const fields = await getFieldsByCollectionId(originalItem.collection_id, isPublished);
  const idField = fields.find(f => f.key === 'id');
  const nameField = fields.find(f => f.key === 'name');
  const slugField = fields.find(f => f.key === 'slug');
  const createdAtField = fields.find(f => f.key === 'created_at');
  const updatedAtField = fields.find(f => f.key === 'updated_at');

  // Get all items in the collection to find existing slugs
  const { items: allItems } = await getItemsWithValues(
    originalItem.collection_id,
    isPublished,
    undefined
  );

  // Prepare the new values (keyed by field_id)
  const newValues = { ...originalItem.values };

  // Auto-increment the ID field
  if (idField && newValues[idField.id]) {
    let highestId = 0;
    allItems.forEach(item => {
      const val = item.values[idField.id];
      if (val) {
        const num = parseInt(String(val), 10);
        if (!isNaN(num)) highestId = Math.max(highestId, num);
      }
    });
    newValues[idField.id] = String(highestId + 1);
  }

  // Update auto-generated timestamp fields
  const now = new Date().toISOString();
  if (createdAtField) newValues[createdAtField.id] = now;
  if (updatedAtField) newValues[updatedAtField.id] = now;

  // Add " (Copy)" to the name field
  if (nameField && newValues[nameField.id]) {
    newValues[nameField.id] = `${newValues[nameField.id]} (Copy)`;
  }

  // Generate unique slug (required for uniqueness)
  if (slugField) {
    const originalSlug = newValues[slugField.id] ? String(newValues[slugField.id]).trim() : '';
    const baseSlug = originalSlug || 'copy';
    const baseSlugClean = baseSlug.replace(/-\d+$/, '');

    const existingSlugs = new Set(
      allItems
        .map(item => item.values[slugField.id])
        .filter((s): s is string => !!s && typeof s === 'string')
    );

    let newSlug = `${baseSlugClean}-copy`;
    if (existingSlugs.has(newSlug)) {
      let n = 1;
      while (existingSlugs.has(`${baseSlugClean}-copy-${n}`)) n++;
      newSlug = `${baseSlugClean}-copy-${n}`;
    }
    newValues[slugField.id] = newSlug;
  }

  // Create the new item with a new UUID
  const newId = randomUUID();
  const { data: newItem, error: itemError } = await client
    .from('collection_items')
    .insert({
      id: newId,
      collection_id: originalItem.collection_id,
      manual_order: originalItem.manual_order,
      is_published: isPublished,
      is_publishable: originalItem.is_publishable,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (itemError) {
    throw new Error(`Failed to create duplicate item: ${itemError.message}`);
  }

  // Create set of valid field IDs (fields already fetched above)
  const validFieldIds = new Set(fields.map(f => f.id));

  // Create new values for the duplicated item
  const valuesToInsert = Object.entries(newValues)
    .filter(([fieldId]) => validFieldIds.has(fieldId)) // Only include fields that exist
    .map(([fieldId, value]) => ({
      id: randomUUID(),
      item_id: newItem.id,
      field_id: fieldId,
      value: value,
      is_published: isPublished,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

  if (valuesToInsert.length > 0) {
    const { error: valuesError } = await client
      .from('collection_item_values')
      .insert(valuesToInsert);

    if (valuesError) {
      // If values insertion fails, we should still return the item
      // but log the error
      console.error('Failed to duplicate values:', valuesError);
    }
  }

  // Return the new item with its values
  return {
    ...newItem,
    values: newValues,
  };
}

/**
 * Search items by field values
 * @param collection_id - Collection UUID
 * @param is_published - Filter for draft (false) or published (true) items and values. Defaults to false (draft).
 * @param query - Search query string
 */
export async function searchItems(
  collection_id: string,
  is_published: boolean = false,
  query: string
): Promise<{ items: CollectionItemWithValues[], total: number }> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  // Get all items for this collection
  const { items, total } = await getItemsByCollectionId(collection_id, is_published);
  if (!query || query.trim() === '') {
    // Return all items with values if no query
    return getItemsWithValues(collection_id, is_published, undefined);
  }

  // Search in item values
  const searchTerm = `%${query.toLowerCase()}%`;

  const { data: matchingValues, error } = await client
    .from('collection_item_values')
    .select('item_id')
    .ilike('value', searchTerm)
    .eq('is_published', is_published)
    .is('deleted_at', null);

  if (error) {
    throw new Error(`Failed to search items: ${error.message}`);
  }

  // Get unique item IDs
  const itemIds = [...new Set(matchingValues?.map(v => v.item_id) || [])];

  // Filter items and get with values
  const filteredItems = items.filter(item => itemIds.includes(item.id));

  const itemsWithValues = await Promise.all(
    filteredItems.map(item => getItemWithValues(item.id, is_published))
  ).then(results => results.filter((item): item is CollectionItemWithValues => item !== null));

  return { items: itemsWithValues, total: itemsWithValues.length };
}

/**
 * Publish an item
 * Creates or updates the published version by copying the draft
 * Uses upsert with composite primary key for simplicity
 * @param id - Item UUID
 */
export async function publishItem(id: string): Promise<CollectionItem> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  // Get the draft version
  const draft = await getItemById(id, false);
  if (!draft) {
    throw new Error('Draft item not found');
  }

  // Upsert published version (composite key handles insert/update automatically)
  const { data, error } = await client
    .from('collection_items')
    .upsert({
      id: draft.id, // Same UUID
      collection_id: draft.collection_id,
      manual_order: draft.manual_order,
      is_publishable: draft.is_publishable,
      is_published: true,
      created_at: draft.created_at,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'id,is_published', // Composite primary key
    }).select()
    .single();

  if (error) {
    throw new Error(`Failed to publish item: ${error.message}`);
  }

  return data;

}

/**
 * Get total count of collection items needing publishing across all collections.
 * Checks both metadata (manual_order) and value changes.
 */
export async function getTotalPublishableItemsCount(): Promise<number> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  const { data: collections, error: collectionsError } = await client
    .from('collections')
    .select('id')
    .eq('is_published', false)
    .is('deleted_at', null);

  if (collectionsError) {
    throw new Error(`Failed to fetch collections: ${collectionsError.message}`);
  }

  if (!collections || collections.length === 0) {
    return 0;
  }

  const collectionIds = collections.map(c => c.id);

  const [draftResult, publishedResult] = await Promise.all([
    client
      .from('collection_items')
      .select('id, manual_order')
      .in('collection_id', collectionIds)
      .eq('is_published', false)
      .eq('is_publishable', true)
      .is('deleted_at', null),
    client
      .from('collection_items')
      .select('id, manual_order')
      .in('collection_id', collectionIds)
      .eq('is_published', true),
  ]);

  if (draftResult.error) {
    throw new Error(`Failed to fetch draft items: ${draftResult.error.message}`);
  }

  const publishedMap = new Map<string, number>();
  for (const pub of publishedResult.data || []) {
    publishedMap.set(pub.id, pub.manual_order);
  }

  // Count items with metadata changes (new or order changed)
  let count = 0;
  const matchingOrderItemIds: string[] = [];

  for (const draft of draftResult.data || []) {
    const pubOrder = publishedMap.get(draft.id);
    if (pubOrder === undefined || draft.manual_order !== pubOrder) {
      count++;
    } else {
      matchingOrderItemIds.push(draft.id);
    }
  }

  // For items with matching metadata, check value changes in batches
  if (matchingOrderItemIds.length > 0) {
    count += await countItemsWithValueChanges(client, matchingOrderItemIds);
  }

  return count;
}

/**
 * Count items that have value-level changes between draft and published.
 * Processes in batches to stay within Supabase query limits.
 */
async function countItemsWithValueChanges(
  client: Exclude<Awaited<ReturnType<typeof getSupabaseAdmin>>, null>,
  itemIds: string[]
): Promise<number> {
  const BATCH_SIZE = 50;
  let changedCount = 0;

  for (let i = 0; i < itemIds.length; i += BATCH_SIZE) {
    const batchIds = itemIds.slice(i, i + BATCH_SIZE);

    const [draftValsResult, pubValsResult] = await Promise.all([
      client
        .from('collection_item_values')
        .select('item_id, field_id, value')
        .in('item_id', batchIds)
        .eq('is_published', false)
        .is('deleted_at', null)
        .limit(SUPABASE_QUERY_LIMIT),
      client
        .from('collection_item_values')
        .select('item_id, field_id, value')
        .in('item_id', batchIds)
        .eq('is_published', true)
        .is('deleted_at', null)
        .limit(SUPABASE_QUERY_LIMIT),
    ]);

    if (draftValsResult.error || pubValsResult.error) {
      continue; // Skip batch on error, don't break the count
    }

    // Build published values lookup: item_id -> (field_id -> value)
    const pubValsByItem = new Map<string, Map<string, string | null>>();
    for (const v of pubValsResult.data || []) {
      if (!pubValsByItem.has(v.item_id)) {
        pubValsByItem.set(v.item_id, new Map());
      }
      pubValsByItem.get(v.item_id)!.set(v.field_id, v.value);
    }

    // Build draft values grouped by item_id
    const draftValsByItem = new Map<string, Map<string, string | null>>();
    for (const v of draftValsResult.data || []) {
      if (!draftValsByItem.has(v.item_id)) {
        draftValsByItem.set(v.item_id, new Map());
      }
      draftValsByItem.get(v.item_id)!.set(v.field_id, v.value);
    }

    // Compare each item's values
    for (const itemId of batchIds) {
      const draftVals = draftValsByItem.get(itemId) || new Map();
      const pubVals = pubValsByItem.get(itemId) || new Map();

      if (draftVals.size !== pubVals.size) {
        changedCount++;
        continue;
      }

      let hasChange = false;
      for (const [fieldId, draftValue] of draftVals) {
        if (!pubVals.has(fieldId) || draftValue !== pubVals.get(fieldId)) {
          hasChange = true;
          break;
        }
      }

      if (hasChange) {
        changedCount++;
      }
    }
  }

  return changedCount;
}

/**
 * Unpublish a single item: deletes its published row and values (CASCADE).
 * Also sets is_publishable = false on the draft row.
 */
export async function unpublishSingleItem(itemId: string): Promise<void> {
  const client = await getSupabaseAdmin();
  if (!client) throw new Error('Supabase client not configured');

  // Delete published row (CASCADE deletes published values)
  await client
    .from('collection_items')
    .delete()
    .eq('id', itemId)
    .eq('is_published', true);

  // Set draft as not publishable
  await client
    .from('collection_items')
    .update({ is_publishable: false, updated_at: new Date().toISOString() })
    .eq('id', itemId)
    .eq('is_published', false);
}

/**
 * Stage a single item for publish: removes published version if it exists,
 * then sets is_publishable = true on the draft row.
 * @returns true if a published version was removed (caller should clear cache)
 */
export async function stageSingleItem(itemId: string): Promise<boolean> {
  const client = await getSupabaseAdmin();
  if (!client) throw new Error('Supabase client not configured');

  // Check if a published version exists
  const { data: published } = await client
    .from('collection_items')
    .select('id')
    .eq('id', itemId)
    .eq('is_published', true)
    .maybeSingle();

  const hadPublished = !!published;

  // Remove published version if it exists (CASCADE deletes published values)
  if (hadPublished) {
    await client
      .from('collection_items')
      .delete()
      .eq('id', itemId)
      .eq('is_published', true);
  }

  // Set draft as publishable
  await client
    .from('collection_items')
    .update({ is_publishable: true, updated_at: new Date().toISOString() })
    .eq('id', itemId)
    .eq('is_published', false);

  return hadPublished;
}

/**
 * Publish a single item immediately: upserts a published item row
 * and copies draft values to published. Sets is_publishable = true.
 */
export async function publishSingleItem(itemId: string): Promise<void> {
  const client = await getSupabaseAdmin();
  if (!client) throw new Error('Supabase client not configured');

  // Get draft item
  const { data: draftItem, error: draftErr } = await client
    .from('collection_items')
    .select('*')
    .eq('id', itemId)
    .eq('is_published', false)
    .is('deleted_at', null)
    .single();

  if (draftErr || !draftItem) {
    throw new Error('Draft item not found');
  }

  const now = new Date().toISOString();

  // Ensure draft is marked publishable
  if (!draftItem.is_publishable) {
    await client
      .from('collection_items')
      .update({ is_publishable: true, updated_at: now })
      .eq('id', itemId)
      .eq('is_published', false);
  }

  // Upsert published item row
  await client
    .from('collection_items')
    .upsert({
      id: draftItem.id,
      collection_id: draftItem.collection_id,
      manual_order: draftItem.manual_order,
      is_publishable: true,
      is_published: true,
      content_hash: draftItem.content_hash,
      created_at: draftItem.created_at,
      updated_at: now,
    }, { onConflict: 'id,is_published' });

  // Copy draft values to published via existing publishValues utility
  const { publishValues } = await import('@/lib/repositories/collectionItemValueRepository');
  await publishValues(itemId);
}
