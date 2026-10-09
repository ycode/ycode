'use client';

import React, { createContext, useContext, useId, useRef, useState } from 'react';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import Icon from '@/components/ui/icon';
import { cn } from '@/lib/utils';

const DragHandleContext = createContext<ReturnType<typeof useSortable> | null>(null);

/** Keep dragging on a handle so name/value inputs and menus stay interactive. */
export function CssVariableDragHandle({ label }: { label: string }) {
  const sortable = useContext(DragHandleContext);
  if (!sortable) return null;
  return (
    <button
      type="button"
      ref={sortable.setActivatorNodeRef}
      {...sortable.attributes}
      {...sortable.listeners}
      disabled={sortable.attributes['aria-disabled']}
      aria-disabled={sortable.attributes['aria-disabled'] || undefined}
      aria-label={`Reorder ${label}`}
      title={`Drag to reorder ${label}`}
      onClick={event => event.stopPropagation()}
      className="shrink-0 size-4 flex items-center justify-center touch-none cursor-grab active:cursor-grabbing text-muted-foreground focus-visible:outline focus-visible:outline-2 rounded disabled:cursor-default disabled:opacity-30"
    >
      <Icon name="grip-vertical" className="size-3" />
    </button>
  );
}

function SortableItem({ id, disabled, children }: { id: string; disabled: boolean; children: React.ReactNode }) {
  const sortable = useSortable({ id, disabled });
  return (
    <DragHandleContext.Provider value={sortable}>
      <div
        ref={sortable.setNodeRef}
        style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}
        className={cn('relative', sortable.isDragging && 'z-10 opacity-60')}
      >
        {children}
      </div>
    </DragHandleContext.Provider>
  );
}

export default function CssVariableSortableList<T extends { id: string }>({
  items,
  onReorder,
  children,
}: {
  items: T[];
  onReorder: (orderedIds: string[]) => Promise<void>;
  children: (item: T) => React.ReactNode;
}) {
  const id = useId();
  const saving = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    if (saving.current || !over || active.id === over.id) return;
    const from = items.findIndex(item => item.id === active.id);
    const to = items.findIndex(item => item.id === over.id);
    if (from < 0 || to < 0) return;
    saving.current = true;
    setIsSaving(true);
    try {
      await onReorder(arrayMove(items, from, to).map(item => item.id));
    } finally {
      saving.current = false;
      setIsSaving(false);
    }
  };
  return (
    <DndContext
      id={id} sensors={sensors}
      collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={items.map(item => item.id)} strategy={verticalListSortingStrategy}>
        {items.map(item => (
          <SortableItem
            key={item.id} id={item.id}
            disabled={isSaving || items.length < 2}
          >
            {children(item)}
          </SortableItem>
        ))}
      </SortableContext>
    </DndContext>
  );
}
