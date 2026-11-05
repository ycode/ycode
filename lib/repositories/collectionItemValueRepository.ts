import { getSupabaseAdmin, getTenantIdFromHeaders } from '@/lib/supabase-server';
import { SUPABASE_QUERY_LIMIT } from '@/lib/supabase-constants';
import { getKnexClient } from '@/lib/knex-client';
import type { CollectionItemValue, CollectionFieldType } from '@/types';
import { isValidUUID } from '@/lib/utils';
import { castValue, valueToString, slugify, hasCollectionValueChanges } from '../collection-utils';
import { generateCollectionItemContentHash } from '../hash-utils';
import { randomUUID } from 'crypto';
import { deleteTranslationsInBulk, markTranslationsIncomplete } from '@/lib/repositories/translationRepository';

/**
 * Collection Item Value Repository
 *
 * Handles CRUD operations for collection item values (EAV values).
 * Each value represents one field value for one item.
 * Uses Supabase/PostgreSQL via admin client.
 *
 * NOTE: Uses composite primary key (id, is_published) architecture.
 * References items using FK (item_id).
 * References fields using FK (field_id).
 */

/**
 * Update the content_hash on a collection_items row.
 * Skips rows whose hash already matches so a no-op save leaves `updated_at` alone.
 */
async function updateContentHash(itemId: string, isPublished: boolean, hash: string): Promise<void> {
  const client = await getSupabaseAdmin();
  if (!client) throw new Error('Supabase client not configured');

  const { error } = await client
    .from('collection_items')
    .update({ content_hash: hash, updated_at: new Date().toISOString() })
    .eq('id', itemId)
    .eq('is_published', isPublished)
    .or(`content_hash.is.null,content_hash.neq.${hash}`);

  if (error) throw new Error(`Failed to update content_hash: ${error.message}`);
}

export interface CreateCollectionItemValueData {
  value: string | null;
  item_id: string; // UUID
  field_id: string; // UUID
  is_published?: boolean;
}

/**
 * Bulk insert values in a single query (for new items only, skips existence check)
 * @param values - Array of value records to insert
 */
export async function insertValuesBulk(
  values: Array<{ item_id: string; field_id: string; value: string | null; is_published?: boolean }>
): Promise<void> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  if (values.length === 0) return;

  // Hoist inline base64 rich-text images to the asset manager so importers never
  // persist multi-MB data URIs inline (safe no-op for non-rich-text values).
  // Dynamically imported to keep the upload deps (sharp/file-upload) out of the
  // read/render module graph that also pulls in this repository.
  const { uploadInlineRichTextImagesInRows } = await import('@/lib/rich-text-image-upload');
  await uploadInlineRichTextImagesInRows(values);

  const now = new Date().toISOString();
  const valuesToInsert = values.map(v => ({
    id: randomUUID(),
    item_id: v.item_id,
    field_id: v.field_id,
    value: v.value,
    is_published: v.is_published ?? false,
    created_at: now,
    updated_at: now,
  }));

  const { error } = await client
    .from('collection_item_values')
    .insert(valuesToInsert);

  if (error) {
    throw new Error(`Failed to bulk insert values: ${error.message}`);
  }
}

/**
 * Insert values via Knex (direct PG connection) with an extended timeout.
 * Used for oversized values that exceed PostgREST's statement timeout.
 * Sets tenant context when available so DB triggers can populate tenant_id.
 */
export async function insertValuesDirectPg(
  values: Array<{ item_id: string; field_id: string; value: string | null; is_published?: boolean }>
): Promise<void> {
  if (values.length === 0) return;

  // Hoist inline base64 rich-text images before the direct-PG insert (this path
  // handles oversized values — exactly where multi-MB base64 blobs land).
  const { uploadInlineRichTextImagesInRows } = await import('@/lib/rich-text-image-upload');
  await uploadInlineRichTextImagesInRows(values);

  const knex = await getKnexClient();
  const tenantId = await getTenantIdFromHeaders();
  const now = new Date().toISOString();
  const rows = values.map(v => ({
    id: randomUUID(),
    item_id: v.item_id,
    field_id: v.field_id,
    value: v.value,
    is_published: v.is_published ?? false,
    created_at: now,
    updated_at: now,
  }));

  await knex.transaction(async (trx) => {
    await trx.raw("SET LOCAL statement_timeout = '60s'");
    if (tenantId) {
      await trx.raw('SELECT set_tenant_context(?::uuid)', [tenantId]);
    }
    await trx('collection_item_values').insert(rows);
  });
}

export interface UpdateCollectionItemValueData {
  value?: string | null;
}

/**
 * Set once the database reports that `get_collection_item_values` does not
 * exist (migration not run yet), so later calls skip the wasted round-trip
 * and go straight to the direct-DB path. Reset on process restart.
 */
let itemValuesRpcUnavailable = false;

/**
 * Read item values through the `get_collection_item_values` SQL function.
 * Returns null when the RPC cannot be used (function missing, PostgREST
 * error), so the caller can fall back to the direct-DB path.
 */
async function fetchValueRowsViaRpc(
  client: NonNullable<Awaited<ReturnType<typeof getSupabaseAdmin>>>,
  itemIds: string[],
  isPublished: boolean,
  fieldIds?: string[],
): Promise<Array<{ item_id: string; field_id: string; value: string | null }> | null> {
  if (itemValuesRpcUnavailable) return null;

  const { data, error } = await client.rpc('get_collection_item_values', {
    p_item_ids: itemIds,
    p_is_published: isPublished,
    p_field_ids: fieldIds ?? null,
  });

  if (error) {
    // PGRST202: function not found in the schema cache; 42883: undefined function
    if (error.code === 'PGRST202' || error.code === '42883') {
      itemValuesRpcUnavailable = true;
    } else {
      console.warn('[getValuesByItemIds] RPC failed, falling back to direct query:', error.message);
    }
    return null;
  }

  const rows: Array<{ item_id: string; field_id: string; value: string | null }> = [];
  const byItem = (data ?? {}) as Record<string, Record<string, string | null>>;
  for (const itemId of Object.keys(byItem)) {
    const fields = byItem[itemId];
    for (const fieldId of Object.keys(fields)) {
      rows.push({ item_id: itemId, field_id: fieldId, value: fields[fieldId] });
    }
  }
  return rows;
}

/**
 * Get all values for multiple items in one query (batch operation)
 * @param item_ids - Array of item UUIDs
 * @param is_published - Filter for draft (false) or published (true) values. Defaults to false (draft).
 * @param knownFieldTypes - Optional pre-loaded field-id → type map to skip the extra lookup
 * @param fieldIds - Optional whitelist of field IDs to fetch
 */
export async function getValuesByItemIds(
  item_ids: string[],
  is_published: boolean = false,
  knownFieldTypes?: Record<string, string>,
  fieldIds?: string[],
): Promise<Record<string, Record<string, any>>> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  // Guard against non-UUID ids (e.g. dangling legacy bindings from imported
  // content). Passing them to a uuid column throws and would otherwise take
  // down the whole page render.
  const safeItemIds = item_ids.filter(isValidUUID);
  const safeFieldIds = fieldIds?.filter(isValidUUID);

  if (safeItemIds.length === 0 || (safeFieldIds && safeFieldIds.length === 0)) {
    return {};
  }

  const valuesByItem: Record<string, Record<string, any>> = {};
  let allRows: Array<{ item_id: string; field_id: string; value: string | null }> = [];

  // Preferred path: one RPC returning `{ item_id: { field_id: value } }`.
  // PostgREST gzips the response (~7x smaller than the uncompressed Postgres
  // wire protocol the Knex path uses), a scalar return has no row cap, and
  // the ids travel in the POST body so there is no URL-length chunking.
  const rpcRows = await fetchValueRowsViaRpc(client, safeItemIds, is_published, safeFieldIds);
  if (rpcRows) {
    allRows = rpcRows;
  } else {
    // Direct DB query (Knex) for large EAV reads when the function is not
    // installed yet. Avoids PostgREST overhead and URL-size chunking.
    try {
      const knex = await getKnexClient();
      let query = knex('collection_item_values')
        .select('item_id', 'field_id', 'value')
        .whereIn('item_id', safeItemIds)
        .andWhere('is_published', is_published)
        .whereNull('deleted_at');
      if (safeFieldIds) {
        query = query.whereIn('field_id', safeFieldIds);
      }
      allRows = await query;
    } catch {
      // Fallback: Supabase chunked reads
      const CHUNK_SIZE = 50;
      const chunks: string[][] = [];
      for (let i = 0; i < safeItemIds.length; i += CHUNK_SIZE) {
        chunks.push(safeItemIds.slice(i, i + CHUNK_SIZE));
      }

      const chunkResults = await Promise.all(
        chunks.map(async (chunk) => {
          let q = client
            .from('collection_item_values')
            .select('item_id, field_id, value')
            .in('item_id', chunk)
            .eq('is_published', is_published)
            .is('deleted_at', null);
          if (safeFieldIds) {
            q = q.in('field_id', safeFieldIds);
          }
          const { data, error } = await q.limit(5000);

          if (error) {
            throw new Error(`Failed to fetch item values: ${error.message}`);
          }

          return data || [];
        })
      );

      for (const rows of chunkResults) {
        for (const row of rows) {
          allRows.push(row);
        }
      }
    }
  }

  // Collect unique field IDs (only needed if caller didn't provide types)
  const discoveredFieldIds = new Set<string>();
  if (!knownFieldTypes) {
    for (const row of allRows) {
      discoveredFieldIds.add(row.field_id);
    }
  }

  // Use caller-provided field types, or fetch them in a single query
  let fieldTypeMap = knownFieldTypes;
  if (!fieldTypeMap) {
    fieldTypeMap = {};
    if (discoveredFieldIds.size > 0) {
      const { data: fields } = await client
        .from('collection_fields')
        .select('id, type')
        .in('id', Array.from(discoveredFieldIds));

      fields?.forEach((f: any) => { fieldTypeMap![f.id] = f.type; });
    }
  }

  for (const row of allRows) {
    if (!valuesByItem[row.item_id]) {
      valuesByItem[row.item_id] = {};
    }
    valuesByItem[row.item_id][row.field_id] = castValue(row.value, (fieldTypeMap[row.field_id] || 'text') as any);
  }

  return valuesByItem;
}

/** Raw value row needed when publishing/diffing item values. */
export interface PublishValueRow {
  id: string;
  item_id: string;
  field_id: string;
  value: string | null;
  created_at: string;
}

/**
 * Bulk-fetch full value rows for many items in a single direct-DB (Knex) query.
 * Avoids PostgREST's row cap and URL-size chunking, which forced per-batch
 * paginated reads during publish. Falls back to chunked PostgREST on error.
 */
export async function getValueRowsForItems(
  itemIds: string[],
  isPublished: boolean,
  tenantId?: string,
): Promise<PublishValueRow[]> {
  if (itemIds.length === 0) return [];

  try {
    const knex = await getKnexClient();
    const resolvedTenantId = tenantId ?? await getTenantIdFromHeaders();
    let query = knex('collection_item_values')
      .select('id', 'item_id', 'field_id', 'value', 'created_at')
      .whereIn('item_id', itemIds)
      .andWhere('is_published', isPublished)
      .whereNull('deleted_at');
    if (resolvedTenantId) {
      query = query.where('tenant_id', resolvedTenantId);
    }
    return await query;
  } catch {
    // Fallback: paginated PostgREST reads (chunk item IDs to stay within URL limits)
    const client = await getSupabaseAdmin(tenantId);
    if (!client) throw new Error('Supabase client not configured');

    const ITEM_CHUNK = 50;
    const PAGE_SIZE = 1000;
    const rows: PublishValueRow[] = [];

    for (let i = 0; i < itemIds.length; i += ITEM_CHUNK) {
      const chunkIds = itemIds.slice(i, i + ITEM_CHUNK);
      let offset = 0;
      while (true) {
        const { data, error } = await client
          .from('collection_item_values')
          .select('id, item_id, field_id, value, created_at')
          .in('item_id', chunkIds)
          .eq('is_published', isPublished)
          .is('deleted_at', null)
          .order('id', { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);

        if (error) throw new Error(`Failed to fetch item values: ${error.message}`);

        const batch = (data || []) as PublishValueRow[];
        rows.push(...batch);
        if (batch.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }
    }

    return rows;
  }
}

/**
 * Load all values for the given field IDs with pagination.
 * Returns Map<fieldId, Map<itemId, value>> — much lighter than loading all
 * fields when only a few are needed (e.g. resolving airtable_id lookups).
 */
export async function getValueMapByFieldIds(
  fieldIds: string[]
): Promise<Map<string, Map<string, string>>> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  const result = new Map<string, Map<string, string>>();
  if (fieldIds.length === 0) return result;

  for (const fid of fieldIds) {
    result.set(fid, new Map());
  }

  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await client
      .from('collection_item_values')
      .select('item_id, field_id, value')
      .in('field_id', fieldIds)
      .eq('is_published', false)
      .is('deleted_at', null)
      .range(offset, offset + SUPABASE_QUERY_LIMIT - 1);

    if (error) {
      throw new Error(`Failed to fetch field values: ${error.message}`);
    }

    if (data && data.length > 0) {
      data.forEach((row: { item_id: string; field_id: string; value: string | null }) => {
        if (row.value) {
          result.get(row.field_id)!.set(row.item_id, row.value);
        }
      });
      offset += data.length;
      hasMore = data.length === SUPABASE_QUERY_LIMIT;
    } else {
      hasMore = false;
    }
  }

  return result;
}

/**
 * Get all values for an item
 * @param item_id - Item UUID
 * @param is_published - Filter for draft (false) or published (true) values. Defaults to false (draft).
 */
export async function getValuesByItemId(
  item_id: string,
  is_published: boolean = false
): Promise<CollectionItemValue[]> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  const { data, error } = await client
    .from('collection_item_values')
    .select('*')
    .eq('item_id', item_id)
    .eq('is_published', is_published)
    .is('deleted_at', null);

  if (error) {
    throw new Error(`Failed to fetch item values: ${error.message}`);
  }

  return data || [];
}

/**
 * Get all values for a field
 * @param field_id - Field UUID
 * @param is_published - Filter for draft (false) or published (true) values. Defaults to false (draft).
 */
export async function getValuesByFieldId(
  field_id: string,
  is_published: boolean = false
): Promise<CollectionItemValue[]> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  const { data, error } = await client
    .from('collection_item_values')
    .select('*')
    .eq('field_id', field_id)
    .eq('is_published', is_published)
    .is('deleted_at', null);

  if (error) {
    throw new Error(`Failed to fetch field values: ${error.message}`);
  }

  return data || [];
}

/**
 * Get a specific value
 * @param item_id - Item UUID
 * @param field_id - Field UUID
 * @param is_published - Draft (false) or published (true) value. Defaults to false (draft).
 */
export async function getValue(
  item_id: string,
  field_id: string,
  is_published: boolean = false
): Promise<CollectionItemValue | null> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  const { data, error } = await client
    .from('collection_item_values')
    .select('*')
    .eq('item_id', item_id)
    .eq('field_id', field_id)
    .eq('is_published', is_published)
    .is('deleted_at', null)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to fetch value: ${error.message}`);
  }

  return data;
}

/**
 * Set a value (upsert)
 * @param item_id - Item UUID
 * @param field_id - Field UUID
 * @param value - Value to set
 * @param is_published - Draft (false) or published (true) value. Defaults to false (draft).
 */
export async function setValue(
  item_id: string,
  field_id: string,
  value: string | null,
  is_published: boolean = false
): Promise<CollectionItemValue> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  // Check if value already exists for this specific version (draft or published)
  const existing = await getValue(item_id, field_id, is_published);
  if (existing) {
    // Update existing value
    const { data, error } = await client
      .from('collection_item_values')
      .update({
        value,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .eq('is_published', is_published)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update value: ${error.message}`);
    }

    return data;
  } else {
    // Create new value
    const { data, error } = await client
      .from('collection_item_values')
      .insert({
        id: randomUUID(),
        item_id,
        field_id,
        value,
        is_published,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create value: ${error.message}`);
    }

    return data;
  }
}

/**
 * Set multiple values for an item (batch upsert)
 * @param item_id - Item UUID
 * @param values - Object mapping field_id (UUID) to value string
 * @param is_published - Draft (false) or published (true) values. Defaults to false (draft).
 */
export async function setValues(
  item_id: string,
  values: Record<string, string | null>,
  is_published: boolean = false
): Promise<CollectionItemValue[]> {
  const results: CollectionItemValue[] = [];

  // Process each value
  for (const [field_id, value] of Object.entries(values)) {
    const result = await setValue(item_id, field_id, value, is_published);
    results.push(result);
  }

  return results;
}

/**
 * Set multiple values by field ID
 * Convenience method that validates field IDs and applies type casting
 * @param item_id - Item UUID
 * @param collection_id - Collection UUID
 * @param values - Object mapping field_id (UUID) to value
 * @param fieldType - Field type mapping (for casting)
 * @param is_published - Draft (false) or published (true) values. Defaults to false (draft).
 *                       Fields are fetched with the same is_published status.
 */
export async function setValuesByFieldName(
  item_id: string,
  collection_id: string,
  values: Record<string, any>,
  fieldType: Record<string, CollectionFieldType>,
  is_published: boolean = false
): Promise<CollectionItemValue[]> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  // Current values tell real edits apart from no-op saves, which both the
  // `updated_at` bump and translation invalidation depend on
  const currentValues = await getValuesByItemId(item_id, is_published);
  const currentValuesMap = currentValues.reduce((acc, val) => {
    acc[val.field_id] = val.value;
    return acc;
  }, {} as Record<string, string | null>);

  // Get field mappings to validate field IDs and get types
  // Fields are fetched with the same is_published status as the values
  const { data: fields, error } = await client
    .from('collection_fields')
    .select('id, type, key')
    .eq('collection_id', collection_id)
    .eq('is_published', is_published)
    .is('deleted_at', null);

  if (error) {
    throw new Error(`Failed to fetch fields: ${error.message}`);
  }

  // Create mapping of field_id -> type and field_id -> key
  const fieldMap: Record<string, CollectionFieldType> = {};
  const fieldKeyMap: Record<string, string> = {};
  fields?.forEach((field: any) => {
    fieldMap[field.id] = field.type;
    if (field.key) {
      fieldKeyMap[field.id] = field.key;
    }
  });

  // Convert values to strings based on type and set
  const valuesToSet: Record<string, string | null> = {};

  for (const [fieldId, value] of Object.entries(values)) {
    const type = fieldMap[fieldId] || fieldType[fieldId] || 'text';
    let stringValue = valueToString(value, type);
    // Normalize slug values to a valid URL segment so a stray leading slash,
    // spaces or invalid chars can't break dynamic page routing.
    if (stringValue && fieldKeyMap[fieldId] === 'slug') {
      stringValue = slugify(stringValue);
    }
    valuesToSet[fieldId] = stringValue;
  }

  // Auto-bump the virtual `updated_at` field, unless the caller explicitly
  // provided one. The DB column on `collection_items` is bumped via
  // updateContentHash below, but the user-facing "Updated Date" column in the
  // CMS table reads this virtual field — without this, edits would never
  // appear to refresh. Bulk re-saves that change nothing must not bump it:
  // the timestamp feeds content_hash, sitemap <lastmod> and any structured
  // data bound to it, so a no-op save would advertise fake freshness.
  const updatedAtFieldId = Object.keys(fieldKeyMap).find(id => fieldKeyMap[id] === 'updated_at');
  const hasValueChange = hasCollectionValueChanges(valuesToSet, currentValuesMap, updatedAtFieldId);
  const autoBumpedUpdatedAt = !!updatedAtFieldId && !(updatedAtFieldId in valuesToSet) && hasValueChange;
  if (autoBumpedUpdatedAt) {
    valuesToSet[updatedAtFieldId!] = new Date().toISOString();
  }

  // Hoist any inline base64 images embedded in rich-text values out to the asset
  // manager before they're stored. Callers that author rich text from markdown
  // (AI/MCP tools, editor saves) can otherwise persist multi-MB data URIs inline,
  // which blow past the serverless payload limit and block publishing.
  const richTextFieldIds = Object.keys(valuesToSet).filter(
    id => fieldMap[id] === 'rich_text' && typeof valuesToSet[id] === 'string');
  if (richTextFieldIds.length > 0) {
    const { uploadInlineRichTextImages } = await import('@/lib/rich-text-image-upload');
    for (const fieldId of richTextFieldIds) {
      valuesToSet[fieldId] = await uploadInlineRichTextImages(valuesToSet[fieldId]);
    }
  }

  // Detect changes and removals for translation management (only for draft)
  if (!is_published) {
    const changedKeys: string[] = [];
    const removedKeys: string[] = [];

    // Check for changed values
    for (const [fieldId, newValue] of Object.entries(valuesToSet)) {
      // An auto-bumped `updated_at` shouldn't mark translations as incomplete
      if (autoBumpedUpdatedAt && fieldId === updatedAtFieldId) continue;

      const oldValue = currentValuesMap[fieldId];

      // Generate content key based on field key (if exists) or field id
      const contentKey = fieldId in fieldKeyMap
        ? `field:key:${fieldKeyMap[fieldId]}`
        : `field:id:${fieldId}`;

      if (newValue !== oldValue && newValue !== null && newValue !== '') {
        changedKeys.push(contentKey);
      } else if (newValue === null || newValue === '') {
        // Value was removed/cleared
        if (oldValue !== null && oldValue !== undefined && oldValue !== '') {
          removedKeys.push(contentKey);
        }
      }
    }

    // Update translations
    if (removedKeys.length > 0) {
      await deleteTranslationsInBulk('cms', item_id, removedKeys);
    }

    if (changedKeys.length > 0) {
      await markTranslationsIncomplete('cms', item_id, changedKeys);
    }
  }

  const results = await setValues(item_id, valuesToSet, is_published);

  // Recompute content_hash from all current values
  const allValues = await getValuesByItemId(item_id, is_published);
  const hash = generateCollectionItemContentHash(allValues.map(v => ({ field_id: v.field_id, value: v.value })));
  await updateContentHash(item_id, is_published, hash);

  return results;
}

/**
 * Delete a value
 * @param item_id - Item UUID
 * @param field_id - Field UUID
 * @param is_published - Which version to delete: draft (false) or published (true). Defaults to false (draft).
 */
export async function deleteValue(
  item_id: string,
  field_id: string,
  is_published: boolean = false
): Promise<void> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  const { error } = await client
    .from('collection_item_values')
    .update({
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('item_id', item_id)
    .eq('field_id', field_id)
    .eq('is_published', is_published)
    .is('deleted_at', null);

  if (error) {
    throw new Error(`Failed to delete value: ${error.message}`);
  }
}

/**
 * Soft-delete every stored value for a field whose value exactly matches
 * `value`. Used when an option is removed from an option-type field so item
 * values storing that option name are cleared from both draft and published
 * rows.
 * @returns Number of rows soft-deleted
 */
export async function clearValuesForField(
  field_id: string,
  value: string
): Promise<number> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  const now = new Date().toISOString();
  const { data, error } = await client
    .from('collection_item_values')
    .update({ deleted_at: now, updated_at: now })
    .eq('field_id', field_id)
    .eq('value', value)
    .is('deleted_at', null)
    .select('id');

  if (error) {
    throw new Error(`Failed to clear values: ${error.message}`);
  }

  return data?.length || 0;
}

/**
 * Replace stored values for a field where the value exactly matches `old_value`.
 * Used to propagate option renames in option-type fields to all draft and
 * published item values storing the previous option name.
 * @returns Number of rows updated
 */
export async function renameValuesForField(
  field_id: string,
  old_value: string,
  new_value: string
): Promise<number> {
  if (old_value === new_value) return 0;

  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  const { data, error } = await client
    .from('collection_item_values')
    .update({
      value: new_value,
      updated_at: new Date().toISOString(),
    })
    .eq('field_id', field_id)
    .eq('value', old_value)
    .is('deleted_at', null)
    .select('id');

  if (error) {
    throw new Error(`Failed to rename values: ${error.message}`);
  }

  return data?.length || 0;
}

/**
 * Publish values for an item
 * Copies all draft values to published values for the same item
 * Uses batch upsert for efficiency
 * @param item_id - Item UUID to publish
 * @returns Number of values published
 */
export async function publishValues(item_id: string): Promise<number> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  // Get all draft values for this item
  const draftValues = await getValuesByItemId(item_id, false);

  if (draftValues.length === 0) {
    return 0;
  }

  // Prepare values for batch upsert
  const now = new Date().toISOString();
  const valuesToUpsert = draftValues.map(value => ({
    id: value.id,
    item_id: value.item_id,
    field_id: value.field_id,
    value: value.value,
    is_published: true,
    created_at: value.created_at,
    updated_at: now,
  }));

  // Batch upsert all values
  const { error } = await client
    .from('collection_item_values')
    .upsert(valuesToUpsert, {
      onConflict: 'id,is_published', // Composite primary key
    });

  if (error) {
    throw new Error(`Failed to publish values: ${error.message}`);
  }

  // Copy the draft content_hash to the published item
  const hash = generateCollectionItemContentHash(draftValues.map(v => ({ field_id: v.field_id, value: v.value })));
  await updateContentHash(item_id, true, hash);

  // Publish assets referenced by this item (e.g. CMS thumbnails or rich-text
  // images) so they get a published row in the same operation. Without this, a
  // single-item publish (Set as published / staged item) leaves images as drafts
  // and the live page renders the default placeholder until a later full publish.
  try {
    const { collectItemValueAssetIds } = await import('@/lib/collection-asset-utils');
    const { publishAssets } = await import('@/lib/repositories/assetRepository');
    const assetIds = collectItemValueAssetIds(draftValues);
    if (assetIds.length > 0) {
      await publishAssets(assetIds);
    }
  } catch {
    // Non-fatal: asset publishing failure should not roll back value publishing
  }

  return draftValues.length;
}

/**
 * Cast a value to its proper type
 * Helper function to convert text values to typed values
 */
export function castValueByType(value: string | null, type: CollectionFieldType): any {
  return castValue(value, type);
}
