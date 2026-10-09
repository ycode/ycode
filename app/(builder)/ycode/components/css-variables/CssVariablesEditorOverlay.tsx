'use client';

/**
 * CssVariablesEditorOverlay
 *
 * In-builder editor for the CSS Variables system. Opens as a full-screen
 * overlay on top of the design canvas (preview-mode style) so the design
 * context is never unmounted and value edits reflect live in the canvas
 * iframe via `useCssVariablesStore.generateStylesheet()`.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Empty, EmptyDescription, EmptyTitle } from '@/components/ui/empty';
import Icon from '@/components/ui/icon';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { useEditorStore } from '@/stores/useEditorStore';
import { useCssVariablesStore } from '@/stores/useCssVariablesStore';
import CssVariableSetEditor from './CssVariableSetEditor';
import CssVariableSetSettingsDialog from './CssVariableSetSettingsDialog';
import CssVariableSortableList, { CssVariableDragHandle } from './CssVariableSortableList';
import type { CssVariableSet } from '@/types';

export default function CssVariablesEditorOverlay() {
  const open = useEditorStore((s) => s.cssVariablesEditorOpen);
  const close = useEditorStore((s) => s.closeCssVariablesEditor);

  const sets = useCssVariablesStore((s) => s.graph.sets);
  const error = useCssVariablesStore(s => s.error);
  const isLoading = useCssVariablesStore((s) => s.isLoading);
  const loadGraph = useCssVariablesStore((s) => s.loadGraph);
  const createSet = useCssVariablesStore((s) => s.createSet);
  const deleteSet = useCssVariablesStore((s) => s.deleteSet);
  const reorderSets = useCssVariablesStore((s) => s.reorderSets);

  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  const [editingSetId, setEditingSetId] = useState<string | null>(null);
  const [deletingSetId, setDeletingSetId] = useState<string | null>(null);

  // Fetch graph the first time the overlay opens
  useEffect(() => {
    if (!open) return;
    void loadGraph();
  }, [open, loadGraph]);

  // Auto-select first set when none is selected
  const sortedSets = useMemo(
    () => sets.slice().sort((a, b) => a.sort_order - b.sort_order),
    [sets]
  );

  useEffect(() => {
    if (!open) return;
    if (!selectedSetId && sortedSets.length > 0) {
      setSelectedSetId(sortedSets[0].id);
    } else if (selectedSetId && !sortedSets.some((s) => s.id === selectedSetId)) {
      setSelectedSetId(sortedSets[0]?.id ?? null);
    }
    if (editingSetId && !sortedSets.some((s) => s.id === editingSetId)) {
      setEditingSetId(null);
    }
    if (deletingSetId && !sortedSets.some((s) => s.id === deletingSetId)) {
      setDeletingSetId(null);
    }
  }, [open, selectedSetId, editingSetId, deletingSetId, sortedSets]);

  // ESC closes the overlay
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

  const selectedSet = sortedSets.find((s) => s.id === selectedSetId) ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-10"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="flex flex-col w-full h-full bg-background border rounded-lg shadow-2xl overflow-hidden">
        <header className="flex items-center justify-between gap-3 px-4 h-12 border-b">
        <div className="flex items-center gap-2">
          <Icon name="swatch" className="size-3.5 text-muted-foreground" />
          <h2 className="text-sm font-medium">Variables</h2>
        </div>
        <Button
          size="sm" variant="ghost"
          onClick={close} title="Close (Esc)"
        >
          <Icon name="x" />
          Close
        </Button>
      </header>

      {error && <div role="alert" className="px-4 py-2 text-sm text-destructive">{error}</div>}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <aside className="w-64 shrink-0 border-r flex flex-col overflow-hidden px-4">
          <header className="py-5 flex items-center justify-between shrink-0">
            <span className="font-medium">Collections</span>
            <Button
              size="xs"
              variant="secondary"
              title="New collection"
              onClick={async () => {
                const created = await createSet({ name: 'New collection', activation_kind: 'default' });
                if (created) setSelectedSetId(created.id);
              }}
            >
              <Icon name="plus" />
            </Button>
          </header>
          <div className="flex-1 overflow-y-auto no-scrollbar">
            {isLoading && sortedSets.length === 0 ? (
              <div className="flex items-center justify-center p-4"><Spinner /></div>
            ) : sortedSets.length === 0 ? (
              <Empty>
                <EmptyTitle>Collections</EmptyTitle>
                <EmptyDescription>No variable collections yet. Click + to create one.</EmptyDescription>
              </Empty>
            ) : (
              <div className="flex flex-col">
                <CssVariableSortableList items={sortedSets} onReorder={reorderSets}>
                  {(set) => (
                    <SetSidebarItem
                      key={set.id}
                      set={set}
                      isActive={selectedSetId === set.id}
                      onSelect={() => setSelectedSetId(set.id)}
                      onEdit={() => {
                        setSelectedSetId(set.id);
                        setEditingSetId(set.id);
                      }}
                      onDelete={() => setDeletingSetId(set.id)}
                    />
                  )}
                </CssVariableSortableList>
              </div>
            )}
          </div>
        </aside>

        <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {selectedSet ? (
            <CssVariableSetEditor set={selectedSet} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              Select a variable collection to start editing.
            </div>
          )}
        </main>
        </div>
      </div>

      {editingSetId &&
        (() => {
          const editingSet = sortedSets.find((s) => s.id === editingSetId);
          if (!editingSet) return null;
          return (
            <CssVariableSetSettingsDialog
              set={editingSet}
              open={true}
              onOpenChange={(o) => {
                if (!o) setEditingSetId(null);
              }}
            />
          );
        })()}

      {deletingSetId &&
        (() => {
          const deletingSet = sortedSets.find((s) => s.id === deletingSetId);
          if (!deletingSet) return null;
          return (
            <ConfirmDialog
              open={true}
              onOpenChange={(o) => {
                if (!o) setDeletingSetId(null);
              }}
              title="Delete set"
              description={`Delete the set "${deletingSet.name}" and all its variables?`}
              confirmLabel="Delete"
              confirmVariant="destructive"
              onConfirm={async () => {
                await deleteSet(deletingSet.id);
              }}
            />
          );
        })()}
    </div>
  );
}

interface SetSidebarItemProps {
  set: CssVariableSet;
  isActive: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function SetSidebarItem({
  set,
  isActive,
  onSelect,
  onEdit,
  onDelete,
}: SetSidebarItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      onClick={onSelect}
      className={cn(
        'px-3 h-8 rounded-lg flex gap-2 items-center justify-between text-left w-full group cursor-pointer',
        isActive
          ? 'bg-primary text-primary-foreground'
          : 'hover:bg-secondary/50 text-secondary-foreground/80 dark:text-muted-foreground'
      )}
    >
      <div className="flex gap-2 items-center min-w-0">
        <CssVariableDragHandle label={`collection ${set.name}`} />
        <Icon name="swatch" className="size-3 shrink-0" />
        <span className="truncate">{set.name}</span>
      </div>

      <div className={cn('group-hover:opacity-100', menuOpen ? 'opacity-100' : 'opacity-0')}>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              size="xs"
              variant={isActive ? 'default' : 'ghost'}
              title="Set options"
              onClick={(e) => e.stopPropagation()}
              className="-mr-2"
            >
              <Icon name="more" className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Icon name="pencil" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDelete}>
              <Icon name="trash" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
