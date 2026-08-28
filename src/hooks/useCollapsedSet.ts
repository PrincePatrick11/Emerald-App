import { useCallback } from 'react';
import { useUIStore } from '../store/uiStore';

export type CollapseScope = 'journal' | 'wiki' | 'operations' | 'tasks';

const EMPTY: ReadonlySet<string> = new Set();

/**
 * Zuklapp-Zustand der Kategorie-Gruppen eines Moduls (Tasks, Wiki, Operations).
 *
 * Der Zustand liegt im uiStore, nicht View-lokal: MainArea unmountet die Views
 * beim Modulwechsel, ein useState wäre nach jedem Rail-Klick wieder leer.
 * Bewusst nicht persistiert: nach einem Neustart (und nach Vault-Wechsel,
 * siehe closeAllTabs) sind alle Gruppen wieder offen — zugeklappt ist eine
 * Arbeitsgeste, kein Einstellungswert.
 */
export function useCollapsedSet(scope: CollapseScope) {
  const collapsed = useUIStore((s) => s.collapsedGroups[scope]) ?? EMPTY;
  const toggleInStore = useUIStore((s) => s.toggleCollapsedGroup);
  const expandInStore = useUIStore((s) => s.expandCollapsedGroups);

  const toggle = useCallback((id: string) => toggleInStore(scope, id), [toggleInStore, scope]);
  /** Öffnet gezielt (z. B. Tiefenlink aus der Suche): nimmt die ids aus dem Set. */
  const expand = useCallback((...ids: string[]) => expandInStore(scope, ids), [expandInStore, scope]);

  return { collapsed, toggle, expand };
}
