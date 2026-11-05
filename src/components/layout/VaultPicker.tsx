import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { ChevronLeft, FolderOpen, Vault } from 'lucide-react';
import { activeVault, hasActiveVault, useVaultStore } from '../../store/vaultStore';
import { ensureVaultReady, VAULT_KEY_CANCELLED } from '../../store/vaultKeyStore';
import { closeVaultPicker, useVaultPickerStore } from '../../store/vaultPickerStore';
import StartBrand from './start/StartBrand';
import StartSection from './start/StartSection';
import StartAppearance from './start/StartAppearance';
import StartUpdates from './start/StartUpdates';
import StartLanguage from './start/StartLanguage';
import { keyErrorOf } from '../../lib/vaultKeys';
import { hideLoadingScreen, hideSplash, showLoadingScreen } from '../../lib/splash';
import { adoptRemoteVault, deleteRemoteVault, syncErrorCode, type RemoteVault } from '../../lib/sync/engine';
import { syncErrorKey } from '../../lib/sync/errors';
import { formatBytes } from '../../lib/helpers';
import PickerServerPanel, { useServerState } from './PickerServerPanel';
import { CreateRow, CreateTile, DeleteConfirmRow, EditRow, RemoteRow, VaultRow, type VaultState } from './PickerRows';
import {
  DB_FILE,
  NEW_VAULT_TARGET_ERROR_KEY,
  folderName,
  newVaultBaseDir,
  newVaultRecord,
  newVaultTarget,
  parentDir,
  probeNewVaultTarget,
  probeVaultDir,
  splitPath,
  type Vault as VaultRecord,
} from '../../lib/vaultManager';

export { VaultGlyph, VaultLocationRow } from './PickerRows';

/** The one open editor, if any — edit, delete confirmation and the create row
    are mutually exclusive, so they share a single state. */
type Editor =
  | { kind: 'none' }
  | { kind: 'edit'; id: string; name: string; icon?: string }
  | { kind: 'confirmDelete'; id: string; deleteFiles: boolean }
  | { kind: 'confirmRemote'; id: string }
  | {
      kind: 'create';
      name: string;
      icon?: string;
      /** `{Documents}/Emerald Vaults`, resolved once when the row is opened. */
      baseDir: string | null;
      /** Chosen by hand — then takes `baseDir` out of the running. */
      customPath: string | null;
    };

/** A folder for a vault of this name that is not taken. */
async function freeTarget(name: string): Promise<{ name: string; path: string | undefined }> {
  const base = await newVaultBaseDir().catch(() => null);
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? name : `${name} ${n}`;
    const path = newVaultTarget(base, null, candidate);
    if (!path) return { name: candidate, path: undefined };
    if (!(await probeNewVaultTarget(path))) return { name: candidate, path };
  }
  throw new Error('no free folder');
}

/** The brand column's width, dragged as the entry list's is, kept the same way
 *  (`AppShell`): in `localStorage`, for this installation. */
const BRAND_WIDTH_KEY = 'start-brand-width';
/** The name stays on one line. */
const BRAND_MIN = 360;
const BRAND_MAX = 560;
const BRAND_DEFAULT = 380;
/** What the sheet keeps however far the handle goes. */
const SHEET_MIN = 480;

const clampBrand = (width: number) =>
  Math.round(Math.max(BRAND_MIN, Math.min(BRAND_MAX, window.innerWidth - SHEET_MIN, width)));

function loadBrandWidth(): number {
  const saved = Number(localStorage.getItem(BRAND_WIDTH_KEY));
  return clampBrand(saved > 0 ? saved : BRAND_DEFAULT);
}

// ── picker ───────────────────────────────────────────────────────────────────

/**
 * The start view for choosing a vault: its own view in the main window, not a
 * modal and not a second window, so there is one set of stores and the
 * question about unsaved edits stays where the edits are.
 *
 * `AppShell` shows it instead of the shell when no vault is open (first start,
 * the last vault removed, the vault to start with did not open or its password
 * was cancelled) and when it is asked for (`openVaultPicker`). It fills the
 * window as the shell does: the brand on the frame at the left, and on the
 * sheet one page with the vaults, the server, the appearance and, at the
 * foot, the version and its updates.
 */
export default function VaultPicker() {
  const { t } = useTranslation();
  const vaults = useVaultStore((s) => s.vaults);
  const activeVaultId = useVaultStore((s) => s.activeVaultId);
  const current = useVaultStore(activeVault);
  const openFailed = useVaultStore((s) => s.openFailed);
  const switchVault = useVaultStore((s) => s.switchVault);
  const addVault = useVaultStore((s) => s.addVault);
  const updateVault = useVaultStore((s) => s.updateVault);
  const relocateVault = useVaultStore((s) => s.relocateVault);
  const removeVault = useVaultStore((s) => s.removeVault);
  const notice = useVaultPickerStore((s) => s.notice);

  const [editor, setEditor] = useState<Editor>({ kind: 'none' });
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  // 'missing' = folder not found, 'denied' = there, but no access.
  // The difference is that between "look elsewhere" and "allow access".
  const [unreachable, setUnreachable] = useState<Map<string, 'missing' | 'denied'>>(new Map());
  const [error, setError] = useState('');
  const [fetchingId, setFetchingId] = useState<string | null>(null);
  const server = useServerState();
  const [brandWidth, setBrandWidth] = useState(loadBrandWidth);
  const drag = useRef<{ x: number; width: number } | null>(null);
  // Set together with the state: the release may come before the render.
  const brandWidthRef = useRef(brandWidth);

  // The loading screen of a start that ends here goes once the picker is
  // there (`AppShell` leaves it to this effect).
  useEffect(() => { hideSplash(); }, []);

  // Focus starts where the picker is about: on the open vault's row, or on
  // the heading when there is none — not on whatever had it in the shell.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const row = document.querySelector<HTMLElement>('.picker-tile-active .picker-tile-main');
    (row ?? headingRef.current)?.focus();
  }, []);

  // Escape goes back to the open vault, as "Back to …" does — not while a
  // row is being edited or confirmed, a dialog is up or a field has the key.
  const canGoBack = !!current && !openFailed && switchingId === null;
  const editorOpen = editor.kind !== 'none';
  useEffect(() => {
    if (!canGoBack || editorOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector('.modal-card')) return;
      closeVaultPicker();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [canGoBack, editorOpen]);

  // Which vaults are still where vaults.json says they are. A folder on an
  // unplugged drive, or one that was renamed, has to be visible as such rather
  // than only failing at the moment it is switched to.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const state = new Map<string, 'missing' | 'denied'>();
      for (const v of vaults) {
        try {
          const probe = await probeVaultDir(v.path);
          if (probe.denied) state.set(v.id, 'denied');
          else if (!probe.exists) state.set(v.id, 'missing');
        } catch {
          state.set(v.id, 'missing');
        }
      }
      if (!cancelled) setUnreachable(state);
    })();
    return () => { cancelled = true; };
  }, [vaults]);

  const closeEditor = () => setEditor({ kind: 'none' });

  /** Resolves the default location before the row opens, so it shows a real
   *  path from the first frame instead of a placeholder. */
  const openCreateRow = useCallback(async () => {
    const baseDir = await newVaultBaseDir().catch(() => null);
    setEditor({ kind: 'create', name: '', baseDir, customPath: null });
  }, []);

  /**
   * Opens a vault and leaves the picker. The password comes first, in the
   * picker; then the loading screen covers the switch, so the empty shell is
   * not seen.
   *
   * The picker stays up through all of it (`open`), also where it only showed
   * for want of a vault: `switchVault` makes the vault active before it is
   * opened, and the shell must not mount on a database that is still locked.
   */
  async function choose(id: string): Promise<void> {
    if (switchingId) return;
    const state = useVaultStore.getState();
    const vault = state.vaults.find((v) => v.id === id);
    if (!vault) return;
    // The open vault: back to it — unless it is one that failed to open,
    // which is tried again instead.
    const retry = id === state.activeVaultId && state.openFailed;
    if (id === state.activeVaultId && !retry) {
      closeVaultPicker();
      return;
    }
    setSwitchingId(id);
    setError('');
    useVaultPickerStore.setState({ open: true, notice: null });
    try {
      await ensureVaultReady(vault);
      showLoadingScreen();
      // The open edits were settled when the picker opened (`openVaultPicker`).
      if (retry) await useVaultStore.getState().retryOpen();
      else await switchVault(id, { editsResolved: true });
    } catch (e) {
      // Both covers: `ensureVaultReady` puts the loading screen back after a
      // question (`resumeSplash`), and a switch that fails early never ends it.
      hideLoadingScreen();
      hideSplash();
      setSwitchingId(null);
      // Cancelling is not an error: the user did not want to enter the password.
      if (keyErrorOf(e) === VAULT_KEY_CANCELLED) return;
      console.error('[vault] switch failed', e);
      setError(t('vault.switchFailed'));
      return;
    }
    closeVaultPicker();
    // Two frames: the shell has painted at its own size before the cover goes.
    // With a timer beside them: a hidden or covered window gets no frames,
    // and the cover must not wait until someone looks at it.
    requestAnimationFrame(() => requestAnimationFrame(hideLoadingScreen));
    setTimeout(hideLoadingScreen, 250);
  }

  /**
   * Every action here has the same shape: clear the previous message, do the
   * thing, and show one shared message if it throws. Without the clearing step
   * a stale error outlives the next successful action.
   */
  async function run(label: string, action: () => Promise<void>) {
    setError('');
    try {
      await action();
    } catch (e) {
      if (keyErrorOf(e) === VAULT_KEY_CANCELLED) return;
      console.error(`[vault] ${label} failed`, e);
      setError(t('vault.saveFailed'));
    }
  }

  async function pickFolder(): Promise<string | null> {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked !== 'string') return null;
    setError('');
    return picked;
  }

  /**
   * Picks the vault's database rather than its folder.
   *
   * A directory dialog lists no files, so nothing in it shows whether the
   * folder holds a vault at all — the answer only arrived after confirming.
   * Filtered on `.db`, the database is visible while choosing; the folder is
   * its parent.
   */
  async function pickVaultDir(): Promise<string | null> {
    const picked = await openDialog({
      multiple: false,
      title: t('vault.openDbFile'),
      filters: [{ name: t('vault.dbFileFilter'), extensions: ['db'] }],
    });
    if (!picked) return null;
    const file = typeof picked === 'string' ? picked : picked[0];
    // The filter lets every `.db` through. If any were allowed here, then
    // `~/Documents/foreign.db` would make the folder `~/Documents` the vault
    // directory — with `images/` in it and with "Delete files" applied to it.
    if (splitPath(file).leaf !== DB_FILE) {
      setError(t('vault.folderHasNoVault'));
      return null;
    }
    return parentDir(file);
  }

  /** Shared gate for opening and relocating: the folder has to be reachable
   *  and actually hold a vault. Returns `false` once the reason is displayed. */
  async function requireVaultDir(path: string): Promise<boolean> {
    const probe = await probeVaultDir(path);
    // `denied` first: a denied probe reports has_db=false and would
    // otherwise pass as "no vault in this folder".
    if (probe.denied) {
      setError(t('vault.accessDenied'));
      return false;
    }
    if (!probe.has_db) {
      setError(t('vault.folderHasNoVault'));
      return false;
    }
    return true;
  }

  /** Adds a vault to the list. With no vault open it is opened right away —
   *  there is nothing else to go back to. */
  async function adoptVault(record: VaultRecord) {
    const hadActive = hasActiveVault(useVaultStore.getState());
    await addVault(record);
    if (!hadActive) await choose(record.id);
  }

  async function commitEdit(id: string, name: string, icon?: string) {
    if (editor.kind !== 'edit' || editor.id !== id) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    closeEditor();
    await run('edit', () => updateVault(id, { name: trimmed, icon: icon ?? null }));
  }

  async function commitCreate(pending: Extract<Editor, { kind: 'create' }>) {
    const name = pending.name.trim();
    if (!name) return;
    const target = newVaultTarget(pending.baseDir, pending.customPath, name);
    await run('create', async () => {
      // Check first, then close the editor: otherwise name and folder are
      // gone as soon as the folder is unsuitable.
      if (target) {
        const problem = await probeNewVaultTarget(target);
        if (problem) {
          setError(t(NEW_VAULT_TARGET_ERROR_KEY[problem]));
          return;
        }
      }
      closeEditor();
      await adoptVault(await newVaultRecord(name, { path: target ?? undefined, icon: pending.icon }));
    });
  }

  /** Adds a vault that already exists on disk — the route for a folder carried
      over from another machine. */
  async function handleOpenExisting() {
    closeEditor();
    const path = await pickVaultDir();
    if (!path) return;
    await run('open', async () => {
      if (!(await requireVaultDir(path))) return;
      if (vaults.some((v) => v.path === path)) {
        setError(t('vault.alreadyOpen'));
        return;
      }
      await adoptVault(await newVaultRecord(folderName(path), { path }));
    });
  }

  async function handleRelocate(id: string) {
    const path = await pickVaultDir();
    if (!path) return;
    await run('relocate', async () => {
      if (!(await requireVaultDir(path))) return;
      // Two vaults on one folder would be two ids on one database —
      // and "Delete files" on one would pull the rug out from under the other.
      if (vaults.some((v) => v.id !== id && v.path === path)) {
        setError(t('vault.alreadyOpen'));
        return;
      }
      // No manual cleanup of `missing` — the changed vault list
      // makes the probe effect run again anyway.
      await relocateVault(id, path);
    });
  }

  async function handleRemove(id: string, deleteFiles: boolean) {
    // A second click during the first would compute its successor from a
    // state that no longer exists — and `delete_vault_files` would no
    // longer find the id in the registry.
    if (removingId) return;
    setRemovingId(id);
    setError('');
    try {
      const dirRemoved = await removeVault(id, deleteFiles);
      closeEditor();
      // Not an error: `delete_vault_files` only removes its own files
      // and leaves the folder in place as soon as anything else is in it —
      // the notice merely says that it is still there.
      if (deleteFiles && !dirRemoved) setError(t('vault.deleteFilesLeftover'));
    } catch (e) {
      console.error('[vault] remove failed', e);
      setError(t('vault.saveFailed'));
      closeEditor();
    } finally {
      setRemovingId(null);
      void server.refresh();
    }
  }

  /**
   * A vault only on the server: a new local vault holding its `vault.key`,
   * opened like any other — the password, then the first sync fills it.
   */
  async function fetchRemote(remote: RemoteVault, label: string) {
    if (fetchingId || switchingId) return;
    setFetchingId(remote.id);
    setError('');
    try {
      const target = await freeTarget(label);
      const record = await newVaultRecord(target.name, { path: target.path });
      await addVault(record);
      try {
        await adoptRemoteVault(record.id, remote.id, target.name);
      } catch (e) {
        // No half-fetched vault in the list: the record and the folder made
        // for it go again.
        await removeVault(record.id, true).catch((err: unknown) => console.warn('[sync] could not remove the new vault', err));
        void server.refresh();
        throw e;
      }
      await server.refresh();
      await choose(record.id);
    } catch (e) {
      if (keyErrorOf(e) !== VAULT_KEY_CANCELLED) {
        console.warn('[sync] fetch', e);
        setError(t(syncErrorKey(syncErrorCode(e))));
      }
    } finally {
      setFetchingId(null);
    }
  }

  async function removeRemote(remote: RemoteVault) {
    setError('');
    try {
      await deleteRemoteVault(remote.id, null);
      closeEditor();
      await server.refresh();
    } catch (e) {
      console.warn('[sync] delete', e);
      setError(t(syncErrorKey(syncErrorCode(e))));
    }
  }

  // Links outlast a disconnected server (connecting it again resumes them):
  // without one, a linked vault shows as paused rather than as local.
  const links = server.status?.links ?? {};
  const online = !!server.status?.url && !server.loggedOut;
  const stateOf = (id: string): VaultState => {
    const link = links[id];
    return !link ? 'local' : link.paused || !online ? 'paused' : 'synced';
  };
  // On the server and not here. A vault removed from the list keeps its link in
  // `sync.json`, so only links of vaults still in the list count.
  const here = new Set(vaults.flatMap((v) => (links[v.id] ? [links[v.id].remote] : [])));
  const remoteOnly = server.remotes.filter((remote) => !here.has(remote.id));
  const units: [string, string, string] = [t('common.bytes'), t('common.kilobytes'), t('common.megabytes')];
  const busy = switchingId !== null || fetchingId !== null;

  return (
    <div
      className="picker-frame relative flex flex-1 min-h-0"
      onPointerMove={(e) => {
        if (!drag.current) return;
        brandWidthRef.current = clampBrand(drag.current.width + e.clientX - drag.current.x);
        setBrandWidth(brandWidthRef.current);
      }}
      onPointerUp={() => {
        if (!drag.current) return;
        drag.current = null;
        localStorage.setItem(BRAND_WIDTH_KEY, String(brandWidthRef.current));
      }}
    >
      <StartBrand width={brandWidth} />
      {/* In the frame, not in the brand: it reaches over onto the sheet. */}
      <div
        className="sidebar-resize-handle"
        style={{ left: brandWidth - 3 }}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, width: brandWidth };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
      />
      <main className="app-main app-sheet-main picker-sheet flex flex-col min-w-0">
        {/* The way back as in an open entry: the row above, chevron and name. */}
        <div className="start-back-row">
          {current && !openFailed && (
            <button type="button" className="entry-back-link" disabled={busy} onClick={closeVaultPicker}>
              <ChevronLeft size={14} className="flex-shrink-0" />
              <span className="truncate">{current.name}</span>
            </button>
          )}
        </div>

        <div className="start-content">
          <StartSection
            id="start-vaults-heading"
            icon={<Vault size={12} />}
            label={t('vault.title')}
            headingRef={headingRef}
            aside={
              <button type="button" className="start-foot-action" onClick={handleOpenExisting}>
                <FolderOpen size={12} />
                {t('vault.open')}
              </button>
            }
          >
            {(notice || error) && (
              <p className="pb-2 text-xs text-danger">{notice ? t(notice) : error}</p>
            )}

            <div>
              <ul className="start-tiles">
                {vaults.map((v) => (
                  <li key={v.id}>
                    {editor.kind === 'edit' && editor.id === v.id ? (
                      <EditRow
                        name={editor.name}
                        icon={editor.icon}
                        onChangeName={(name) => setEditor({ ...editor, name })}
                        onChangeIcon={(icon) => setEditor({ ...editor, icon })}
                        onCommit={() => commitEdit(v.id, editor.name, editor.icon)}
                        onCancel={closeEditor}
                      />
                    ) : editor.kind === 'confirmDelete' && editor.id === v.id ? (
                      <DeleteConfirmRow
                        vault={v}
                        deleteFiles={editor.deleteFiles}
                        busy={removingId === v.id}
                        onToggleFiles={(deleteFiles) => setEditor({ kind: 'confirmDelete', id: v.id, deleteFiles })}
                        onConfirm={() => handleRemove(v.id, editor.deleteFiles)}
                        onCancel={closeEditor}
                      />
                    ) : (
                      <VaultRow
                        vault={v}
                        isActive={v.id === activeVaultId}
                        unreachable={unreachable.get(v.id) ?? null}
                        state={stateOf(v.id)}
                        isSwitching={switchingId === v.id}
                        busy={busy}
                        onSwitch={() => { void choose(v.id); }}
                        onEdit={() => setEditor({ kind: 'edit', id: v.id, name: v.name, icon: v.icon })}
                        onRelocate={() => handleRelocate(v.id)}
                        onDelete={() => setEditor({ kind: 'confirmDelete', id: v.id, deleteFiles: false })}
                      />
                    )}
                  </li>
                ))}
                {remoteOnly.map((remote, i) => {
                  const label = remote.name ?? t('sync.unnamedVault', { number: i + 1 });
                  return (
                    <li key={remote.id}>
                      <RemoteRow
                        name={label}
                        size={formatBytes(remote.storedBytes, units)}
                        isFetching={fetchingId === remote.id}
                        busy={busy}
                        confirming={editor.kind === 'confirmRemote' && editor.id === remote.id}
                        onFetch={() => { void fetchRemote(remote, label); }}
                        onDelete={() => setEditor({ kind: 'confirmRemote', id: remote.id })}
                        onConfirmDelete={() => { void removeRemote(remote); }}
                        onCancelDelete={closeEditor}
                      />
                    </li>
                  );
                })}
                <li>
                  {editor.kind === 'create' ? (
                    <CreateRow
                      name={editor.name}
                      icon={editor.icon}
                      baseDir={editor.baseDir}
                      customPath={editor.customPath}
                      onChangeName={(name) => setEditor({ ...editor, name })}
                      onChangeIcon={(icon) => setEditor({ ...editor, icon })}
                      onPickFolder={async () => {
                        const customPath = await pickFolder();
                        if (customPath) setEditor({ ...editor, customPath });
                      }}
                      onResetFolder={() => setEditor({ ...editor, customPath: null })}
                      onCommit={() => commitCreate(editor)}
                      onCancel={closeEditor}
                    />
                  ) : (
                    <CreateTile onClick={openCreateRow} />
                  )}
                </li>
              </ul>
            </div>
          </StartSection>

          <div className="start-columns">
            <PickerServerPanel server={server} />
            <StartAppearance />
          </div>
        </div>

        <footer className="start-foot">
          <StartLanguage />
          <StartUpdates />
        </footer>
      </main>
    </div>
  );
}
