'use client';

/** Size value editor (px/rem/em/vh/vw, etc.). Accepts any CSS length string. */

import React from 'react';
import { Input } from '@/components/ui/input';
import { useControlledInput } from '@/hooks/use-controlled-input';
import { removeSpaces } from '@/lib/utils';

interface SizeValueInputProps {
  value: string;
  onChange: (value: string) => void;
}

export default function SizeValueInput({ value, onChange }: SizeValueInputProps) {
  const [local, setLocal] = useControlledInput(value);

  const handleChange = (next: string) => {
    setLocal(next);
    onChange(removeSpaces(next));
  };

  return (
    <Input
      value={local}
      onChange={(e) => handleChange(e.target.value)}
      placeholder="1rem"
    />
  );
}
