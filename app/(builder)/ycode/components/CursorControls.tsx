'use client';

import { memo, useCallback, useMemo } from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DesignPropertyLabel from './DesignPropertyLabel';
import { useDesignSync } from '@/hooks/use-design-sync';
import { useEditorStore } from '@/stores/useEditorStore';
import type { Layer } from '@/types';

interface CursorControlsProps {
  layer: Layer | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
}

const CURSOR_OPTIONS = [
  { value: 'auto', label: 'Auto', className: 'cursor-auto' },
  { value: 'default', label: 'Default', className: 'cursor-default' },
  { value: 'pointer', label: 'Pointer', className: 'cursor-pointer' },
  { value: 'text', label: 'Text', className: 'cursor-text' },
  { value: 'grab', label: 'Grab', className: 'cursor-grab' },
  { value: 'wait', label: 'Wait', className: 'cursor-wait' },
  { value: 'not-allowed', label: 'Not allowed', className: 'cursor-not-allowed' },
] as const;

function formatCursorLabel(value: string): string {
  return value
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const CursorControls = memo(function CursorControls({ layer, onLayerUpdate }: CursorControlsProps) {
  const activeBreakpoint = useEditorStore((s) => s.activeBreakpoint);
  const activeUIState = useEditorStore((s) => s.activeUIState);
  const { updateDesignProperty, getDesignProperty } = useDesignSync({
    layer,
    onLayerUpdate,
    activeBreakpoint,
    activeUIState,
  });

  const cursor = getDesignProperty('effects', 'cursor') || 'auto';

  const options = useMemo(() => {
    if (CURSOR_OPTIONS.some((option) => option.value === cursor)) {
      return CURSOR_OPTIONS;
    }

    return [
      ...CURSOR_OPTIONS,
      {
        value: cursor,
        label: formatCursorLabel(cursor),
        className: `cursor-${cursor}`,
      },
    ];
  }, [cursor]);

  const handleCursorChange = useCallback((value: string) => {
    updateDesignProperty('effects', 'cursor', value);
  }, [updateDesignProperty]);

  return (
    <div className="py-5">
      <header className="py-4 -mt-4">
        <Label>Cursor</Label>
      </header>

      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-3">
          <DesignPropertyLabel properties={['cursor']} variant="muted">Style</DesignPropertyLabel>
          <div className="col-span-2 *:w-full">
            <Select
              value={cursor}
              onValueChange={handleCursorChange}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {options.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      className={option.className}
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
});

export default CursorControls;
