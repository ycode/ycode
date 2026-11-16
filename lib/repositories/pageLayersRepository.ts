import { getSupabaseAdmin } from '@/lib/supabase-server';
import type { PageLayers, Layer } from '../../types';
import { generatePageLayersHash } from '../hash-utils';
import { deleteTranslationsInBulk, markTranslationsIncomplete } from '@/lib/repositories/translationRepository';
import { isValidUUID } from '@/lib/utils';
import { extractLayerContentMap } from '../localisation-utils';

/**
 * Get layers by page_id with optional is_published filter
 */
export async function getLayersByPageId(
  pageId: string,
  isPublished?: boolean
): Promise<PageLayers | null> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  let query = client
    .from('page_layers')
    .select('*')
    .eq('page_id', pageId)
    .is('deleted_at', null);

  // Apply is_published filter if provided
  if (isPublished !== undefined) {
    query = query.eq('is_published', isPublished);
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to fetch layers: ${error.message}`);
  }

  return data;
}

/**
 * Get draft layers for a page
 */
export async function getDraftLayers(pageId: string, tenantId?: string): Promise<PageLayers | null> {
  const client = await getSupabaseAdmin(tenantId);

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await client
    .from('page_layers')
    .select('*')
    .eq('page_id', pageId)
    .eq('is_published', false)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to fetch draft: ${error.message}`);
  }

  return data;
}

/**
 * Get published layers for a page
 */
export async function getPublishedLayers(pageId: string, tenantId?: string): Promise<PageLayers | null> {
  const client = await getSupabaseAdmin(tenantId);

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await client
    .from('page_layers')
    .select('*')
    .eq('page_id', pageId)
    .eq('is_published', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to fetch published layers: ${error.message}`);
  }

  return data;
}

/**
 * Get only the compiled CSS of a page's published layers (skips the layer tree)
 */
export async function getPublishedGeneratedCss(pageId: string, tenantId?: string): Promise<string | null> {
  const client = await getSupabaseAdmin(tenantId);

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await client
    .from('page_layers')
    .select('generated_css')
    .eq('page_id', pageId)
    .eq('is_published', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch published CSS: ${error.message}`);
  }

  return data?.generated_css || null;
}

/**
 * Create or update draft layers
 * @param pageId - Page ID
 * @param layers - Page layers
 * @param additionalData - Optional additional fields (e.g., metadata)
 * @param existingDraft - Optional pre-fetched draft to skip the internal
 *   `getDraftLayers` read. Callers that already have the row (e.g. the MCP
 *   page-layers cache) can pass it through to avoid a redundant DB round trip.
 *   Pass `null` to assert "no draft exists" without re-checking. Omit (or
 *   pass `undefined`) to preserve the original fetch-then-decide behavior.
 */
export async function upsertDraftLayers(
  pageId: string,
  layers: Layer[],
  additionalData?: Record<string, any>,
  existingDraft?: PageLayers | null,
): Promise<PageLayers> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  // Use the caller-provided draft when available, otherwise fall back to a fresh read.
  const resolvedDraft = existingDraft !== undefined
    ? existingDraft
    : await getDraftLayers(pageId);

  // Detect removed and changed layer content, update translations accordingly
  if (resolvedDraft && resolvedDraft.layers) {
    const oldContentMap = extractLayerContentMap(resolvedDraft.layers, 'page', pageId);
    const newContentMap = extractLayerContentMap(layers, 'page', pageId);

    // Find removed keys (exist in old but not in new)
    const removedKeys = Object.keys(oldContentMap).filter(key => !(key in newContentMap));

    // Find changed keys (exist in both but value differs)
    const changedKeys = Object.keys(newContentMap).filter(
      key => key in oldContentMap && oldContentMap[key] !== newContentMap[key]
    );

    // Delete translations for removed content
    if (removedKeys.length > 0) {
      await deleteTranslationsInBulk('page', pageId, removedKeys);
    }

    // Mark translations as incomplete for changed content
    if (changedKeys.length > 0) {
      await markTranslationsIncomplete('page', pageId, changedKeys);
    }
  }

  // Use provided generated_css, or preserve the existing value for hash consistency
  const cssForHash = additionalData?.generated_css !== undefined
    ? (additionalData.generated_css as string) || null
    : resolvedDraft?.generated_css || null;

  const contentHash = generatePageLayersHash({
    layers,
    generated_css: cssForHash,
  });

  // Prepare update data
  const updateData: any = {
    layers,
    content_hash: contentHash,
    updated_at: new Date().toISOString()
  };

  if (additionalData) {
    Object.assign(updateData, additionalData);
  }

  if (resolvedDraft) {
    // Update existing draft
    const { data, error } = await client
      .from('page_layers')
      .update(updateData)
      .eq('id', resolvedDraft.id)
      .eq('is_published', false)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update draft: ${error.message}`);
    }

    return data;
  } else {
    // Create new draft with any additional data
    const insertData: any = {
      page_id: pageId,
      layers,
      content_hash: contentHash,
      is_published: false,
      ...additionalData
    };

    const { data, error } = await client
      .from('page_layers')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create draft: ${error.message}`);
    }

    return data;
  }
}

/**
 * Get all draft layers (non-published)
 * Used for loading all drafts at once in the editor
 */
export async function getAllDraftLayers(): Promise<PageLayers[]> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await client
    .from('page_layers')
    .select('*')
    .eq('is_published', false)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch draft layers: ${error.message}`);
  }

  return data || [];
}

/**
 * Get all draft layers for multiple pages
 * Used for batch publishing optimization
 */
export async function getDraftLayersForPages(pageIds: string[]): Promise<PageLayers[]> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  if (pageIds.length === 0) {
    return [];
  }

  const { data, error } = await client
    .from('page_layers')
    .select('*')
    .in('page_id', pageIds)
    .eq('is_published', false)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch draft layers: ${error.message}`);
  }

  return data || [];
}

/**
 * Get published layers by IDs
 * Used for batch publishing optimization
 */
export async function getPublishedLayersByIds(ids: string[]): Promise<PageLayers[]> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  if (ids.length === 0) {
    return [];
  }

  const { data, error } = await client
    .from('page_layers')
    .select('*')
    .in('id', ids)
    .eq('is_published', true)
    .is('deleted_at', null);

  if (error) {
    throw new Error(`Failed to fetch published layers: ${error.message}`);
  }

  return data || [];
}

/**
 * Get published layers by ID
 * Used to find the published version of draft layers
 */
export async function getPublishedLayersById(id: string): Promise<PageLayers | null> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await client
    .from('page_layers')
    .select('*')
    .eq('id', id)
    .eq('is_published', true)
    .is('deleted_at', null)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to fetch published layers: ${error.message}`);
  }

  return data;
}

/**
 * Publish page layers
 * Creates or updates a published version of the layers with the same ID
 * With composite keys (id, is_published), both draft and published versions use the same page_id
 * @param draftPageId - Page ID to get draft layers from (same as publishedPageId with composite keys)
 * @param publishedPageId - Page ID to reference in published layers (same as draftPageId with composite keys)
 * Draft layers remain unchanged
 */
export async function publishPageLayers(draftPageId: string, publishedPageId: string): Promise<PageLayers> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  // Get current draft layers
  const draftLayers = await getDraftLayers(draftPageId);

  if (!draftLayers) {
    throw new Error('No draft layers found to publish');
  }

  // Check if published version exists (same id, but is_published = true)
  const existingPublished = await getPublishedLayersById(draftLayers.id);

  if (existingPublished) {
    // Update existing published version only if content_hash changed
    const hasChanges = existingPublished.content_hash !== draftLayers.content_hash;

    if (hasChanges) {
      // Prepare update data WITHOUT primary key fields (id, is_published)
      const updateData: any = {
        page_id: publishedPageId,
        layers: draftLayers.layers,
        generated_css: draftLayers.generated_css || null,
        content_hash: draftLayers.content_hash,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await client
        .from('page_layers')
        .update(updateData)
        .eq('id', existingPublished.id)
        .eq('is_published', true)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update published layers: ${error.message}`);
      }

      return data;
    }

    return existingPublished;
  } else {
    // Create new published version - include ALL fields for insert
    const insertData: any = {
      id: draftLayers.id,
      page_id: publishedPageId,
      layers: draftLayers.layers,
      generated_css: draftLayers.generated_css || null,
      content_hash: draftLayers.content_hash,
      is_published: true,
    };

    const { data, error } = await client
      .from('page_layers')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create published layers: ${error.message}`);
    }

    return data;
  }
}

/**
 * Batch publish page layers for multiple pages
 * Much more efficient than calling publishPageLayers in a loop
 * @param pageIds - Array of page IDs to publish layers for
 * @returns Object with count and the page IDs that actually changed
 */
export async function batchPublishPageLayers(
  pageIds: string[],
  options: { force?: boolean } = {},
): Promise<{ count: number; changedPageIds: string[] }> {
  if (pageIds.length === 0) {
    return { count: 0, changedPageIds: [] };
  }

  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  // Step 1: Decide which pages to publish WITHOUT transferring the (large)
  // layers JSONB for every page. We compare lightweight content_hash rows
  // first, then fetch full draft layers only for the pages that changed.
  //
  // Forced mode skips the hash diff: the catch-up path for component/style
  // changes passes a targeted set and must republish them even though the
  // draft layers' JSONB still references the component by ID (so the hash is
  // unchanged) while the resolved/rendered output now differs. Without it,
  // the static export reads stale published layers and downstream writers
  // (GitHub) see an empty diff.
  let pageIdsToPublish: string[];

  if (options.force) {
    pageIdsToPublish = pageIds;
  } else {
    const [draftHashes, publishedHashes] = await Promise.all([
      client
        .from('page_layers')
        .select('id, page_id, content_hash')
        .in('page_id', pageIds)
        .eq('is_published', false)
        .is('deleted_at', null),
      client
        .from('page_layers')
        .select('id, content_hash')
        .in('page_id', pageIds)
        .eq('is_published', true)
        .is('deleted_at', null),
    ]);

    if (draftHashes.error) {
      throw new Error(`Failed to fetch draft layer hashes: ${draftHashes.error.message}`);
    }
    if (publishedHashes.error) {
      throw new Error(`Failed to fetch published layer hashes: ${publishedHashes.error.message}`);
    }

    const publishedHashById = new Map<string, string | null>(
      (publishedHashes.data || []).map(r => [r.id, r.content_hash]),
    );

    pageIdsToPublish = (draftHashes.data || [])
      .filter(d => {
        const pubHash = publishedHashById.get(d.id);
        return pubHash === undefined || pubHash !== d.content_hash;
      })
      .map(d => d.page_id);

    if (pageIdsToPublish.length === 0) {
      return { count: 0, changedPageIds: [] };
    }
  }

  // Published layers need a published page row (fk_page_layers_page). Callers
  // can pass draft-only or deleted pages (e.g. findAffectedPages scans drafts),
  // and one such id would make the whole upsert fail.
  const { data: publishedPages, error: publishedPagesError } = await client
    .from('pages')
    .select('id')
    .in('id', pageIdsToPublish)
    .eq('is_published', true)
    .is('deleted_at', null);

  if (publishedPagesError) {
    throw new Error(`Failed to fetch published pages: ${publishedPagesError.message}`);
  }

  const publishedPageIdSet = new Set((publishedPages || []).map(p => p.id as string));
  pageIdsToPublish = pageIdsToPublish.filter(id => publishedPageIdSet.has(id));

  if (pageIdsToPublish.length === 0) {
    return { count: 0, changedPageIds: [] };
  }

  // Step 2: Fetch full draft layers only for the pages we will publish
  const draftLayers = await getDraftLayersForPages(pageIdsToPublish);

  if (draftLayers.length === 0) {
    return { count: 0, changedPageIds: [] };
  }

  // Step 3: Prepare upsert data
  const now = new Date().toISOString();
  const layersToUpsert: any[] = draftLayers.map(draft => ({
    id: draft.id,
    page_id: draft.page_id,
    layers: draft.layers,
    generated_css: draft.generated_css || null,
    content_hash: draft.content_hash,
    is_published: true,
    updated_at: now,
  }));

  // Step 4: Batch upsert
  if (layersToUpsert.length > 0) {
    const { error } = await client
      .from('page_layers')
      .upsert(layersToUpsert, {
        onConflict: 'id,is_published',
      });

    if (error) {
      throw new Error(`Failed to batch publish layers: ${error.message}`);
    }
  }

  return {
    count: layersToUpsert.length,
    changedPageIds: [...new Set(layersToUpsert.map((l) => l.page_id as string))],
  };
}

/**
 * Get all layers entries for a page (for history)
 */
export async function getPageLayers(pageId: string): Promise<PageLayers[]> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await client
    .from('page_layers')
    .select('*')
    .eq('page_id', pageId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch layers: ${error.message}`);
  }

  return data || [];
}

export interface AffectedPagesByResource {
  componentPageIds: string[];
  stylePageIds: string[];
  collectionPageIds: string[];
}

/**
 * Expand changed component/style IDs through the components table to find
 * transitive dependencies. If Component B is nested inside Component A,
 * editing B should also flag A so that pages using A are invalidated.
 *
 * Handles arbitrary nesting depth (A > B > C) via iterative expansion.
 * Also covers styles used inside components: if a changed style ID appears
 * inside a component's layers, that component ID is added to the result.
 *
 * @returns Additional component IDs that transitively reference the changed resources
 */
async function expandThroughComponents(
  client: NonNullable<Awaited<ReturnType<typeof getSupabaseAdmin>>>,
  componentIds: string[],
  styleIds: string[],
): Promise<string[]> {
  if (componentIds.length === 0 && styleIds.length === 0) return [];

  const { data: allComponents } = await client
    .from('components')
    .select('id, layers')
    .eq('is_published', false)
    .is('deleted_at', null);

  if (!allComponents || allComponents.length === 0) return [];

  // Pre-stringify all component layers once
  const componentTexts = allComponents.map(c => ({
    id: c.id as string,
    text: c.layers ? JSON.stringify(c.layers) : '',
  }));

  const expanded = new Set<string>();

  // Phase 1: find components that contain any of the changed style IDs
  for (const sid of styleIds) {
    for (const comp of componentTexts) {
      if (comp.text.includes(sid)) {
        expanded.add(comp.id);
      }
    }
  }

  // Phase 2: iteratively find components that contain any changed (or
  // newly discovered) component IDs until the set stabilizes.
  // Seed the frontier with both the originally changed components AND
  // components found in Phase 1 (style-containing components also need
  // transitive expansion — e.g. Style X in Component B in Component A).
  const frontier = new Set([...componentIds, ...expanded]);
  const visited = new Set(frontier);

  while (frontier.size > 0) {
    const nextFrontier = new Set<string>();

    for (const cid of frontier) {
      for (const comp of componentTexts) {
        if (comp.id === cid) continue; // skip self
        if (expanded.has(comp.id) && visited.has(comp.id)) continue;
        if (comp.text.includes(cid)) {
          expanded.add(comp.id);
          if (!visited.has(comp.id)) {
            visited.add(comp.id);
            nextFrontier.add(comp.id);
          }
        }
      }
    }

    frontier.clear();
    for (const id of nextFrontier) frontier.add(id);
  }

  return Array.from(expanded);
}

/**
 * Find components that render any of the given collections — e.g. a
 * collection-list/grid block bound to the collection placed inside a reusable
 * component. The binding lives in the component's layers, not in the pages that
 * use the component, so a plain page_layers scan for the collection ID misses
 * those pages. Returns the embedding component IDs (transitively expanded
 * through nested components) so callers can flag the pages using them.
 */
async function findComponentsEmbeddingCollections(
  client: NonNullable<Awaited<ReturnType<typeof getSupabaseAdmin>>>,
  collectionIds: string[],
): Promise<string[]> {
  if (collectionIds.length === 0) return [];

  const { data: allComponents } = await client
    .from('components')
    .select('id, layers')
    .eq('is_published', false)
    .is('deleted_at', null);

  if (!allComponents || allComponents.length === 0) return [];

  const directIds: string[] = [];
  for (const comp of allComponents) {
    if (!comp.layers) continue;
    const text = JSON.stringify(comp.layers);
    for (const id of collectionIds) {
      if (text.includes(id)) { directIds.push(comp.id as string); break; }
    }
  }

  if (directIds.length === 0) return [];

  // A collection-embedding component may itself be nested inside other
  // components, so expand so pages using any ancestor are flagged too.
  const transitive = await expandThroughComponents(client, directIds, []);
  return [...new Set([...directIds, ...transitive])];
}

/**
 * Find reference fields (in any collection) that point at the given collections.
 * Bindings to referenced data store the reference field's ID in their
 * `field_id`/`relationships` path, never the referenced collection's ID.
 */
async function findReferenceFieldIds(
  client: NonNullable<Awaited<ReturnType<typeof getSupabaseAdmin>>>,
  collectionIds: string[],
): Promise<string[]> {
  // `reference_collection_id` is a uuid column: one virtual id (e.g. the
  // multi-asset sentinel) would make Postgres reject the whole IN list
  const safeCollectionIds = collectionIds.filter(isValidUUID);
  if (safeCollectionIds.length === 0) return [];

  const { data, error } = await client
    .from('collection_fields')
    .select('id')
    .in('reference_collection_id', safeCollectionIds)
    .in('type', ['reference', 'multi_reference'])
    .eq('is_published', false)
    .is('deleted_at', null);

  if (error) throw new Error(`Failed to fetch reference fields: ${error.message}`);
  return (data || []).map(field => field.id as string);
}

/**
 * Find pages affected by changed components, layer styles, and collections
 * in a single pass over draft page_layers (and pages.settings for collections).
 * Collection matches include pages rendering a changed collection's items
 * through a reference field of another collection.
 *
 * Searches via JSON.stringify in JS rather than PostgreSQL `::text` cast
 * through the Supabase client (which URL-encodes `::` and breaks PostgREST).
 *
 * Uses draft rows because they always exist and contain the same structural
 * references (componentId, styleId, collectionId) as published counterparts.
 */
export async function findAffectedPages(
  componentIds: string[],
  styleIds: string[],
  collectionIds: string[],
): Promise<AffectedPagesByResource> {
  const result: AffectedPagesByResource = {
    componentPageIds: [],
    stylePageIds: [],
    collectionPageIds: [],
  };

  const hasComponents = componentIds.length > 0;
  const hasStyles = styleIds.length > 0;
  const hasCollections = collectionIds.length > 0;

  if (!hasComponents && !hasStyles && !hasCollections) return result;

  const client = await getSupabaseAdmin();
  if (!client) throw new Error('Supabase client not available for dependency scan');

  // Expand component/style IDs through nested component references so that
  // editing Component B inside Component A also flags pages using A.
  const expandedComponentIds = (hasComponents || hasStyles)
    ? await expandThroughComponents(client, componentIds, styleIds)
    : [];
  const allComponentIds = [...new Set([...componentIds, ...expandedComponentIds])];
  const hasExpandedComponents = allComponentIds.length > 0;

  // Referenced items render through another collection's reference field
  // (e.g. a blog post showing its author's name), so a changed collection is
  // also matched by the IDs of the fields that reference it.
  const referenceFieldIds = hasCollections
    ? await findReferenceFieldIds(client, collectionIds)
    : [];
  const collectionSearchIds = [...collectionIds, ...referenceFieldIds];

  // A collection can be rendered through a reusable component (the binding
  // lives in the component, not the page using it). Find those components so
  // pages embedding them are invalidated on CMS publish. Treated as collection
  // matches — a page is collection-affected if its layers reference a changed
  // collection ID directly OR a component that embeds one.
  const collectionEmbeddingComponentIds = hasCollections
    ? await findComponentsEmbeddingCollections(client, collectionSearchIds)
    : [];
  const collectionMatchIds = new Set([...collectionSearchIds, ...collectionEmbeddingComponentIds]);

  // Single scan of all draft page_layers
  const { data: allLayers } = await client
    .from('page_layers')
    .select('page_id, layers')
    .eq('is_published', false)
    .is('deleted_at', null);

  if (allLayers) {
    const componentSet = new Set(allComponentIds);
    const styleSet = new Set(styleIds);
    const componentPages = new Set<string>();
    const stylePages = new Set<string>();
    const collectionPages = new Set<string>();

    for (const row of allLayers) {
      if (!row.layers) continue;
      const text = JSON.stringify(row.layers);

      if (hasExpandedComponents && !componentPages.has(row.page_id)) {
        for (const id of componentSet) {
          if (text.includes(id)) { componentPages.add(row.page_id); break; }
        }
      }
      if (hasStyles && !stylePages.has(row.page_id)) {
        for (const id of styleSet) {
          if (text.includes(id)) { stylePages.add(row.page_id); break; }
        }
      }
      if (hasCollections && !collectionPages.has(row.page_id)) {
        for (const id of collectionMatchIds) {
          if (text.includes(id)) { collectionPages.add(row.page_id); break; }
        }
      }
    }

    result.componentPageIds = Array.from(componentPages);
    result.stylePageIds = Array.from(stylePages);
    result.collectionPageIds = Array.from(collectionPages);
  }

  // Collections also need pages.settings search (dynamic template pages)
  if (hasCollections) {
    const { data: allPages } = await client
      .from('pages')
      .select('id, settings')
      .eq('is_published', false)
      .is('deleted_at', null);

    if (allPages) {
      const collectionPageSet = new Set(result.collectionPageIds);
      for (const page of allPages) {
        if (!page.settings || collectionPageSet.has(page.id)) continue;
        const text = JSON.stringify(page.settings);
        for (const id of collectionSearchIds) {
          if (text.includes(id)) { collectionPageSet.add(page.id); break; }
        }
      }
      result.collectionPageIds = Array.from(collectionPageSet);
    }
  }

  return result;
}

/**
 * Find collections whose PUBLISHED rich-text field values embed any of the
 * given (changed) components.
 *
 * Components placed inside a CMS Rich Text *field* are stored as
 * `richTextComponent` nodes inside `collection_item_values.value` — NOT in
 * `page_layers`. As a result `findAffectedPages` (which only scans page_layers
 * and pages.settings) can't see them, so editing such a component would never
 * invalidate the pages that render those CMS items. Callers map the returned
 * collection IDs back to affected pages via `findAffectedPages([], [], ids)`.
 *
 * Component IDs are expanded through nested components first, so editing a
 * component nested inside another component that is itself embedded in a CMS
 * rich-text value still flags the collection.
 */
export async function findCollectionsEmbeddingComponents(
  componentIds: string[],
): Promise<string[]> {
  if (componentIds.length === 0) return [];

  const client = await getSupabaseAdmin();
  if (!client) return [];

  // Only rich-text fields can contain embedded `richTextComponent` nodes, so
  // restrict the value scan to those fields. A field keeps the same `id`
  // across its draft/published rows (composite PK `id,is_published`), so the
  // published field id matches `collection_item_values.field_id` on published
  // values, and the field carries its own `collection_id` — no item lookup
  // needed to map a match back to a collection.
  const { data: richTextFields } = await client
    .from('collection_fields')
    .select('id, collection_id')
    .eq('type', 'rich_text')
    .eq('is_published', true)
    .is('deleted_at', null);

  if (!richTextFields || richTextFields.length === 0) return [];

  const fieldToCollection = new Map<string, string>();
  for (const f of richTextFields) {
    fieldToCollection.set(f.id as string, f.collection_id as string);
  }
  const fieldIds = Array.from(fieldToCollection.keys());

  const expanded = await expandThroughComponents(client, componentIds, []);
  const allComponentIds = [...new Set([...componentIds, ...expanded])];

  const { chunk } = await import('@/lib/utils');
  const collectionIds = new Set<string>();

  // Scan published rich-text values only. The cheap `richTextComponent` marker
  // check skips values that hold no embedded component before the id match.
  for (const idChunk of chunk(fieldIds, 500)) {
    const { data: values } = await client
      .from('collection_item_values')
      .select('field_id, value')
      .eq('is_published', true)
      .is('deleted_at', null)
      .in('field_id', idChunk);

    for (const row of values ?? []) {
      if (!row.value) continue;
      const collectionId = fieldToCollection.get(row.field_id as string);
      if (!collectionId || collectionIds.has(collectionId)) continue;
      const text = typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
      if (!text.includes('richTextComponent')) continue;
      for (const id of allComponentIds) {
        if (text.includes(id)) { collectionIds.add(collectionId); break; }
      }
    }
  }

  return Array.from(collectionIds);
}

/** Parse a rich-text field value into a Tiptap node, tolerating JSON strings. */
function parseTiptapValue(value: unknown): unknown {
  if (!value) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

/** Recursively collect `richTextComponent` component IDs from a Tiptap node. */
function collectEmbeddedComponentIds(node: unknown, ids: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  const n = node as { type?: string; attrs?: { componentId?: string }; content?: unknown[] };
  if (n.type === 'richTextComponent' && n.attrs?.componentId) {
    ids.add(n.attrs.componentId);
  }
  if (Array.isArray(n.content)) {
    for (const child of n.content) collectEmbeddedComponentIds(child, ids);
  }
}

/**
 * Map collections to the component IDs embedded in their rich-text field VALUES.
 *
 * Components dropped into a CMS Rich Text field are stored as `richTextComponent`
 * nodes inside `collection_item_values.value`, NOT in `page_layers`. A dynamic
 * page bound to such a collection renders those components, but the per-page CSS
 * generator only walks `page_layers` — so the embedded component's classes never
 * compile and the published instance renders unstyled. The CSS generator uses
 * this map to seed those components into the page's class extraction.
 *
 * @param collectionIds - Collections to scan (typically a dynamic page's bindings)
 * @param isPublished - Scan draft (false, default) or published (true) values.
 *   CSS is generated from draft data pre-publish, so draft is the correct source.
 * @returns Map of collectionId → set of embedded component IDs (only collections
 *   that actually embed at least one component are present)
 */
export async function getEmbeddedComponentIdsForCollections(
  collectionIds: string[],
  isPublished: boolean = false,
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  if (collectionIds.length === 0) return result;

  const client = await getSupabaseAdmin();
  if (!client) return result;

  const { data: richTextFields } = await client
    .from('collection_fields')
    .select('id, collection_id')
    .eq('type', 'rich_text')
    .eq('is_published', isPublished)
    .is('deleted_at', null)
    .in('collection_id', collectionIds);

  if (!richTextFields || richTextFields.length === 0) return result;

  const fieldToCollection = new Map<string, string>();
  for (const f of richTextFields) {
    fieldToCollection.set(f.id as string, f.collection_id as string);
  }
  const fieldIds = Array.from(fieldToCollection.keys());

  const { chunk } = await import('@/lib/utils');

  for (const idChunk of chunk(fieldIds, 500)) {
    const { data: values } = await client
      .from('collection_item_values')
      .select('field_id, value')
      .eq('is_published', isPublished)
      .is('deleted_at', null)
      .in('field_id', idChunk);

    for (const row of values ?? []) {
      if (!row.value) continue;
      const collectionId = fieldToCollection.get(row.field_id as string);
      if (!collectionId) continue;
      // Cheap marker check before the (more expensive) JSON parse + walk.
      const text = typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
      if (!text.includes('richTextComponent')) continue;
      const parsed = parseTiptapValue(row.value);
      if (!parsed) continue;
      const ids = result.get(collectionId) ?? new Set<string>();
      collectEmbeddedComponentIds(parsed, ids);
      if (ids.size > 0) result.set(collectionId, ids);
    }
  }

  return result;
}
