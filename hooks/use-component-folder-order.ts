'use client';

/**
 * Custom component folder order, stored as a builder-only setting.
 */

import { useCallback, useMemo } from 'react';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { settingsApi } from '@/lib/api';
import {
  COMPONENT_FOLDER_ORDER_SETTING,
  groupComponentsByFolder,
  parseComponentFolderOrder,
} from '@/lib/component-folder-utils';
import type { ComponentFolderGroup } from '@/lib/component-folder-utils';
import type { Component } from '@/types';

/** Returns the stored folder order and an optimistic saver (rolls back on failure). */
export function useComponentFolderOrder() {
  const storedOrder = useSettingsStore((s) => s.settingsByKey[COMPONENT_FOLDER_ORDER_SETTING]);
  const folderOrder = useMemo(() => parseComponentFolderOrder(storedOrder), [storedOrder]);

  const saveFolderOrder = useCallback(async (order: string[]) => {
    const { settingsByKey, updateSetting } = useSettingsStore.getState();
    const previous = settingsByKey[COMPONENT_FOLDER_ORDER_SETTING] ?? null;

    updateSetting(COMPONENT_FOLDER_ORDER_SETTING, order);
    try {
      const response = await settingsApi.batchUpdate({ [COMPONENT_FOLDER_ORDER_SETTING]: order });
      if (response.error) throw new Error(response.error);
    } catch (error) {
      updateSetting(COMPONENT_FOLDER_ORDER_SETTING, previous);
      throw error;
    }
  }, []);

  return { folderOrder, saveFolderOrder };
}

/** Components grouped by folder in the custom folder order. */
export function useComponentFolderGroups(components: Component[]): ComponentFolderGroup[] {
  const { folderOrder } = useComponentFolderOrder();
  return useMemo(() => groupComponentsByFolder(components, folderOrder), [components, folderOrder]);
}
