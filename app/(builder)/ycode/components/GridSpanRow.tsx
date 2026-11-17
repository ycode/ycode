'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import Icon from '@/components/ui/icon';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import BoundFieldPill from './BoundFieldPill';
import DesignPropertyLabel from './DesignPropertyLabel';
import { CollectionFieldSelector, type FieldGroup, type FieldSourceType } from './CollectionFieldSelector';
import { useEditorStore } from '@/stores/useEditorStore';
import { SPAN_FIELD_TYPES, filterFieldGroupsByType, flattenFieldGroups, getFieldName } from '@/lib/collection-field-utils';
import { getClassesString } from '@/lib/layer-utils';
import { getConflictingClassPattern, getInheritedValue, parseFullClass } from '@/lib/tailwind-class-mapper';
import { buildFieldVariableData } from '@/lib/variable-format-utils';
import type { Breakpoint, Collection, CollectionField, FieldVariable, Layer, UIState } from '@/types';

type SpanProperty = 'gridColumnSpan' | 'gridRowSpan';

/** Tailwind ships `col-span-1` … `col-span-12` plus `col-span-full` (`1 / -1`) */
const SPAN_OPTIONS: { value: string; label: string }[] = [
  ...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `Span ${i + 1}` })),
  { value: 'full', label: 'Span all' },
];

/** No class (or `auto`) is the browser default of one cell */
function toSelectValue(value: string): string {
  if (!value || value === 'auto') return '1';
  return value;
}

function getLayerClassList(layer: Layer): string[] {
  return getClassesString(layer).split(' ').filter(Boolean);
}

/**
 * True when a wider breakpoint (or the neutral state) already sets this property, so an
 * explicit class is needed at the current breakpoint to override it.
 */
function inheritsFromWiderBreakpoint(layer: Layer, property: SpanProperty, breakpoint: Breakpoint, uiState: UIState): boolean {
  const { value, source } = getInheritedValue(getLayerClassList(layer), property, breakpoint, uiState);
  return Boolean(value) && source !== breakpoint;
}

/** True when the layer has its own span class at exactly this breakpoint and state */
function hasOwnSpanClass(layer: Layer, property: SpanProperty, breakpoint: Breakpoint, uiState: UIState): boolean {
  const pattern = getConflictingClassPattern(property);
  if (!pattern) return false;
  return getLayerClassList(layer).some((cls) => {
    const parsed = parseFullClass(cls);
    return parsed.breakpoint === breakpoint && parsed.uiState === uiState && pattern.test(parsed.baseClass);
  });
}

interface GridSpanRowProps {
  label: string;
  layer: Layer;
  property: SpanProperty;
  /** Resolved span for the current breakpoint/state ('' when unset) */
  value: string;
  onChange: (property: SpanProperty, value: string | null) => void;
  /** Needed to bind this span to a CMS field, so different collection items can take different spans */
  onLayerUpdate?: (layerId: string, updates: Partial<Layer>) => void;
  fieldGroups?: FieldGroup[];
  allFields?: Record<string, CollectionField[]>;
  collections?: Collection[];
}

/**
 * "Columns" / "Rows" span picker for a grid child: Span 1 … Span 12 and Span all.
 * Shows Span 1 when unset (the browser default). On desktop it can be bound to a CMS
 * number/option field so each collection item gets its own span; smaller breakpoints
 * inherit the binding until they set their own span.
 */
export default function GridSpanRow({ label, layer, property, value, onChange, onLayerUpdate, fieldGroups, allFields, collections }: GridSpanRowProps) {
  const activeBreakpoint = useEditorStore((s) => s.activeBreakpoint);
  const activeUIState = useEditorStore((s) => s.activeUIState);
  const [fieldMenuOpen, setFieldMenuOpen] = useState(false);

  const spanFieldGroups = useMemo(() => {
    if (!fieldGroups) return [];
    return filterFieldGroupsByType(fieldGroups, SPAN_FIELD_TYPES);
  }, [fieldGroups]);

  const spanFields = useMemo(() => flattenFieldGroups(spanFieldGroups), [spanFieldGroups]);

  const boundFieldId = layer.variables?.design?.[property]?.data?.field_id;
  const isBound = !!boundFieldId;
  const boundFieldLabel = (boundFieldId && getFieldName(spanFields, boundFieldId)) || 'Span field';

  // The binding replaces the base (desktop, neutral) span class
  const isBindingTarget = activeBreakpoint === 'desktop' && activeUIState === 'neutral';
  const isInheritingBinding = isBound && !isBindingTarget
    && !hasOwnSpanClass(layer, property, activeBreakpoint, activeUIState);
  const canBind = isBindingTarget && !isBound && spanFields.length > 0 && !!onLayerUpdate;

  const handleChange = (next: string) => {
    // Span 1 is the default, so it is stored as "no class" — unless a wider breakpoint
    // (or a binding) spans more, in which case `col-span-1` is a real override.
    const isDefault = next === '1'
      && !isBound
      && !inheritsFromWiderBreakpoint(layer, property, activeBreakpoint, activeUIState);
    onChange(property, isDefault ? null : next);
  };

  const setBinding = useCallback((fieldVar: FieldVariable | undefined) => {
    if (!onLayerUpdate) return;
    const updatedDesign = { ...layer.variables?.design };
    if (fieldVar) {
      updatedDesign[property] = fieldVar;
    } else {
      delete updatedDesign[property];
    }
    const hasBindings = Object.keys(updatedDesign).length > 0;
    onLayerUpdate(layer.id, {
      variables: {
        ...layer.variables,
        design: hasBindings ? updatedDesign : undefined,
      },
    });
  }, [layer, onLayerUpdate, property]);

  const handleBind = useCallback((
    fieldId: string,
    relationshipPath: string[],
    source?: FieldSourceType,
    layerId?: string,
  ) => {
    const field = spanFields.find(f => f.id === fieldId);
    setBinding(buildFieldVariableData(fieldId, relationshipPath, field?.type ?? null, source, layerId));
    setFieldMenuOpen(false);
  }, [spanFields, setBinding]);

  const handleUnbind = useCallback(() => setBinding(undefined), [setBinding]);

  if (isBound && isBindingTarget) {
    return (
      <div className="grid grid-cols-3">
        <Label variant="muted">{label}</Label>
        <div className="col-span-2">
          <BoundFieldPill label={boundFieldLabel} onUnbind={handleUnbind} />
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3">
      <DesignPropertyLabel properties={[property]} variant="muted">{label}</DesignPropertyLabel>
      <div className="col-span-2 flex items-center gap-2">
        <Select value={isInheritingBinding ? '' : toSelectValue(value)} onValueChange={handleChange}>
          <SelectTrigger
            className="w-full"
            aria-label={property === 'gridColumnSpan' ? 'Column span' : 'Row span'}
          >
            <SelectValue placeholder={boundFieldLabel} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {SPAN_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {canBind && (
          <DropdownMenu open={fieldMenuOpen} onOpenChange={setFieldMenuOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="input" size="sm"
                    type="button"
                    aria-label="Bind to span field"
                  >
                    <Icon name="database" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Bind to span field</TooltipContent>
            </Tooltip>
            <DropdownMenuContent
              className="w-56" side="left"
              align="start"
            >
              <CollectionFieldSelector
                fieldGroups={spanFieldGroups}
                allFields={allFields || {}}
                collections={collections || []}
                onSelect={handleBind}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
