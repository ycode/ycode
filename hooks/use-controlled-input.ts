/**
 * Custom hook for controlled inputs that need to sync with external state
 * while maintaining local state during editing to prevent flickering.
 * 
 * This solves the "input repopulation bug" where typing gets overwritten
 * by async state updates from the layer classes.
 * 
 * Automatically sanitizes input values to prevent invalid Tailwind classes
 * (removes spaces by default).
 * 
 * @example
 * ```typescript
 * const fontSize = getDesignProperty('typography', 'fontSize') || '';
 * const [fontSizeInput, setFontSizeInput] = useControlledInput(fontSize, extractValue);
 * 
 * <Input 
 *   value={fontSizeInput} 
 *   onChange={(e) => {
 *     setFontSizeInput(e.target.value); // Spaces automatically stripped
 *     updateDesignProperty('typography', 'fontSize', e.target.value);
 *   }}
 * />
 * ```
 */

import { useState } from 'react';
import { removeSpaces } from '@/lib/utils';

/**
 * Hook for controlled input state that syncs with external value
 * Automatically sanitizes input to prevent invalid Tailwind classes
 * 
 * @param externalValue - The value from layer/design property
 * @param transform - Optional transform function to extract/format the value (e.g., extractValue)
 * @param sanitize - Enable input sanitization (default: true, removes spaces)
 * @returns [localValue, setLocalValue] - Tuple of local state and setter
 */
export function useControlledInput(
  externalValue: string | undefined,
  transform?: (value: string) => string,
  sanitize: boolean = true
): [string, (value: string) => void] {
  const [prevExternalValue, setPrevExternalValue] = useState<string | undefined>(externalValue);
  const [localValue, setLocalValue] = useState(() => {
    const valueToSet = externalValue || '';
    return transform ? transform(valueToSet) : valueToSet;
  });

  // Sync local state when external value changes (e.g., undo/redo, breakpoint switch)
  // We do this during render to avoid cascading renders and comply with React 18+ rules.
  if (externalValue !== prevExternalValue) {
    setPrevExternalValue(externalValue);
    const valueToSet = externalValue || '';
    setLocalValue(transform ? transform(valueToSet) : valueToSet);
  }

  // Wrapper setter with optional sanitization
  const setValueSafely = (value: string) => {
    const processedValue = sanitize ? removeSpaces(value) : value;
    setLocalValue(processedValue);
  };

  return [localValue, setValueSafely];
}

/**
 * Hook for multiple controlled inputs (batch version)
 * Useful when you have many related inputs
 * 
 * @param values - Object mapping keys to external values
 * @param transform - Optional transform function
 * @returns Object with same keys mapped to [value, setValue] tuples
 */
export function useControlledInputs<T extends Record<string, string | undefined>>(
  values: T,
  transform?: (value: string) => string
): Record<keyof T, [string, (value: string) => void]> {
  // Use a stable object to avoid re-creating it on every render
  // and manually call useControlledInput for each key in a stable way.
  // Note: This only works if the keys of T are stable.
  const result = {} as Record<keyof T, [string, (value: string) => void]>;

  for (const key in values) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    result[key] = useControlledInput(values[key], transform);
  }

  return result;
}
