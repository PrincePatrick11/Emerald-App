import { useCallback } from 'react';
import { useUIStore } from '../store/uiStore';

/**
 * Ein Ein/Aus-Zustand, der den Neustart überlebt — eine Vorliebe wie „welcher
 * Abschnitt des Altar-Dashboards zugeklappt bleibt". Dauerhaft und je Vault,
 * mit den übrigen Vorlieben (`uiStore.flags`, `vaultPrefs`).
 *
 * Hat ein Vault den Schlüssel noch nie gesetzt, gilt, was vor den Vorlieben je
 * Vault app-weit unter demselben Schlüssel stand — nach dem Update springt so
 * nichts auf.
 */
export function usePersistedFlag(key: string, fallback = false): [boolean, () => void, (value: boolean) => void] {
  const value = useUIStore((s) => resolve(s.flags, key, fallback));
  const setFlag = useUIStore((s) => s.setFlag);

  const set = useCallback((next: boolean) => setFlag(key, next), [key, setFlag]);
  const toggle = useCallback(() => {
    setFlag(key, !resolve(useUIStore.getState().flags, key, fallback));
  }, [key, fallback, setFlag]);

  return [value, toggle, set];
}

function resolve(flags: Record<string, boolean>, key: string, fallback: boolean): boolean {
  return flags[key] ?? legacyFlag(key) ?? fallback;
}

function legacyFlag(key: string): boolean | undefined {
  try {
    const saved = localStorage.getItem(key);
    return saved === null ? undefined : saved === '1';
  } catch {
    return undefined;
  }
}
