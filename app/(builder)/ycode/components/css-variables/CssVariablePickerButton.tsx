'use client';

/**
 * CssVariablePickerButton
 *
 * Small button rendered next to a non-color design-property input (size, font
 * family, percentage, number) that opens a picker listing every CSS variable
 * of the matching type. Picking one calls `onPick(varRef)` with `var(--<id>)`,
 * which the calling control turns into the right Tailwind class via
 * {@link formatCssVariableReferenceClass}.
 */

import React from 'react';
import type { CssVariableType } from '@/types';
import CssVariableReferencePicker from './CssVariableReferencePicker';

interface CssVariablePickerButtonProps {
  type: CssVariableType;
  /** Variable IDs to exclude (e.g. the one being edited inside the variables editor). */
  excludeIds?: string[];
  onPick: (cssVariableRef: string) => void;
}

export default function CssVariablePickerButton({
  type,
  excludeIds,
  onPick,
}: CssVariablePickerButtonProps) {
  return (
    <CssVariableReferencePicker
      type={type}
      excludeIds={excludeIds}
      onSelect={onPick}
      triggerLabel="Use a variable"
    />
  );
}
