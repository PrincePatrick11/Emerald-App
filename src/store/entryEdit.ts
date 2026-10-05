import { viewTypeForEntryType, type ViewId } from '../lib/modules';
import { isInEdit, useUIStore } from './uiStore';
import { guardKey, registerEditProbe } from './leaveGuardStore';
import { useEntryStore } from './entryStore';
import type { Entry, EntryType } from '../types';

/**
 * Die Ausgangsstände der laufenden Bearbeitungen, je Ansicht und Eintrag — wie
 * der Eintrag aussah, als „Bearbeiten" gedrückt wurde. Außerhalb der
 * Komponente, weil eine Bearbeitung ihre View überlebt: wer mittendrin in
 * einen anderen Tab schaut, kommt in dieselbe Bearbeitung zurück, und Cancel
 * geht dann bis zu ihrem Anfang, nicht nur bis zum Tabwechsel.
 *
 * Ein Stand lebt, solange irgendein Tab den Eintrag im Bearbeiten zeigt.
 * „Fertig", Cancel, Löschen, das Schließen des Tabs und ein Wechsel der Seite
 * im selben Tab beenden die Bearbeitung — das liest der Abgleich unten am
 * `uiStore` ab, keine View muss es melden. Nur im Speicher: ein Neustart
 * beginnt mit dem, was gespeichert ist.
 *
 * Ein Typwechsel beendet die Bearbeitung nicht: der Stand zieht mit in die
 * neue Ansicht (`carryBaseline`) und merkt sich, woher der Eintrag kam — Cancel
 * bringt ihn dorthin zurück (`revertEntryType`).
 */
export interface EditBaseline {
  scope: ViewId;
  id: string;
  patch: BaselineFields;
  /** „Zuletzt geändert" beim Betreten — Cancel stellt ihn mit dem Rest wieder her. */
  stamp: string | undefined;
  /** Der gespeicherte Stand, in der Form von `patch` — `null`, wenn es den Eintrag nicht mehr gibt. */
  stored: () => unknown;
  /** Nur nach einem Typwechsel: was der Eintrag beim Betreten war. `patch` hat dann die Form jener Ansicht. */
  origin?: EditOrigin;
}

/** Was ein Ausgangsstand festhält: ein Ausschnitt des Eintrags — das Journal nur die ersten drei Felder. */
export type BaselineFields = Partial<Pick<Entry, 'title' | 'content' | 'tags' | 'category_id' | 'icon' | 'cover_image'>>;

/** Typ und Nummer eines Eintrags, bevor er während der Bearbeitung den Typ wechselte. */
export interface EditOrigin {
  type: EntryType;
  entry_number: number | undefined;
}

export const baselines = new Map<string, EditBaseline>();

export const baselineKey = guardKey;

/**
 * Trägt eine Bearbeitung Änderungen? Die eine Regel für den Wächter der
 * offenen Seite und die Probe im Hintergrund: ein gelöschter Eintrag
 * (`stored === null`) hat nichts mehr zu sichern; ein neuer, nie bestätigter,
 * einer mit ausstehendem Autosave oder mit gewechseltem Typ immer; sonst
 * zählt, ob der gespeicherte Stand vom Ausgangsstand abweicht.
 */
export function editIsDirty(stored: unknown, baseline: EditBaseline | undefined, isNew: boolean, pending = false): boolean {
  if (stored === null) return false;
  if (isNew || pending || baseline?.origin) return true;
  return baseline !== undefined && JSON.stringify(stored) !== JSON.stringify(baseline.patch);
}

/**
 * Der Ausgangsstand der Bearbeitung von `id` — unter welcher Ansicht er auch
 * gerade liegt: nach einem Typwechsel ist das nicht mehr die, in der
 * „Bearbeiten" gedrückt wurde.
 */
export function baselineOf(id: string): EditBaseline | undefined {
  for (const baseline of baselines.values()) {
    if (baseline.id === id) return baseline;
  }
  return undefined;
}

/** Woher der Eintrag kam, wenn er in dieser Bearbeitung schon den Typ gewechselt hat. */
export function originOfEdit(id: string, type: EntryType): EditOrigin | undefined {
  return baselines.get(baselineKey(viewTypeForEntryType(type), id))?.origin;
}

/**
 * Nimmt den Ausgangsstand beim Typwechsel mit in die Ansicht des neuen Typs.
 * Beim ersten Wechsel merkt er sich `source` als Herkunft; führt der Wechsel
 * dorthin zurück, ist es wieder eine gewöhnliche Bearbeitung. Muss laufen,
 * bevor die Tabs umziehen (`retypeEntryViews`) — der Abgleich unten räumte den
 * Stand sonst weg.
 *
 * `stored` las bisher über die alte Ansicht und fände den Eintrag dort nicht
 * mehr („gelöscht"). Bis die neue Ansicht montiert und ihren Leser einsetzt
 * (`useEntryEditor`), sagt er nur, ob es den Eintrag gibt — in einem Tab, der
 * vorher in den Hintergrund ging, bleibt es dabei.
 */
export function carryBaseline(id: string, from: EntryType, to: EntryType, source: EditOrigin): void {
  const fromKey = baselineKey(viewTypeForEntryType(from), id);
  const baseline = baselines.get(fromKey);
  if (!baseline) return;
  const origin = baseline.origin ?? source;
  const scope = viewTypeForEntryType(to);
  baselines.delete(fromKey);
  baselines.set(baselineKey(scope, id), {
    ...baseline,
    scope,
    origin: origin.type === to ? undefined : origin,
    stored: () => (useEntryStore.getState().getEntry(id, to) ? {} : null),
  });
}

/**
 * Die Einträge, deren Bearbeitung Cancel gerade verwirft. Was eine View jetzt
 * noch speichern würde — der Debounce, der Save beim Wegnavigieren oder beim
 * Abbau —, schriebe die verworfene Eingabe über den wiederhergestellten
 * Eintrag. Je Eintrag und nicht je View: nimmt Cancel einen Typwechsel zurück,
 * wird nicht nur die View abgebaut, in der es gedrückt wurde.
 */
const discarding = new Set<string>();

export const isDiscarding = (id: string): boolean => discarding.has(id);

/** Cancel beginnt. `endDiscard` hebt es auf — spätestens die nächste Bearbeitung des Eintrags. */
export function beginDiscard(id: string): void {
  discarding.add(id);
}

export function endDiscard(id: string): void {
  discarding.delete(id);
}

useUIStore.subscribe((s) => {
  for (const [key, { scope, id }] of baselines) {
    if (!isInEdit(s, scope, id)) baselines.delete(key);
  }
});

// Für Tabs im Hintergrund: trägt die Bearbeitung dort Änderungen? Beim
// Wegschalten hat der Editor gespeichert, der gespeicherte Stand sagt also alles.
registerEditProbe((view) => {
  if (view.mode !== 'edit' || !view.id) return false;
  const baseline = baselines.get(baselineKey(view.type, view.id));
  return !!baseline && editIsDirty(baseline.stored(), baseline, !!view.isNew);
});
