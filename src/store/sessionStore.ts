import { useCallback, useRef } from 'react';
import { create } from 'zustand';

/**
 * The working state of the lists — search, filters, selection — per view under
 * a key like `wiki.search`. It survives a module switch: anyone who
 * glances at the journal from the filtered wiki finds the filter again. It does
 * not survive a restart, nor a vault switch or
 * replacing from a backup (`clearSessionState`, from `closeAllTabs`) —
 * its ids would then point into the void.
 *
 * The counterpart, the preferences (view, sorting, collapse states), stays
 * permanently per vault (`vaultPrefs`).
 *
 * Imports no other store.
 */
const useSessionStore = create<{ values: Record<string, unknown> }>(() => ({ values: {} }));

type Update<T> = T | ((prev: T) => T);

/** Like `useState`, but kept for the session. `initial` applies as long as nothing is stored under `key`. */
export function useSessionState<T>(key: string, initial: T): [T, (next: Update<T>) => void] {
  // An initial value as with useState — a new object per render changes nothing.
  const initialRef = useRef(initial);
  const stored = useSessionStore((s) => s.values[key]) as T | undefined;
  const value = stored === undefined ? initialRef.current : stored;
  const setValue = useCallback((next: Update<T>) => {
    useSessionStore.setState((s) => {
      const prev = (key in s.values ? s.values[key] : initialRef.current) as T;
      const resolved = typeof next === 'function' ? (next as (prev: T) => T)(prev) : next;
      return { values: { ...s.values, [key]: resolved } };
    });
  }, [key]);
  return [value, setValue];
}

export function clearSessionState(): void {
  useSessionStore.setState({ values: {} });
}
