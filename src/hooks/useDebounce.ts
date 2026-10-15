import { useEffect, useState } from "react";

/**
 * Returns a debounced copy of `value` that only updates after `delayMs` of inactivity.
 * When `value` is cleared (falsy or empty string), it updates immediately so clearing is instant.
 */
export function useDebounce<T>(value: T, delayMs: number = 250): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    if (!value) {
      setDebounced(value);
      return;
    }
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
