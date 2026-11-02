import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import i18n from '../../i18n';
import { dbEpoch, getDb } from '../db';
import { editorSavesSuspended } from '../editorLock';
import { hasOpenEdits } from '../openEdits';
import { BASELINE_VERSION } from '../schema';
import { drainSerialized } from '../serialize';
import type Database from '../sqlite';
import { useLeaveGuardStore } from '../../store/leaveGuardStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useSyncStore } from '../../store/syncStore';
import { useUIStore } from '../../store/uiStore';
import { useVaultStore } from '../../store/vaultStore';
import { applyRemoteChanges, beginRestore, finishRestore, restoreFrame, snapshotFrames, type SnapshotFrame } from './apply';
import { flattenSettings, mergeIncomingSettings, SETTINGS_TABLE, settingsDiff, type FlatSettings } from './settings';
import {
  acknowledge,
  acknowledgeChanges,
  clearSnapshotNeeded,
  collectChanges,
  isRestoring,
  isTracked,
  markSnapshotNeeded,
  needsSnapshot,
  positionStatements,
  readPosition,
  startTracking,
  stopTracking,
  type SyncChange,
} from './tracking';

/**
 * When a vault syncs, in which order. Pull, merge, push; the merging is in
 * `apply.ts`, network and sealing are in `sync.rs`.
 *
 * It stands back while an entry is being edited: a merge between the store's
 * snapshot and the editor's next save would be overwritten by that save. The
 * edit stays in the log and goes out once it is done.
 */

export interface SyncStatus {
  connected: boolean;
  url?: string;
  username?: string;
  hasRemote?: boolean;
  needsLogin?: boolean;
  /** The password changed here and the server has not heard yet. */
  rekeyed?: boolean;
}

export interface RemoteVault {
  id: string;
  head: number;
  hasSnapshot: boolean;
}

const OUTDATED = 'SYNC_SERVER:client_outdated';
const TICK_MS = 2_000;
/** The server says when something is new. This is for when that line is down. */
const PULL_EVERY_MS = 60_000;
const RETRY_AFTER_ERROR_MS = 30_000;
const MAX_PUSH_TRIES = 10;
/** Of JSON, before compression. Well under what the server takes in one request. */
const PUSH_BYTES = 16_000_000;
const FRAME_BYTES = 8_000_000;
/** A device new to the vault replays what is in the log. From here on a snapshot is shorter. */
const LOG_LIMIT = 2_000;

export function syncErrorCode(err: unknown): string {
  return typeof err === 'string' ? err : err instanceof Error ? err.message : 'SYNC_FAILED';
}

/** Not an error: somebody started editing, so this round ends here. */
class Postponed extends Error {}

/**
 * Any page in edit mode counts, changed or not: an editor holds its text from
 * when it opened, and its next save would write that over a merge.
 */
function mayMerge(): boolean {
  const ui = useUIStore.getState();
  return !hasOpenEdits()
    && !useLeaveGuardStore.getState().guard
    && !ui.tabs.some((tab) => tab.view.mode === 'edit')
    && !editorSavesSuspended()
    && !ui.editLocked;
}

export function syncStatus(vaultId: string): Promise<SyncStatus> {
  return invoke<SyncStatus>('sync_status', { vaultId });
}

function deviceName(): string {
  return `Emerald (${navigator.platform})`;
}

export function syncLogin(vaultId: string, url: string, username: string, password: string, signup: boolean): Promise<void> {
  return invoke('sync_login', { vaultId, url, username, password, signup, device: deviceName() });
}

export function remoteVaults(vaultId: string): Promise<RemoteVault[]> {
  return invoke<RemoteVault[]>('sync_remote_vaults', { vaultId });
}

export function adoptRemoteVault(vaultId: string, remoteId: string): Promise<void> {
  return invoke('sync_adopt_remote', { vaultId, remoteId });
}

/** Ends a login that never became a connection, for a vault not created after all. */
export function abandonLogin(vaultId: string): Promise<void> {
  return invoke('sync_disconnect', { vaultId });
}

/** Puts the open vault on the server, as a place of its own. */
export async function connectOpenVault(vaultId: string, name: string): Promise<void> {
  await invoke('sync_create_remote', { vaultId, name });
  await startTracking(await getDb());
  await syncNow();
}

/** This device stops syncing. The vault stays here, and what is on the server stays there. */
export async function disconnectOpenVault(vaultId: string): Promise<void> {
  await stopTracking(await getDb());
  await invoke('sync_disconnect', { vaultId });
  watching = null;
  useSyncStore.setState({ error: null, lastSync: null, conflicts: 0 });
}

/** What this device had not pushed when the vault started over under a new password. */
const keptOverNewPassword: SyncChange[] = [];

/**
 * The password changed on another device: hand over what is waiting here to the
 * vault as it comes back. Names of images saved since the last push no longer
 * exist under the new key, so those images are lost.
 */
export async function keepPendingForNewPassword(): Promise<void> {
  const db = await getDb();
  // A wrong password before this one: the same changes again, once.
  keptOverNewPassword.length = 0;
  if (await isTracked(db)) keptOverNewPassword.push(...(await collectChanges(db)).changes);
}

async function settingsBase(db: Database): Promise<FlatSettings> {
  const rows = await db.select<{ value: string }[]>("SELECT value FROM _sync_meta WHERE key = 'settings_base'");
  return rows[0] ? (JSON.parse(rows[0].value) as FlatSettings) : {};
}

function saveSettingsBase(db: Database, base: FlatSettings): Promise<number> {
  return db.batch([["INSERT OR REPLACE INTO _sync_meta (key, value) VALUES ('settings_base', $1)", [JSON.stringify(base)]]]);
}

/** This vault's settings, if they are the ones loaded. */
function openSettings(vaultId: string) {
  const store = useSettingsStore.getState();
  return store.vaultId === vaultId ? store.settings : null;
}

async function takeIncomingSettings(db: Database, vaultId: string, incoming: FlatSettings): Promise<void> {
  const settings = openSettings(vaultId);
  if (!settings) return;
  const merged = mergeIncomingSettings(settings, await settingsBase(db), incoming);
  if (merged.changed) await useSettingsStore.getState().replaceSettings(merged.settings);
  await saveSettingsBase(db, merged.base);
}

async function restoreFromSnapshot(db: Database, vaultId: string, keepPending: boolean): Promise<void> {
  const keep: SyncChange[] = [...keptOverNewPassword.splice(0), ...(keepPending ? (await collectChanges(db)).changes : [])];
  const snapshot = await invoke<{ seq: number; epoch: number; schema: number; frames: number }>('sync_snapshot_fetch', { vaultId });
  try {
    if (snapshot.schema > BASELINE_VERSION) throw OUTDATED;
    await drainSerialized();
    await beginRestore(db);
    for (let index = 0; index < snapshot.frames; index++) {
      const text = await invoke<string>('sync_snapshot_frame', { vaultId, index });
      const frame = JSON.parse(text) as SnapshotFrame;
      if (frame.table === SETTINGS_TABLE) await takeIncomingSettings(db, vaultId, frame.rows[0] as FlatSettings);
      else await restoreFrame(db, frame);
    }
    await finishRestore(db, keep, positionStatements({ cursor: snapshot.seq, epoch: snapshot.epoch }));
  } finally {
    await invoke('sync_snapshot_done', { vaultId });
  }
}

/**
 * The vault as it is now becomes what everybody starts from, or, with
 * `shorten`, only replaces the log before it.
 */
async function publishSnapshot(db: Database, vaultId: string, shorten = false): Promise<void> {
  await invoke('sync_images', { vaultId });
  for (let tries = 0; tries < MAX_PUSH_TRIES; tries++) {
    const remote = await invoke<{ head: number; epoch: number; hasSnapshot: boolean }>('sync_remote_state', { vaultId });
    const epoch = remote.hasSnapshot && !shorten ? remote.epoch + 1 : remote.epoch;
    const { lastSeq } = await collectChanges(db, 0);
    await invoke('sync_snapshot_begin', { vaultId });
    const settings = openSettings(vaultId);
    const flat = settings ? flattenSettings(settings) : null;
    if (flat) await invoke('sync_snapshot_add', { vaultId, frame: JSON.stringify({ table: SETTINGS_TABLE, rows: [flat] }) });
    for await (const frame of snapshotFrames(db, FRAME_BYTES)) {
      await invoke('sync_snapshot_add', { vaultId, frame: JSON.stringify(frame) });
    }
    const answer = await invoke<{ status: string }>('sync_snapshot_put', { vaultId, base: remote.head, epoch, schema: BASELINE_VERSION });
    if (answer.status === 'ok') {
      // What the log holds is in the snapshot too; shortening leaves it to go
      // out as usual, since other devices keep applying changes on top.
      if (!shorten) await acknowledge(db, lastSeq);
      await db.batch(positionStatements({ cursor: remote.head, epoch }));
      if (!shorten) await clearSnapshotNeeded(db);
      if (flat) await saveSettingsBase(db, flat);
      return;
    }
    if (answer.status === 'client_outdated') throw OUTDATED;
    if (shorten) return;
  }
  throw 'SYNC_BUSY';
}

/** Applies everything new. Answers whether anything changed here. */
async function pull(db: Database, vaultId: string, epochAtStart: number): Promise<boolean> {
  let changed = false;
  for (;;) {
    const { cursor, epoch } = await readPosition(db);
    const answer = await invoke<{ status: string; changes?: { seq: number; changes: string }[]; more?: boolean }>('sync_pull', {
      vaultId,
      after: cursor,
      epoch,
      schema: BASELINE_VERSION,
    });
    if (answer.status === 'epoch_changed' || answer.status === 'snapshot_required') {
      if (!mayMerge() || dbEpoch() !== epochAtStart) throw new Postponed();
      await restoreFromSnapshot(db, vaultId, true);
      changed = true;
      continue;
    }
    if (answer.status === 'client_outdated') throw OUTDATED;

    for (const page of answer.changes ?? []) {
      if (!mayMerge() || dbEpoch() !== epochAtStart) throw new Postponed();
      await drainSerialized();
      const incoming = JSON.parse(page.changes) as SyncChange[];
      for (const change of incoming) {
        if (change.table === SETTINGS_TABLE && change.op === 'upsert') await takeIncomingSettings(db, vaultId, change.row);
      }
      const { conflicts } = await applyRemoteChanges(db, incoming.filter((change) => change.table !== SETTINGS_TABLE), {
        newId: () => crypto.randomUUID(),
        conflictTitle: (title) => i18n.t('sync.conflictTitle', { title }),
        finally: positionStatements({ cursor: page.seq }),
      });
      if (conflicts.length) useSyncStore.setState((s) => ({ conflicts: s.conflicts + conflicts.length }));
      changed = true;
    }
    if (!answer.more) return changed;
  }
}

/** One round for a connected vault. Answers whether the stores need reloading. */
async function round(db: Database, vaultId: string, status: SyncStatus): Promise<boolean> {
  const epochAtStart = dbEpoch();
  let changed = false;

  // A device fetching the vault. Should the first device have died before
  // publishing, there is nothing to fetch: this one publishes instead.
  if (!(await isTracked(db))) {
    const remote = await invoke<{ hasSnapshot: boolean }>('sync_remote_state', { vaultId });
    await startTracking(db);
    if (remote.hasSnapshot) {
      await restoreFromSnapshot(db, vaultId, false);
      await clearSnapshotNeeded(db);
      changed = true;
    }
  } else if (await isRestoring(db)) {
    // A crash in the middle of a restore: only part of the vault is here.
    await restoreFromSnapshot(db, vaultId, false);
    changed = true;
  }
  // New key, new image names: this device's vault is what everybody starts from.
  if (status.rekeyed) {
    await markSnapshotNeeded(db);
    await publishSnapshot(db, vaultId);
    await invoke('sync_rekey_done', { vaultId });
  } else if (await needsSnapshot(db)) {
    await publishSnapshot(db, vaultId);
  }

  let imagesDue = changed;
  for (let tries = 0; ; tries++) {
    if (await pull(db, vaultId, epochAtStart)) {
      changed = true;
      imagesDue = true;
    }
    const { changes, lastSeq, done } = await collectChanges(db, PUSH_BYTES);
    const settings = openSettings(vaultId);
    const flat = settings ? flattenSettings(settings) : null;
    const settingsPatch = flat ? settingsDiff(await settingsBase(db), flat) : {};
    const hasSettings = Object.keys(settingsPatch).length > 0;
    if (!changes.length && !hasSettings) {
      await acknowledge(db, lastSeq);
      break;
    }
    // Images first: the changes that name them must find them there.
    await invoke('sync_images', { vaultId });
    const { cursor, epoch } = await readPosition(db);
    const answer = await invoke<{ status: string; seq?: number }>('sync_push', {
      vaultId,
      base: cursor,
      epoch,
      schema: BASELINE_VERSION,
      batchId: crypto.randomUUID(),
      changes: JSON.stringify(hasSettings
        ? [...changes, { table: SETTINGS_TABLE, id: 'settings', op: 'upsert', changed: Object.keys(settingsPatch), row: settingsPatch }]
        : changes),
    });
    if (answer.status === 'ok') {
      await acknowledgeChanges(db, changes, lastSeq);
      if (hasSettings) await saveSettingsBase(db, flat!);
      await db.batch(positionStatements({ cursor: answer.seq! }));
      if (done) {
        await acknowledge(db, lastSeq);
        break;
      }
      // Not a failed try: the next part of a long time offline.
      tries = -1;
      continue;
    }
    if (answer.status === 'client_outdated') throw OUTDATED;
    if (answer.status === 'snapshot_required') {
      await markSnapshotNeeded(db);
      await publishSnapshot(db, vaultId);
      break;
    }
    // Somebody else was first: pull and try again.
    if (tries >= MAX_PUSH_TRIES) throw 'SYNC_BUSY';
  }
  const remote = await invoke<{ head: number; snapshotSeq: number }>('sync_remote_state', { vaultId });
  if (remote.head - remote.snapshotSeq > LOG_LIMIT) await publishSnapshot(db, vaultId, true);
  if (imagesDue) await invoke('sync_images', { vaultId });
  return changed;
}

/**
 * A vault still waiting for its password is none of this file's business:
 * `getDb()` would fail on it, and that failure sticks to the opening under way.
 */
async function isUnlocked(vaultId: string): Promise<boolean> {
  const status = await invoke<{ unlocked: boolean }>('vault_key_status', { vaultId });
  return status.unlocked;
}

let reloadStores: () => Promise<void> = async () => {};
let lastRun = 0;
let lastError = 0;
let inFlight: Promise<void> | null = null;
/** The server said something is new, and it has not been fetched yet. */
let remoteChanged = false;
let watching: string | null = null;

async function run(reload: boolean): Promise<void> {
  const vaultId = useVaultStore.getState().activeVaultId;
  if (!vaultId || !mayMerge()) return;
  const status = await syncStatus(vaultId);
  if (!status.connected || !status.hasRemote || status.needsLogin || !(await isUnlocked(vaultId))) return;
  useSyncStore.setState({ running: true });
  try {
    const db = await getDb();
    await drainSerialized();
    const changed = await round(db, vaultId, status);
    lastRun = Date.now();
    remoteChanged = false;
    useSyncStore.setState({ error: null, lastSync: lastRun });
    if (changed && reload && useVaultStore.getState().activeVaultId === vaultId) await reloadStores();
  } catch (err) {
    if (err instanceof Postponed) return;
    lastError = Date.now();
    const code = syncErrorCode(err);
    console.warn('[sync]', code);
    useSyncStore.setState({ error: code });
  } finally {
    useSyncStore.setState({ running: false });
  }
}

function once(reload: boolean): Promise<void> {
  inFlight ??= run(reload).finally(() => { inFlight = null; });
  return inFlight;
}

export function syncNow(): Promise<void> {
  lastError = 0;
  return once(true);
}

/**
 * Before the stores load a vault just opened: a device fetching it must not
 * show the seeded starter content first. Offline, the vault opens as it is.
 */
export async function prepareOpenedVault(vaultId: string): Promise<void> {
  const status = await syncStatus(vaultId).catch(() => null);
  if (!status?.connected || !status.hasRemote) return;
  if (!(await isTracked(await getDb()))) await once(false);
}

async function tick(): Promise<void> {
  if (inFlight) return;
  const vaultId = useVaultStore.getState().activeVaultId;
  if (!vaultId) return;
  const status = await syncStatus(vaultId);
  if (!status.connected || !status.hasRemote || !(await isUnlocked(vaultId))) {
    if (watching) await invoke('sync_unwatch');
    watching = null;
    return;
  }
  if (watching !== vaultId && !status.needsLogin) {
    await invoke('sync_watch', { vaultId });
    watching = vaultId;
  }
  if (!mayMerge() || Date.now() - lastError < RETRY_AFTER_ERROR_MS) return;
  const db = await getDb();
  const settings = openSettings(vaultId);
  const due = remoteChanged
    || Date.now() - lastRun >= PULL_EVERY_MS
    || !(await isTracked(db))
    || (settings !== null && Object.keys(settingsDiff(await settingsBase(db), flattenSettings(settings))).length > 0)
    || (await db.select<{ waiting: number }[]>('SELECT EXISTS (SELECT 1 FROM _sync_log) AS waiting'))[0].waiting === 1;
  if (due) await once(true);
}

/** Started once by `AppShell`, which hands in how to reload the stores. */
export function startSync(reload: () => Promise<void>): () => void {
  reloadStores = reload;
  // A vault being switched or locked answers with an error here; the next tick is fine.
  const beat = () => { tick().catch((err: unknown) => console.debug('[sync] tick', err)); };
  const timer = setInterval(beat, TICK_MS);
  const unlisten = listen<{ vaultId: string }>('sync-remote-changed', (event) => {
    if (event.payload.vaultId !== useVaultStore.getState().activeVaultId) return;
    remoteChanged = true;
    // The server is plainly there, so no reason to sit out an earlier failure.
    lastError = 0;
    beat();
  });
  return () => {
    clearInterval(timer);
    void unlisten.then((stop) => stop());
    void invoke('sync_unwatch').catch(() => {});
    watching = null;
  };
}
