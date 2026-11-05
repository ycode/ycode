/**
 * Translation Repository
 *
 * Data access layer for translations
 * Supports draft/published workflow with composite primary key (id, is_published)
 */

import { getSupabaseAdmin, getTenantIdFromHeaders } from '@/lib/supabase-server';
import { fetchAllRows, SUPABASE_WRITE_BATCH_SIZE } from '@/lib/supabase-constants';
import { getKnexClient } from '@/lib/knex-client';
import type { Translation, CreateTranslationData, UpdateTranslationData } from '@/types';

type TranslationDiffRow = Pick<
  Translation,
  'id' | 'content_value' | 'is_completed' | 'deleted_at'
>;

/**
 * Fetch every translation row (including soft-deleted) for one publish state in
 * a single direct-DB (Knex) query. Replaces paginated PostgREST reads that
 * issued ~one round-trip per 1000 rows when diffing large catalogues during
 * publish. Falls back to paginated PostgREST on error.
 *
 * @param columns - SELECT list; pass a narrow set for diff/count callers.
 */
export async function getAllTranslationRows<T = Translation>(
  isPublished: boolean,
  columns: string[] = ['*'],
  tenantId?: string,
): Promise<T[]> {
  try {
    const knex = await getKnexClient();
    const resolvedTenantId = tenantId ?? await getTenantIdFromHeaders();
    let query = knex('translations').select(columns).where('is_published', isPublished);
    if (resolvedTenantId) {
      query = query.where('tenant_id', resolvedTenantId);
    }
    return await query as T[];
  } catch {
    const client = await getSupabaseAdmin(tenantId);
    if (!client) return [];
    const select = columns.includes('*') ? '*' : columns.join(', ');
    return await fetchAllRows<T>((from, to) =>
      client.from('translations').select(select).eq('is_published', isPublished).order('id', { ascending: true }).range(from, to) as unknown as PromiseLike<{ data: T[] | null; error: unknown }>,
    );
  }
}

/**
 * Get all translations for a locale (draft by default). Pages through the
 * 1000-row PostgREST default so projects with large catalogues don't get
 * silently truncated.
 *
 * Paged loaders here tie-break on `id`: rows published in one batch share a
 * `created_at`, and offset paging over ties silently skips/duplicates rows.
 */
export async function getTranslationsByLocale(
  localeId: string,
  isPublished: boolean = false,
  tenantId?: string
): Promise<Translation[]> {
  const client = await getSupabaseAdmin(tenantId);

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const PAGE_SIZE = 1000;
  const results: Translation[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from('translations')
      .select('*')
      .eq('locale_id', localeId)
      .eq('is_published', isPublished)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Failed to fetch translations: ${error.message}`);
    }

    if (!data || data.length === 0) break;
    results.push(...(data as Translation[]));
    if (data.length < PAGE_SIZE) break;
  }

  return results;
}

/**
 * Content keys that influence URL generation (page/folder/CMS slugs). Kept in
 * the per-locale "scaffold" so routing, hreflang and locale-switcher URLs work
 * without loading the full (CMS-content-heavy) translation catalogue.
 */
const SLUG_CONTENT_KEYS = ['slug', 'field:key:slug'];

/** Source types whose translations are small and always needed per render. */
const NON_CMS_SOURCE_TYPES = ['page', 'folder', 'component'];

/** Supabase caps `.in()` lists; chunk large id arrays to stay under it. */
const IN_CHUNK_SIZE = 300;

function chunkIds(ids: string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/**
 * Load the per-locale translation "scaffold": every non-CMS translation
 * (page / folder / component) plus only the CMS *slug* rows.
 *
 * This is everything needed for routing, page/component rendering, SEO and
 * URL generation — but excludes the bulk CMS *content* translations (text /
 * rich text), which dominate large catalogues and are loaded on demand per
 * rendered item via {@link getCmsTranslationsForItems}.
 */
export async function getLocaleScaffoldTranslations(
  localeId: string,
  isPublished: boolean,
  tenantId?: string,
): Promise<Translation[]> {
  const client = await getSupabaseAdmin(tenantId);

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const PAGE_SIZE = 1000;
  const results: Translation[] = [];

  const pageThrough = async (
    build: (from: number, to: number) => PromiseLike<{ data: Translation[] | null; error: { message: string } | null }>,
  ) => {
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await build(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`Failed to fetch translations: ${error.message}`);
      if (!data || data.length === 0) break;
      results.push(...(data as Translation[]));
      if (data.length < PAGE_SIZE) break;
    }
  };

  // Non-CMS rows (page / folder / component).
  await pageThrough((from, to) =>
    client
      .from('translations')
      .select('*')
      .eq('locale_id', localeId)
      .eq('is_published', isPublished)
      .is('deleted_at', null)
      .in('source_type', NON_CMS_SOURCE_TYPES)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: Translation[] | null; error: { message: string } | null }>,
  );

  // CMS slug rows (needed to match/build localized dynamic-page URLs).
  await pageThrough((from, to) =>
    client
      .from('translations')
      .select('*')
      .eq('locale_id', localeId)
      .eq('is_published', isPublished)
      .is('deleted_at', null)
      .eq('source_type', 'cms')
      .in('content_key', SLUG_CONTENT_KEYS)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: Translation[] | null; error: { message: string } | null }>,
  );

  return results;
}

/**
 * Load CMS *content* translations for a specific set of collection items in a
 * locale. Used to augment the scaffold on demand for exactly the items a given
 * render path materialises, instead of loading the whole locale catalogue.
 */
export async function getCmsTranslationsForItems(
  localeId: string,
  isPublished: boolean,
  itemIds: string[],
  tenantId?: string,
): Promise<Translation[]> {
  if (itemIds.length === 0) return [];

  const client = await getSupabaseAdmin(tenantId);
  if (!client) {
    throw new Error('Supabase not configured');
  }

  const results: Translation[] = [];

  for (const chunk of chunkIds(itemIds, IN_CHUNK_SIZE)) {
    const { data, error } = await client
      .from('translations')
      .select('*')
      .eq('locale_id', localeId)
      .eq('is_published', isPublished)
      .is('deleted_at', null)
      .eq('source_type', 'cms')
      .in('source_id', chunk);

    if (error) {
      throw new Error(`Failed to fetch CMS translations: ${error.message}`);
    }
    if (data) results.push(...(data as Translation[]));
  }

  return results;
}

/**
 * Load only slug translations (page / folder / CMS) for a locale. Used by URL
 * builders (hreflang, sitemap, locale switcher) that never read CMS content —
 * avoids pulling the full catalogue just to construct localized URLs.
 */
export async function getSlugTranslationsByLocale(
  localeId: string,
  isPublished: boolean,
  tenantId?: string,
): Promise<Translation[]> {
  const client = await getSupabaseAdmin(tenantId);

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const PAGE_SIZE = 1000;
  const results: Translation[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from('translations')
      .select('*')
      .eq('locale_id', localeId)
      .eq('is_published', isPublished)
      .is('deleted_at', null)
      .in('content_key', SLUG_CONTENT_KEYS)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Failed to fetch slug translations: ${error.message}`);
    }
    if (!data || data.length === 0) break;
    results.push(...(data as Translation[]));
    if (data.length < PAGE_SIZE) break;
  }

  return results;
}

/**
 * Get translations by source (draft by default). Pass `localeId` to scope to a
 * single locale — far cheaper than loading the whole locale catalogue just to
 * annotate one page/component.
 */
export async function getTranslationsBySource(
  sourceType: string,
  sourceId: string,
  isPublished: boolean = false,
  localeId?: string,
): Promise<Translation[]> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  let query = client
    .from('translations')
    .select('*')
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .eq('is_published', isPublished)
    .is('deleted_at', null);

  if (localeId) {
    query = query.eq('locale_id', localeId);
  }

  const { data, error } = await query.order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch translations: ${error.message}`);
  }

  return data || [];
}

/**
 * Get a single translation by ID (draft by default)
 */
export async function getTranslationById(
  id: string,
  isPublished: boolean = false
): Promise<Translation | null> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await client
    .from('translations')
    .select('*')
    .eq('id', id)
    .eq('is_published', isPublished)
    .is('deleted_at', null)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to fetch translation: ${error.message}`);
  }

  return data;
}

/**
 * Get a translation by locale and key parts (draft by default)
 */
export async function getTranslationByKey(
  localeId: string,
  sourceType: string,
  sourceId: string,
  contentKey: string,
  isPublished: boolean = false
): Promise<Translation | null> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await client
    .from('translations')
    .select('*')
    .eq('locale_id', localeId)
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .eq('content_key', contentKey)
    .eq('is_published', isPublished)
    .is('deleted_at', null)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to fetch translation: ${error.message}`);
  }

  return data;
}

export type DraftTranslationVersion = Pick<Translation, 'id' | 'content_value' | 'updated_at' | 'deleted_at'>;

/** Draft row of a translation key, including soft-deleted rows, for use with saveDraftTranslationIfUnchanged. */
export async function getDraftTranslationVersion(
  localeId: string,
  sourceType: string,
  sourceId: string,
  contentKey: string,
  tenantId?: string
): Promise<DraftTranslationVersion | null> {
  const client = await getSupabaseAdmin(tenantId);

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await client
    .from('translations')
    .select('id, content_value, updated_at, deleted_at')
    .eq('locale_id', localeId)
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .eq('content_key', contentKey)
    .eq('is_published', false)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch translation: ${error.message}`);
  }

  return data;
}

/**
 * Save a draft translation only if its row hasn't changed since `current` was
 * read (null = no row existed). Returns false when another write got there first.
 */
export async function saveDraftTranslationIfUnchanged(
  translationData: CreateTranslationData,
  current: Pick<DraftTranslationVersion, 'id' | 'updated_at'> | null,
  tenantId?: string
): Promise<boolean> {
  const client = await getSupabaseAdmin(tenantId);

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const values = {
    content_type: translationData.content_type,
    content_value: translationData.content_value,
    is_completed: translationData.is_completed ?? false,
    deleted_at: null,
    updated_at: new Date().toISOString(),
  };

  if (current) {
    const { data, error } = await client
      .from('translations')
      .update(values)
      .eq('id', current.id)
      .eq('updated_at', current.updated_at)
      .select('id');

    if (error) {
      throw new Error(`Failed to update translation: ${error.message}`);
    }
    return data.length > 0;
  }

  const { error } = await client
    .from('translations')
    .insert({
      ...values,
      locale_id: translationData.locale_id,
      source_type: translationData.source_type,
      source_id: translationData.source_id,
      content_key: translationData.content_key,
      is_published: false,
    });

  // Unique violation: another write created the row first
  if (error?.code === '23505') return false;
  if (error) {
    throw new Error(`Failed to create translation: ${error.message}`);
  }
  return true;
}

/**
 * Create a new translation (draft by default)
 * Uses upsert to handle existing translations
 */
export async function createTranslation(
  translationData: CreateTranslationData
): Promise<Translation> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await client
    .from('translations')
    .upsert(
      {
        locale_id: translationData.locale_id,
        source_type: translationData.source_type,
        source_id: translationData.source_id,
        content_key: translationData.content_key,
        content_type: translationData.content_type,
        content_value: translationData.content_value,
        is_completed: translationData.is_completed ?? false,
        is_published: false,
        deleted_at: null, // Restore if previously deleted
      },
      {
        onConflict: 'locale_id,source_type,source_id,content_key,is_published',
      }
    )
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create translation: ${error.message}`);
  }

  return data;
}

/**
 * Update a translation (draft only)
 */
export async function updateTranslation(
  id: string,
  updates: UpdateTranslationData
): Promise<Translation> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await client
    .from('translations')
    .update({
      ...updates,
      deleted_at: null, // Restore if previously deleted
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('is_published', false)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update translation: ${error.message}`);
  }

  return data;
}

/**
 * Delete a translation (soft delete - sets deleted_at timestamp)
 */
export async function deleteTranslation(id: string): Promise<void> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const { error } = await client
    .from('translations')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('is_published', false);

  if (error) {
    throw new Error(`Failed to delete translation: ${error.message}`);
  }
}

/**
 * Delete translations in bulk (soft delete - sets deleted_at timestamp)
 * Only deletes draft versions
 *
 * @param sourceType - Type of source (page, folder, component, cms)
 * @param sourceIds - Single source ID or array of source IDs
 * @param contentKeys - Optional. Specific content keys to delete. If not provided, deletes all translations for the source(s).
 */
export async function deleteTranslationsInBulk(
  sourceType: string,
  sourceIds: string | string[],
  contentKeys?: string[]
): Promise<void> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  // Normalize sourceIds to array
  const sourceIdArray = Array.isArray(sourceIds) ? sourceIds : [sourceIds];

  // If no source IDs, nothing to delete
  if (sourceIdArray.length === 0) {
    return;
  }

  // If contentKeys provided but empty, nothing to delete
  if (contentKeys !== undefined && contentKeys.length === 0) {
    return;
  }

  // Build the base query
  let query = client
    .from('translations')
    .update({ deleted_at: new Date().toISOString() })
    .eq('source_type', sourceType)
    .in('source_id', sourceIdArray)
    .eq('is_published', false);

  // Add content_key filter if specific keys provided
  if (contentKeys !== undefined) {
    query = query.in('content_key', contentKeys);
  }

  const { error } = await query;

  if (error) {
    throw new Error(`Failed to delete translations: ${error.message}`);
  }
}

/**
 * Mark translations as incomplete when source content changes
 */
export async function markTranslationsIncomplete(
  sourceType: string,
  sourceId: string,
  contentKeys: string[]
): Promise<void> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  if (contentKeys.length === 0) {
    return; // Nothing to update
  }

  const { error } = await client
    .from('translations')
    .update({
      is_completed: false,
      updated_at: new Date().toISOString(),
    })
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .in('content_key', contentKeys)
    .eq('is_published', false)
    .is('deleted_at', null);

  if (error) {
    throw new Error(`Failed to mark translations as incomplete: ${error.message}`);
  }
}

/**
 * Upsert multiple translations (draft by default). Chunks large arrays by
 * {@link SUPABASE_WRITE_BATCH_SIZE} so callers can pass thousands of rows in one
 * call without hitting Supabase's request-size limits.
 */
export async function upsertTranslations(
  translations: CreateTranslationData[]
): Promise<Translation[]> {
  if (translations.length === 0) return [];

  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const translationsToUpsert = translations.map((t) => ({
    locale_id: t.locale_id,
    source_type: t.source_type,
    source_id: t.source_id,
    content_key: t.content_key,
    content_type: t.content_type,
    content_value: t.content_value,
    // Without this, the DB default (false) keeps batch translations hidden on
    // the live site, which only renders completed translations.
    is_completed: t.is_completed ?? false,
    is_published: false,
    deleted_at: null, // Restore if previously deleted
  }));

  const results: Translation[] = [];

  for (let i = 0; i < translationsToUpsert.length; i += SUPABASE_WRITE_BATCH_SIZE) {
    const chunk = translationsToUpsert.slice(i, i + SUPABASE_WRITE_BATCH_SIZE);
    const { data, error } = await client
      .from('translations')
      .upsert(chunk, {
        onConflict: 'locale_id,source_type,source_id,content_key,is_published',
      })
      .select();

    if (error) {
      throw new Error(`Failed to upsert translations: ${error.message}`);
    }

    if (data) results.push(...(data as Translation[]));
  }

  return results;
}

/**
 * Count translations needing publish: drafts with no published counterpart,
 * pending soft-deletes, or rows whose content_value/is_completed differs from
 * published. Mirrors the diff logic in `publishLocalisation` so the preview
 * matches what will actually publish. Paginates both sides to avoid the
 * 1000-row PostgREST default silently truncating the count.
 */
export async function getUnpublishedTranslationsCount(): Promise<number> {
  const cols = ['id', 'content_value', 'is_completed', 'deleted_at'];

  const [draftRows, publishedRows] = await Promise.all([
    getAllTranslationRows<TranslationDiffRow>(false, cols),
    getAllTranslationRows<TranslationDiffRow>(true, cols),
  ]);

  if (draftRows.length === 0) {
    return 0;
  }

  const publishedById = new Map<string, TranslationDiffRow>();
  for (const t of publishedRows) {
    publishedById.set(t.id, t);
  }

  let count = 0;
  for (const draft of draftRows) {
    const pub = publishedById.get(draft.id);

    if (!pub || pub.deleted_at) {
      if (!draft.deleted_at) count++;
      continue;
    }

    if (draft.deleted_at) {
      count++;
      continue;
    }

    if (
      draft.content_value !== pub.content_value ||
      draft.is_completed !== pub.is_completed
    ) {
      count++;
    }
  }

  return count;
}
