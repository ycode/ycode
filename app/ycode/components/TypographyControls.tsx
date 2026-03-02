'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Icon from '@/components/ui/icon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useDesignSync } from '@/hooks/use-design-sync';
import { useControlledInput } from '@/hooks/use-controlled-input';
import { useEditorStore } from '@/stores/useEditorStore';
import { useFontsStore } from '@/stores/useFontsStore';
import { extractMeasurementValue } from '@/lib/measurement-utils';
import { removeSpaces } from '@/lib/utils';
import { getFontAvailableWeights, FONT_WEIGHTS } from '@/lib/font-utils';
import type { Collection, CollectionField, Layer } from '@/types';
import type { FieldGroup } from '@/lib/collection-field-utils';
import ColorPropertyField from './ColorPropertyField';
import FontPicker from './FontPicker';

interface TypographyControlsProps {
  layer: Layer | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
  activeTextStyleKey?: string | null;
  fieldGroups?: FieldGroup[];
  allFields?: Record<string, CollectionField[]>;
  collections?: Collection[];
}

export default function TypographyControls({ layer, onLayerUpdate, activeTextStyleKey, fieldGroups, allFields, collections }: TypographyControlsProps) {
  const { activeBreakpoint, activeUIState } = useEditorStore();
  const showTextStyleControls = useEditorStore((state) => state.showTextStyleControls());
  const { updateDesignProperty, updateDesignProperties, debouncedUpdateDesignProperty, getDesignProperty } = useDesignSync({
    layer,
    onLayerUpdate,
    activeBreakpoint,
    activeUIState,
    activeTextStyleKey,
  });

  const { getFontByFamily } = useFontsStore();

  // Get current values from layer (with inheritance)
  const fontFamily = getDesignProperty('typography', 'fontFamily') || '';
  const fontWeightRaw = getDesignProperty('typography', 'fontWeight') || 'normal';
  const fontSize = getDesignProperty('typography', 'fontSize') || '';
  const textAlign = getDesignProperty('typography', 'textAlign') || 'left';
  const letterSpacing = getDesignProperty('typography', 'letterSpacing') || '';
  const lineHeight = getDesignProperty('typography', 'lineHeight') || '';
  const color = getDesignProperty('typography', 'color') || '';
  const textTransform = getDesignProperty('typography', 'textTransform') || 'none';
  const textDecoration = getDesignProperty('typography', 'textDecoration') || 'none';
  const textDecorationColor = getDesignProperty('typography', 'textDecorationColor') || '';
  const textDecorationThickness = getDesignProperty('typography', 'textDecorationThickness') || '';
  const underlineOffset = getDesignProperty('typography', 'underlineOffset') || '';
  const placeholderColor = getDesignProperty('typography', 'placeholderColor') || '';

  // Get available weights for the selected font
  const selectedFont = getFontByFamily(fontFamily);
  const availableWeights = selectedFont ? getFontAvailableWeights(selectedFont) : [];

  // Detect if underline is active
  const hasUnderline = textDecoration === 'underline';

  // Custom extractor for letter spacing (strips 'em' as default unit, like fontSize strips 'px')
  const extractLetterSpacingValue = (value: string): string => {
    if (!value) return '';

    // Special values that don't need processing
    const specialValues = ['auto', 'normal'];
    if (specialValues.includes(value)) return value;

    // Strip 'em' unit (default for letter spacing)
    // Keep all other units like px, rem, %, etc.
    if (value.endsWith('em')) {
      return value.slice(0, -2);
    }

    return value;
  };

  // Local controlled inputs (prevents repopulation bug)
  const [fontSizeInput, setFontSizeInput] = useControlledInput(fontSize, extractMeasurementValue);
  const [letterSpacingInput, setLetterSpacingInput] = useControlledInput(letterSpacing, extractLetterSpacingValue);
  const [lineHeightInput, setLineHeightInput] = useControlledInput(lineHeight);
  const [decorationThicknessInput, setDecorationThicknessInput] = useControlledInput(textDecorationThickness, extractMeasurementValue);
  const [underlineOffsetInput, setUnderlineOffsetInput] = useControlledInput(underlineOffset, extractMeasurementValue);

  // Map numeric font weights to named values
  const fontWeightMap: Record<string, string> = {
    '100': 'thin',
    '200': 'extralight',
    '300': 'light',
    '400': 'normal',
    '500': 'medium',
    '600': 'semibold',
    '700': 'bold',
    '800': 'extrabold',
    '900': 'black',
  };

  // Map named font weights to numeric values
  const fontWeightMapReverse: Record<string, string> = {
    'thin': '100',
    'extralight': '200',
    'light': '300',
    'normal': '400',
    'medium': '500',
    'semibold': '600',
    'bold': '700',
    'extrabold': '800',
    'black': '900',
  };

  // Convert numeric weight to named for the Select
  const fontWeight = fontWeightMap[fontWeightRaw] || fontWeightRaw;

  // Handle font family change
  const handleFontFamilyChange = (value: string) => {
    updateDesignProperty('typography', 'fontFamily', value === 'inherit' ? null : value);
  };

  // Handle font weight change - convert named back to numeric
  const handleFontWeightChange = (value: string) => {
    const numericWeight = fontWeightMapReverse[value] || value;
    updateDesignProperty('typography', 'fontWeight', numericWeight);
  };

  // Handle font size change (debounced for text input)
  const handleFontSizeChange = (value: string) => {
    setFontSizeInput(value); // Update local state immediately (spaces auto-stripped by hook)
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('typography', 'fontSize', sanitized || null);
  };

  // Handle text align change (immediate - button toggle)
  const handleTextAlignChange = (value: string) => {
    updateDesignProperty('typography', 'textAlign', value);
  };

  // Handle letter spacing change (debounced for text input)
  const handleLetterSpacingChange = (value: string) => {
    setLetterSpacingInput(value);
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('typography', 'letterSpacing', sanitized || null);
  };

  // Handle letter spacing stepper (round to 1 decimal to avoid floating point noise)
  const handleLetterSpacingStepper = (value: string) => {
    const num = parseFloat(value);
    const rounded = !isNaN(num) ? String(Math.round(num * 10) / 10) : value;
    handleLetterSpacingChange(rounded);
  };

  // Handle line height change (debounced for text input)
  const handleLineHeightChange = (value: string) => {
    setLineHeightInput(value);
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('typography', 'lineHeight', sanitized || null);
  };

  // Handle line height stepper (round to 1 decimal to avoid floating point noise)
  const handleLineHeightStepper = (value: string) => {
    const num = parseFloat(value);
    const rounded = !isNaN(num) ? String(Math.round(num * 10) / 10) : value;
    handleLineHeightChange(rounded);
  };

  // Debounced handler for keyboard-typed hex values
  const handleColorChange = (value: string) => {
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('typography', 'color', sanitized || null);
  };

  // Immediate handler for programmatic changes
  const handleColorImmediate = (value: string) => {
    const sanitized = removeSpaces(value);
    updateDesignProperty('typography', 'color', sanitized || null);
  };

  // Add underline with defaults
  const handleAddUnderline = () => {
    updateDesignProperties([
      { category: 'typography', property: 'textDecoration', value: 'underline' },
      { category: 'typography', property: 'textDecorationThickness', value: '1px' },
      { category: 'typography', property: 'textDecorationColor', value: '#000000' },
      { category: 'typography', property: 'underlineOffset', value: '2px' },
    ]);
  };

  // Remove underline and all related properties
  const handleRemoveUnderline = () => {
    updateDesignProperties([
      { category: 'typography', property: 'textDecoration', value: null },
      { category: 'typography', property: 'textDecorationThickness', value: null },
      { category: 'typography', property: 'textDecorationColor', value: null },
      { category: 'typography', property: 'underlineOffset', value: null },
    ]);
  };

  // Debounced handler for keyboard-typed hex values
  const handleDecorationColorChange = (value: string) => {
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('typography', 'textDecorationColor', sanitized || null);
  };

  // Immediate handler for programmatic changes
  const handleDecorationColorImmediate = (value: string) => {
    const sanitized = removeSpaces(value);
    updateDesignProperty('typography', 'textDecorationColor', sanitized || null);
  };

  // Handle decoration thickness change (debounced for text input)
  const handleDecorationThicknessChange = (value: string) => {
    setDecorationThicknessInput(value);
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('typography', 'textDecorationThickness', sanitized || null);
  };

  // Handle underline offset change (debounced for text input)
  const handleUnderlineOffsetChange = (value: string) => {
    setUnderlineOffsetInput(value);
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('typography', 'underlineOffset', sanitized || null);
  };

  // Check if the layer is an icon
  const isIcon = layer?.name === 'icon';

  // Check if the layer supports placeholder (input/textarea)
  const hasPlaceholder = layer?.name === 'input' || layer?.name === 'textarea';

  const handlePlaceholderColorChange = (value: string) => {
    const sanitized = removeSpaces(value);
    debouncedUpdateDesignProperty('typography', 'placeholderColor', sanitized || null);
  };

  const handlePlaceholderColorImmediate = (value: string) => {
    const sanitized = removeSpaces(value);
    updateDesignProperty('typography', 'placeholderColor', sanitized || null);
  };

  // Inline text styles that don't support block-level properties like text-align
  // Dynamic styles (dts-*) are also inline
  const inlineTextStyles = ['bold', 'italic', 'underline', 'strike', 'subscript', 'superscript', 'code'];
  const isInlineTextStyle = activeTextStyleKey && (
    inlineTextStyles.includes(activeTextStyleKey) ||
    activeTextStyleKey.startsWith('dts-')
  );

  // Hide block-level properties (like text align) when in text edit mode with default style
  const hideBlockLevelProperties = isInlineTextStyle || (showTextStyleControls && !activeTextStyleKey);

  return (
    <div className="py-5">
      <header className="py-4 -mt-4 flex items-center justify-between">
        <Label>{isIcon ? 'Fill' : 'Typography'}</Label>
        {!isIcon && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="xs">
                <Icon name="plus" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={handleAddUnderline}
                disabled={hasUnderline}
              >
                Underline
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      <div className="flex flex-col gap-2">
        {!isIcon && (
          <>
            <div className="grid grid-cols-3">
              <Label variant="muted">Font</Label>
              <div className="col-span-2">
                <FontPicker
                  value={fontFamily}
                  onChange={handleFontFamilyChange}
                />
              </div>
            </div>

            <div className="grid grid-cols-3">
              <Label variant="muted">Weight</Label>
              <div className="col-span-2 *:w-full">
                <Select value={fontWeight} onValueChange={handleFontWeightChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {availableWeights.length > 0 ? (
                        FONT_WEIGHTS
                          .filter(w => availableWeights.includes(w.value))
                          .map(w => (
                            <SelectItem key={w.value} value={fontWeightMap[w.value] || w.value}>
                              {w.label}
                            </SelectItem>
                          ))
                      ) : (
                        <>
                          <SelectItem value="thin">Thin</SelectItem>
                          <SelectItem value="extralight">Extralight</SelectItem>
                          <SelectItem value="light">Light</SelectItem>
                          <SelectItem value="normal">Regular</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="semibold">Semibold</SelectItem>
                          <SelectItem value="bold">Bold</SelectItem>
                          <SelectItem value="extrabold">Extrabold</SelectItem>
                          <SelectItem value="black">Black</SelectItem>
                        </>
                      )}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3">
              <Label variant="muted">Size</Label>
              <div className="col-span-2 *:w-full">
                <InputGroup>
                  <InputGroupInput
                    value={fontSizeInput}
                    onChange={(e) => handleFontSizeChange(e.target.value)}
                    stepper
                    min="0"
                  />
                </InputGroup>
              </div>
            </div>
          </>
        )}

        <div className="grid grid-cols-3">
          <Label variant="muted">Color</Label>
          <div className="col-span-2 *:w-full">
            <ColorPropertyField
              value={color}
              onChange={handleColorChange}
              onImmediateChange={handleColorImmediate}
              defaultValue="#1c70d7"
              layer={layer}
              onLayerUpdate={onLayerUpdate}
              designProperty="color"
              fieldGroups={fieldGroups}
              allFields={allFields}
              collections={collections}
            />
          </div>
        </div>

        {hasPlaceholder && (
          <div className="grid grid-cols-3">
            <Label variant="muted">Placeholder</Label>
            <div className="col-span-2 *:w-full">
              <ColorPropertyField
                solidOnly
                value={placeholderColor}
                onChange={handlePlaceholderColorChange}
                onImmediateChange={handlePlaceholderColorImmediate}
                defaultValue="#9ca3af"
                layer={layer}
                onLayerUpdate={onLayerUpdate}
                designProperty="placeholderColor"
                fieldGroups={fieldGroups}
                allFields={allFields}
                collections={collections}
              />
            </div>
          </div>
        )}

        {!isIcon && !hideBlockLevelProperties && (
          <div className="grid grid-cols-3">
            <Label variant="muted">Align</Label>
            <div className="col-span-2">
              <Tabs
                value={textAlign} onValueChange={handleTextAlignChange}
                className="w-full"
              >
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="left" className="px-2 text-xs">
                    <Icon name="textAlignLeft" />
                  </TabsTrigger>
                  <TabsTrigger value="center" className="px-2 text-xs">
                    <Icon name="textAlignCenter" />
                  </TabsTrigger>
                  <TabsTrigger value="right" className="px-2 text-xs">
                    <Icon name="textAlignRight" />
                  </TabsTrigger>
                  <TabsTrigger value="justify" className="px-2 text-xs">
                    <Icon name="textAlignJustify" />
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>
        )}

        {!isIcon && (
          <div className="grid grid-cols-3">
            <Label variant="muted">Spacing</Label>
            <div className="col-span-2 grid grid-cols-2 gap-2">
              <InputGroup>
                <InputGroupAddon>
                  <div className="flex">
                    <Tooltip>
                      <TooltipTrigger>
                        <Icon name="letterSpacing" className="size-3" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Letter spacing</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </InputGroupAddon>
                <InputGroupInput
                  className="pr-0!"
                  value={letterSpacingInput}
                  onChange={(e) => handleLetterSpacingChange(e.target.value)}
                  onStepperChange={handleLetterSpacingStepper}
                  stepper
                  step="0.1"
                  min="0"
                />
              </InputGroup>
              <InputGroup>
                <InputGroupAddon>
                  <div className="flex">
                    <Tooltip>
                      <TooltipTrigger>
                        <Icon name="lineHeight" className="size-3" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Line height</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </InputGroupAddon>
                <InputGroupInput
                  className="pr-0!"
                  value={lineHeightInput}
                  onChange={(e) => handleLineHeightChange(e.target.value)}
                  onStepperChange={handleLineHeightStepper}
                  stepper
                  step="0.1"
                  min="0"
                />
              </InputGroup>
            </div>
          </div>
        )}

        {!isIcon && hasUnderline && (
          <div className="grid grid-cols-3 items-start">
            <Label variant="muted" className="h-8">Underline</Label>
            <div className="col-span-2 flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <InputGroup className="flex-1 cursor-pointer">
                    <div className="w-full flex items-center gap-2 px-2.5">
                      <div
                        className="size-4 rounded shrink-0"
                        style={{ backgroundColor: textDecorationColor || '#000000' }}
                      />
                      <Label variant="muted">Underline</Label>
                    </div>
                  </InputGroup>
                </PopoverTrigger>

                <PopoverContent className="w-64 mr-4">
                  <div className="flex flex-col gap-2">

                    <div className="grid grid-cols-3 items-start">
                      <Label variant="muted" className="h-8">Offset</Label>
                      <div className="col-span-2">
                        <Input
                          stepper
                          min="0"
                          step="1"
                          value={underlineOffsetInput}
                          onChange={(e) => handleUnderlineOffsetChange(e.target.value)}
                          placeholder="2"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 items-start">
                      <Label variant="muted" className="h-8">Thickness</Label>
                      <div className="col-span-2">
                        <Input
                          stepper
                          min="0"
                          step="1"
                          value={decorationThicknessInput}
                          onChange={(e) => handleDecorationThicknessChange(e.target.value)}
                          placeholder="1"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3">
                      <Label variant="muted">Color</Label>
                      <div className="col-span-2 *:w-full">
                        <ColorPropertyField
                          solidOnly
                          value={textDecorationColor || '#000000'}
                          onChange={handleDecorationColorChange}
                          onImmediateChange={handleDecorationColorImmediate}
                          layer={layer}
                          onLayerUpdate={onLayerUpdate}
                          designProperty="textDecorationColor"
                          fieldGroups={fieldGroups}
                          allFields={allFields}
                          collections={collections}
                        />
                      </div>
                    </div>

                  </div>
                </PopoverContent>
              </Popover>
              <Button
                variant="ghost"
                size="xs"
                onClick={handleRemoveUnderline}
              >
                <Icon name="x" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
