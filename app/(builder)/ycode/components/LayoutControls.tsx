'use client';

import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Icon from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DesignPropertyLabel from './DesignPropertyLabel';
import IconTabs, { type IconOption } from './IconTabs';
import { useDesignSync } from '@/hooks/use-design-sync';
import { useControlledInputs } from '@/hooks/use-controlled-input';
import { useModeToggle } from '@/hooks/use-mode-toggle';
import { useEditorStore } from '@/stores/useEditorStore';
import { isLeafLayer } from '@/lib/layer-utils';
import { extractMeasurementValue } from '@/lib/measurement-utils';
import { removeSpaces } from '@/lib/utils';
import type { Layer } from '@/types';

interface LayoutControlsProps {
  layer: Layer | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
}

/** Display mode of the layer itself (maps to CSS `display`) */
type LayoutType = 'block' | 'inline-block' | 'inline' | 'flex' | 'grid' | 'hidden';
/** Flex main axis (maps to CSS `flex-direction`) */
type FlexDirection = 'horizontal' | 'vertical';

const LAYOUT_TYPE_OPTION: Record<LayoutType, IconOption<LayoutType>> = {
  'block': { value: 'block', icon: 'block', label: 'Block' },
  'inline-block': { value: 'inline-block', icon: 'inline-block', label: 'Inline block' },
  'inline': { value: 'inline', icon: 'inline', label: 'Inline' },
  'flex': { value: 'flex', icon: 'columns', label: 'Flex' },
  'grid': { value: 'grid', icon: 'grid', label: 'Grid' },
  'hidden': { value: 'hidden', icon: 'square-dashed', label: 'None' },
};

/** Elements that can hold children: full set */
const CONTAINER_LAYOUT_TYPES: LayoutType[] = ['block', 'flex', 'grid', 'hidden'];
/** Text elements: can flow inline with surrounding text */
const TEXT_LAYOUT_TYPES: LayoutType[] = ['block', 'inline-block', 'inline', 'hidden'];
/** Other leaf elements (icon, video, inputs…): no flex/grid, but can sit inline as a box */
const LEAF_LAYOUT_TYPES: LayoutType[] = ['block', 'inline-block', 'hidden'];
/** Replaced media (image, map): inline-block only adds baseline gaps, so block or none */
const MEDIA_LAYOUT_TYPES: LayoutType[] = ['block', 'hidden'];

const TEXT_LAYER_NAMES = new Set(['heading', 'text', 'span', 'label']);

function getLayoutTypes(layer: Layer | null): LayoutType[] {
  if (!layer || !isLeafLayer(layer)) return CONTAINER_LAYOUT_TYPES;
  if (layer.name === 'image' || layer.name === 'map' || layer.settings?.tag === 'img') return MEDIA_LAYOUT_TYPES;
  if (TEXT_LAYER_NAMES.has(layer.name ?? '')) return TEXT_LAYOUT_TYPES;
  return LEAF_LAYOUT_TYPES;
}

function getLayoutTypeOptions(layer: Layer | null): IconOption<LayoutType>[] {
  return getLayoutTypes(layer).map((type) => LAYOUT_TYPE_OPTION[type]);
}

const FLEX_DIRECTION_OPTIONS: IconOption<FlexDirection>[] = [
  { value: 'horizontal', icon: 'arrow-horizontal', label: 'Horizontal' },
  { value: 'vertical', icon: 'arrow-vertical', label: 'Vertical' },
];

const LayoutControls = memo(function LayoutControls({ layer, onLayerUpdate }: LayoutControlsProps) {
  const activeBreakpoint = useEditorStore((s) => s.activeBreakpoint);
  const activeUIState = useEditorStore((s) => s.activeUIState);
  const { updateDesignProperty, updateDesignProperties, debouncedUpdateDesignProperty, getDesignProperty } = useDesignSync({
    layer,
    onLayerUpdate,
    activeBreakpoint,
    activeUIState,
  });

  // Get current values from layer (with inheritance)
  const display = getDesignProperty('layout', 'display') || '';
  const flexDirection = getDesignProperty('layout', 'flexDirection') || 'row';
  const alignItems = getDesignProperty('layout', 'alignItems') || '';
  const justifyContent = getDesignProperty('layout', 'justifyContent') || 'start';
  const flexWrap = getDesignProperty('layout', 'flexWrap') || 'nowrap';
  const gap = getDesignProperty('layout', 'gap') || '';
  const columnGap = getDesignProperty('layout', 'columnGap') || '';
  const rowGap = getDesignProperty('layout', 'rowGap') || '';
  const gridCols = getDesignProperty('layout', 'gridTemplateColumns') || '';
  const gridRows = getDesignProperty('layout', 'gridTemplateRows') || '';

  // Extract number from grid template: "repeat(2, 1fr)" → "2"
  const extractGridNumber = (value: string): string => {
    if (!value) return '';
    // Match repeat(N, 1fr) pattern (with space or underscore)
    const match = value.match(/^repeat\((\d+),[\s_]*1fr\)$/);
    return match ? match[1] : '';
  };

  // Convert number to grid template: "2" → "repeat(2, 1fr)"
  const numberToGridTemplate = (value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    // Only accept numbers
    if (!/^\d+$/.test(trimmed)) return null;
    return `repeat(${trimmed}, 1fr)`;
  };

  // Local state for grid inputs (number only)
  const [gridColsInput, setGridColsInput] = useState(extractGridNumber(gridCols));
  const [gridRowsInput, setGridRowsInput] = useState(extractGridNumber(gridRows));

  // Sync local state when layer values change
  useEffect(() => {
    setGridColsInput(extractGridNumber(gridCols));
  }, [gridCols]);

  useEffect(() => {
    setGridRowsInput(extractGridNumber(gridRows));
  }, [gridRows]);

  // Local controlled inputs (prevents repopulation bug)
  const inputs = useControlledInputs({
    gap,
    columnGap,
    rowGap,
  }, extractMeasurementValue);

  const [gapInput, setGapInput] = inputs.gap;
  const [columnGapInput, setColumnGapInput] = inputs.columnGap;
  const [rowGapInput, setRowGapInput] = inputs.rowGap;

  // Use mode toggle hook for gap
  const gapModeToggle = useModeToggle({
    category: 'layout',
    unifiedProperty: 'gap',
    individualProperties: ['columnGap', 'rowGap'],
    modeProperty: 'gapMode', // Store the mode preference in layer JSON
    updateDesignProperty,
    updateDesignProperties,
    // Don't wrap in useCallback - let it recreate on every render to avoid stale closures
    getCurrentValue: (prop: string) => getDesignProperty('layout', prop) || '',
  });

  const layoutTypeOptions = useMemo(() => getLayoutTypeOptions(layer), [layer]);

  // Determine layout type from current values. Anything that is not flex,
  // grid, inline(-block) or hidden (including the unset default) behaves as block.
  const layoutType: LayoutType =
      display === 'hidden' ? 'hidden' :
        display === 'grid' || display === 'inline-grid' ? 'grid' :
          display === 'flex' || display === 'inline-flex' ? 'flex' :
            display === 'inline-block' || display === 'inline' ? display :
              'block';

  const isFlex = layoutType === 'flex';
  const isGrid = layoutType === 'grid';
  const isColumnAxis = isFlex && (flexDirection === 'column' || flexDirection === 'column-reverse');
  const isReverse = flexDirection === 'row-reverse' || flexDirection === 'column-reverse';
  const direction: FlexDirection = isColumnAxis ? 'vertical' : 'horizontal';

  const isWrap = flexWrap === 'wrap' || flexWrap === 'wrap-reverse';

  // Handle layout type change
  const handleLayoutTypeChange = (type: LayoutType) => {
    if (type === 'flex') {
      // Keep an existing direction; default to a horizontal row otherwise
      const hasDirection = ['row', 'row-reverse', 'column', 'column-reverse'].includes(flexDirection);
      updateDesignProperties([
        { category: 'layout', property: 'display', value: 'flex' },
        ...(hasDirection ? [] : [{ category: 'layout' as const, property: 'flexDirection', value: 'row' }]),
      ]);
      return;
    }

    // block / inline(-block) / grid / hidden: direction and wrap only apply to flex
    updateDesignProperties([
      { category: 'layout', property: 'display', value: type },
      { category: 'layout', property: 'flexDirection', value: null },
      { category: 'layout', property: 'flexWrap', value: null },
    ]);
  };

  // Handle flex direction change (keeps the current reverse state)
  const handleDirectionChange = (value: FlexDirection) => {
    const axis = value === 'vertical' ? 'column' : 'row';
    updateDesignProperty('layout', 'flexDirection', isReverse ? `${axis}-reverse` : axis);
  };

  // Toggle reverse on the current axis (row ↔ row-reverse, column ↔ column-reverse)
  const handleReverseToggle = () => {
    const axis = isColumnAxis ? 'column' : 'row';
    updateDesignProperty('layout', 'flexDirection', isReverse ? axis : `${axis}-reverse`);
  };

  // Handle align items change
  const handleAlignChange = (value: string) => {
    updateDesignProperty('layout', 'alignItems', value);
  };

  // Handle justify content change
  const handleJustifyChange = (value: string) => {
    updateDesignProperty('layout', 'justifyContent', value);
  };

  // Toggle wrapping. Off writes an explicit nowrap (not null) so a smaller
  // breakpoint can override a wrapping desktop value.
  const handleWrapToggle = () => {
    updateDesignProperty('layout', 'flexWrap', isWrap ? 'nowrap' : 'wrap');
  };

  // Handle gap changes (debounced for text input)
  const handleGapChange = (value: string) => {
    setGapInput(value);
    if (gapModeToggle.mode === 'all') {
      const sanitized = removeSpaces(value);
      debouncedUpdateDesignProperty('layout', 'gap', sanitized || null);
    }
  };

  const handleColumnGapChange = (value: string) => {
    setColumnGapInput(value);
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('layout', 'columnGap', sanitized || null);
  };

  const handleRowGapChange = (value: string) => {
    setRowGapInput(value);
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('layout', 'rowGap', sanitized || null);
  };

  // Handle grid columns change (number input only)
  const handleGridColsChange = (value: string) => {
    // Only allow numbers and empty string
    if (value !== '' && !/^\d+$/.test(value)) return;

    setGridColsInput(value);
    const converted = numberToGridTemplate(value);
    debouncedUpdateDesignProperty('layout', 'gridTemplateColumns', converted);
  };

  // Handle grid rows change (number input only)
  const handleGridRowsChange = (value: string) => {
    // Only allow numbers and empty string
    if (value !== '' && !/^\d+$/.test(value)) return;

    setGridRowsInput(value);
    const converted = numberToGridTemplate(value);
    debouncedUpdateDesignProperty('layout', 'gridTemplateRows', converted);
  };

  // Extract numeric value from design property
  return (
    <div className="py-5">
      <header className="py-4 -mt-4">
        <Label>Layout</Label>
      </header>

      <div className="flex flex-col gap-2">

          <div className="grid grid-cols-3">
              <DesignPropertyLabel properties={['display']} variant="muted">Type</DesignPropertyLabel>
              <div className="col-span-2">
                  <IconTabs
                    value={layoutType}
                    options={layoutTypeOptions}
                    onChange={handleLayoutTypeChange}
                  />
              </div>
          </div>

          {isFlex && (
              <div className="grid grid-cols-3">
                  <DesignPropertyLabel properties={['flexDirection', 'flexWrap']} variant="muted">Direction</DesignPropertyLabel>
                  <div className="col-span-2 flex items-center gap-2">
                      <div className="flex-1">
                          <IconTabs
                            value={direction}
                            options={FLEX_DIRECTION_OPTIONS}
                            onChange={handleDirectionChange}
                          />
                      </div>
                      <Tooltip>
                          <TooltipTrigger asChild>
                              <Button
                                variant={isReverse ? 'secondary' : 'ghost'}
                                size="sm"
                                aria-pressed={isReverse}
                                aria-label="Reverse direction"
                                onClick={handleReverseToggle}
                              >
                                  <Icon name="reverse-arrows" />
                              </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                              <p>Reverse</p>
                          </TooltipContent>
                      </Tooltip>
                      {/* Wrap lives here with direction and reverse: together they are `flex-flow` */}
                      <Tooltip>
                          <TooltipTrigger asChild>
                              <Button
                                variant={isWrap ? 'secondary' : 'ghost'}
                                size="sm"
                                aria-pressed={isWrap}
                                aria-label="Wrap items"
                                onClick={handleWrapToggle}
                              >
                                  <Icon name="wrap" />
                              </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                              <p>Wrap</p>
                          </TooltipContent>
                      </Tooltip>
                  </div>
              </div>
          )}

          {(isFlex || isGrid) && (
              <>
                  <div className="grid grid-cols-3">
                      <DesignPropertyLabel properties={['alignItems']} variant="muted">Align</DesignPropertyLabel>
                      <div className="col-span-2">
                          <Tabs
                            value={alignItems || 'start'}
                            onValueChange={handleAlignChange}
                            className="w-full"
                          >
                              <TabsList className="w-full">
                                  <TabsTrigger value="start">
                                      <Icon name="alignStart" className={isColumnAxis ? '-rotate-90' : ''} />
                                  </TabsTrigger>
                                  <TabsTrigger value="center">
                                      <Icon name="alignCenter" className={isColumnAxis ? '-rotate-90' : ''} />
                                  </TabsTrigger>
                                  <TabsTrigger value="end">
                                      <Icon name="alignEnd" className={isColumnAxis ? '-rotate-90' : ''} />
                                  </TabsTrigger>
                                  <TabsTrigger value="stretch">
                                      <Icon name="alignStretch" className={isColumnAxis ? '-rotate-90' : ''} />
                                  </TabsTrigger>
                              </TabsList>
                          </Tabs>
                      </div>
                  </div>

                  <div className="grid grid-cols-3">
                      <DesignPropertyLabel properties={['justifyContent']} variant="muted">Justify</DesignPropertyLabel>
                      <div className="col-span-2 *:w-full">
                          <Select value={justifyContent} onValueChange={handleJustifyChange}>
                              <SelectTrigger>
                                  <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                  <SelectGroup>
                                      <SelectItem value="start">Start</SelectItem>
                                      <SelectItem value="center">Center</SelectItem>
                                      <SelectItem value="end">End</SelectItem>
                                      <SelectItem value="between">Between</SelectItem>
                                      <SelectItem value="around">Around</SelectItem>
                                      <SelectItem value="evenly">Evenly</SelectItem>
                                  </SelectGroup>
                              </SelectContent>
                          </Select>
                      </div>
                  </div>
              </>
          )}

          {isGrid && (
              <div className="grid grid-cols-3">
                  <DesignPropertyLabel properties={['gridTemplateColumns', 'gridTemplateRows']} variant="muted">Grid</DesignPropertyLabel>
                  <div className="col-span-2 grid grid-cols-2 gap-2">
                      <InputGroup>
                          <InputGroupAddon>
                              <div className="flex">
                                  <Tooltip>
                                      <TooltipTrigger tabIndex={-1}>
                                          <Icon name="columns" className="size-3" />
                                      </TooltipTrigger>
                                      <TooltipContent>
                                          <p>Columns</p>
                                      </TooltipContent>
                                  </Tooltip>
                              </div>
                          </InputGroupAddon>
                          <InputGroupInput
                            stepper
                            min="1"
                            step="1"
                            value={gridColsInput}
                            onChange={(e) => handleGridColsChange(e.target.value)}
                          />
                      </InputGroup>
                      <InputGroup>
                          <InputGroupAddon>
                              <div className="flex">
                                  <Tooltip>
                                      <TooltipTrigger tabIndex={-1}>
                                          <Icon name="columns" className="size-3 rotate-90" />
                                      </TooltipTrigger>
                                      <TooltipContent>
                                          <p>Rows</p>
                                      </TooltipContent>
                                  </Tooltip>
                              </div>
                          </InputGroupAddon>
                          <InputGroupInput
                            stepper
                            min="1"
                            step="1"
                            value={gridRowsInput}
                            onChange={(e) => handleGridRowsChange(e.target.value)}
                          />
                      </InputGroup>
                  </div>
              </div>
          )}

          {(isFlex || isGrid) && (
              <div className="grid grid-cols-3">
                  <DesignPropertyLabel properties={['gap', 'columnGap', 'rowGap']} variant="muted">Gap</DesignPropertyLabel>
                  {/* Locked: one gap for both axes. Unlocked: the single input is
                      replaced by Columns / Rows inputs (Webflow-style padlock). */}
                  <div className="col-span-2 flex items-center gap-2">
                      {gapModeToggle.mode === 'individual' ? (
                        <div className="flex-1 grid grid-cols-2 gap-2">
                            {/* Compact X / Y prefixes, no stepper, minimal padding so three digits fit */}
                            <InputGroup>
                                <InputGroupAddon className="pl-1.5 text-[10px] opacity-50">X</InputGroupAddon>
                                <InputGroupInput
                                  min="0"
                                  step="1"
                                  aria-label="Column gap"
                                  className="px-1!"
                                  value={columnGapInput}
                                  onChange={(e) => handleColumnGapChange(e.target.value)}
                                />
                            </InputGroup>
                            <InputGroup>
                                <InputGroupAddon className="pl-1.5 text-[10px] opacity-50">Y</InputGroupAddon>
                                <InputGroupInput
                                  min="0"
                                  step="1"
                                  aria-label="Row gap"
                                  className="px-1!"
                                  value={rowGapInput}
                                  onChange={(e) => handleRowGapChange(e.target.value)}
                                />
                            </InputGroup>
                        </div>
                      ) : (
                        <InputGroup className="flex-1">
                            <InputGroupInput
                              stepper
                              min="0"
                              step="1"
                              value={gapInput}
                              onChange={(e) => handleGapChange(e.target.value)}
                            />
                        </InputGroup>
                      )}
                      <Tooltip>
                          <TooltipTrigger asChild>
                              <Button
                                variant={gapModeToggle.mode === 'individual' ? 'secondary' : 'ghost'}
                                size="sm"
                                aria-label={gapModeToggle.mode === 'individual' ? 'Link column and row gap' : 'Unlink column and row gap'}
                                onClick={gapModeToggle.handleToggle}
                              >
                                  <Icon name={gapModeToggle.mode === 'individual' ? 'unlock' : 'lock'} />
                              </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                              <p>{gapModeToggle.mode === 'individual' ? 'Link gaps' : 'Unlink gaps'}</p>
                          </TooltipContent>
                      </Tooltip>
                  </div>
              </div>
          )}
      </div>
    </div>
  );
});
export default LayoutControls;
