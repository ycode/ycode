'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * A `Set<string>` persisted in sessionStorage under `storageKey`.
 * `getInitial` provides the value when nothing is stored yet.
 */
export function useSessionStorageSet(
  storageKey: string,
  getInitial: () => string[] = () => []
): [Set<string>, (value: string) => void] {
  const [values, setValues] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        try {
          return new Set(JSON.parse(saved));
        } catch {
          // Fall through to the initial value
        }
      }
    }
    return new Set(getInitial());
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(storageKey, JSON.stringify(Array.from(values)));
    }
  }, [storageKey, values]);

  const toggle = useCallback((value: string) => {
    setValues((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  }, []);

  return [values, toggle];
}
