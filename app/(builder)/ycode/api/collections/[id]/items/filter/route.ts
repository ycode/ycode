import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { getSiteUser } from '@/lib/supabase-auth';
import { getItemsByCollectionId } from '@/lib/repositories/collectionItemRepository';
import { getValuesByItemIds } from '@/lib/repositories/collectionItemValueRepository';
import { getFieldsByCollectionId } from '@/lib/repositories/collectionFieldRepository';
import { enrichItemsWithCountValues } from '@/lib/repositories/collectionCountRepository';
import { getAllPages } from '@/lib/repositories/pageRepository';
import { getAllPageFolders } from '@/lib/repositories/pageFolderRepository';
import { renderCollectionItemsToHtml, loadTranslationsForLocale } from '@/lib/page-fetcher';
import { noCache } from '@/lib/api-response';
import { compareDateFilter, isDateFieldType, isDatePreset, resolveDateFilterValue } from '@/lib/collection-field-utils';
import type { Layer, CollectionItem, CollectionItemWithValues } from '@/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type SupabaseClient = NonNullable<Awaited<ReturnType<typeof getSupabaseAdmin>>>;

interface FilterCondition {
  fieldId: string;
  operator: string;
  value: string;
  value2?: string;
  fieldType?: string;
}

// PostgREST encodes .in() values into a URL query param.
// Conservative chunk size avoids hitting URL length limits (~8KB).
const IN_CHUNK_SIZE = 150;

function escapeLikeValue(val: string): string {
  return val.replace(/[%_\\]/g, '\\$&');
}

/**
 * Run a query against collection_item_values in chunks to avoid
 * Supabase/PostgREST URL-length limits on .in() clauses.
 *
 * @param build  - receives a chunk of item IDs; must return { data, error }
 * @param itemIds - full array of item IDs to query against
 */
async function chunkedQuery<T>(
  build: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: any }>,
  itemIds: string[],
): Promise<T[]> {
  if (itemIds.length === 0) return [];
  if (itemIds.length <= IN_CHUNK_SIZE) {
    const { data } = await build(itemIds);
    return data || [];
  }
  const results: T[] = [];
  for (let i = 0; i < itemIds.length; i += IN_CHUNK_SIZE) {
    const { data } = await build(itemIds.slice(i, i + IN_CHUNK_SIZE));
    if (data) results.push(...data);
  }
  return results;
}

async function getAllItemIdsForCollection(
  client: SupabaseClient,
  collectionId: string,
  isPublished: boolean,
): Promise<string[]> {
  let query = client
    .from('collection_items')
    .select('id')
    .eq('collection_id', collectionId)
    .eq('is_published', isPublished)
    .is('deleted_at', null);

  if (isPublished) {
    query = query.eq('is_publishable', true);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch item IDs: ${error.message}`);
  return data?.map(d => d.id) || [];
}

async function getIdsMatchingFilter(
  client: SupabaseClient,
  filter: FilterCondition,
  isPublished: boolean,
  allItemIds: string[],
): Promise<Set<string>> {
  const { fieldId, operator, value } = filter;
  const allSet = new Set(allItemIds);

  const selectIds = (chunk: string[]) =>
    client
      .from('collection_item_values')
      .select('item_id')
      .eq('field_id', fieldId)
      .eq('is_published', isPublished)
      .is('deleted_at', null)
      .in('item_id', chunk);

  const selectIdsAndValues = (chunk: string[]) =>
    client
      .from('collection_item_values')
      .select('item_id, value')
      .eq('field_id', fieldId)
      .eq('is_published', isPublished)
      .is('deleted_at', null)
      .in('item_id', chunk);

  switch (operator) {
    // --- Text positive ---
    case 'contains': {
      const data = await chunkedQuery(
        chunk => selectIds(chunk).ilike('value', `%${escapeLikeValue(value)}%`),
        allItemIds,
      );
      return new Set(data.map(d => d.item_id));
    }
    case 'is': {
      if (filter.fieldType === 'boolean') {
        const targetBool = value.toLowerCase() === 'true';
        const data = await chunkedQuery(chunk => selectIdsAndValues(chunk), allItemIds);
        const result = new Set<string>();
        for (const row of data) {
          const raw = String(row.value ?? '').toLowerCase();
          const isTruthy = raw === 'true' || raw === '1' || raw === 'yes';
          if (isTruthy === targetBool) result.add(row.item_id);
        }
        return result;
      }
      if (isDateFieldType(filter.fieldType)) {
        const data = await chunkedQuery(
          chunk => selectIdsAndValues(chunk).neq('value', ''),
          allItemIds,
        );
        const result = new Set<string>();
        for (const row of data) {
          if (compareDateFilter(String(row.value), 'is', value)) result.add(row.item_id);
        }
        return result;
      }
      const data = await chunkedQuery(
        chunk => selectIds(chunk).ilike('value', escapeLikeValue(value)),
        allItemIds,
      );
      return new Set(data.map(d => d.item_id));
    }
    case 'starts_with': {
      const data = await chunkedQuery(
        chunk => selectIds(chunk).ilike('value', `${escapeLikeValue(value)}%`),
        allItemIds,
      );
      return new Set(data.map(d => d.item_id));
    }
    case 'ends_with': {
      const data = await chunkedQuery(
        chunk => selectIds(chunk).ilike('value', `%${escapeLikeValue(value)}`),
        allItemIds,
      );
      return new Set(data.map(d => d.item_id));
    }

    // --- Text negative (complement) ---
    case 'does_not_contain': {
      const data = await chunkedQuery(
        chunk => selectIds(chunk).ilike('value', `%${escapeLikeValue(value)}%`),
        allItemIds,
      );
      const matchIds = new Set(data.map(d => d.item_id));
      return new Set([...allSet].filter(id => !matchIds.has(id)));
    }
    case 'is_not': {
      if (filter.fieldType === 'boolean') {
        const targetBool = value.toLowerCase() === 'true';
        const data = await chunkedQuery(chunk => selectIdsAndValues(chunk), allItemIds);
        const result = new Set<string>();
        for (const row of data) {
          const raw = String(row.value ?? '').toLowerCase();
          const isTruthy = raw === 'true' || raw === '1' || raw === 'yes';
          if (isTruthy !== targetBool) result.add(row.item_id);
        }
        return result;
      }
      if (isDateFieldType(filter.fieldType)) {
        const data = await chunkedQuery(
          chunk => selectIdsAndValues(chunk).neq('value', ''),
          allItemIds,
        );
        const matchIds = new Set<string>();
        for (const row of data) {
          if (compareDateFilter(String(row.value), 'is', value)) matchIds.add(row.item_id);
        }
        return new Set([...allSet].filter(id => !matchIds.has(id)));
      }
      const data = await chunkedQuery(
        chunk => selectIds(chunk).ilike('value', escapeLikeValue(value)),
        allItemIds,
      );
      const matchIds = new Set(data.map(d => d.item_id));
      return new Set([...allSet].filter(id => !matchIds.has(id)));
    }

    // --- Presence ---
    case 'is_empty':
    case 'is_not_present': {
      const data = await chunkedQuery(
        chunk => selectIds(chunk).neq('value', ''),
        allItemIds,
      );
      const nonEmptyIds = new Set(data.map(d => d.item_id));
      return new Set([...allSet].filter(id => !nonEmptyIds.has(id)));
    }
    case 'is_not_empty':
    case 'is_present':
    case 'exists': {
      const data = await chunkedQuery(
        chunk => selectIds(chunk).neq('value', ''),
        allItemIds,
      );
      return new Set(data.map(d => d.item_id));
    }
    case 'does_not_exist': {
      const data = await chunkedQuery(
        chunk => selectIds(chunk).neq('value', ''),
        allItemIds,
      );
      const existIds = new Set(data.map(d => d.item_id));
      return new Set([...allSet].filter(id => !existIds.has(id)));
    }

    // --- Numeric ---
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const filterNum = parseFloat(value);
      if (isNaN(filterNum)) return new Set();
      const data = await chunkedQuery(
        chunk => selectIdsAndValues(chunk).neq('value', ''),
        allItemIds,
      );
      const result = new Set<string>();
      for (const row of data) {
        const num = parseFloat(String(row.value ?? ''));
        if (isNaN(num)) continue;
        if (operator === 'gt' && num > filterNum) result.add(row.item_id);
        else if (operator === 'gte' && num >= filterNum) result.add(row.item_id);
        else if (operator === 'lt' && num < filterNum) result.add(row.item_id);
        else if (operator === 'lte' && num <= filterNum) result.add(row.item_id);
      }
      return result;
    }

    // --- Date (day-aware: `YYYY-MM-DD` filter values span the full UTC day) ---
    case 'is_before': {
      const data = await chunkedQuery(
        chunk => selectIdsAndValues(chunk).neq('value', ''),
        allItemIds,
      );
      const result = new Set<string>();
      for (const row of data) {
        if (compareDateFilter(String(row.value), 'is_before', value)) result.add(row.item_id);
      }
      return result;
    }
    case 'is_after': {
      const data = await chunkedQuery(
        chunk => selectIdsAndValues(chunk).neq('value', ''),
        allItemIds,
      );
      const result = new Set<string>();
      for (const row of data) {
        if (compareDateFilter(String(row.value), 'is_after', value)) result.add(row.item_id);
      }
      return result;
    }
    case 'is_between': {
      const startRaw = value?.trim();
      const endRaw = (filter.value2 || '').trim();
      if (!startRaw && !endRaw) return new Set();

      const data = await chunkedQuery(
        chunk => selectIdsAndValues(chunk).neq('value', ''),
        allItemIds,
      );
      const result = new Set<string>();
      for (const row of data) {
        const storedValue = String(row.value);
        // Open-ended ranges fall back to the relevant single-bound operator.
        if (startRaw && endRaw) {
          if (compareDateFilter(storedValue, 'is_between', startRaw, endRaw)) result.add(row.item_id);
        } else if (startRaw) {
          if (!compareDateFilter(storedValue, 'is_before', startRaw)) result.add(row.item_id);
        } else if (endRaw) {
          if (!compareDateFilter(storedValue, 'is_after', endRaw)) result.add(row.item_id);
        }
      }
      return result;
    }

    // --- Reference ---
    case 'is_one_of': {
      try {
        const allowedIds = JSON.parse(value || '[]');
        if (!Array.isArray(allowedIds)) return new Set();
        const data = await chunkedQuery(chunk => selectIdsAndValues(chunk), allItemIds);
        const result = new Set<string>();
        for (const row of data) {
          const val = String(row.value ?? '');
          if (allowedIds.includes(val)) { result.add(row.item_id); continue; }
          try {
            const arr = JSON.parse(val);
            if (Array.isArray(arr) && arr.some((id: string) => allowedIds.includes(id))) {
              result.add(row.item_id);
            }
          } catch { /* not JSON */ }
        }
        return result;
      } catch { return new Set(); }
    }
    case 'is_not_one_of': {
      try {
        const excludedIds = JSON.parse(value || '[]');
        if (!Array.isArray(excludedIds)) return allSet;
        const data = await chunkedQuery(chunk => selectIdsAndValues(chunk), allItemIds);
        const excludeSet = new Set<string>();
        for (const row of data) {
          const val = String(row.value ?? '');
          if (excludedIds.includes(val)) { excludeSet.add(row.item_id); continue; }
          try {
            const arr = JSON.parse(val);
            if (Array.isArray(arr) && arr.some((id: string) => excludedIds.includes(id))) {
              excludeSet.add(row.item_id);
            }
          } catch { /* not JSON */ }
        }
        return new Set([...allSet].filter(id => !excludeSet.has(id)));
      } catch { return allSet; }
    }

    // --- Multi-reference ---
    case 'has_items': {
      const data = await chunkedQuery(
        chunk => selectIdsAndValues(chunk).neq('value', ''),
        allItemIds,
      );
      const result = new Set<string>();
      for (const row of data) {
        try {
          const arr = JSON.parse(String(row.value));
          if (Array.isArray(arr) && arr.length > 0) result.add(row.item_id);
        } catch {
          if (row.value) result.add(row.item_id);
        }
      }
      return result;
    }
    case 'has_no_items': {
      const data = await chunkedQuery(chunk => selectIdsAndValues(chunk), allItemIds);
      const hasItemsSet = new Set<string>();
      for (const row of data) {
        try {
          const arr = JSON.parse(String(row.value));
          if (Array.isArray(arr) && arr.length > 0) hasItemsSet.add(row.item_id);
        } catch {
          if (row.value) hasItemsSet.add(row.item_id);
        }
      }
      return new Set([...allSet].filter(id => !hasItemsSet.has(id)));
    }
    case 'contains_all_of': {
      try {
        const requiredIds = JSON.parse(value || '[]');
        if (!Array.isArray(requiredIds)) return new Set();
        const data = await chunkedQuery(chunk => selectIdsAndValues(chunk), allItemIds);
        const result = new Set<string>();
        for (const row of data) {
          try {
            const arr = JSON.parse(String(row.value));
            if (Array.isArray(arr) && requiredIds.every((id: string) => arr.includes(id))) {
              result.add(row.item_id);
            }
          } catch { /* skip */ }
        }
        return result;
      } catch { return new Set(); }
    }
    case 'contains_exactly': {
      try {
        const requiredIds = JSON.parse(value || '[]');
        if (!Array.isArray(requiredIds)) return new Set();
        const data = await chunkedQuery(chunk => selectIdsAndValues(chunk), allItemIds);
        const result = new Set<string>();
        for (const row of data) {
          try {
            const arr = JSON.parse(String(row.value));
            if (
              Array.isArray(arr) &&
              arr.length === requiredIds.length &&
              requiredIds.every((id: string) => arr.includes(id))
            ) {
              result.add(row.item_id);
            }
          } catch { /* skip */ }
        }
        return result;
      } catch { return new Set(); }
    }

    default: {
      const data = await chunkedQuery(
        chunk => selectIds(chunk).ilike('value', `%${escapeLikeValue(value)}%`),
        allItemIds,
      );
      return new Set(data.map(d => d.item_id));
    }
  }
}

async function getFilteredItemIds(
  collectionId: string,
  isPublished: boolean,
  filterGroups: FilterCondition[][],
  userScope?: boolean,
  userScopeFieldId?: string,
): Promise<{ matchingIds: string[]; total: number }> {
  const client = await getSupabaseAdmin();
  if (!client) throw new Error('Supabase client not configured');

  // 1. Resolve current user if needed (either for explicit 'current_user' filter or global userScope)
  let currentUserId: string | null = null;
  const hasExplicitUserFilter = filterGroups.some(g => g.some(c => c.value === 'current_user' || c.value2 === 'current_user'));
  
  if (userScope || hasExplicitUserFilter) {
    const siteAuth = await getSiteUser();
    currentUserId = siteAuth?.user?.id || null;
  }

  // 2. Fetch all base item IDs for the collection
  const allItemIds = await getAllItemIdsForCollection(client, collectionId, isPublished);
  if (allItemIds.length === 0) return { matchingIds: [], total: 0 };

  let baseIds = new Set(allItemIds);

  // 3. Apply Global User Scope if enabled
  if (userScope) {
    let targetFieldId = userScopeFieldId;
    
    // If no specific field ID provided, look for 'supabase_user_id' key in this collection
    if (!targetFieldId) {
      const fields = await getFieldsByCollectionId(collectionId, isPublished);
      const userField = fields.find(f => f.key === 'supabase_user_id');
      if (userField) targetFieldId = userField.id;
    }

    if (targetFieldId) {
      const userFilter: FilterCondition = {
        fieldId: targetFieldId,
        operator: 'is',
        value: currentUserId || 'guest', // 'guest' ensures no matches if logged out
      };
      const matchingForUser = await getIdsMatchingFilter(client, userFilter, isPublished, [...baseIds]);
      baseIds = new Set([...baseIds].filter(id => matchingForUser.has(id)));
    }
    
    if (baseIds.size === 0) return { matchingIds: [], total: 0 };
  }

  // 4. Apply standard filter groups (if any)
  if (filterGroups.length === 0) {
    const matchingIds = Array.from(baseIds);
    return { matchingIds, total: matchingIds.length };
  }

  // Each group's conditions are ANDed. Groups are ORed (union).
  const groupResults: Set<string>[] = [];

  for (const group of filterGroups) {
    let currentIds = new Set(baseIds);

    for (const filter of group) {
      if (currentIds.size === 0) break;
      // Resolve "current_user" placeholder in explicit filters
      let filterValue = filter.value;
      let filterValue2 = filter.value2;
      
      if (filterValue === 'current_user') filterValue = currentUserId || 'guest';
      if (filterValue2 === 'current_user') filterValue2 = currentUserId || 'guest';
      
      const resolvedFilter = { ...filter, value: filterValue, value2: filterValue2 };

      if (isDateFieldType(resolvedFilter.fieldType) && isDatePreset(resolvedFilter.value)) {
        const resolved = resolveDateFilterValue(resolvedFilter.operator, resolvedFilter.value, resolvedFilter.value2);
        if (resolved) {
          resolvedFilter.operator = resolved.operator;
          resolvedFilter.value = resolved.value;
          resolvedFilter.value2 = resolved.value2;
        }
      }
      const matchingForFilter = await getIdsMatchingFilter(client, resolvedFilter, isPublished, [...currentIds]);
      currentIds = new Set([...currentIds].filter(id => matchingForFilter.has(id)));
    }

    groupResults.push(currentIds);
  }

  // Union all group results (OR)
  const unionIds = new Set<string>();
  for (const groupIds of groupResults) {
    for (const id of groupIds) {
      unionIds.add(id);
    }
  }

  return { matchingIds: [...unionIds], total: unionIds.size };
}

function reorderItemsById(items: CollectionItem[], idOrder: string[]): CollectionItem[] {
  const byId = new Map(items.map(item => [item.id, item]));
  const ordered: CollectionItem[] = [];
  for (const id of idOrder) {
    const item = byId.get(id);
    if (item) ordered.push(item);
  }
  return ordered;
}

async function getFieldValuesForItems(
  fieldId: string,
  isPublished: boolean,
  itemIds: string[],
): Promise<Map<string, string>> {
  if (itemIds.length === 0) return new Map();
  const client = await getSupabaseAdmin();
  if (!client) throw new Error('Supabase client not configured');

  const rows = await chunkedQuery<{ item_id: string; value: string | null }>(
    chunk => client
      .from('collection_item_values')
      .select('item_id, value')
      .eq('field_id', fieldId)
      .eq('is_published', isPublished)
      .is('deleted_at', null)
      .in('item_id', chunk),
    itemIds,
  );

  const valueMap = new Map<string, string>();
  for (const row of rows) {
    valueMap.set(row.item_id, row.value ?? '');
  }
  return valueMap;
}

/**
 * POST /ycode/api/collections/[id]/items/filter
 *
 * Body (JSON):
 * - layerTemplate: Layer[]
 * - collectionLayerId: string
 * - filterGroups: Array<Array<{ fieldId, operator, value, value2? }>>
 *     Groups are ORed; conditions within a group are ANDed.
 * - sortBy?: string
 * - sortOrder?: 'asc' | 'desc'
 * - limit?: number
 * - offset?: number
 * - localeCode?: string
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: collectionId } = await params;
    const body = await request.json();
    const {
      layerTemplate,
      collectionLayerId,
      filterGroups = [],
      userScope,
      userScopeFieldId,
      sortBy,
      sortOrder = 'asc',
      limit,
      offset = 0,
      localeCode,
      collectionLayerClasses,
      collectionLayerTag,
      published: isPublished = true,
    } = body;

    if (!layerTemplate || !Array.isArray(layerTemplate)) {
      return noCache({ error: 'layerTemplate is required and must be an array' }, 400);
    }
    if (!collectionLayerId) {
      return noCache({ error: 'collectionLayerId is required' }, 400);
    }

    const { matchingIds, total: filteredTotal } = await getFilteredItemIds(
      collectionId,
      isPublished,
      filterGroups,
      userScope,
      userScopeFieldId,
    );

    if (matchingIds.length === 0) {
      return noCache({
        data: { html: '', total: 0, count: 0, offset, hasMore: false },
      });
    }

    const pageOffset = Math.max(0, offset || 0);
    const pageLimit = limit && limit > 0 ? limit : filteredTotal;
    let pageRawItems: CollectionItem[] = [];
    let pageItemIds: string[] = [];

    if (!sortBy || sortBy === 'none' || sortBy === 'manual') {
      // Let DB do ordering and pagination for cheap paths.
      const { items } = await getItemsByCollectionId(collectionId, isPublished, {
        itemIds: matchingIds,
        limit: pageLimit,
        offset: pageOffset,
      });
      pageRawItems = items;
      pageItemIds = items.map(item => item.id);
    } else if (sortBy === 'random') {
      const randomizedIds = [...matchingIds].sort(() => Math.random() - 0.5);
      pageItemIds = randomizedIds.slice(pageOffset, pageOffset + pageLimit);
      if (pageItemIds.length > 0) {
        const { items } = await getItemsByCollectionId(collectionId, isPublished, {
          itemIds: pageItemIds,
        });
        pageRawItems = reorderItemsById(items, pageItemIds);
      }
    } else {
      // For field-based sort, sort IDs using just the sort field values first,
      // then hydrate only the requested page window.
      const sortValueByItem = await getFieldValuesForItems(sortBy, isPublished, matchingIds);
      const sortedIds = [...matchingIds].sort((a, b) => {
        const aStr = String(sortValueByItem.get(a) || '');
        const bStr = String(sortValueByItem.get(b) || '');
        const aNum = aStr.trim() !== '' ? Number(aStr) : NaN;
        const bNum = bStr.trim() !== '' ? Number(bStr) : NaN;
        if (!isNaN(aNum) && !isNaN(bNum)) {
          return sortOrder === 'desc' ? bNum - aNum : aNum - bNum;
        }
        return sortOrder === 'desc'
          ? bStr.localeCompare(aStr)
          : aStr.localeCompare(bStr);
      });
      pageItemIds = sortedIds.slice(pageOffset, pageOffset + pageLimit);
      if (pageItemIds.length > 0) {
        const { items } = await getItemsByCollectionId(collectionId, isPublished, {
          itemIds: pageItemIds,
        });
        pageRawItems = reorderItemsById(items, pageItemIds);
      }
    }

    const valuesByItem = await getValuesByItemIds(
      pageRawItems.map(i => i.id),
      isPublished,
    );
    const paginatedItems: CollectionItemWithValues[] = pageRawItems.map(item => ({
      ...item,
      values: valuesByItem[item.id] || {},
    }));

    // Inject computed count field values so layers bound to a count field
    // render the live number in the filtered HTML.
    await enrichItemsWithCountValues(paginatedItems, collectionId, isPublished);

    const hasMore = pageOffset + paginatedItems.length < filteredTotal;

    const collectionFields = await getFieldsByCollectionId(collectionId, isPublished, { excludeComputed: true });
    const slugField = collectionFields.find(f => f.key === 'slug');
    const collectionItemSlugs: Record<string, string> = {};
    if (slugField) {
      for (const item of paginatedItems) {
        if (item.values[slugField.id]) {
          collectionItemSlugs[item.id] = item.values[slugField.id];
        }
      }
    }

    const [pages, folders] = await Promise.all([
      getAllPages(),
      getAllPageFolders(),
    ]);

    let locale = null;
    let translations: Record<string, any> | undefined;
    if (localeCode) {
      const localeData = await loadTranslationsForLocale(localeCode, isPublished);
      locale = localeData.locale;
      translations = localeData.translations;
    }

    const html = await renderCollectionItemsToHtml(
      paginatedItems,
      layerTemplate as Layer[],
      collectionId,
      collectionLayerId,
      isPublished,
      pages,
      folders,
      collectionItemSlugs,
      locale,
      translations,
      undefined,
      collectionLayerClasses,
      collectionLayerTag,
    );

    return noCache({
      data: {
        html,
        total: filteredTotal,
        count: paginatedItems.length,
        offset: pageOffset,
        hasMore,
      },
    });
  } catch (error) {
    console.error('Error filtering collection items:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to filter items' },
      500,
    );
  }
}
