/**
 * Component Folder Utilities
 *
 * Components can be grouped into single-level folders in the builder.
 * Components without a folder live in a virtual default folder.
 */

import type { Component } from '@/types';

/** Name of the virtual folder holding components without a folder */
export const DEFAULT_COMPONENT_FOLDER = 'Components';

/** Setting key holding the custom folder order (array of folder keys) */
export const COMPONENT_FOLDER_ORDER_SETTING = 'component_folder_order';

export type ComponentFolderMove = 'top' | 'up' | 'down' | 'bottom';

export interface ComponentFolderGroup {
  /** Stored folder name, or null for the default folder */
  folder: string | null;
  /** Display label */
  label: string;
  components: Component[];
}

/**
 * Normalize a folder name for storage: trims it and maps empty values or the
 * default folder name to null.
 */
export function normalizeComponentFolder(folder: string | null | undefined): string | null {
  const trimmed = folder?.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === DEFAULT_COMPONENT_FOLDER.toLowerCase()) return null;
  return trimmed;
}

/** Key identifying a folder in order and collapse state (the default folder uses its label). */
export function getComponentFolderKey(folder: string | null): string {
  return folder ?? DEFAULT_COMPONENT_FOLDER;
}

/** Read a stored folder order setting, ignoring invalid values. */
export function parseComponentFolderOrder(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((key): key is string => typeof key === 'string');
}

/** Sorted, unique folder names in use (excludes the default folder). */
export function getComponentFolderNames(components: Component[]): string[] {
  const names = new Set<string>();
  for (const component of components) {
    const folder = normalizeComponentFolder(component.folder);
    if (folder) names.add(folder);
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

/**
 * Group components by folder, ordered by `folderOrder`. Folders missing from it
 * follow: the default folder first, then named folders alphabetically.
 * Component order within a folder is preserved. The default folder is omitted
 * when it is empty and named folders exist.
 */
export function groupComponentsByFolder(
  components: Component[],
  folderOrder: string[] = []
): ComponentFolderGroup[] {
  const byFolder = new Map<string, Component[]>();
  const unfiled: Component[] = [];

  for (const component of components) {
    const folder = normalizeComponentFolder(component.folder);
    if (!folder) {
      unfiled.push(component);
      continue;
    }
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), component]);
  }

  const named = getComponentFolderNames(components).map((folder) => ({
    folder,
    label: folder,
    components: byFolder.get(folder) ?? [],
  }));

  const groups = unfiled.length === 0 && named.length > 0
    ? named
    : [{ folder: null, label: DEFAULT_COMPONENT_FOLDER, components: unfiled }, ...named];

  if (folderOrder.length === 0) return groups;

  const rank = (group: ComponentFolderGroup) => {
    const index = folderOrder.indexOf(getComponentFolderKey(group.folder));
    if (index !== -1) return index;
    return group.folder === null ? -1 : folderOrder.length;
  };

  return [...groups].sort((a, b) => rank(a) - rank(b));
}

/**
 * Move a folder within the displayed folder keys and return the order to store.
 * A hidden default folder keeps its stored position so it reappears there.
 */
export function moveComponentFolder(
  folderKeys: string[],
  key: string,
  move: ComponentFolderMove,
  storedOrder: string[] = []
): string[] {
  const index = folderKeys.indexOf(key);
  if (index === -1) return folderKeys;

  const targets: Record<ComponentFolderMove, number> = {
    top: 0,
    up: Math.max(index - 1, 0),
    down: Math.min(index + 1, folderKeys.length - 1),
    bottom: folderKeys.length - 1,
  };

  const next = folderKeys.filter((k) => k !== key);
  next.splice(targets[move], 0, key);

  const hiddenDefaultIndex = storedOrder.indexOf(DEFAULT_COMPONENT_FOLDER);
  if (hiddenDefaultIndex !== -1 && !next.includes(DEFAULT_COMPONENT_FOLDER)) {
    next.splice(Math.min(hiddenDefaultIndex, next.length), 0, DEFAULT_COMPONENT_FOLDER);
  }

  return next;
}

/**
 * Update a stored folder order after renaming `from` to `to` (null removes the
 * folder into the default one). Merging into a listed folder keeps its position.
 */
export function renameComponentFolderInOrder(
  order: string[],
  from: string,
  to: string | null
): string[] {
  const toKey = getComponentFolderKey(normalizeComponentFolder(to));
  if (from === toKey || !order.includes(from)) return order;
  if (order.includes(toKey)) return order.filter((key) => key !== from);
  return order.map((key) => (key === from ? toKey : key));
}
