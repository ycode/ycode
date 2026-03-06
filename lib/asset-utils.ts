/**
 * Asset Utility Functions
 * Centralized helpers for asset type detection, formatting, and categorization
 */

import type { AssetCategory, AssetCategoryFilter, Layer, Component, ComponentVariable } from '@/types';
import {
  ASSET_CATEGORIES,
  ALLOWED_MIME_TYPES,
  DEFAULT_ASSETS,
  getAcceptString,
} from './asset-constants';
import { isAssetVariable, getAssetId } from '@/lib/variable-utils';
import { applyComponentOverrides } from '@/lib/resolve-components';
import { uuidToBase62, mimeToExtension } from '@/lib/convertion-utils';
import { sanitizeSlug } from '@/lib/page-utils';

// Re-export constants for backward compatibility
export { ASSET_CATEGORIES, ALLOWED_MIME_TYPES, DEFAULT_ASSETS, getAcceptString };

/**
 * Check if an asset matches the specified category based on MIME type
 * Always uses ALLOWED_MIME_TYPES for consistency across all categories
 *
 * @param mimeType - The MIME type to check
 * @param category - The asset category to check against ('images', 'videos', 'audio', 'documents', 'icons')
 * @returns True if the MIME type matches the specified asset category
 *
 * @example
 * isAssetOfType('image/png', 'images') // true
 * isAssetOfType('image/svg+xml', 'icons') // true
 * isAssetOfType('video/mp4', 'videos') // true
 * isAssetOfType('application/pdf', 'documents') // true
 */
export function isAssetOfType(
  mimeType: string | undefined | null,
  category: AssetCategory
): boolean {
  if (!mimeType) return false;
  return ALLOWED_MIME_TYPES[category].includes(mimeType);
}

// Category to label mapping
const CATEGORY_LABELS: Record<AssetCategory, string> = {
  icons: 'Icon',
  images: 'Image',
  videos: 'Video',
  audio: 'Audio',
  documents: 'Document',
};

/**
 * Get a human-readable asset type label
 * Optimized to use getAssetCategoryFromMimeType instead of multiple isAssetOfType calls
 */
export function getAssetTypeLabel(mimeType: string | undefined | null): string {
  if (!mimeType) return 'Unknown';
  const category = getAssetCategoryFromMimeType(mimeType);
  return category ? CATEGORY_LABELS[category] : 'File';
}

// Category to icon name mapping
const CATEGORY_ICONS: Record<AssetCategory, string> = {
  icons: 'icon',
  images: 'image',
  videos: 'video',
  audio: 'audio',
  documents: 'file-text',
};

/**
 * Get icon name for an asset type based on MIME type
 * Optimized to use getAssetCategoryFromMimeType instead of multiple isAssetOfType calls
 */
export function getAssetIcon(mimeType: string | undefined | null): string {
  if (!mimeType) return 'file-text';
  const category = getAssetCategoryFromMimeType(mimeType);
  return category ? CATEGORY_ICONS[category] : 'file-text';
}

/**
 * Get asset category from MIME type
 * Returns the category that matches the MIME type, or null if no match
 * Optimized to check categories in order of specificity (icons first, then by prefix, then by ALLOWED_MIME_TYPES)
 *
 * @param mimeType - The MIME type to check
 * @returns The asset category ('images', 'videos', 'audio', 'documents', 'icons') or null if unknown
 *
 * @example
 * getAssetCategoryFromMimeType('image/png') // 'images'
 * getAssetCategoryFromMimeType('image/svg+xml') // 'icons'
 * getAssetCategoryFromMimeType('video/mp4') // 'videos'
 * getAssetCategoryFromMimeType('unknown/type') // null
 */
export function getAssetCategoryFromMimeType(
  mimeType: string | undefined | null
): AssetCategory | null {
  if (!mimeType) return null;

  // Check icons first (most specific, uses ALLOWED_MIME_TYPES)
  if (ALLOWED_MIME_TYPES.icons.includes(mimeType)) {
    return ASSET_CATEGORIES.ICONS;
  }

  // Check by prefix for faster matching (images, videos, audio)
  if (mimeType.startsWith('image/')) {
    return ASSET_CATEGORIES.IMAGES;
  }
  if (mimeType.startsWith('video/')) {
    return ASSET_CATEGORIES.VIDEOS;
  }
  if (mimeType.startsWith('audio/')) {
    return ASSET_CATEGORIES.AUDIO;
  }

  // Check documents (requires array lookup in ALLOWED_MIME_TYPES)
  if (ALLOWED_MIME_TYPES.documents.includes(mimeType)) {
    return ASSET_CATEGORIES.DOCUMENTS;
  }

  return null;
}

/**
 * Check if an asset matches the given category filter
 * Supports single category, array of categories, 'all', or null (shows all)
 */
export function matchesCategoryFilter(
  mimeType: string | undefined | null,
  filter: AssetCategoryFilter
): boolean {
  // Show all if filter is 'all' or null
  if (filter === 'all' || filter === null) {
    return true;
  }

  const assetCategory = getAssetCategoryFromMimeType(mimeType);
  if (!assetCategory) return false;

  // Single category
  if (typeof filter === 'string') {
    return assetCategory === filter;
  }

  // Array of categories
  return filter.includes(assetCategory);
}

/**
 * Normalize category filter to array format for internal use
 */
export function normalizeCategoryFilter(
  filter: AssetCategoryFilter
): AssetCategory[] | null {
  if (filter === 'all' || filter === null) {
    return null; // null means show all
  }
  if (typeof filter === 'string') {
    return [filter];
  }
  return filter;
}

/**
 * Format file size to human-readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Math.round(bytes / Math.pow(k, i))} ${sizes[i]}`;
}

/**
 * Get file extension from mime type
 */
export function getFileExtension(mimeType: string): string {
  const parts = mimeType.split('/');
  return parts[1]?.toUpperCase() || 'FILE';
}

/**
 * File validation result type
 */
export interface FileValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Validate an image file for upload
 * @param file - The file to validate
 * @param maxSizeMB - Maximum file size in megabytes (default: 10MB)
 * @returns Validation result with error message if invalid
 *
 * @example
 * const result = validateImageFile(file, 5);
 * if (!result.isValid) {
 *   console.error(result.error);
 * }
 */
export function validateImageFile(
  file: File,
  maxSizeMB: number = 10
): FileValidationResult {
  // Check file type
  if (!isAssetOfType(file.type, ASSET_CATEGORIES.IMAGES)) {
    return {
      isValid: false,
      error: 'Only image files are allowed',
    };
  }

  // Check file size
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  if (file.size > maxSizeBytes) {
    return {
      isValid: false,
      error: `File size must be less than ${maxSizeMB}MB`,
    };
  }

  return { isValid: true };
}

/**
 * Generate SEO-friendly proxy URL for an asset
 * Format: /a/{base62-id}/{slugified-name}.{ext}
 * Returns null for SVG/inline assets (no storage_path)
 */
export function getAssetProxyUrl(
  asset: { id: string; filename: string; mime_type: string; storage_path?: string | null }
): string | null {
  if (!asset.storage_path) return null;

  const hash = uuidToBase62(asset.id);
  const baseName = asset.filename.replace(/\.[^/.]+$/, '');
  const slug = sanitizeSlug(baseName) || 'file';
  const ext = mimeToExtension(asset.mime_type);

  return `/a/${hash}/${slug}.${ext}`;
}

/**
 * Check if a URL is an asset proxy URL (starts with /a/)
 */
function isProxyUrl(url: string): boolean {
  return url.startsWith('/a/');
}

/**
 * Check if a URL supports image transformation params
 */
function isTransformableUrl(url: string): boolean {
  if (isProxyUrl(url)) return true;
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.includes('supabase') || urlObj.pathname.includes('/storage/v1/object/public/');
  } catch {
    return false;
  }
}

/**
 * Generate optimized thumbnail URL for faster loading
 * Adds image transformation parameters for Supabase Storage URLs to reduce file size
 * @param url - Original image URL
 * @param width - Target width in pixels (default: 200)
 * @param height - Target height in pixels (default: 200)
 * @param quality - Image quality 0-100 (default: 80)
 * @returns Optimized URL with transformation parameters or original URL if not a Supabase Storage URL
 *
 * @example
 * getOptimizedImageUrl('https://supabase.co/storage/v1/object/public/assets/image.jpg')
 * // Returns: 'https://supabase.co/storage/v1/object/public/assets/image.jpg?width=200&height=200&resize=cover&quality=80'
 */
export function getOptimizedImageUrl(
  url: string,
  width: number = 200,
  height: number = 200,
  quality: number = 80
): string {
  if (!isTransformableUrl(url)) return url;

  try {
    if (isProxyUrl(url)) {
      const separator = url.includes('?') ? '&' : '?';
      return `${url}${separator}width=${width}&height=${height}&quality=${quality}`;
    }

    const urlObj = new URL(url);
    urlObj.searchParams.set('width', width.toString());
    urlObj.searchParams.set('height', height.toString());
    urlObj.searchParams.set('resize', 'cover');
    urlObj.searchParams.set('quality', quality.toString());
    return urlObj.toString();
  } catch {
    return url;
  }
}

/**
 * Generate responsive image srcset with multiple sizes
 * Creates optimized URLs for different viewport widths
 * @param url - Original image URL
 * @param sizes - Array of widths in pixels (default: [640, 960, 1280, 1920, 2560])
 * @param quality - Image quality 0-100 (default: 85)
 * @returns Srcset string with multiple size options
 *
 * @example
 * generateImageSrcset('https://supabase.co/storage/v1/object/public/assets/image.jpg')
 * // Returns: 'https://.../image.jpg?width=400&quality=85 400w, https://.../image.jpg?width=800&quality=85 800w, ...'
 */
export function generateImageSrcset(
  url: string,
  sizes: number[] = [640, 960, 1280, 1920, 2560],
  quality: number = 85
): string {
  if (!isTransformableUrl(url)) return '';

  try {
    if (isProxyUrl(url)) {
      const baseUrl = url.split('?')[0];
      return sizes
        .map((width) => `${baseUrl}?width=${width}&quality=${quality} ${width}w`)
        .join(', ');
    }

    const srcsetEntries = sizes.map((width) => {
      const sizeUrl = new URL(url);
      sizeUrl.searchParams.set('width', width.toString());
      sizeUrl.searchParams.set('quality', quality.toString());
      sizeUrl.searchParams.set('resize', 'cover');
      return `${sizeUrl.toString()} ${width}w`;
    });

    return srcsetEntries.join(', ');
  } catch {
    return '';
  }
}

/**
 * Get responsive sizes attribute for images
 * Provides default sizes based on common viewport breakpoints
 * @param customSizes - Optional custom sizes string (e.g., "(max-width: 768px) 100vw, 50vw")
 * @returns Sizes attribute string
 *
 * @example
 * getImageSizes() // Returns: "100vw"
 */
export function getImageSizes(customSizes?: string): string {
  if (customSizes) {
    return customSizes;
  }
  return '100vw';
}

// ==========================================
// Re-export folder utilities for backward compatibility
// ==========================================

export {
  flattenAssetFolderTree,
  hasChildFolders,
  rebuildAssetFolderTree,
  buildAssetFolderPath,
  isDescendantAssetFolder,
  type FlattenedAssetFolderNode,
} from './asset-folder-utils';

/**
 * Collect all asset IDs from a layer tree, including assets from:
 * - Layer variables (image, video, audio, icon, background image)
 * - Components embedded in rich-text content
 * - Component variable default values
 * - Component override values
 */
export function collectLayerAssetIds(
  layers: Layer[],
  components: Component[],
): Set<string> {
  const assetIds = new Set<string>();

  const addAssetVar = (v: any) => {
    if (isAssetVariable(v)) {
      const id = getAssetId(v);
      if (id) assetIds.add(id);
    }
  };

  /** Find componentOverrides for a specific componentId within a Tiptap tree. */
  const findOverrides = (node: any, targetId: string): Layer['componentOverrides'] | undefined => {
    if (!node || typeof node !== 'object') return undefined;
    if (node.type === 'richTextComponent' && node.attrs?.componentId === targetId) {
      return node.attrs.componentOverrides ?? undefined;
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) {
        const found = findOverrides(child, targetId);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  };

  /** Scan component overrides directly for asset IDs. */
  const scanOverrideAssets = (overrides: Layer['componentOverrides'], ancestors: Set<string>): void => {
    if (!overrides) return;
    if (overrides.text) {
      for (const val of Object.values(overrides.text)) {
        const content = (val as any)?.data?.content;
        if (content && typeof content === 'object') {
          scanRichTextMarks(content);
          scanRichTextComponents(content, ancestors);
        }
      }
    }
    for (const category of ['image', 'icon', 'audio', 'video'] as const) {
      const overrideMap = overrides[category];
      if (!overrideMap) continue;
      for (const val of Object.values(overrideMap)) {
        const v = val as any;
        addAssetVar(v?.src);
        addAssetVar(v?.poster);
      }
    }
    if (overrides.link) {
      for (const val of Object.values(overrides.link)) {
        const v = val as any;
        if (v?.asset?.id) assetIds.add(v.asset.id);
      }
    }
  };

  /** Scan Tiptap JSON for embedded richTextComponent nodes and collect their asset IDs. */
  const scanRichTextComponents = (node: any, ancestors: Set<string>): void => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'richTextComponent' && node.attrs?.componentId) {
      const cid = node.attrs.componentId as string;
      if (!ancestors.has(cid)) {
        const childAncestors = new Set(ancestors);
        childAncestors.add(cid);
        const overrides = node.attrs.componentOverrides ?? undefined;
        scanOverrideAssets(overrides, childAncestors);
        const comp = components.find(c => c.id === cid);
        if (comp?.layers?.length) {
          const resolved = applyComponentOverrides(comp.layers, overrides, comp.variables);
          resolved.forEach(l => scanLayer(l, childAncestors));
          scanVariableDefaults(comp.variables, childAncestors);
        }
      }
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) {
        scanRichTextComponents(child, ancestors);
      }
    }
  };

  /** Scan rich-text marks for asset links. */
  const scanRichTextMarks = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node.marks)) {
      for (const mark of node.marks) {
        if (mark.type === 'richTextLink' && mark.attrs?.asset?.id) {
          assetIds.add(mark.attrs.asset.id);
        }
      }
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) scanRichTextMarks(child);
    }
  };

  /** Scan component variable default values for asset references. */
  const scanVariableDefaults = (variables: ComponentVariable[] | undefined, ancestors: Set<string>): void => {
    if (!variables?.length) return;
    for (const variable of variables) {
      const def = variable.default_value as any;
      if (!def) continue;
      addAssetVar(def.src);
      addAssetVar(def.poster);
      const content = def.data?.content;
      if (content && typeof content === 'object') {
        scanRichTextComponents(content, ancestors);
      }
    }
  };

  /** Recursively scan a single layer for asset IDs. */
  const scanLayer = (layer: Layer, ancestors?: Set<string>): void => {
    addAssetVar(layer.variables?.image?.src);
    addAssetVar(layer.variables?.video?.src);
    addAssetVar(layer.variables?.video?.poster);
    addAssetVar(layer.variables?.audio?.src);
    addAssetVar(layer.variables?.icon?.src);
    addAssetVar(layer.variables?.backgroundImage?.src);

    // Direct asset link
    const linkAssetId = layer.variables?.link?.asset?.id;
    if (linkAssetId) assetIds.add(linkAssetId);

    // Lightbox file assets
    if (layer.settings?.lightbox?.files) {
      for (const fileId of layer.settings.lightbox.files) {
        if (fileId && !fileId.startsWith('http') && !fileId.startsWith('/')) {
          assetIds.add(fileId);
        }
      }
    }

    // Rich-text content: scan for asset links and embedded component assets
    const textVar = layer.variables?.text;
    if (textVar && 'data' in textVar && (textVar as any).data?.content) {
      const content = (textVar as any).data.content;
      scanRichTextMarks(content);
      scanRichTextComponents(content, ancestors ?? new Set<string>());
    }

    // Component override values
    scanOverrideAssets(layer.componentOverrides, ancestors ?? new Set<string>());

    // Component variable defaults
    if (layer.componentId) {
      const comp = components.find(c => c.id === layer.componentId);
      if (comp?.variables) {
        scanVariableDefaults(comp.variables, ancestors ?? new Set<string>());
      }
    }

    // Collection item values on resolved collection layers
    if (layer._collectionItemValues) {
      const isUuid = (v: string) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
      for (const value of Object.values(layer._collectionItemValues)) {
        if (typeof value === 'string' && isUuid(value)) {
          assetIds.add(value);
        }
      }
    }

    if (layer.children) {
      layer.children.forEach(child => scanLayer(child, ancestors));
    }
  };

  layers.forEach(layer => scanLayer(layer));
  return assetIds;
}
