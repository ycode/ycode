'use client';

/** Collapsible folder header used in the element library (layouts, components). */

import React from 'react';
import Icon from '@/components/ui/icon';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface LibraryFolderHeaderProps {
  label: string;
  isCollapsed: boolean;
  onToggle: () => void;
  /** Number of items in the folder, shown muted on the right */
  count?: number;
  /** Optional actions rendered on the right (e.g. dropdown menu) */
  actions?: React.ReactNode;
}

export default function LibraryFolderHeader({
  label,
  isCollapsed,
  onToggle,
  count,
  actions,
}: LibraryFolderHeaderProps) {
  return (
    <header className="group relative py-5 flex items-center">
      <button
        type="button"
        className="flex flex-1 min-w-0 items-center gap-2 cursor-pointer hover:opacity-70 transition-opacity"
        onClick={onToggle}
        aria-expanded={!isCollapsed}
      >
        <Icon
          name="triangle-down"
          className={cn(
            'size-3 opacity-25 transition-transform',
            isCollapsed && '-rotate-90'
          )}
        />
        <Label className="cursor-pointer truncate">{label}</Label>
        {count !== undefined && (
          <span
            className={cn(
              'ml-auto shrink-0 text-xs text-muted-foreground tabular-nums',
              actions && 'group-hover:invisible'
            )}
          >
            {count}
          </span>
        )}
      </button>
      {/* Overlays the count so counts stay aligned whether or not a row has actions */}
      {actions && (
        <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center">
          {actions}
        </div>
      )}
    </header>
  );
}
