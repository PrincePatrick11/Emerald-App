import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { AlertTriangle, Check, FolderOpen, Loader2, Pencil, Plus, RotateCcw, Trash2, Vault, X } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import EmojiPicker from '../ui/EmojiPicker';
import { DEFAULT_EMOJI_PICKER_EMOJIS } from '../../lib/emojiSearch';
import { hasActiveVault, useVaultStore } from '../../store/vaultStore';
import { VAULT_KEY_CANCELLED } from '../../store/vaultKeyStore';
import { keyErrorOf } from '../../lib/vaultKeys';
import { useCloseOnKeepEditing } from '../../hooks/useCloseOnKeepEditing';
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

interface Props {
  onClose: () => void;
  /** `false` while no vault exists: there is no app behind this modal to
   *  return to. Nothing else changes — the setup state is this same modal with
   *  an empty list. See the gate in `AppShell`. */
  dismissible?: boolean;
}

const INPUT_CLASS = 'input-field flex-1 min-w-0 rounded-lg px-2.5 py-1.5 text-sm outline-none';
const CHECKBOX_CLASS =
  'mt-0.5 w-4 h-4 shrink-0 rounded-md border flex items-center justify-center transition-colors ' +
  'peer-focus-visible:ring-2 peer-focus-visible:ring-focus';

/** The one open editor, if any — edit, delete confirmation and the create row
    are mutually exclusive, so they share a single state. */
type Editor =
  | { kind: 'none' }
  | { kind: 'edit'; id: string; name: string; icon?: string }
  | { kind: 'confirmDelete'; id: string; deleteFiles: boolean }
  | {
      kind: 'create';
      name: string;
      icon?: string;
      /** `{Documents}/Emerald Vaults`, resolved once when the row is opened. */
      baseDir: string | null;
      /** Chosen by hand — then takes `baseDir` out of the running. */
      customPath: string | null;
    };

/**
 * Choose-folder button plus the folder the vault will actually land in.
 * Shared by the create row here and the add-vault backup import in the
 * settings modal — same choice, same display, same reset.
 */
export function VaultLocationRow({
  target, customPath, onPickFolder, onResetFolder,
}: {
  target: string | null;
  customPath: string | null;
  onPickFolder: () => void;
  onResetFolder: () => void;
}) {
  const { t } = useTranslation();
  const { parent: targetParent, leaf: targetLeaf } = splitPath(target ?? '');
  // The path appears in full length on a line of its own — `break-all`,
  // because a Windows path needs no spaces at which `break-words`
  // could wrap. Nothing is cut off: where the vault goes
  // has to be fully readable.
  return (
    <div className="space-y-1 min-w-0">
      <div className="flex items-center gap-2">
        <Button variant="secondary" className="shrink-0" onClick={onPickFolder}>
          <FolderOpen size={14} />
          {t('vault.chooseFolder')}
        </Button>
        {customPath && (
          <Button variant="ghost" className="shrink-0" title={t('vault.defaultFolder')} onClick={onResetFolder}>
            <RotateCcw size={14} />
          </Button>
        )}
      </div>
      <span className="block text-xs break-all">
        <span style={{ color: 'var(--text-subtle)' }}>{targetParent}</span>
        <span style={{ color: 'var(--text-muted)' }}>{targetLeaf}</span>
      </span>
    </div>
  );
}

/** A vault's own emoji, or the generic glyph while it has none. */
export function VaultGlyph({ icon, size }: { icon?: string; size: number }) {
  return icon
    ? <span className="leading-none" style={{ fontSize: size }}>{icon}</span>
    : <Vault size={size} />;
}

// ── rows ─────────────────────────────────────────────────────────────────────

/** The badge doubles as the icon picker; the reset appears once one is set. */
function IconField({ icon, onChange }: { icon?: string; onChange: (icon?: string) => void }) {
  const { t } = useTranslation();
  return (
    <>
      {/* The built-in selection, not the open vault's: here the icon of another
          vault is edited too — or of one that does not exist yet. */}
      <EmojiPicker
        value={icon ?? ''}
        onChange={onChange}
        emojis={DEFAULT_EMOJI_PICKER_EMOJIS}
        trigger={({ toggle }) => (
          <button type="button" className="vault-badge vault-badge-interactive" title={t('vault.icon')} onClick={toggle}>
            <VaultGlyph icon={icon} size={16} />
          </button>
        )}
      />
      {icon && (
        <Button variant="ghost" title={t('vault.resetIcon')} onClick={() => onChange(undefined)}>
          <RotateCcw size={14} />
        </Button>
      )}
    </>
  );
}

/**
 * Name and icon in one editor, committed together by the check button.
 *
 * Deliberately no commit on blur: the emoji picker's trigger and its search
 * field both take the focus away from this input, so a blur commit would close
 * the row mid-click and take the picker with it.
 */
function EditRow({
  name, icon, onChangeName, onChangeIcon, onCommit, onCancel,
}: {
  name: string;
  icon?: string;
  onChangeName: (name: string) => void;
  onChangeIcon: (icon?: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="vault-card">
      <IconField icon={icon} onChange={onChangeIcon} />
      <input
        autoFocus
        className={INPUT_CLASS}
        value={name}
        onChange={(e) => onChangeName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCommit();
          if (e.key === 'Escape') onCancel();
        }}
      />
      <div className="flex items-center gap-0.5">
        <Button
          tone="jade"
          compact
          title={t('vault.save')}
          aria-label={t('vault.save')}
          disabled={!name.trim()}
          onClick={onCommit}
        >
          <Check size={14} />
        </Button>
        <Button tone="neutral" compact title={t('vault.cancel')} aria-label={t('vault.cancel')} onClick={onCancel}>
          <X size={14} />
        </Button>
      </div>
    </div>
  );
}

function DeleteConfirmRow({
  vault, deleteFiles, hintKey, busy, onToggleFiles, onConfirm, onCancel,
}: {
  vault: VaultRecord;
  deleteFiles: boolean;
  /** What happens afterwards — for the active and the last vault that is more
   *  than "disappears from the list". */
  hintKey: 'vault.deleteHint' | 'vault.deleteActiveHint' | 'vault.deleteLastHint';
  busy: boolean;
  onToggleFiles: (next: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="vault-card flex-col items-stretch gap-2">
      <div className="flex items-center gap-3">
        <div className="vault-badge"><Trash2 size={16} /></div>
        <div className="flex-1 min-w-0">
          <div className="vault-name">{vault.name}</div>
          <div className="vault-meta">{t(hintKey)}</div>
        </div>
        {/* The tinted row-action buttons of the Button component — the same
            30px row as Edit/Delete on the vault cards, without
            hand-written padding chains. */}
        <Button onClick={onConfirm} tone="danger" className="shrink-0" disabled={busy}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : t('common.confirmYes')}
        </Button>
        <Button onClick={onCancel} tone="neutral" className="shrink-0">
          {t('common.confirmNo')}
        </Button>
      </div>

      <label className="flex items-start gap-2 text-xs cursor-pointer" style={{ color: 'var(--text-muted)' }}>
        {/* A real input for keyboard and screen readers, visually the checkbox
            that the export panel already uses. */}
        <input
          type="checkbox"
          className="sr-only peer"
          checked={deleteFiles}
          onChange={(e) => onToggleFiles(e.target.checked)}
        />
        <span
          aria-hidden
          className={`${CHECKBOX_CLASS} ${
            deleteFiles ? 'bg-accent-wash-strong border-accent-edge' : 'border-edge-strong hover:border-edge-raise'
          }`}
        >
          {deleteFiles && <Check size={12} className="text-accent" />}
        </span>
        <span className="min-w-0">
          {t('vault.deleteFiles')}
          <span className="block truncate" title={vault.path}>{vault.path}</span>
          {deleteFiles && (
            <span className="block mt-1 text-danger">{t('vault.deleteFilesWarning')}</span>
          )}
        </span>
      </label>
    </div>
  );
}

function VaultRow({
  vault, isActive, unreachable, isSwitching, busy, onSwitch, onEdit, onRelocate, onDelete,
}: {
  vault: VaultRecord;
  isActive: boolean;
  unreachable: 'missing' | 'denied' | null;
  isSwitching: boolean;
  busy: boolean;
  onSwitch: () => void;
  onEdit: () => void;
  onRelocate: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const isUnreachable = unreachable !== null;
  return (
    <div className={isActive ? 'vault-card vault-card-active' : 'vault-card vault-card-idle'}>
      <button
        type="button"
        disabled={isActive || busy || isUnreachable}
        onClick={onSwitch}
        title={isActive || isUnreachable ? undefined : t('vault.switch')}
        className="flex items-center gap-3 flex-1 min-w-0 text-left"
      >
        {/* Status beats identity: during a switch and with an unreachable
            folder, what is going on matters, not which vault it is. */}
        <div className="vault-badge">
          {isSwitching
            ? <Loader2 size={16} className="animate-spin" />
            : isUnreachable
              ? <AlertTriangle size={16} className="text-danger" />
              : <VaultGlyph icon={vault.icon} size={16} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="vault-name">{vault.name}</div>
          <div className={`vault-meta truncate${isUnreachable ? ' text-danger' : ''}`} title={vault.path}>
            {isSwitching
              ? t('vault.switching')
              : unreachable
                ? t(unreachable === 'denied' ? 'vault.accessDenied' : 'vault.missing')
                : vault.path}
          </div>
        </div>
      </button>

      <div className="flex items-center gap-0.5">
        {unreachable === 'missing' && (
          <Button variant="ghost" title={t('vault.relocate')} onClick={onRelocate}>
            <FolderOpen size={14} />
          </Button>
        )}
        <Button tone="amber" compact title={t('vault.edit')} aria-label={t('vault.edit')} onClick={onEdit}>
          <Pencil size={14} />
        </Button>
        <Button tone="danger" compact title={t('vault.delete')} aria-label={t('vault.delete')} onClick={onDelete}>
          <Trash2 size={14} />
        </Button>
      </div>
    </div>
  );
}

function CreateRow({
  name, icon, baseDir, customPath, onChangeName, onChangeIcon, onPickFolder, onResetFolder,
  onCommit, onCancel,
}: {
  name: string;
  icon?: string;
  baseDir: string | null;
  customPath: string | null;
  onChangeName: (name: string) => void;
  onChangeIcon: (icon?: string) => void;
  onPickFolder: () => void;
  onResetFolder: () => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  // The row shows the folder the vault actually ends up in — not
  // merely the prompt to choose one.
  const target = newVaultTarget(baseDir, customPath, name);
  return (
    <div className="vault-card flex-col items-stretch gap-2">
      <div className="flex items-center gap-3">
        <IconField icon={icon} onChange={onChangeIcon} />
        <input
          autoFocus
          className={INPUT_CLASS}
          placeholder={t('vault.namePlaceholder')}
          value={name}
          onChange={(e) => onChangeName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommit();
            if (e.key === 'Escape') onCancel();
          }}
        />
        <div className="flex items-center gap-0.5">
          <Button
            tone="jade"
            compact
            title={t('vault.create')}
            aria-label={t('vault.create')}
            disabled={!name.trim()}
            onClick={onCommit}
          >
            <Check size={14} />
          </Button>
          <Button tone="neutral" compact title={t('vault.cancel')} aria-label={t('vault.cancel')} onClick={onCancel}>
            <X size={14} />
          </Button>
        </div>
      </div>
      <VaultLocationRow
        target={target}
        customPath={customPath}
        onPickFolder={onPickFolder}
        onResetFolder={onResetFolder}
      />
    </div>
  );
}

// ── modal ────────────────────────────────────────────────────────────────────

export default function VaultModal({ onClose, dismissible = true }: Props) {
  const { t } = useTranslation();
  const vaults = useVaultStore((s) => s.vaults);
  const activeVaultId = useVaultStore((s) => s.activeVaultId);
  const switchVault = useVaultStore((s) => s.switchVault);
  const addVault = useVaultStore((s) => s.addVault);
  const updateVault = useVaultStore((s) => s.updateVault);
  const relocateVault = useVaultStore((s) => s.relocateVault);
  const removeVault = useVaultStore((s) => s.removeVault);
  useCloseOnKeepEditing(onClose);

  const [editor, setEditor] = useState<Editor>({ kind: 'none' });
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  // 'missing' = folder not found, 'denied' = there, but no access.
  // The difference is that between "look elsewhere" and "allow access".
  const [unreachable, setUnreachable] = useState<Map<string, 'missing' | 'denied'>>(new Map());
  const [error, setError] = useState('');


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
   * Every action here has the same shape: clear the previous message, do the
   * thing, and show one shared message if it throws. Without the clearing step
   * a stale error outlives the next successful action.
   */
  async function run(label: string, action: () => Promise<void>) {
    setError('');
    try {
      await action();
    } catch (e) {
      // Creating and opening end in a switch — cancelling at the password is
      // not an error.
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

  /** Adds a vault to the list, and during first-run setup activates it — that
   *  is what fills the empty stores and lets the app shell take over. */
  async function adoptVault(record: VaultRecord) {
    const hadActive = hasActiveVault({ vaults, activeVaultId });
    await addVault(record);
    if (!hadActive) await switchVault(record.id);
  }

  async function handleSwitch(id: string) {
    if (id === activeVaultId || switchingId) return;
    setSwitchingId(id);
    setError('');
    try {
      await switchVault(id);
      onClose();
    } catch (e) {
      // Cancelling is not an error: the user did not want to enter the password.
      if (keyErrorOf(e) !== VAULT_KEY_CANCELLED) {
        console.error('[vault] switch failed', e);
        setError(t('vault.switchFailed'));
      }
    } finally {
      setSwitchingId(null);
    }
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
    }
  }

  return (
    <Modal
      title={t('vault.title')}
      onClose={onClose}
      dismissible={dismissible}
      widthClassName="w-[480px]"
      maxHeightClassName="max-h-[80vh]"
      bodyClassName="flex-1 overflow-y-auto px-5 py-4"
    >
      <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
        {t('vault.hint')}
      </p>

      <div className="space-y-2">
        {vaults.map((v) => {
          if (editor.kind === 'edit' && editor.id === v.id) {
            return (
              <EditRow
                key={v.id}
                name={editor.name}
                icon={editor.icon}
                onChangeName={(name) => setEditor({ ...editor, name })}
                onChangeIcon={(icon) => setEditor({ ...editor, icon })}
                onCommit={() => commitEdit(v.id, editor.name, editor.icon)}
                onCancel={closeEditor}
              />
            );
          }

          if (editor.kind === 'confirmDelete' && editor.id === v.id) {
            return (
              <DeleteConfirmRow
                key={v.id}
                vault={v}
                deleteFiles={editor.deleteFiles}
                busy={removingId === v.id}
                hintKey={
                  vaults.length === 1
                    ? 'vault.deleteLastHint'
                    : v.id === activeVaultId
                      ? 'vault.deleteActiveHint'
                      : 'vault.deleteHint'
                }
                onToggleFiles={(deleteFiles) => setEditor({ kind: 'confirmDelete', id: v.id, deleteFiles })}
                onConfirm={() => handleRemove(v.id, editor.deleteFiles)}
                onCancel={closeEditor}
              />
            );
          }

          const isActive = v.id === activeVaultId;
          return (
            <VaultRow
              key={v.id}
              vault={v}
              isActive={isActive}
              unreachable={unreachable.get(v.id) ?? null}
              isSwitching={switchingId === v.id}
              busy={switchingId !== null}
              onSwitch={() => handleSwitch(v.id)}
              onEdit={() => setEditor({ kind: 'edit', id: v.id, name: v.name, icon: v.icon })}
              onRelocate={() => handleRelocate(v.id)}
              onDelete={() => setEditor({ kind: 'confirmDelete', id: v.id, deleteFiles: false })}
            />
          );
        })}

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
          <div className="flex gap-2">
            <Button variant="primary" className="flex-1 justify-center" onClick={openCreateRow}>
              <Plus size={16} className="shrink-0" />
              {t('vault.add')}
            </Button>
            <Button variant="secondary" className="flex-1 justify-center" onClick={handleOpenExisting}>
              <FolderOpen size={16} className="shrink-0" />
              {t('vault.open')}
            </Button>
          </div>
        )}
      </div>

      {error && <p className="text-xs mt-3 text-danger">{error}</p>}
    </Modal>
  );
}
