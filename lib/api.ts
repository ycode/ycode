/**
 * API Client for Ycode Builder
 *
 * Handles communication with Next.js API routes
 */

import type { Page, PageLayers, Layer, Asset, AssetCategory, PageFolder, ApiResponse, Collection, CollectionField, CollectionItemWithValues, Component, LayerStyle, Setting, UpdateCollectionData, CreateCollectionFieldData, UpdateCollectionFieldData, Locale, Translation, CreateLocaleData, UpdateLocaleData, CreateTranslationData, UpdateTranslationData, AssetFolder, Font } from '../types';
import type { StatusAction } from '@/lib/collection-field-utils';
import type { CollectionUsageResult, CollectionFieldUsageResult } from '@/lib/collection-usage-utils';

import { usePagesStore } from '@/stores/usePagesStore';
import { useEditorStore } from '@/stores/useEditorStore';

// All API routes are now relative (Next.js API routes)
const API_BASE = '';

// Get Supabase auth token
async function getAuthToken(): Promise<string | null> {
  // TODO: Get from Supabase client when implemented
  return null;
}

// Generic API request helper
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const token = await getAuthToken();

  // Get preview user ID from store if in browser AND in preview mode
  const isPreviewMode = typeof window !== 'undefined' ? useEditorStore.getState().isPreviewMode : false;
  const previewUserId = (typeof window !== 'undefined' && isPreviewMode) ? usePagesStore.getState().previewUserId : null;

  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(previewUserId && { 'x-ycode-preview-user-id': previewUserId }),
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    // Try to parse error message from response body
    try {
      const json = await response.json();
      if (json.error) {
        return { error: json.error };
      }
    } catch {
      // If parsing fails, fall back to status text
    }
    return {
      error: `HTTP ${response.status}: ${response.statusText}`,
    };
  }

  // Handle 204 No Content responses (no body to parse)
  if (response.status === 204) {
    return { data: null as T };
  }

  try {
    const json = await response.json();
    // API responses are already wrapped in { data: ... }
    // So we unwrap them here
    if (json.data !== undefined) {
      return { data: json.data };
    }
    // Fallback for responses that aren't wrapped
    return { data: json };
  } catch (error) {
    return {
      error: 'Failed to parse response',
    };
  }
}

// Pages API
export const pagesApi = {
  // Get all pages
  async getAll(): Promise<ApiResponse<Page[]>> {
    return apiRequest<Page[]>('/ycode/api/pages');
  },

  // Get page by ID
  async getById(id: string): Promise<ApiResponse<Page>> {
    return apiRequest<Page>(`/ycode/api/pages/${id}`);
  },

  // Get page by slug
  async getBySlug(slug: string): Promise<ApiResponse<Page>> {
    return apiRequest<Page>(`/ycode/api/pages/slug/${slug}`);
  },

  // Get all published pages (for public website)
  async getAllPublished(): Promise<ApiResponse<Page[]>> {
    return apiRequest<Page[]>('/ycode/api/pages?is_published=true');
  },

  // Create new page
  async create(page: Omit<Page, 'id' | 'created_at' | 'updated_at' | 'deleted_at'>): Promise<ApiResponse<Page>> {
    return apiRequest<Page>('/ycode/api/pages', {
      method: 'POST',
      body: JSON.stringify(page),
    });
  },

  // Update page
  async update(id: string, page: Partial<Page>): Promise<ApiResponse<Page>> {
    return apiRequest<Page>(`/ycode/api/pages/${id}`, {
      method: 'PUT',
      body: JSON.stringify(page),
    });
  },

  // Delete page
  async delete(id: string): Promise<ApiResponse<void>> {
    return apiRequest<void>(`/ycode/api/pages/${id}`, {
      method: 'DELETE',
    });
  },

  // Get unpublished pages
  async getUnpublished(): Promise<ApiResponse<Page[]>> {
    return apiRequest<Page[]>('/ycode/api/pages/unpublished');
  },
};

// Folders API
export const foldersApi = {
  // Get all folders
  async getAll(): Promise<ApiResponse<PageFolder[]>> {
    return apiRequest<PageFolder[]>('/ycode/api/folders');
  },

  // Create new folder
  async create(folder: Omit<PageFolder, 'id' | 'created_at' | 'updated_at' | 'deleted_at'>): Promise<ApiResponse<PageFolder>> {
    return apiRequest<PageFolder>('/ycode/api/folders', {
      method: 'POST',
      body: JSON.stringify(folder),
    });
  },

  // Update folder
  async update(id: string, folder: Partial<PageFolder>): Promise<ApiResponse<PageFolder>> {
    return apiRequest<PageFolder>(`/ycode/api/folders/${id}`, {
      method: 'PUT',
      body: JSON.stringify(folder),
    });
  },

  // Delete folder
  async delete(id: string): Promise<ApiResponse<void>> {
    return apiRequest<void>(`/ycode/api/folders/${id}`, {
      method: 'DELETE',
    });
  },
};

// Layers API
export const layersApi = {
  // Get layers for a page (with optional is_published filter)
  async getByPageId(pageId: string, isPublished?: boolean): Promise<ApiResponse<PageLayers>> {
    const params = new URLSearchParams({ page_id: pageId });
    if (isPublished !== undefined) {
      params.append('is_published', String(isPublished));
    }
    return apiRequest<PageLayers>(`/ycode/api/layers?${params.toString()}`);
  },

  // Update layers for a page
  async update(pageId: string, layers: Layer[]): Promise<ApiResponse<PageLayers>> {
    return apiRequest<PageLayers>(`/ycode/api/layers?page_id=${pageId}`, {
      method: 'PUT',
      body: JSON.stringify({ layers }),
    });
  },
};

// Page Layers API (legacy - keeping for backwards compatibility)
export const pageLayersApi = {
  // Get draft layers for page
  async getDraft(pageId: string): Promise<ApiResponse<PageLayers>> {
    return layersApi.getByPageId(pageId, false);
  },

  // Update draft layers
  async updateDraft(pageId: string, layers: Layer[]): Promise<ApiResponse<PageLayers>> {
    return layersApi.update(pageId, layers);
  },

  // Get all draft (non-published) page layers in one query
  async getAllDrafts(): Promise<ApiResponse<PageLayers[]>> {
    return apiRequest<PageLayers[]>('/ycode/api/pages/drafts');
  },
};

// Publish API - Global publishing endpoint
export const publishApi = {
  /** Get counts of unpublished items per entity type */
  async getPreview(): Promise<ApiResponse<{
    pages: number;
    collections: number;
    collectionItems: number;
    components: number;
    layerStyles: number;
    assets: number;
    total: number;
  }>> {
    return apiRequest('/ycode/api/publish/preview');
  },

  /**
   * Publish all unpublished items or specific selected items
   * @param options - Publishing options
   */
  async publish(options: {
    folderIds?: string[];
    pageIds?: string[];
    collectionIds?: string[];
    collectionItemIds?: string[];
    componentIds?: string[];
    layerStyleIds?: string[];
    publishLocales?: boolean;
    publishAll?: boolean;
  } = {}): Promise<ApiResponse<{
    changes: {
      folders: number;
      pages: number;
      collectionItems: number;
      components: number;
      layerStyles: number;
      locales: number;
      translations: number;
      css: boolean;
    };
    published_at_setting: Setting;
  }>> {
    return apiRequest('/ycode/api/publish', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  },

  /** Revert all draft data to match the last published version */
  async revert(): Promise<ApiResponse<{
    changes: Record<string, number | boolean>;
    cleaned: Record<string, number>;
  }>> {
    return apiRequest('/ycode/api/revert', {
      method: 'POST',
    });
  },
};

// Assets API
export const assetsApi = {
  // Upload asset
  async upload(file: File, source: string = 'library'): Promise<ApiResponse<Asset>> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('source', source);

    const token = await getAuthToken();

    const response = await fetch(`${API_BASE}/api/assets/upload`, {
      method: 'POST',
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: formData,
    });

    if (!response.ok) {
      return {
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    try {
      const json = await response.json();
      // Unwrap the { data: ... } response
      if (json.data !== undefined) {
        return { data: json.data };
      }
      return { data: json };
    } catch (error) {
      return {
        error: 'Failed to parse response',
      };
    }
  },

  // Get all assets (optionally filtered by folder)
  async getAll(folderId?: string | null): Promise<ApiResponse<Asset[]>> {
    const params = new URLSearchParams();
    if (folderId !== undefined) {
      params.set('folderId', folderId === null ? 'null' : folderId);
    }
    const url = params.toString() ? `/ycode/api/assets?${params}` : '/ycode/api/assets';
    return apiRequest<Asset[]>(url);
  },

  // Create SVG asset from code
  async create(data: { filename: string; content: string; asset_folder_id?: string | null; source?: string }): Promise<ApiResponse<Asset>> {
    return apiRequest<Asset>('/ycode/api/assets', {
      method: 'POST',
      body: JSON.stringify(data),
      headers: {
        'Content-Type': 'application/json',
      },
    });
  },

  // Update asset
  async update(id: string, data: { filename?: string; asset_folder_id?: string | null; content?: string | null }): Promise<ApiResponse<Asset>> {
    return apiRequest<Asset>(`/ycode/api/assets/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  // Delete asset
  async delete(id: string): Promise<ApiResponse<void>> {
    return apiRequest<void>(`/ycode/api/assets/${id}`, {
      method: 'DELETE',
    });
  },

  // Bulk delete assets
  async bulkDelete(ids: string[]): Promise<ApiResponse<{ success: string[]; failed: string[] }>> {
    return apiRequest<{ success: string[]; failed: string[] }>('/ycode/api/assets/bulk', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete', ids }),
    });
  },

  // Bulk move assets to folder
  async bulkMove(ids: string[], asset_folder_id: string | null): Promise<ApiResponse<{ success: string[]; failed: string[] }>> {
    return apiRequest<{ success: string[]; failed: string[] }>('/ycode/api/assets/bulk', {
      method: 'POST',
      body: JSON.stringify({ action: 'move', ids, asset_folder_id }),
    });
  },

  // Get asset usage with names
  async getUsage(id: string): Promise<ApiResponse<{ pages: { id: string; name: string }[]; components: { id: string; name: string }[]; cmsItems: { id: string; name: string; collectionId: string; collectionName: string }[]; total: number }>> {
    return apiRequest<{ pages: { id: string; name: string }[]; components: { id: string; name: string }[]; cmsItems: { id: string; name: string; collectionId: string; collectionName: string }[]; total: number }>(`/ycode/api/assets/${id}/usage`);
  },
};

// Asset Folders API
export const assetFoldersApi = {
  // Get all asset folders
  async getAll(): Promise<ApiResponse<AssetFolder[]>> {
    return apiRequest<AssetFolder[]>('/ycode/api/asset-folders');
  },

  // Create new asset folder
  async create(folder: { name: string; asset_folder_id?: string | null; depth?: number; order?: number; is_published?: boolean }): Promise<ApiResponse<AssetFolder>> {
    return apiRequest<AssetFolder>('/ycode/api/asset-folders', {
      method: 'POST',
      body: JSON.stringify(folder),
    });
  },

  // Update asset folder
  async update(id: string, folder: Partial<AssetFolder>): Promise<ApiResponse<AssetFolder>> {
    return apiRequest<AssetFolder>(`/ycode/api/asset-folders/${id}`, {
      method: 'PUT',
      body: JSON.stringify(folder),
    });
  },

  // Delete asset folder
  async delete(id: string): Promise<ApiResponse<void>> {
    return apiRequest<void>(`/ycode/api/asset-folders/${id}`, {
      method: 'DELETE',
    });
  },
};

// Setup API
export const setupApi = {
  // Get setup status
  async getStatus(): Promise<ApiResponse<{ isComplete: boolean; currentStep: string }>> {
    return apiRequest<{ isComplete: boolean; currentStep: string }>('/ycode/api/setup/status');
  },

  // Connect Supabase
  async connectSupabase(config: {
    url: string;
    anon_key: string;
    service_role_key: string;
  }): Promise<ApiResponse<{ success: boolean }>> {
    return apiRequest<{ success: boolean }>('/ycode/api/setup/connect-supabase', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  },

  // Update Vercel env vars
  async updateVercelEnv(vars: Record<string, string>): Promise<ApiResponse<{ success: boolean }>> {
    return apiRequest<{ success: boolean }>('/ycode/api/setup/update-vercel-env', {
      method: 'POST',
      body: JSON.stringify(vars),
    });
  },

  // Run migrations
  async runMigrations(): Promise<ApiResponse<{ success: boolean }>> {
    return apiRequest<{ success: boolean }>('/ycode/api/setup/run-migrations', {
      method: 'POST',
    });
  },

  // Complete setup
  async completeSetup(): Promise<ApiResponse<{ success: boolean }>> {
    return apiRequest<{ success: boolean }>('/ycode/api/setup/complete', {
      method: 'POST',
    });
  },
};

// Collections API (EAV Architecture)
export const collectionsApi = {
  // Collections
  async getAll(): Promise<ApiResponse<Collection[]>> {
    return apiRequest<Collection[]>('/ycode/api/collections');
  },

  async getById(id: string): Promise<ApiResponse<Collection>> {
    return apiRequest<Collection>(`/ycode/api/collections/${id}`);
  },

  async create(data: {
    name: string;
    sorting?: Record<string, any> | null;
    order?: number;
  }): Promise<ApiResponse<Collection>> {
    return apiRequest<Collection>('/ycode/api/collections', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async createSample(sampleId: string): Promise<ApiResponse<{ collection: Collection; fields: CollectionField[]; assets: Asset[]; items: CollectionItemWithValues[] }>> {
    return apiRequest('/ycode/api/collections/sample', {
      method: 'POST',
      body: JSON.stringify({ sampleId }),
    });
  },

  async update(id: string, data: UpdateCollectionData): Promise<ApiResponse<Collection>> {
    return apiRequest<Collection>(`/ycode/api/collections/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async delete(id: string): Promise<ApiResponse<void>> {
    return apiRequest<void>(`/ycode/api/collections/${id}`, {
      method: 'DELETE',
    });
  },

  async getUsage(id: string): Promise<ApiResponse<CollectionUsageResult>> {
    return apiRequest(`/ycode/api/collections/${id}/usage`);
  },

  async reorder(collectionIds: string[]): Promise<ApiResponse<{ success: boolean }>> {
    return apiRequest<{ success: boolean }>('/ycode/api/collections/reorder', {
      method: 'PUT',
      body: JSON.stringify({ collection_ids: collectionIds }),
    });
  },

  // Fields
  async getAllFields(): Promise<ApiResponse<CollectionField[]>> {
    return apiRequest<CollectionField[]>('/ycode/api/collections/fields');
  },

  async getFields(collectionId: string, search?: string): Promise<ApiResponse<CollectionField[]>> {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    const queryString = params.toString();
    const url = `/ycode/api/collections/${collectionId}/fields${queryString ? `?${queryString}` : ''}`;
    return apiRequest<CollectionField[]>(url);
  },

  async createField(collectionId: string, data: Omit<CreateCollectionFieldData, 'collection_id' | 'is_published'>): Promise<ApiResponse<CollectionField>> {
    return apiRequest<CollectionField>(`/ycode/api/collections/${collectionId}/fields`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateField(collectionId: string, fieldId: string, data: UpdateCollectionFieldData): Promise<ApiResponse<CollectionField>> {
    return apiRequest<CollectionField>(`/ycode/api/collections/${collectionId}/fields/${fieldId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deleteField(collectionId: string, fieldId: string): Promise<ApiResponse<void>> {
    return apiRequest<void>(`/ycode/api/collections/${collectionId}/fields/${fieldId}`, {
      method: 'DELETE',
    });
  },

  async getFieldUsage(collectionId: string, fieldId: string): Promise<ApiResponse<CollectionFieldUsageResult>> {
    return apiRequest(`/ycode/api/collections/${collectionId}/fields/${fieldId}/usage`);
  },

  async reorderFields(collectionId: string, fieldIds: string[]): Promise<ApiResponse<{ success: boolean }>> {
    return apiRequest<{ success: boolean }>(`/ycode/api/collections/${collectionId}/fields/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ field_ids: fieldIds }),
    });
  },

  // Items (with values)
  async getTopItemsPerCollection(
    collectionIds: string[],
    limit: number = 25
  ): Promise<ApiResponse<{ items: Record<string, { items: CollectionItemWithValues[] }> }>> {
    return apiRequest('/ycode/api/collections/items/batch', {
      method: 'POST',
      body: JSON.stringify({ collectionIds, limit }),
    });
  },

  /**
   * Batch-fetch items for reference-field display lookups across many
   * collections in a single round-trip. Skips status + count enrichment
   * since callers only consume raw `values`.
   */
  async getReferencedItemsBatch(
    collectionIds: string[],
    limit: number = 100
  ): Promise<ApiResponse<{ items: Record<string, { items: CollectionItemWithValues[] }> }>> {
    return apiRequest('/ycode/api/collections/items/batch', {
      method: 'POST',
      body: JSON.stringify({ collectionIds, limit, skipEnrichment: true }),
    });
  },

  async getItems(
    collectionId: string,
    options?: {
      page?: number;
      limit?: number;
      search?: string;
      sortBy?: string;
      sortOrder?: string;
      offset?: number;
      filters?: Array<{ fieldId: string; operator: string; value: string }>;
      includeAssets?: boolean;
      userScope?: boolean;
      userScopeFieldId?: string;
    }
  ): Promise<ApiResponse<{ items: CollectionItemWithValues[]; total: number; page: number; limit: number; referencedAssets?: Asset[] }>> {
    const params = new URLSearchParams();
    if (options?.page) params.append('page', options.page.toString());
    if (options?.limit) params.append('limit', options.limit.toString());
    if (options?.search) params.append('search', options.search);
    if (options?.sortBy) params.append('sortBy', options.sortBy);
    if (options?.sortOrder) params.append('sortOrder', options.sortOrder);
    if (options?.offset !== undefined) params.append('offset', options.offset.toString());
    if (options?.filters?.length) params.append('filters', JSON.stringify(options.filters));
    if (options?.includeAssets) params.append('includeAssets', 'true');
    if (options?.userScope) params.append('userScope', 'true');
    if (options?.userScopeFieldId) params.append('userScopeFieldId', options.userScopeFieldId);
    const queryString = params.toString();
    const url = `/ycode/api/collections/${collectionId}/items${queryString ? `?${queryString}` : ''}`;
    return apiRequest<{ items: CollectionItemWithValues[]; total: number; page: number; limit: number; referencedAssets?: Asset[] }>(url);
  },

  async getItemById(collectionId: string, itemId: string): Promise<ApiResponse<CollectionItemWithValues>> {
    return apiRequest<CollectionItemWithValues>(`/ycode/api/collections/${collectionId}/items/${itemId}`);
  },

  async createItem(collectionId: string, values: Record<string, any>, statusAction?: StatusAction): Promise<ApiResponse<CollectionItemWithValues>> {
    return apiRequest<CollectionItemWithValues>(`/ycode/api/collections/${collectionId}/items`, {
      method: 'POST',
      body: JSON.stringify({ values, ...(statusAction && { status_action: statusAction }) }),
    });
  },

  async updateItem(collectionId: string, itemId: string, values: Record<string, any>): Promise<ApiResponse<CollectionItemWithValues>> {
    return apiRequest<CollectionItemWithValues>(`/ycode/api/collections/${collectionId}/items/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify({ values }),
    });
  },

  async setItemPublishable(collectionId: string, itemId: string, is_publishable: boolean): Promise<ApiResponse<CollectionItemWithValues>> {
    return apiRequest<CollectionItemWithValues>(`/ycode/api/collections/${collectionId}/items/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify({ is_publishable }),
    });
  },

  async setItemStatus(collectionId: string, itemId: string, action: StatusAction): Promise<ApiResponse<CollectionItemWithValues>> {
    return apiRequest<CollectionItemWithValues>(`/ycode/api/collections/${collectionId}/items/${itemId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ action }),
    });
  },

  async deleteItem(collectionId: string, itemId: string): Promise<ApiResponse<void>> {
    return apiRequest<void>(`/ycode/api/collections/${collectionId}/items/${itemId}`, {
      method: 'DELETE',
    });
  },

  // Search
  async searchItems(
    collectionId: string,
    query: string,
    options?: { page?: number; limit?: number; sortBy?: string; sortOrder?: string; includeAssets?: boolean }
  ): Promise<ApiResponse<{ items: CollectionItemWithValues[]; total: number; page: number; limit: number; referencedAssets?: Asset[] }>> {
    const params = new URLSearchParams();
    params.append('search', query);
    if (options?.page) params.append('page', options.page.toString());
    if (options?.limit) params.append('limit', options.limit.toString());
    if (options?.sortBy) params.append('sortBy', options.sortBy);
    if (options?.sortOrder) params.append('sortOrder', options.sortOrder);
    if (options?.includeAssets) params.append('includeAssets', 'true');
    const url = `/ycode/api/collections/${collectionId}/items?${params.toString()}`;
    return apiRequest<{ items: CollectionItemWithValues[]; total: number; page: number; limit: number; referencedAssets?: Asset[] }>(url);
  },

  // Published items
  async getPublishedItems(collectionId: string): Promise<ApiResponse<CollectionItemWithValues[]>> {
    return apiRequest<CollectionItemWithValues[]>(`/ycode/api/collections/${collectionId}/items/published`);
  },

  // Unpublished items for a collection
  async getUnpublishedItems(collectionId: string): Promise<ApiResponse<CollectionItemWithValues[]>> {
    return apiRequest<CollectionItemWithValues[]>(`/ycode/api/collections/${collectionId}/items/unpublished`);
  },

  // Publish individual items
  async publishItems(itemIds: string[]): Promise<ApiResponse<{ count: number }>> {
    return apiRequest<{ count: number }>('/ycode/api/collections/items/publish', {
      method: 'POST',
      body: JSON.stringify({ item_ids: itemIds }),
    });
  },

  // Bulk delete items
  async bulkDeleteItems(itemIds: string[]): Promise<ApiResponse<{ deleted: number; errors?: string[] }>> {
    return apiRequest<{ deleted: number; errors?: string[] }>('/ycode/api/collections/items/delete', {
      method: 'POST',
      body: JSON.stringify({ item_ids: itemIds }),
    });
  },

  // Duplicate item
  async duplicateItem(collectionId: string, itemId: string): Promise<ApiResponse<CollectionItemWithValues>> {
    return apiRequest<CollectionItemWithValues>(`/ycode/api/collections/${collectionId}/items/${itemId}/duplicate`, {
      method: 'POST',
    });
  },

  // Reorder items (bulk update manual_order)
  async reorderItems(collectionId: string, updates: Array<{ id: string; manual_order: number }>): Promise<ApiResponse<{ updated: number }>> {
    return apiRequest<{ updated: number }>(`/ycode/api/collections/${collectionId}/items/reorder`, {
      method: 'POST',
      body: JSON.stringify({ updates }),
    });
  },
};

// Components API
export const componentsApi = {
  // Get unpublished components
  async getUnpublished(): Promise<ApiResponse<Component[]>> {
    return apiRequest<Component[]>('/ycode/api/components/unpublished');
  },

  // Create a new component
  async create(data: { name: string; layers: Layer[]; variables?: any[] }): Promise<ApiResponse<Component>> {
    return apiRequest<Component>('/ycode/api/components', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Upload a component thumbnail (FormData, not JSON)
  async uploadThumbnail(id: string, blob: Blob): Promise<ApiResponse<{ thumbnail_url: string }>> {
    const formData = new FormData();
    formData.append('image', blob, 'thumbnail.png');

    const response = await fetch(`/ycode/api/components/${id}/thumbnail`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      try {
        const json = await response.json();
        if (json.error) return { error: json.error };
      } catch { /* fall through */ }
      return { error: `HTTP ${response.status}: ${response.statusText}` };
    }

    return response.json();
  },
};

// Layer Styles API
export const layerStylesApi = {
  // Get unpublished layer styles
  async getUnpublished(): Promise<ApiResponse<LayerStyle[]>> {
    return apiRequest<LayerStyle[]>('/ycode/api/layer-styles/unpublished');
  },
};

// Editor API - Load all initial data at once
export const editorApi = {
  // Get all initial editor data in one request
  async init(): Promise<ApiResponse<{
    pages: Page[];
    drafts: PageLayers[];
    folders: PageFolder[];
    components: Component[];
    styles: LayerStyle[];
    settings: Setting[];
    collections: Collection[];
    locales: Locale[];
    assets: Asset[];
    assetFolders: AssetFolder[];
    fonts: Font[];
  }>> {
    return apiRequest('/ycode/api/editor/init');
  },
};

// Localisation API
export const localisationApi = {
  // Locales
  async getLocales(): Promise<ApiResponse<Locale[]>> {
    return apiRequest<Locale[]>('/ycode/api/locales');
  },

  async getLocaleById(id: string): Promise<ApiResponse<Locale>> {
    return apiRequest<Locale>(`/ycode/api/locales/${id}`);
  },

  async createLocale(data: CreateLocaleData): Promise<ApiResponse<{ locale: Locale; locales: Locale[] }>> {
    return apiRequest<{ locale: Locale; locales: Locale[] }>('/ycode/api/locales', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateLocale(id: string, data: UpdateLocaleData): Promise<ApiResponse<{ locale: Locale; locales: Locale[] }>> {
    return apiRequest<{ locale: Locale; locales: Locale[] }>(`/ycode/api/locales/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deleteLocale(id: string): Promise<ApiResponse<void>> {
    return apiRequest<void>(`/ycode/api/locales/${id}`, {
      method: 'DELETE',
    });
  },

  async setDefaultLocale(id: string): Promise<ApiResponse<Locale>> {
    return apiRequest<Locale>(`/ycode/api/locales/${id}/default`, {
      method: 'POST',
    });
  },

  // Translations
  async getTranslations(localeId: string): Promise<ApiResponse<Translation[]>> {
    return apiRequest<Translation[]>(`/ycode/api/translations?locale_id=${localeId}`);
  },

  async createTranslation(data: CreateTranslationData): Promise<ApiResponse<Translation>> {
    return apiRequest<Translation>('/ycode/api/translations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateTranslation(id: string, data: UpdateTranslationData): Promise<ApiResponse<Translation>> {
    return apiRequest<Translation>(`/ycode/api/translations/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deleteTranslation(id: string): Promise<ApiResponse<void>> {
    return apiRequest<void>(`/ycode/api/translations/${id}`, {
      method: 'DELETE',
    });
  },
};

// Settings API
export const settingsApi = {
  /**
   * Update multiple settings at once (batch upsert)
   * @param settings - Object with key-value pairs to store
   */
  async batchUpdate(settings: Record<string, any>): Promise<ApiResponse<{ count: number }>> {
    return apiRequest<{ count: number }>('/ycode/api/settings/batch', {
      method: 'PUT',
      body: JSON.stringify({ settings }),
    });
  },
};

// Cache API - Manage Next.js cache
export const cacheApi = {
  /**
   * Invalidate all Next.js cache
   * Should be called after publishing content
   */
  async clearAll(): Promise<ApiResponse<{ success: boolean }>> {
    return apiRequest<{ success: boolean }>('/ycode/api/cache/clear-all', {
      method: 'POST',
    });
  },
};

// File Upload API

// Files above this threshold use presigned URLs to bypass serverless body limits
const DIRECT_UPLOAD_THRESHOLD = 4.5 * 1024 * 1024; // 4.5MB

/**
 * Upload a file via presigned URL (direct browser-to-storage).
 * Used for large files that exceed serverless function body limits.
 */
async function uploadViaPresignedUrl(
  file: File,
  source: string,
  category?: AssetCategory | null,
  customName?: string,
  assetFolderId?: string | null
): Promise<Asset | null> {
  // 1. Get presigned upload URL from server
  const presignResponse = await fetch('/ycode/api/files/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      mimeType: file.type,
      fileSize: file.size,
      category,
    }),
  });

  if (!presignResponse.ok) {
    const errorData = await presignResponse.json();
    throw new Error(errorData.error || 'Failed to get upload URL');
  }

  const { data: presignData } = await presignResponse.json();

  // 2. Upload directly to Supabase Storage using the signed URL
  const uploadResponse = await fetch(presignData.signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });

  if (!uploadResponse.ok) {
    throw new Error('Failed to upload file to storage');
  }

  // 3. Register the asset record in the database
  const registerResponse = await fetch('/ycode/api/files/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      storagePath: presignData.storagePath,
      filename: file.name,
      mimeType: file.type,
      fileSize: file.size,
      source,
      customName,
      assetFolderId,
    }),
  });

  if (!registerResponse.ok) {
    const errorData = await registerResponse.json();
    throw new Error(errorData.error || 'Failed to register asset');
  }

  const { data } = await registerResponse.json();
  return data;
}

/**
 * Upload a file and create Asset record.
 * Small files (<4.5MB) go through the server for WebP conversion.
 * Large files use presigned URLs to upload directly to storage.
 *
 * @param file - File to upload
 * @param source - Source identifier (e.g., 'page-settings', 'components', 'library')
 * @param category - Optional file category for validation
 * @param customName - Optional custom name for the file
 */
export async function uploadFileApi(
  file: File,
  source: string,
  category?: AssetCategory | null,
  customName?: string,
  assetFolderId?: string | null
): Promise<Asset | null> {
  try {
    // Large files bypass the serverless function entirely
    if (file.size > DIRECT_UPLOAD_THRESHOLD) {
      return await uploadViaPresignedUrl(file, source, category, customName, assetFolderId);
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('source', source);
    if (category) {
      formData.append('category', category);
    }
    if (customName) {
      formData.append('name', customName);
    }
    if (assetFolderId) {
      formData.append('asset_folder_id', assetFolderId);
    }

    const response = await fetch('/ycode/api/files/upload', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to upload file');
    }

    const { data } = await response.json();
    return data;
  } catch (error) {
    console.error('Error uploading file:', error);
    return null;
  }
}

// Color Variables API
export const colorVariablesApi = {
  async getAll(): Promise<ApiResponse<import('@/types').ColorVariable[]>> {
    return apiRequest<import('@/types').ColorVariable[]>('/ycode/api/color-variables');
  },

  async create(data: { name: string; value: string }): Promise<ApiResponse<import('@/types').ColorVariable>> {
    return apiRequest<import('@/types').ColorVariable>('/ycode/api/color-variables', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async update(id: string, data: { name?: string; value?: string }): Promise<ApiResponse<import('@/types').ColorVariable>> {
    return apiRequest<import('@/types').ColorVariable>(`/ycode/api/color-variables/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async delete(id: string): Promise<ApiResponse<void>> {
    return apiRequest<void>(`/ycode/api/color-variables/${id}`, {
      method: 'DELETE',
    });
  },

  async reorder(orderedIds: string[]): Promise<ApiResponse<{ success: boolean }>> {
    return apiRequest<{ success: boolean }>('/ycode/api/color-variables/reorder', {
      method: 'PUT',
      body: JSON.stringify({ orderedIds }),
    });
  },
};

// Apps API
export const appsApi = {
  // Get settings for an app
  async getSettings(appId: string): Promise<ApiResponse<Record<string, any>>> {
    return apiRequest<Record<string, any>>(`/ycode/api/apps/${appId}/settings`);
  },

  // Update settings for an app
  async updateSettings(appId: string, settings: Record<string, any>): Promise<ApiResponse<Record<string, any>>> {
    return apiRequest<Record<string, any>>(`/ycode/api/apps/${appId}/settings`, {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  },

  // Disconnect an app
  async disconnect(appId: string): Promise<ApiResponse<void>> {
    return apiRequest<void>(`/ycode/api/apps/${appId}/settings`, {
      method: 'DELETE',
    });
  },
};

/**
 * Delete an asset (from both storage and database)
...
 * @param assetId - Asset ID to delete
 * @returns True if successful, false otherwise
 */
export async function deleteAssetApi(assetId: string): Promise<boolean> {
  try {
    const response = await fetch(
      `/ycode/api/files/delete?assetId=${encodeURIComponent(assetId)}`,
      { method: 'DELETE' }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to delete asset');
    }

    return true;
  } catch (error) {
    console.error('Error deleting asset:', error);
    return false;
  }
}
