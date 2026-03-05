'use client';

import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useEditorStore } from '@/stores/useEditorStore';
import type { UIState, Layer } from '@/types';
import { DEFAULT_TEXT_STYLES, getTextStyleLabel } from '@/lib/text-format-utils';

interface UIStateSelectorProps {
  selectedLayer: Layer | null;
}

export default function UIStateSelector({ selectedLayer }: UIStateSelectorProps) {
  const { activeUIState, setActiveUIState, activeTextStyleKey, setActiveTextStyleKey } = useEditorStore();

  // Determine which states are applicable for the current layer
  const isDisabledApplicable = () => {
    if (!selectedLayer) return false;
    const applicableTypes = ['button', 'input', 'textarea', 'select'];
    return applicableTypes.includes(selectedLayer.name || '');
  };

  const isCurrentApplicable = () => {
    if (!selectedLayer) return false;
    const applicableTypes = ['link', 'a', 'navigation'];
    return applicableTypes.includes(selectedLayer.name || '');
  };

  const isTextLayer = selectedLayer?.name === 'text';

  // Filter out dynamic styles (dts-*) from the dropdown - they're not user-selectable
  const allTextStyles = { ...DEFAULT_TEXT_STYLES, ...selectedLayer?.textStyles };
  const selectableStyles = Object.entries(allTextStyles).filter(([key]) => !key.startsWith('dts-'));

  return (
    <div className="sticky -top-2 bg-background z-10 py-4 flex flex-row gap-2">
      {/* Text Style Selector - show for text layers with textStyles, placed first */}
      {isTextLayer && (
        <Select
          value={activeTextStyleKey || 'default'}
          onValueChange={(value) => setActiveTextStyleKey(value === 'default' ? null : value)}
        >
          <SelectTrigger className="w-1/2">
            <SelectValue placeholder="Select style" />
          </SelectTrigger>
          <SelectContent align="start">
            <SelectGroup>
              <SelectItem value="default">Default style</SelectItem>
            </SelectGroup>
            {selectableStyles.length > 0 && (
              <SelectGroup>
                {selectableStyles.map(([key, style]) => (
                  <SelectItem key={key} value={key}>
                    {getTextStyleLabel(key, style)}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
            {/* Hidden item for dynamic styles - allows SelectValue to display correctly */}
            {activeTextStyleKey && activeTextStyleKey.startsWith('dts-') && (
              <SelectItem value={activeTextStyleKey} className="hidden">
                Dynamic style
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      )}

      <Select value={activeUIState} onValueChange={(value) => setActiveUIState(value as UIState)}>
        <SelectTrigger className={isTextLayer ? 'w-1/2' : 'w-full'}>
          <SelectValue placeholder="Select state" />
        </SelectTrigger>
        <SelectContent align="end">
          <SelectGroup>
            <SelectItem value="neutral">Neutral</SelectItem>
            <SelectItem value="hover">Hover</SelectItem>
            <SelectItem value="focus">Focus</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="disabled" disabled={!isDisabledApplicable()}>
              Disabled
            </SelectItem>
            <SelectItem value="current" disabled={!isCurrentApplicable()}>
              Current
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
