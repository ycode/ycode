import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

import { createCollection, getAllCollections } from '@/lib/repositories/collectionRepository';
import { createField } from '@/lib/repositories/collectionFieldRepository';
import { createItemsBulk, enrichItemsWithStatus } from '@/lib/repositories/collectionItemRepository';
import { insertValuesBulk } from '@/lib/repositories/collectionItemValueRepository';
import { BUILT_IN_FIELDS_END, BUILT_IN_FIELDS_START, findStatusFieldId } from '@/lib/collection-field-utils';
import { createAsset } from '@/lib/repositories/assetRepository';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { STORAGE_BUCKET, STORAGE_FOLDERS } from '@/lib/asset-constants';
import { getSampleCollectionById } from '@/lib/sample-collections';
import type { SampleCollectionDefinition, SampleItemDefinition } from '@/lib/sample-collections';
import type { Asset, Collection, CollectionField, CollectionItemWithValues } from '@/types';
const SAMPLES_DIR = path.join(process.cwd(), 'storage', 'collections');

/**
 * Sample Collection Service
 *
 * Creates a fully populated collection from a sample template.
 * Uses batch inserts for items and values for performance.
 */

export interface SampleCollectionResult {
  collection: Collection;
  fields: CollectionField[];
  assets: Asset[];
  items: CollectionItemWithValues[];
}

/**
 * Create a sample collection with fields and items from a template.
 * @param sampleId - ID of the sample template (e.g. 'blog-posts')
 * @param existingNames - Names of existing collections (to avoid duplicates)
 */
export async function createSampleCollection(
  sampleId: string,
  existingNames: string[] = []
): Promise<SampleCollectionResult> {
  const sample = getSampleCollectionById(sampleId);
  if (!sample) {
    throw new Error(`Sample collection "${sampleId}" not found`);
  }

  // Generate unique name if needed
  const collectionName = getUniqueName(sample.name, existingNames);

  // Compute next order by finding the max order among existing collections
  const existing = await getAllCollections({ is_published: false, deleted: false });
  const maxOrder = existing.reduce((max, c) => Math.max(max, c.order ?? 0), -1);

  // 1. Create collection at the end of the list
  const collection = await createCollection({
    name: collectionName,
    order: maxOrder + 1,
    is_published: false,
  });

  // 2. Create all fields with sequential ordering: start built-ins, custom, end built-ins.
  // Built-in fields persist their `key` (which locks them from editing/deletion), while
  // custom fields persist `key: null` so they remain editable like user-created fields.
  // The sample key is retained separately (`lookupKey`) only to map sample item values.
  const customFieldsReordered = sample.customFields.map((f, i) => ({
    ...f,
    order: BUILT_IN_FIELDS_START.length + i,
    lookupKey: f.key,
    persistKey: null as string | null,
  }));
  const startFields = BUILT_IN_FIELDS_START.map((f, i) => ({ ...f, order: i, lookupKey: f.key, persistKey: f.key }));
  const endFieldsReordered = BUILT_IN_FIELDS_END.map((f, i) => ({
    ...f,
    order: BUILT_IN_FIELDS_START.length + sample.customFields.length + i,
    lookupKey: f.key,
    persistKey: f.key,
  }));
  const allFieldDefs = [...startFields, ...customFieldsReordered, ...endFieldsReordered];

  const fields = await Promise.all(
    allFieldDefs.map(field =>
      createField({
        name: field.name,
        key: field.persistKey,
        type: field.type,
        fillable: field.fillable,
        hidden: field.hidden,
        order: field.order,
        is_computed: field.is_computed,
        collection_id: collection.id,
        is_published: false,
      })
    )
  );

  // 3. Build field key-to-id lookup using the sample key (fields share the order of allFieldDefs)
  const fieldKeyToId: Record<string, string> = {};
  allFieldDefs.forEach((def, i) => {
    if (def.lookupKey) {
      fieldKeyToId[def.lookupKey] = fields[i].id;
    }
  });

  // 4. Create assets for image fields in parallel
  const { assetIdMap, assets } = await createImageAssets(sample.items, fieldKeyToId);

  // 5. Batch create items
  const now = new Date().toISOString();
  const items = await createItemsBulk(
    sample.items.map((_, index) => ({
      collection_id: collection.id,
      manual_order: index + 1,
      is_published: false,
    }))
  );

  // 6. Batch insert all values (text + image asset IDs) in one query
  const valuesToInsert = buildItemValues(sample, items, fieldKeyToId, assetIdMap, now);
  if (valuesToInsert.length > 0) {
    await insertValuesBulk(valuesToInsert);
  }

  // 7. Assemble items with values for the frontend (avoids a second API call)
  const itemsWithValues: CollectionItemWithValues[] = items.map(item => {
    const itemValues: Record<string, string> = {};
    for (const v of valuesToInsert) {
      if (v.item_id === item.id && v.value != null) {
        itemValues[v.field_id] = v.value;
      }
    }
    return { ...item, values: itemValues };
  });

  // 8. Enrich items with computed status values
  const statusFieldId = findStatusFieldId(fields);
  await enrichItemsWithStatus(itemsWithValues, collection.id, statusFieldId);

  return { collection, fields, assets, items: itemsWithValues };
}

/**
 * Find an existing draft asset by filename and source, or upload and create a new one.
 * Avoids duplicate storage files and DB records for the same sample image.
 */
async function getOrUploadSampleImage(filename: string): Promise<Asset> {
  const supabase = await getSupabaseAdmin();
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  // Check for existing draft asset with the same filename and source
  const { data: existing } = await supabase
    .from('assets')
    .select('*')
    .eq('filename', filename)
    .eq('source', 'sample-collection')
    .eq('is_published', false)
    .is('deleted_at', null)
    .limit(1)
    .single();

  if (existing) return existing as Asset;

  // No existing asset — upload and create
  const filePath = path.join(SAMPLES_DIR, filename);
  const buffer = await fs.readFile(filePath);

  const metadata = await sharp(buffer).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  const ext = path.extname(filename).slice(1) || 'jpg';
  const storagePath = `${STORAGE_FOLDERS.WEBSITE}/${timestamp}-${random}.${ext}`;

  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buffer, {
      cacheControl: '3600',
      upsert: false,
      contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
    });

  if (error) {
    throw new Error(`Failed to upload sample image "${filename}": ${error.message}`);
  }

  const { data: urlData } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(data.path);

  return createAsset({
    filename,
    source: 'sample-collection',
    storage_path: data.path,
    public_url: urlData.publicUrl,
    file_size: buffer.length,
    mime_type: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
    width,
    height,
    is_published: false,
  });
}

/**
 * Create assets for all image fields across all items.
 * Deduplicates uploads -- if the same filename appears multiple times, it's uploaded once.
 * Returns an ID map ("itemIndex:fieldKey" -> asset ID) and the full asset objects.
 */
async function createImageAssets(
  sampleItems: SampleItemDefinition[],
  fieldKeyToId: Record<string, string>
): Promise<{ assetIdMap: Record<string, string>; assets: Asset[] }> {
  // Collect unique filenames and which entries reference them
  const entries: Array<{ key: string; filename: string }> = [];

  sampleItems.forEach((item, index) => {
    if (!item.images) return;
    for (const [fieldKey, filename] of Object.entries(item.images)) {
      if (!fieldKeyToId[fieldKey]) continue;
      entries.push({ key: `${index}:${fieldKey}`, filename });
    }
  });

  if (entries.length === 0) return { assetIdMap: {}, assets: [] };

  // Deduplicate: upload each unique filename once
  const uniqueFilenames = [...new Set(entries.map(e => e.filename))];
  const uploadedAssets = await Promise.all(uniqueFilenames.map(getOrUploadSampleImage));

  const filenameToAsset: Record<string, Asset> = {};
  uniqueFilenames.forEach((fn, i) => {
    filenameToAsset[fn] = uploadedAssets[i];
  });

  // Build ID map
  const assetIdMap: Record<string, string> = {};
  for (const entry of entries) {
    assetIdMap[entry.key] = filenameToAsset[entry.filename].id;
  }

  return { assetIdMap, assets: uploadedAssets };
}

/**
 * Build flat array of item values for bulk insert.
 * Merges built-in auto-values, sample text values, and image asset IDs.
 * Values are stored as-is (rich_text content is already in TipTap JSON format).
 */
function buildItemValues(
  sample: SampleCollectionDefinition,
  items: Array<{ id: string }>,
  fieldKeyToId: Record<string, string>,
  imageAssetIds: Record<string, string>,
  now: string
): Array<{ item_id: string; field_id: string; value: string | null; is_published: boolean }> {
  const values: Array<{ item_id: string; field_id: string; value: string | null; is_published: boolean }> = [];

  items.forEach((item, index) => {
    const sampleItem = sample.items[index];
    if (!sampleItem) return;

    // Auto-generated built-in values
    const autoValues: Record<string, string> = {
      id: String(index + 1),
      created_at: now,
      updated_at: now,
    };

    // Merge auto-values with sample item text values
    const allValues: Record<string, string> = { ...autoValues, ...sampleItem.values };

    // Add image asset IDs
    if (sampleItem.images) {
      for (const fieldKey of Object.keys(sampleItem.images)) {
        const assetId = imageAssetIds[`${index}:${fieldKey}`];
        if (assetId) {
          allValues[fieldKey] = assetId;
        }
      }
    }

    for (const [key, value] of Object.entries(allValues)) {
      const fieldId = fieldKeyToId[key];
      if (fieldId && value != null) {
        values.push({
          item_id: item.id,
          field_id: fieldId,
          value,
          is_published: false,
        });
      }
    }
  });

  return values;
}

/** Generate a unique collection name by appending a number if needed */
function getUniqueName(baseName: string, existingNames: string[]): string {
  if (!existingNames.includes(baseName)) return baseName;

  let counter = 1;
  while (existingNames.includes(`${baseName} ${counter}`)) {
    counter++;
  }
  return `${baseName} ${counter}`;
}
