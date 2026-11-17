'use client';

import { memo, useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import Icon from '@/components/ui/icon';
import DesignPropertyLabel from './DesignPropertyLabel';
import SettingsPanel from './SettingsPanel';
import { useDesignSync } from '@/hooks/use-design-sync';
import { useControlledInputs } from '@/hooks/use-controlled-input';
import { useEditorStore } from '@/stores/useEditorStore';
import { extractMeasurementValue } from '@/lib/measurement-utils';
import { removeSpaces } from '@/lib/utils';
import type { Layer } from '@/types';

interface TransitionControlsProps {
  layer: Layer | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
}

const TransitionControls = memo(function TransitionControls({ layer, onLayerUpdate }: TransitionControlsProps) {
  const [isOpen, setIsOpen] = useState(true);
  const activeBreakpoint = useEditorStore((state) => state.activeBreakpoint);
  const activeUIState = useEditorStore((state) => state.activeUIState);
  const { updateDesignProperty, debouncedUpdateDesignProperty, getDesignProperty } = useDesignSync({
    layer,
    onLayerUpdate,
    activeBreakpoint,
    activeUIState,
  });

  const transitionProperty = getDesignProperty('transitions', 'transitionProperty') || '';
  const duration = getDesignProperty('transitions', 'duration') || '';
  const easing = getDesignProperty('transitions', 'easing') || '';
  const delay = getDesignProperty('transitions', 'delay') || '';

  // Track which optional rows are explicitly active so they stay visible when
  // the user temporarily clears their inputs. Reseeded whenever the layer or
  // active breakpoint/state changes.
  const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    const next = new Set<string>();
    if (easing) next.add('easing');
    if (delay) next.add('delay');
    setActiveKeys(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer?.id, activeBreakpoint, activeUIState]);

  const hasEasing = activeKeys.has('easing') || !!easing;
  const hasDelay = activeKeys.has('delay') || !!delay;

  const inputs = useControlledInputs({ duration, delay }, extractMeasurementValue);

  const createTimingHandler = useCallback(
    (property: string, setter: (v: string) => void) => (value: string) => {
      let sanitized = removeSpaces(value);
      if (sanitized.endsWith('s') && !sanitized.endsWith('ms')) {
        sanitized = String(parseFloat(sanitized) * 1000);
      }
      setter(sanitized);
      debouncedUpdateDesignProperty('transitions', property, sanitized || null);
    },
    [debouncedUpdateDesignProperty]
  );

  const handleDurationChange = createTimingHandler('duration', inputs.duration[1]);
  const handleDelayChange = createTimingHandler('delay', inputs.delay[1]);

  const handlePropertyChange = useCallback((value: string) => {
    updateDesignProperty('transitions', 'transitionProperty', value || null);
  }, [updateDesignProperty]);

  const handleEasingChange = useCallback((value: string) => {
    updateDesignProperty('transitions', 'easing', value || null);
  }, [updateDesignProperty]);

  const activate = useCallback((id: string) => {
    setActiveKeys(prev => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const deactivate = useCallback((id: string) => {
    setActiveKeys(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const handleAddEasing = useCallback(() => {
    activate('easing');
    updateDesignProperty('transitions', 'easing', 'linear');
  }, [activate, updateDesignProperty]);

  const handleAddDelay = useCallback(() => {
    activate('delay');
    inputs.delay[1]('0');
    updateDesignProperty('transitions', 'delay', '0');
  }, [activate, inputs.delay, updateDesignProperty]);

  const handleRemoveEasing = useCallback(() => {
    deactivate('easing');
    updateDesignProperty('transitions', 'easing', null);
  }, [deactivate, updateDesignProperty]);

  const handleRemoveDelay = useCallback(() => {
    deactivate('delay');
    inputs.delay[1]('');
    updateDesignProperty('transitions', 'delay', null);
  }, [deactivate, inputs.delay, updateDesignProperty]);

  const renderRemoveButton = (id: string, onRemove: () => void) => (
    <button
      type="button"
      aria-label={`Remove ${id}`}
      className="p-0.5 rounded-sm opacity-70 hover:opacity-100 transition-opacity cursor-pointer shrink-0"
      onClick={onRemove}
    >
      <Icon name="x" className="size-2.5" />
    </button>
  );

  return (
    <SettingsPanel
      title="Transition"
      isOpen={isOpen}
      onToggle={() => setIsOpen(!isOpen)}
      action={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="xs">
              <Icon name="plus" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleAddEasing} disabled={hasEasing}>
              Easing
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleAddDelay} disabled={hasDelay}>
              Delay
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      {/* Transition Property */}
      <div className="grid grid-cols-3">
        <DesignPropertyLabel properties={['transitionProperty']} variant="muted">Property</DesignPropertyLabel>
        <div className="col-span-2 *:w-full">
          <Select
            value={transitionProperty}
            onValueChange={handlePropertyChange}
          >
            <SelectTrigger>
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="default">Default</SelectItem>
                <SelectItem value="colors">Colors</SelectItem>
                <SelectItem value="opacity">Opacity</SelectItem>
                <SelectItem value="shadow">Shadow</SelectItem>
                <SelectItem value="transform">Transform</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Duration */}
      <div className="grid grid-cols-3">
        <DesignPropertyLabel properties={['duration']} variant="muted">Duration</DesignPropertyLabel>
        <div className="col-span-2">
          <InputGroup>
            <InputGroupInput
              value={inputs.duration[0]}
              onChange={(e) => handleDurationChange(e.target.value)}
              placeholder="150"
            />
            <InputGroupAddon align="inline-end" className="text-xs opacity-50">ms</InputGroupAddon>
          </InputGroup>
        </div>
      </div>

      {/* Easing */}
      {hasEasing && (
        <div className="grid grid-cols-3">
          <DesignPropertyLabel properties={['easing']} variant="muted">Easing</DesignPropertyLabel>
          <div className="col-span-2 flex items-center gap-2">
            <div className="flex-1 min-w-0 *:w-full">
              <Select
                value={easing}
                onValueChange={handleEasingChange}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="linear">Linear</SelectItem>
                    <SelectItem value="in">Ease In</SelectItem>
                    <SelectItem value="out">Ease Out</SelectItem>
                    <SelectItem value="in-out">Ease In Out</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            {renderRemoveButton('easing', handleRemoveEasing)}
          </div>
        </div>
      )}

      {/* Delay */}
      {hasDelay && (
        <div className="grid grid-cols-3">
          <DesignPropertyLabel properties={['delay']} variant="muted">Delay</DesignPropertyLabel>
          <div className="col-span-2 flex items-center gap-2">
            <InputGroup className="flex-1 min-w-0">
              <InputGroupInput
                value={inputs.delay[0]}
                onChange={(e) => handleDelayChange(e.target.value)}
                placeholder="0"
              />
              <InputGroupAddon align="inline-end">ms</InputGroupAddon>
            </InputGroup>
            {renderRemoveButton('delay', handleRemoveDelay)}
          </div>
        </div>
      )}
    </SettingsPanel>
  );
});

export default TransitionControls;
