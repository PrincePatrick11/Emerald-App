import { useCallback } from 'react';
import { useUIStore } from '../store/uiStore';

export type CollapseScope = 'journal' | 'wiki' | 'operations' | 'tasks' | 'altar-library' | 'tags';

const EMPTY: ReadonlySet<string> = new Set();

/**
 * Zuklapp-Zustand der Kategorie-Gruppen eines Moduls (Tasks, Wiki, Operations,
 * die Bibliothek im Altar-Dashboard und die Tags).
 *
 * Der Zustand liegt im uiStore, nicht View-lokal: MainArea unmountet die Views
 * beim Modulwechsel, ein useState wäre nach jedem Rail-Klick wieder leer.
 * Bewusst nicht persistiert: nach einem Neustart (und nach Vault-Wechsel,
 * siehe closeAllTabs) steht wieder der Standard — zugeklappt ist eine
 * Arbeitsgeste, kein Einstellungswert.
 *
 * `defaultCollapsed` dreht den Standard um (Tags: viele Gruppen, die Liste der
 * Köpfe ist die Übersicht). Das Set im Store hält dann die *aufgeklappten*
 * ids; `isCollapsed` und `expand` verbergen das.
 */
export function useCollapsedSet(scope: CollapseScope, { defaultCollapsed = false }: { defaultCollapsed?: boolean } = {}) {
  const deviating = useUIStore((s) => s.collapsedGroups[scope]) ?? EMPTY;
  const toggleInStore = useUIStore((s) => s.toggleCollapsedGroup);
  const removeInStore = useUIStore((s) => s.removeCollapsedGroups);
  const addInStore = useUIStore((s) => s.addCollapsedGroups);

  const toggle = useCallback((id: string) => toggleInStore(scope, id), [toggleInStore, scope]);
  const isCollapsed = useCallback(
    (id: string) => deviating.has(id) !== defaultCollapsed,
    [deviating, defaultCollapsed],
  );
  /** Öffnet gezielt (z. B. Tiefenlink aus der Suche). */
  const expand = useCallback(
    (...ids: string[]) => (defaultCollapsed ? addInStore : removeInStore)(scope, ids),
    [addInStore, removeInStore, scope, defaultCollapsed],
  );

  return { isCollapsed, toggle, expand };
}
