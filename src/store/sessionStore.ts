import { useCallback, useRef } from 'react';
import { create } from 'zustand';

/**
 * Der Arbeitszustand der Listen — Suche, Filter, Auswahl —, je Ansicht unter
 * einem Schlüssel wie `wiki.search`. Er überlebt den Wechsel des Moduls: wer
 * vom gefilterten Wiki kurz ins Journal schaut, findet den Filter wieder. Den
 * Neustart überlebt er nicht, und auch nicht den Vault-Wechsel oder das
 * Ersetzen aus einer Sicherung (`clearSessionState`, aus `closeAllTabs`) —
 * seine ids zeigten dann ins Leere.
 *
 * Das Gegenstück, die Vorlieben (Ansicht, Sortierung, Klappzustände), bleibt
 * dauerhaft je Vault (`vaultPrefs`).
 *
 * Importiert keinen anderen Store.
 */
const useSessionStore = create<{ values: Record<string, unknown> }>(() => ({ values: {} }));

type Update<T> = T | ((prev: T) => T);

/** Wie `useState`, aber für die Sitzung aufbewahrt. `initial` gilt, solange unter `key` nichts steht. */
export function useSessionState<T>(key: string, initial: T): [T, (next: Update<T>) => void] {
  // Ein Anfangswert wie bei useState — ein neues Objekt je Render ändert nichts.
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
