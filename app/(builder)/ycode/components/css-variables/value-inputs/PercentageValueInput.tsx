'use client';

/** Percentage value editor. Stored as `<number>%`. */

import React from 'react';
import { Input } from '@/components/ui/input';
import { useControlledInput } from '@/hooks/use-controlled-input';
import { removeSpaces } from '@/lib/utils';

interface PercentageValueInputProps {
  value: string;
  onChange: (value: string) => void;
}

export default function PercentageValueInput({ value, onChange }: PercentageValueInputProps) {
  const [local, setLocal] = useControlledInput(value);

  const handleChange = (next: string) => {
    setLocal(next);
    const cleaned = removeSpaces(next);
    // Auto-append `%` when the user types a bare number for ergonomics
    if (cleaned && /^\d+(\.\d+)?$/.test(cleaned)) {
      onChange(`${cleaned}%`);
      return;
    }
    onChange(cleaned);
  };

  return (
    <Input
      value={local}
      onChange={(e) => handleChange(e.target.value)}
      placeholder="50%"
    />
  );
}
