'use client';

/**
 * ColorValueInput
 *
 * Color value editor used inside the CSS variables editor. Wraps the existing
 * ColorPicker (solid-only, no CMS bindings) so we keep one source of truth for
 * color editing. Storage format matches what the picker emits: `#hex` or
 * `#hex/opacityPercent`. References to other CSS variables (`var(--id)`) pass
 * through untouched.
 */

import React from 'react';
import ColorPicker from '../../ColorPicker';

interface ColorValueInputProps {
  value: string;
  onChange: (value: string) => void;
}

export default function ColorValueInput({ value, onChange }: ColorValueInputProps) {
  return (
    <ColorPicker
      value={value}
      onChange={onChange}
      onImmediateChange={onChange}
      solidOnly
    />
  );
}
