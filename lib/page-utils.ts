/**
 * Utilities for pages and folders
 */

import type { IconProps } from '@/components/ui/icon';
import type { Page, PageFolder, PageSettings, FieldVariable, Translation, Locale } from '../types';
import { getTranslatableKey } from './locale-runtime';
import { getTiptapTextContent } from '@/lib/text-format-utils';
import { buildPasswordFormSubtree } from '@/lib/password-form-template';

/**
 * Build a revision key from a page's effective password protection (its own
 * settings plus any ancestor folder settings). Used by the builder to reload
 * the preview iframe when password settings change but the URL stays the same.
 */
export function buildPreviewAuthRevision(
  page: Page | null | undefined,
  folders: PageFolder[],
): string {
  if (!page) return '';

  const parts: string[] = [
    page.updated_at,
    String(page.settings?.auth?.enabled ?? false),
    page.settings?.auth?.password ?? '',
  ];

  let folderId = page.page_folder_id;
  while (folderId) {
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) break;
    parts.push(
      folder.updated_at,
      String(folder.settings?.auth?.enabled ?? false),
      folder.settings?.auth?.password ?? '',
    );
    folderId = folder.page_folder_id;
  }

  return parts.join('|');
}

/**
 * Reserved slugs that cannot be used at the root level (null parent folder)
 * These conflict with the app's routing structure
 */
export const RESERVED_ROOT_SLUGS = ['ycode'] as const;

/**
 * Check if a slug is reserved at root level
 */
export function isReservedRootSlug(slug: string): boolean {
  return RESERVED_ROOT_SLUGS.includes(slug.toLowerCase().trim() as typeof RESERVED_ROOT_SLUGS[number]);
}

export interface PageTreeNode {
  id: string;
  type: 'folder' | 'page';
  data: PageFolder | Page;
  children?: PageTreeNode[];
}

export interface FlattenedPageNode {
  id: string;
  type: 'folder' | 'page';
  data: PageFolder | Page;
  depth: number;
  parentId: string | null;
  index: number;
  collapsed?: boolean;
}

/**
 * Find the homepage from a list of pages
 */
export function findHomepage(pages: Page[]): Page | null {
  return pages.find(isHomepage) || null;
}

/**
 * Check if a page is the homepage
 */
export function isHomepage(page: Page): boolean {
  return page.is_index && page.page_folder_id === null;
}

/** The only page fields link resolution reads on the client. */
export type LinkResolutionPage = Pick<Page, 'id' | 'slug' | 'is_index' | 'is_dynamic' | 'page_folder_id'>;

/** The only folder fields link resolution reads on the client. */
export type LinkResolutionFolder = Pick<PageFolder, 'id' | 'slug' | 'page_folder_id'>;

/**
 * Project pages down to the fields link resolution needs. Full rows carry
 * every page's SEO text, custom code and `settings.auth.password`, so passing
 * them to a client component leaks that into the RSC payload of every page.
 */
export function slimPagesForLinks(pages: Page[]): LinkResolutionPage[] {
  return pages.map(({ id, slug, is_index, is_dynamic, page_folder_id }) => ({
    id,
    slug,
    is_index,
    is_dynamic,
    page_folder_id,
  }));
}

/** Folder counterpart of {@link slimPagesForLinks}. */
export function slimFoldersForLinks(folders: PageFolder[]): LinkResolutionFolder[] {
  return folders.map(({ id, slug, page_folder_id }) => ({
    id,
    slug,
    page_folder_id,
  }));
}

/**
 * Strip leading/trailing slashes from a single slug segment so it doesn't
 * collapse into an empty path or introduce double slashes when joined.
 * Preserves interior slashes (legacy nested slugs like `foo/bar`).
 */
export function normalizeSlugSegment(slug: string | null | undefined): string {
  return (slug ?? '').replace(/^\/+|\/+$/g, '');
}

/**
 * Build the full slug path for a page or folder
 * Returns the full URL path starting with "/"
 *
 * @example
 * buildSlugPath(page, folders) // "/products/item-1"
 * buildSlugPath(indexPage, folders) // "/products" (index pages don't have slug)
 * buildSlugPath(folder, folders) // "/products"
 */
export function buildSlugPath(
  item: Page | PageFolder | null,
  allFolders: PageFolder[],
  itemType: 'page' | 'folder',
  slugFieldKey: string = '{slug}'
): string {
  if (!item) return '/';

  const slugParts: string[] = [];

  // Build folder path
  let currentFolderId = item.page_folder_id;
  while (currentFolderId) {
    const folder = allFolders.find(f => f.id === currentFolderId);
    if (!folder) break;
    slugParts.unshift(folder.slug);
    currentFolderId = folder.page_folder_id;
  }

  // Add item's own slug (for folders or non-index pages)
  if (itemType === 'folder') {
    slugParts.push((item as PageFolder).slug);
  } else if (itemType === 'page') {
    const page = item as Page;

    if (page.is_dynamic) {
      slugParts.push(slugFieldKey);
    } else if (!page.is_index && page.slug) {
      slugParts.push(page.slug);
    }
  }

  // Legacy data sometimes stores an index page slug as the literal `/`. Without
  // normalisation that produces paths like `/blog//` when concatenated.
  return '/' + slugParts.map(normalizeSlugSegment).filter(Boolean).join('/');
}

/**
 * Build the full URL path for a dynamic page with a specific collection item slug
 * Replaces the {slug} placeholder with the actual slug value from the collection item
 *
 * @param page - The dynamic page
 * @param allFolders - Array of all folders
 * @param collectionItemSlug - The slug value from the collection item's slug field
 * @returns The full URL path with the slug value replaced, or the pattern path if slug is not provided
 *
 * @example
 * buildDynamicPageUrl(dynamicPage, folders, 'my-item-slug') // "/products/my-item-slug"
 * buildDynamicPageUrl(dynamicPage, folders, null) // "/products/{slug}"
 */
export function buildDynamicPageUrl(
  page: Page,
  allFolders: PageFolder[],
  collectionItemSlug: string | null
): string {
  const patternPath = buildSlugPath(page, allFolders, 'page', '{slug}');

  // If no slug value provided, return the pattern path
  if (collectionItemSlug === null) {
    return patternPath;
  }

  // Replace {slug} placeholder with the actual slug value
  return patternPath.replace(/\{slug\}/g, collectionItemSlug);
}

/**
 * Get translated slug for a page or folder from translations
 * Falls back to original slug if no translation exists
 */
function getTranslatedSlug(
  itemId: string,
  itemType: 'page' | 'folder',
  originalSlug: string,
  translations: Record<string, Translation> | undefined
): string {
  if (!translations) return originalSlug;

  const key = getTranslatableKey({
    source_type: itemType,
    source_id: itemId,
    content_key: 'slug',
  });

  const translation = translations[key];
  return translation?.content_value || originalSlug;
}

/**
 * Build localized slug path with translated slugs
 * Adds locale code prefix and uses translated slugs when available
 *
 * @param item - Page or folder to build path for
 * @param allFolders - Array of all folders
 * @param itemType - Type of item ('page' or 'folder')
 * @param locale - Locale object (null or undefined for default locale)
 * @param translations - Translations for the locale (keyed by translatable key)
 * @param slugFieldKey - Placeholder for dynamic page slugs (default: '{slug}')
 * @returns Localized URL path with locale prefix and translated slugs
 *
 * @example
 * buildLocalizedSlugPath(page, folders, 'page', frLocale, translations) // "/fr/produits/article-1"
 * buildLocalizedSlugPath(page, folders, 'page', null, undefined) // "/products/item-1" (default)
 */
export function buildLocalizedSlugPath(
  item: Page | PageFolder | null,
  allFolders: PageFolder[],
  itemType: 'page' | 'folder',
  locale: Locale | null | undefined,
  translations: Record<string, Translation> | undefined,
  slugFieldKey: string = '{slug}'
): string {
  if (!item) return '/';

  // Use default path if no locale or default locale
  const isDefaultLocale = !locale || locale.is_default;
  if (isDefaultLocale) {
    return buildSlugPath(item, allFolders, itemType, slugFieldKey);
  }

  const slugParts: string[] = [];

  // Build folder path with translated slugs
  let currentFolderId = item.page_folder_id;
  while (currentFolderId) {
    const folder = allFolders.find(f => f.id === currentFolderId);
    if (!folder) break;

    const translatedSlug = getTranslatedSlug(
      folder.id,
      'folder',
      folder.slug,
      translations
    );
    slugParts.unshift(translatedSlug);
    currentFolderId = folder.page_folder_id;
  }

  // Add item's own slug (for folders or non-index pages)
  if (itemType === 'folder') {
    const folder = item as PageFolder;
    const translatedSlug = getTranslatedSlug(
      folder.id,
      'folder',
      folder.slug,
      translations
    );
    slugParts.push(translatedSlug);
  } else if (itemType === 'page') {
    const page = item as Page;

    if (page.is_dynamic) {
      slugParts.push(slugFieldKey);
    } else if (!page.is_index && page.slug) {
      const translatedSlug = getTranslatedSlug(
        page.id,
        'page',
        page.slug,
        translations
      );
      slugParts.push(translatedSlug);
    }
  }

  // Add locale code prefix. Index pages have no slug segments, so the localized
  // homepage is `/<locale>` (no trailing slash) to match its canonical URL.
  const localizedSegments = slugParts.map(normalizeSlugSegment).filter(Boolean);
  return localizedSegments.length > 0
    ? `/${locale.code}/${localizedSegments.join('/')}`
    : `/${locale.code}`;
}

/**
 * Build localized URL for a dynamic page with translated slugs
 * Combines localized path building with dynamic slug replacement
 *
 * @param page - The dynamic page
 * @param allFolders - Array of all folders
 * @param collectionItemSlug - The slug value from the collection item
 * @param locale - Locale object (null or undefined for default locale)
 * @param translations - Translations for the locale
 * @returns Localized URL with locale prefix, translated folder/page slugs, and collection item slug
 *
 * @example
 * buildLocalizedDynamicPageUrl(page, folders, 'mon-article', frLocale, translations)
 * // "/fr/produits/mon-article"
 */
export function buildLocalizedDynamicPageUrl(
  page: Page,
  allFolders: PageFolder[],
  collectionItemSlug: string | null,
  locale: Locale | null | undefined,
  translations: Record<string, Translation> | undefined
): string {
  const patternPath = buildLocalizedSlugPath(
    page,
    allFolders,
    'page',
    locale,
    translations,
    '{slug}'
  );

  // If no slug value provided, return the pattern path
  if (collectionItemSlug === null) {
    return patternPath;
  }

  // Replace {slug} placeholder with the actual slug value
  return patternPath.replace(/\{slug\}/g, collectionItemSlug);
}

/**
 * Slug context for a dynamic (CMS-driven) page, used to resolve the translated
 * item slug per locale.
 */
export interface LocalizedDynamicSlug {
  /** Collection item ID (translation `source_id`). */
  itemId: string;
  /** Translation `content_key` for the slug field (e.g. `field:key:slug`). */
  contentKey: string;
  /** Default-locale slug value, used as the fallback. */
  defaultValue: string;
}

/**
 * Build relative localized URLs for a page across every locale, keyed by locale ID.
 * Reuses translated folder/page slugs and, for dynamic pages, the translated CMS
 * item slug. Powers the locale selector so switching language preserves the
 * correct translated path.
 *
 * @param translationsByLocale - Per-locale translation maps keyed by translatable key
 * @param dynamicSlug - Slug context for dynamic pages (omit for static pages)
 *
 * @example
 * buildLocalizedPageUrls(page, folders, locales, translationsByLocale, dynamicSlug)
 * // { 'locale-en': '/solutions/structured-websites', 'locale-fr': '/fr/solutions/sites-structures' }
 */
export function buildLocalizedPageUrls(
  page: Page,
  allFolders: PageFolder[],
  locales: Locale[],
  translationsByLocale: Record<string, Record<string, Translation> | undefined>,
  dynamicSlug?: LocalizedDynamicSlug | null
): Record<string, string> {
  const urls: Record<string, string> = {};

  for (const locale of locales) {
    const isDefaultLocale = locale.is_default;
    const localeArg = isDefaultLocale ? null : locale;
    const translations = isDefaultLocale ? undefined : translationsByLocale[locale.id];

    if (dynamicSlug) {
      const translatedSlug = isDefaultLocale
        ? dynamicSlug.defaultValue
        : translations?.[getTranslatableKey({
          source_type: 'cms',
          source_id: dynamicSlug.itemId,
          content_key: dynamicSlug.contentKey,
        })]?.content_value || dynamicSlug.defaultValue;

      urls[locale.id] = buildLocalizedDynamicPageUrl(page, allFolders, translatedSlug, localeArg, translations);
    } else {
      urls[locale.id] = buildLocalizedSlugPath(page, allFolders, 'page', localeArg, translations);
    }
  }

  return urls;
}

/**
 * Detect locale code from URL path
 * Checks if the first segment of the path is a valid locale code from the provided list
 *
 * @param slugPath - The URL path (e.g., "fr/products/item" or "products/item")
 * @param validLocaleCodes - Array of valid locale codes from the database
 * @returns Object with locale code and remaining path, or null if no locale detected
 *
 * @example
 * detectLocaleFromPath("fr/products/item", ["en", "fr"]) // { localeCode: "fr", remainingPath: "products/item" }
 * detectLocaleFromPath("products/item", ["en", "fr"]) // null (no locale prefix)
 */
export function detectLocaleFromPath(
  slugPath: string,
  validLocaleCodes: string[]
): { localeCode: string; remainingPath: string } | null {
  const segments = slugPath.split('/').filter(Boolean);

  if (segments.length === 0) {
    return null;
  }

  const firstSegment = segments[0].toLowerCase();

  // Check if first segment is a valid locale code from the database
  const isValidLocale = validLocaleCodes.some(code => code.toLowerCase() === firstSegment);

  if (isValidLocale) {
    return {
      localeCode: firstSegment,
      remainingPath: segments.slice(1).join('/'),
    };
  }

  return null;
}

/**
 * Match URL path against page using translated slugs
 * Tries to match folder slugs and page slugs with translations
 *
 * @param urlPath - The URL path to match (without locale prefix)
 * @param page - The page to check
 * @param allFolders - Array of all folders
 * @param translations - Translations map (keyed by translatable key)
 * @returns True if URL matches this page's translated path
 */
export function matchPageWithTranslatedSlugs(
  urlPath: string,
  page: Page,
  allFolders: PageFolder[],
  translations: Record<string, Translation> | undefined
): boolean {
  const targetPath = `/${urlPath}`;
  const slugParts: string[] = [];

  // Build folder path with either translated or original slugs
  let currentFolderId = page.page_folder_id;
  while (currentFolderId) {
    const folder = allFolders.find(f => f.id === currentFolderId);
    if (!folder) break;

    // Try translated slug first, fall back to original
    const translatedSlug = getTranslatedSlug(folder.id, 'folder', folder.slug, translations);

    slugParts.unshift(translatedSlug);
    currentFolderId = folder.page_folder_id;
  }

  // Add page's own slug
  if (!page.is_index && page.slug) {
    const translatedSlug = getTranslatedSlug(page.id, 'page', page.slug, translations);
    slugParts.push(translatedSlug);
  }

  const constructedPath = '/' + slugParts.map(normalizeSlugSegment).filter(Boolean).join('/');
  return constructedPath === targetPath;
}

/**
 * Match URL path against dynamic page pattern using translated slugs
 * Similar to matchDynamicPagePattern but with translation support
 *
 * @param urlPath - The URL path to match (without locale prefix)
 * @param page - The dynamic page to check
 * @param allFolders - Array of all folders
 * @param translations - Translations map
 * @returns The extracted slug value or null if no match
 */
export function matchDynamicPageWithTranslatedSlugs(
  urlPath: string,
  page: Page,
  allFolders: PageFolder[],
  translations: Record<string, Translation> | undefined
): string | null {
  const targetPath = `/${urlPath}`;
  const slugParts: string[] = [];

  // Build folder path with translated slugs
  let currentFolderId = page.page_folder_id;
  while (currentFolderId) {
    const folder = allFolders.find(f => f.id === currentFolderId);
    if (!folder) break;

    const translatedSlug = getTranslatedSlug(folder.id, 'folder', folder.slug, translations);

    slugParts.unshift(translatedSlug);
    currentFolderId = folder.page_folder_id;
  }

  // Add {slug} placeholder for dynamic page
  slugParts.push('{slug}');

  const patternPath = '/' + slugParts.map(normalizeSlugSegment).filter(Boolean).join('/');

  // Replace {slug} with regex capture group
  const patternRegex = patternPath.replace(/\{slug\}/g, '([^/]+)');
  const regex = new RegExp(`^${patternRegex}$`);
  const match = targetPath.match(regex);

  if (!match) {
    return null;
  }

  // Extract the slug value (first capture group)
  return match[1] || null;
}

/**
 * Build a hierarchical folder path string (e.g., "Products / Electronics / Phones")
 * Used for displaying folder paths in UI
 *
 * @example
 * buildFolderPath(folder, allFolders) // "Products / Electronics"
 * buildFolderPath(folder, allFolders, true) // ["Products", "Electronics"]
 */
export function buildFolderPath(
  folder: PageFolder,
  allFolders: PageFolder[],
  asArray: boolean = false
): string | string[] {
  if (!folder.page_folder_id) {
    return asArray ? [folder.name] : folder.name;
  }
  const parent = allFolders.find(f => f.id === folder.page_folder_id);
  if (!parent) {
    return asArray ? [folder.name] : folder.name;
  }

  if (asArray) {
    const parentPath = buildFolderPath(parent, allFolders, true) as string[];
    return [...parentPath, folder.name];
  }

  return `${buildFolderPath(parent, allFolders)} / ${folder.name}`;
}

/**
 * Check if one folder is a descendant of another folder
 *
 * @example
 * isDescendantFolder(childId, parentId, allFolders) // true if child is nested under parent
 */
export function isDescendantFolder(
  folderId: string,
  potentialAncestorId: string,
  allFolders: PageFolder[]
): boolean {
  const targetFolder = allFolders.find(f => f.id === folderId);
  if (!targetFolder || !targetFolder.page_folder_id) return false;
  if (targetFolder.page_folder_id === potentialAncestorId) return true;
  return isDescendantFolder(targetFolder.page_folder_id, potentialAncestorId, allFolders);
}

/**
 * Check if a folder contains an index page
 *
 * @param folderId - The folder ID to check (null for root folder)
 * @param pages - Array of all pages
 * @param excludePageId - Optional page ID to exclude from check (useful when editing a page)
 * @returns true if the folder has an index page
 *
 * @example
 * folderHasIndexPage(folderId, pages) // true if folder has an index page
 * folderHasIndexPage(null, pages) // check if root folder has homepage
 * folderHasIndexPage(folderId, pages, currentPageId) // exclude current page from check
 */
export function folderHasIndexPage(
  folderId: string | null,
  pages: Page[],
  excludePageId?: string
): boolean {
  return pages.some(
    p => p.id !== excludePageId &&
        p.is_index &&
        p.page_folder_id === folderId
  );
}

/**
 * Get all descendant folder IDs for a given folder
 *
 * This function builds a map for efficient lookup and recursively finds
 * all child folders at any depth.
 *
 * @param folderId - The parent folder ID to find descendants for
 * @param allFolders - Array of all folders to search through
 * @returns Array of descendant folder IDs (does not include the parent folder ID)
 *
 * @example
 * const folders = [
 *   { id: 'a', page_folder_id: null },
 *   { id: 'b', page_folder_id: 'a' },
 *   { id: 'c', page_folder_id: 'b' },
 * ];
 * getDescendantFolderIds('a', folders); // Returns: ['b', 'c']
 */
export function getDescendantFolderIds(
  folderId: string,
  allFolders: PageFolder[]
): string[] {
  // Build a map for quick lookup: parentId -> childIds[]
  const foldersByParent = new Map<string, string[]>();
  for (const folder of allFolders) {
    const parentId = folder.page_folder_id || 'root';
    if (!foldersByParent.has(parentId)) {
      foldersByParent.set(parentId, []);
    }
    foldersByParent.get(parentId)!.push(folder.id);
  }

  // Recursively collect all descendant IDs
  const collectDescendants = (parentId: string): string[] => {
    const children = foldersByParent.get(parentId) || [];
    const descendants: string[] = [...children];

    for (const childId of children) {
      descendants.push(...collectDescendants(childId));
    }

    return descendants;
  };

  return collectDescendants(folderId);
}

/**
 * Get icon name based on node type and data
 */
export function getNodeIcon(node: FlattenedPageNode | PageTreeNode): IconProps['name'] {
  if (node.type === 'folder') {
    return 'folder';
  } else {
    return getPageIcon(node.data as Page);
  }
}

/**
 * Get icon name based on node type and data
 */
export function getPageIcon(page: Page): IconProps['name'] {
  if (page.is_index) return 'homepage';
  if (page.is_dynamic) return 'dynamicPage';
  return 'page';
}

/**
 * Build a tree structure from pages and folders
 */
export function buildPageTree(
  pages: Page[],
  folders: PageFolder[]
): PageTreeNode[] {
  // Create a map of folders by ID for quick lookup
  const folderMap = new Map<string, PageTreeNode>();

  // Initialize folder nodes
  folders.forEach(folder => {
    folderMap.set(folder.id, {
      id: folder.id,
      type: 'folder',
      data: folder,
      children: [],
    });
  });

  // Build folder hierarchy
  const rootFolders: PageTreeNode[] = [];

  folders.forEach(folder => {
    const node = folderMap.get(folder.id)!;

    if (folder.page_folder_id === null) {
      // Root folder
      rootFolders.push(node);
    } else {
      // Child folder
      const parent = folderMap.get(folder.page_folder_id);
      if (parent) {
        parent.children = parent.children || [];
        parent.children.push(node);
      }
    }
  });

  // Add pages to appropriate folders or root
  pages.forEach(page => {
    const pageNode: PageTreeNode = {
      id: page.id,
      type: 'page',
      data: page,
    };

    if (page.page_folder_id === null) {
      // Root page
      rootFolders.push(pageNode);
    } else {
      // Page in folder
      const parent = folderMap.get(page.page_folder_id);
      if (parent) {
        parent.children = parent.children || [];
        parent.children.push(pageNode);
      } else {
        // Parent folder not found, add to root
        rootFolders.push(pageNode);
      }
    }
  });

  // Sort children by order for both folders and pages
  const sortChildren = (nodes: PageTreeNode[]) => {
    nodes.sort((a, b) => {
      // Get order values (default to 0 if not set)
      const orderA = a.type === 'folder' ? (a.data as PageFolder).order : (a.data as Page).order;
      const orderB = b.type === 'folder' ? (b.data as PageFolder).order : (b.data as Page).order;

      const finalOrderA = orderA ?? 0;
      const finalOrderB = orderB ?? 0;

      // Sort by order (ascending: 0, 1, 2, 3...)
      return finalOrderA - finalOrderB;
    });

    // Recursively sort children
    nodes.forEach(node => {
      if (node.children) {
        sortChildren(node.children);
      }
    });
  };

  sortChildren(rootFolders);

  return rootFolders;
}

/**
 * Filter a page tree by a case-insensitive name query.
 * Matching pages keep their ancestor folders so hierarchy stays visible.
 * A folder whose name matches is kept with all of its children.
 */
export function filterPageTree(nodes: PageTreeNode[], query: string): PageTreeNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return nodes;

  const filterNodes = (list: PageTreeNode[]): PageTreeNode[] => {
    const result: PageTreeNode[] = [];

    for (const node of list) {
      const name = node.type === 'folder'
        ? (node.data as PageFolder).name
        : (node.data as Page).name;
      const nameMatches = name.toLowerCase().includes(needle);

      if (nameMatches) {
        result.push(node);
        continue;
      }

      if (node.children && node.children.length > 0) {
        const filteredChildren = filterNodes(node.children);
        if (filteredChildren.length > 0) {
          result.push({ ...node, children: filteredChildren });
        }
      }
    }

    return result;
  };

  return filterNodes(nodes);
}

/**
 * Flatten a page tree structure into a linear array with depth information
 */
export function flattenPageTree(
  nodes: PageTreeNode[],
  parentId: string | null = null,
  depth: number = 0,
  collapsedIds: Set<string> = new Set()
): FlattenedPageNode[] {
  const flattened: FlattenedPageNode[] = [];

  nodes.forEach((node, index) => {
    const isCollapsed = collapsedIds.has(node.id);

    flattened.push({
      id: node.id,
      type: node.type,
      data: node.data,
      depth,
      parentId,
      index,
      collapsed: isCollapsed,
    });

    // Only flatten children if not collapsed and has children
    if (node.children && node.children.length > 0 && !isCollapsed) {
      flattened.push(
        ...flattenPageTree(node.children, node.id, depth + 1, collapsedIds)
      );
    }
  });

  return flattened;
}

/**
 * Rebuild tree structure after reordering
 */
export function rebuildPageTree(
  flattenedNodes: FlattenedPageNode[],
  movedId: string,
  newParentId: string | null,
  newOrder: number
): PageTreeNode[] {
  // Create a copy of all nodes
  const nodeCopy = flattenedNodes.map(n => ({
    ...n,
    data: { ...n.data }
  }));

  // Find and update the moved node
  const movedNode = nodeCopy.find(n => n.id === movedId);
  if (!movedNode) {
    console.error('❌ REBUILD ERROR: Moved node not found!');
    return [];
  }

  // Update moved node's parent and index
  movedNode.parentId = newParentId;
  movedNode.index = newOrder;

  // Group nodes by parent
  const byParent = new Map<string | null, FlattenedPageNode[]>();
  nodeCopy.forEach(node => {
    const parent = node.parentId;
    if (!byParent.has(parent)) {
      byParent.set(parent, []);
    }
    byParent.get(parent)!.push(node);
  });

  // Sort each group by index and reassign indices
  byParent.forEach((children, parentId) => {
    // Sort by current index first
    children.sort((a, b) => a.index - b.index);

    // If this group contains the moved node, reorder it
    const movedNodeInGroup = children.find(n => n.id === movedId);
    if (movedNodeInGroup) {
      // Remove moved node from its current position
      const movedIndex = children.findIndex(n => n.id === movedId);
      children.splice(movedIndex, 1);

      // Insert at new position
      let insertIndex = 0;
      for (let i = 0; i < children.length; i++) {
        if (children[i].index < newOrder) {
          insertIndex = i + 1;
        } else {
          break;
        }
      }

      children.splice(insertIndex, 0, movedNodeInGroup);
    }

    // Reassign sequential indices
    children.forEach((child, idx) => {
      child.index = idx;
    });
  });

  // Build tree recursively
  function buildNode(nodeId: string): PageTreeNode {
    const node = nodeCopy.find(n => n.id === nodeId)!;
    const childNodes = byParent.get(nodeId) || [];

    const result: PageTreeNode = {
      id: node.id,
      type: node.type,
      data: node.data,
    };

    if (childNodes.length > 0) {
      result.children = childNodes.map(child => buildNode(child.id));
    }

    return result;
  }

  // Build root level
  const rootNodes = byParent.get(null) || [];
  const result = rootNodes.map(node => buildNode(node.id));

  return result;
}

/**
 * Check if a node is a descendant of another
 */
export function isDescendant(
  node: FlattenedPageNode,
  target: FlattenedPageNode,
  allNodes: FlattenedPageNode[]
): boolean {
  if (node.id === target.id) return true;

  const parent = allNodes.find((n) => n.id === target.parentId);
  if (!parent) return false;

  return isDescendant(node, parent, allNodes);
}

/**
 * Generate a URL-safe slug from a name
 * @example generateSlug('About Us') // 'about-us'
 */
/**
 * Transliteration map for international characters to ASCII equivalents
 * Supports Cyrillic, Latin Extended, Greek, and other common characters
 */
const TRANSLITERATION_MAP: Record<string, string> = {
  // Lithuanian
  'ą': 'a', 'č': 'c', 'ę': 'e', 'ė': 'e', 'į': 'i', 'š': 's', 'ų': 'u', 'ū': 'u', 'ž': 'z',
  'Ą': 'A', 'Č': 'C', 'Ę': 'E', 'Ė': 'E', 'Į': 'I', 'Š': 'S', 'Ų': 'U', 'Ū': 'U', 'Ž': 'Z',

  // Russian/Cyrillic
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh', 'з': 'z',
  'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r',
  'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch',
  'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
  'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E', 'Ё': 'Yo', 'Ж': 'Zh', 'З': 'Z',
  'И': 'I', 'Й': 'Y', 'К': 'K', 'Л': 'L', 'М': 'M', 'Н': 'N', 'О': 'O', 'П': 'P', 'Р': 'R',
  'С': 'S', 'Т': 'T', 'У': 'U', 'Ф': 'F', 'Х': 'H', 'Ц': 'Ts', 'Ч': 'Ch', 'Ш': 'Sh', 'Щ': 'Shch',
  'Ъ': '', 'Ы': 'Y', 'Ь': '', 'Э': 'E', 'Ю': 'Yu', 'Я': 'Ya',

  // Polish (unique characters not in Lithuanian)
  'ć': 'c', 'ł': 'l', 'ń': 'n', 'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z',
  'Ć': 'C', 'Ł': 'L', 'Ń': 'N', 'Ó': 'O', 'Ś': 'S', 'Ź': 'Z', 'Ż': 'Z',

  // German
  'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss',
  'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue',

  // French (unique characters not in other languages)
  'à': 'a', 'â': 'a', 'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e', 'î': 'i', 'ï': 'i', 'ô': 'o', 'ù': 'u', 'û': 'u', 'ÿ': 'y', 'ç': 'c',
  'À': 'A', 'Â': 'A', 'É': 'E', 'È': 'E', 'Ê': 'E', 'Ë': 'E', 'Î': 'I', 'Ï': 'I', 'Ô': 'O', 'Ù': 'U', 'Û': 'U', 'Ÿ': 'Y', 'Ç': 'C',

  // Spanish (unique characters not in French)
  'á': 'a', 'í': 'i', 'ú': 'u', 'ñ': 'n',
  'Á': 'A', 'Í': 'I', 'Ú': 'U', 'Ñ': 'N',

  // Portuguese
  'ã': 'a', 'õ': 'o',
  'Ã': 'A', 'Õ': 'O',

  // Czech/Slovak
  'ě': 'e', 'ř': 'r', 'ť': 't', 'ů': 'u', 'ý': 'y',
  'Ě': 'E', 'Ř': 'R', 'Ť': 'T', 'Ů': 'U', 'Ý': 'Y',

  // Romanian (unique characters)
  'ă': 'a', 'ș': 's', 'ț': 't',
  'Ă': 'A', 'Ș': 'S', 'Ț': 'T',

  // Turkish
  'ğ': 'g', 'ı': 'i', 'ş': 's',
  'Ğ': 'G', 'İ': 'I', 'Ş': 'S',

  // Greek
  'α': 'a', 'β': 'b', 'γ': 'g', 'δ': 'd', 'ε': 'e', 'ζ': 'z', 'η': 'i', 'θ': 'th',
  'ι': 'i', 'κ': 'k', 'λ': 'l', 'μ': 'm', 'ν': 'n', 'ξ': 'x', 'ο': 'o', 'π': 'p',
  'ρ': 'r', 'σ': 's', 'ς': 's', 'τ': 't', 'υ': 'y', 'φ': 'f', 'χ': 'ch', 'ψ': 'ps', 'ω': 'o',
  'Α': 'A', 'Β': 'B', 'Γ': 'G', 'Δ': 'D', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'I', 'Θ': 'Th',
  'Ι': 'I', 'Κ': 'K', 'Λ': 'L', 'Μ': 'M', 'Ν': 'N', 'Ξ': 'X', 'Ο': 'O', 'Π': 'P',
  'Ρ': 'R', 'Σ': 'S', 'Τ': 'T', 'Υ': 'Y', 'Φ': 'F', 'Χ': 'Ch', 'Ψ': 'Ps', 'Ω': 'O',

  // Scandinavian
  'å': 'a', 'æ': 'ae', 'ø': 'o',
  'Å': 'A', 'Æ': 'Ae', 'Ø': 'O',

  // Latvian
  'ā': 'a', 'ē': 'e', 'ģ': 'g', 'ī': 'i', 'ķ': 'k', 'ļ': 'l', 'ņ': 'n',
  'Ā': 'A', 'Ē': 'E', 'Ģ': 'G', 'Ī': 'I', 'Ķ': 'K', 'Ļ': 'L', 'Ņ': 'N',

  // Ukrainian (additional to Russian)
  'є': 'ye', 'і': 'i', 'ї': 'yi', 'ґ': 'g',
  'Є': 'Ye', 'І': 'I', 'Ї': 'Yi', 'Ґ': 'G',

  // Serbian (additional to Russian/Cyrillic)
  'ђ': 'dj', 'ј': 'j', 'љ': 'lj', 'њ': 'nj', 'ћ': 'c', 'џ': 'dz',
  'Ђ': 'Dj', 'Ј': 'J', 'Љ': 'Lj', 'Њ': 'Nj', 'Ћ': 'C', 'Џ': 'Dz',
};

/**
 * Transliterate international characters to ASCII equivalents
 * @param text - Text to transliterate
 * @returns Transliterated text with ASCII characters
 */
function transliterate(text: string): string {
  let result = '';

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const transliterated = TRANSLITERATION_MAP[char];

    if (transliterated !== undefined) {
      result += transliterated;
    } else {
      result += char;
    }
  }

  return result;
}

/**
 * Sanitize slug to only allow [a-z0-9-] characters
 * Replaces invalid characters with "-" and removes consecutive dashes
 * Transliterates international characters first (Lithuanian, Russian, etc.)
 * @param slug - The slug to sanitize
 * @param allowTrailingDash - If true, allows trailing dashes (for real-time input). Defaults to false.
 */
export function sanitizeSlug(slug: string, allowTrailingDash: boolean = false): string {
  // First, transliterate international characters
  let sanitized = transliterate(slug);

  // Convert to lowercase and replace invalid chars with dash
  sanitized = sanitized
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-') // Replace invalid chars with dash
    .replace(/-+/g, '-'); // Replace multiple consecutive dashes with single dash

  // Remove leading dashes
  sanitized = sanitized.replace(/^-+/, '');

  // Remove trailing dashes only if not allowed (for final validation)
  if (!allowTrailingDash) {
    sanitized = sanitized.replace(/-+$/, '');
  }

  return sanitized;
}

export function generateSlug(name: string): string {
  return sanitizeSlug(name);
}

/**
 * Generate a unique page slug, appending -2, -3, etc. if duplicates exist in the same folder
 * @param excludePageId - Optional page ID to exclude when checking duplicates (for editing)
 */
export function generateUniqueSlug(
  baseName: string,
  pages: Page[],
  folderId: string | null = null,
  isPublished: boolean = false,
  excludePageId?: string
): string {
  const baseSlug = generateSlug(baseName);

  if (!baseSlug) return '';

  // Check if base slug exists in the same folder and published state
  const existingSlugs = pages
    .filter(p =>
      p.id !== excludePageId && // Exclude current page if editing
      p.page_folder_id === folderId && // Same folder
      p.is_published === isPublished && // Same published state
      p.error_page === null // Exclude error pages
    )
    .map(p => p.slug.toLowerCase());

  // Check if base slug is available (not duplicate and not reserved at root)
  const isBaseSlugReserved = folderId === null && isReservedRootSlug(baseSlug);
  if (!existingSlugs.includes(baseSlug) && !isBaseSlugReserved) {
    return baseSlug;
  }

  // Otherwise, find the next available number
  let counter = 2;
  let uniqueSlug = `${baseSlug}-${counter}`;

  while (existingSlugs.includes(uniqueSlug)) {
    counter++;
    uniqueSlug = `${baseSlug}-${counter}`;
  }

  return uniqueSlug;
}

/**
 * Generate a unique folder slug, appending -2, -3, etc. if duplicates exist in the same parent
 * @param excludeFolderId - Optional folder ID to exclude when checking duplicates (for editing)
 */
export function generateUniqueFolderSlug(
  baseName: string,
  folders: PageFolder[],
  parentFolderId: string | null = null,
  excludeFolderId?: string
): string {
  const baseSlug = generateSlug(baseName);

  if (!baseSlug) return '';

  // Check if base slug exists in the same parent folder
  const existingSlugs = folders
    .filter(f =>
      f.id !== excludeFolderId && // Exclude current folder if editing
      f.page_folder_id === parentFolderId // Same parent folder
    )
    .map(f => f.slug.toLowerCase());

  // Check if base slug is available (not duplicate and not reserved at root)
  const isBaseSlugReserved = parentFolderId === null && isReservedRootSlug(baseSlug);
  if (!existingSlugs.includes(baseSlug) && !isBaseSlugReserved) {
    return baseSlug;
  }

  // Otherwise, find the next available number
  let counter = 2;
  let uniqueSlug = `${baseSlug}-${counter}`;

  while (existingSlugs.includes(uniqueSlug)) {
    counter++;
    uniqueSlug = `${baseSlug}-${counter}`;
  }

  return uniqueSlug;
}

/**
 * Find the highest number in names matching "Prefix N" pattern and return next number
 * @example getNextNumberFromNames([{ name: 'Page 5' }], 'Page') // 6
 */
export function getNextNumberFromNames(
  items: Array<{ name: string }>,
  prefix: string
): number {
  // Extract numbers from names that match the pattern "Prefix N"
  const numbers = items
    .map(item => {
      const match = item.name.match(new RegExp(`^${prefix}\\s+(\\d+)$`, 'i'));
      return match ? parseInt(match[1], 10) : 0;
    })
    .filter(num => num > 0);

  // If no numbered items exist, start at 1
  if (numbers.length === 0) {
    return 1;
  }

  // Return the highest number + 1
  return Math.max(...numbers) + 1;
}

/**
 * Determine where to place a new item based on current selection
 * Folder selected: place inside. Page selected: place at same level. Nothing: place at root.
 */
export function getParentContextFromSelection(
  selectedItemId: string | null,
  pages: Page[],
  folders: PageFolder[]
): { parentFolderId: string | null; newDepth: number } {
  let parentFolderId: string | null = null;
  let newDepth = 0;

  if (selectedItemId) {
    // Check if selected item is a folder
    const selectedFolder = folders.find(f => f.id === selectedItemId);
    if (selectedFolder) {
      // Add inside the folder
      parentFolderId = selectedFolder.id;
      newDepth = selectedFolder.depth + 1;
    } else {
      // Selected item is a page - add at the same level
      const selectedPage = pages.find(p => p.id === selectedItemId);
      if (selectedPage) {
        parentFolderId = selectedPage.page_folder_id;
        newDepth = selectedPage.depth;
      }
    }
  }

  return { parentFolderId, newDepth };
}

/**
 * Calculate the next order value for a new item
 * If selectedItemId is provided and it's a page, insert right after it
 * Otherwise, use max order of siblings + 1 (append to end)
 */
export function calculateNextOrder(
  parentFolderId: string | null,
  depth: number,
  pages: Page[],
  folders: PageFolder[],
  selectedItemId?: string | null
): number {
  // If a page is selected, insert right after it
  if (selectedItemId) {
    const selectedPage = pages.find(p => p.id === selectedItemId);
    if (
      selectedPage &&
      selectedPage.page_folder_id === parentFolderId &&
      selectedPage.depth === depth &&
      selectedPage.deleted_at === null // Don't use deleted pages as reference
    ) {
      // Insert right after the selected page
      return (selectedPage.order || 0) + 1;
    }
  }

  // Append to end: find max order across pages and folders (exclude error pages and deleted items)
  const siblingPages = pages.filter(p =>
    p.page_folder_id === parentFolderId &&
    p.depth === depth &&
    p.error_page === null && // Exclude error pages
    p.deleted_at === null // Exclude deleted pages
  );
  const siblingFolders = folders.filter(f =>
    f.page_folder_id === parentFolderId &&
    f.depth === depth &&
    f.deleted_at === null // Exclude deleted folders
  );

  // Combine all siblings and find the max order across both pages and folders
  const allSiblings = [
    ...siblingPages.map(p => ({ order: p.order || 0 })),
    ...siblingFolders.map(f => ({ order: f.order || 0 })),
  ];

  if (allSiblings.length === 0) {
    return 0; // First item in empty folder
  }

  const maxOrder = Math.max(...allSiblings.map(s => s.order));
  return maxOrder + 1;
}

/**
 * Find the next item to select after deleting an item
 * Returns the next sibling (page or folder) at the same parent and depth
 */
export function findNextSelection(
  deletedId: string,
  deletedType: 'folder' | 'page',
  pages: Page[],
  folders: PageFolder[]
): string | null {
  // Get the deleted item's parent and depth
  const deletedItem = deletedType === 'folder'
    ? folders.find(f => f.id === deletedId)
    : pages.find(p => p.id === deletedId);

  if (!deletedItem) return null;

  const parentId = deletedItem.page_folder_id;
  const depth = deletedItem.depth;
  const order = deletedItem.order || 0;

  // Get all siblings (pages and folders) at same depth and parent
  // Filter out error pages - they should not be selected
  const siblingPages = pages.filter(p =>
    p.id !== deletedId &&
    p.page_folder_id === parentId &&
    p.depth === depth &&
    p.error_page === null // Exclude error pages
  );
  const siblingFolders = folders.filter(f =>
    f.id !== deletedId &&
    f.page_folder_id === parentId &&
    f.depth === depth
  );

  // Combine and sort by order
  const allSiblings = [
    ...siblingPages.map(p => ({ id: p.id, order: p.order || 0, type: 'page' as const })),
    ...siblingFolders.map(f => ({ id: f.id, order: f.order || 0, type: 'folder' as const }))
  ].sort((a, b) => a.order - b.order);

  if (allSiblings.length > 0) {
    // Try to find the next sibling (item with order greater than deleted item)
    const nextSibling = allSiblings.find(s => s.order > order);
    if (nextSibling) {
      return nextSibling.id;
    }

    // No next sibling, get the last sibling (previous)
    return allSiblings[allSiblings.length - 1].id;
  }

  // No siblings, select parent folder
  return parentId;
}

/**
 * Validation result type
 */
export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Validate page name
 * @returns Validation result with error message if invalid
 */
export function validatePageName(name: string): ValidationResult {
  if (!name.trim()) {
    return { isValid: false, error: 'Page name is required' };
  }
  return { isValid: true };
}

/**
 * Validate folder name
 * @returns Validation result with error message if invalid
 */
export function validateFolderName(name: string): ValidationResult {
  if (!name.trim()) {
    return { isValid: false, error: 'Folder name is required' };
  }
  return { isValid: true };
}

/**
 * Validate page slug based on page type
 * @param slug - The slug to validate
 * @param isIndex - Whether the page is an index page
 * @param isErrorPage - Whether the page is an error page
 * @returns Validation result with error message if invalid
 */
export function validatePageSlug(
  slug: string,
  isIndex: boolean,
  isErrorPage: boolean
): ValidationResult {
  // Error pages must have empty slug
  if (isErrorPage && slug.trim()) {
    return { isValid: false, error: 'Error pages must have an empty slug' };
  }

  // Index pages must have empty slug
  if (isIndex && slug.trim()) {
    return { isValid: false, error: 'Index pages must have an empty slug' };
  }

  // Non-index, non-error pages must have non-empty slug
  if (!isIndex && !isErrorPage && !slug.trim()) {
    return { isValid: false, error: 'Slug is required for non-index pages' };
  }

  return { isValid: true };
}

/**
 * Validate folder slug
 * @returns Validation result with error message if invalid
 */
export function validateFolderSlug(slug: string): ValidationResult {
  if (!slug.trim()) {
    return { isValid: false, error: 'Slug is required' };
  }
  return { isValid: true };
}

/**
 * Check for duplicate page slug in the same folder and published state
 * @param slug - The slug to check
 * @param pages - Array of all pages
 * @param folderId - The folder ID to check within
 * @param isPublished - The published state to check
 * @param excludePageId - Optional page ID to exclude from check (for editing)
 * @returns Validation result with error message if duplicate found
 */
export function checkDuplicatePageSlug(
  slug: string,
  pages: Page[],
  folderId: string | null,
  isPublished: boolean,
  excludePageId?: string
): ValidationResult {
  const trimmedSlug = slug.trim();

  // Check for reserved slugs at root level
  if (folderId === null && isReservedRootSlug(trimmedSlug)) {
    return {
      isValid: false,
      error: `Slug "${trimmedSlug}" cannot be used inside the root folder.`,
    };
  }

  const duplicateSlug = pages.find(
    (p) =>
      p.id !== excludePageId &&
      p.slug === trimmedSlug &&
      p.is_published === isPublished &&
      p.page_folder_id === folderId
  );

  if (duplicateSlug) {
    return {
      isValid: false,
      error: 'This slug is already used by another page in this folder',
    };
  }

  return { isValid: true };
}

/**
 * Check for duplicate folder slug in the same parent folder
 * @param slug - The slug to check
 * @param folders - Array of all folders
 * @param parentFolderId - The parent folder ID to check within
 * @param excludeFolderId - Optional folder ID to exclude from check (for editing)
 * @returns Validation result with error message if duplicate found
 */
export function checkDuplicateFolderSlug(
  slug: string,
  folders: PageFolder[],
  parentFolderId: string | null,
  excludeFolderId?: string
): ValidationResult {
  const trimmedSlug = slug.trim();

  // Check for reserved slugs at root level
  if (parentFolderId === null && isReservedRootSlug(trimmedSlug)) {
    return {
      isValid: false,
      error: `Slug "${trimmedSlug}" cannot be used inside the root folder.`,
    };
  }

  const duplicateSlug = folders.find(
    (f) =>
      f.id !== excludeFolderId &&
      f.slug === trimmedSlug &&
      f.page_folder_id === parentFolderId
  );

  if (duplicateSlug) {
    return {
      isValid: false,
      error: 'This slug is already used by another folder in the same location',
    };
  }

  return { isValid: true };
}

/**
 * Validate that root folder always has an index page
 * Checks if removing index status would leave root folder without an index page
 * @param currentPage - The current page being edited
 * @param newIsIndex - The new index status
 * @param pages - Array of all pages
 * @param newFolderId - The new folder ID the page will be in
 * @returns Validation result with error message if validation fails
 */
export function validateRootIndexPageRequirement(
  currentPage: Page | null,
  newIsIndex: boolean,
  pages: Page[],
  newFolderId: string | null
): ValidationResult {
  // Only validate if we're removing index status from a root page
  if (!currentPage?.is_index || newIsIndex) {
    return { isValid: true };
  }

  // If the page is moving to a different folder, root folder check still applies
  if (currentPage.page_folder_id === null || newFolderId === null) {
    // Check if there are other index pages in root folder
    const otherRootIndexPages = pages.filter(
      (p) =>
        p.id !== currentPage.id &&
        p.is_index &&
        p.page_folder_id === null
    );

    if (otherRootIndexPages.length === 0) {
      return {
        isValid: false,
        error: 'The root folder must have an index page. Please set another page as index first.',
      };
    }
  }

  return { isValid: true };
}

/**
 * Error page configuration
 */
export interface ErrorPageConfig {
  code: number;
  name: string;
  settings: PageSettings;
  layers: string;
}

/**
 * Default error pages configuration
 * Used for seeding database and creating new error pages.
 *
 * The 401 page ships with a password-protected form layer
 * (`settings.form.form_type === 'password_protected'`). At runtime,
 * `LayerRendererPublic` detects this marker and wires its submit handler to
 * `/api/page-auth/verify` instead of the standard form-submissions endpoint.
 * The form/input/button layers are marked `restrictions: { copy: false, delete: false }`
 * so the structure cannot be removed (only restyled). If the form is missing on
 * an existing 401 page, `PageRenderer` falls back to the hardcoded `PasswordForm`.
 */
export const DEFAULT_ERROR_PAGES: ErrorPageConfig[] = [
  {
    code: 401,
    name: '401 - Password required',
    settings: {
      seo: {
        title: 'Error 401 - Password required',
        description: 'This page is password protected. Please enter the password to continue.',
        image: null,
        noindex: true,
      },
    },
    layers: JSON.stringify([
      {
        id: 'body',
        name: 'body',
        classes: '',
        children: [
          {
            id: 'layer-1762789137823-g2cdo46ld',
            name: 'section',
            design: {
              layout: { display: 'Flex', isActive: true, flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
              sizing: { isActive: true, minHeight: '100vh' },
              spacing: { isActive: true, paddingTop: '4rem', paddingBottom: '4rem', paddingLeft: '1rem', paddingRight: '1rem' },
            },
            classes: 'flex flex-col items-center justify-center min-h-[100vh] px-[1rem] py-[4rem]',
            children: [
              {
                id: 'layer-1762789141753-zpz5jyobc',
                name: 'div',
                design: {
                  layout: { isActive: true, display: 'Flex', flexDirection: 'column', alignItems: 'center', gap: '16' },
                  sizing: { isActive: true, width: '100%', maxWidth: '32rem' },
                  typography: { isActive: true, textAlign: 'center' },
                },
                classes: 'w-full max-w-[32rem] flex flex-col items-center text-center gap-[16px]',
                children: [
                  {
                    id: 'layer-1762789150900-pw-icon',
                    name: 'icon',
                    settings: { tag: 'div' },
                    design: {
                      sizing: { isActive: true, width: '32', height: '32' },
                      typography: { isActive: true, color: '#9ca3af' },
                    },
                    classes: 'text-[#9ca3af] w-[32px] h-[32px]',
                    children: [],
                    customName: 'Lock icon',
                    variables: {
                      icon: {
                        src: {
                          type: 'static_text',
                          data: {
                            content: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
                          },
                        },
                      },
                    },
                  },
                  {
                    id: 'layer-1762789150930-pw-text-block',
                    name: 'div',
                    design: {
                      layout: { isActive: true, display: 'Flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'center' },
                      sizing: { isActive: true, width: '100%' },
                    },
                    classes: 'w-full flex flex-col items-center gap-[0.5rem]',
                    children: [
                      {
                        id: 'layer-1762789150944-5qezgblbe',
                        name: 'heading',
                        settings: { tag: 'h1' },
                        design: {
                          typography: { isActive: true, color: '#111827', fontSize: '30', fontWeight: '700' },
                        },
                        classes: 'font-[700] text-[#111827] text-[30px]',
                        children: [],
                        customName: 'Heading',
                        restrictions: { editText: true },
                        variables: {
                          text: {
                            type: 'dynamic_rich_text',
                            data: {
                              content: getTiptapTextContent('Password protected'),
                            },
                          },
                        },
                      },
                      {
                        id: 'layer-1762789197005-7z2wy597y',
                        name: 'text',
                        settings: { tag: 'p' },
                        design: {
                          typography: { isActive: true, fontSize: '12', color: '#111827' },
                        },
                        classes: 'text-[12px] text-[#111827]',
                        children: [],
                        customName: 'Subtitle',
                        restrictions: { editText: true },
                        variables: {
                          text: {
                            type: 'dynamic_rich_text',
                            data: {
                              content: getTiptapTextContent('To access this page, please enter the required password below.'),
                            },
                          },
                        },
                      },
                    ],
                    customName: 'Text block',
                  },
                  buildPasswordFormSubtree(),
                ],
                customName: 'Container',
              },
            ],
            customName: 'Section',
          },
        ],
      },
    ]),
  },
  {
    code: 404,
    name: '404 - Page not found',
    settings: {
      seo: {
        title: 'Error 404 - Page not found',
        description: 'The page you are looking for could not be found.',
        image: null,
        noindex: true,
      },
    },
    layers: JSON.stringify([
      {
        id: 'body',
        name: 'body',
        classes: '',
        children: [
          {
            id: 'layer-1762789137823-g2cdo46ld',
            name: 'section',
            design: {
              layout: { display: 'Flex', isActive: true, flexDirection: 'column' },
              sizing: { height: '100vh', isActive: true },
              spacing: { isActive: true, paddingTop: '3rem', paddingBottom: '3rem' },
            },
            classes: 'flex flex-col gap-[1rem] py-[3rem] h-[100vh]',
            children: [
              {
                id: 'layer-1762789141753-zpz5jyobc',
                name: 'div',
                design: {
                  sizing: { height: '100vh', isActive: true, maxWidth: '80rem' },
                  spacing: { isActive: true, marginLeft: 'auto', marginRight: 'auto', paddingLeft: '1rem', paddingRight: '1rem' },
                },
                classes: 'max-w-[80rem] mx-auto px-[1rem] h-[100vh]',
                children: [
                  {
                    id: 'layer-1762789168560-icft8ynp5',
                    name: 'div',
                    design: {
                      layout: { gap: '6', display: 'flex', isActive: true, alignItems: 'center', flexDirection: 'column', justifyContent: 'center' },
                      sizing: { height: '100%', isActive: true },
                      typography: { isActive: true, textAlign: 'center' },
                    },
                    classes: 'items-center text-center h-full flex flex-col justify-center gap-[6px]',
                    children: [
                      {
                        id: 'layer-1762789150944-5qezgblbe',
                        name: 'heading',
                        settings: {
                          tag: 'h1',
                        },
                        design: {
                          typography: { color: '#111827', fontSize: '30', isActive: true, fontWeight: '700' },
                        },
                        classes: 'font-[700] text-[#111827] text-[30px]',
                        children: [],
                        customName: 'Heading',
                        restrictions: { editText: true },
                        variables: {
                          text: {
                            type: 'dynamic_rich_text',
                            data: {
                              content: getTiptapTextContent('404')
                            }
                          }
                        },
                      },
                      {
                        id: 'layer-1762789197005-7z2wy597y',
                        name: 'text',
                        settings: {
                          tag: 'p',
                        },
                        design: {
                          typography: { fontSize: '12', color: '#111827', isActive: true },
                        },
                        classes: 'text-[12px] text-[#111827]',
                        children: [],
                        customName: 'Text',
                        restrictions: { editText: true },
                        variables: {
                          text: {
                            type: 'dynamic_rich_text',
                            data: {
                              content: getTiptapTextContent('Page not found')
                            }
                          }
                        },
                      },
                      {
                        id: 'layer-1762789197006-7z2wy597z',
                        name: 'text',
                        settings: {
                          tag: 'p',
                        },
                        design: {
                          typography: { fontSize: '12', color: '#111827', isActive: true },
                        },
                        classes: 'text-[12px] text-[#111827]',
                        children: [],
                        customName: 'Text',
                        restrictions: { editText: true },
                        variables: {
                          text: {
                            type: 'dynamic_rich_text',
                            data: {
                              content: getTiptapTextContent('The page you are looking for does not exist.')
                            }
                          }
                        },
                      },
                    ],
                    customName: 'Container',
                  },
                ],
                customName: 'Container',
              },
            ],
            customName: 'Section',
          },
        ],
      },
    ]),
  },
  {
    code: 500,
    name: '500 - Server error',
    settings: {
      seo: {
        title: 'Error 500 - Server error',
        description: 'An unexpected error occurred. Please try again later.',
        image: null,
        noindex: true,
      },
    },
    layers: JSON.stringify([
      {
        id: 'body',
        name: 'body',
        classes: '',
        children: [
          {
            id: 'layer-1762789137823-g2cdo46ld',
            name: 'section',
            design: {
              layout: { display: 'Flex', isActive: true, flexDirection: 'column' },
              sizing: { height: '100vh', isActive: true },
              spacing: { isActive: true, paddingTop: '3rem', paddingBottom: '3rem' },
            },
            classes: 'flex flex-col gap-[1rem] py-[3rem] h-[100vh]',
            children: [
              {
                id: 'layer-1762789141753-zpz5jyobc',
                name: 'div',
                design: {
                  sizing: { height: '100vh', isActive: true, maxWidth: '80rem' },
                  spacing: { isActive: true, marginLeft: 'auto', marginRight: 'auto', paddingLeft: '1rem', paddingRight: '1rem' },
                },
                classes: 'max-w-[80rem] mx-auto px-[1rem] h-[100vh]',
                children: [
                  {
                    id: 'layer-1762789168560-icft8ynp5',
                    name: 'div',
                    design: {
                      layout: { gap: '6', display: 'flex', isActive: true, alignItems: 'center', flexDirection: 'column', justifyContent: 'center' },
                      sizing: { height: '100%', isActive: true },
                      typography: { isActive: true, textAlign: 'center' },
                    },
                    classes: 'items-center text-center h-full flex flex-col justify-center gap-[6px]',
                    children: [
                      {
                        id: 'layer-1762789150944-5qezgblbe',
                        name: 'heading',
                        settings: {
                          tag: 'h1',
                        },
                        design: {
                          typography: { color: '#111827', fontSize: '30', isActive: true, fontWeight: '700' },
                        },
                        classes: 'font-[700] text-[#111827] text-[30px]',
                        children: [],
                        customName: 'Heading',
                        restrictions: { editText: true },
                        variables: {
                          text: {
                            type: 'dynamic_rich_text',
                            data: {
                              content: getTiptapTextContent('500')
                            }
                          }
                        },
                      },
                      {
                        id: 'layer-1762789197005-7z2wy597y',
                        name: 'text',
                        settings: {
                          tag: 'p',
                        },
                        design: {
                          typography: { fontSize: '12', color: '#111827', isActive: true },
                        },
                        classes: 'text-[12px] text-[#111827]',
                        children: [],
                        customName: 'Text',
                        restrictions: { editText: true },
                        variables: {
                          text: {
                            type: 'dynamic_rich_text',
                            data: {
                              content: getTiptapTextContent('Server error')
                            }
                          }
                        },
                      },
                      {
                        id: 'layer-1762789197006-7z2wy597z',
                        name: 'text',
                        settings: {
                          tag: 'p',
                        },
                        design: {
                          typography: { fontSize: '12', color: '#111827', isActive: true },
                        },
                        classes: 'text-[12px] text-[#111827]',
                        children: [],
                        customName: 'Text',
                        restrictions: { editText: true },
                        variables: {
                          text: {
                            type: 'dynamic_rich_text',
                            data: {
                              content: getTiptapTextContent('An unexpected error occurred. Please try again later.')
                            }
                          }
                        },
                      },
                    ],
                    customName: 'Container',
                  },
                ],
                customName: 'Container',
              },
            ],
            customName: 'Section',
          },
        ],
      },
    ]),
  },
];
