'use client';

/**
 * ColorPropertyField — wraps ColorPicker with CMS color field binding support.
 * Each gradient mode (linear/radial) stores its own state so switching tabs preserves bindings.
 */

import React, { useMemo, useCallback, useRef } from 'react';
import ColorPicker from './ColorPicker';
import type { ColorPickerBindingProps } from './ColorPicker';
import { CollectionFieldSelector } from './CollectionFieldSelector';
import { COLOR_FIELD_TYPES, filterFieldGroupsByType, flattenFieldGroups } from '@/lib/collection-field-utils';
import type { Collection, CollectionField, CollectionFieldType, FieldVariable, DesignColorVariable, BoundColorStop, Layer } from '@/types';
import type { FieldGroup, FieldSourceType } from '@/lib/collection-field-utils';

/** Design property names that can be bound to color fields */
export type ColorDesignProperty = 'backgroundColor' | 'color' | 'borderColor' | 'divideColor' | 'textDecorationColor' | 'placeholderColor';

interface ColorPropertyFieldProps {
  value: string;
  /** Debounced change handler (keyboard-typed hex values) */
  onChange: (value: string) => void;
  /** Immediate (non-debounced) handler for programmatic changes */
  onImmediateChange?: (value: string) => void;
  defaultValue?: string;
  placeholder?: string;
  solidOnly?: boolean;
  layer: Layer | null;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
  designProperty: ColorDesignProperty;
  fieldGroups?: FieldGroup[];
  allFields?: Record<string, CollectionField[]>;
  collections?: Collection[];
}

/** Build a FieldVariable from field selection params */
function buildFieldVariable(
  fieldId: string,
  relationshipPath: string[],
  fieldType: CollectionFieldType | null,
  source?: FieldSourceType,
  layerId?: string,
): FieldVariable {
  return {
    type: 'field',
    data: {
      field_id: fieldId,
      relationships: relationshipPath,
      field_type: fieldType,
      source,
      collection_layer_id: layerId,
    },
  };
}

/** Resolve field name from the fields list */
function resolveFieldName(fieldVar: FieldVariable | undefined, fields: CollectionField[]): string | null {
  if (!fieldVar?.data?.field_id) return null;
  return fields.find(f => f.id === fieldVar.data.field_id)?.name || 'Unknown field';
}

export default function ColorPropertyField({
  value,
  onChange,
  onImmediateChange,
  defaultValue,
  placeholder,
  solidOnly,
  layer,
  onLayerUpdate,
  designProperty,
  fieldGroups,
  allFields,
  collections,
}: ColorPropertyFieldProps) {
  const colorFieldGroups = useMemo(() => {
    if (!fieldGroups) return [];
    return filterFieldGroupsByType(fieldGroups, COLOR_FIELD_TYPES);
  }, [fieldGroups]);

  const colorFields = useMemo(() => flattenFieldGroups(colorFieldGroups), [colorFieldGroups]);
  const hasColorFields = colorFields.length > 0;

  const currentBinding = layer?.variables?.design?.[designProperty] as DesignColorVariable | undefined;

  // Cache latest gradient structure for first-time bind before a binding exists
  const gradientCacheRef = useRef<{
    mode: 'linear' | 'radial';
    stops: Array<{ id: string; position: number; color: string }>;
    angle?: number;
  } | null>(null);

  /** Persist a DesignColorVariable to the layer */
  const setBinding = useCallback((binding: DesignColorVariable | undefined) => {
    if (!layer) return;
    const updatedDesign = { ...layer.variables?.design };
    if (binding) {
      updatedDesign[designProperty] = binding;
    } else {
      delete updatedDesign[designProperty];
    }
    const hasBindings = Object.keys(updatedDesign).length > 0;
    onLayerUpdate(layer.id, {
      variables: {
        ...layer.variables,
        design: hasBindings ? updatedDesign : undefined,
      },
    });
  }, [layer, onLayerUpdate, designProperty]);

  /** Get binding state for a given stop (null = solid) */
  const getBinding = useCallback((stopId: string | null): { isBound: boolean; fieldName: string | null } => {
    if (!currentBinding) return { isBound: false, fieldName: null };

    if (stopId === null) {
      return {
        isBound: !!currentBinding.field?.data?.field_id,
        fieldName: resolveFieldName(currentBinding.field, colorFields),
      };
    }

    const stops = currentBinding.mode === 'linear'
      ? currentBinding.linear?.stops
      : currentBinding.mode === 'radial'
        ? currentBinding.radial?.stops
        : undefined;
    const stop = stops?.find(s => s.id === stopId);
    if (!stop?.field) return { isBound: false, fieldName: null };
    return {
      isBound: !!stop.field.data?.field_id,
      fieldName: resolveFieldName(stop.field, colorFields),
    };
  }, [currentBinding, colorFields]);

  /** Bind a CMS field to a stop (null = solid) */
  const handleBind = useCallback((
    stopId: string | null,
    fieldId: string,
    relationshipPath: string[],
    source?: string,
    layerId?: string,
  ) => {
    if (!layer) return;
    const field = colorFields.find(f => f.id === fieldId);
    const fieldVar = buildFieldVariable(
      fieldId, relationshipPath, field?.type || null,
      source as FieldSourceType | undefined, layerId,
    );

    if (stopId === null) {
      setBinding({ ...currentBinding, type: 'color', mode: 'solid', field: fieldVar });
      return;
    }

    const mode = currentBinding?.mode === 'linear' || currentBinding?.mode === 'radial'
      ? currentBinding.mode
      : (gradientCacheRef.current?.mode || 'linear');

    const existingStops = (mode === 'linear' ? currentBinding?.linear?.stops : currentBinding?.radial?.stops)
      || gradientCacheRef.current?.stops.map(s => ({ id: s.id, position: s.position, color: s.color }))
      || [];

    const stops: BoundColorStop[] = existingStops.map(s =>
      s.id === stopId ? { ...s, field: fieldVar } : s
    );
    if (!stops.find(s => s.id === stopId)) {
      stops.push({ id: stopId, position: 0, color: '#000000', field: fieldVar });
    }

    const modeUpdate = mode === 'linear'
      ? { linear: { angle: currentBinding?.linear?.angle ?? gradientCacheRef.current?.angle, stops } }
      : { radial: { stops } };

    setBinding({ ...currentBinding, type: 'color', mode, ...modeUpdate });
  }, [layer, colorFields, currentBinding, setBinding]);

  /** Unbind a stop (null = solid) */
  const handleUnbind = useCallback((stopId: string | null) => {
    if (!layer || !currentBinding) return;

    if (stopId === null) {
      const { field: _, ...rest } = currentBinding;
      const hasGradientData = rest.linear?.stops?.some(s => s.field) || rest.radial?.stops?.some(s => s.field);
      setBinding(hasGradientData ? { ...rest, type: 'color', mode: 'solid' } : undefined);
      return;
    }

    const mode = currentBinding.mode as 'linear' | 'radial';
    const modeData = mode === 'linear' ? currentBinding.linear : currentBinding.radial;
    const stops = (modeData?.stops || []).map(s =>
      s.id === stopId ? { ...s, field: undefined } : s
    );

    const updatedModeData = mode === 'linear'
      ? { linear: { ...currentBinding.linear, stops } }
      : { radial: { ...currentBinding.radial, stops } };
    const updated = { ...currentBinding, ...updatedModeData };

    const hasAnyBinding = updated.field?.data?.field_id
      || updated.linear?.stops?.some(s => s.field?.data?.field_id)
      || updated.radial?.stops?.some(s => s.field?.data?.field_id);

    setBinding(hasAnyBinding ? updated : undefined);
  }, [layer, currentBinding, setBinding]);

  /** Sync gradient structure from ColorPicker (stop positions, colors, angle) */
  const handleGradientSync = useCallback((
    mode: 'linear' | 'radial',
    stops: Array<{ id: string; position: number; color: string }>,
    angle?: number,
  ) => {
    gradientCacheRef.current = { mode, stops, angle };
    if (!currentBinding) return;

    const existingStops = (mode === 'linear' ? currentBinding.linear?.stops : currentBinding.radial?.stops) || [];
    const mergedStops = stops.map(s => {
      const existing = existingStops.find(es => es.id === s.id);
      return { id: s.id, position: s.position, color: s.color, field: existing?.field };
    });

    const modeUpdate = mode === 'linear'
      ? { linear: { angle, stops: mergedStops } }
      : { radial: { stops: mergedStops } };

    setBinding({ ...currentBinding, mode, ...modeUpdate });
  }, [currentBinding, setBinding]);

  /** Switch to solid mode — preserves all gradient data */
  const handleSwitchToSolid = useCallback(() => {
    if (!currentBinding) return;
    setBinding({ ...currentBinding, mode: 'solid' });
  }, [currentBinding, setBinding]);

  /** Clear all CMS bindings */
  const handleClearAll = useCallback(() => {
    setBinding(undefined);
  }, [setBinding]);

  const renderFieldSelector = useCallback((
    onSelect: (fieldId: string, relationshipPath: string[], source?: string, layerId?: string) => void,
  ) => (
    <CollectionFieldSelector
      fieldGroups={colorFieldGroups}
      allFields={allFields || {}}
      collections={collections || []}
      onSelect={onSelect}
    />
  ), [colorFieldGroups, allFields, collections]);

  const binding: ColorPickerBindingProps | undefined = useMemo(() => {
    if (!hasColorFields && !currentBinding) return undefined;
    return {
      hasColorFields,
      getBinding,
      onBind: handleBind,
      onUnbind: handleUnbind,
      onGradientSync: handleGradientSync,
      onSwitchToSolid: handleSwitchToSolid,
      renderFieldSelector,
    };
  }, [hasColorFields, currentBinding, getBinding, handleBind, handleUnbind, handleGradientSync, handleSwitchToSolid, renderFieldSelector]);

  return (
    <ColorPicker
      value={value}
      onChange={onChange}
      onImmediateChange={onImmediateChange}
      defaultValue={defaultValue}
      placeholder={placeholder}
      solidOnly={solidOnly}
      binding={binding}
      onClear={handleClearAll}
    />
  );
}
