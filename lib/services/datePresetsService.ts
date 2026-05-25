import { getSettingByKey, setSetting } from '@/lib/repositories/settingsRepository';
import { getPublishedLayersByIds } from '@/lib/repositories/pageLayersRepository';
import { getAllComponents } from '@/lib/repositories/componentRepository';
import { pageHasDatePresets } from '@/lib/date-presets-detector';
import type { Component } from '@/types';

/** Setting key storing the list of published page IDs whose render depends on a date preset. */
export const PAGES_WITH_DATE_PRESETS_SETTING = 'pages_with_date_presets';

/**
 * Returns the currently stored list of page IDs flagged as time-dependent.
 * Tolerates an unset or malformed value by returning an empty array.
 */
export async function getTimeDependentPageIds(): Promise<string[]> {
  const value = await getSettingByKey(PAGES_WITH_DATE_PRESETS_SETTING);
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

/**
 * Incrementally update the stored list of time-dependent page IDs after a publish.
 * Re-scans only the pages that changed (directly or indirectly) and toggles their
 * membership based on whether their published layers still reference a date preset.
 * Pages outside `affectedPageIds` keep their existing flag — they weren't republished.
 */
export async function recomputeTimeDependentPageIds(
  affectedPageIds: string[],
): Promise<{ added: string[]; removed: string[]; total: number }> {
  if (affectedPageIds.length === 0) {
    const existing = await getTimeDependentPageIds();
    return { added: [], removed: [], total: existing.length };
  }

  // Load published layers for the affected pages and all components in one shot.
  // Components are loaded in full because a preset can live in any variant tree
  // that a layer references via componentId.
  const [layersByPage, components] = await Promise.all([
    getPublishedLayersByIds(affectedPageIds),
    getAllComponents(true),
  ]);

  const componentsById = new Map<string, Component>();
  for (const component of components) componentsById.set(component.id, component);

  const existing = new Set(await getTimeDependentPageIds());
  const added: string[] = [];
  const removed: string[] = [];

  for (const pageId of affectedPageIds) {
    const layers = layersByPage.find(l => l.page_id === pageId)?.layers ?? [];
    const isTimeDependent = pageHasDatePresets(layers, componentsById);

    if (isTimeDependent && !existing.has(pageId)) {
      existing.add(pageId);
      added.push(pageId);
    } else if (!isTimeDependent && existing.has(pageId)) {
      existing.delete(pageId);
      removed.push(pageId);
    }
  }

  if (added.length > 0 || removed.length > 0) {
    await setSetting(PAGES_WITH_DATE_PRESETS_SETTING, [...existing]);
  }

  return { added, removed, total: existing.size };
}
