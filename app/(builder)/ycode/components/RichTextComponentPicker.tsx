'use client';

/**
 * Right-side sheet panel for selecting a component to insert into rich-text.
 * Mirrors the sidebar pattern from the legacy project.
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { Empty, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { useComponentsStore } from '@/stores/useComponentsStore';
import { useEditorStore } from '@/stores/useEditorStore';
import { useSessionStorageSet } from '@/hooks/use-session-storage-set';
import { isCircularComponentReference, checkCircularReference } from '@/lib/component-utils';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import ComponentCard from './ComponentCard';
import ComponentFolderList, { COLLAPSED_COMPONENT_FOLDERS_KEY } from './ComponentFolderList';

import type { Layer } from '@/types';

interface RichTextComponentPickerProps {
  onSelect: (componentId: string) => void;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function RichTextComponentPicker({
  onSelect,
  disabled = false,
  open,
  onOpenChange,
}: RichTextComponentPickerProps) {
  const components = useComponentsStore(state => state.components);
  const editingComponentId = useEditorStore(state => state.editingComponentId);
  const [search, setSearch] = useState('');
  const [collapsedFolders, toggleFolder] = useSessionStorageSet(COLLAPSED_COMPONENT_FOLDERS_KEY);

  const circularIds = useMemo(() => {
    if (!editingComponentId) return new Set<string>();
    return new Set(
      components
        .filter(c => isCircularComponentReference(editingComponentId, c.id, components))
        .map(c => c.id)
    );
  }, [components, editingComponentId]);

  const matchingIds = useMemo(() => {
    if (!search.trim()) return null;
    const query = search.toLowerCase();
    return new Set(
      components.filter(c => c.name.toLowerCase().includes(query)).map(c => c.id)
    );
  }, [components, search]);

  const hasResults = !matchingIds || matchingIds.size > 0;

  const handleSelect = useCallback((componentId: string) => {
    if (circularIds.has(componentId)) {
      const fakeLayer = { id: '_check', name: 'div', componentId } as Layer;
      const description = editingComponentId
        ? checkCircularReference(editingComponentId, fakeLayer, components)
        : null;
      toast.error('Infinite component loop detected', {
        description: description ?? undefined,
      });
      return;
    }

    onOpenChange(false);
    setSearch('');
    requestAnimationFrame(() => {
      onSelect(componentId);
    });
  }, [circularIds, editingComponentId, components, onOpenChange, onSelect]);

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) setSearch('');
        onOpenChange(v);
      }}
    >
      <SheetContent
        side="right"
        className="w-64 max-w-64 p-4"
        aria-describedby={undefined}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <VisuallyHidden>
          <SheetTitle>Insert Component</SheetTitle>
        </VisuallyHidden>

        <div className="flex items-center border-b border-border -mx-4 -mt-4 px-4 h-14 shrink-0 bg-background sticky -top-4 z-10">
          <div className="relative flex-1">
            <Icon name="search" className="absolute left-3.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search components..."
              className="h-8 text-xs pl-9"
              autoFocus
            />
          </div>
        </div>

        {!hasResults && (
          <Empty>
            <EmptyMedia variant="icon">
              <Icon name="component" className="size-4" />
            </EmptyMedia>
            <EmptyTitle>
              {search.trim() ? 'No matching components' : 'No components available'}
            </EmptyTitle>
          </Empty>
        )}
        <ComponentFolderList
          components={components}
          matchingIds={matchingIds}
          collapsedFolders={collapsedFolders}
          onToggleFolder={toggleFolder}
          // Folder headers bring their own top padding; cancel the sheet's gap-4
          className={cn('-mt-4', !hasResults && 'hidden')}
          renderComponent={(component) => (
            <ComponentCard
              key={component.id}
              component={component}
              onClick={() => handleSelect(component.id)}
              disabled={disabled}
              className={cn(
                circularIds.has(component.id) && 'opacity-40',
                matchingIds && !matchingIds.has(component.id) && 'hidden',
              )}
            />
          )}
        />
      </SheetContent>
    </Sheet>
  );
}
