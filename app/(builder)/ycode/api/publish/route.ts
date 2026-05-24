import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { publishPages } from '@/lib/services/pageService';
import { publishCollectionWithItems, groupItemsByCollection, cleanupDeletedCollections } from '@/lib/services/collectionService';
import { publishLocalisation } from '@/lib/services/localisationService';
import type { PublishLocalisationResult } from '@/lib/services/localisationService';
import { publishFolders } from '@/lib/services/folderService';
import { publishCSS, savePublishedAt } from '@/lib/services/settingsService';
import {
  clearAllCache,
  selectiveInvalidation,
  warmRoutes,
  getAllPublishedRoutes,
  invalidateForLocalisationChanges,
} from '@/lib/services/cacheService';
import { findAffectedPages } from '@/lib/repositories/pageLayersRepository';
import { dispatchSitePublishedEvent } from '@/lib/services/webhookService';
import { getAllDraftPages, hardDeleteSoftDeletedPages } from '@/lib/repositories/pageRepository';
import { publishComponents, getUnpublishedComponents, hardDeleteSoftDeletedComponents } from '@/lib/repositories/componentRepository';
import { publishLayerStyles, getUnpublishedLayerStyles, hardDeleteSoftDeletedLayerStyles } from '@/lib/repositories/layerStyleRepository';
import { getAllCollections } from '@/lib/repositories/collectionRepository';
import { getItemsByCollectionId } from '@/lib/repositories/collectionItemRepository';
import { publishAssets, getUnpublishedAssets, hardDeleteSoftDeletedAssets } from '@/lib/repositories/assetRepository';
import { publishAssetFolders, getUnpublishedAssetFolders, hardDeleteSoftDeletedAssetFolders } from '@/lib/repositories/assetFolderRepository';
import { publishFonts } from '@/lib/repositories/fontRepository';
import { getColorVariablesHash } from '@/lib/repositories/colorVariableRepository';
import { getSettingByKey, setSetting } from '@/lib/repositories/settingsRepository';
import type { Setting, PublishStats, PublishTableStats } from '@/types';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PublishRequest {
  publishAll?: boolean; // If true and no specific items provided, publish all unpublished items
  folderIds?: string[]; // Publish specific folders
  pageIds?: string[];
  collectionIds?: string[]; // Publish all items in these collections
  collectionItemIds?: string[]; // Publish specific collection items
  componentIds?: string[];
  layerStyleIds?: string[];
  publishLocales?: boolean; // Whether to publish locales/translations (defaults to true)
}

interface PublishResult {
  changes: {
    folders: number;
    pages: number;
    collectionItems: number;
    components: number;
    layerStyles: number;
    assetFolders: number;
    assetFoldersDeleted: number;
    assets: number;
    assetsDeleted: number;
    locales: number;
    translations: number;
    css: boolean;
  };
  published_at_setting: Setting;
  stats: PublishStats;
}

/** Creates an empty table stats object */
function emptyTableStats(): PublishTableStats {
  return { durationMs: 0, added: 0, updated: 0, deleted: 0 };
}

/** Creates an empty stats object */
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
 * POST /ycode/api/publish
 *
 * Global publish endpoint that can:
 * 1. Publish all unpublished items (publishAll: true)
 * 2. Publish specific selected items (provide IDs)
 *
 * Handles: folders, pages, collection items, components, layer styles, locales, translations, and CSS
 *
 * Publishing order: folders → pages → collections → components → layer styles → locales → CSS
 *
 * For collections, you can provide:
 * - collectionIds: Publish all unpublished items in these collections
 * - collectionItemIds: Publish specific collection items (automatically grouped by collection)
 */
export async function POST(request: NextRequest) {
  const startTime = performance.now();
  const stats = createEmptyStats();

  try {
    const body: PublishRequest = await request.json().catch(() => ({}));

    const {
      publishAll = false,
      folderIds,
      pageIds,
      collectionIds,
      collectionItemIds,
      componentIds,
      layerStyleIds,
      publishLocales = true,
    } = body;

    const publishedAt = new Date().toISOString();

    const result: PublishResult = {
      changes: {
        folders: 0,
        pages: 0,
        collectionItems: 0,
        components: 0,
        layerStyles: 0,
        assetFolders: 0,
        assetFoldersDeleted: 0,
        assets: 0,
        assetsDeleted: 0,
        locales: 0,
        translations: 0,
        css: false,
      },
      published_at_setting: {
        key: 'published_at',
        value: publishedAt,
      } as Setting,
      stats,
    };

    // Determine if we're publishing all or specific items
    const isPublishingAll = publishAll && !folderIds && !pageIds && !collectionIds && !collectionItemIds && !componentIds && !layerStyleIds;

    // Track which resources actually changed for selective invalidation
    const publishedPageIds: string[] = [];
    const publishedCollectionIds: string[] = [];
    const changedComponentIds: string[] = [];
    const changedLayerStyleIds: string[] = [];
    const deletedCollectionItemSlugs: Map<string, string[]> = new Map();
    const renamedPageOldRoutes: string[] = [];
    let localisationResult: PublishLocalisationResult | null = null;

    // Publish folders first (pages depend on them)
    {
      const stepStart = performance.now();
      const foldersResult = await publishFolders(
        isPublishingAll ? [] : (folderIds || []),
        pageIds
      );
      result.changes.folders = foldersResult.count;
      stats.tables.page_folders.durationMs = Math.round(performance.now() - stepStart);
      stats.tables.page_folders.added = foldersResult.count;
    }

    // Publish pages
    {
      if (pageIds && pageIds.length > 0) {
        const pagesResult = await publishPages(pageIds);
        publishedPageIds.push(...pagesResult.changedPageIds);
        renamedPageOldRoutes.push(...pagesResult.renamedPageOldRoutes);
        result.changes.pages = pagesResult.count;
        stats.tables.pages.added = pagesResult.count;
        stats.tables.pages.durationMs = pagesResult.timing.pagesDurationMs;
        stats.tables.page_layers.added = pagesResult.timing.layersCount;
        stats.tables.page_layers.durationMs = pagesResult.timing.layersDurationMs;
      } else if (isPublishingAll) {
        const unpublishedPages = await getAllDraftPages();
        if (unpublishedPages.length > 0) {
          const allPageIds = unpublishedPages.map(p => p.id);
          const pagesResult = await publishPages(allPageIds);
          publishedPageIds.push(...pagesResult.changedPageIds);
          renamedPageOldRoutes.push(...pagesResult.renamedPageOldRoutes);
          result.changes.pages = pagesResult.count;
          stats.tables.pages.added = pagesResult.count;
          stats.tables.pages.durationMs = pagesResult.timing.pagesDurationMs;
          stats.tables.page_layers.added = pagesResult.timing.layersCount;
          stats.tables.page_layers.durationMs = pagesResult.timing.layersDurationMs;
        }
      }
    }

    // Publish collections with items
    {
      let totalItems = 0;
      let totalValues = 0;
      let totalFields = 0;
      let totalCollections = 0;
      let collectionsMs = 0;
      let fieldsMs = 0;
      let itemsMs = 0;
      let valuesMs = 0;

      if ((collectionIds && collectionIds.length > 0) || (collectionItemIds && collectionItemIds.length > 0)) {
        const collectionPublishes: Array<{ collectionId: string; itemIds: string[] }> = [];

        if (collectionIds && collectionIds.length > 0) {
          for (const collectionId of collectionIds) {
            const { items } = await getItemsByCollectionId(collectionId, false);
            collectionPublishes.push({
              collectionId,
              itemIds: items.map((item: any) => item.id),
            });
          }
        }

        if (collectionItemIds && collectionItemIds.length > 0) {
          const itemsByCollection = await groupItemsByCollection(collectionItemIds);
          itemsByCollection.forEach((itemIds, collectionId) => {
            const existing = collectionPublishes.find(cp => cp.collectionId === collectionId);
            if (existing) {
              const combined = new Set([...existing.itemIds, ...itemIds]);
              existing.itemIds = Array.from(combined);
            } else {
              collectionPublishes.push({ collectionId, itemIds });
            }
          });
        }

        if (collectionPublishes.length > 0) {
          for (const collectionPublish of collectionPublishes) {
            const publishResult = await publishCollectionWithItems({
              collectionId: collectionPublish.collectionId,
              itemIds: collectionPublish.itemIds,
            });
            const p = publishResult.published;
            const changed = (p?.itemsCount || 0)
              + (p?.valuesCount || 0)
              + (p?.fieldsCount || 0)
              + (p?.deletedItemsCount || 0)
              + (p?.collection ? 1 : 0);
            if (changed > 0) {
              publishedCollectionIds.push(collectionPublish.collectionId);
            }
            const staleSlugsCombined = [
              ...(p?.deletedItemSlugs || []),
              ...(p?.renamedItemOldSlugs || []),
            ];
            if (staleSlugsCombined.length > 0) {
              const existing = deletedCollectionItemSlugs.get(collectionPublish.collectionId) || [];
              deletedCollectionItemSlugs.set(collectionPublish.collectionId, [...existing, ...staleSlugsCombined]);
            }
            totalItems += p?.itemsCount || 0;
            totalValues += p?.valuesCount || 0;
            totalFields += p?.fieldsCount || 0;
            if (p?.collection) totalCollections++;
            if (publishResult.timing) {
              collectionsMs += publishResult.timing.collections.durationMs;
              fieldsMs += publishResult.timing.fields.durationMs;
              itemsMs += publishResult.timing.items.durationMs;
              valuesMs += publishResult.timing.values.durationMs;
            }
          }
          result.changes.collectionItems = totalItems;
        }
      } else if (isPublishingAll) {
        const allCollections = await getAllCollections({ is_published: false });

        for (const collection of allCollections) {
          const { items } = await getItemsByCollectionId(collection.id, false);
          const publishResult = await publishCollectionWithItems({
            collectionId: collection.id,
            itemIds: items.map((item: any) => item.id),
          });
          const p = publishResult.published;
          const changedItems = p?.itemsCount || 0;
          const changedValues = p?.valuesCount || 0;
          const changedFields = p?.fieldsCount || 0;
          const changedDeleted = p?.deletedItemsCount || 0;
          const changedCollection = p?.collection ? 1 : 0;
          const changed = changedItems + changedValues + changedFields + changedDeleted + changedCollection;
          if (changed > 0) {
            console.log(`[Publish] collection ${collection.id} changed: items=${changedItems} values=${changedValues} fields=${changedFields} deleted=${changedDeleted} meta=${changedCollection}`);
            publishedCollectionIds.push(collection.id);
          }
          const staleSlugsCombined = [
            ...(p?.deletedItemSlugs || []),
            ...(p?.renamedItemOldSlugs || []),
          ];
          if (staleSlugsCombined.length > 0) {
            const existing = deletedCollectionItemSlugs.get(collection.id) || [];
            deletedCollectionItemSlugs.set(collection.id, [...existing, ...staleSlugsCombined]);
          }
          totalItems += changedItems;
          totalValues += changedValues;
          totalFields += changedFields;
          if (p?.collection) totalCollections++;
          if (publishResult.timing) {
            collectionsMs += publishResult.timing.collections.durationMs;
            fieldsMs += publishResult.timing.fields.durationMs;
            itemsMs += publishResult.timing.items.durationMs;
            valuesMs += publishResult.timing.values.durationMs;
          }
        }
        result.changes.collectionItems = totalItems;
      }

      stats.tables.collections.durationMs = collectionsMs;
      stats.tables.collections.added = totalCollections;
      stats.tables.collection_fields.durationMs = fieldsMs;
      stats.tables.collection_fields.added = totalFields;
      stats.tables.collection_items.durationMs = itemsMs;
      stats.tables.collection_items.added = totalItems;
      stats.tables.collection_item_values.durationMs = valuesMs;
      stats.tables.collection_item_values.added = totalValues;
    }

    // Publish components
    {
      const stepStart = performance.now();
      if (componentIds && componentIds.length > 0) {
        const componentsResult = await publishComponents(componentIds);
        result.changes.components = componentsResult.count;
        stats.tables.components.added = componentsResult.count;
        changedComponentIds.push(...componentsResult.changedComponentIds);
      } else if (isPublishingAll) {
        const unpublishedComponents = await getUnpublishedComponents();
        console.log(`[Publish] unpublished components: ${unpublishedComponents.length}`);
        if (unpublishedComponents.length > 0) {
          const allComponentIds = unpublishedComponents.map((c: any) => c.id);
          const componentsResult = await publishComponents(allComponentIds);
          result.changes.components = componentsResult.count;
          stats.tables.components.added = componentsResult.count;
          changedComponentIds.push(...componentsResult.changedComponentIds);
          console.log(`[Publish] changed components: ${componentsResult.changedComponentIds.length}`);
        }
      }
      stats.tables.components.durationMs = Math.round(performance.now() - stepStart);
    }

    // Publish layer styles
    {
      const stepStart = performance.now();
      if (layerStyleIds && layerStyleIds.length > 0) {
        const stylesResult = await publishLayerStyles(layerStyleIds);
        result.changes.layerStyles = stylesResult.count;
        stats.tables.layer_styles.added = stylesResult.count;
        changedLayerStyleIds.push(...stylesResult.changedStyleIds);
      } else if (isPublishingAll) {
        const unpublishedStyles = await getUnpublishedLayerStyles();
        if (unpublishedStyles.length > 0) {
          const allStyleIds = unpublishedStyles.map((s: any) => s.id);
          const stylesResult = await publishLayerStyles(allStyleIds);
          result.changes.layerStyles = stylesResult.count;
          stats.tables.layer_styles.added = stylesResult.count;
          changedLayerStyleIds.push(...stylesResult.changedStyleIds);
        }
      }
      stats.tables.layer_styles.durationMs = Math.round(performance.now() - stepStart);
    }

    // Propagate updated style values into the denormalized layer.classes on
    // every draft page/component that references the changed styles. The
    // builder only syncs pages currently loaded in memory, so pages and
    // components that weren't open keep stale denormalized values. Without
    // this step they publish with the OLD class names and render with the
    // old style even though the layer_styles row was just updated.
    if (changedLayerStyleIds.length > 0) {
      try {
        const { syncLayerStyleChangesToDrafts } = await import('@/lib/repositories/layerStyleRepository');
        const sync = await syncLayerStyleChangesToDrafts(changedLayerStyleIds);

        if (sync.affectedComponentIds.length > 0) {
          // Re-publish components whose draft layers just got rewritten so
          // the published versions carry the fresh classes too.
          const repubResult = await publishComponents(sync.affectedComponentIds);
          for (const id of repubResult.changedComponentIds) {
            if (!changedComponentIds.includes(id)) changedComponentIds.push(id);
          }
          console.log(`[Publish] style sync: re-published ${repubResult.changedComponentIds.length} component(s)`);
        }

        if (sync.affectedPageIds.length > 0) {
          // Page layers will be republished by the CSS catch-up + batchPublishPageLayers
          // step below — the draft now has fresh classes and a fresh hash.
          console.log(`[Publish] style sync: updated ${sync.affectedPageIds.length} page draft(s)`);
        }
      } catch (err) {
        console.error('[Publish] Layer style sync failed (non-fatal):', err);
      }
    }

    // Track routes of deleted pages (must resolve BEFORE rows are removed from DB)
    const deletedPageRoutes: string[] = [];

    // Only clean up deletions and publish assets/localization when doing a full publish
    if (isPublishingAll) {
      // Resolve routes of soft-deleted pages before deletion so caches can be purged
      try {
        const { getRoutePathsForPages } = await import('@/lib/services/cacheService');
        const { getSoftDeletedPageIds } = await import('@/lib/repositories/pageRepository');
        const pendingDeleteIds = await getSoftDeletedPageIds();
        if (pendingDeleteIds.length > 0) {
          const routes = await getRoutePathsForPages(pendingDeleteIds);
          deletedPageRoutes.push(...routes);
        }
      } catch {
        // Non-fatal: route resolution failure should not block deletion
      }

      try {
        await hardDeleteSoftDeletedPages();
      } catch {
        // Non-fatal
      }

      try {
        await hardDeleteSoftDeletedComponents();
      } catch {
        // Non-fatal
      }

      try {
        await hardDeleteSoftDeletedLayerStyles();
      } catch {
        // Non-fatal
      }

      try {
        await cleanupDeletedCollections();
      } catch {
        // Non-fatal
      }

      // Asset folders
      {
        const stepStart = performance.now();
        try {
          const deleteFoldersResult = await hardDeleteSoftDeletedAssetFolders();
          result.changes.assetFoldersDeleted = deleteFoldersResult.count;
          stats.tables.asset_folders.deleted = deleteFoldersResult.count;
        } catch {
          // Silently handle - non-fatal
        }

        try {
          const unpublishedFolders = await getUnpublishedAssetFolders();
          if (unpublishedFolders.length > 0) {
            const allFolderIds = unpublishedFolders.map((f: any) => f.id);
            const foldersResult = await publishAssetFolders(allFolderIds);
            result.changes.assetFolders = foldersResult.count;
            stats.tables.asset_folders.added = foldersResult.count;
          }
        } catch {
          // Silently handle - non-fatal
        }
        stats.tables.asset_folders.durationMs = Math.round(performance.now() - stepStart);
      }

      // Assets
      {
        const stepStart = performance.now();
        try {
          const deleteResult = await hardDeleteSoftDeletedAssets();
          result.changes.assetsDeleted = deleteResult.count;
          stats.tables.assets.deleted = deleteResult.count;
        } catch {
          // Silently handle - non-fatal
        }

        try {
          const unpublishedAssets = await getUnpublishedAssets();
          if (unpublishedAssets.length > 0) {
            const allAssetIds = unpublishedAssets.map((a: any) => a.id);
            const assetsResult = await publishAssets(allAssetIds);
            result.changes.assets = assetsResult.count;
            stats.tables.assets.added = assetsResult.count;
          }
        } catch {
          // Silently handle - non-fatal
        }
        stats.tables.assets.durationMs = Math.round(performance.now() - stepStart);
      }

      // Fonts
      {
        try {
          await publishFonts();
        } catch {
          // Non-fatal — fonts are best-effort during publish
        }
      }

      // Locales and translations
      if (publishLocales) {
        try {
          localisationResult = await publishLocalisation();
          result.changes.locales = localisationResult.locales;
          result.changes.translations = localisationResult.translations;
          stats.tables.locales.added = localisationResult.locales;
          stats.tables.locales.durationMs = localisationResult.timing.localesDurationMs;
          stats.tables.translations.added = localisationResult.translations;
          stats.tables.translations.durationMs = localisationResult.timing.translationsDurationMs;
        } catch {
          // Silently handle - non-fatal
        }
      }
    }

    // Copy draft CSS to published CSS
    {
      const stepStart = performance.now();
      try {
        result.changes.css = await publishCSS();
        stats.tables.css.added = result.changes.css ? 1 : 0;
      } catch {
        // Don't fail the entire publish if CSS fails
      }
      stats.tables.css.durationMs = Math.round(performance.now() - stepStart);
    }

    // Selective cache invalidation: only invalidate pages that actually changed.
    //
    // Global triggers (full invalidation):
    // - Color variables: no draft/published model, so we snapshot-hash all
    //   color variables and compare against the last published hash.
    //   A change means every page's rendered CSS custom properties differ.
    //
    // Per-resource selective invalidation:
    // - Pages: direct content_hash comparison (pages + page_layers tables)
    // - Components: find pages referencing changed componentIds in JSONB
    // - Layer styles: find pages referencing changed layerStyleIds in JSONB
    // - Collections: find pages referencing changed collectionIds in JSONB
    try {
      // Detect color variable changes by comparing current hash to last-published hash
      let globalChanged = false;
      let globalChangedReason = '';
      try {
        const currentColorHash = await getColorVariablesHash();
        const lastColorHash = await getSettingByKey('color_variables_published_hash');
        if (currentColorHash !== lastColorHash) {
          globalChanged = true;
          globalChangedReason = `color hash mismatch: ${lastColorHash?.slice(0, 8) ?? 'null'} → ${currentColorHash.slice(0, 8)}`;
          await setSetting('color_variables_published_hash', currentColorHash);
        }
      } catch (err) {
        globalChanged = true;
        globalChangedReason = `color hash check failed: ${err instanceof Error ? err.message : 'unknown'}`;
      }

      // Locales/translations live in a separate table — their changes don't
      // affect page/component content_hash, so selective page invalidation
      // misses them. We compute exact locale-prefixed URL invalidation
      // below from `localisationResult.changedTranslations` /
      // `changedLocales`, after the main selective invalidation runs.

      // Find pages indirectly affected by changed components, styles, collections
      // Single scan of draft page_layers instead of one scan per resource type
      const activeCollectionIds = publishedCollectionIds;

      let indirectlyAffectedPageIds: string[] = [];
      let cssAffectedPageIds: string[] = [];
      try {
        const affected = await findAffectedPages(changedComponentIds, changedLayerStyleIds, activeCollectionIds);
        indirectlyAffectedPageIds = [...new Set([
          ...affected.componentPageIds,
          ...affected.stylePageIds,
          ...affected.collectionPageIds,
        ])];
        // Pages needing CSS catch-up (component/style refs only, not collections)
        cssAffectedPageIds = [...new Set([
          ...affected.componentPageIds,
          ...affected.stylePageIds,
        ])];

        if (affected.componentPageIds.length > 0) {
          console.log(`[Cache] component-affected pages: ${affected.componentPageIds.length} (from ${changedComponentIds.length} changed component(s))`);
        }
        if (affected.stylePageIds.length > 0) {
          console.log(`[Cache] style-affected pages: ${affected.stylePageIds.length} (from ${changedLayerStyleIds.length} changed style(s))`);
        }
        if (affected.collectionPageIds.length > 0) {
          console.log(`[Cache] collection-affected pages: ${affected.collectionPageIds.length}`);
        }
      } catch {
        // Safety: if dependency scan fails, degrade to full invalidation
        globalChanged = true;
      }

      // CSS catch-up: regenerate CSS for pages affected by changed
      // components/styles. The builder only regenerates CSS for pages open
      // in memory — pages not loaded keep stale generated_css/content_hash.
      // This ensures batchPublishPageLayers detects the real hash change.
      if (!globalChanged && cssAffectedPageIds.length > 0) {
        try {
          const { generateCSSForPages } = await import('@/lib/server/cssGenerator');
          await generateCSSForPages(cssAffectedPageIds);

          // Re-publish layers for these pages so published version has fresh CSS
          const { batchPublishPageLayers } = await import('@/lib/repositories/pageLayersRepository');
          const relayerResult = await batchPublishPageLayers(cssAffectedPageIds);
          if (relayerResult.changedPageIds.length > 0) {
            publishedPageIds.push(...relayerResult.changedPageIds);
            console.log(`[Cache] CSS catch-up: republished ${relayerResult.changedPageIds.length} page layer(s)`);
          }
        } catch {
          // Non-fatal: CSS catch-up failure doesn't block publish
        }
      }

      // publishedPageIds can contain the same page twice (once from the
      // initial publishPages step, once from the CSS catch-up republish).
      // Log the unique count so the number isn't misleading.
      const uniqueDirectChangedCount = new Set(publishedPageIds).size;
      console.log(`[Cache] directly changed pages: ${uniqueDirectChangedCount}, indirectly affected: ${indirectlyAffectedPageIds.length}, globalChanged: ${globalChanged}${globalChangedReason ? ` (${globalChangedReason})` : ''}`);

      const invalidationResult = await selectiveInvalidation(
        publishedPageIds,
        globalChanged,
        indirectlyAffectedPageIds,
      );

      // Capture the live routes we'll warm later. For selective invalidation
      // we warm exactly the routes that were invalidated. For full
      // invalidation we enumerate every published route — affects every
      // page anyway, and visitors shouldn't pay the cold-cache cost just
      // because a color variable changed. Capped inside warmRoutes.
      // Deleted/renamed routes are skipped intentionally — their URLs no
      // longer resolve.
      let liveRoutesToWarm = invalidationResult.strategy === 'selective'
        ? [...invalidationResult.invalidatedRoutes]
        : await getAllPublishedRoutes();

      // Locale & translation invalidation: compute exact locale-prefixed
      // URLs affected by translation/locale changes and layer them onto the
      // selective set. NEW routes (current live URLs) get warmed; OLD
      // routes (orphaned slug/locale renames) are invalidated only.
      // Skipped under full invalidation — already covered by clearAllCache.
      if (localisationResult && invalidationResult.strategy === 'selective') {
        try {
          const localeInv = await invalidateForLocalisationChanges(localisationResult);
          if (localeInv.needsFullInvalidation) {
            await clearAllCache();
            liveRoutesToWarm = await getAllPublishedRoutes();
            console.log(
              `[Cache] localisation: escalated to full invalidation${localeInv.reason ? ` (${localeInv.reason})` : ''}`,
            );
          } else {
            if (localeInv.newRoutes.length > 0) {
              liveRoutesToWarm.push(...localeInv.newRoutes);
              invalidationResult.invalidatedRoutes.push(...localeInv.newRoutes);
            }
            if (localeInv.oldRoutes.length > 0) {
              invalidationResult.invalidatedRoutes.push(...localeInv.oldRoutes);
            }
            if (localeInv.newRoutes.length > 0 || localeInv.oldRoutes.length > 0) {
              console.log(
                `[Cache] localisation: invalidated ${localeInv.newRoutes.length} live + ${localeInv.oldRoutes.length} orphaned locale route(s) ` +
                `(${localisationResult.changedTranslations.length} translation change(s), ${localisationResult.changedLocales.length} locale change(s))`,
              );
            }
          }
        } catch (err) {
          console.warn('[Cache] localisation invalidation failed:', err instanceof Error ? err.message : err);
        }
      }

      // Invalidate routes of deleted/renamed pages and deleted CMS items
      if (invalidationResult.strategy !== 'full') {
        const { invalidatePages, getRoutePathsForDeletedCollectionItems } = await import('@/lib/services/cacheService');

        // Deleted page routes (resolved before DB deletion)
        if (deletedPageRoutes.length > 0) {
          await invalidatePages(deletedPageRoutes);
          invalidationResult.invalidatedRoutes.push(...deletedPageRoutes);
        }

        // Old routes from renamed/moved pages
        if (renamedPageOldRoutes.length > 0) {
          await invalidatePages(renamedPageOldRoutes);
          invalidationResult.invalidatedRoutes.push(...renamedPageOldRoutes);
          console.log(`[Cache] invalidated ${renamedPageOldRoutes.length} renamed page old route(s)`);
        }

        // Deleted CMS item routes (old slugs that should no longer exist)
        if (deletedCollectionItemSlugs.size > 0) {
          try {
            const oldRoutes = await getRoutePathsForDeletedCollectionItems(deletedCollectionItemSlugs);
            if (oldRoutes.length > 0) {
              await invalidatePages(oldRoutes);
              invalidationResult.invalidatedRoutes.push(...oldRoutes);
              console.log(`[Cache] invalidated ${oldRoutes.length} deleted CMS item route(s)`);
            }
          } catch {
            // Non-fatal
          }
        }
      }

      console.log(
        `[Cache] ${invalidationResult.strategy} invalidation:`,
        invalidationResult.strategy === 'selective'
          ? `${invalidationResult.invalidatedRoutes.length} route(s)${deletedPageRoutes.length > 0 ? ` (incl. ${deletedPageRoutes.length} deleted)` : ''}`
          : invalidationResult.reason,
      );

      // After invalidation, prime the affected pages in the background so the
      // first real visitor doesn't pay the cold-cache cost. We absorb the
      // STALE/MISS server-side; the visitor's first hit is HIT.
      const warmResult = await warmRoutes(liveRoutesToWarm, request);
      if (warmResult) {
        console.log(
          `[Cache] warming ${warmResult.warmed}${warmResult.total > warmResult.warmed ? ` of ${warmResult.total}` : ''} route(s) in background`,
        );
      }
    } catch {
      // Fallback: if selective invalidation fails, nuke everything
      try { await clearAllCache(); } catch { /* non-fatal */ }
    }

    // Save published timestamp to settings
    try {
      result.published_at_setting = await savePublishedAt(publishedAt);
    } catch {
      // Silently handle - non-fatal
    }

    // Dispatch the site.published webhook event. The dispatcher is the only
    // path that delivers to user-configured webhooks for this event type
    // (advertised in the Integrations → Webhooks UI), so without this call
    // any "Site Published" subscription silently never fires. Wrapped so
    // webhook failures never block the publish response.
    try {
      await dispatchSitePublishedEvent({
        pages_count: result.changes.pages,
        collections_count: result.changes.collectionItems,
      });
    } catch {
      // Silently handle — webhook failures must not break a successful publish
    }

    // Calculate total duration
    stats.totalDurationMs = Math.round(performance.now() - startTime);

    const totalPublished =
      result.changes.folders +
      result.changes.pages +
      result.changes.collectionItems +
      result.changes.components +
      result.changes.layerStyles +
      result.changes.assetFolders +
      result.changes.assets +
      result.changes.locales +
      result.changes.translations;

    return noCache({
      data: result,
      message: `Published a total of ${totalPublished} item(s) successfully`,
    });
  } catch (error) {
    stats.totalDurationMs = Math.round(performance.now() - startTime);

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to publish' },
      500
    );
  }
}
