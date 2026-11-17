'use client';

import { memo, useState, useCallback, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
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

interface TransformControlsProps {
  layer: Layer | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
}

const ORIGIN_OPTIONS = [
  { value: 'top-left', label: 'Top Left' },
  { value: 'top', label: 'Top' },
  { value: 'top-right', label: 'Top Right' },
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
  { value: 'bottom-left', label: 'Bottom Left' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'bottom-right', label: 'Bottom Right' },
] as const;

const XY_FIELDS = [
  { id: 'move', label: 'Move', keys: ['translateX', 'translateY'] },
  { id: 'skew', label: 'Skew', keys: ['skewX', 'skewY'] },
] as const;

const TransformControls = memo(function TransformControls({ layer, onLayerUpdate }: TransformControlsProps) {
  const [isOpen, setIsOpen] = useState(true);
  const activeBreakpoint = useEditorStore((state) => state.activeBreakpoint);
  const activeUIState = useEditorStore((state) => state.activeUIState);
  const { updateDesignProperty, debouncedUpdateDesignProperty, getDesignProperty } = useDesignSync({
    layer,
    onLayerUpdate,
    activeBreakpoint,
    activeUIState,
  });

  const scale = getDesignProperty('transforms', 'scale') || '';
  const rotate = getDesignProperty('transforms', 'rotate') || '';
  const translateX = getDesignProperty('transforms', 'translateX') || '';
  const translateY = getDesignProperty('transforms', 'translateY') || '';
  const skewX = getDesignProperty('transforms', 'skewX') || '';
  const skewY = getDesignProperty('transforms', 'skewY') || '';
  const transformOrigin = getDesignProperty('transforms', 'transformOrigin') || '';

  // Track which transform sections are explicitly active so a row stays
  // visible when the user temporarily clears its inputs. The set is reseeded
  // from existing stored values whenever the layer/breakpoint/state changes.
  const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    const next = new Set<string>();
    if (scale) next.add('scale');
    if (rotate) next.add('rotate');
    if (translateX !== '' || translateY !== '') next.add('move');
    if (skewX || skewY) next.add('skew');
    setActiveKeys(next);
    // Only reseed when the layer or active breakpoint/state changes — not on
    // every value edit, otherwise clearing an input would reactivate the row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer?.id, activeBreakpoint, activeUIState]);

  const visibility: Record<string, boolean> = {
    scale: activeKeys.has('scale') || !!scale,
    rotate: activeKeys.has('rotate') || !!rotate,
    move: activeKeys.has('move') || translateX !== '' || translateY !== '',
    skew: activeKeys.has('skew') || !!skewX || !!skewY,
  };

  const inputs = useControlledInputs({
    scale, rotate, translateX, translateY, skewX, skewY,
  }, extractMeasurementValue);

  const createHandler = useCallback(
    (property: string, setter: (v: string) => void) => (value: string) => {
      setter(value);
      const sanitized = removeSpaces(value);
      debouncedUpdateDesignProperty('transforms', property, sanitized || null);
    },
    [debouncedUpdateDesignProperty]
  );

  const handlers: Record<string, (v: string) => void> = {
    scale: createHandler('scale', inputs.scale[1]),
    rotate: createHandler('rotate', inputs.rotate[1]),
    translateX: createHandler('translateX', inputs.translateX[1]),
    translateY: createHandler('translateY', inputs.translateY[1]),
    skewX: createHandler('skewX', inputs.skewX[1]),
    skewY: createHandler('skewY', inputs.skewY[1]),
  };

  const handleScaleSliderChange = useCallback((values: number[]) => {
    const value = (values[0] / 100).toFixed(2);
    inputs.scale[1](value);
    updateDesignProperty('transforms', 'scale', value);
  }, [inputs.scale, updateDesignProperty]);

  const handleOriginChange = useCallback((value: string) => {
    updateDesignProperty('transforms', 'transformOrigin', value === 'center' ? null : value);
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

  const addHandlers: Record<string, () => void> = {
    scale: () => { activate('scale'); inputs.scale[1]('1'); updateDesignProperty('transforms', 'scale', '1'); },
    rotate: () => { activate('rotate'); inputs.rotate[1]('0'); updateDesignProperty('transforms', 'rotate', '0'); },
    move: () => {
      activate('move');
      inputs.translateX[1]('0'); inputs.translateY[1]('0');
      updateDesignProperty('transforms', 'translateX', '0');
      updateDesignProperty('transforms', 'translateY', '0');
    },
    skew: () => {
      activate('skew');
      inputs.skewX[1]('0'); inputs.skewY[1]('0');
      updateDesignProperty('transforms', 'skewX', '0');
      updateDesignProperty('transforms', 'skewY', '0');
    },
  };

  const removeHandlers: Record<string, () => void> = {
    scale: () => { deactivate('scale'); inputs.scale[1](''); updateDesignProperty('transforms', 'scale', null); },
    rotate: () => { deactivate('rotate'); inputs.rotate[1](''); updateDesignProperty('transforms', 'rotate', null); },
    move: () => {
      deactivate('move');
      inputs.translateX[1](''); inputs.translateY[1]('');
      updateDesignProperty('transforms', 'translateX', null);
      updateDesignProperty('transforms', 'translateY', null);
    },
    skew: () => {
      deactivate('skew');
      inputs.skewX[1](''); inputs.skewY[1]('');
      updateDesignProperty('transforms', 'skewX', null);
      updateDesignProperty('transforms', 'skewY', null);
    },
  };

  const renderRemoveButton = (id: string) => (
    <button
      type="button"
      aria-label={`Remove ${id}`}
      className="p-0.5 rounded-sm opacity-70 hover:opacity-100 transition-opacity cursor-pointer shrink-0"
      onClick={removeHandlers[id]}
    >
      <Icon name="x" className="size-2.5" />
    </button>
  );

  const scaleSliderValue = parseFloat(inputs.scale[0]) || 1;

  return (
    <SettingsPanel
      title="Transform"
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
            {['scale', 'rotate', 'move', 'skew'].map((id) => (
              <DropdownMenuItem
                key={id}
                onClick={addHandlers[id]}
                disabled={visibility[id]}
              >
                {id.charAt(0).toUpperCase() + id.slice(1)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      {/* Origin */}
      <div className="grid grid-cols-3">
        <DesignPropertyLabel properties={['transformOrigin']} variant="muted">Origin</DesignPropertyLabel>
        <div className="col-span-2 *:w-full">
          <Select value={transformOrigin || 'center'} onValueChange={handleOriginChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {ORIGIN_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Scale */}
      {visibility.scale && (
        <div className="grid grid-cols-3">
          <DesignPropertyLabel properties={['scale']} variant="muted">Scale</DesignPropertyLabel>
          <div className="col-span-2 flex items-center gap-2">
            <div className="grid grid-cols-2 items-center gap-2 flex-1 min-w-0">
              <Input
                type="text"
                value={inputs.scale[0]}
                onChange={(e) => handlers.scale(e.target.value)}
                placeholder="1"
              />
              <Slider
                value={[Math.round(scaleSliderValue * 100)]}
                onValueChange={handleScaleSliderChange}
                min={0}
                max={200}
                step={5}
                className="flex-1"
              />
            </div>
            {renderRemoveButton('scale')}
          </div>
        </div>
      )}

      {/* Rotate */}
      {visibility.rotate && (
        <div className="grid grid-cols-3">
          <DesignPropertyLabel properties={['rotate']} variant="muted">Rotate</DesignPropertyLabel>
          <div className="col-span-2 flex items-center gap-2">
            <InputGroup className="flex-1 min-w-0">
              <InputGroupInput
                value={inputs.rotate[0]}
                onChange={(e) => handlers.rotate(e.target.value)}
                placeholder="0"
              />
              <InputGroupAddon align="inline-end" className="text-xs opacity-50">deg</InputGroupAddon>
            </InputGroup>
            {renderRemoveButton('rotate')}
          </div>
        </div>
      )}

      {/* Move & Skew */}
      {XY_FIELDS.map((field) => {
        if (!visibility[field.id]) return null;
        return (
          <div key={field.id} className="grid grid-cols-3 items-start">
            <DesignPropertyLabel
              properties={field.keys}
              variant="muted" className="h-8"
            >
              {field.label} X/Y
            </DesignPropertyLabel>
            <div className="col-span-2 flex items-start gap-2">
              <div className="grid grid-cols-2 gap-2 flex-1 min-w-0">
                {field.keys.map((key) => (
                  <Input
                    key={key}
                    value={inputs[key as keyof typeof inputs][0]}
                    onChange={(e) => handlers[key](e.target.value)}
                    placeholder="0"
                  />
                ))}
              </div>
              <div className="h-8 flex items-center">
                {renderRemoveButton(field.id)}
              </div>
            </div>
          </div>
        );
      })}
    </SettingsPanel>
  );
});

export default TransformControls;
