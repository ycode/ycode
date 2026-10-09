'use client';

/**
 * CssVariableValueCell
 *
 * Switches between the type-specific value input and shows a small reference
 * picker. When the stored value is `var(--<otherId>)`, the picker is collapsed
 * to show the referenced variable's name and a clear button.
 */

import React from 'react';
import { DiamondPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { useCssVariablesStore } from '@/stores/useCssVariablesStore';
import type { CssVariableType } from '@/types';
import ColorValueInput from './value-inputs/ColorValueInput';
import SizeValueInput from './value-inputs/SizeValueInput';
import PercentageValueInput from './value-inputs/PercentageValueInput';
import NumberValueInput from './value-inputs/NumberValueInput';
import FontFamilyValueInput from './value-inputs/FontFamilyValueInput';
import CssVariableReferencePicker from './CssVariableReferencePicker';

interface CssVariableValueCellProps {
  type: CssVariableType;
  value: string;
  /** True when showing the default mode's value because this mode has no override. */
  isUsingDefault?: boolean;
  /** The variable we're editing — excluded from the reference picker. */
  excludeVariableId: string;
  onChange: (value: string) => void;
}

const VAR_REFERENCE_RE = /^var\(--([0-9a-fA-F-]+)\)$/;

export default function CssVariableValueCell({
  type,
  value,
  isUsingDefault = false,
  excludeVariableId,
  onChange,
}: CssVariableValueCellProps) {
  const variables = useCssVariablesStore((s) => s.graph.variables);
  const referencedId = VAR_REFERENCE_RE.exec(value)?.[1] ?? null;
  const referenced = referencedId ? variables.find((v) => v.id === referencedId) : null;

  if (referenced) {
    return (
      <div className={cn('flex items-center gap-1 w-full', isUsingDefault && 'opacity-50')}>
        <div className="flex-1 h-8 px-2 rounded-lg border bg-muted/50 text-xs flex items-center gap-1.5">
          <DiamondPlus className="size-2.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{referenced.name}</span>
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          title="Clear reference"
          onClick={() => onChange('')}
        >
          <Icon name="x" />
        </Button>
      </div>
    );
  }

  return (
    <div className={cn('flex items-center gap-1 w-full', isUsingDefault && 'opacity-50')}>
      <div className="flex-1 min-w-0 *:w-full">
        {renderInput(type, value, onChange)}
      </div>
      <CssVariableReferencePicker
        type={type}
        excludeIds={[excludeVariableId]}
        onSelect={onChange}
      />
    </div>
  );
}

function renderInput(type: CssVariableType, value: string, onChange: (value: string) => void) {
  switch (type) {
    case 'color':
      return <ColorValueInput value={value} onChange={onChange} />;
    case 'size':
      return <SizeValueInput value={value} onChange={onChange} />;
    case 'percentage':
      return <PercentageValueInput value={value} onChange={onChange} />;
    case 'number':
      return <NumberValueInput value={value} onChange={onChange} />;
    case 'font_family':
      return <FontFamilyValueInput value={value} onChange={onChange} />;
    default:
      return null;
  }
}
