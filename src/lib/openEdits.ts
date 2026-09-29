import { askInTab, useUIStore } from '../store/uiStore';
import { confirmLeave, holdsOpenEdit, leaveNeedsConfirm } from '../store/leaveGuardStore';
import { flushDrafts } from '../store/draftStore';
import { drainSerialized } from './serialize';

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

  // Je Tab neu nachgesehen (`askInTab`): „Fertig" auf der offenen Seite beendet auch deren Tab.
  const pending = useUIStore.getState().tabs.filter((tab) => holdsOpenEdit(tab.view)).map((tab) => tab.id);
  for (const id of pending) {
    if (!(await askInTab(id))) return false;
  }

  const { tabs, activeTabId, selectTab } = useUIStore.getState();
  if (origin && origin !== activeTabId && tabs.some((tab) => tab.id === origin)) selectTab(origin);
  return true;
}

/** Gibt es irgendwo eine Bearbeitung, nach der `resolveOpenEdits` fragen würde? */
export function hasOpenEdits(): boolean {
  return leaveNeedsConfirm() || useUIStore.getState().tabs.some((tab) => holdsOpenEdit(tab.view));
}

/**
 * Vor allem, was die App ohne weitere Frage beendet — Fenster zu, Update
 * installieren: die offenen Bearbeitungen klären, dann abwarten, was noch
 * geschrieben wird (was „Speichern" und das Durchschalten der Tabs auslösten,
 * und dass ein eben verworfener Entwurf auch aus der Datei ist). `false`:
 * weiter bearbeiten.
 */
export async function settleBeforeExit(): Promise<boolean> {
  if (!(await resolveOpenEdits())) return false;
  await Promise.all([drainSerialized(), flushDrafts()]);
  return true;
}
