/**
 * Component Repository
 *
 * Data access layer for components (reusable layer trees)
 * Components are stored globally and can be instanced across pages
 * Supports draft/published workflow with content hash-based change detection
 */

import { getSupabaseAdmin } from '@/lib/supabase-server';
import { normalizeComponentFolder } from '@/lib/component-folder-utils';
import {
  displayChangeName,
  sortUnpublishedChanges,
  type UnpublishedChange,
} from '@/lib/publish-changes';
import { getDeletedDraftSummaries } from '@/lib/sync-utils';
import type { Component, ComponentVariant, Layer } from '@/types';
import { generateComponentContentHash } from '../hash-utils';
import { deleteTranslationsInBulk, markTranslationsIncomplete } from '@/lib/repositories/translationRepository';
import { extractLayerContentMap } from '../localisation-utils';
import { generateId } from '../utils';

/**
 * Input data for creating a new component
 */
export interface CreateComponentData {
  name: string;
  layers: Layer[];
  variables?: any[]; // Component variables for exposed properties
  variants?: ComponentVariant[]; // Optional explicit variants; defaults to a single "Default"
  folder?: string | null; // Builder folder; null/omitted = default folder
}

/**
 * Build a variants array from a layers tree. Used when seeding a new component
 * or when persisting a `variants` change so the legacy `layers` column always
 * mirrors `variants[0].layers`.
 */
function defaultVariantsFromLayers(layers: Layer[]): ComponentVariant[] {
  return [{ id: generateId('cmpvar'), name: 'Default', layers }];
}

/**
 * Get all components (draft by default, excludes soft deleted)
 */
export async function getAllComponents(isPublished: boolean = false): Promise<Component[]> {
  const client = await getSupabaseAdmin();
  if (!client) {
    throw new Error('Failed to initialize Supabase client');
  }

  const { data, error } = await client
    .from('components')
    .select('*')
    .eq('is_published', isPublished)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch components: ${error.message}`);
  }

  return data || [];
}

/**
 * Map of draft component id → name, without loading layer trees.
 */
export async function getComponentNames(): Promise<Map<string, string>> {
  const client = await getSupabaseAdmin();
  if (!client) {
    throw new Error('Failed to initialize Supabase client');
  }

  const { data, error } = await client
    .from('components')
    .select('id, name')
    .eq('is_published', false)
    .is('deleted_at', null);

  if (error) {
    throw new Error(`Failed to fetch component names: ${error.message}`);
  }

  return new Map((data || []).map((row) => [row.id as string, row.name as string]));
}

/**
 * Get a single component by ID (draft by default, excludes soft deleted)
 * With composite primary key, we need to specify is_published to get a single row
 */
export async function getComponentById(id: string, isPublished: boolean = false): Promise<Component | null> {
  const client = await getSupabaseAdmin();
  if (!client) {
    throw new Error('Failed to initialize Supabase client');
  }

  const { data, error } = await client
    .from('components')
    .select('*')
    .eq('id', id)
    .eq('is_published', isPublished)
    .is('deleted_at', null)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to fetch component: ${error.message}`);
  }

  return data;
}

/**
 * Get multiple components by IDs (drafts by default, excludes soft deleted)
 * Returns a map of component ID to component for quick lookup
 */
export async function getComponentsByIds(
  ids: string[],
  isPublished: boolean = false
): Promise<Record<string, Component>> {
  const client = await getSupabaseAdmin();
  if (!client) {
    throw new Error('Failed to initialize Supabase client');
  }

  if (ids.length === 0) {
    return {};
  }

  const { data, error } = await client
    .from('components')
    .select('*')
    .in('id', ids)
    .eq('is_published', isPublished)
    .is('deleted_at', null);

  if (error) {
    throw new Error(`Failed to fetch components: ${error.message}`);
  }

  // Convert array to map for O(1) lookup
  const componentMap: Record<string, Component> = {};
  data?.forEach(component => {
    componentMap[component.id] = component;
  });

  return componentMap;
}

/**
 * Create a new component (draft by default)
 */
export async function createComponent(
  componentData: CreateComponentData
): Promise<Component> {
  const client = await getSupabaseAdmin();
  if (!client) {
    throw new Error('Failed to initialize Supabase client');
  }

  // Variants are the source of truth; seed a "Default" variant from `layers`
  // when none was provided so older callers keep working.
  const variants: ComponentVariant[] = componentData.variants && componentData.variants.length > 0
    ? componentData.variants
    : defaultVariantsFromLayers(componentData.layers);
  const primaryLayers = variants[0]?.layers ?? componentData.layers;

  // Calculate content hash — includes every variant so non-primary variant
  // edits are detected by `getUnpublishedComponents`.
  const contentHash = generateComponentContentHash({
    name: componentData.name,
    layers: primaryLayers,
    variables: componentData.variables,
    variants,
  });

  const insertData: any = {
    name: componentData.name,
    layers: primaryLayers,
    variants,
    content_hash: contentHash,
    is_published: false,
  };

  // Include variables if provided
  if (componentData.variables?.length) {
    insertData.variables = componentData.variables;
  }

  const folder = normalizeComponentFolder(componentData.folder);
  if (folder) {
    insertData.folder = folder;
  }

  const { data, error } = await client
    .from('components')
    .insert(insertData)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create component: ${error.message}`);
  }

  return data;
}

/**
 * Update a component and recalculate content hash.
 *
 * `variants` is the source of truth for the layer trees. When `variants` is
 * provided, the legacy `layers` column is mirrored to `variants[0].layers` so
 * any reader that has not been migrated to variants still works. When only
 * `layers` is provided, `variants[0].layers` is updated in place and the rest
 * of the variants are preserved.
 */
export async function updateComponent(
  id: string,
  updates: Partial<Pick<Component, 'name' | 'layers' | 'variables' | 'variants'>>
): Promise<Component> {
  const client = await getSupabaseAdmin();
  if (!client) {
    throw new Error('Failed to initialize Supabase client');
  }

  // Get current component to merge with updates
  const current = await getComponentById(id);
  if (!current) {
    throw new Error('Component not found');
  }

  // Reconcile variants and layers so they stay in sync regardless of which one
  // the caller updated.
  const currentVariants: ComponentVariant[] = current.variants && current.variants.length > 0
    ? current.variants
    : defaultVariantsFromLayers(current.layers || []);

  let finalVariants: ComponentVariant[] = currentVariants;
  if (updates.variants !== undefined) {
    finalVariants = updates.variants.length > 0
      ? updates.variants
      : defaultVariantsFromLayers([]);
  } else if (updates.layers !== undefined) {
    finalVariants = currentVariants.map((v, i) => (i === 0 ? { ...v, layers: updates.layers! } : v));
  }
  const finalLayers = finalVariants[0]?.layers ?? (updates.layers ?? current.layers ?? []);

  // Detect removed and changed layer content for translation bookkeeping.
  // We only consider the primary variant layers because translations for the
  // other variants will be tracked through their own update events.
  const oldPrimaryLayers = current.layers || [];
  if (oldPrimaryLayers !== finalLayers) {
    const oldContentMap = extractLayerContentMap(oldPrimaryLayers, 'component', id);
    const newContentMap = extractLayerContentMap(finalLayers, 'component', id);

    const removedKeys = Object.keys(oldContentMap).filter(key => !(key in newContentMap));
    const changedKeys = Object.keys(newContentMap).filter(
      key => key in oldContentMap && oldContentMap[key] !== newContentMap[key]
    );

    if (removedKeys.length > 0) {
      await deleteTranslationsInBulk('component', id, removedKeys);
    }
    if (changedKeys.length > 0) {
      await markTranslationsIncomplete('component', id, changedKeys);
    }
  }

  // Recalculate content hash from the final, merged data.
  const finalName = updates.name !== undefined ? updates.name : current.name;
  const finalVariables = updates.variables !== undefined ? updates.variables : current.variables;
  const contentHash = generateComponentContentHash({
    name: finalName,
    layers: finalLayers,
    variables: finalVariables,
    variants: finalVariants,
  });

  const { data, error } = await client
    .from('components')
    .update({
      ...(updates.name !== undefined ? { name: updates.name } : {}),
      ...(updates.variables !== undefined ? { variables: updates.variables } : {}),
      layers: finalLayers,
      variants: finalVariants,
      content_hash: contentHash,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('is_published', false) // Update draft version only
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update component: ${error.message}`);
  }

  return data;
}

/**
 * Get published component by ID
 * Used to find the published version of a draft component
 */
export async function getPublishedComponentById(id: string): Promise<Component | null> {
  const client = await getSupabaseAdmin();
  if (!client) {
    throw new Error('Failed to initialize Supabase client');
  }

  const { data, error } = await client
    .from('components')
    .select('*')
    .eq('id', id)
    .eq('is_published', true)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to fetch published component: ${error.message}`);
  }

  return data;
}

/**
 * Publish a component (dual-record pattern like pages)
 * Creates/updates a separate published version while keeping draft untouched
 * Uses composite primary key (id, is_published) - same ID for draft and published versions
 */
export async function publishComponent(draftComponentId: string): Promise<Component> {
  const client = await getSupabaseAdmin();
  if (!client) {
    throw new Error('Failed to initialize Supabase client');
  }

  // Get the draft component
  const draftComponent = await getComponentById(draftComponentId);
  if (!draftComponent) {
    throw new Error('Draft component not found');
  }

  // Upsert published version - composite key handles insert/update automatically
  const { data, error } = await client
    .from('components')
    .upsert({
      id: draftComponent.id, // Same ID for draft and published versions
      name: draftComponent.name,
      layers: draftComponent.layers,
      variants: draftComponent.variants,
      variables: draftComponent.variables,
      content_hash: draftComponent.content_hash, // Copy hash from draft
      is_published: true,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'id,is_published',
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to publish component: ${error.message}`);
  }

  return data;
}

/**
 * Publish multiple components in batch
 * Only upserts components whose content_hash actually changed.
 * Returns the IDs of components that were modified.
 */
export async function publishComponents(componentIds: string[]): Promise<{ count: number; changedComponentIds: string[] }> {
  if (componentIds.length === 0) {
    return { count: 0, changedComponentIds: [] };
  }

  const client = await getSupabaseAdmin();
  if (!client) {
    throw new Error('Failed to initialize Supabase client');
  }

  // Batch fetch all draft components (excluding soft deleted)
  const { data: draftComponents, error: fetchError } = await client
    .from('components')
    .select('*')
    .in('id', componentIds)
    .eq('is_published', false)
    .is('deleted_at', null);

  if (fetchError) {
    throw new Error(`Failed to fetch draft components: ${fetchError.message}`);
  }

  if (!draftComponents || draftComponents.length === 0) {
    return { count: 0, changedComponentIds: [] };
  }

  // Fetch existing published versions to compare hashes
  const { data: publishedComponents } = await client
    .from('components')
    .select('id, content_hash')
    .in('id', draftComponents.map(d => d.id))
    .eq('is_published', true);

  const publishedHashById = new Map<string, string>();
  if (publishedComponents) {
    for (const pub of publishedComponents) {
      if (pub.content_hash) publishedHashById.set(pub.id, pub.content_hash);
    }
  }

  // Only upsert components that are new or have changed
  const componentsToUpsert = draftComponents
    .filter(draft => {
      const pubHash = publishedHashById.get(draft.id);
      return !pubHash || pubHash !== draft.content_hash;
    })
    .map(draft => ({
      id: draft.id,
      name: draft.name,
      layers: draft.layers,
      variants: draft.variants,
      variables: draft.variables,
      content_hash: draft.content_hash,
      is_published: true,
      updated_at: new Date().toISOString(),
    }));

  if (componentsToUpsert.length > 0) {
    const { error: upsertError } = await client
      .from('components')
      .upsert(componentsToUpsert, {
        onConflict: 'id,is_published',
      });

    if (upsertError) {
      throw new Error(`Failed to publish components: ${upsertError.message}`);
    }
  }

  return {
    count: componentsToUpsert.length,
    changedComponentIds: componentsToUpsert.map(c => c.id),
  };
}

/**
 * Get all unpublished components (excludes soft deleted)
 * A component needs publishing if:
 * - It has is_published: false (never published), OR
 * - Its draft content_hash differs from published content_hash (needs republishing)
 */
export async function getUnpublishedComponents(): Promise<Component[]> {
  const client = await getSupabaseAdmin();
  if (!client) {
    throw new Error('Failed to initialize Supabase client');
  }

  // Get all draft components (excluding soft deleted)
  const { data: draftComponents, error } = await client
    .from('components')
    .select('*')
    .eq('is_published', false)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch draft components: ${error.message}`);
  }

  if (!draftComponents || draftComponents.length === 0) {
    return [];
  }

  const unpublishedComponents: Component[] = [];

  // Batch fetch all published components for the draft IDs
  const draftIds = draftComponents.map(c => c.id);
  const { data: publishedComponents, error: publishedError } = await client
    .from('components')
    .select('*')
    .in('id', draftIds)
    .eq('is_published', true);

  if (publishedError) {
    throw new Error(`Failed to fetch published components: ${publishedError.message}`);
  }

  // Build lookup map
  const publishedById = new Map<string, Component>();
  (publishedComponents || []).forEach(c => publishedById.set(c.id, c));

  // Check each draft component
  for (const draftComponent of draftComponents) {
    // Check if published version exists
    const publishedComponent = publishedById.get(draftComponent.id);

    // If no published version exists, needs first-time publishing
    if (!publishedComponent) {
      unpublishedComponents.push(draftComponent);
      continue;
    }

    // Compare content hashes
    if (draftComponent.content_hash !== publishedComponent.content_hash) {
      unpublishedComponents.push(draftComponent);
    }
  }

  return unpublishedComponents;
}

/**
 * Named components pending publish: new, modified, and deleted.
 * Selects only id/name/hash — not layer trees.
 */
export async function getUnpublishedComponentChanges(): Promise<UnpublishedChange[]> {
  const client = await getSupabaseAdmin();
  if (!client) {
    throw new Error('Failed to initialize Supabase client');
  }

  const [draftResult, deleted] = await Promise.all([
    client
      .from('components')
      .select('id, name, content_hash')
      .eq('is_published', false)
      .is('deleted_at', null),
    getDeletedDraftSummaries('components'),
  ]);

  if (draftResult.error) {
    throw new Error(`Failed to fetch draft components: ${draftResult.error.message}`);
  }

  const drafts = draftResult.data || [];
  const publishedHashById = new Map<string, string | null>();

  if (drafts.length > 0) {
    const { data: publishedRows, error } = await client
      .from('components')
      .select('id, content_hash')
      .in('id', drafts.map((component) => component.id))
      .eq('is_published', true);

    if (error) {
      throw new Error(`Failed to fetch published components: ${error.message}`);
    }

    for (const published of publishedRows || []) {
      publishedHashById.set(published.id, published.content_hash);
    }
  }

  const changed: UnpublishedChange[] = [];
  for (const draft of drafts) {
    if (!publishedHashById.has(draft.id)) {
      changed.push({ id: draft.id, name: displayChangeName(draft.name), status: 'new' });
      continue;
    }

    if (draft.content_hash !== publishedHashById.get(draft.id)) {
      changed.push({ id: draft.id, name: displayChangeName(draft.name), status: 'modified' });
    }
  }

  const deletedChanges: UnpublishedChange[] = deleted.map((component) => ({
    id: component.id,
    name: displayChangeName(component.name),
    status: 'deleted',
  }));

  return sortUnpublishedChanges([...changed, ...deletedChanges]);
}

/**
 * Hard-delete soft-deleted draft components and their published counterparts.
 */
export async function hardDeleteSoftDeletedComponents(): Promise<{ count: number }> {
  const client = await getSupabaseAdmin();
  if (!client) {
    throw new Error('Failed to initialize Supabase client');
  }

  const { data: deletedDrafts, error } = await client
    .from('components')
    .select('id')
    .eq('is_published', false)
    .not('deleted_at', 'is', null);

  if (error) {
    throw new Error(`Failed to fetch deleted draft components: ${error.message}`);
  }

  if (!deletedDrafts || deletedDrafts.length === 0) {
    return { count: 0 };
  }

  const ids = deletedDrafts.map(c => c.id);

  const { error: pubError } = await client
    .from('components')
    .delete()
    .in('id', ids)
    .eq('is_published', true);

  if (pubError) {
    console.error('Failed to delete published components:', pubError);
  }

  const { error: draftError } = await client
    .from('components')
    .delete()
    .in('id', ids)
    .eq('is_published', false)
    .not('deleted_at', 'is', null);

  if (draftError) {
    throw new Error(`Failed to delete draft components: ${draftError.message}`);
  }

  return { count: deletedDrafts.length };
}

/**
 * Get count of unpublished components
 */
export async function getUnpublishedComponentsCount(): Promise<number> {
  const components = await getUnpublishedComponents();
  return components.length;
}

/**
 * Affected entity info returned when deleting a component
 */
export interface AffectedEntity {
  type: 'page' | 'component';
  id: string;
  name: string;
  pageId?: string; // For page_layers, this is the page_id
  previousLayers: Layer[];
  newLayers: Layer[];
}

/**
 * Result of soft deleting a component
 */
export interface SoftDeleteResult {
  component: Component;
  affectedEntities: AffectedEntity[];
}

/**
 * Find all pages and components that use a specific component
 */
export async function findEntitiesUsingComponent(componentId: string): Promise<AffectedEntity[]> {
  const client = await getSupabaseAdmin();
  if (!client) {
    throw new Error('Failed to initialize Supabase client');
  }

  const affectedEntities: AffectedEntity[] = [];

  // Find all page_layers records that contain this component
  const { data: pageLayersRecords, error: pageError } = await client
    .from('page_layers')
    .select('id, page_id, layers, is_published')
    .is('deleted_at', null)
    .eq('is_published', false); // Only draft versions

  if (pageError) {
    throw new Error(`Failed to fetch page layers: ${pageError.message}`);
  }

  // Get page names for better UX
  const pageIds = pageLayersRecords?.map(r => r.page_id).filter(Boolean) || [];
  let pageNames: Record<string, string> = {};
  if (pageIds.length > 0) {
    const { data: pages } = await client
      .from('pages')
      .select('id, name')
      .in('id', pageIds);
    pageNames = (pages || []).reduce((acc, p) => ({ ...acc, [p.id]: p.name }), {});
  }

  // Check each page_layers record
  for (const record of pageLayersRecords || []) {
    if (layersContainComponent(record.layers || [], componentId)) {
      const newLayers = await detachComponentFromLayersRecursive(record.layers || [], componentId);
      affectedEntities.push({
        type: 'page',
        id: record.id,
        pageId: record.page_id,
        name: pageNames[record.page_id] || 'Unknown Page',
        previousLayers: record.layers || [],
        newLayers,
      });
    }
  }

  // Find all components (draft versions) that contain this component
  const { data: componentRecords, error: compError } = await client
    .from('components')
    .select('id, name, layers')
    .is('deleted_at', null)
    .eq('is_published', false)
    .neq('id', componentId); // Exclude the component being deleted

  if (compError) {
    throw new Error(`Failed to fetch components: ${compError.message}`);
  }

  // Check each component
  for (const record of componentRecords || []) {
    if (layersContainComponent(record.layers || [], componentId)) {
      const newLayers = await detachComponentFromLayersRecursive(record.layers || [], componentId);
      affectedEntities.push({
        type: 'component',
        id: record.id,
        name: record.name,
        previousLayers: record.layers || [],
        newLayers,
      });
    }
  }

  return affectedEntities;
}

/**
 * Check if layers contain a reference to a specific component
 */
function layersContainComponent(layers: Layer[], componentId: string): boolean {
  for (const layer of layers) {
    if (layer.componentId === componentId) {
      return true;
    }
    if (layer.children && layersContainComponent(layer.children, componentId)) {
      return true;
    }
  }
  return false;
}

/**
 * Soft delete a component and detach it from all layers
 * Returns the deleted component and affected entities for undo/redo
 */
export async function softDeleteComponent(id: string): Promise<SoftDeleteResult> {
  const client = await getSupabaseAdmin();
  if (!client) {
    throw new Error('Failed to initialize Supabase client');
  }

  // Get the component before deleting
  const { data: component, error: fetchError } = await client
    .from('components')
    .select('*')
    .eq('id', id)
    .eq('is_published', false)
    .is('deleted_at', null)
    .single();

  if (fetchError || !component) {
    throw new Error('Component not found');
  }

  // Find all affected entities
  const affectedEntities = await findEntitiesUsingComponent(id);

  // Detach component from all affected page_layers and recompute hashes
  const { generatePageLayersHash } = await import('@/lib/hash-utils');

  for (const entity of affectedEntities) {
    if (entity.type === 'page') {
      // Fetch existing generated_css to keep hash consistent
      const { data: existing } = await client
        .from('page_layers')
        .select('generated_css')
        .eq('id', entity.id)
        .eq('is_published', false)
        .single();

      const contentHash = generatePageLayersHash({
        layers: entity.newLayers,
        generated_css: existing?.generated_css || null,
      });

      const { error: updateError } = await client
        .from('page_layers')
        .update({
          layers: entity.newLayers,
          content_hash: contentHash,
          updated_at: new Date().toISOString(),
        })
        .eq('id', entity.id)
        // CRITICAL: page_layers has composite PK (id, is_published). Without
        // this filter, the UPDATE writes the new layers + draft content_hash
        // onto the published row too. Two failure modes:
        //   1. Published row carries new layers but stale generated_css —
        //      site renders broken classes for the deleted component.
        //   2. batchPublishPageLayers compares hashes, sees draft == published
        //      (we just wrote it!), and skips the page on publish.
        .eq('is_published', false);

      if (updateError) {
        console.error(`Failed to update page_layers ${entity.id}:`, updateError);
      }
    } else if (entity.type === 'component') {
      const { error: updateError } = await client
        .from('components')
        .update({
          layers: entity.newLayers,
          updated_at: new Date().toISOString(),
        })
        .eq('id', entity.id)
        .eq('is_published', false);

      if (updateError) {
        console.error(`Failed to update component ${entity.id}:`, updateError);
      }
    }
  }

  // Soft delete the component (both draft and published versions)
  const deletedAt = new Date().toISOString();
  const { error: deleteError } = await client
    .from('components')
    .update({ deleted_at: deletedAt })
    .eq('id', id);

  if (deleteError) {
    throw new Error(`Failed to soft delete component: ${deleteError.message}`);
  }

  return {
    component: { ...component, deleted_at: deletedAt },
    affectedEntities,
  };
}

/**
 * Restore a soft-deleted component
 */
export async function restoreComponent(id: string): Promise<Component> {
  const client = await getSupabaseAdmin();
  if (!client) {
    throw new Error('Failed to initialize Supabase client');
  }

  const { data, error } = await client
    .from('components')
    .update({ deleted_at: null })
    .eq('id', id)
    .eq('is_published', false)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to restore component: ${error.message}`);
  }

  return data;
}

/**
 * Hard delete a component (permanent, use with caution)
 */
export async function deleteComponent(id: string): Promise<void> {
  const client = await getSupabaseAdmin();
  if (!client) {
    throw new Error('Failed to initialize Supabase client');
  }

  const { error } = await client
    .from('components')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(`Failed to delete component: ${error.message}`);
  }
}

/**
 * Update a component's thumbnail URL (draft only)
 */
export async function updateComponentThumbnail(id: string, thumbnailUrl: string | null): Promise<void> {
  const client = await getSupabaseAdmin();
  if (!client) {
    throw new Error('Failed to initialize Supabase client');
  }

  const { error } = await client
    .from('components')
    .update({ thumbnail_url: thumbnailUrl })
    .eq('id', id)
    .eq('is_published', false);

  if (error) {
    throw new Error(`Failed to update component thumbnail: ${error.message}`);
  }
}

/**
 * Move a draft component to a folder (null = default folder).
 * Folders are builder-only, so the content hash is left untouched.
 */
export async function updateComponentFolder(
  id: string,
  folder: string | null,
  tenantId?: string
): Promise<Component> {
  const client = await getSupabaseAdmin(tenantId);
  if (!client) {
    throw new Error('Failed to initialize Supabase client');
  }

  const { data, error } = await client
    .from('components')
    .update({ folder: normalizeComponentFolder(folder) })
    .eq('id', id)
    .eq('is_published', false)
    .is('deleted_at', null)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to move component: ${error.message}`);
  }

  return data;
}

/**
 * Rename a folder on every draft component in it. Passing null as the new
 * name removes the folder (its components move to the default folder).
 * Returns the number of components moved.
 */
export async function renameComponentFolder(
  fromFolder: string,
  toFolder: string | null,
  tenantId?: string
): Promise<number> {
  const from = normalizeComponentFolder(fromFolder);
  if (!from) {
    throw new Error('The default folder cannot be renamed');
  }

  const client = await getSupabaseAdmin(tenantId);
  if (!client) {
    throw new Error('Failed to initialize Supabase client');
  }

  const { data, error } = await client
    .from('components')
    .update({ folder: normalizeComponentFolder(toFolder) })
    .eq('folder', from)
    .eq('is_published', false)
    .select('id');

  if (error) {
    throw new Error(`Failed to rename component folder: ${error.message}`);
  }

  return data?.length ?? 0;
}

/**
 * Helper function to recursively remove componentId from layers
 */
/**
 * Detach component from layers - async wrapper that fetches component data
 * Uses the shared utility function from component-utils.ts
 */
async function detachComponentFromLayersRecursive(layers: Layer[], componentId: string): Promise<Layer[]> {
  const { detachComponentFromLayers } = await import('../component-utils');

  // Get the component data to extract its layers
  const component = await getComponentById(componentId);

  // Use the shared utility function
  return detachComponentFromLayers(layers, componentId, component || undefined);
}
