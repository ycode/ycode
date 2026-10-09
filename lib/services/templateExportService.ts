import { getKnexClient, closeKnexClient, testKnexConnection } from '../knex-client';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { STORAGE_BUCKET } from '@/lib/asset-constants';
import { YCODE_EXTERNAL_API_URL } from '@/lib/config';

// API key for uploading templates to the shared template service
const TEMPLATE_UPLOAD_API_KEY =
  process.env.TEMPLATE_UPLOAD_API_KEY || 'f0c716a7-c78e-467d-81c2-cbe774659e60';

/**
 * Tables to export (order matters for foreign key constraints).
 * Parent tables must be exported before child tables.
 */
const EXPORT_TABLES = [
  // Asset-related (no FKs to other exportable tables)
  'asset_folders',
  'assets',
  // Design tokens (typed CSS variables — parents first for FKs)
  'css_variable_sets',
  'css_variable_set_modes',
  'css_variable_groups',
  'css_variables',
  'css_variable_values',
  // Legacy color variables (kept for backward compat with older templates)
  'color_variables',
  'fonts',
  // Page-related
  'page_folders',
  'pages',
  'page_layers',
  // Styling
  'layer_styles',
  // Components
  'components',
  // Collections (CMS)
  'collections',
  'collection_fields',
  'collection_items',
  'collection_item_values',
  // Localization
  'locales',
  'translations',
];

/**
 * Columns to exclude from export by table.
 * These are either auto-generated or user-specific.
 */
const EXCLUDED_COLUMNS: Record<string, string[]> = {
  assets: ['storage_path'], // Template assets use public_url instead
  fonts: ['storage_path', 'file_hash'], // Custom font files use url instead
};

/**
 * Columns that contain UUIDs (for placeholder conversion).
 * This includes all primary keys and foreign keys that reference other exported tables.
 */
const UUID_COLUMNS = [
  // Primary keys
  'id',
  'uuid', // collections.uuid has a global UNIQUE constraint

  // Page-related FKs
  'page_id',
  'page_folder_id',
  // Asset-related FKs
  'asset_folder_id',
  // Component FK
  'component_id',
  // Collection-related FKs
  'collection_id',
  'collection_field_id',
  'collection_item_id',
  'reference_collection_id', // FK in collection_fields
  'item_id',                 // FK in collection_item_values
  'field_id',                // FK in collection_item_values
  // Localization FKs
  'locale_id',
  'source_id',               // FK in translations (stored as string but contains UUIDs)
  // Styling FK
  'layer_style_id',
  // CSS variables FKs
  'set_id',
  'mode_id',
  'group_id',
  'css_variable_id',
];

/**
 * Columns that may contain UUIDs or JSON with UUIDs as text.
 * These need special parsing to extract and replace UUIDs.
 */
const UUID_VALUE_COLUMNS = [
  'value', // collection_item_values - may contain UUID or JSON array of UUIDs for reference fields
];

export interface TemplateManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  createdAt: string;
  tables: string[];
  stats: {
    pages: number;
    components: number;
    collections: number;
  };
  submitterEmail?: string;
  lastMigration?: string;
}

export interface ExportResult {
  success: boolean;
  manifest?: TemplateManifest;
  sql?: string;
  assets?: Array<{
    filename: string;
    base64: string;
    mimeType: string;
  }>;
  error?: string;
}

/**
 * Check if a string is a valid UUID
 */
function isUUID(str: string): boolean {
  if (typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    str
  );
}

/**
 * Recursively replace UUIDs in an object/array with placeholders.
 * This ensures UUIDs embedded in JSONB columns are also converted.
 */
function replaceUuidsInValue(
  value: unknown,
  toPlaceholder: (uuid: string) => string
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  // Handle strings - check if it's a UUID
  if (typeof value === 'string') {
    if (isUUID(value)) {
      return toPlaceholder(value);
    }
    return value;
  }

  // Handle arrays - recursively process each element
  if (Array.isArray(value)) {
    return value.map((item) => replaceUuidsInValue(item, toPlaceholder));
  }

  // Handle objects - recursively process each property
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = replaceUuidsInValue(val, toPlaceholder);
    }
    return result;
  }

  // Return primitives as-is
  return value;
}

/**
 * Format a value for SQL INSERT statement
 * @param value - The value to format
 * @param toPlaceholder - Optional function to convert UUIDs to placeholders (for JSONB)
 */
function formatSqlValue(
  value: unknown,
  toPlaceholder?: (uuid: string) => string
): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') return String(value);
  if (value instanceof Date) return `'${value.toISOString()}'`;

  // Handle objects/arrays (JSONB)
  if (typeof value === 'object') {
    // Replace UUIDs in the object if we have a placeholder function
    const processedValue = toPlaceholder
      ? replaceUuidsInValue(value, toPlaceholder)
      : value;
    const json = JSON.stringify(processedValue);
    // Escape single quotes in JSON
    return `'${json.replace(/'/g, "''")}'`;
  }

  // String - escape single quotes
  const str = String(value);
  return `'${str.replace(/'/g, "''")}'`;
}

/**
 * Get the name of the latest migration that has been run.
 * This is stored with the template so we can run any newer migrations
 * when the template is applied.
 */
async function getLatestMigrationName(
  knex: Awaited<ReturnType<typeof getKnexClient>>
): Promise<string | null> {
  try {
    // Check if migrations table exists
    const tableExists = await knex.schema.hasTable('migrations');
    if (!tableExists) {
      return null;
    }

    const result = await knex('migrations')
      .orderBy('migration_time', 'desc')
      .first('name');

    return result?.name || null;
  } catch (error) {
    console.error('[getLatestMigrationName] Failed:', error);
    return null;
  }
}

/**
 * Export the current database content as template SQL
 *
 * @param templateId - ID for the template (used in asset source)
 * @param templateName - Display name for the template
 * @param description - Template description
 */
export async function exportTemplateSQL(
  templateId: string,
  templateName: string,
  description = '',
  submitterEmail = ''
): Promise<ExportResult> {
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
    const sqlStatements: string[] = [];
    const uuidMapping = new Map<string, string>();
    let uuidCounter = 0;

    const stats = { pages: 0, components: 0, collections: 0 };

    /**
     * Convert a real UUID to a placeholder identifier
     */
    const toPlaceholder = (uuid: string): string => {
      if (!uuidMapping.has(uuid)) {
        uuidMapping.set(uuid, `{{UUID:id-${++uuidCounter}}}`);
      }
      return uuidMapping.get(uuid)!;
    };

    // Add header comment
    sqlStatements.push(`-- Template: ${templateName}`);
    sqlStatements.push(`-- Generated: ${new Date().toISOString()}`);
    sqlStatements.push('');

    // Export each table
    for (const table of EXPORT_TABLES) {
      // Check if table exists
      const tableExists = await knex.schema.hasTable(table);
      if (!tableExists) {
        continue;
      }

      // Query all rows (filter by deleted_at only if column exists)
      let query = knex(table);

      // Only filter by deleted_at if the column exists
      const hasDeletedAt = await knex.schema.hasColumn(table, 'deleted_at');
      if (hasDeletedAt) {
        query = query.whereNull('deleted_at');
      }

      // For is_published tables, only export draft versions (is_published = false)
      const hasIsPublished = await knex.schema.hasColumn(table, 'is_published');
      if (hasIsPublished) {
        query = query.where('is_published', false);
      }

      // For assets table, include all user-uploaded assets but exclude those
      // sourced from other templates (which would have stale CDN URLs)
      if (table === 'assets') {
        query = query.where(function() {
          this.whereNull('source')
            .orWhereNot('source', 'like', 'template:%');
        });
      }

      // Check if tenant_id exists (cloud vs opensource)
      const hasTenantId = await knex.schema.hasColumn(table, 'tenant_id');

      const rows = await query.select('*');

      if (rows.length === 0) {
        continue;
      }

      // Track stats
      if (table === 'pages') stats.pages = rows.length;
      if (table === 'components') stats.components = rows.length;
      if (table === 'collections') stats.collections = rows.length;

      // Add table header comment
      sqlStatements.push(`-- ${table} (${rows.length} rows)`);

      // Get column names (excluding system and excluded columns)
      const excludedCols = [
        ...(EXCLUDED_COLUMNS[table] || []),
        'deleted_at', // Never export deleted_at
        'created_at', // Let database set these
        'updated_at',
        'content_hash', // Will be regenerated
        'tenant_id', // Handled separately
      ];

      const columns = Object.keys(rows[0]).filter(
        (col) => !excludedCols.includes(col)
      );

      // Generate INSERT statements
      for (const row of rows) {
        const values = columns.map((col) => {
          let value = row[col];

          // Convert UUIDs to placeholders (for dedicated UUID columns)
          if (UUID_COLUMNS.includes(col) && value && isUUID(value)) {
            value = toPlaceholder(value);
          }

          // Handle columns that may contain UUIDs or JSON with UUIDs as text
          // (e.g., collection_item_values.value for reference fields)
          if (UUID_VALUE_COLUMNS.includes(col) && value && typeof value === 'string') {
            // Check if it's a plain UUID
            if (isUUID(value)) {
              value = toPlaceholder(value);
            } else {
              // Try to parse as JSON (for multi-reference arrays like ["uuid1", "uuid2"])
              try {
                const parsed = JSON.parse(value);
                if (Array.isArray(parsed) || typeof parsed === 'object') {
                  // Recursively replace UUIDs in the parsed value
                  const replaced = replaceUuidsInValue(parsed, toPlaceholder);
                  value = JSON.stringify(replaced);
                }
              } catch {
                // Not valid JSON, leave as-is
              }
            }
          }

          // Mark assets as template-sourced
          if (table === 'assets' && col === 'source') {
            value = `template:${templateId}`;
          }

          // Replace asset public_url with placeholder for template CDN replacement
          // Only for user uploads (has storage_path), not seeded assets
          if (table === 'assets' && col === 'public_url' && row.filename && row.storage_path) {
            value = `{{ASSET_URL:${row.filename}}}`;
          }

          // Replace custom font url with placeholder (same pattern as assets)
          if (table === 'fonts' && col === 'url' && row.storage_path) {
            const fontFilename = `font-${row.name || row.id}.${row.kind || 'woff2'}`;
            value = `{{ASSET_URL:${fontFilename}}}`;
          }

          // Pass toPlaceholder to formatSqlValue for JSONB columns
          // This ensures UUIDs embedded in JSON are also replaced
          return formatSqlValue(value, toPlaceholder);
        });

        // Add tenant_id placeholder for cloud compatibility (only if column exists)
        const finalColumns = hasTenantId ? [...columns, 'tenant_id'] : columns;
        const finalValues = hasTenantId ? [...values, "'{{TENANT_ID}}'"] : values;

        sqlStatements.push(
          `INSERT INTO ${table} (${finalColumns.map(col => `"${col}"`).join(', ')}) VALUES (${finalValues.join(', ')});`
        );
      }

      sqlStatements.push('');
    }

    // Post-process: replace any remaining occurrences of mapped UUIDs in the SQL.
    // This catches UUIDs embedded inside string values that the column-level
    // and JSONB-level replacement missed — e.g. color variable IDs in CSS
    // "var(--uuid)", layer IDs in translation content_keys "layer:uuid:text", etc.
    let finalSql = sqlStatements.join('\n');
    for (const [uuid, placeholder] of uuidMapping) {
      if (finalSql.includes(uuid)) {
        finalSql = finalSql.replaceAll(uuid, placeholder);
      }
    }

    // Get the latest migration name for template versioning
    const lastMigration = await getLatestMigrationName(knex);

    // Build manifest
    const manifest: TemplateManifest = {
      id: templateId,
      name: templateName,
      description,
      version: '1.0.0',
      createdAt: new Date().toISOString().split('T')[0],
      tables: EXPORT_TABLES.filter((t) =>
        finalSql.includes(`INSERT INTO ${t}`)
      ),
      stats,
      submitterEmail: submitterEmail || undefined,
      lastMigration: lastMigration || undefined,
    };

    return {
      success: true,
      manifest,
      sql: finalSql,
    };
  } catch (error) {
    console.error('[exportTemplateSQL] Failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Export failed',
    };
  } finally {
    await closeKnexClient();
  }
}

/**
 * Collect assets from Supabase Storage for template export.
 * Includes user-uploaded images and custom font files.
 */
export async function collectTemplateAssets(): Promise<
  Array<{
    filename: string;
    base64: string;
    mimeType: string;
  }>
  > {
  const client = await getSupabaseAdmin();
  if (!client) {
    console.error('[collectTemplateAssets] Supabase not configured');
    return [];
  }

  // Get assets that have a storage_path (user uploads, not inline SVGs)
  // and are not from other templates
  const { data: assets, error } = await client
    .from('assets')
    .select('*')
    .not('storage_path', 'is', null)
    .not('source', 'like', 'template:%');

  if (error || !assets) {
    console.error('[collectTemplateAssets] Failed to fetch assets:', error);
    return [];
  }

  const results: Array<{
    filename: string;
    base64: string;
    mimeType: string;
  }> = [];

  for (const asset of assets) {
    try {
      const { data, error: downloadError } = await client.storage
        .from(STORAGE_BUCKET)
        .download(asset.storage_path);

      if (downloadError || !data) {
        console.warn(
          `[collectTemplateAssets] Failed to download ${asset.filename}:`,
          downloadError
        );
        continue;
      }

      const buffer = await data.arrayBuffer();
      results.push({
        filename: asset.filename,
        base64: Buffer.from(buffer).toString('base64'),
        mimeType: asset.mime_type || 'application/octet-stream',
      });
    } catch (err) {
      console.warn(
        `[collectTemplateAssets] Error processing ${asset.filename}:`,
        err
      );
    }
  }

  // Collect custom font files (fonts with storage_path)
  const { data: fonts, error: fontsError } = await client
    .from('fonts')
    .select('*')
    .not('storage_path', 'is', null)
    .eq('is_published', false)
    .is('deleted_at', null);

  if (fontsError) {
    console.warn('[collectTemplateAssets] Failed to fetch fonts:', fontsError);
  } else if (fonts && fonts.length > 0) {
    for (const font of fonts) {
      try {
        const { data, error: downloadError } = await client.storage
          .from(STORAGE_BUCKET)
          .download(font.storage_path);

        if (downloadError || !data) {
          console.warn(`[collectTemplateAssets] Failed to download font ${font.name}:`, downloadError);
          continue;
        }

        const buffer = await data.arrayBuffer();
        const fontFilename = `font-${font.name || font.id}.${font.kind || 'woff2'}`;
        results.push({
          filename: fontFilename,
          base64: Buffer.from(buffer).toString('base64'),
          mimeType: font.kind === 'woff2' ? 'font/woff2' : 'font/ttf',
        });
      } catch (err) {
        console.warn(`[collectTemplateAssets] Error processing font ${font.name}:`, err);
      }
    }
  }

  return results;
}

/**
 * Export and upload a template to the template service.
 * This combines export + asset collection + upload in one operation.
 */
export async function exportAndUploadTemplate(
  templateId: string,
  templateName: string,
  description = '',
  submitterEmail = ''
): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Generate export
    const exportResult = await exportTemplateSQL(
      templateId,
      templateName,
      description,
      submitterEmail
    );

    if (!exportResult.success) {
      return { success: false, error: exportResult.error };
    }

    // 2. Collect assets
    const assets = await collectTemplateAssets();

    // 3. Upload to template service
    const response = await fetch(`${YCODE_EXTERNAL_API_URL}/api/templates/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': TEMPLATE_UPLOAD_API_KEY,
      },
      body: JSON.stringify({
        manifest: exportResult.manifest,
        sql: exportResult.sql,
        assets,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.error || 'Upload failed' };
    }

    return { success: true };
  } catch (error) {
    console.error('[exportAndUpload] Failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Export and upload failed',
    };
  }
}
