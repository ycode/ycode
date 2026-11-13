/**
 * Component Folder Utilities
 *
 * Components can be grouped into single-level folders in the builder.
 * Components without a folder live in a virtual default folder.
 */

import type { Component } from '@/types';

/** Name of the virtual folder holding components without a folder */
export const DEFAULT_COMPONENT_FOLDER = 'Components';

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
 * Group components by folder: the default folder first, then named folders
 * alphabetically. Component order within a folder is preserved. The default
 * folder is omitted when it is empty and named folders exist.
 */
export function groupComponentsByFolder(components: Component[]): ComponentFolderGroup[] {
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

  if (unfiled.length === 0 && named.length > 0) return named;

  return [{ folder: null, label: DEFAULT_COMPONENT_FOLDER, components: unfiled }, ...named];
}
