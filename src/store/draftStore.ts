import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { registerEditProbe } from './leaveGuardStore';
import { isDefinitionId, parseDefinitionDisplay, parseDefinitionElements } from '../lib/blocks/definitions';
import type { BlockDefinitionPatch } from './blockDefinitionStore';
import type { TemplatePatch } from './templateStore';
import type { VaultFileRead } from '../lib/vaultSettings';
import { tagNameKey } from '../lib/tagRefs';
import { contentWithoutLegacySigils, legacySigilLabels } from '../lib/blocks/legacySigilBlocks';
import i18n from '../i18n';

/** What the page of a custom block edits — exactly what `updateDefinition` accepts. */
export type DefinitionDraft = Required<BlockDefinitionPatch>;

/** What the page of a template edits — what `updateTemplate` accepts. */
export type TemplateDraft = Required<TemplatePatch>;

/**
 * An open draft: the state on opening (`base`) and the edit
 * (`draft`). "Done" saves only what has changed relative to `base` —
 * whatever other places have written in the meantime (a renamed tag) stays in place.
 */
export interface DraftEntry<T> {
  base: T;
  draft: T;
}

export interface DraftState<T> {
  /** Unsaved drafts per id. */
  drafts: Readonly<Record<string, DraftEntry<T>>>;
  saveDraft: (id: string, entry: DraftEntry<T>) => void;
  /** Finished: saved with "Done", cancelled or deleted. */
  clearDraft: (id: string) => void;
  /**
   * Remove all, including the persisted ones — when replacing from a backup,
   * where all tabs close as well. After a restore the same ids come back;
   * an old draft would otherwise overwrite the restored data with "Done".
   * (A vault switch only takes them out of memory:
   * `restoreDrafts`.)
   */
  clearAll: () => void;
}

export type DraftStore<T> = UseBoundStore<StoreApi<DraftState<T>>>;

/** The kinds of drafts — also the view type of their page and their key in `drafts.json`. */
type DraftKind = 'blocks' | 'templates';

/** Brings what was in the file into the shape of a draft — field by field, like `fromRow` does for a row. */
type Normalize<T> = (raw: Record<string, unknown>) => T;

const stores: { kind: DraftKind; store: DraftStore<unknown>; normalize: Normalize<unknown> }[] = [];

/* ---------------- Persisting alongside ---------------- */

/**
 * Drafts are persisted as they are typed, so a crash takes nothing that had
 * been typed — for an entry the autosave does that. In `drafts.json` in the
 * vault folder, via Rust: the call returns once the file has been
 * written (the window waits for it on close — the WebView's storage, which
 * writes with a delay, could not promise that), and the content of a vault
 * stays in its folder.
 */
/** 2 since v53: template drafts carry tag IDs instead of names (a 1 is converted on read). */
const DRAFTS_VERSION = 2;
const PERSIST_DELAY_MS = 400;


/** The vault whose drafts are in memory — `null` while none is loaded. Then nothing is written. */
let draftVaultId: string | null = null;
/** While `restoreDrafts` fills the stores: the filling itself writes nothing back. */
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
 * Writes immediately whatever is still pending, and waits for it — ahead of
 * anything that ends the app (window close, update) or switches the vault.
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
  // An empty object without drafts: Rust then removes the file.
  const contents = JSON.stringify(Object.keys(byKind).length ? { version: DRAFTS_VERSION, ...byKind } : {});
  writing = writing
    .then(() => invoke<void>('write_vault_drafts', { vaultId, contents }))
    .catch((err: unknown) => {
      // The draft stays in memory, and the next occasion writes again
      // — at the latest the closing of the window. Otherwise the disk would
      // hold a draft that was discarded long ago.
      if (draftVaultId === vaultId) unwritten = true;
      console.warn('[drafts] could not write drafts', err);
    });
  return writing;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The drafts of one kind from the file — only what has the shape of a draft.
 * A draft without a name on both sides is not one this app
 * wrote, and one with no difference from the state on opening has
 * nothing to preserve: both are dropped instead of showing up as an empty page.
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
 * A file from before v53: the template drafts carry tag names. They become
 * IDs of this vault's tags (case-insensitively); a name without
 * a tag is dropped.
 */
async function withTemplateTagIds(file: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!isPlainObject(file.templates)) return file;
  const { getDb } = await import('../lib/db');
  const rows = await (await getDb()).select<{ id: string; name: string }[]>('SELECT id, name FROM tags');
  const byName = new Map(rows.map((r) => [tagNameKey(r.name), r.id]));
  const toIds = (side: unknown) => {
    if (!isPlainObject(side) || !Array.isArray(side.tags)) return side;
    const ids = side.tags.flatMap((name) => (typeof name === 'string' ? byName.get(tagNameKey(name)) ?? [] : []));
    return { ...side, tags: [...new Set(ids)] };
  };
  const templates = Object.fromEntries(Object.entries(file.templates).map(([id, entry]) => [
    id,
    isPlainObject(entry) ? { ...entry, base: toIds(entry.base), draft: toIds(entry.draft) } : entry,
  ]));
  return { ...file, templates };
}

/**
 * What is in the file. `foreign`: it comes from a newer version —
 * then this build neither reads it nor touches it.
 */
async function readDraftsFile(vaultId: string): Promise<{ drafts: Record<string, unknown>; foreign: boolean }> {
  try {
    const read = await invoke<VaultFileRead>('read_vault_drafts', { vaultId });
    if (read.kind !== 'found') return { drafts: {}, foreign: false };
    const parsed: unknown = JSON.parse(read.contents);
    if (!isPlainObject(parsed)) return { drafts: {}, foreign: false };
    if (parsed.version === DRAFTS_VERSION) return { drafts: parsed, foreign: false };
    if (parsed.version === 1) return { drafts: await withTemplateTagIds(parsed), foreign: false };
    return { drafts: {}, foreign: typeof parsed.version === 'number' && parsed.version > DRAFTS_VERSION };
  } catch (err) {
    console.warn('[drafts] could not read drafts', err);
    return { drafts: {}, foreign: false };
  }
}

/**
 * The drafts of the vault that is being opened right now: what a crash left
 * behind then shows up again as "Unsaved" in the lists, and
 * the page continues there. Those of the previous vault only leave
 * memory — their file stays, it belongs to that vault.
 *
 * One after another, never side by side: two runs overtaking each other (the
 * double effect in dev mode) would otherwise write one's state over the
 * file while the other is still reading it.
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
      // Without `draftVaultId` nothing is written: the drafts of the newer
      // version stay put, new ones live only in memory in this session.
      console.warn('[drafts] drafts.json was written by a newer version, leaving it alone');
      return;
    }
    draftVaultId = vaultId;
  });
  return restoring;
}

/**
 * Take the drafts out of memory without touching their file — before the
 * vault is switched or removed. Whatever is still pending is written first.
 */
export async function detachDrafts(): Promise<void> {
  await flushDrafts();
  draftVaultId = null;
  for (const { store } of stores) store.setState({ drafts: {} });
}

/* ---------------- Stores ---------------- */

/**
 * The unsaved drafts of the pages that save only with "Done" —
 * custom blocks and templates, one store each. In the store rather than in the view,
 * because MainArea unmounts the view when switching to another module — an
 * open tab would otherwise silently lose its work. The lists read their
 * "Unsaved" hint from it.
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
  // For background tabs: a draft means unsaved changes (`leaveGuardStore`).
  registerEditProbe((view) => view.type === kind && !!view.id && view.id in store.getState().drafts);
  return store;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export const useBlockDraftStore = createDraftStore<DefinitionDraft>('blocks', (raw) => ({
  name: text(raw.name),
  icon: text(raw.icon),
  elements: parseDefinitionElements(raw.elements),
  display: parseDefinitionDisplay(raw.display),
}));

export const useTemplateDraftStore = createDraftStore<TemplateDraft>('templates', (raw) => ({
  name: text(raw.name),
  icon: text(raw.icon),
  title: text(raw.title),
  // A draft from before v64 with the old sigil blocks, as the migration converted its template.
  content: contentWithoutLegacySigils(text(raw.content), legacySigilLabels(i18n.t)),
  tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === 'string') : [],
}));

/** Empty all draft lists, including the persisted ones — see `clearAll`. */
export function clearAllDrafts(): void {
  for (const { store } of stores) store.getState().clearAll();
}
