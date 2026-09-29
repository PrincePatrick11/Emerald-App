import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { registerEditProbe } from './leaveGuardStore';
import { isDefinitionId, parseDefinitionDisplay, parseDefinitionElements } from '../lib/blocks/definitions';
import { parseAssignments } from '../lib/blocks/templates';
import type { BlockDefinitionPatch } from './blockDefinitionStore';
import type { TemplatePatch } from './templateStore';

/** Was die Seite eines eigenen Blocks bearbeitet — genau das, was `updateDefinition` annimmt. */
export type DefinitionDraft = Required<BlockDefinitionPatch>;

/**
 * Was die Seite einer Vorlage bearbeitet — was `updateTemplate` annimmt, ohne
 * die Beschreibung: dafür hat die Seite kein Feld mehr, die Spalte bleibt für
 * Import und Export.
 */
export type TemplateDraft = Required<Omit<TemplatePatch, 'description'>>;

/**
 * Ein offener Entwurf: der Stand beim Öffnen (`base`) und die Bearbeitung
 * (`draft`). „Fertig" speichert nur, was sich gegenüber `base` geändert hat —
 * was andere Stellen inzwischen geschrieben haben (ein umbenannter Tag, ein
 * Stern, den eine andere Vorlage übernommen hat), bleibt so stehen.
 */
export interface DraftEntry<T> {
  base: T;
  draft: T;
}

export interface DraftState<T> {
  /** Ungespeicherte Entwürfe je id. */
  drafts: Readonly<Record<string, DraftEntry<T>>>;
  saveDraft: (id: string, entry: DraftEntry<T>) => void;
  /** Erledigt: mit „Fertig" gespeichert, abgebrochen oder gelöscht. */
  clearDraft: (id: string) => void;
  /**
   * Alle weg, auch die mitgeschriebenen — beim Ersetzen aus einer Sicherung,
   * wo auch alle Tabs zugehen. Nach einer Wiederherstellung kommen dieselben
   * ids zurück; ein alter Entwurf schriebe sonst mit „Fertig" über das
   * Wiederhergestellte. (Der Vault-Wechsel nimmt sie nur aus dem Speicher:
   * `restoreDrafts`.)
   */
  clearAll: () => void;
}

export type DraftStore<T> = UseBoundStore<StoreApi<DraftState<T>>>;

/** Die Arten von Entwürfen — zugleich der View-Typ ihrer Seite und ihr Schlüssel in `drafts.json`. */
type DraftKind = 'blocks' | 'templates';

/** Bringt, was in der Datei stand, auf die Form eines Entwurfs — Feld für Feld, wie `fromRow` eine Zeile. */
type Normalize<T> = (raw: Record<string, unknown>) => T;

const stores: { kind: DraftKind; store: DraftStore<unknown>; normalize: Normalize<unknown> }[] = [];

/* ---------------- Mitschreiben ---------------- */

/**
 * Entwürfe werden mitgeschrieben, damit ein Absturz nichts nimmt, was getippt
 * war — bei einem Eintrag leistet das der Autosave. In `drafts.json` im
 * Vault-Ordner, über Rust: dort ist ein Schreiben abgeschlossen, wenn der
 * Aufruf zurückkehrt (das Fenster wartet beim Schließen darauf), und der
 * Inhalt eines Vaults bleibt in seinem Ordner.
 */
const DRAFTS_VERSION = 1;
const PERSIST_DELAY_MS = 400;

/** Mirrors `SettingsRead` in `src-tauri/src/vault.rs`. */
type DraftsRead = { kind: 'missing' } | { kind: 'found'; contents: string } | { kind: 'unreadable' };

/** Der Vault, dessen Entwürfe im Speicher stehen — `null`, solange keiner geladen ist. Dann wird nichts geschrieben. */
let draftVaultId: string | null = null;
/** Während `restoreDrafts` die Stores füllt: das Füllen selbst schreibt nichts zurück. */
let hydrating = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let unwritten = false;
let writing: Promise<void> = Promise.resolve();
let restoring: Promise<void> = Promise.resolve();

function schedulePersist(): void {
  if (!draftVaultId || hydrating) return;
  unwritten = true;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => void flushDrafts(), PERSIST_DELAY_MS);
}

/**
 * Schreibt sofort, was noch aussteht, und wartet darauf — vor allem, was die
 * App beendet (Fenster zu, Update) oder den Vault wechselt.
 */
export function flushDrafts(): Promise<void> {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
  if (!unwritten || !draftVaultId) return writing;
  unwritten = false;

  const vaultId = draftVaultId;
  const byKind = Object.fromEntries(
    stores
      .map(({ kind, store }) => [kind, store.getState().drafts] as const)
      .filter(([, drafts]) => Object.keys(drafts).length > 0),
  );
  // Ohne Entwürfe ein leeres Objekt: Rust nimmt dann die Datei weg.
  const contents = JSON.stringify(Object.keys(byKind).length ? { v: DRAFTS_VERSION, ...byKind } : {});
  writing = writing
    .then(() => invoke<void>('write_vault_drafts', { vaultId, contents }))
    // Scheitert das Schreiben, bleibt der Entwurf wenigstens im Speicher.
    .catch((err: unknown) => console.warn('[drafts] could not write drafts', err));
  return writing;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Die Entwürfe einer Art aus der Datei — nur, was die Form eines Entwurfs hat.
 * Ein Entwurf ohne Namen auf beiden Seiten ist keiner, den diese App
 * geschrieben hat, und einer ohne Unterschied zum Stand beim Öffnen hat
 * nichts zu sichern: beide fallen weg, statt als leere Seite aufzutauchen.
 */
function readKind(raw: unknown, normalize: Normalize<unknown>): Record<string, DraftEntry<unknown>> {
  const drafts: Record<string, DraftEntry<unknown>> = Object.create(null);
  if (!isPlainObject(raw)) return drafts;
  for (const [id, entry] of Object.entries(raw)) {
    if (!isDefinitionId(id) || !isPlainObject(entry)) continue;
    if (!isPlainObject(entry.base) || !isPlainObject(entry.draft)) continue;
    if (typeof entry.base.name !== 'string' || typeof entry.draft.name !== 'string') continue;
    const base = normalize(entry.base);
    const draft = normalize(entry.draft);
    if (JSON.stringify(base) === JSON.stringify(draft)) continue;
    drafts[id] = { base, draft };
  }
  return drafts;
}

/**
 * Was in der Datei steht. `foreign`: sie stammt von einer neueren Version —
 * dann liest dieser Build sie nicht und rührt sie auch nicht an.
 */
async function readDraftsFile(vaultId: string): Promise<{ drafts: Record<string, unknown>; foreign: boolean }> {
  try {
    const read = await invoke<DraftsRead>('read_vault_drafts', { vaultId });
    if (read.kind !== 'found') return { drafts: {}, foreign: false };
    const parsed: unknown = JSON.parse(read.contents);
    if (!isPlainObject(parsed)) return { drafts: {}, foreign: false };
    if (parsed.v === DRAFTS_VERSION) return { drafts: parsed, foreign: false };
    return { drafts: {}, foreign: typeof parsed.v === 'number' && parsed.v > DRAFTS_VERSION };
  } catch (err) {
    console.warn('[drafts] could not read drafts', err);
    return { drafts: {}, foreign: false };
  }
}

/**
 * Die Entwürfe des Vaults, der gerade geöffnet wird: was ein Absturz übrig
 * gelassen hat, steht danach wieder als „Ungespeichert" in den Listen, und
 * die Seite setzt dort fort. Die des vorigen Vaults gehen dabei nur aus dem
 * Speicher — ihre Datei bleibt, sie gehört zu jenem Vault.
 *
 * Nacheinander, nie nebeneinander: zwei Läufe, die sich überholen (der
 * doppelte Effekt im Dev-Modus), schrieben sonst den Stand des einen über die
 * Datei, während der andere sie noch liest.
 */
export function restoreDrafts(vaultId: string): Promise<void> {
  restoring = restoring.then(async () => {
    await detachDrafts();
    const file = await readDraftsFile(vaultId);
    hydrating = true;
    try {
      for (const { kind, store, normalize } of stores) {
        store.setState({ drafts: readKind(file.drafts[kind], normalize) });
      }
    } finally {
      hydrating = false;
    }
    if (file.foreign) {
      // Ohne `draftVaultId` wird nichts geschrieben: die Entwürfe der neueren
      // Version bleiben liegen, neue leben in dieser Sitzung nur im Speicher.
      console.warn('[drafts] drafts.json was written by a newer version, leaving it alone');
      return;
    }
    draftVaultId = vaultId;
  });
  return restoring;
}

/**
 * Die Entwürfe aus dem Speicher nehmen, ohne ihre Datei anzufassen — bevor der
 * Vault wechselt oder entfernt wird. Was noch aussteht, wird vorher geschrieben.
 */
export async function detachDrafts(): Promise<void> {
  await flushDrafts();
  draftVaultId = null;
  for (const { store } of stores) store.setState({ drafts: {} });
}

/* ---------------- Stores ---------------- */

/**
 * Die ungespeicherten Entwürfe der Seiten, die erst mit „Fertig" speichern —
 * eigene Blöcke und Vorlagen, je ein Store. Im Store statt in der Ansicht,
 * weil MainArea die Ansicht beim Wechsel in ein anderes Modul unmountet — ein
 * offener Tab verlöre sonst lautlos seine Arbeit. Die Listen lesen daraus
 * ihren „Ungespeichert"-Hinweis.
 */
function createDraftStore<T>(kind: DraftKind, normalize: Normalize<T>): DraftStore<T> {
  const store = create<DraftState<T>>((set) => ({
    drafts: {},
    saveDraft: (id, entry) => set((s) => ({ drafts: { ...s.drafts, [id]: entry } })),
    clearDraft: (id) => set((s) => {
      if (!(id in s.drafts)) return s;
      const { [id]: _removed, ...rest } = s.drafts;
      return { drafts: rest };
    }),
    clearAll: () => set({ drafts: {} }),
  }));
  store.subscribe(schedulePersist);
  stores.push({ kind, store: store as DraftStore<unknown>, normalize });
  // Für Tabs im Hintergrund: ein Entwurf heißt ungesicherte Änderungen (`leaveGuardStore`).
  registerEditProbe((view) => view.type === kind && !!view.id && view.id in store.getState().drafts);
  return store;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export const useBlockDraftStore = createDraftStore<DefinitionDraft>('blocks', (raw) => ({
  name: text(raw.name),
  icon: text(raw.icon),
  description: text(raw.description),
  elements: parseDefinitionElements(raw.elements),
  display: parseDefinitionDisplay(raw.display),
}));

export const useTemplateDraftStore = createDraftStore<TemplateDraft>('templates', (raw) => ({
  name: text(raw.name),
  icon: text(raw.icon),
  title: text(raw.title),
  content: text(raw.content),
  tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === 'string') : [],
  assignments: parseAssignments(raw.assignments),
}));

/** Alle Entwurfslisten leeren, auch die mitgeschriebenen — siehe `clearAll`. */
export function clearAllDrafts(): void {
  for (const { store } of stores) store.getState().clearAll();
}
