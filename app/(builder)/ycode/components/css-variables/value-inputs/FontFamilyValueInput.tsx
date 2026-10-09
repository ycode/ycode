'use client';

/**
 * Font family value editor.
 *
 * Plain text input so users can enter any CSS font stack (e.g.
 * `Inter, sans-serif`). A future iteration can offer a dropdown sourced from
 * `useFontsStore` for ergonomics.
 */

import React from 'react';
import { Input } from '@/components/ui/input';
import { useControlledInput } from '@/hooks/use-controlled-input';

interface FontFamilyValueInputProps {
  value: string;
  onChange: (value: string) => void;
}

export default function FontFamilyValueInput({ value, onChange }: FontFamilyValueInputProps) {
  // Font families legitimately contain spaces ("Helvetica Neue"), so disable
  // the default whitespace sanitization.
  const [local, setLocal] = useControlledInput(value, undefined, false);

  const handleChange = (next: string) => {
    setLocal(next);
    onChange(next);
  };

  return (
    <Input
      value={local}
      onChange={(e) => handleChange(e.target.value)}
      placeholder="Inter, sans-serif"
    />
  );
}
