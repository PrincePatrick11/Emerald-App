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
export function usePersistedFlag(key: string, fallback = false): [boolean, () => void] {
  const stored = useUIStore((s) => s.flags[key]);
  const setFlag = useUIStore((s) => s.setFlag);
  const value = stored ?? legacyFlag(key) ?? fallback;

  const toggle = useCallback(() => {
    const current = useUIStore.getState().flags[key] ?? legacyFlag(key) ?? fallback;
    setFlag(key, !current);
  }, [key, fallback, setFlag]);

  return [value, toggle];
}

function legacyFlag(key: string): boolean | undefined {
  try {
    const saved = localStorage.getItem(key);
    return saved === null ? undefined : saved === '1';
  } catch {
    return undefined;
  }
}
