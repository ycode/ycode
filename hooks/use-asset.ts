/**
 * Custom hook to resolve asset IDs to Asset objects
 * 
 * Provides a simple interface for components to get asset details by ID
 */

import { useEffect, useMemo } from 'react';
import { useAssetsStore } from '@/stores/useAssetsStore';
import type { Asset } from '@/types';

/**
 * Hook to get an asset by ID
 * Returns the asset object or null if not found
 * Automatically loads assets store if not already loaded
 */
export function useAsset(assetId: string | null | undefined): Asset | null {
  const asset = useAssetsStore(state => assetId ? state.assetsById[assetId] : null);
  const { getAsset, loadAssets, isLoaded } = useAssetsStore();

  useEffect(() => {
    // Load assets if not already loaded
    if (!isLoaded) {
      loadAssets();
    }
  }, [isLoaded, loadAssets]);

  useEffect(() => {
    if (assetId) {
      getAsset(assetId);
    }
  }, [assetId, getAsset]);

  return asset || null;
}

/**
 * Hook to get multiple assets by IDs
 * Returns an array of assets (nulls for not found)
 */
export function useAssets(assetIds: (string | null | undefined)[]): (Asset | null)[] {
  const { getAsset, loadAssets, isLoaded, assetsById } = useAssetsStore();

  useEffect(() => {
    // Load assets if not already loaded
    if (!isLoaded) {
      loadAssets();
    }
  }, [isLoaded, loadAssets]);

  useEffect(() => {
    assetIds.forEach(id => {
      if (id) getAsset(id);
    });
  }, [assetIds, getAsset]);

  return useMemo(() => 
    assetIds.map(id => (id ? assetsById[id] || null : null)), 
  [assetIds, assetsById]
  );
}
