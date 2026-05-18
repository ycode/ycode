import { NextRequest, NextResponse } from 'next/server';
import { getAdminUser } from '@/lib/supabase-auth';
import { noCache } from '@/lib/api-response';
import { syncTableRows, cleanupOrphanedRows } from '@/lib/sync-utils';
import { cleanupOrphanedStorageFiles } from '@/lib/storage-utils';
import { syncCSS } from '@/lib/services/settingsService';
import { clearAllCache } from '@/lib/services/cacheService';
import { getSettingByKey } from '@/lib/repositories/settingsRepository';
import type { PublishStats, PublishTableStats } from '@/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface RevertResult {
  changes: {
    folders: number;
    pages: number;
    pageLayers: number;
    collections: number;
    collectionFields: number;
    collectionItems: number;
    collectionItemValues: number;
    components: number;
    layerStyles: number;
    assetFolders: number;
    assets: number;
    fonts: number;
    locales: number;
    translations: number;
    css: boolean;
  };
  cleaned: {
    folders: number;
    pages: number;
    pageLayers: number;
    collections: number;
    collectionFields: number;
    collectionItems: number;
    collectionItemValues: number;
    components: number;
    layerStyles: number;
    assetFolders: number;
    assets: number;
    fonts: number;
    locales: number;
    translations: number;
  };
  stats: PublishStats;
}

function emptyTableStats(): PublishTableStats {
  return { durationMs: 0, added: 0, updated: 0, deleted: 0 };
}

function createEmptyStats(): PublishStats {
  return {
    totalDurationMs: 0,
    tables: {
      page_folders: emptyTableStats(),
      pages: emptyTableStats(),
      page_layers: emptyTableStats(),
      collections: emptyTableStats(),
      collection_fields: emptyTableStats(),
      collection_items: emptyTableStats(),
      collection_item_values: emptyTableStats(),
      components: emptyTableStats(),
      layer_styles: emptyTableStats(),
      asset_folders: emptyTableStats(),
      assets: emptyTableStats(),
      locales: emptyTableStats(),
      translations: emptyTableStats(),
      css: emptyTableStats(),
    },
  };
}

/**
 * POST /ycode/api/revert
 *
 * Reverts all draft data to match the last published version.
 * Uses the same sync pattern as publishing but with inverted is_published values.
 *
 * Order: folders → pages/layers → collections → components → layer styles → assets → locales → CSS
 */
export async function POST(request: NextRequest) {
  const adminAuth = await getAdminUser();
  if (!adminAuth) {
    return noCache({ error: 'Not authenticated' }, 401);
  }

  const startTime = performance.now();
  const stats = createEmptyStats();

  try {
    // Guard: only allow revert if site has been published before
    const publishedAt = await getSettingByKey('published_at');
    if (!publishedAt) {
      return noCache(
        { error: 'Cannot revert: site has never been published' },
        400
      );
    }

    const result: RevertResult = {
      changes: {
        folders: 0, pages: 0, pageLayers: 0,
        collections: 0, collectionFields: 0, collectionItems: 0, collectionItemValues: 0,
        components: 0, layerStyles: 0, assetFolders: 0, assets: 0, fonts: 0,
        locales: 0, translations: 0, css: false,
      },
      cleaned: {
        folders: 0, pages: 0, pageLayers: 0,
        collections: 0, collectionFields: 0, collectionItems: 0, collectionItemValues: 0,
        components: 0, layerStyles: 0, assetFolders: 0, assets: 0, fonts: 0,
        locales: 0, translations: 0,
      },
      stats,
    };

    const direction = 'revert' as const;

    // 1. Page folders
    {
      const stepStart = performance.now();
      result.changes.folders = await syncTableRows('page_folders', direction);
      result.cleaned.folders = (await cleanupOrphanedRows('page_folders', direction)).deleted;
      stats.tables.page_folders.durationMs = Math.round(performance.now() - stepStart);
      stats.tables.page_folders.added = result.changes.folders;
      stats.tables.page_folders.deleted = result.cleaned.folders;
    }

    // 2. Pages
    {
      const stepStart = performance.now();
      result.changes.pages = await syncTableRows('pages', direction);
      result.cleaned.pages = (await cleanupOrphanedRows('pages', direction)).deleted;
      stats.tables.pages.durationMs = Math.round(performance.now() - stepStart);
      stats.tables.pages.added = result.changes.pages;
      stats.tables.pages.deleted = result.cleaned.pages;
    }

    // 3. Page layers (child of pages)
    {
      const stepStart = performance.now();
      result.changes.pageLayers = await syncTableRows('page_layers', direction);
      result.cleaned.pageLayers = (await cleanupOrphanedRows('page_layers', direction)).deleted;
      stats.tables.page_layers.durationMs = Math.round(performance.now() - stepStart);
      stats.tables.page_layers.added = result.changes.pageLayers;
      stats.tables.page_layers.deleted = result.cleaned.pageLayers;
    }

    // 4. Collections (exclude uuid — globally unique, not scoped by is_published)
    {
      const stepStart = performance.now();
      result.changes.collections = await syncTableRows('collections', direction, { excludeColumns: ['uuid'] });
      result.cleaned.collections = (await cleanupOrphanedRows('collections', direction)).deleted;
      stats.tables.collections.durationMs = Math.round(performance.now() - stepStart);
      stats.tables.collections.added = result.changes.collections;
      stats.tables.collections.deleted = result.cleaned.collections;
    }

    // 5. Collection fields
    {
      const stepStart = performance.now();
      result.changes.collectionFields = await syncTableRows('collection_fields', direction);
      result.cleaned.collectionFields = (await cleanupOrphanedRows('collection_fields', direction)).deleted;
      stats.tables.collection_fields.durationMs = Math.round(performance.now() - stepStart);
      stats.tables.collection_fields.added = result.changes.collectionFields;
      stats.tables.collection_fields.deleted = result.cleaned.collectionFields;
    }

    // 6. Collection items (preserve draft-status items with is_publishable=false)
    let preservedItemIds: Set<string> = new Set();
    {
      const stepStart = performance.now();
      result.changes.collectionItems = await syncTableRows('collection_items', direction);
      const itemCleanup = await cleanupOrphanedRows('collection_items', direction, {
        preserveFilter: { column: 'is_publishable', value: false },
      });
      result.cleaned.collectionItems = itemCleanup.deleted;
      preservedItemIds = new Set(itemCleanup.preservedIds);
      stats.tables.collection_items.durationMs = Math.round(performance.now() - stepStart);
      stats.tables.collection_items.added = result.changes.collectionItems;
      stats.tables.collection_items.deleted = result.cleaned.collectionItems;
    }

    // 7. Collection item values (preserve values belonging to draft-status items)
    {
      const stepStart = performance.now();
      result.changes.collectionItemValues = await syncTableRows('collection_item_values', direction);
      const valuesCleanup = await cleanupOrphanedRows('collection_item_values', direction,
        preservedItemIds.size > 0
          ? { excludeByColumn: { column: 'item_id', ids: preservedItemIds } }
          : undefined
      );
      result.cleaned.collectionItemValues = valuesCleanup.deleted;
      stats.tables.collection_item_values.durationMs = Math.round(performance.now() - stepStart);
      stats.tables.collection_item_values.added = result.changes.collectionItemValues;
      stats.tables.collection_item_values.deleted = result.cleaned.collectionItemValues;
    }

    // 8. Components
    {
      const stepStart = performance.now();
      result.changes.components = await syncTableRows('components', direction);
      result.cleaned.components = (await cleanupOrphanedRows('components', direction)).deleted;
      stats.tables.components.durationMs = Math.round(performance.now() - stepStart);
      stats.tables.components.added = result.changes.components;
      stats.tables.components.deleted = result.cleaned.components;
    }

    // 9. Layer styles
    {
      const stepStart = performance.now();
      result.changes.layerStyles = await syncTableRows('layer_styles', direction);
      result.cleaned.layerStyles = (await cleanupOrphanedRows('layer_styles', direction)).deleted;
      stats.tables.layer_styles.durationMs = Math.round(performance.now() - stepStart);
      stats.tables.layer_styles.added = result.changes.layerStyles;
      stats.tables.layer_styles.deleted = result.cleaned.layerStyles;
    }

    // 10. Asset folders
    {
      const stepStart = performance.now();
      try {
        result.changes.assetFolders = await syncTableRows('asset_folders', direction);
        result.cleaned.assetFolders = (await cleanupOrphanedRows('asset_folders', direction)).deleted;
      } catch {
        // Non-fatal
      }
      stats.tables.asset_folders.durationMs = Math.round(performance.now() - stepStart);
      stats.tables.asset_folders.added = result.changes.assetFolders;
      stats.tables.asset_folders.deleted = result.cleaned.assetFolders;
    }

    // 11. Assets (delete physical files for orphaned rows)
    {
      const stepStart = performance.now();
      try {
        result.changes.assets = await syncTableRows('assets', direction);
        const assetCleanup = await cleanupOrphanedRows('assets', direction, {
          collectColumns: ['storage_path'],
        });
        result.cleaned.assets = assetCleanup.deleted;
        await cleanupOrphanedStorageFiles('assets', assetCleanup.collected.storage_path || []);
      } catch {
        // Non-fatal
      }
      stats.tables.assets.durationMs = Math.round(performance.now() - stepStart);
      stats.tables.assets.added = result.changes.assets;
      stats.tables.assets.deleted = result.cleaned.assets;
    }

    // 12. Fonts (delete physical files for orphaned rows)
    {
      try {
        result.changes.fonts = await syncTableRows('fonts', direction);
        const fontCleanup = await cleanupOrphanedRows('fonts', direction, {
          collectColumns: ['storage_path'],
        });
        result.cleaned.fonts = fontCleanup.deleted;
        await cleanupOrphanedStorageFiles('fonts', fontCleanup.collected.storage_path || []);
      } catch {
        // Non-fatal
      }
    }

    // 13. Locales
    {
      const stepStart = performance.now();
      try {
        result.changes.locales = await syncTableRows('locales', direction);
        result.cleaned.locales = (await cleanupOrphanedRows('locales', direction)).deleted;
      } catch {
        // Non-fatal
      }
      stats.tables.locales.durationMs = Math.round(performance.now() - stepStart);
      stats.tables.locales.added = result.changes.locales;
      stats.tables.locales.deleted = result.cleaned.locales;
    }

    // 14. Translations
    {
      const stepStart = performance.now();
      try {
        result.changes.translations = await syncTableRows('translations', direction);
        result.cleaned.translations = (await cleanupOrphanedRows('translations', direction)).deleted;
      } catch {
        // Non-fatal
      }
      stats.tables.translations.durationMs = Math.round(performance.now() - stepStart);
      stats.tables.translations.added = result.changes.translations;
      stats.tables.translations.deleted = result.cleaned.translations;
    }

    // 15. CSS (uses settings, not is_published rows)
    {
      const stepStart = performance.now();
      try {
        result.changes.css = await syncCSS('revert');
        stats.tables.css.added = result.changes.css ? 1 : 0;
      } catch {
        // Non-fatal
      }
      stats.tables.css.durationMs = Math.round(performance.now() - stepStart);
    }

    // Clear cache
    try {
      await clearAllCache();
    } catch {
      // Non-fatal
    }

    stats.totalDurationMs = Math.round(performance.now() - startTime);

    const totalReverted =
      result.changes.folders + result.changes.pages + result.changes.pageLayers +
      result.changes.collections + result.changes.collectionFields +
      result.changes.collectionItems + result.changes.collectionItemValues +
      result.changes.components + result.changes.layerStyles +
      result.changes.assetFolders + result.changes.assets + result.changes.fonts +
      result.changes.locales + result.changes.translations;

    return noCache({
      data: result,
      message: `Reverted ${totalReverted} item(s) to last published version`,
    });
  } catch (error) {
    stats.totalDurationMs = Math.round(performance.now() - startTime);

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to revert' },
      500
    );
  }
}
