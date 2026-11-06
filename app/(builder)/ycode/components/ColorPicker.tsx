'use client';

/**
 * ColorPicker Component
 *
 * A color picker wrapped in a Popover with a visual color button trigger
 * Supports solid colors (with draggable palette, hue, opacity) and gradients
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import debounce from 'lodash.debounce';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import Icon from '@/components/ui/icon';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { DndContext, closestCenter, useSensor, useSensors, PointerSensor } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import SettingsPanel from './SettingsPanel';
import BoundFieldPill from './BoundFieldPill';

import { useColorVariablesStore } from '@/stores/useColorVariablesStore';

/** CMS color field binding props (optional, for design property data-binding) */
export interface ColorPickerBindingProps {
  /** Whether CMS color fields are available for binding */
  hasColorFields?: boolean;
  /** Query binding state for a stop (null = solid) */
  getBinding: (stopId: string | null) => { isBound: boolean; fieldName: string | null };
  /** Bind a CMS field to a stop (null = solid) */
  onBind: (stopId: string | null, fieldId: string, relationshipPath: string[], source?: string, layerId?: string) => void;
  /** Unbind a stop (null = solid) */
  onUnbind: (stopId: string | null) => void;
  /** Sync gradient structure when stops change in the picker */
  onGradientSync?: (mode: 'linear' | 'radial', stops: Array<{ id: string; position: number; color: string }>, angle?: number) => void;
  /** Switch to solid mode, preserving gradient stops for later */
  onSwitchToSolid?: () => void;
  /** Render the field selector with a custom onSelect callback */
  renderFieldSelector: (onSelect: (fieldId: string, relationshipPath: string[], source?: string, layerId?: string) => void) => React.ReactNode;
}

interface ColorPickerProps {
  value?: string;
  /** Debounced change handler (used for keyboard-typed hex values) */
  onChange: (value: string) => void;
  /** Immediate (non-debounced) handler for programmatic changes (tab switches, color picks, gradient stops) */
  onImmediateChange?: (value: string) => void;
  defaultValue?: string;
  placeholder?: string;
  solidOnly?: boolean;
  /** Render a compact swatch-only trigger (hides hex/label and clear button). Useful in tight UI like inline animation inputs. */
  swatchOnly?: boolean;
  /** Called when the popover open state changes (for callers that need to react to open/close, e.g. canvas previews). */
  onOpenChange?: (open: boolean) => void;
  /** CMS color field binding (optional) */
  binding?: ColorPickerBindingProps;
  /** Called when the clear button is clicked (in addition to onChange('')) */
  onClear?: () => void;
  /** Content for an optional "image" tab (e.g. background image controls for text layers) */
  imageTab?: React.ReactNode;
  /** Called when the image tab is activated */
  onImageActivate?: () => void;
  /** Called when switching away from the image tab; receives the solid color to restore */
  onImageDeactivate?: (solidColor: string) => void;
  /** Preview URL for an active background image (shown in the trigger swatch) */
  imagePreviewUrl?: string;
  /** Label for the active background image source (e.g. "File manager", "Custom URL") */
  imageLabel?: string;
}

// Helper to convert hex/rgba to RgbaColor object
// Supports formats: #hex, #hex/opacity, #rrggbbaa (8-char with alpha), rgba(...)
function parseColor(colorString: string): { r: number; g: number; b: number; a: number } {
  if (!colorString) return { r: 255, g: 255, b: 255, a: 1 };

  // Hex color with opacity suffix: #hex/opacity
  const hexWithOpacityMatch = colorString.match(/^#([0-9a-fA-F]{6})\/(\d+)$/);
  if (hexWithOpacityMatch) {
    const hex = hexWithOpacityMatch[1];
    const opacity = parseInt(hexWithOpacityMatch[2]) / 100;
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: opacity,
    };
  }

  // Hex color (6 or 8 chars)
  if (colorString.startsWith('#')) {
    const hex = colorString.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    // Support old 8-char format for backward compatibility
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }

  // RGBA string
  const rgbaMatch = colorString.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (rgbaMatch) {
    return {
      r: parseInt(rgbaMatch[1]),
      g: parseInt(rgbaMatch[2]),
      b: parseInt(rgbaMatch[3]),
      a: rgbaMatch[4] ? parseFloat(rgbaMatch[4]) : 1,
    };
  }

  return { r: 255, g: 255, b: 255, a: 1 };
}

// Helper to convert RgbaColor to hex string (always 6 chars, no alpha)
// Opacity is handled separately via Tailwind opacity syntax: bg-[#hex]/opacity
function rgbaToHex(rgba: { r: number; g: number; b: number; a: number }): string {
  const r = Math.round(rgba.r).toString(16).padStart(2, '0');
  const g = Math.round(rgba.g).toString(16).padStart(2, '0');
  const b = Math.round(rgba.b).toString(16).padStart(2, '0');
  const hex = `#${r}${g}${b}`;

  // If opacity is less than 1, append it as /opacity (0-100)
  if (rgba.a < 1) {
    const opacityPercent = Math.round(rgba.a * 100);
    return `${hex}/${opacityPercent}`;
  }

  return hex;
}

/**
 * Convert a hex color with optional opacity to a CSS rgba string.
 * e.g. "#ff0000/50" → "rgba(255,0,0,0.5)", "#ff0000" → "#ff0000"
 */
function hexToRgba(value: string): string {
  const parts = value.split('/');
  const hex = parts[0];
  if (parts.length < 2) return hex;
  const opacity = parseInt(parts[1]) / 100;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

// Helper to get just the hex part (6 chars) from a color value
function getHexOnly(colorValue: string): string {
  if (!colorValue) return '#000000';

  // Extract hex from #hex/opacity format
  const hexWithOpacityMatch = colorValue.match(/^(#[0-9a-fA-F]{6})(?:\/\d+)?$/);
  if (hexWithOpacityMatch) {
    return hexWithOpacityMatch[1];
  }

  // Extract hex from 8-char format
  if (colorValue.length === 9 && colorValue.startsWith('#')) {
    return colorValue.slice(0, 7);
  }

  // Extract hex from 6-char format
  if (colorValue.length === 7 && colorValue.startsWith('#')) {
    return colorValue;
  }

  return '#000000';
}

// Helper to convert color string (hex or rgba) to rgba string format
// For gradients, we use rgba format to match Tailwind: rgba(r,g,b,a)
function colorToRgbaString(color: string): string {
  const parsed = parseColor(color);
  // Format: rgba(r,g,b,a) - no spaces, alpha as number (0-1)
  return `rgba(${Math.round(parsed.r)},${Math.round(parsed.g)},${Math.round(parsed.b)},${parsed.a})`;
}

/**
 * Extract the variable ID from a color variable reference value.
 * e.g. "color:var(--64ddf774a5abc)" → "64ddf774a5abc"
 */
function extractColorVariableId(value: string): string | null {
  const match = value.match(/^color:var\(--([^)]+)\)$/);
  return match ? match[1] : null;
}

// Helper to generate gradient CSS string
// For visual display in the gradient bar, always use linear-gradient at 90deg for consistency
function generateGradientCSS(
  stops: ColorStop[],
  _type: 'linear' | 'radial',
  _angle?: number,
  resolveColor?: (color: string) => string
): string {
  const stopsStr = stops.map(s => {
    const color = resolveColor ? resolveColor(s.color) : s.color;
    return `${color} ${s.position}%`;
  }).join(', ');
  return `linear-gradient(90deg, ${stopsStr})`;
}

// Helper to generate HUE gradient CSS (0-360 degrees)
function generateHueGradientCSS(): string {
  return 'linear-gradient(90deg, hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%))';
}

// Helper to convert HSL to RGB
function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  h /= 360;
  s /= 100;
  l /= 100;

  let r, g, b;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

// Helper to convert RGB to HSL
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

// Helper to convert HSV to RGB
function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  h /= 360;
  s /= 100;
  v /= 100;

  let r = 0, g = 0, b = 0;

  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

// Helper to convert RGB to HSV
function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;

  if (max !== min) {
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    v: Math.round(v * 100),
  };
}

// SaturationLightnessPicker Component
// Note: Despite the name, this actually uses HSV color space internally
// because the visual gradient represents HSV (top = bright colors, not white)
interface SaturationLightnessPickerProps {
  hue: number; // 0-360
  saturation: number; // 0-100 (HSV saturation)
  value: number; // 0-100 (HSV value/brightness)
  onChange: (saturation: number, value: number) => void;
}

function SaturationLightnessPicker({ hue, saturation, value, onChange }: SaturationLightnessPickerProps) {
  const pickerRef = React.useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const dragRectRef = React.useRef<DOMRect | null>(null);

  // Background gradient (HSV color space):
  // - Vertical: bright colors (top, value 100%) to black (bottom, value 0%)
  // - Horizontal: white/desaturated (left, saturation 0%) to pure hue (right, saturation 100%)
  const bgColorFull = `hsl(${hue}, 100%, 50%)`; // Full saturation color
  const x = saturation; // 0-100
  const y = 100 - value; // Invert Y axis (0 at top = 100% value/brightness)

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (pickerRef.current) {
      // Store the rect at drag start to prevent it from changing during drag
      dragRectRef.current = pickerRef.current.getBoundingClientRect();
    }
    setIsDragging(true);
    updatePosition(e);
  };

  const updatePosition = React.useCallback((e: MouseEvent | React.MouseEvent) => {
    // Use stored rect from drag start, or get current rect if not dragging
    const rect = dragRectRef.current || (pickerRef.current?.getBoundingClientRect() ?? null);
    if (!rect) return;

    // Get mouse position - handle both MouseEvent (from document) and React.MouseEvent
    const clientX = 'clientX' in e ? e.clientX : (e as MouseEvent).clientX;
    const clientY = 'clientY' in e ? e.clientY : (e as MouseEvent).clientY;

    // Calculate position relative to the picker element
    let xPos = clientX - rect.left;
    let yPos = clientY - rect.top;

    // Clamp to exact bounds (0 to width/height) - this ensures edge cases work correctly
    xPos = Math.max(0, Math.min(rect.width, xPos));
    yPos = Math.max(0, Math.min(rect.height, yPos));

    // Calculate saturation: 0% (left) to 100% (right)
    // Use Math.min to ensure we never exceed 100% due to floating point precision
    const newSaturation = rect.width > 0 ? Math.min(100, (xPos / rect.width) * 100) : 0;

    // Calculate value (brightness): 100% (top) to 0% (bottom) - invert Y axis
    const newValue = rect.height > 0 ? Math.max(0, 100 - ((yPos / rect.height) * 100)) : 0;

    // Call onChange with clamped values (HSV saturation and value)
    onChange(newSaturation, newValue);
  }, [onChange]);

  const handleMouseMove = React.useCallback((e: MouseEvent) => {
    if (!isDragging || !pickerRef.current) return;
    updatePosition(e);
  }, [isDragging, updatePosition]);

  const handleMouseUp = React.useCallback(() => {
    setIsDragging(false);
    dragRectRef.current = null; // Clear stored rect when drag ends
  }, []);

  React.useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Create accurate background gradient using standard color picker approach
  // Standard saturation/lightness picker layout:
  // - X-axis (left to right): saturation 0% (gray) to 100% (full color)
  // - Y-axis (top to bottom): lightness 100% (white) to 0% (black)
  // Using two gradients with multiply blend mode:
  // 1. Vertical: white to black (controls lightness)
  // 2. Horizontal: white to full hue color (controls saturation)
  // Multiply blend combines them correctly
  const backgroundGradient = React.useMemo(() => {
    // Get the full saturation color at 50% lightness for the right edge
    const fullColor = hslToRgb(hue, 100, 50);
    const fullColorStr = `rgb(${fullColor.r}, ${fullColor.g}, ${fullColor.b})`;

    return `
      linear-gradient(to bottom, rgba(255,255,255,1) 0%, rgba(0,0,0,1) 100%),
      linear-gradient(to right, rgba(255,255,255,1) 0%, ${fullColorStr} 100%)
    `;
  }, [hue]);

  return (
    <div
      ref={pickerRef}
      className="relative w-full h-full rounded-md overflow-hidden touch-none outline outline-white/15 -outline-offset-1"
      style={{
        background: backgroundGradient,
        backgroundBlendMode: 'multiply',
      }}
      onMouseDown={handleMouseDown}
    >
      <div
        className={cn(
          'absolute -translate-x-1/2 -translate-y-1/2 select-none z-10 pointer-events-none',
          isDragging && 'z-20'
        )}
        style={{
          left: `${x}%`,
          top: `${y}%`,
        }}
      >
        <div className="size-3 rounded-full border-2 border-white shadow-md" />
      </div>
    </div>
  );
}

// HueBar Component - matches GradientBar design
interface HueBarProps {
  hue: number; // 0-360
  onChange: (hue: number) => void;
}

function HueBar({ hue, onChange }: HueBarProps) {
  const barRef = React.useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);

  const hueCSS = generateHueGradientCSS();

  // Calculate position accounting for dot's half-width
  // Clamp visual position to ~2.5% and 97.5% to keep the 12px dot (6px half-width) within bounds
  // This works for typical bar widths (200px+): 2.5% of 200px = 5px margin, 97.5% = 195px
  const rawPosition = (hue / 360) * 100;
  const position = Math.max(2.5, Math.min(97.5, rawPosition));

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    updateHue(e);
  };

  const updateHue = React.useCallback((e: MouseEvent | React.MouseEvent) => {
    if (!barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    // Clamp mouse position to account for dot's half-width
    const dotHalfWidth = 6; // size-3 = 12px, half = 6px
    const clampedX = Math.max(dotHalfWidth, Math.min(rect.width - dotHalfWidth, x));
    const newPosition = ((clampedX - dotHalfWidth) / (rect.width - dotHalfWidth * 2)) * 100;
    const newHue = Math.round(Math.max(0, Math.min(360, (newPosition / 100) * 360)));
    onChange(newHue);
  }, [onChange]);

  const handleMouseMove = React.useCallback((e: MouseEvent) => {
    if (isDragging) {
      updateHue(e);
    }
  }, [isDragging, updateHue]);

  const handleMouseUp = React.useCallback(() => {
    setIsDragging(false);
  }, []);

  React.useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={barRef}
        className="relative h-3 w-full rounded-full outline outline-white/10 -outline-offset-1 cursor-pointer"
        style={{ background: hueCSS }}
        onMouseDown={handleMouseDown}
      >
        <div
          className={cn(
            'absolute top-0 -translate-x-1/2 cursor-pointer select-none z-10',
            isDragging && 'z-20'
          )}
          style={{ left: `${position}%` }}
        >
          <div className="size-3 rounded-full border-[1.5px] border-white flex items-center justify-center shadow-md pointer-events-none">
          </div>
        </div>
      </div>
    </div>
  );
}

// Opacity percentage input that allows empty field while focused
interface OpacityPercentInputProps {
  value: number; // 0-1
  onChange: (a: number) => void;
  className?: string;
}

function OpacityPercentInput({ value, onChange, className }: OpacityPercentInputProps) {
  const displayValue = Math.round(value * 100);
  const [localValue, setLocalValue] = useState(String(displayValue));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setLocalValue(String(Math.round(value * 100)));
    }
  }, [value, isFocused]);

  return (
    <InputGroup className="w-16">
      <InputGroupInput
        value={localValue}
        onChange={(e) => {
          setLocalValue(e.target.value);
          const parsed = parseInt(e.target.value);
          if (!isNaN(parsed)) {
            const clamped = Math.max(0, Math.min(100, parsed));
            onChange(clamped / 100);
          }
        }}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false);
          if (localValue.trim() === '' || isNaN(parseInt(localValue))) {
            onChange(1);
            setLocalValue('100');
          }
        }}
        className={className}
        min={0}
        max={100}
      />
      <InputGroupAddon align="inline-end">
        <Label variant="muted" className="text-xs">%</Label>
      </InputGroupAddon>
    </InputGroup>
  );
}

// OpacityBar Component - matches HueBar design
interface OpacityBarProps {
  opacity: number; // 0-1
  color: { r: number; g: number; b: number }; // RGB color for the gradient
  onChange: (opacity: number) => void;
}

function OpacityBar({ opacity, color, onChange }: OpacityBarProps) {
  const barRef = React.useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);

  // Calculate position accounting for dot's half-width
  // Clamp visual position to ~2.5% and 97.5% to keep the 12px dot within bounds
  const rawPosition = opacity * 100;
  const position = Math.max(2.5, Math.min(97.5, rawPosition));

  const colorStr = `rgb(${color.r}, ${color.g}, ${color.b})`;
  const opacityCSS = `linear-gradient(90deg, transparent, ${colorStr})`;

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    updateOpacity(e);
  };

  const updateOpacity = React.useCallback((e: MouseEvent | React.MouseEvent) => {
    if (!barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    // Clamp mouse position to account for dot's half-width
    const dotHalfWidth = 6; // size-3 = 12px, half = 6px
    const clampedX = Math.max(dotHalfWidth, Math.min(rect.width - dotHalfWidth, x));
    const newPosition = ((clampedX - dotHalfWidth) / (rect.width - dotHalfWidth * 2)) * 100;
    const newOpacity = Math.max(0, Math.min(1, newPosition / 100));
    onChange(newOpacity);
  }, [onChange]);

  const handleMouseMove = React.useCallback((e: MouseEvent) => {
    if (isDragging) {
      updateOpacity(e);
    }
  }, [isDragging, updateOpacity]);

  const handleMouseUp = React.useCallback(() => {
    setIsDragging(false);
  }, []);

  React.useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={barRef}
        className="relative h-3 w-full rounded-full outline outline-white/10 -outline-offset-1 cursor-pointer"
        onMouseDown={handleMouseDown}
      >
        {/* Checkerboard pattern for transparency */}
        <div
          className="absolute inset-0 opacity-30 rounded-full"
          style={{
            backgroundImage: 'repeating-linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc), repeating-linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc)',
            backgroundPosition: '0 0, 4px 4px',
            backgroundSize: '8px 8px',
          }}
        />
        {/* Opacity gradient */}
        <div
          className="absolute inset-0 rounded-full"
          style={{ background: opacityCSS }}
        />
        <div
          className={cn(
            'absolute top-0 -translate-x-1/2 cursor-pointer select-none z-10',
            'transition-transform hover:scale-110',
            isDragging && 'scale-110 z-20'
          )}
          style={{ left: `${position}%` }}
        >
          <div className="size-3 rounded-full border-[1.5px] border-white flex items-center justify-center shadow-md pointer-events-none">
          </div>
        </div>
      </div>
    </div>
  );
}

// GradientBar Component
interface GradientBarProps {
  stops: ColorStop[];
  selectedStopId: string | null;
  onStopSelect: (stopId: string | null) => void;
  onStopMove: (stopId: string, position: number) => void;
  onAddStop: (position?: number) => void;
  /** Removes the selected stop; button is disabled when only 2 stops remain */
  onRemoveStop: (stopId: string) => void;
  /** Rotates the gradient angle; rotate button is hidden when omitted */
  onRotate?: () => void;
  gradientType: 'linear' | 'radial';
  angle?: number;
  resolveColor?: (color: string) => string;
}

function GradientBar({
  stops,
  selectedStopId,
  onStopSelect,
  onStopMove,
  onAddStop,
  onRemoveStop,
  onRotate,
  gradientType,
  angle = 0,
  resolveColor,
}: GradientBarProps) {
  const barRef = React.useRef<HTMLDivElement>(null);
  const [draggingStopId, setDraggingStopId] = React.useState<string | null>(null);

  // Always show gradient bar at 90deg (vertical) for visual consistency
  const gradientCSS = generateGradientCSS(stops, gradientType, 90, resolveColor);
  const sortedStops = [...stops].sort((a, b) => a.position - b.position);

  const handleMouseDown = (e: React.MouseEvent, stopId: string) => {
    e.preventDefault();
    e.stopPropagation();
    // preventDefault keeps focus in the hex input, where Delete would edit text instead of removing the stop
    barRef.current?.focus();
    setDraggingStopId(stopId);
    onStopSelect(stopId);
  };

  const handleMouseMove = React.useCallback((e: MouseEvent) => {
    if (!draggingStopId || !barRef.current) return;

    const rect = barRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const position = Math.max(0, Math.min(100, (x / rect.width) * 100));
    onStopMove(draggingStopId, position);
  }, [draggingStopId, onStopMove]);

  const handleMouseUp = React.useCallback(() => {
    setDraggingStopId(null);
  }, []);

  React.useEffect(() => {
    if (draggingStopId) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [draggingStopId, handleMouseMove, handleMouseUp]);

  const handleBarClick = (e: React.MouseEvent) => {
    // Don't handle if dragging or if click was on a handle
    if (draggingStopId || (e.target as HTMLElement).closest('[data-stop-handle]')) {
      return;
    }

    // Only handle clicks directly on the gradient bar background
    if (!barRef.current || e.target !== barRef.current) return;

    const rect = barRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    // Clamp mouse position to account for dot's half-width
    const dotHalfWidth = 6; // size-3 = 12px, half = 6px
    const clampedX = Math.max(dotHalfWidth, Math.min(rect.width - dotHalfWidth, x));
    const position = ((clampedX - dotHalfWidth) / (rect.width - dotHalfWidth * 2)) * 100;

    // Find closest stop
    if (sortedStops.length > 0) {
      const closestStop = sortedStops.reduce((closest, stop) => {
        const dist = Math.abs(stop.position - position);
        const closestDist = Math.abs(closest.position - position);
        return dist < closestDist ? stop : closest;
      }, sortedStops[0]);

      // If clicked very close to a stop (within 5%), select it instead of adding new
      if (Math.abs(closestStop.position - position) < 5) {
        onStopSelect(closestStop.id);
        return;
      }
    }

    // Only add new stop if not close to any existing stop
    onAddStop(position);
  };

  const canRemoveStop = !!selectedStopId && stops.length > 2;

  return (
    <div className="flex items-center gap-2 -my-1.5">
      {onRotate && (
        <Button
          variant="ghost"
          size="xs"
          onClick={onRotate}
          title={`Rotate angle (${angle}°)`}
          aria-label="Rotate angle"
        >
          <Icon
            name="arrow-up"
            style={{ transform: `rotate(${angle}deg)` }}
          />
        </Button>
      )}
      <div
        ref={barRef}
        tabIndex={-1}
        className="relative h-3 flex-1 min-w-0 rounded-full outline outline-white/10 -outline-offset-1 cursor-pointer"
        style={{ background: gradientCSS }}
        onClick={handleBarClick}
      >
        {sortedStops.map((stop) => {
          const isSelected = selectedStopId === stop.id;
          const isDragging = draggingStopId === stop.id;

          // Calculate clamped position for visual display to keep dot within bounds
          // Use CSS calc with clamp to keep dot within bounds without JavaScript calculations
          // The dot is 12px (size-3), so we need to offset by 6px on each side
          // We'll use CSS calc to clamp between ~3% and 97% (approximate, but works for most bar widths)
          const clampedPosition = Math.max(2.5, Math.min(97.5, stop.position));

          return (
            <div
              key={stop.id}
              data-stop-handle
              className={cn(
                'absolute top-0 -translate-x-1/2 cursor-pointer select-none z-10',
                isDragging && 'z-20'
              )}
              style={{ left: `${clampedPosition}%` }}
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                handleMouseDown(e, stop.id);
              }}
              onClick={(e) => {
                e.stopPropagation();
                onStopSelect(stop.id);
              }}
            >
              <div
                className={cn(
                  'size-3 rounded-full border-[1.5px] flex items-center justify-center shadow-md pointer-events-none',
                  isSelected
                    ? 'border-white'
                    : 'border-white'
                )}
              >
                {isSelected && <div className="size-1 rounded-full bg-white" />}
              </div>
            </div>
          );
        })}
      </div>
      <Button
        variant="ghost"
        size="xs"
        disabled={!canRemoveStop}
        onClick={() => selectedStopId && onRemoveStop(selectedStopId)}
        title={canRemoveStop ? 'Remove stop' : 'A gradient needs at least 2 stops'}
        aria-label="Remove stop"
      >
        <Icon name="trash" />
      </Button>
    </div>
  );
}

interface ColorStop {
  id: string;
  color: string;
  position: number;
}

/** CMS field binding button rendered inline in the hex/opacity row */
function ColorPickerFieldBinding({ binding, stopId }: { binding: ColorPickerBindingProps; stopId: string | null }) {
  const [fieldMenuOpen, setFieldMenuOpen] = React.useState(false);

  const handleSelect = React.useCallback((fieldId: string, relationshipPath: string[], source?: string, layerId?: string) => {
    binding.onBind(stopId, fieldId, relationshipPath, source, layerId);
    setFieldMenuOpen(false);
  }, [binding, stopId]);

  return (
    <DropdownMenu open={fieldMenuOpen} onOpenChange={setFieldMenuOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="input"
              size="sm"
              type="button"
            >
              <Icon name="database" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Bind to color field</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        className="w-56"
        side="left"
        align="start"
      >
        {binding.renderFieldSelector(handleSelect)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Color Variables Section ────────────────────────────────────────

interface VarEditState {
  mode: 'edit' | 'create';
  id?: string;
  name: string;
  color: string;
}

interface SortableVariableItemProps {
  variable: import('@/types').ColorVariable;
  isActive: boolean;
  onSelect: (id: string) => void;
  onStartEdit: (v: import('@/types').ColorVariable) => void;
  onDelete: (id: string) => void;
}

function SortableVariableItem({ variable, isActive, onSelect, onStartEdit, onDelete }: SortableVariableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: variable.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          style={style}
          className="w-full flex items-center group relative"
          {...attributes}
          {...listeners}
        >
          <Button
            variant={isActive ? 'input' : 'ghost'}
            className="justify-start w-full"
            onClick={() => onSelect(variable.id)}
          >
            <div className="size-5 rounded-[6px] -ml-1 shrink-0 relative overflow-hidden">
              <div
                className="absolute inset-0 z-20"
                style={{ background: hexToRgba(variable.value) }}
              />
              <div className="absolute inset-0 opacity-15 bg-checkerboard bg-background z-10" />
            </div>
            <Label className="cursor-pointer truncate">
              {variable.name}
            </Label>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="xs"
                className="opacity-0 group-hover:opacity-100 transition-opacity absolute right-1"
                onClick={(e) => e.stopPropagation()}
              >
                <Icon name="more" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-30">
              <DropdownMenuItem onClick={() => onStartEdit(variable)}>
                <Icon name="pencil" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onDelete(variable.id)}
              >
                <Icon name="x" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onStartEdit(variable)}>
          <Icon name="pencil" />
          Edit
        </ContextMenuItem>
        <ContextMenuItem
          variant="destructive"
          onClick={() => onDelete(variable.id)}
        >
          <Icon name="x" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

interface ColorVariablesSectionProps {
  colorVariables: import('@/types').ColorVariable[];
  activeVariableId: string | null;
  currentColor: string;
  editState: VarEditState | null;
  onEditStateChange: (state: VarEditState | null) => void;
  onCreate: (name: string, value: string) => Promise<import('@/types').ColorVariable | null>;
  onUpdate: (id: string, data: { name?: string; value?: string }) => Promise<import('@/types').ColorVariable | null>;
  onDelete: (id: string) => Promise<boolean>;
  onReorder: (orderedIds: string[]) => Promise<void>;
  onSelect: (variableId: string) => void;
}

function ColorVariablesSection({
  colorVariables,
  activeVariableId,
  currentColor,
  editState,
  onEditStateChange,
  onCreate,
  onUpdate,
  onDelete,
  onReorder,
  onSelect,
}: ColorVariablesSectionProps) {
  const handleStartCreate = () => {
    onEditStateChange({ mode: 'create', name: '', color: currentColor || '#000000' });
  };

  const handleCreate = async () => {
    if (!editState || editState.mode !== 'create' || !editState.color) return;
    const name = editState.name.trim() || editState.color.split('/')[0];
    const result = await onCreate(name, editState.color);
    if (result) {
      onSelect(result.id);
      onEditStateChange(null);
    }
  };

  const handleStartEdit = (v: import('@/types').ColorVariable) => {
    onEditStateChange({ mode: 'edit', id: v.id, name: v.name, color: v.value });
  };

  const handleSaveEdit = async () => {
    if (!editState || editState.mode !== 'edit' || !editState.id || !editState.color) return;
    const name = editState.name.trim() || editState.color.split('/')[0];
    await onUpdate(editState.id, { name, value: editState.color });
    onEditStateChange(null);
  };

  const handleCancel = () => {
    onEditStateChange(null);
  };

  const handleDelete = async (id: string) => {
    await onDelete(id);
    if (editState?.id === id) onEditStateChange(null);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = colorVariables.findIndex((v) => v.id === active.id);
    const newIndex = colorVariables.findIndex((v) => v.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(colorVariables, oldIndex, newIndex);
    onReorder(reordered.map((v) => v.id));
  };

  const isEditing = editState?.mode === 'edit';
  const isCreating = editState?.mode === 'create';

  const isActiveEdit = isEditing || isCreating;

  return (
    <div>
      <SettingsPanel
        title={isActiveEdit ? '' : 'Color variables'}
        isOpen={true}
        onToggle={() => {}}
        collapsible={false}
        className={cn('pt-2', colorVariables.length === 0 && !isActiveEdit && '-mb-1.5')}
        action={!isActiveEdit ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={handleStartCreate}
          >
            <Icon name="plus" />
          </Button>
        ) : undefined}
      >
        {(isActiveEdit || colorVariables.length > 0) && (
        <div className="-mt-3 -mb-5 flex flex-col">
          {isActiveEdit && editState ? (
            <div className="flex gap-2 pt-1.5 pb-2">
              <Button
                variant="secondary"
                size="sm"
                className="flex-1"
                onClick={handleCancel}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="flex-1"
                onClick={isEditing ? handleSaveEdit : handleCreate}
              >
                {isEditing ? 'Update' : 'Add'}
              </Button>
            </div>
          ) : (
            <div className="max-h-24 overflow-y-auto no-scrollbar pb-2">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={colorVariables.map((v) => v.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {colorVariables.map((v) => (
                    <SortableVariableItem
                      key={v.id}
                      variable={v}
                      isActive={activeVariableId === v.id}
                      onSelect={onSelect}
                      onStartEdit={handleStartEdit}
                      onDelete={handleDelete}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </div>
          )}
        </div>
        )}
      </SettingsPanel>
    </div>
  );
}

// ─── Main ColorPicker Component ─────────────────────────────────────

export default function ColorPicker({
  value,
  onChange,
  onImmediateChange,
  defaultValue = '#ffffff',
  placeholder = '#ffffff',
  solidOnly = false,
  swatchOnly = false,
  onOpenChange: onOpenChangeProp,
  binding,
  onClear,
  imageTab,
  onImageActivate,
  onImageDeactivate,
  imagePreviewUrl,
  imageLabel,
}: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'solid' | 'linear' | 'radial' | 'image'>('solid');

  // Color variables store
  const colorVariables = useColorVariablesStore((s) => s.colorVariables);
  const cvCreate = useColorVariablesStore((s) => s.createColorVariable);
  const cvUpdate = useColorVariablesStore((s) => s.updateColorVariable);
  const cvDelete = useColorVariablesStore((s) => s.deleteColorVariable);
  const cvReorder = useColorVariablesStore((s) => s.reorderColorVariables);
  const setPreviewOverride = useColorVariablesStore((s) => s.setPreviewOverride);
  const [varEditState, setVarEditState] = useState<VarEditState | null>(null);

  // Detect if the current value (or selected gradient stop) is a color variable reference
  const activeVariableId = useMemo(() => {
    if (!value) return null;
    return extractColorVariableId(value);
  }, [value]);

  const activeVariable = useMemo(() => {
    if (!activeVariableId) return null;
    return colorVariables.find((v) => v.id === activeVariableId) ?? null;
  }, [activeVariableId, colorVariables]);

  const displayValue = value || '';
  const isGradient = displayValue.startsWith('linear') || displayValue.startsWith('radial');
  const isTransparent = displayValue === 'transparent';
  const isColorVariable = !!activeVariableId;

  // Format display value for user-friendly names
  const getDisplayText = (val: string, opacity?: number): string => {
    if (val.startsWith('color:var(')) {
      return activeVariable?.name || 'Variable';
    }
    if (val.startsWith('linear-gradient')) return 'Linear';
    if (val.startsWith('radial-gradient')) return 'Radial';
    if (val === 'transparent') return 'Transparent';
    const hex = val.match(/^#[0-9a-fA-F]{6}/)?.[0] || val;
    if (opacity !== undefined && opacity < 1) {
      return `${hex} ${Math.round(opacity * 100)}%`;
    }
    return hex.length > 20 ? hex.substring(0, 20) + '...' : hex;
  };

  // Solid color state
  const [rgbaColor, setRgbaColor] = useState(() => {
    if (!isGradient && displayValue) {
      return parseColor(displayValue);
    }
    return parseColor(defaultValue);
  });

  // Store HSV values separately to prevent drift and instability when adjusting colors
  // This prevents cursor jumping when RGB->HSV conversions are unstable (e.g., near black)
  const [hue, setHue] = useState(() => {
    const initialColor = (!isGradient && displayValue) ? parseColor(displayValue) : parseColor(defaultValue);
    return rgbToHsv(initialColor.r, initialColor.g, initialColor.b).h;
  });

  const [saturation, setSaturation] = useState(() => {
    const initialColor = (!isGradient && displayValue) ? parseColor(displayValue) : parseColor(defaultValue);
    return rgbToHsv(initialColor.r, initialColor.g, initialColor.b).s;
  });

  const [hsvValue, setHsvValue] = useState(() => {
    const initialColor = (!isGradient && displayValue) ? parseColor(displayValue) : parseColor(defaultValue);
    return rgbToHsv(initialColor.r, initialColor.g, initialColor.b).v;
  });

  // Local state for HEX input to allow free typing
  const [hexInputValue, setHexInputValue] = useState(() => {
    if (!isGradient && displayValue) {
      return getHexOnly(displayValue);
    }
    return getHexOnly(defaultValue);
  });

  // Ref to track if color change came from hex input (to prevent sync loop)
  const isHexInputUpdating = useRef(false);

  // Ref to track if color change is internal (to prevent hue recalculation)
  const isInternalUpdate = useRef(false);

  // Sync hex input when rgbaColor changes externally (but not from hex input itself)
  useEffect(() => {
    if (!isGradient && activeTab === 'solid' && !isHexInputUpdating.current) {
      setHexInputValue(getHexOnly(rgbaToHex(rgbaColor)));
    }
    // Reset flag after sync
    isHexInputUpdating.current = false;
  }, [rgbaColor, isGradient, activeTab]);

  // Track tab before entering variable edit mode so we can restore it
  const tabBeforeVarEdit = useRef<'solid' | 'linear' | 'radial' | 'image' | null>(null);
  const stopBeforeVarEdit = useRef<string | null>(null);
  const activeTabRef = useRef(activeTab);
  const selectedStopIdRef = useRef<string | null>(null);

  // Sync picker to variable color when entering edit mode, clear preview on exit
  const prevVarEditId = useRef<string | null>(null);
  useEffect(() => {
    const editKey = varEditState ? (varEditState.id ?? '_create') : null;
    if (editKey && editKey !== prevVarEditId.current && varEditState) {
      tabBeforeVarEdit.current = activeTabRef.current;
      stopBeforeVarEdit.current = selectedStopIdRef.current;
      setActiveTab('solid');
      const colorParts = varEditState.color.split('/');
      const parsed = parseColor(colorParts[0]);
      if (colorParts.length > 1) {
        parsed.a = parseInt(colorParts[1]) / 100;
      }
      setRgbaColor(parsed);
      const hsv = rgbToHsv(parsed.r, parsed.g, parsed.b);
      setHue(hsv.h);
      setSaturation(hsv.s);
      setHsvValue(hsv.v);
      isInternalUpdate.current = true;
    }
    if (!varEditState && tabBeforeVarEdit.current) {
      setActiveTab(tabBeforeVarEdit.current);
      tabBeforeVarEdit.current = null;
      setPreviewOverride(null);
    } else if (!varEditState) {
      setPreviewOverride(null);
    }
    prevVarEditId.current = editKey;
  }, [varEditState, setPreviewOverride]);

  // Gradient state
  const [linearStops, setLinearStops] = useState<ColorStop[]>([
    { id: 'stop-0', color: '#000000', position: 0 },
    { id: 'stop-1', color: '#ffffff', position: 100 },
  ]);
  const [radialStops, setRadialStops] = useState<ColorStop[]>([
    { id: 'stop-0', color: '#000000', position: 0 },
    { id: 'stop-1', color: '#ffffff', position: 100 },
  ]);
  const [linearAngle, setLinearAngle] = useState(0);

  // Track selected stop for gradient editing
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  activeTabRef.current = activeTab;
  selectedStopIdRef.current = selectedStopId;

  // Track dragging state for gradient bar handles
  const [draggingStopId, setDraggingStopId] = useState<string | null>(null);

  // Resolve active variable from gradient stop when on a gradient tab
  const effectiveVariableId = useMemo(() => {
    if ((activeTab === 'linear' || activeTab === 'radial') && selectedStopId) {
      const stops = activeTab === 'linear' ? linearStops : radialStops;
      const stop = stops.find(s => s.id === selectedStopId);
      if (stop?.color.startsWith('var(--')) {
        return stop.color.match(/^var\(--([^)]+)\)$/)?.[1] || null;
      }
      return null;
    }
    return activeVariableId;
  }, [activeTab, selectedStopId, linearStops, radialStops, activeVariableId]);

  // Keep a stable ref to binding so the parse useEffect can sync without re-triggering
  const bindingRef = useRef(binding);
  bindingRef.current = binding;

  // HSV state for selected gradient stop (similar to solid picker)
  const [stopHue, setStopHue] = useState(0);
  const [stopSaturation, setStopSaturation] = useState(0);
  const [stopHsvValue, setStopHsvValue] = useState(0);

  // Ref to track if gradient stop color change is internal (to prevent HSV recalculation)
  const isStopInternalUpdate = useRef(false);

  // Ref to track if gradient value change is internal (to prevent re-parsing)
  const isInternalGradientChange = useRef(false);

  // Sync rgba color when value changes externally (for solid colors)
  useEffect(() => {
    if (!isGradient && displayValue) {
      // Resolve color variable to its hex value for the picker
      const colorToSync = isColorVariable && activeVariable
        ? activeVariable.value
        : displayValue;
      const newColor = parseColor(colorToSync);
      if (isColorVariable && activeVariable) {
        const valParts = activeVariable.value.split('/');
        if (valParts.length > 1) {
          newColor.a = parseInt(valParts[1]) / 100;
        }
      }
      setRgbaColor(newColor);
      // Only update HSV values when color changes externally (not from internal updates)
      if (!isInternalUpdate.current) {
        const hsv = rgbToHsv(newColor.r, newColor.g, newColor.b);
        setHue(hsv.h);
        setSaturation(hsv.s);
        setHsvValue(hsv.v);
      }
    }
    // Reset flag after sync
    isInternalUpdate.current = false;
  }, [displayValue, isGradient, isColorVariable, activeVariable]);

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    onClear?.();
  };

  const hasValue = !!displayValue;

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    onOpenChangeProp?.(newOpen);
    if (newOpen && !hasValue) {
      // Initialize internal color picker state with default (don't push to layer yet)
      const defaultColor = parseColor(defaultValue);
      setRgbaColor(defaultColor);
      const hsv = rgbToHsv(defaultColor.r, defaultColor.g, defaultColor.b);
      setHue(hsv.h);
      setSaturation(hsv.s);
      setHsvValue(hsv.v);
    }
  };

  /** Routes a color value through varEditState (edit/create) or directly to the parent onChange. */
  const commitColorValue = (colorValue: string) => {
    if (varEditState?.mode === 'edit' && varEditState.id) {
      setVarEditState({ ...varEditState, color: colorValue });
      setPreviewOverride({ id: varEditState.id, value: hexToRgba(colorValue) });
    } else {
      immediateOnChange(colorValue);
      if (varEditState?.mode === 'create') {
        setVarEditState({ ...varEditState, color: colorValue });
      }
    }
  };

  // Solid color handlers
  const handleRgbaChange = (color: { r: number; g: number; b: number; a: number }) => {
    setRgbaColor(color);
    isInternalUpdate.current = true;
    commitColorValue(rgbaToHex(color));
  };

  // EyeDropper handler for solid colors
  const handleEyeDropper = async () => {
    // Check if EyeDropper API is supported
    if (!('EyeDropper' in window)) {
      alert('EyeDropper API is not supported in your browser. Try using Chrome, Edge, or Opera.');
      return;
    }

    try {
      // @ts-expect-error - EyeDropper is not in TypeScript types yet
      const eyeDropper = new window.EyeDropper();
      const result = await eyeDropper.open();

      // result.sRGBHex is in format "#rrggbb"
      const pickedColor = result.sRGBHex;

      // Parse the picked color and update
      const parsed = parseColor(pickedColor);
      setRgbaColor(parsed);

      // Update HSV values
      const hsv = rgbToHsv(parsed.r, parsed.g, parsed.b);
      setHue(hsv.h);
      setSaturation(hsv.s);
      setHsvValue(hsv.v);

      // Mark as internal update
      isInternalUpdate.current = true;
      immediateOnChange(rgbaToHex(parsed));
    } catch {
      // User cancelled or error occurred
    }
  };

  // EyeDropper handler for gradient stops
  const handleGradientStopEyeDropper = async (type: 'linear' | 'radial') => {
    if (!selectedStopId) return;

    // Check if EyeDropper API is supported
    if (!('EyeDropper' in window)) {
      alert('EyeDropper API is not supported in your browser. Try using Chrome, Edge, or Opera.');
      return;
    }

    try {
      // @ts-expect-error - EyeDropper is not in TypeScript types yet
      const eyeDropper = new window.EyeDropper();
      const result = await eyeDropper.open();

      // result.sRGBHex is in format "#rrggbb"
      const pickedColor = result.sRGBHex;

      // Parse the picked color
      const parsed = parseColor(pickedColor);

      // Update HSV values for the stop
      const hsv = rgbToHsv(parsed.r, parsed.g, parsed.b);
      setStopHue(hsv.h);
      setStopSaturation(hsv.s);
      setStopHsvValue(hsv.v);

      // Mark as internal update
      isStopInternalUpdate.current = true;

      // Update the selected stop's color (preserve current opacity)
      const currentStop = (type === 'linear' ? linearStops : radialStops).find(s => s.id === selectedStopId);
      if (currentStop) {
        const currentRgba = parseColor(currentStop.color);
        updateColorStop(type, selectedStopId, { color: rgbaToHex({ ...parsed, a: currentRgba.a }) });
      }
    } catch {
      // User cancelled or error occurred
    }
  };

  const handleHexInputChange = (value: string) => {
    // Update local input state immediately for smooth typing
    setHexInputValue(value);

    // Normalize input: remove spaces, ensure # prefix
    let normalized = value.trim().replace(/\s/g, '');

    // If user typed without #, add it
    if (normalized && !normalized.startsWith('#')) {
      normalized = '#' + normalized;
      setHexInputValue(normalized);
    }

    // If it's just # or empty, allow it (user is still typing)
    if (!normalized || normalized === '#') {
      return;
    }

    // Parse the hex input (supports #hex, #hex/opacity, or partial #rrggbbaa)
    // Allow partial values like #ff or #ff00 (user might be typing)
    if (normalized.startsWith('#') && normalized.length > 1) {
      // Extract hex part (up to 6 chars after #)
      const hexMatch = normalized.match(/^#([0-9a-fA-F]{0,6})(?:\/(\d+))?$/);
      if (hexMatch) {
        const hexDigits = hexMatch[1];
        const opacityStr = hexMatch[2];

        // Only update color when we have exactly 6 hex digits (complete hex value)
        // Don't prefill or update with partial values - let user type freely
        if (hexDigits.length === 6 && /^[0-9a-fA-F]+$/.test(hexDigits)) {
          // Mark that we're updating from hex input to prevent sync loop
          isHexInputUpdating.current = true;
          // Mark as internal update (HSV values are explicitly set below)
          isInternalUpdate.current = true;

          const parsed = parseColor(normalized);
          // Preserve current opacity if user only typed hex without opacity
          const finalRgba = opacityStr ? parsed : { ...parsed, a: rgbaColor.a };
          setRgbaColor(finalRgba);
          const hsv = rgbToHsv(finalRgba.r, finalRgba.g, finalRgba.b);
          setHue(hsv.h);
          setSaturation(hsv.s);
          setHsvValue(hsv.v);
          commitColorValue(rgbaToHex(finalRgba));
        }
      }
    }
  };

  const handleHexInputBlur = () => {
    // Mark that we're updating from hex input to prevent sync loop
    isHexInputUpdating.current = true;
    // Mark as internal update (hue is explicitly set below when needed)
    isInternalUpdate.current = true;

    // On blur, normalize the value - ensure it's a valid 6-digit hex
    const current = hexInputValue.trim();
    let normalized = current;

    // Add # if missing
    if (normalized && !normalized.startsWith('#')) {
      normalized = '#' + normalized;
    }

    // Extract hex digits
    const hexMatch = normalized.match(/^#([0-9a-fA-F]*)$/);
    if (hexMatch) {
      const hexDigits = hexMatch[1];

      if (hexDigits.length === 0) {
        // Empty - reset to current color
        setHexInputValue(getHexOnly(rgbaToHex(rgbaColor)));
      } else if (hexDigits.length < 6) {
        // Partial - don't auto-fill, just reset to current color
        // User can type the full hex value if they want
        setHexInputValue(getHexOnly(rgbaToHex(rgbaColor)));
      } else {
        // Valid 6-digit hex, or too long — truncate to 6 digits
        const validHex = '#' + hexDigits.slice(0, 6);
        const parsed = parseColor(validHex);
        const finalRgba = { ...parsed, a: rgbaColor.a };
        setRgbaColor(finalRgba);
        const hsv = rgbToHsv(finalRgba.r, finalRgba.g, finalRgba.b);
        setHue(hsv.h);
        setSaturation(hsv.s);
        setHsvValue(hsv.v);
        setHexInputValue(validHex);
        commitColorValue(rgbaToHex(finalRgba));
      }
    } else {
      // Invalid format - reset to current color
      setHexInputValue(getHexOnly(rgbaToHex(rgbaColor)));
    }
  };

  // Debounced onChange ref to keep it stable across renders
  const debouncedOnChangeRef = useRef(
    debounce((value: string) => {
      onChange(value);
    }, 150)
  );

  // Update the debounced function when onChange changes
  useEffect(() => {
    debouncedOnChangeRef.current = debounce((value: string) => {
      onChange(value);
    }, 150);

    return () => {
      debouncedOnChangeRef.current.cancel();
    };
  }, [onChange]);

  // Immediate onChange — bypasses parent debounce for programmatic changes
  const immediateOnChange = (value: string) => {
    debouncedOnChangeRef.current.cancel();
    (onImmediateChange || onChange)(value);
  };

  // Gradient handlers
  // Format: linear-gradient(180deg,rgba(0,0,0,1)0%,rgba(140,0,0,1)43.31%...)
  // No spaces after commas, no space between color and position
  // Convert colors to rgba format for Tailwind compatibility
  const formatStopColor = useCallback((color: string): string => {
    if (color.startsWith('var(--')) return color;
    return colorToRgbaString(color);
  }, []);

  const resolveStopColor = useCallback((color: string): string => {
    if (color.startsWith('var(--')) {
      const id = color.match(/^var\(--([^)]+)\)$/)?.[1];
      if (id) {
        const cv = colorVariables.find((v) => v.id === id);
        if (cv) return hexToRgba(cv.value);
      }
      return '#888888';
    }
    return color;
  }, [colorVariables]);

  const resolvedDisplayValue = useMemo(() => {
    if (!isGradient || !displayValue) return displayValue;
    return displayValue.replace(/var\(--([^)]+)\)(\d)/g, (_match, id, digit) => {
      const cv = colorVariables.find((v) => v.id === id);
      return `${cv ? hexToRgba(cv.value) : '#888888'} ${digit}`;
    });
  }, [displayValue, isGradient, colorVariables]);

  const handleLinearGradientChange = (angle: number, stops: ColorStop[]) => {
    isInternalGradientChange.current = true;
    binding?.onGradientSync?.('linear', stops.map(s => ({ id: s.id, position: s.position, color: s.color })), angle);
    const stopsStr = stops.map(s => `${formatStopColor(s.color)}${s.position}%`).join(',');
    const gradientValue = `linear-gradient(${angle}deg,${stopsStr})`;
    // Use immediate onChange for gradients to ensure ref is still set when parsing useEffect runs
    immediateOnChange(gradientValue);
  };

  const handleRadialGradientChange = (stops: ColorStop[]) => {
    isInternalGradientChange.current = true;
    binding?.onGradientSync?.('radial', stops.map(s => ({ id: s.id, position: s.position, color: s.color })));
    const stopsStr = stops.map(s => `${formatStopColor(s.color)}${s.position}%`).join(',');
    const gradientValue = `radial-gradient(circle,${stopsStr})`;
    // Use immediate onChange for gradients to ensure ref is still set when parsing useEffect runs
    immediateOnChange(gradientValue);
  };

  // Helper to interpolate color at a specific position on the gradient
  const interpolateColorAtPosition = (stops: ColorStop[], position: number): string => {
    // Sort stops by position
    const sortedStops = [...stops].sort((a, b) => a.position - b.position);

    // If position is before first stop, use first stop's color
    if (position <= sortedStops[0].position) {
      return sortedStops[0].color;
    }

    // If position is after last stop, use last stop's color
    if (position >= sortedStops[sortedStops.length - 1].position) {
      return sortedStops[sortedStops.length - 1].color;
    }

    // Find the two stops that surround the target position
    let leftStop = sortedStops[0];
    let rightStop = sortedStops[sortedStops.length - 1];

    for (let i = 0; i < sortedStops.length - 1; i++) {
      if (sortedStops[i].position <= position && sortedStops[i + 1].position >= position) {
        leftStop = sortedStops[i];
        rightStop = sortedStops[i + 1];
        break;
      }
    }

    // Calculate interpolation factor (0 to 1)
    const factor = (position - leftStop.position) / (rightStop.position - leftStop.position);

    // Parse colors to RGBA
    const leftRgba = parseColor(leftStop.color);
    const rightRgba = parseColor(rightStop.color);

    // Interpolate each channel
    const r = Math.round(leftRgba.r + (rightRgba.r - leftRgba.r) * factor);
    const g = Math.round(leftRgba.g + (rightRgba.g - leftRgba.g) * factor);
    const b = Math.round(leftRgba.b + (rightRgba.b - leftRgba.b) * factor);
    const a = leftRgba.a + (rightRgba.a - leftRgba.a) * factor;

    // Return as hex with opacity
    return rgbaToHex({ r, g, b, a });
  };

  const addColorStop = (type: 'linear' | 'radial', position?: number) => {
    const targetPosition = position ?? 50;
    const currentStops = type === 'linear' ? linearStops : radialStops;

    // Check if a stop already exists at this position (within 2% tolerance)
    const existingStop = currentStops.find(stop => Math.abs(stop.position - targetPosition) < 2);
    if (existingStop) {
      // Select the existing stop instead of adding a duplicate
      setSelectedStopId(existingStop.id);
      return;
    }

    // Interpolate color at the target position
    const interpolatedColor = interpolateColorAtPosition(currentStops, targetPosition);

    const newStop: ColorStop = {
      id: `stop-${Date.now()}`,
      color: interpolatedColor,
      position: targetPosition,
    };

    // Initialize HSV state for the new stop immediately
    const rgba = parseColor(newStop.color);
    const hsv = rgbToHsv(rgba.r, rgba.g, rgba.b);
    setStopHue(hsv.h);
    setStopSaturation(hsv.s);
    setStopHsvValue(hsv.v);

    // Mark as internal update to prevent HSV recalculation
    isStopInternalUpdate.current = true;

    if (type === 'linear') {
      const newStops = [...linearStops, newStop].sort((a, b) => a.position - b.position);
      setLinearStops(newStops);
      // Select immediately - this is the key action we want
      setSelectedStopId(newStop.id);
      handleLinearGradientChange(linearAngle, newStops);
    } else {
      const newStops = [...radialStops, newStop].sort((a, b) => a.position - b.position);
      setRadialStops(newStops);
      // Select immediately - this is the key action we want
      setSelectedStopId(newStop.id);
      handleRadialGradientChange(newStops);
    }
  };

  const removeColorStop = (type: 'linear' | 'radial', id: string) => {
    if (type === 'linear') {
      if (linearStops.length <= 2) return;
      const newStops = linearStops.filter(s => s.id !== id);
      setLinearStops(newStops);

      // If the deleted stop was selected, select another one
      if (selectedStopId === id) {
        // Prefer selecting the next stop, or the first one if it was the last
        const deletedIndex = linearStops.findIndex(s => s.id === id);
        const nextStop = newStops[deletedIndex] || newStops[deletedIndex - 1] || newStops[0];
        setSelectedStopId(nextStop.id);
      }

      handleLinearGradientChange(linearAngle, newStops);
    } else {
      if (radialStops.length <= 2) return;
      const newStops = radialStops.filter(s => s.id !== id);
      setRadialStops(newStops);

      // If the deleted stop was selected, select another one
      if (selectedStopId === id) {
        const deletedIndex = radialStops.findIndex(s => s.id === id);
        const nextStop = newStops[deletedIndex] || newStops[deletedIndex - 1] || newStops[0];
        setSelectedStopId(nextStop.id);
      }

      handleRadialGradientChange(newStops);
    }
  };

  const updateColorStop = (type: 'linear' | 'radial', id: string, updates: Partial<ColorStop>) => {
    if (type === 'linear') {
      const newStops = linearStops.map(s => s.id === id ? { ...s, ...updates } : s).sort((a, b) => a.position - b.position);
      setLinearStops(newStops);
      handleLinearGradientChange(linearAngle, newStops);
    } else {
      const newStops = radialStops.map(s => s.id === id ? { ...s, ...updates } : s).sort((a, b) => a.position - b.position);
      setRadialStops(newStops);
      handleRadialGradientChange(newStops);
    }
  };

  const handleTabChange = (value: string) => {
    const newTab = value as 'solid' | 'linear' | 'radial' | 'image';
    const previousTab = activeTab;

    setActiveTab(newTab);
    setSelectedStopId(null);

    if (newTab === 'image') {
      onImageActivate?.();
      return;
    }

    if (previousTab === 'image') {
      const solidColor = rgbaToHex(rgbaColor);
      onImageDeactivate?.(solidColor);
      return;
    }

    if (newTab === 'solid') {
      immediateOnChange(rgbaToHex(rgbaColor));
      if (previousTab === 'linear' || previousTab === 'radial') {
        binding?.onSwitchToSolid?.();
      }
    } else if (newTab === 'linear') {
      handleLinearGradientChange(linearAngle, linearStops);
      if (linearStops.length > 0) {
        setSelectedStopId(linearStops[0].id);
      }
    } else if (newTab === 'radial') {
      handleRadialGradientChange(radialStops);
      if (radialStops.length > 0) {
        setSelectedStopId(radialStops[0].id);
      }
    }
  };

  // Handle keyboard events for delete key in gradient mode
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Only handle Delete/Backspace when in gradient mode and a stop is selected
    if ((e.key === 'Delete' || e.key === 'Backspace') && (activeTab === 'linear' || activeTab === 'radial')) {
      if (selectedStopId) {
        // Check if we're in an input field (don't delete stop if user is typing)
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return; // Let the input handle the delete
        }

        e.preventDefault();
        e.stopPropagation(); // Prevent it from reaching LayersTree

        // Remove the selected stop (if there are more than 2)
        if (activeTab === 'linear') {
          removeColorStop('linear', selectedStopId);
        } else {
          removeColorStop('radial', selectedStopId);
        }
      }
    }
  };

  // Parse gradient on mount/change
  // Format: linear-gradient(180deg,rgba(0,0,0,1)0%,rgba(140,0,0,1)43.31%...)
  // No spaces after commas, no space between color and position
  useEffect(() => {
    // Skip parsing if this is an internal gradient change (adding/moving/editing stops)
    if (isInternalGradientChange.current) {
      isInternalGradientChange.current = false;
      return;
    }

    if (displayValue.startsWith('linear-gradient')) {
      // Match: linear-gradient(angle deg,color1position1%,color2position2%,...)
      // Allow optional spaces for compatibility but prefer no spaces
      const match = displayValue.match(/linear-gradient\((\d+)deg\s*,\s*(.+)\)/);
      if (match) {
        setActiveTab('linear');
        const angle = parseInt(match[1]);
        const stopsStr = match[2];
        // Parse stops: rgba(...)position% or var(--...)position% or #hexposition% or namedposition%
        const stopPattern = /(var\(--[^)]+\)|rgba?\([^)]+\)|#[0-9a-fA-F]+|\w+)([\d.]+)%/g;
        const stops: ColorStop[] = [];
        let matchResult;
        let idx = 0;
        while ((matchResult = stopPattern.exec(stopsStr)) !== null) {
          stops.push({
            id: `linear-stop-${idx}`,
            color: matchResult[1],
            position: parseFloat(matchResult[2]),
          });
          idx++;
        }
        if (stops.length > 0) {
          setLinearAngle(angle);
          setLinearStops(stops);
          bindingRef.current?.onGradientSync?.('linear', stops.map(s => ({ id: s.id, position: s.position, color: s.color })), angle);
          setSelectedStopId(prev => (prev && stops.some(s => s.id === prev)) ? prev : stops[0].id);
        }
      }
    } else if (displayValue.startsWith('radial-gradient')) {
      const match = displayValue.match(/radial-gradient\(circle\s*,\s*(.+)\)/);
      if (match) {
        setActiveTab('radial');
        const stopsStr = match[1];
        const stopPattern = /(var\(--[^)]+\)|rgba?\([^)]+\)|#[0-9a-fA-F]+|\w+)([\d.]+)%/g;
        const stops: ColorStop[] = [];
        let matchResult;
        let idx = 0;
        while ((matchResult = stopPattern.exec(stopsStr)) !== null) {
          stops.push({
            id: `radial-stop-${idx}`,
            color: matchResult[1],
            position: parseFloat(matchResult[2]),
          });
          idx++;
        }
        if (stops.length > 0) {
          setRadialStops(stops);
          // Sync parsed stops with binding layer so stop IDs stay consistent
          bindingRef.current?.onGradientSync?.('radial', stops.map(s => ({ id: s.id, position: s.position, color: s.color })));
          // Select the first stop if none is selected
          setSelectedStopId(prev => (prev && stops.some(s => s.id === prev)) ? prev : stops[0].id);
        }
      }
    }

  }, [displayValue]);

  // Sync HSV state when stop is selected or stop color changes externally
  useEffect(() => {
    if (!selectedStopId) return;

    const allStops = activeTab === 'linear' ? linearStops : radialStops;
    const selectedStop = allStops.find(s => s.id === selectedStopId);
    if (!selectedStop) return;

    // Only update HSV values when color changes externally (not from internal updates)
    // Reset flag first to ensure clean state for next update
    const wasInternalUpdate = isStopInternalUpdate.current;
    isStopInternalUpdate.current = false;

    if (!wasInternalUpdate) {
      const rgba = parseColor(selectedStop.color);
      const hsv = rgbToHsv(rgba.r, rgba.g, rgba.b);
      // Preserve hue and saturation when value is 0 (black)
      // This prevents hue/saturation from jumping when dragging to black
      // When value is 0, saturation is meaningless (all blacks look the same)
      if (hsv.v === 0) {
        // Keep current hue and saturation, only update value
        setStopHsvValue(hsv.v);
      } else if (hsv.s === 0) {
        // Preserve hue when saturation is 0 (white/gray), update saturation and value
        setStopSaturation(hsv.s);
        setStopHsvValue(hsv.v);
      } else {
        // Update all HSV values when there's actual color information
        setStopHue(hsv.h);
        setStopSaturation(hsv.s);
        setStopHsvValue(hsv.v);
      }
    }
  }, [selectedStopId, linearStops, radialStops, activeTab]);

  // Ensure at least one stop is always selected when in gradient mode
  // Only runs when there's NO selection or the selected stop doesn't exist
  useEffect(() => {
    if (activeTab === 'linear' && linearStops.length > 0) {
      // Only select if no stop is selected or selected stop doesn't exist
      if (!selectedStopId || !linearStops.some(s => s.id === selectedStopId)) {
        setSelectedStopId(linearStops[0].id);
      }
    } else if (activeTab === 'radial' && radialStops.length > 0) {
      // Only select if no stop is selected or selected stop doesn't exist
      if (!selectedStopId || !radialStops.some(s => s.id === selectedStopId)) {
        setSelectedStopId(radialStops[0].id);
      }
    }
  }, [activeTab, linearStops, radialStops, selectedStopId]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
      {swatchOnly ? (
        <button
          type="button"
          className="size-7 rounded-md bg-input hover:bg-input/60 cursor-pointer flex items-center justify-center"
          aria-label="Pick color"
        >
          <div className="size-5 rounded-[6px] shrink-0 relative overflow-hidden outline dark:outline-white/10 -outline-offset-1">
            {(hasValue || imagePreviewUrl) ? (
              imagePreviewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imagePreviewUrl}
                  className="absolute inset-0 w-full h-full object-cover z-20"
                  alt=""
                />
              ) : (
                <div className="absolute inset-0 z-20" style={isTransparent ? undefined : { background: isColorVariable && activeVariable ? hexToRgba(activeVariable.value) : isGradient ? resolvedDisplayValue : `rgba(${Math.round(rgbaColor.r)},${Math.round(rgbaColor.g)},${Math.round(rgbaColor.b)},${rgbaColor.a})` }} />
              )
            ) : null}
            <div className="absolute inset-0 opacity-15 bg-checkerboard bg-background z-10" />
          </div>
        </button>
      ) : hasValue || imagePreviewUrl ? (
        <div className="flex items-center justify-start h-8 rounded-lg bg-input hover:bg-input/60 px-2.5 cursor-pointer">
          <div className={cn('size-5 rounded-[6px] shrink-0 mr-2 -ml-1 relative overflow-hidden outline dark:outline-white/10 -outline-offset-1', (isTransparent || imagePreviewUrl || isColorVariable) && 'overflow-hidden')}>
            {imagePreviewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imagePreviewUrl}
                className="absolute inset-0 w-full h-full object-cover z-20"
                alt=""
              />
            ) : (
              <div className="absolute inset-0 z-20" style={isTransparent ? undefined : { background: isColorVariable && activeVariable ? hexToRgba(activeVariable.value) : isGradient ? resolvedDisplayValue : `rgba(${Math.round(rgbaColor.r)},${Math.round(rgbaColor.g)},${Math.round(rgbaColor.b)},${rgbaColor.a})` }} />
            )}
            <div className="absolute inset-0 opacity-15 bg-checkerboard bg-background z-10" />
          </div>
          <Label variant="muted" className="truncate max-w-30 cursor-pointer">
            {imagePreviewUrl ? (imageLabel || 'Image') : getDisplayText(displayValue, rgbaColor.a)}
          </Label>
          <button
            type="button"
            className="ml-auto -mr-0.5 p-0.5 rounded-sm opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
            onClick={handleClear}
          >
            <Icon name="x" className="size-2.5" />
          </button>
        </div>
      ) : (
          <Button
            variant="input" size="sm"
            className="justify-start"
          >
            <div className="size-5 rounded-[6px] shrink-0 -ml-1 relative overflow-hidden outline outline-current/10 -outline-offset-1">
              <div className="absolute inset-0 opacity-15 bg-checkerboard bg-background z-10" />
            </div>
            <span className="dark:opacity-50">{placeholder && !placeholder.startsWith('#') ? placeholder : 'Add...'}</span>
          </Button>
      )}
      </PopoverTrigger>

      {/* Overlay backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setOpen(false)}
        />
      )}

      <PopoverContent
        className={cn('w-56 p-2 relative z-50', activeTab !== 'image' && 'pb-0')}
        align="end"
        collisionPadding={16}
        onKeyDown={handleKeyDown}
      >
        <Tabs
          value={activeTab} onValueChange={handleTabChange}
          className="gap-3!"
        >
          {varEditState ? (
            <Input
              value={varEditState.name}
              onChange={(e) => setVarEditState({ ...varEditState, name: e.target.value })}
              placeholder="Variable name"
              className="h-8 text-xs"
              autoFocus
              onKeyDown={async (e) => {
                if (e.key === 'Escape') setVarEditState(null);
                if (e.key === 'Enter' && varEditState?.color) {
                  e.preventDefault();
                  const name = varEditState.name.trim() || varEditState.color.split('/')[0];
                  if (varEditState.mode === 'edit' && varEditState.id) {
                    await cvUpdate(varEditState.id, { name, value: varEditState.color });
                    setVarEditState(null);
                  } else if (varEditState.mode === 'create') {
                    const result = await cvCreate(name, varEditState.color);
                    if (result) {
                      const tab = tabBeforeVarEdit.current || activeTab;
                      const stop = stopBeforeVarEdit.current || selectedStopId;
                      if ((tab === 'linear' || tab === 'radial') && stop) {
                        updateColorStop(tab, stop, { color: `var(--${result.id})` });
                      } else {
                        immediateOnChange(`color:var(--${result.id})`);
                      }
                    }
                    setVarEditState(null);
                  }
                }
              }}
            />
          ) : !solidOnly && (
            <TabsList className="w-full">
              <TabsTrigger value="solid">
                <Icon name="color" />
              </TabsTrigger>
              <TabsTrigger value="linear">
                <Icon name="linear" />
              </TabsTrigger>
              <TabsTrigger value="radial">
                <Icon name="radial" />
              </TabsTrigger>
              {imageTab && (
                <TabsTrigger value="image">
                  <Icon name="image" />
                </TabsTrigger>
              )}
            </TabsList>
          )}

          <TabsContent value="solid" className="gap-3">
            <div className="flex flex-col gap-3">
              {/* Saturation/Value Picker (HSV color space) */}
              <div className="w-full relative aspect-4/3">
                <SaturationLightnessPicker
                  hue={hue}
                  saturation={saturation}
                  value={hsvValue}
                  onChange={(s, v) => {
                    // Update stored saturation and value
                    setSaturation(s);
                    setHsvValue(v);
                    // Convert HSV to RGB using stored hue
                    const rgb = hsvToRgb(hue, s, v);
                    handleRgbaChange({ ...rgb, a: rgbaColor.a });
                  }}
                />
              </div>

              {/* HUE Bar */}
              <HueBar
                hue={hue}
                onChange={(newHue) => {
                  // Update stored hue
                  setHue(newHue);
                  // Use stored saturation and value
                  const rgb = hsvToRgb(newHue, saturation, hsvValue);
                  handleRgbaChange({ ...rgb, a: rgbaColor.a });
                }}
              />

              {/* Opacity Bar */}
              <OpacityBar
                opacity={rgbaColor.a}
                color={{ r: rgbaColor.r, g: rgbaColor.g, b: rgbaColor.b }}
                onChange={(a) => {
                  handleRgbaChange({ ...rgbaColor, a });
                }}
              />

              {(() => {
                const solidBinding = binding?.getBinding(null);
                return solidBinding?.isBound ? (
                  <BoundFieldPill
                    label={solidBinding.fieldName || 'Color field'}
                    onUnbind={() => binding?.onUnbind(null)}
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <InputGroup className="flex-1">
                      <InputGroupInput
                        type="text"
                        value={hexInputValue}
                        onChange={(e) => handleHexInputChange(e.target.value)}
                        onBlur={handleHexInputBlur}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.currentTarget.blur();
                          }
                        }}
                        placeholder={placeholder}
                      />
                      <InputGroupAddon align="inline-end">
                        <Button
                          variant="input"
                          size="xs"
                          onClick={handleEyeDropper}
                          type="button"
                        >
                          <Icon name="eyedrop" />
                        </Button>
                      </InputGroupAddon>
                    </InputGroup>
                    <OpacityPercentInput
                      value={rgbaColor.a}
                      onChange={(a) => handleRgbaChange({ ...rgbaColor, a })}
                      className="w-16 text-xs"
                    />
                    {binding?.hasColorFields && (
                      <ColorPickerFieldBinding binding={binding} stopId={null} />
                    )}
                  </div>
                );
              })()}
            </div>
          </TabsContent>

          <TabsContent value="linear" className="gap-3">
            <div className="flex flex-col gap-3">
              {/* Gradient Bar with Draggable Handles */}
              <GradientBar
                stops={linearStops}
                selectedStopId={selectedStopId}
                onStopSelect={setSelectedStopId}
                onStopMove={(stopId, position) => {
                  updateColorStop('linear', stopId, { position });
                }}
                onAddStop={(position) => addColorStop('linear', position)}
                onRemoveStop={(stopId) => removeColorStop('linear', stopId)}
                onRotate={() => {
                  const newAngle = (linearAngle + 45) % 360;
                  setLinearAngle(newAngle);
                  handleLinearGradientChange(newAngle, linearStops);
                }}
                gradientType="linear"
                angle={linearAngle}
                resolveColor={resolveStopColor}
              />

              {/* Color Picker for Selected Stop */}
              {selectedStopId && (() => {
                const selectedStop = linearStops.find(s => s.id === selectedStopId);
                if (!selectedStop) return null;
                const stopRgba = parseColor(selectedStop.color);
                return (
                  <div className="flex flex-col gap-3">
                    {/* Saturation/Value Picker (HSV) */}
                    <div className="w-full relative aspect-4/3">
                      <SaturationLightnessPicker
                        hue={stopHue}
                        saturation={stopSaturation}
                        value={stopHsvValue}
                        onChange={(s, v) => {
                          // Update stored saturation and value
                          setStopSaturation(s);
                          setStopHsvValue(v);
                          // Mark as internal update to prevent HSV recalculation in useEffect
                          isStopInternalUpdate.current = true;
                          // Convert HSV to RGB using stored hue
                          const rgb = hsvToRgb(stopHue, s, v);
                          updateColorStop('linear', selectedStopId, { color: rgbaToHex({ ...rgb, a: stopRgba.a }) });
                        }}
                      />
                    </div>

                    {/* HUE Bar */}
                    <HueBar
                      hue={stopHue}
                      onChange={(newHue) => {
                        // Update stored hue
                        setStopHue(newHue);
                        // Mark as internal update to prevent HSV recalculation in useEffect
                        isStopInternalUpdate.current = true;
                        // Convert HSV to RGB using stored saturation and value
                        const rgb = hsvToRgb(newHue, stopSaturation, stopHsvValue);
                        updateColorStop('linear', selectedStopId, { color: rgbaToHex({ ...rgb, a: stopRgba.a }) });
                      }}
                    />

                    {/* Opacity Bar */}
                    <OpacityBar
                      opacity={stopRgba.a}
                      color={{ r: stopRgba.r, g: stopRgba.g, b: stopRgba.b }}
                      onChange={(a) => {
                        updateColorStop('linear', selectedStopId, { color: rgbaToHex({ ...stopRgba, a }) });
                      }}
                    />

                    {(() => {
                      const stopBinding = binding?.getBinding(selectedStopId);
                      return stopBinding?.isBound ? (
                        <BoundFieldPill
                          label={stopBinding.fieldName || 'Color field'}
                          onUnbind={() => binding?.onUnbind(selectedStopId)}
                        />
                      ) : (
                        <div className="flex items-center gap-2">
                          <InputGroup className="flex-1">
                            <InputGroupInput
                              type="text"
                              value={getHexOnly(rgbaToHex(stopRgba))}
                              onChange={(e) => {
                                const parsed = parseColor(e.target.value);
                                const finalRgba = e.target.value.includes('/') ? parsed : { ...parsed, a: stopRgba.a };
                                isStopInternalUpdate.current = true;
                                const hsv = rgbToHsv(finalRgba.r, finalRgba.g, finalRgba.b);
                                setStopHue(hsv.h);
                                setStopSaturation(hsv.s);
                                setStopHsvValue(hsv.v);
                                updateColorStop('linear', selectedStopId, { color: rgbaToHex(finalRgba) });
                              }}
                              placeholder="#000000"
                            />
                            <InputGroupAddon align="inline-end">
                              <Button
                                variant="input"
                                size="xs"
                                onClick={() => handleGradientStopEyeDropper('linear')}
                                type="button"
                              >
                                <Icon name="eyedrop" />
                              </Button>
                            </InputGroupAddon>
                          </InputGroup>
                          <OpacityPercentInput
                            value={stopRgba.a}
                            onChange={(a) => {
                              const newRgba = { ...stopRgba, a };
                              updateColorStop('linear', selectedStopId, { color: rgbaToHex(newRgba) });
                            }}
                          />
                          {binding?.hasColorFields && (
                            <ColorPickerFieldBinding binding={binding} stopId={selectedStopId} />
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}
            </div>
          </TabsContent>

          <TabsContent value="radial" className="gap-3">
            <div className="flex flex-col gap-3">
              {/* Gradient Bar with Draggable Handles */}
              <GradientBar
                stops={radialStops}
                selectedStopId={selectedStopId}
                onStopSelect={setSelectedStopId}
                onStopMove={(stopId, position) => {
                  updateColorStop('radial', stopId, { position });
                }}
                onAddStop={(position) => addColorStop('radial', position)}
                onRemoveStop={(stopId) => removeColorStop('radial', stopId)}
                gradientType="radial"
                resolveColor={resolveStopColor}
              />

              {/* Color Picker for Selected Stop */}
              {selectedStopId && (() => {
                const selectedStop = radialStops.find(s => s.id === selectedStopId);
                if (!selectedStop) return null;
                const stopRgba = parseColor(selectedStop.color);
                return (
                  <div className="flex flex-col gap-3">
                    {/* Saturation/Value Picker (HSV) */}
                    <div className="w-full relative aspect-4/3">
                      <SaturationLightnessPicker
                        hue={stopHue}
                        saturation={stopSaturation}
                        value={stopHsvValue}
                        onChange={(s, v) => {
                          // Update stored saturation and value
                          setStopSaturation(s);
                          setStopHsvValue(v);
                          // Mark as internal update to prevent HSV recalculation in useEffect
                          isStopInternalUpdate.current = true;
                          // Convert HSV to RGB using stored hue
                          const rgb = hsvToRgb(stopHue, s, v);
                          updateColorStop('radial', selectedStopId, { color: rgbaToHex({ ...rgb, a: stopRgba.a }) });
                        }}
                      />
                    </div>

                    {/* HUE Bar */}
                    <HueBar
                      hue={stopHue}
                      onChange={(newHue) => {
                        // Update stored hue
                        setStopHue(newHue);
                        // Mark as internal update to prevent HSV recalculation in useEffect
                        isStopInternalUpdate.current = true;
                        // Convert HSV to RGB using stored saturation and value
                        const rgb = hsvToRgb(newHue, stopSaturation, stopHsvValue);
                        updateColorStop('radial', selectedStopId, { color: rgbaToHex({ ...rgb, a: stopRgba.a }) });
                      }}
                    />

                    {/* Opacity Bar */}
                    <OpacityBar
                      opacity={stopRgba.a}
                      color={{ r: stopRgba.r, g: stopRgba.g, b: stopRgba.b }}
                      onChange={(a) => {
                        updateColorStop('radial', selectedStopId, { color: rgbaToHex({ ...stopRgba, a }) });
                      }}
                    />

                    {(() => {
                      const stopBinding = binding?.getBinding(selectedStopId);
                      return stopBinding?.isBound ? (
                        <BoundFieldPill
                          label={stopBinding.fieldName || 'Color field'}
                          onUnbind={() => binding?.onUnbind(selectedStopId)}
                        />
                      ) : (
                        <div className="flex items-center gap-2">
                          <InputGroup className="flex-1">
                            <InputGroupInput
                              type="text"
                              value={getHexOnly(rgbaToHex(stopRgba))}
                              onChange={(e) => {
                                const parsed = parseColor(e.target.value);
                                const finalRgba = e.target.value.includes('/') ? parsed : { ...parsed, a: stopRgba.a };
                                isStopInternalUpdate.current = true;
                                const hsv = rgbToHsv(finalRgba.r, finalRgba.g, finalRgba.b);
                                setStopHue(hsv.h);
                                setStopSaturation(hsv.s);
                                setStopHsvValue(hsv.v);
                                updateColorStop('radial', selectedStopId, { color: rgbaToHex(finalRgba) });
                              }}
                              placeholder="#000000"
                            />
                            <InputGroupAddon align="inline-end">
                              <Button
                                variant="input"
                                size="xs"
                                onClick={() => handleGradientStopEyeDropper('radial')}
                                type="button"
                              >
                                <Icon name="eyedrop" />
                              </Button>
                            </InputGroupAddon>
                          </InputGroup>
                          <OpacityPercentInput
                            value={stopRgba.a}
                            onChange={(a) => {
                              const newRgba = { ...stopRgba, a };
                              updateColorStop('radial', selectedStopId, { color: rgbaToHex(newRgba) });
                            }}
                            className="w-16 text-xs"
                          />
                          {binding?.hasColorFields && (
                            <ColorPickerFieldBinding binding={binding} stopId={selectedStopId} />
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}
            </div>
          </TabsContent>

          {imageTab && (
            <TabsContent
              value="image" className="gap-3"
              forceMount
            >
              {imageTab}
            </TabsContent>
          )}

        </Tabs>

        {activeTab !== 'image' && (
        <>
        <Separator className="my-2" />

        <ColorVariablesSection
          colorVariables={colorVariables}
          activeVariableId={effectiveVariableId}
          currentColor={(() => {
            if ((activeTab === 'linear' || activeTab === 'radial') && selectedStopId) {
              const stops = activeTab === 'linear' ? linearStops : radialStops;
              const stop = stops.find(s => s.id === selectedStopId);
              if (stop) {
                const resolved = stop.color.startsWith('var(--') ? resolveStopColor(stop.color) : stop.color;
                return resolved;
              }
            }
            return rgbaToHex(rgbaColor);
          })()}
          editState={varEditState}
          onEditStateChange={setVarEditState}
          onCreate={cvCreate}
          onUpdate={cvUpdate}
          onDelete={cvDelete}
          onReorder={cvReorder}
          onSelect={(varId) => {
            const tab = tabBeforeVarEdit.current || activeTab;
            const stop = stopBeforeVarEdit.current || selectedStopId;
            if ((tab === 'linear' || tab === 'radial') && stop) {
              updateColorStop(tab, stop, { color: `var(--${varId})` });
            } else {
              immediateOnChange(`color:var(--${varId})`);
            }
          }}
        />
        </>
        )}

      </PopoverContent>
    </Popover>
  );
}
