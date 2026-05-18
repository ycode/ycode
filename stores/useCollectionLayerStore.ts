import { create } from 'zustand';
import { collectionsApi } from '@/lib/api';
import { MULTI_ASSET_COLLECTION_ID } from '@/lib/collection-field-utils';
import type { CollectionItemWithValues, CollectionPaginationMeta } from '@/types';

/**
 * Collection Layer Store
 *
 * Manages collection data specifically for collection layers in the builder.
 * This is separate from the CMS items store to allow independent data fetching
 * with different sort/limit/offset settings per layer.
 */

interface CollectionLayerState {
  layerData: Record<string, CollectionItemWithValues[]>; // keyed by layerId
  loading: Record<string, boolean>; // loading state per layer
  error: Record<string, string | null>; // error state per layer
  layerConfig: Record<string, { collectionId: string; sortBy?: string; sortOrder?: 'asc' | 'desc'; limit?: number; offset?: number; filters?: Array<{ fieldId: string; operator: string; value: string }>; userScope?: boolean; userScopeFieldId?: string; previewUserId?: string | null }>; // Track config per layer
  referencedItems: Record<string, CollectionItemWithValues[]>; // Items for referenced collections, keyed by collectionId
  referencedLoading: Record<string, boolean>; // Loading state for referenced collections
  // Pagination state
  paginationMeta: Record<string, CollectionPaginationMeta>; // Pagination meta per layer
  paginationLoading: Record<string, boolean>; // Loading state for pagination per layer
  // Bumped after CMS updates to signal the canvas should re-fetch
  invalidationKey: number;
}

interface CollectionLayerActions {
  fetchLayerData: (
    layerId: string,
    collectionId: string,
    sortBy?: string,
    sortOrder?: 'asc' | 'desc',
    limit?: number,
    offset?: number,
    filters?: Array<{ fieldId: string; operator: string; value: string }>,
    userScope?: boolean,
    userScopeFieldId?: string,
    previewUserIdArg?: string | null
  ) => Promise<void>;
  fetchReferencedCollectionItems: (collectionId: string) => Promise<void>;
  fetchReferencedCollectionsBatch: (collectionIds: string[]) => Promise<void>;
  clearLayerData: (layerId: string) => void;
  clearAllLayerData: () => void;
  updateItemInLayerData: (itemId: string, values: Record<string, string>) => void;
  invalidateLayerData: (collectionId: string) => void;
  refetchLayersForCollection: (collectionId: string) => Promise<void>;
  // Pagination actions
  fetchPage: (layerId: string, page: number) => Promise<{ items: CollectionItemWithValues[]; meta: CollectionPaginationMeta } | null>;
  setPaginationMeta: (layerId: string, meta: CollectionPaginationMeta) => void;
}

type CollectionLayerStore = CollectionLayerState & CollectionLayerActions;

export const useCollectionLayerStore = create<CollectionLayerStore>((set, get) => ({
  // Initial state
  layerData: {},
  loading: {},
  error: {},
  layerConfig: {},
  referencedItems: {},
  referencedLoading: {},
  paginationMeta: {},
  paginationLoading: {},
  invalidationKey: 0,

  // Fetch items for a referenced collection (used for reference field resolution)
  fetchReferencedCollectionItems: async (collectionId: string) => {
    const { referencedItems, referencedLoading } = get();

    // Skip if already loaded or loading
    if (referencedItems[collectionId] || referencedLoading[collectionId]) {
      return;
    }

    set((state) => ({
      referencedLoading: { ...state.referencedLoading, [collectionId]: true },
    }));

    try {
      const response = await collectionsApi.getItems(collectionId, { limit: 100 });

      if (!response.error && response.data?.items) {
        set((state) => ({
          referencedItems: { ...state.referencedItems, [collectionId]: response.data!.items },
          referencedLoading: { ...state.referencedLoading, [collectionId]: false },
        }));
      }
    } catch (error) {
      console.error(`[CollectionLayerStore] Error fetching referenced items for ${collectionId}:`, error);
      set((state) => ({
        referencedLoading: { ...state.referencedLoading, [collectionId]: false },
      }));
    }
  },

  /**
   * Fetch reference-display items for many collections in a single round-trip.
   * Dedupes against already-loaded/in-flight collections so it's safe to call
   * with the full set of referenced IDs on every canvas re-render.
   */
  fetchReferencedCollectionsBatch: async (collectionIds: string[]) => {
    const { referencedItems, referencedLoading } = get();

    const toFetch = collectionIds.filter(
      (id) => !referencedItems[id] && !referencedLoading[id],
    );
    if (toFetch.length === 0) return;

    set((state) => {
      const nextLoading = { ...state.referencedLoading };
      for (const id of toFetch) nextLoading[id] = true;
      return { referencedLoading: nextLoading };
    });

    try {
      const response = await collectionsApi.getReferencedItemsBatch(toFetch, 100);

      if (response.error || !response.data?.items) {
        throw new Error(response.error || 'Empty batch reference response');
      }

      const batchItems = response.data.items;
      set((state) => {
        const nextReferenced = { ...state.referencedItems };
        const nextLoading = { ...state.referencedLoading };
        for (const id of toFetch) {
          nextReferenced[id] = batchItems[id]?.items || [];
          nextLoading[id] = false;
        }
        return { referencedItems: nextReferenced, referencedLoading: nextLoading };
      });
    } catch (error) {
      console.error('[CollectionLayerStore] Error fetching referenced items batch:', error);
      set((state) => {
        const nextLoading = { ...state.referencedLoading };
        for (const id of toFetch) nextLoading[id] = false;
        return { referencedLoading: nextLoading };
      });
    }
  },

  // Fetch data for a specific layer
  fetchLayerData: async (
    layerId: string,
    collectionId: string,
    sortBy?: string,
    sortOrder: 'asc' | 'desc' = 'asc',
    limit?: number,
    offset?: number,
    filters?: Array<{ fieldId: string; operator: string; value: string }>,
    userScope?: boolean,
    userScopeFieldId?: string,
    previewUserIdArg?: string | null
  ) => {
    const { loading, layerConfig } = get();

    // Skip for virtual collections (multi-asset)
    if (collectionId === MULTI_ASSET_COLLECTION_ID) {
      return;
    }

    // Resolve previewUserId from store if not provided (needed for reactive updates from CenterCanvas)
    let previewUserId = previewUserIdArg;
    if (previewUserId === undefined && typeof window !== 'undefined') {
      const { usePagesStore } = await import('@/stores/usePagesStore');
      previewUserId = usePagesStore.getState().previewUserId;
    }

    // Skip if already loading
    if (loading[layerId]) {
      return;
    }

    // Check if we already fetched with the same config.
    // `layerConfig[layerId]` is only set after a successful fetch, so its presence
    // signals "already fetched" regardless of whether the result was empty.
    const existingConfig = layerConfig[layerId];
    const filtersMatch = JSON.stringify(existingConfig?.filters) === JSON.stringify(filters);
    const configMatches = existingConfig &&
      existingConfig.collectionId === collectionId &&
      existingConfig.sortBy === sortBy &&
      existingConfig.sortOrder === sortOrder &&
      existingConfig.limit === limit &&
      existingConfig.offset === offset &&
      existingConfig.userScope === userScope &&
      existingConfig.userScopeFieldId === userScopeFieldId &&
      existingConfig.previewUserId === previewUserId &&
      filtersMatch;

    // Skip if config matches — prevents refetching when a collection legitimately
    // returns an empty array (otherwise the layer would loop fetching forever).
    if (configMatches) {
      return;
    }

    // Set loading state
    set((state) => ({
      loading: { ...state.loading, [layerId]: true },
      error: { ...state.error, [layerId]: null },
    }));

    try {
      // Fetch items using existing API with layer-specific parameters
      const response = await collectionsApi.getItems(collectionId, {
        sortBy,
        sortOrder,
        limit,
        offset,
        filters,
        userScope,
        userScopeFieldId,
      });

      if (response.error) {
        throw new Error(response.error);
      }

      const items = response.data?.items || [];

      // Store fetched data keyed by layerId
      set((state) => ({
        layerData: { ...state.layerData, [layerId]: items },
        loading: { ...state.loading, [layerId]: false },
        layerConfig: {
          ...state.layerConfig,
          [layerId]: { collectionId, sortBy, sortOrder, limit, offset, filters, userScope, userScopeFieldId, previewUserId }
        },
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch layer data';
      set((state) => ({
        error: { ...state.error, [layerId]: errorMessage },
        loading: { ...state.loading, [layerId]: false },
      }));
      console.error(`[CollectionLayerStore] Error fetching data for layer ${layerId}:`, error);
    }
  },

  // Clear data for a specific layer
  clearLayerData: (layerId: string) => {
    set((state) => {
      const { [layerId]: _, ...restLayerData } = state.layerData;
      const { [layerId]: __, ...restLoading } = state.loading;
      const { [layerId]: ___, ...restError } = state.error;

      return {
        layerData: restLayerData,
        loading: restLoading,
        error: restError,
      };
    });
  },

  // Clear all layer data
  clearAllLayerData: () => {
    set({
      layerData: {},
      loading: {},
      error: {},
      layerConfig: {},
    });
  },

  // Update a single item in the local cache
  updateItemInLayerData: (itemId: string, values: Record<string, string>) => {
    set((state) => {
      const newLayerData = { ...state.layerData };
      let changed = false;

      Object.keys(newLayerData).forEach((layerId) => {
        const items = newLayerData[layerId];
        const itemIndex = items.findIndex((item) => item.id === itemId);

        if (itemIndex !== -1) {
          const updatedItems = [...items];
          updatedItems[itemIndex] = {
            ...updatedItems[itemIndex],
            values: {
              ...updatedItems[itemIndex].values,
              ...values,
            },
          };
          newLayerData[layerId] = updatedItems;
          changed = true;
        }
      });

      if (!changed) return state;
      return { layerData: newLayerData };
    });
  },

  // Invalidate all layers bound to a specific collection
  invalidateLayerData: (collectionId: string) => {
    set((state) => {
      const newLayerConfig = { ...state.layerConfig };
      let changed = false;

      Object.keys(newLayerConfig).forEach((layerId) => {
        if (newLayerConfig[layerId].collectionId === collectionId) {
          // Remove the config to force a re-fetch on next render
          delete newLayerConfig[layerId];
          changed = true;
        }
      });

      if (!changed) return state;
      return {
        layerConfig: newLayerConfig,
        invalidationKey: state.invalidationKey + 1,
      };
    });
  },

  // Silently re-fetch all layers for a collection (after CMS update)
  refetchLayersForCollection: async (collectionId: string) => {
    const { layerConfig } = get();
    const relevantLayers = Object.entries(layerConfig).filter(
      ([, config]) => config.collectionId === collectionId
    );

    if (relevantLayers.length === 0) return;

    try {
      await Promise.all(
        relevantLayers.map(async ([layerId, config]) => {
          const response = await collectionsApi.getItems(config.collectionId, {
            sortBy: config.sortBy,
            sortOrder: config.sortOrder,
            limit: config.limit,
            offset: config.offset,
            filters: config.filters,
            userScope: config.userScope,
            userScopeFieldId: config.userScopeFieldId,
          });

          if (!response.error && response.data?.items) {
            // Update data silently (no loading state change)
            set((state) => ({
              layerData: { ...state.layerData, [layerId]: response.data!.items },
            }));
          }
        })
      );
    } catch (error) {
      console.error(`[CollectionLayerStore] Error re-fetching layers for collection ${collectionId}:`, error);
    }
  },

  // Pagination: Fetch a specific page for a layer
  fetchPage: async (layerId: string, page: number) => {
    const { layerConfig, paginationMeta } = get();
    const config = layerConfig[layerId];
    const meta = paginationMeta[layerId];

    if (!config || !meta) return null;

    set((state) => ({
      paginationLoading: { ...state.paginationLoading, [layerId]: true },
    }));

    try {
      const offset = (page - 1) * meta.itemsPerPage;
      const response = await collectionsApi.getItems(config.collectionId, {
        sortBy: config.sortBy,
        sortOrder: config.sortOrder,
        limit: meta.itemsPerPage,
        offset,
        userScope: config.userScope,
        userScopeFieldId: config.userScopeFieldId,
      });

      if (response.error) {
        throw new Error(response.error);
      }

      const items = response.data?.items || [];
      const total = response.data?.total || 0;

      const newMeta = {
        ...meta,
        currentPage: page,
        totalItems: total,
        totalPages: Math.ceil(total / meta.itemsPerPage),
      };

      set((state) => ({
        paginationMeta: { ...state.paginationMeta, [layerId]: newMeta },
        paginationLoading: { ...state.paginationLoading, [layerId]: false },
      }));

      return { items, meta: newMeta };
    } catch (error) {
      console.error(`[CollectionLayerStore] Error fetching page for layer ${layerId}:`, error);
      set((state) => ({
        paginationLoading: { ...state.paginationLoading, [layerId]: false },
      }));
      return null;
    }
  },

  setPaginationMeta: (layerId: string, meta: CollectionPaginationMeta) => {
    set((state) => ({
      paginationMeta: { ...state.paginationMeta, [layerId]: meta },
    }));
  },
}));
