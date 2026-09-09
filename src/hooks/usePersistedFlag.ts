import { useCallback, useState } from 'react';

/**
 * Ein Ein/Aus-Zustand, der den Neustart überlebt.
 *
 * Für Vorlieben — welcher Abschnitt des Altar-Dashboards zugeklappt bleibt —,
 * nicht für Arbeitsgesten: die halten `useCollapsedSet` und der uiStore
 * bewusst nur für die Sitzung. Der Wert liegt roh als „1"/„0" im
 * localStorage, damit man ihn beim Debuggen lesen kann.
 */
export function usePersistedFlag(key: string, fallback = false): [boolean, () => void] {
  const [value, setValue] = useState(() => {
    const saved = localStorage.getItem(key);
    return saved === null ? fallback : saved === '1';
  });

  const toggle = useCallback(() => {
    setValue((prev) => {
      const next = !prev;
      localStorage.setItem(key, next ? '1' : '0');
      return next;
    });
  }, [key]);

  return [value, toggle];
}
