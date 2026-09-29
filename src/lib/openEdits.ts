import { useUIStore } from '../store/uiStore';
import { confirmLeave, guardKey, guardRegistered, holdsOpenEdit, useLeaveGuardStore } from '../store/leaveGuardStore';

/**
 * Vor allem, was jede offene Seite auf einmal schließt — Vault-Wechsel,
 * Ersetzen aus einer Sicherung, Update, Fenster zu: fragt der Reihe nach für
 * jede laufende Bearbeitung mit Änderungen (`leaveGuardStore`), erst die offene
 * Seite, dann die Tabs im Hintergrund. Dorthin wird gewechselt, damit man
 * sieht, worum es geht; sind alle geklärt, steht man wieder im Tab vom Anfang.
 *
 * `false`, sobald jemand „Weiter bearbeiten" wählt: dann steht man in genau
 * dieser Seite, und der Aufrufer lässt sein Vorhaben fallen.
 */
export async function resolveOpenEdits(): Promise<boolean> {
  const origin = useUIStore.getState().activeTabId;
  if (!(await confirmLeave())) return false;

  const pending = useUIStore.getState().tabs.filter((tab) => holdsOpenEdit(tab.view)).map((tab) => tab.id);
  for (const id of pending) {
    const { tabs, activeTabId, selectTab } = useUIStore.getState();
    // Die Seite kann sich inzwischen geändert haben: „Fertig" auf der offenen beendet auch deren Tab.
    const tab = tabs.find((candidate) => candidate.id === id);
    if (!tab || !holdsOpenEdit(tab.view)) continue;
    const key = guardKey(tab.view.type, tab.view.id);
    if (activeTabId !== id) selectTab(id);
    // Meldet sich die Seite nicht, gibt es niemanden zu fragen — ihre Arbeit
    // ist gespeichert (Autosave) oder mitgeschrieben (Entwurf).
    if (!(await guardRegistered(key))) continue;
    // Nur fragen, wenn wirklich diese Seite offen ist — sonst gälte die Frage einer anderen.
    if (useUIStore.getState().activeTabId !== id || useLeaveGuardStore.getState().guard?.key !== key) return false;
    if (!(await confirmLeave())) return false;
  }

  const { tabs, activeTabId, selectTab } = useUIStore.getState();
  if (origin && origin !== activeTabId && tabs.some((tab) => tab.id === origin)) selectTab(origin);
  return true;
}

/** Gibt es irgendwo eine Bearbeitung, nach der `resolveOpenEdits` fragen würde? */
export function hasOpenEdits(): boolean {
  const { guard } = useLeaveGuardStore.getState();
  if (guard) {
    try {
      if (guard.isDirty()) return true;
    } catch {
      // Wie in `leaveNeedsConfirm`: ein Wächter ohne Antwort zählt nicht.
    }
  }
  return useUIStore.getState().tabs.some((tab) => holdsOpenEdit(tab.view));
}
