import { useAltarStore } from './altarStore';
import { useUIStore } from './uiStore';
import { registerEditProbe } from './leaveGuardStore';
import { drainSerialized } from '../lib/serialize';
import type { AltarPlacement, AltarRecord } from '../types';

/**
 * Der Altar, wie er war, als „Bearbeiten" gedrückt wurde — samt seinen
 * Platzierungen. Anders als ein Eintrag speichert der Altar jede Handlung
 * sofort (Platzieren, Ziehen, Hintergrund, Raster …); ohne diesen Stand gäbe
 * es für Cancel nichts, wohin es zurück könnte.
 *
 * Wie der Ausgangsstand der Einträge (`useEntryEditor`) außerhalb der
 * Komponente: die Bearbeitung überlebt den Blick in einen anderen Tab. Ein
 * Stand lebt, solange irgendein Tab den Altar im Bearbeiten zeigt — das liest
 * der Abgleich unten am `uiStore` ab. Nur im Speicher.
 *
 * Nicht Teil des Stands ist die Bibliothek: ein Element gehört allen Altären,
 * und was an ihm geändert wird, bleibt. Wurde ein Element inzwischen gelöscht,
 * kommt seine Platzierung mit Cancel nicht zurück.
 */
interface AltarSnapshot {
  altar: AltarRecord;
  placements: AltarPlacement[];
}

const snapshots = new Map<string, AltarSnapshot>();

/**
 * Stände, die der Abgleich unten nicht räumen darf, obwohl kein Tab den Altar
 * mehr im Bearbeiten zeigt: Cancel schreibt gerade zurück — die Ansicht ist
 * dann schon gewechselt —, oder ist daran gescheitert und soll es beim
 * nächsten Mal zu Ende bringen können.
 */
const held = new Set<string>();

/**
 * Was für einen Altar gerade noch geschrieben wird, ohne in einer
 * Schreibkette zu hängen: „Fertig" (Titel, Vorschaubild) und die Aufnahme des
 * Vorschaubilds beim Wegschalten. Ein neuer Stand wartet darauf — sonst
 * merkte er sich den Titel von vor dem „Fertig" —, und Cancel auch, damit
 * nichts davon nach dem Zurückschreiben landet.
 */
const writing = new Map<string, Promise<unknown>>();

export function trackAltarWrite(id: string, write: Promise<unknown>): void {
  const tracked = Promise.allSettled([writing.get(id), write]).finally(() => {
    if (writing.get(id) === tracked) writing.delete(id);
  });
  writing.set(id, tracked);
}

function isEditingAltar(id: string): boolean {
  const { activeView, tabs } = useUIStore.getState();
  return [activeView, ...tabs.map((tab) => tab.view)]
    .some((view) => view.type === 'altar' && view.id === id && view.mode === 'edit');
}

useUIStore.subscribe(() => {
  for (const id of snapshots.keys()) {
    if (!held.has(id) && !isEditingAltar(id)) snapshots.delete(id);
  }
});

/**
 * Die Platzierungen, wie sie gerade sind. Für den offenen Altar die aktive
 * Liste: sie kommt frisch aus der Datenbank, während `previewPlacements` für
 * einen Altar auch einmal fehlen kann.
 */
function currentPlacements(id: string): AltarPlacement[] {
  const { activeAltarId, placements, previewPlacements } = useAltarStore.getState();
  return activeAltarId === id ? placements : previewPlacements[id] ?? [];
}

/** Merkt sich den Altar beim Betreten des Bearbeitens. Läuft die Bearbeitung schon, bleibt ihr Stand. */
export async function beginAltarEdit(id: string): Promise<void> {
  await writing.get(id);
  // Inzwischen kann die Bearbeitung beendet oder der Stand schon da sein.
  if (snapshots.has(id) || !isEditingAltar(id)) return;
  const altar = useAltarStore.getState().altars.find((entry) => entry.id === id);
  if (!altar) return;
  snapshots.set(id, { altar, placements: currentPlacements(id) });
}

/**
 * Was an einem Altar zählt, wenn es um „geändert oder nicht" geht. Eine
 * Feldliste statt des ganzen Records: ein frisch angelegter trägt manche
 * Felder gar nicht, die nach dem nächsten Laden `null` heißen. Zeitstempel und
 * Vorschaubild fehlen mit Absicht — die folgen nur.
 */
function comparableAltar(altar: AltarRecord, title = altar.title): string {
  return JSON.stringify([
    title, altar.intention,
    altar.background_preset, altar.background_image_data ?? null, altar.background_overlay, altar.background_overlay_color,
    altar.grid_enabled, altar.grid_size, altar.grid_opacity, altar.grid_color,
    altar.snap_to_grid, altar.rotation_snap_enabled, altar.rotation_snap_angle, altar.snap_scale_to_grid,
    altar.resolution, altar.icon_data ?? null,
  ]);
}

/** Nur, was die Platzierung selbst trägt — Name, Emoji und Bild gehören dem Bibliothekselement. */
function comparablePlacements(placements: readonly AltarPlacement[]): string {
  return JSON.stringify(
    placements
      .map(({ id, item_id, x, y, z_index, width, height, rotation, opacity, locked, hidden }) =>
        ({ id, item_id, x, y, z_index, width, height, rotation, opacity, locked, hidden }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}

/**
 * Wurde der Altar seit dem Betreten des Bearbeitens geändert? `title`: der
 * getippte, noch nicht gespeicherte Titel — der Altar speichert ihn erst mit
 * „Fertig".
 */
export function altarEditChanged(id: string, title?: string): boolean {
  const snapshot = snapshots.get(id);
  if (!snapshot) return false;
  const altar = useAltarStore.getState().altars.find((entry) => entry.id === id);
  if (!altar) return false;
  return comparableAltar(altar, title?.trim() || altar.title) !== comparableAltar(snapshot.altar)
    || comparablePlacements(currentPlacements(id)) !== comparablePlacements(snapshot.placements);
}

/**
 * Trägt die Bearbeitung des Altars etwas, wonach beim Verlassen zu fragen
 * wäre? Ein neuer, nie bestätigter immer; ein gelöschter nie. Der Wächter der
 * offenen Seite und die Probe für Tabs im Hintergrund fragen beide hier.
 */
export function altarEditDirty(id: string, isNew: boolean, title?: string): boolean {
  if (!useAltarStore.getState().altars.some((altar) => altar.id === id)) return false;
  return isNew || altarEditChanged(id, title);
}

/** „Fertig": die Bearbeitung ist bestätigt, ihr Stand wird nicht mehr gebraucht. */
export function endAltarEdit(id: string): void {
  held.delete(id);
  snapshots.delete(id);
}

/**
 * Cancel: schreibt den gemerkten Stand zurück — auch wenn nur Zeitstempel und
 * Vorschaubild abweichen, damit der Altar in den Listen steht, wo er stand.
 * Scheitert das Schreiben, wirft es, und der Stand bleibt für einen zweiten
 * Versuch: das nächste „Bearbeiten" setzt auf ihm auf, das nächste Cancel
 * bringt es zu Ende.
 */
export async function restoreAltarEdit(id: string): Promise<void> {
  // Vor dem ersten await: die Ansicht wechselt gleich, und der Abgleich oben
  // räumte den Stand weg, während hier noch gewartet wird.
  const snapshot = snapshots.get(id);
  if (!snapshot) return;
  held.add(id);
  // Was noch unterwegs ist (ein Vorschaubild, ein Schieberegler), erst zu
  // Ende bringen — sonst landete es nach dem Zurückschreiben.
  await writing.get(id);
  await drainSerialized();
  const altar = useAltarStore.getState().altars.find((entry) => entry.id === id);
  const untouched = !!altar && !altarEditChanged(id)
    && altar.updated_at === snapshot.altar.updated_at
    && (altar.thumbnail_data ?? null) === (snapshot.altar.thumbnail_data ?? null);
  if (!untouched) await useAltarStore.getState().restoreAltarSnapshot(snapshot.altar, snapshot.placements);
  endAltarEdit(id);
}

// Für Tabs im Hintergrund: trägt die Bearbeitung dort Änderungen (`leaveGuardStore`)?
registerEditProbe((view) =>
  view.type === 'altar' && view.mode === 'edit' && !!view.id && snapshots.has(view.id)
    && altarEditDirty(view.id, !!view.isNew));
