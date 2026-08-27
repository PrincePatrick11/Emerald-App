import { useCallback, useState } from 'react';

/**
 * Session-lokaler Zuklapp-Zustand für Gruppenlisten (die Kategorie-Gruppen in
 * Tasks, Wiki und Operations). Bewusst nicht persistiert: nach einem Neustart
 * sind alle Gruppen wieder offen — zugeklappt ist eine Arbeitsgeste, kein
 * Einstellungswert.
 */
export function useCollapsedSet() {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** Öffnet gezielt (z. B. Tiefenlink aus der Suche): nimmt die ids aus dem Set. */
  const expand = useCallback((...ids: string[]) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  return { collapsed, toggle, expand };
}
