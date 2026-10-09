import { getKnexClient, closeKnexClient, testKnexConnection } from '../knex-client';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { STORAGE_BUCKET, STORAGE_FOLDERS } from '@/lib/asset-constants';
import { migrations } from '../migrations-loader';
import { guardKnexForMigrationReplay } from '@/lib/migration-replay-guard';
import { YCODE_EXTERNAL_API_URL } from '@/lib/config';

/**
 * Tables to truncate when applying a template.
 * Order matters for foreign key constraints (children first).
 */
const TABLES_TO_TRUNCATE = [
  'translations',
  'locales',
  'versions',
  'collection_item_values',
  'collection_items',
  'collection_fields',
  'collections',
  'layer_styles',
  'components',
  'page_layers',
  'pages',
  'page_folders',
  // Typed CSS variables (children first so FKs cascade cleanly)
  'css_variable_values',
  'css_variables',
  'css_variable_groups',
  'css_variable_set_modes',
  'css_variable_sets',
  'color_variables',
  'fonts',
];

export interface TemplateCategory {
  id: string;
  name: string;
  description: string;
  order: number;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  preview: string;
  stats?: {
    pages: number;
    components: number;
    collections: number;
  };
  categoryId: string | null;
  livePreviewUrl: string | null;
}

export interface TemplateDetails extends Template {
  version: string;
  createdAt: string;
  tables: string[];
}

export interface ApplyTemplateResult {
  success: boolean;
  templateName?: string;
  error?: string;
}

/**
 * List available templates and categories from the template service
 */
export async function listTemplatesWithCategories(): Promise<{
  templates: Template[];
  categories: TemplateCategory[];
}> {
  const response = await fetch(`${YCODE_EXTERNAL_API_URL}/api/templates`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('Failed to fetch templates');
  }

  const data = await response.json();
  return {
    templates: data.templates || [],
    categories: data.categories || [],
  };
}

/**
 * List available templates from the template service
 * @deprecated Use listTemplatesWithCategories instead
 */
export async function listTemplates(): Promise<Template[]> {
  const { templates } = await listTemplatesWithCategories();
  return templates;
}

/**
 * List template categories from the template service
 * @deprecated Use listTemplatesWithCategories instead
 */
export async function listCategories(): Promise<TemplateCategory[]> {
  const { categories } = await listTemplatesWithCategories();
  return categories;
}

/**
 * Get template details from the template service
 */
export async function getTemplate(id: string): Promise<TemplateDetails | null> {
  const response = await fetch(`${YCODE_EXTERNAL_API_URL}/api/templates/${id}`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error('Failed to fetch template');
  }

  const data = await response.json();
  return data.template;
}

/**
 * Copy template assets from the template-service CDN to the user's storage.
 * This ensures assets are owned by the user and won't break if template is deleted.
 *
 * @param knex - Knex transaction or client
 */
async function copyTemplateAssetsToUserStorage(knex: ReturnType<typeof getKnexClient> extends Promise<infer T> ? T : never): Promise<void> {
  const supabase = await getSupabaseAdmin();
  if (!supabase) {
    console.warn('[copyTemplateAssets] Supabase not configured, skipping asset copy');
    return;
  }

  // Find all template assets that need to be copied (have public_url but no storage_path)
  const templateAssets = await knex('assets')
    .whereNotNull('public_url')
    .whereNull('storage_path')
    .where('source', 'like', 'template:%')
    .select('id', 'filename', 'public_url', 'mime_type');

  if (templateAssets.length === 0) {
    return;
  }

  for (const asset of templateAssets) {
    try {
      // Download from template-service CDN with timeout
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      let response: Response;
      try {
        response = await fetch(asset.public_url, { signal: controller.signal });
      } catch (fetchErr) {
        clearTimeout(timeout);
        console.warn(`[copyTemplateAssets] Failed to fetch ${asset.filename}:`, fetchErr);
        continue;
      }
      clearTimeout(timeout);

      if (!response.ok) {
        console.warn(`[copyTemplateAssets] Failed to download ${asset.filename}: ${response.status}`);
        continue;
      }

      const blob = await response.blob();
      const buffer = Buffer.from(await blob.arrayBuffer());

      // Generate unique storage path
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 15);
      const extension = asset.filename.split('.').pop() || 'bin';
      const storagePath = `${STORAGE_FOLDERS.WEBSITE}/${timestamp}-${random}.${extension}`;

      // Upload to user's storage
      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, buffer, {
          contentType: asset.mime_type || 'application/octet-stream',
          cacheControl: '3600',
          upsert: false,
        });

      if (error) {
        console.warn(`[copyTemplateAssets] Failed to upload ${asset.filename}:`, error);
        continue;
      }

      // Get new public URL
      const { data: urlData } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(data.path);

      // Update asset record with new storage path and URL
      await knex('assets')
        .where('id', asset.id)
        .update({
          storage_path: data.path,
          public_url: urlData.publicUrl,
        });
    } catch (err) {
      console.warn(`[copyTemplateAssets] Error copying ${asset.filename}:`, err);
    }
  }

  // Copy custom font files (fonts with url from template CDN but no storage_path)
  const fontsTableExists = await knex.schema.hasTable('fonts');
  if (fontsTableExists) {
    const templateFonts = await knex('fonts')
      .whereNotNull('url')
      .whereNull('storage_path')
      .select('id', 'name', 'kind', 'url');

    for (const font of templateFonts) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        let response: Response;
        try {
          response = await fetch(font.url, { signal: controller.signal });
        } catch (fetchErr) {
          clearTimeout(timeout);
          console.warn(`[copyTemplateAssets] Failed to fetch font ${font.name}:`, fetchErr);
          continue;
        }
        clearTimeout(timeout);

        if (!response.ok) {
          console.warn(`[copyTemplateAssets] Failed to download font ${font.name}: ${response.status}`);
          continue;
        }

        const blob = await response.blob();
        const buffer = Buffer.from(await blob.arrayBuffer());

        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 15);
        const extension = font.kind || 'woff2';
        const storagePath = `${STORAGE_FOLDERS.WEBSITE}/fonts/${timestamp}-${random}.${extension}`;

        const { data, error } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(storagePath, buffer, {
            contentType: extension === 'woff2' ? 'font/woff2' : 'font/ttf',
            cacheControl: '31536000',
            upsert: false,
          });

        if (error) {
          console.warn(`[copyTemplateAssets] Failed to upload font ${font.name}:`, error);
          continue;
        }

        const { data: urlData } = supabase.storage
          .from(STORAGE_BUCKET)
          .getPublicUrl(data.path);

        await knex('fonts')
          .where('id', font.id)
          .update({
            storage_path: data.path,
            url: urlData.publicUrl,
          });
      } catch (err) {
        console.warn(`[copyTemplateAssets] Error copying font ${font.name}:`, err);
      }
    }
  }
}

/**
 * Get migrations that need to be run for a template.
 * Returns all migrations that come AFTER the template's lastMigration.
 *
 * @param templateLastMigration - The last migration the template was created with
 * @returns Array of migrations to run
 */
function getPendingMigrationsForTemplate(
  templateLastMigration: string | null | undefined
): typeof migrations {
  // If no lastMigration, return all migrations (template predates tracking)
  if (!templateLastMigration) {
    return migrations;
  }

  // Find the index of the template's last migration
  const templateIndex = migrations.findIndex(
    (m) => m.name === templateLastMigration
  );

  if (templateIndex === -1) {
    // Migration not found - could be a newer version or renamed
    // Conservative approach: assume template is up-to-date
    return [];
  }

  // Return all migrations AFTER the template's last migration
  return migrations.slice(templateIndex + 1);
}

/**
 * Run pending migrations for a template.
 * This ensures template data is transformed to match the current schema.
 *
 * @param knex - Knex client
 * @param templateLastMigration - The last migration the template was created with
 */
async function runPendingMigrationsForTemplate(
  knex: Awaited<ReturnType<typeof getKnexClient>>,
  templateLastMigration: string | null | undefined
): Promise<void> {
  const pendingMigrations = getPendingMigrationsForTemplate(templateLastMigration);

  if (pendingMigrations.length === 0) {
    return;
  }

  // Destructive DDL is blocked: these up()s replay against live data.
  const guardedKnex = guardKnexForMigrationReplay(knex);

  for (const migration of pendingMigrations) {
    try {
      await migration.up(guardedKnex);
    } catch (error) {
      // Log the error but continue - migrations should be idempotent
      // Schema changes (ADD COLUMN IF NOT EXISTS) will no-op
      // Data changes should use WHERE clauses that are safe on new data
      console.warn(`[runPendingMigrations] Migration ${migration.name} failed (may be expected for schema-only migrations):`, error);
    }
  }
}

/**
 * Apply a template to the database
 *
 * This will:
 * 1. Fetch the processed SQL from the template service
 * 2. Clear previous template assets (keep user uploads)
 * 3. Truncate content tables
 * 4. Execute the template INSERT statements
 * 5. Copy template assets to user's storage
 *
 * @param templateId - The template ID to apply
 * @param tenantId - Optional tenant ID for cloud multi-tenant
 */
export async function applyTemplate(
  templateId: string,
  tenantId?: string
): Promise<ApplyTemplateResult> {
  // Test database connection first
  const canConnect = await testKnexConnection();
  if (!canConnect) {
    return {
      success: false,
      error: 'Cannot connect to database. Please check your configuration.',
    };
  }

  const knex = await getKnexClient();

  try {
    // 1. Fetch processed SQL from template service
    const response = await fetch(
      `${YCODE_EXTERNAL_API_URL}/api/templates/${templateId}/apply`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      return {
        success: false,
        error: error.error || 'Failed to fetch template',
      };
    }

    const { template, sql } = await response.json();

    // 2. Execute in a transaction for atomicity
    await knex.transaction(async (trx) => {
      // Disable FK constraints temporarily for truncation
      await trx.raw('SET session_replication_role = replica');

      // 2a. Clear previous template assets (keep user uploads) - only if table exists
      const assetsTableExists = await trx.schema.hasTable('assets');
      if (assetsTableExists) {
        await trx.raw(sql.clearPreviousTemplate);
      }

      // 2b. Clean up empty asset folders from previous template - only if tables exist
      const assetFoldersTableExists = await trx.schema.hasTable('asset_folders');
      if (assetFoldersTableExists && assetsTableExists) {
        await trx.raw(`
          DELETE FROM asset_folders
          WHERE id NOT IN (
            SELECT DISTINCT asset_folder_id FROM assets
            WHERE asset_folder_id IS NOT NULL
          )
          AND id NOT IN (
            SELECT DISTINCT asset_folder_id FROM asset_folders
            WHERE asset_folder_id IS NOT NULL
          )
        `);
      }

      // 2c. Truncate content tables (only tables that exist)
      const existingTables: string[] = [];
      for (const table of TABLES_TO_TRUNCATE) {
        const exists = await trx.schema.hasTable(table);
        if (exists) {
          existingTables.push(table);
        }
      }
      if (existingTables.length > 0) {
        await trx.raw(`TRUNCATE ${existingTables.join(', ')} CASCADE;`);
      }

      // 2d. Insert template data
      await trx.raw(sql.insert);

      // Re-enable FK constraints
      await trx.raw('SET session_replication_role = DEFAULT');
    });

    // 3. Copy template assets to user's storage (outside transaction)
    // This happens after template data is committed, so partial asset failures
    // won't roll back the template
    await copyTemplateAssetsToUserStorage(knex);

    // 4. Run any pending migrations for this template
    // This transforms template data to match the current schema
    // (migrations should be idempotent - schema changes no-op, data changes use safe WHERE clauses)
    await runPendingMigrationsForTemplate(knex, template.lastMigration);

    return {
      success: true,
      templateName: template.name,
    };
  } catch (error) {
    console.error('[applyTemplate] Failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Template application failed',
    };
  } finally {
    await closeKnexClient();
  }
}
