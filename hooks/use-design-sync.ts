/**
 * Design Sync Hook
 *
 * Manages bidirectional sync between layer.design object and Tailwind classes
 * Supports breakpoint-aware class application for responsive design
 */

import { useCallback, useMemo, useRef, useEffect } from 'react';
import debounce from 'lodash.debounce';
import type { Layer, UIState, Breakpoint } from '@/types';
import {
  propertyToClass,
  replaceConflictingClasses,
  designToClasses,
  setBreakpointClass,
  getInheritedValue,
  getConflictingClassPattern,
  extractBgImgVarName,
} from '@/lib/tailwind-class-mapper';
import { updateStyledLayer } from '@/lib/layer-style-utils';
import { useCanvasTextEditorStore } from '@/stores/useCanvasTextEditorStore';
import { DEFAULT_TEXT_STYLES, getTextStyle } from '@/lib/text-format-utils';

interface UseDesignSyncProps {
  layer: Layer | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
  activeBreakpoint?: Breakpoint; // Optional for backward compatibility
  activeUIState?: UIState; // Optional UI state for state-specific styling
  activeTextStyleKey?: string | null; // Optional text style key for editing text style design
}

export function useDesignSync({
  layer,
  onLayerUpdate,
  activeBreakpoint = 'desktop',
  activeUIState = 'neutral',
  activeTextStyleKey = null
}: UseDesignSyncProps) {
  // Determine if we're editing a text style or the layer itself
  const isTextStyleMode = !!activeTextStyleKey;

  // Optimistic layer ref: always holds the latest known layer state.
  // Updated during render AND immediately after store updates so that
  // subsequent debounced calls never read a stale closure.
  const layerRef = useRef(layer);
  layerRef.current = layer;

  // Get the current design and classes source (layer or text style)
  // Falls back to DEFAULT_TEXT_STYLES when layer doesn't have custom text styles
  const getDesignSource = useCallback(() => {
    if (!layer) return { design: undefined, classes: '' };

    if (isTextStyleMode && activeTextStyleKey) {
      const textStyle = getTextStyle(layer.textStyles, activeTextStyleKey);
      return {
        design: textStyle?.design,
        classes: textStyle?.classes || '',
      };
    }

    return {
      design: layer.design,
      classes: Array.isArray(layer.classes) ? layer.classes.join(' ') : (layer.classes || ''),
    };
  }, [layer, isTextStyleMode, activeTextStyleKey]);
  // Get text editor state for auto-applying dynamicStyle mark
  const isTextEditing = useCanvasTextEditorStore((state) => state.isEditing);
  const ensureDynamicStyleApplied = useCanvasTextEditorStore((state) => state.ensureDynamicStyleApplied);
  const hasTextSelection = useCanvasTextEditorStore((state) => state.hasTextSelection);

  /**
   * Update a single design property and sync to classes
   * Applies breakpoint-aware class prefixes based on active viewport
   * Supports text style mode (updates layer.textStyles[key] instead of layer)
   * Auto-applies dynamicStyle mark when editing text with selection
   */
  const updateDesignProperty = useCallback(
    (
      category: keyof NonNullable<Layer['design']>,
      property: string,
      value: string | null
    ) => {
      // Read from the optimistic ref so debounced calls always see the
      // most recent layer state, even if React hasn't re-rendered yet
      const currentLayer = layerRef.current;
      if (!currentLayer) return;

      // Auto-apply dynamicStyle mark when editing text
      // - If there's a selection: ALWAYS create a new style (enables stacking)
      // - If no selection but cursor in styled text: edit the existing style
      let effectiveTextStyleKey = activeTextStyleKey;
      if (isTextEditing) {
        const hasSelection = hasTextSelection();
        if (hasSelection) {
          // Selection exists: create new style (stacks on top of existing)
          const appliedKey = ensureDynamicStyleApplied();
          if (appliedKey) {
            effectiveTextStyleKey = appliedKey;
          }
        } else if (!activeTextStyleKey) {
          // No selection, no active style: create new style for cursor position
          const appliedKey = ensureDynamicStyleApplied();
          if (appliedKey) {
            effectiveTextStyleKey = appliedKey;
          }
        }
        // If no selection but activeTextStyleKey exists, we edit that style
      }

      // Determine if we're in text style mode
      const effectiveIsTextStyleMode = !!effectiveTextStyleKey;

      // Text Style Mode: Update layer.textStyles[key]
      // Initialize with DEFAULT_TEXT_STYLES if layer doesn't have textStyles yet
      if (effectiveIsTextStyleMode && effectiveTextStyleKey) {
        const currentTextStyles = currentLayer.textStyles ?? { ...DEFAULT_TEXT_STYLES };
        const currentTextStyle = currentTextStyles[effectiveTextStyleKey] || {};
        const currentDesign = currentTextStyle.design || {};
        const categoryData = currentDesign[category] || {};

        const updatedDesign = {
          ...currentDesign,
          [category]: {
            ...categoryData,
            [property]: value,
            isActive: true,
          },
        };

        if (!value) {
          delete updatedDesign[category]![property as keyof typeof categoryData];
        }

        // Update classes within the text style
        const newClass = value ? propertyToClass(category, property, value) : null;
        const existingClasses = (currentTextStyle.classes || '').split(' ').filter(Boolean);
        const updatedClasses = setBreakpointClass(
          existingClasses,
          property,
          newClass,
          activeBreakpoint,
          activeUIState
        );

        const updatedTextStyle: Record<string, unknown> = {
          ...currentTextStyle,
          design: updatedDesign,
          classes: updatedClasses.join(' '),
        };

        // Track overrides when a layer style is applied to this text style
        if (currentTextStyle.styleId) {
          updatedTextStyle.styleOverrides = {
            classes: updatedClasses.join(' '),
            design: updatedDesign,
          };
        }

        const textStylesUpdate = {
          ...currentTextStyles,
          [effectiveTextStyleKey]: updatedTextStyle,
        };

        // Optimistically update the ref so the next call sees this change
        layerRef.current = { ...currentLayer, textStyles: textStylesUpdate };

        onLayerUpdate(currentLayer.id, { textStyles: textStylesUpdate });
        return;
      }

      // Normal Mode: Update layer directly
      const currentDesign = currentLayer.design || {};
      const categoryData = currentDesign[category] || {};

      const updatedDesign = {
        ...currentDesign,
        [category]: {
          ...categoryData,
          [property]: value,
          isActive: true, // Mark category as active
        },
      };

      // Remove property if value is null/empty
      if (!value) {
        delete updatedDesign[category]![property as keyof typeof categoryData];
      }

      // 2. Convert to Tailwind class
      const newClass = value ? propertyToClass(category, property, value) : null;

      // 3. Get existing classes as array
      const existingClasses = Array.isArray(currentLayer.classes)
        ? currentLayer.classes
        : (currentLayer.classes || '').split(' ').filter(Boolean);

      // 4. Apply breakpoint-aware class replacement with UI state support
      // Uses setBreakpointClass which applies correct prefix (desktop → '', tablet → 'max-lg:', mobile → 'max-md:')
      // and state prefix (neutral → '', hover → 'hover:', etc.)
      const updatedClasses = setBreakpointClass(
        existingClasses,
        property,
        newClass,
        activeBreakpoint,
        activeUIState
      );

      // 5. Update layer with both design object and classes
      // If layer has a style applied, track changes as overrides
      // Note: Use join instead of cn() because setBreakpointClass already handles
      // property-aware conflict resolution
      const styledLayer = updateStyledLayer(currentLayer, {
        design: updatedDesign,
        classes: updatedClasses.join(' '),
      });

      // Only send changed fields — NOT the full layer object. Sending a full layer
      // would overwrite concurrent updates (e.g. variables set by onGradientSync)
      // because updateStyledLayer spreads the stale closure's `layer`.
      const finalUpdate: Partial<Layer> = {
        design: styledLayer.design,
        classes: styledLayer.classes,
      };
      if (styledLayer.styleOverrides !== currentLayer.styleOverrides) {
        finalUpdate.styleOverrides = styledLayer.styleOverrides;
      }

      // Optimistically update the ref so subsequent debounced calls
      // (which may fire before React re-renders) see the latest classes
      const classesString = updatedClasses.join(' ');
      layerRef.current = {
        ...currentLayer,
        design: updatedDesign,
        classes: classesString,
        ...(finalUpdate.styleOverrides !== undefined ? { styleOverrides: finalUpdate.styleOverrides } : {}),
      };

      onLayerUpdate(currentLayer.id, finalUpdate);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isTextStyleMode excluded to prevent unnecessary re-creations
    [onLayerUpdate, activeBreakpoint, activeUIState, isTextStyleMode, activeTextStyleKey, isTextEditing, ensureDynamicStyleApplied, hasTextSelection]
  );

  /**
   * Update multiple design properties at once
   * Applies breakpoint-aware class prefixes based on active viewport
   * Supports text style mode (updates layer.textStyles[key] instead of layer)
   */
  const updateDesignProperties = useCallback(
    (updates: {
      category: keyof NonNullable<Layer['design']>;
      property: string;
      value: string | null;
    }[]) => {
      const currentLayer = layerRef.current;
      if (!currentLayer) return;

      // Text Style Mode: batch-update layer.textStyles[key]
      if (isTextStyleMode && activeTextStyleKey) {
        const currentTextStyles = currentLayer.textStyles ?? { ...DEFAULT_TEXT_STYLES };
        const currentTextStyle = currentTextStyles[activeTextStyleKey] || {};
        const currentDesign = currentTextStyle.design || {};
        const updatedDesign = { ...currentDesign };

        let currentClasses = (currentTextStyle.classes || '').split(' ').filter(Boolean);

        updates.forEach(({ category, property, value }) => {
          const categoryData = updatedDesign[category] || {};
          updatedDesign[category] = {
            ...categoryData,
            [property]: value,
            isActive: true,
          };

          if (!value) {
            delete updatedDesign[category]![property as keyof typeof categoryData];
          }

          const newClass = value ? propertyToClass(category, property, value) : null;
          currentClasses = setBreakpointClass(
            currentClasses,
            property,
            newClass,
            activeBreakpoint,
            activeUIState
          );
        });

        const updatedTextStyle: Record<string, unknown> = {
          ...currentTextStyle,
          design: updatedDesign,
          classes: currentClasses.join(' '),
        };

        if (currentTextStyle.styleId) {
          updatedTextStyle.styleOverrides = {
            classes: currentClasses.join(' '),
            design: updatedDesign,
          };
        }

        const textStylesUpdate = {
          ...currentTextStyles,
          [activeTextStyleKey]: updatedTextStyle,
        };

        layerRef.current = { ...currentLayer, textStyles: textStylesUpdate };
        onLayerUpdate(currentLayer.id, { textStyles: textStylesUpdate });
        return;
      }

      // Normal Mode: update layer directly
      let currentClasses = Array.isArray(currentLayer.classes)
        ? [...currentLayer.classes]
        : (currentLayer.classes || '').split(' ').filter(Boolean);

      const currentDesign = currentLayer.design || {};
      const updatedDesign = { ...currentDesign };

      updates.forEach(({ category, property, value }) => {
        const categoryData = updatedDesign[category] || {};
        updatedDesign[category] = {
          ...categoryData,
          [property]: value,
          isActive: true,
        };

        if (!value) {
          delete updatedDesign[category]![property as keyof typeof categoryData];
        }

        const newClass = value ? propertyToClass(category, property, value) : null;
        currentClasses = setBreakpointClass(
          currentClasses,
          property,
          newClass,
          activeBreakpoint,
          activeUIState
        );
      });

      const classesString = currentClasses.join(' ');

      layerRef.current = {
        ...currentLayer,
        design: updatedDesign,
        classes: classesString,
      };

      onLayerUpdate(currentLayer.id, {
        design: updatedDesign,
        classes: classesString,
      });
    },
    [onLayerUpdate, activeBreakpoint, activeUIState, isTextStyleMode, activeTextStyleKey]
  );

  /**
   * Get current value for a design property
   * @param category - Design category (e.g., 'typography', 'sizing')
   * @param property - Property name (e.g., 'fontSize', 'width')
   * @returns The value that will actually apply (follows CSS cascade/inheritance)
   */
  const getDesignProperty = useCallback(
    (
      category: keyof NonNullable<Layer['design']>,
      property: string
    ): string | undefined => {
      if (!layer) return undefined;

      // Text Style Mode: Read from layer.textStyles[key], falling back to DEFAULT_TEXT_STYLES
      if (isTextStyleMode && activeTextStyleKey) {
        const textStyle = getTextStyle(layer.textStyles, activeTextStyleKey);
        const classes = (textStyle?.classes || '').split(' ').filter(Boolean);

        if (classes.length === 0) {
          // Fallback to design object if no classes
          if (!textStyle?.design?.[category]) return undefined;
          const categoryData = textStyle.design[category] as Record<string, unknown>;
          return categoryData[property] as string | undefined;
        }

        const { value: inheritedClass } = getInheritedValue(classes, property, activeBreakpoint, activeUIState);
        if (!inheritedClass) return undefined;

        const arbitraryMatch = inheritedClass.match(/\[([^\]]+)\]/);
        if (arbitraryMatch) return arbitraryMatch[1].replace(/^(length|percentage|family-name|number):/, '');

        return mapClassToDesignValue(inheritedClass, property);
      }

      // Normal Mode: Read from layer
      const classes = Array.isArray(layer.classes)
        ? layer.classes
        : (layer.classes || '').split(' ').filter(Boolean);

      if (classes.length === 0) {
        // Fallback to design object if no classes at all
        if (!layer.design?.[category]) return undefined;
        const categoryData = layer.design[category] as Record<string, unknown>;
        return categoryData[property] as string | undefined;
      }

      // Use inheritance to get the value that will actually apply (desktop → tablet → mobile)
      // with UI state support (checks state-specific classes first, then falls back to neutral)
      const { value: inheritedClass } = getInheritedValue(classes, property, activeBreakpoint, activeUIState);

      if (!inheritedClass) {
        // CRITICAL: Do NOT fall back to design object here
        // If getInheritedValue returns null, it means:
        // 1. No neutral/base class exists for this property
        // 2. AND we're in neutral state (where state-specific classes are ignored)
        // This is correct behavior - the input should be empty
        //
        // The design object might have corrupted values from before the classesToDesign fix,
        // so we should only trust the classes as the source of truth
        return undefined;
      }

      // Parse the inherited class to extract the actual value
      // Also capture Tailwind opacity modifier (e.g., text-[#0073ff]/23 → #0073ff/23)
      const arbitraryMatch = inheritedClass.match(/\[([^\]]+)\](?:\/(\d+))?/);
      if (arbitraryMatch) {
        let extractedValue = arbitraryMatch[2] ? `${arbitraryMatch[1]}/${arbitraryMatch[2]}` : arbitraryMatch[1];
        extractedValue = extractedValue.replace(/^(length|percentage|family-name|number):/, '');
        // Strip default units for transform properties so inputs show raw numbers
        if (['rotate', 'skewX', 'skewY'].includes(property) && extractedValue.endsWith('deg')) {
          extractedValue = extractedValue.slice(0, -3);
        }
        if (['translateX', 'translateY'].includes(property) && extractedValue.endsWith('px')) {
          extractedValue = extractedValue.slice(0, -2);
        }
        if (['duration', 'delay'].includes(property)) {
          if (extractedValue.endsWith('ms')) {
            extractedValue = extractedValue.slice(0, -2);
          } else if (extractedValue.endsWith('s')) {
            extractedValue = String(parseFloat(extractedValue) * 1000);
          }
        }
        return extractedValue;
      }

      // CSS variable reference for background-image
      const bgVarName = extractBgImgVarName(inheritedClass);
      if (bgVarName) return bgVarName;

      return mapClassToDesignValue(inheritedClass, property);
    },
    [layer, activeBreakpoint, activeUIState, isTextStyleMode, activeTextStyleKey]
  );

  /**
   * Reset a design category (remove all properties and related classes)
   */
  const resetDesignCategory = useCallback(
    (category: keyof NonNullable<Layer['design']>) => {
      const currentLayer = layerRef.current;
      if (!currentLayer) return;

      const currentDesign = currentLayer.design || {};
      const categoryData = currentDesign[category];

      if (!categoryData) return;

      // Get all properties in this category (except isActive)
      const properties = Object.keys(categoryData).filter(key => key !== 'isActive');

      // Remove all conflicting classes
      let currentClasses = Array.isArray(currentLayer.classes)
        ? [...currentLayer.classes]
        : (currentLayer.classes || '').split(' ').filter(Boolean);

      properties.forEach(property => {
        currentClasses = replaceConflictingClasses(currentClasses, property, null);
      });

      // Remove category from design object
      const updatedDesign = { ...currentDesign };
      delete updatedDesign[category];

      const classesString = currentClasses.join(' ');

      // Optimistically update the ref
      layerRef.current = { ...currentLayer, design: updatedDesign, classes: classesString };

      // Note: Use join instead of cn() because replaceConflictingClasses already handles
      // property-aware conflict resolution
      onLayerUpdate(currentLayer.id, {
        design: updatedDesign,
        classes: classesString,
      });
    },
    [onLayerUpdate]
  );

  /**
   * Sync classes back to design object
   * Useful when classes are manually edited
   */
  const syncClassesToDesign = useCallback(
    (classes: string) => {
      const currentLayer = layerRef.current;
      if (!currentLayer) return;

      // Optimistically update the ref
      layerRef.current = { ...currentLayer, classes };

      onLayerUpdate(currentLayer.id, {
        classes,
      });
    },
    [onLayerUpdate]
  );

  /**
   * Debounced version of updateDesignProperty for text inputs
   * Use this for inputs where users type values (e.g., spacing, sizing)
   * to avoid flooding the canvas with updates on every keystroke
   *
   * Uses per-property debounced functions so that updating one property
   * (e.g., fontSize) never cancels a pending update to another property
   * (e.g., lineHeight). Each property gets its own debounce timer.
   *
   * IMPORTANT: This implementation avoids stale closure issues by:
   * 1. Using a ref to always access the latest updateDesignProperty
   * 2. Cancelling pending calls when the layer changes
   * 3. Cleaning up on unmount
   */

  // Store the latest updateDesignProperty in a ref to avoid stale closures
  const updateDesignPropertyRef = useRef(updateDesignProperty);
  updateDesignPropertyRef.current = updateDesignProperty;

  // Track the current layer ID to detect layer changes
  const currentLayerIdRef = useRef(layer?.id);

  // Per-property debounced functions so properties don't interfere with each other
  const debouncedFnMapRef = useRef<Map<string, ReturnType<typeof debounce>>>(new Map());

  const getDebouncedFn = useCallback((property: string) => {
    let fn = debouncedFnMapRef.current.get(property);
    if (!fn) {
      fn = debounce(
        (
          category: keyof NonNullable<Layer['design']>,
          prop: string,
          value: string | null
        ) => {
          updateDesignPropertyRef.current(category, prop, value);
        },
        150
      );
      debouncedFnMapRef.current.set(property, fn);
    }
    return fn;
  }, []);

  // Cancel all pending debounced calls when layer changes to prevent stale updates
  useEffect(() => {
    if (currentLayerIdRef.current !== layer?.id) {
      debouncedFnMapRef.current.forEach(fn => fn.cancel());
      currentLayerIdRef.current = layer?.id;
    }
  }, [layer?.id]);

  // Cleanup on unmount
  useEffect(() => {
    const debouncedFns = debouncedFnMapRef.current;
    return () => {
      debouncedFns.forEach(fn => fn.cancel());
    };
  }, []);

  // Return a stable wrapper function
  const debouncedUpdateDesignProperty = useCallback(
    (
      category: keyof NonNullable<Layer['design']>,
      property: string,
      value: string | null
    ) => {
      getDebouncedFn(property)(category, property, value);
    },
    [getDebouncedFn]
  );

  return {
    updateDesignProperty,
    updateDesignProperties,
    debouncedUpdateDesignProperty,
    getDesignProperty,
    resetDesignCategory,
    syncClassesToDesign,
  };
}

/**
 * Helper function to map Tailwind class back to design value
 * e.g., "text-3xl" → "3xl", "font-bold" → "700", "bg-blue-500" → "#3b82f6"
 */
function mapClassToDesignValue(className: string, property: string): string | undefined {
  // Remove any breakpoint and state prefixes
  const cleanClass = className.replace(/^(max-lg:|max-md:|lg:|md:)?(hover:|focus:|active:|disabled:|visited:)?/, '');

  // Special cases for properties where classes don't have dashes or are complete values
  const noSplitProperties = [
    'position',            // static, absolute, relative, fixed, sticky
    'display',             // block, inline, flex, grid, hidden (some have dashes like inline-block)
    'textTransform',       // uppercase, lowercase, capitalize, normal-case
    'textDecoration',      // underline, overline, line-through, no-underline
  ];

  if (noSplitProperties.includes(property)) {
    return cleanClass;
  }

  // Full-class mappings for properties where the entire class maps to a value
  const fullClassMappings: Record<string, Record<string, string>> = {
    transitionProperty: {
      'transition': 'default',
      'transition-all': 'all',
      'transition-colors': 'colors',
      'transition-opacity': 'opacity',
      'transition-shadow': 'shadow',
      'transition-transform': 'transform',
      'transition-none': 'none',
    },
    overflow: {
      'truncate': 'ellipsis',
    },
  };

  if (fullClassMappings[property]?.[cleanClass]) {
    return fullClassMappings[property][cleanClass];
  }

  // Multi-segment prefix properties need special handling.
  // Naively splitting on '-' would turn "max-w-full" into "w-full" instead of "full".
  const multiSegmentPrefixes: Record<string, string> = {
    maxWidth: 'max-w-',
    minWidth: 'min-w-',
    maxHeight: 'max-h-',
    minHeight: 'min-h-',
    gridColumnSpan: 'col-span-',
    gridRowSpan: 'row-span-',
    lineClamp: 'line-clamp-',
    textShadow: 'text-shadow-',
    translateX: 'translate-x-',
    translateY: 'translate-y-',
    skewX: 'skew-x-',
    skewY: 'skew-y-',
    transformOrigin: 'origin-',
    backdropBlur: 'backdrop-blur-',
  };

  const knownPrefix = multiSegmentPrefixes[property];
  if (knownPrefix && cleanClass.startsWith(knownPrefix)) {
    const value = cleanClass.slice(knownPrefix.length);
    if (value === 'full') return '100%';
    return value;
  }

  // Extract the value part after the property prefix
  // e.g., "text-3xl" → "3xl", "font-bold" → "bold", "w-full" → "full"
  const parts = cleanClass.split('-');
  if (parts.length < 2) return undefined;

  // Join everything after the first part (e.g., "text-center" → "center", "bg-blue-500" → "blue-500")
  const value = parts.slice(1).join('-');

  // Special mappings for named values
  const namedMappings: Record<string, Record<string, string>> = {
    fontWeight: {
      'thin': '100',
      'extralight': '200',
      'light': '300',
      'normal': '400',
      'medium': '500',
      'semibold': '600',
      'bold': '700',
      'extrabold': '800',
      'black': '900',
    },
    fontSize: {
      'xs': '0.75rem',
      'sm': '0.875rem',
      'base': '1rem',
      'lg': '1.125rem',
      'xl': '1.25rem',
      '2xl': '1.5rem',
      '3xl': '1.875rem',
      '4xl': '2.25rem',
      '5xl': '3rem',
      '6xl': '3.75rem',
      '7xl': '4.5rem',
      '8xl': '6rem',
      '9xl': '8rem',
    },
    flexDirection: {
      'row': 'row',
      'col': 'column',
      'row-reverse': 'row-reverse',
      'col-reverse': 'column-reverse',
    },
    flexWrap: {
      'wrap': 'wrap',
      'wrap-reverse': 'wrap-reverse',
      'nowrap': 'nowrap',
    },
    easing: {
      'linear': 'linear',
      'in': 'in',
      'out': 'out',
      'in-out': 'in-out',
    },
  };

  // Check if we have a named mapping for this property
  if (namedMappings[property]?.[value]) {
    return namedMappings[property][value];
  }

  // Map 'full' → '100%' for width/height (w-full, h-full)
  if ((property === 'width' || property === 'height') && value === 'full') {
    return '100%';
  }

  return value;
}
