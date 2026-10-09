'use client';

import React, { useState, useEffect, memo } from 'react';
import { Label } from '@/components/ui/label';
import { formatShadowLength, parseShadowLength } from '@/lib/text-shadow-utils';
import CssVariableInput from './css-variables/CssVariableInput';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Icon from '@/components/ui/icon';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { useDesignSync } from '@/hooks/use-design-sync';
import { useEditorStore } from '@/stores/useEditorStore';
import { removeSpaces } from '@/lib/utils';
import type { Layer } from '@/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import ColorPicker from './ColorPicker';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';

interface EffectControlsProps {
  layer: Layer | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
  activeTextStyleKey?: string | null;
}

const EffectControls = memo(function EffectControls({ layer, onLayerUpdate, activeTextStyleKey }: EffectControlsProps) {
  const activeBreakpoint = useEditorStore((s) => s.activeBreakpoint);
  const activeUIState = useEditorStore((s) => s.activeUIState);
  const showTextStyleControls = useEditorStore((state) => state.showTextStyleControls());
  const { updateDesignProperty, debouncedUpdateDesignProperty, getDesignProperty } = useDesignSync({
    layer,
    onLayerUpdate,
    activeBreakpoint,
    activeUIState,
    activeTextStyleKey,
  });

  // Get current values from layer (no inheritance - only exact breakpoint values)
  const opacity = getDesignProperty('effects', 'opacity') || '100';
  const boxShadow = getDesignProperty('effects', 'boxShadow') || '';
  const blur = getDesignProperty('effects', 'blur') || '';
  const backdropBlur = getDesignProperty('effects', 'backdropBlur') || '';

  // Shadow interface
  interface Shadow {
    id: string;
    position: 'outside' | 'inside';
    color: string;
    x: number | string;
    y: number | string;
    blur: number | string;
    spread: number | string;
  }

  // Parse existing shadows from boxShadow property
  const parseExistingShadows = (shadowString: string): Shadow[] => {
    if (!shadowString) return [];

    try {
      // Split by comma followed by underscore (our separator for multiple shadows)
      const shadowStrings = shadowString.split(',_');

      return shadowStrings.map((shadowStr, index) => {
        const isInset = shadowStr.startsWith('inset_');
        const cleanShadow = isInset ? shadowStr.replace('inset_', '') : shadowStr;

        // Parse: 0px_9px_4px_0px_rgba(0,0,0,0.25)
        // Match pattern: number+unit, number+unit, number+unit, number+unit, color
        const parts = cleanShadow.split('_');

        if (parts.length >= 5) {
          const x = parseShadowLength(parts[0]);
          const y = parseShadowLength(parts[1]);
          const blur = parseShadowLength(parts[2]);
          const spread = parseShadowLength(parts[3]);
          // Color is everything after the 4th underscore
          let color = parts.slice(4).join('_');
          if (color.startsWith('var(--')) {
            color = `color:${color}`;
          }

          return {
            id: `shadow-${Date.now()}-${index}`,
            position: isInset ? 'inside' : 'outside',
            color,
            x,
            y,
            blur,
            spread,
          };
        }

        // Fallback for invalid format
        return {
          id: `shadow-${Date.now()}-${index}`,
          position: 'outside',
          color: 'rgba(0,0,0,0.25)',
          x: 0,
          y: 9,
          blur: 4,
          spread: 0,
        };
      });
    } catch (error) {
      console.error('Error parsing shadows:', error);
      return [];
    }
  };

  const [shadows, setShadows] = useState<Shadow[]>([]);
  const [editingShadowId, setEditingShadowId] = useState<string | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);

  // Sync shadows when layer changes (not when boxShadow updates during editing)
  useEffect(() => {
    const currentBoxShadow = getDesignProperty('effects', 'boxShadow') || '';

    if (currentBoxShadow) {
      // Parse and load existing shadows
      const parsed = parseExistingShadows(currentBoxShadow);
      setShadows(parsed);
    } else {
      // Clear shadows when no boxShadow
      setShadows([]);
    }
    // Reset editing state when layer changes
    setEditingShadowId(null);
    setPopoverOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer?.id, activeBreakpoint, activeUIState]);

  // Extract numeric value (0-100)
  const extractOpacity = (prop: string): number => {
    if (!prop) return 100;
    const match = prop.match(/(\d+)/);
    return match ? parseInt(match[1]) : 100;
  };

  const opacityValue = extractOpacity(opacity);

  // Local input state allows empty field while editing
  const [opacityInput, setOpacityInput] = useState(String(opacityValue));
  const [isOpacityFocused, setIsOpacityFocused] = useState(false);

  useEffect(() => {
    if (!isOpacityFocused) {
      setOpacityInput(String(opacityValue));
    }
  }, [opacityValue, isOpacityFocused]);

  const handleOpacityChange = (value: string) => {
    setOpacityInput(value);
    const parsed = parseInt(value);
    if (!isNaN(parsed)) {
      const numValue = Math.max(0, Math.min(100, parsed));
      debouncedUpdateDesignProperty('effects', 'opacity', `${numValue}`);
    }
  };

  const handleOpacityBlur = () => {
    setIsOpacityFocused(false);
    if (opacityInput.trim() === '' || isNaN(parseInt(opacityInput))) {
      updateDesignProperty('effects', 'opacity', null);
      setOpacityInput('100');
    }
  };

  // Handle opacity slider change (immediate - slider interaction)
  const handleOpacitySliderChange = (values: number[]) => {
    updateDesignProperty('effects', 'opacity', `${values[0]}`);
  };

  // Extract blur value (in pixels)
  const extractBlur = (prop: string): number => {
    if (!prop) return 0;
    const match = prop.match(/(\d+)/);
    return match ? parseInt(match[1]) : 0;
  };

  const blurValue = extractBlur(blur);

  const [blurInput, setBlurInput] = useState(String(blurValue));
  const [isBlurFocused, setIsBlurFocused] = useState(false);

  useEffect(() => {
    if (!isBlurFocused) {
      setBlurInput(String(blurValue));
    }
  }, [blurValue, isBlurFocused]);

  const handleBlurChange = (value: string) => {
    setBlurInput(value);
    const parsed = parseInt(value);
    if (!isNaN(parsed)) {
      const numValue = Math.max(0, parsed);
      debouncedUpdateDesignProperty('effects', 'blur', `${numValue}px`);
    }
  };

  const handleBlurInputBlur = () => {
    setIsBlurFocused(false);
    if (blurInput.trim() === '' || isNaN(parseInt(blurInput))) {
      updateDesignProperty('effects', 'blur', null);
      setBlurInput('0');
    }
  };

  // Handle blur slider change (immediate - slider interaction)
  const handleBlurSliderChange = (values: number[]) => {
    updateDesignProperty('effects', 'blur', `${values[0]}px`);
  };

  // Add blur effect
  const handleAddBlur = () => {
    updateDesignProperty('effects', 'blur', '5px');
  };

  // Remove blur effect
  const handleRemoveBlur = () => {
    updateDesignProperty('effects', 'blur', null);
  };

  // Extract backdrop blur value (in pixels)
  const extractBackdropBlur = (prop: string): number => {
    if (!prop) return 0;
    const match = prop.match(/(\d+)/);
    return match ? parseInt(match[1]) : 0;
  };

  const backdropBlurValue = extractBackdropBlur(backdropBlur);

  const [backdropBlurInput, setBackdropBlurInput] = useState(String(backdropBlurValue));
  const [isBackdropBlurFocused, setIsBackdropBlurFocused] = useState(false);

  useEffect(() => {
    if (!isBackdropBlurFocused) {
      setBackdropBlurInput(String(backdropBlurValue));
    }
  }, [backdropBlurValue, isBackdropBlurFocused]);

  const handleBackdropBlurChange = (value: string) => {
    setBackdropBlurInput(value);
    const parsed = parseInt(value);
    if (!isNaN(parsed)) {
      const numValue = Math.max(0, parsed);
      debouncedUpdateDesignProperty('effects', 'backdropBlur', `${numValue}px`);
    }
  };

  const handleBackdropBlurInputBlur = () => {
    setIsBackdropBlurFocused(false);
    if (backdropBlurInput.trim() === '' || isNaN(parseInt(backdropBlurInput))) {
      updateDesignProperty('effects', 'backdropBlur', null);
      setBackdropBlurInput('0');
    }
  };

  // Handle backdrop blur slider change (immediate - slider interaction)
  const handleBackdropBlurSliderChange = (values: number[]) => {
    updateDesignProperty('effects', 'backdropBlur', `${values[0]}px`);
  };

  // Add backdrop blur effect
  const handleAddBackdropBlur = () => {
    updateDesignProperty('effects', 'backdropBlur', '5px');
  };

  // Remove backdrop blur effect
  const handleRemoveBackdropBlur = () => {
    updateDesignProperty('effects', 'backdropBlur', null);
  };

  // Handle box shadow change (debounced for text input)
  const handleBoxShadowChange = (value: string) => {
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('effects', 'boxShadow', sanitized || null);
  };

  // Generate shadow CSS value from shadow object
  const generateShadowString = (shadow: Shadow): string => {
    const inset = shadow.position === 'inside' ? 'inset_' : '';
    const color = shadow.color.startsWith('color:var(')
      ? shadow.color.replace('color:', '')
      : shadow.color;
    return `${inset}${formatShadowLength(shadow.x)}_${formatShadowLength(shadow.y)}_${formatShadowLength(shadow.blur)}_${formatShadowLength(shadow.spread)}_${color}`;
  };

  // Generate full shadows value for all shadows
  const generateFullShadowValue = (shadowsList: Shadow[]): string => {
    return shadowsList.map(generateShadowString).join(',_');
  };

  // Get currently editing shadow
  const editingShadow = shadows.find(s => s.id === editingShadowId);

  // Convert any color format to rgba
  const convertToRgba = (color: string): string => {
    if (color.startsWith('rgba')) return color;
    if (color.startsWith('rgb')) {
      return color.replace('rgb(', 'rgba(').replace(')', ',1)');
    }

    let r: number, g: number, b: number, a = 1;

    // Handle #hex/opacity format from ColorPicker (e.g. #000000/50)
    const hexOpacityMatch = color.match(/^#([0-9a-fA-F]{6})\/(\d+)$/);
    if (hexOpacityMatch) {
      r = parseInt(hexOpacityMatch[1].substring(0, 2), 16);
      g = parseInt(hexOpacityMatch[1].substring(2, 4), 16);
      b = parseInt(hexOpacityMatch[1].substring(4, 6), 16);
      a = parseInt(hexOpacityMatch[2]) / 100;
      return `rgba(${r},${g},${b},${a})`;
    }

    const hex = color.replace('#', '');

    if (hex.length === 8) {
      r = parseInt(hex.substring(0, 2), 16);
      g = parseInt(hex.substring(2, 4), 16);
      b = parseInt(hex.substring(4, 6), 16);
      a = parseInt(hex.substring(6, 8), 16) / 255;
    } else if (hex.length === 6) {
      r = parseInt(hex.substring(0, 2), 16);
      g = parseInt(hex.substring(2, 4), 16);
      b = parseInt(hex.substring(4, 6), 16);
    } else if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else {
      return 'rgba(0,0,0,1)';
    }

    return `rgba(${r},${g},${b},${a})`;
  };

  // Open popover and create new shadow OR edit existing
  const handleOpenPopover = (open: boolean) => {
    if (open && !editingShadowId) {
      // Create new shadow with defaults
      const newShadow: Shadow = {
        id: Date.now().toString(),
        position: 'outside',
        color: 'rgba(0,0,0,0.25)',
        x: 0,
        y: 9,
        blur: 4,
        spread: 0,
      };

      const updatedShadows = [...shadows, newShadow];
      setShadows(updatedShadows);
      setEditingShadowId(newShadow.id);

      // Apply immediately
      const shadowValue = generateFullShadowValue(updatedShadows);
      updateDesignProperty('effects', 'boxShadow', shadowValue);
    } else if (!open) {
      // Close popover
      setEditingShadowId(null);
    }
    setPopoverOpen(open);
  };

  // Open popover to edit existing shadow
  const handleEditShadow = (shadowId: string) => {
    setEditingShadowId(shadowId);
    setPopoverOpen(true);
  };

  // Update shadow property in real-time
  const updateEditingShadow = (updates: Partial<Shadow>) => {
    if (!editingShadowId) return;

    const updatedShadows = shadows.map(s =>
      s.id === editingShadowId ? { ...s, ...updates } : s
    );
    setShadows(updatedShadows);

    // Apply immediately
    const shadowValue = generateFullShadowValue(updatedShadows);
    updateDesignProperty('effects', 'boxShadow', shadowValue);
  };

  // Remove shadow
  const handleRemoveShadow = (shadowId: string) => {
    const updatedShadows = shadows.filter(s => s.id !== shadowId);
    setShadows(updatedShadows);

    if (updatedShadows.length === 0) {
      updateDesignProperty('effects', 'boxShadow', null);
    } else {
      const shadowValue = generateFullShadowValue(updatedShadows);
      updateDesignProperty('effects', 'boxShadow', shadowValue);
    }
  };

  // Shadow value change handlers (update in real-time)
  const handleShadowPositionChange = (value: 'outside' | 'inside') => {
    updateEditingShadow({ position: value });
  };

  const handleShadowColorChange = (value: string) => {
    if (value.startsWith('color:var(')) {
      updateEditingShadow({ color: value });
    } else {
      updateEditingShadow({ color: convertToRgba(value) });
    }
  };

  const handleShadowXChange = (value: number | string) => {
    updateEditingShadow({ x: value });
  };

  const handleShadowYChange = (value: number | string) => {
    updateEditingShadow({ y: value });
  };

  const handleShadowBlurChange = (value: number | string) => {
    updateEditingShadow({ blur: value });
  };

  const handleShadowSpreadChange = (value: number | string) => {
    updateEditingShadow({ spread: value });
  };

  // Get display name for shadow
  const getShadowDisplayName = (shadow: Shadow): string => {
    const pos = shadow.position === 'inside' ? 'Inner' : 'Outer';
    return `${pos} ${formatShadowLength(shadow.x)} ${formatShadowLength(shadow.y)} ${formatShadowLength(shadow.blur)}`;
  };

  return (
    <div className="py-5">

      <header className="py-4 -mt-4 flex items-center justify-between">
        <Label>Effects</Label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="xs">
              <Icon name="plus" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Filters</DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={handleAddBlur}>Blur</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Backdrop</DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={handleAddBackdropBlur}>Blur</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="flex flex-col gap-2">

          <div className="grid grid-cols-3">
              <Label variant="muted">Opacity</Label>
              <div className="col-span-2 grid grid-cols-2 items-center gap-2">
                  <InputGroup>
                      <InputGroupInput
                        value={opacityInput}
                        onChange={(e) => handleOpacityChange(e.target.value)}
                        onFocus={() => setIsOpacityFocused(true)}
                        onBlur={handleOpacityBlur}
                        min="0"
                        max="100"
                        step="1"
                      />
                      <InputGroupAddon align="inline-end">
                          <Label variant="muted" className="text-xs">%</Label>
                      </InputGroupAddon>
                  </InputGroup>
                  <Slider
                    className="flex-1"
                    value={[opacityValue]}
                    onValueChange={handleOpacitySliderChange}
                    min={0}
                    max={100}
                    step={1}
                  />
              </div>
          </div>

          {(!showTextStyleControls || activeTextStyleKey === 'richTextImage') && (
            <div className="grid grid-cols-3 items-start">
              <Label variant="muted" className="py-2">Shadow</Label>
              <div className="col-span-2 *:w-full flex flex-col gap-2">

                  <Popover open={popoverOpen} onOpenChange={handleOpenPopover}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="input" size="sm"
                        className="justify-start"
                      >
                        <div className="size-5 rounded-[6px] shrink-0 -ml-1 relative overflow-hidden outline outline-current/10 -outline-offset-1">
                          <div className="absolute inset-0 opacity-15 bg-checkerboard bg-background z-10" />
                        </div>
                        <span className="dark:opacity-50">Add...</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 my-0.5 flex flex-col gap-2" align="end">
                      {editingShadow && (
                        <>
                          <div className="grid grid-cols-3">
                            <Label variant="muted">Position</Label>
                            <div className="col-span-2">
                              <Tabs
                                value={editingShadow.position}
                                onValueChange={(value) => handleShadowPositionChange(value as 'outside' | 'inside')}
                                className="w-full"
                              >
                                <TabsList className="w-full">
                                  <TabsTrigger value="outside">
                                    Outside
                                  </TabsTrigger>
                                  <TabsTrigger value="inside">
                                    Inside
                                  </TabsTrigger>
                                </TabsList>
                              </Tabs>
                            </div>
                          </div>

                          <div className="grid grid-cols-3">
                            <Label variant="muted">Color</Label>
                            <div className="col-span-2 *:w-full">
                              <ColorPicker
                                value={editingShadow.color} onChange={handleShadowColorChange}
                                solidOnly
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-3">
                            <Label variant="muted">X</Label>
                            <div className="col-span-2 grid grid-cols-2 items-center gap-2">
                              <CssVariableInput
                                variableTypes={['size']}
                                stepper

                                min={-100}
                                max={100}
                                step={1}
                                value={editingShadow.x}
                                onChange={(e) => handleShadowXChange(parseShadowLength(e.target.value))}
                              />
                              <Slider
                                className="flex-1"
                                value={[Number(editingShadow.x) || 0]}
                                onValueChange={(values) => handleShadowXChange(values[0])}
                                min={-100}
                                max={100}
                                step={1}
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-3">
                            <Label variant="muted">Y</Label>
                            <div className="col-span-2 grid grid-cols-2 items-center gap-2">
                              <CssVariableInput
                                variableTypes={['size']}
                                stepper

                                min={-100}
                                max={100}
                                step={1}
                                value={editingShadow.y}
                                onChange={(e) => handleShadowYChange(parseShadowLength(e.target.value))}
                              />
                              <Slider
                                className="flex-1"
                                value={[Number(editingShadow.y) || 0]}
                                onValueChange={(values) => handleShadowYChange(values[0])}
                                min={-100}
                                max={100}
                                step={1}
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-3">
                            <Label variant="muted">Blur</Label>
                            <div className="col-span-2 grid grid-cols-2 items-center gap-2">
                              <CssVariableInput
                                variableTypes={['size']}
                                stepper

                                min={0}
                                max={100}
                                step={1}
                                value={editingShadow.blur}
                                onChange={(e) => handleShadowBlurChange(parseShadowLength(e.target.value))}
                              />
                              <Slider
                                className="flex-1"
                                value={[Number(editingShadow.blur) || 0]}
                                onValueChange={(values) => handleShadowBlurChange(values[0])}
                                min={0}
                                max={100}
                                step={1}
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-3">
                            <Label variant="muted">Spread</Label>
                            <div className="col-span-2 grid grid-cols-2 items-center gap-2">
                              <CssVariableInput
                                variableTypes={['size']}
                                stepper

                                min={0}
                                max={100}
                                step={1}
                                value={editingShadow.spread}
                                onChange={(e) => handleShadowSpreadChange(parseShadowLength(e.target.value))}
                              />
                              <Slider
                                className="flex-1"
                                value={[Number(editingShadow.spread) || 0]}
                                onValueChange={(values) => handleShadowSpreadChange(values[0])}
                                min={0}
                                max={100}
                                step={1}
                              />
                            </div>
                          </div>
                        </>
                      )}
                    </PopoverContent>
                  </Popover>

                  {shadows.map((shadow) => (
                    <Button
                      key={shadow.id}
                      variant="input"
                      onClick={() => handleEditShadow(shadow.id)}
                    >
                      <Label variant="muted" className="cursor-pointer">{getShadowDisplayName(shadow)}</Label>
                      <span
                        role="button"
                        tabIndex={0}
                        className="ml-auto -mr-0.5 p-0.5 rounded-sm opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveShadow(shadow.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                            handleRemoveShadow(shadow.id);
                          }
                        }}
                      >
                        <Icon name="x" className="size-2.5" />
                      </span>
                    </Button>
                  ))}

                  {/*<Select value={boxShadow || 'none'} onValueChange={handleBoxShadowChange}>*/}
                  {/*    <SelectTrigger>*/}
                  {/*        <SelectValue />*/}
                  {/*    </SelectTrigger>*/}
                  {/*    <SelectContent>*/}
                  {/*        <SelectGroup>*/}
                  {/*            <SelectItem value="none">None</SelectItem>*/}
                  {/*            <SelectItem value="sm">Small</SelectItem>*/}
                  {/*            <SelectItem value="md">Medium</SelectItem>*/}
                  {/*            <SelectItem value="lg">Large</SelectItem>*/}
                  {/*            <SelectItem value="xl">Extra Large</SelectItem>*/}
                  {/*            <SelectItem value="2xl">2X Large</SelectItem>*/}
                  {/*            <SelectItem value="inner">Inner</SelectItem>*/}
                  {/*        </SelectGroup>*/}
                  {/*    </SelectContent>*/}
                  {/*</Select>*/}

              </div>
            </div>
          )}

          {blur && (
            <div className="grid grid-cols-3">
              <Label variant="muted">Blur</Label>
              <div className="col-span-2 flex items-center gap-2">
                <div className="flex-1 grid grid-cols-2 items-center gap-2">
                  <InputGroup>
                    <InputGroupInput
                      stepper
                      value={blurInput}
                      onChange={(e) => handleBlurChange(e.target.value)}
                      onFocus={() => setIsBlurFocused(true)}
                      onBlur={handleBlurInputBlur}
                      min="0"
                      step="1"
                    />
                  </InputGroup>
                  <Slider
                    className="flex-1"
                    value={[blurValue]}
                    onValueChange={handleBlurSliderChange}
                    min={0}
                    max={100}
                    step={1}
                  />
                </div>
                <button
                  type="button"
                  className="p-0.5 rounded-sm opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                  onClick={handleRemoveBlur}
                >
                  <Icon name="x" className="size-2.5" />
                </button>
              </div>
            </div>
          )}

          {backdropBlur && (
            <div className="grid grid-cols-3">
              <Label variant="muted">BG Blur</Label>
              <div className="col-span-2 flex items-center gap-2">
                <div className="flex-1 grid grid-cols-2 items-center gap-2">
                  <InputGroup>
                    <InputGroupInput
                      stepper
                      value={backdropBlurInput}
                      onChange={(e) => handleBackdropBlurChange(e.target.value)}
                      onFocus={() => setIsBackdropBlurFocused(true)}
                      onBlur={handleBackdropBlurInputBlur}
                      min="0"
                      step="1"
                    />
                  </InputGroup>
                  <Slider
                    className="flex-1"
                    value={[backdropBlurValue]}
                    onValueChange={handleBackdropBlurSliderChange}
                    min={0}
                    max={100}
                    step={1}
                  />
                </div>
                <button
                  type="button"
                  className="p-0.5 rounded-sm opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                  onClick={handleRemoveBackdropBlur}
                >
                  <Icon name="x" className="size-2.5" />
                </button>
              </div>
            </div>
          )}

      </div>

    </div>
  );
});
export default EffectControls;
