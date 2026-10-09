'use client';

/** Unitless number value editor (line-height, opacity, font-weight, etc.). */

import React from 'react';
import { Input } from '@/components/ui/input';
import { useControlledInput } from '@/hooks/use-controlled-input';
import { removeSpaces } from '@/lib/utils';

interface NumberValueInputProps {
  value: string;
  onChange: (value: string) => void;
}

export default function NumberValueInput({ value, onChange }: NumberValueInputProps) {
  const [local, setLocal] = useControlledInput(value);

  const handleChange = (next: string) => {
    setLocal(next);
    onChange(removeSpaces(next));
  };

  return (
    <Input
      value={local}
      onChange={(e) => handleChange(e.target.value)}
      placeholder="1.5"
    />
  );
}
