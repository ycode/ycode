'use client';

/**
 * Components grouped by folder under collapsible headers.
 * While searching, only folders with matches are shown, expanded.
 */

import React from 'react';
import LibraryFolderHeader from './LibraryFolderHeader';
import { getComponentFolderKey } from '@/lib/component-folder-utils';
import { cn } from '@/lib/utils';
import type { ComponentFolderGroup } from '@/lib/component-folder-utils';
import type { Component } from '@/types';

/** sessionStorage key for collapsed component folders, shared by every component list */
export const COLLAPSED_COMPONENT_FOLDERS_KEY = 'elementLibrary-collapsedComponentFolders';

interface ComponentFolderListProps {
  /** Folder groups in display order (see groupComponentsByFolder) */
  groups: ComponentFolderGroup[];
  /** Ids matching the current search, or null when not searching */
  matchingIds: Set<string> | null;
  /** Collapsed folder keys (see getComponentFolderKey) */
  collapsedFolders: Set<string>;
  onToggleFolder: (folderKey: string) => void;
  renderComponent: (component: Component) => React.ReactNode;
  /** Optional header actions per folder */
  renderFolderActions?: (group: ComponentFolderGroup) => React.ReactNode;
  className?: string;
}

export default function ComponentFolderList({
  groups,
  matchingIds,
  collapsedFolders,
  onToggleFolder,
  renderComponent,
  renderFolderActions,
  className,
}: ComponentFolderListProps) {
  return (
    <div className={cn('flex flex-col divide-y', className)}>
      {groups.map((group) => {
        const folderKey = getComponentFolderKey(group.folder);
        const visibleCount = matchingIds
          ? group.components.filter(c => matchingIds.has(c.id)).length
          : group.components.length;
        const isCollapsed = !matchingIds && collapsedFolders.has(folderKey);

        return (
          <div key={folderKey} className={cn('flex flex-col', visibleCount === 0 && 'hidden')}>
            <LibraryFolderHeader
              label={group.label}
              isCollapsed={isCollapsed}
              onToggle={() => onToggleFolder(folderKey)}
              count={visibleCount}
              actions={renderFolderActions?.(group)}
            />
            <div className={cn('grid grid-cols-1 gap-1.5 pb-5', isCollapsed && 'hidden')}>
              {group.components.map(renderComponent)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
