import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { open as openFolderDialog } from '@tauri-apps/plugin-dialog';
import { AlertTriangle, Check, FolderOpen, Loader2, Pencil, Plus, Trash2, Vault, X } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { useVaultStore } from '../../store/vaultStore';
import { newVaultRecord, probeVaultDir, type Vault as VaultRecord } from '../../lib/vaultManager';
import { isWindows } from '../../lib/platform';

interface Props {
  onClose: () => void;
}

const INPUT_CLASS = 'input-field flex-1 min-w-0 rounded-lg px-2.5 py-1.5 text-sm outline-none';
const CHECKBOX_CLASS =
  'mt-0.5 w-4 h-4 shrink-0 rounded border flex items-center justify-center transition-colors ' +
  'peer-focus-visible:ring-2 peer-focus-visible:ring-jade-500/35';

/** The one open editor, if any — rename, delete confirmation and the create row
    are mutually exclusive, so they share a single state. */
type Editor =
  | { kind: 'none' }
  | { kind: 'rename'; id: string; value: string }
  | { kind: 'confirmDelete'; id: string; deleteFiles: boolean }
  | { kind: 'create'; value: string; path: string | null };

/**
 * The folder's own name, as the default vault name when opening one.
 *
 * Splits on the platform's separator only: on POSIX a backslash is an ordinary
 * character in a folder name, and treating it as one would truncate the
 * suggested name.
 */
function folderName(path: string): string {
  const parts = isWindows ? path.split(/[\\/]/) : path.split('/');
  return parts.filter(Boolean).pop() ?? path;
}

// ── rows ─────────────────────────────────────────────────────────────────────

function RenameRow({
  value, onChange, onCommit, onCancel,
}: {
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="vault-card">
      <div className="vault-badge"><Vault size={16} /></div>
      <input
        autoFocus
        className={INPUT_CLASS}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCommit();
          if (e.key === 'Escape') onCancel();
        }}
        onBlur={onCommit}
      />
    </div>
  );
}

function DeleteConfirmRow({
  vault, deleteFiles, onToggleFiles, onConfirm, onCancel,
}: {
  vault: VaultRecord;
  deleteFiles: boolean;
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
          <div className="vault-meta">{t('vault.deleteHint')}</div>
        </div>
        <Button onClick={onConfirm} variant="danger" className="text-xs px-1">
          {t('trash.confirmYes')}
        </Button>
        <Button onClick={onCancel} variant="ghost" className="text-xs">
          {t('trash.confirmNo')}
        </Button>
      </div>

      <label className="flex items-start gap-2 text-xs cursor-pointer" style={{ color: 'var(--text-muted)' }}>
        {/* Echtes Input fuer Tastatur und Screenreader, optisch das Kaestchen,
            das der Export-Panel schon benutzt. */}
        <input
          type="checkbox"
          className="sr-only peer"
          checked={deleteFiles}
          onChange={(e) => onToggleFiles(e.target.checked)}
        />
        <span
          aria-hidden
          className={`${CHECKBOX_CLASS} ${
            deleteFiles ? 'bg-jade-500/30 border-jade-500/60' : 'border-stone-600 hover:border-stone-400'
          }`}
        >
          {deleteFiles && <Check size={10} className="text-jade-400" />}
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
  vault, isActive, unreachable, isSwitching, busy, onSwitch, onRename, onRelocate, onDelete,
}: {
  vault: VaultRecord;
  isActive: boolean;
  unreachable: 'missing' | 'denied' | null;
  isSwitching: boolean;
  busy: boolean;
  onSwitch: () => void;
  onRename: () => void;
  onRelocate: () => void;
  onDelete: (() => void) | null;
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
        <div className="vault-badge">
          {isSwitching
            ? <Loader2 size={16} className="animate-spin" />
            : isUnreachable
              ? <AlertTriangle size={16} className="text-danger" />
              : <Vault size={16} />}
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

      {isActive && <span className="vault-active-label">{t('vault.active')}</span>}

      {unreachable === 'missing' && (
        <Button variant="ghost" title={t('vault.relocate')} onClick={onRelocate}>
          <FolderOpen size={14} />
        </Button>
      )}
      <Button variant="ghost" title={t('vault.rename')} onClick={onRename}>
        <Pencil size={14} />
      </Button>
      {onDelete && (
        <Button variant="danger" className="p-1.5" title={t('vault.delete')} onClick={onDelete}>
          <Trash2 size={14} />
        </Button>
      )}
    </div>
  );
}

function CreateRow({
  value, path, onChange, onPickFolder, onCommit, onCancel,
}: {
  value: string;
  path: string | null;
  onChange: (value: string) => void;
  onPickFolder: () => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="vault-card flex-col items-stretch gap-2">
      <div className="flex items-center gap-3">
        <div className="vault-badge"><Vault size={16} /></div>
        <input
          autoFocus
          className={INPUT_CLASS}
          placeholder={t('vault.namePlaceholder')}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommit();
            if (e.key === 'Escape') onCancel();
          }}
        />
        <Button variant="ghost" title={t('vault.create')} disabled={!value.trim()} onClick={onCommit}>
          <Check size={14} />
        </Button>
        <Button variant="ghost" title={t('vault.cancel')} onClick={onCancel}>
          <X size={14} />
        </Button>
      </div>
      <button
        type="button"
        className="flex items-center gap-2 text-xs text-left min-w-0"
        style={{ color: 'var(--text-muted)' }}
        onClick={onPickFolder}
      >
        <FolderOpen size={13} className="shrink-0" />
        <span className="truncate">{path ?? t('vault.chooseFolder')}</span>
      </button>
    </div>
  );
}

// ── modal ────────────────────────────────────────────────────────────────────

export default function VaultModal({ onClose }: Props) {
  const { t } = useTranslation();

  const vaults = useVaultStore((s) => s.vaults);
  const activeVaultId = useVaultStore((s) => s.activeVaultId);
  const switchVault = useVaultStore((s) => s.switchVault);
  const addVault = useVaultStore((s) => s.addVault);
  const renameVault = useVaultStore((s) => s.renameVault);
  const relocateVault = useVaultStore((s) => s.relocateVault);
  const removeVault = useVaultStore((s) => s.removeVault);

  const [editor, setEditor] = useState<Editor>({ kind: 'none' });
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  // 'missing' = Ordner nicht auffindbar, 'denied' = da, aber kein Zugriff.
  // Der Unterschied ist der zwischen "such woanders" und "erlaub den Zugriff".
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
      console.error(`[vault] ${label} failed`, e);
      setError(t('vault.saveFailed'));
    }
  }

  async function pickFolder(): Promise<string | null> {
    const picked = await openFolderDialog({ directory: true, multiple: false });
    if (typeof picked !== 'string') return null;
    setError('');
    return picked;
  }

  async function handleSwitch(id: string) {
    if (id === activeVaultId || switchingId) return;
    setSwitchingId(id);
    setError('');
    try {
      await switchVault(id);
      onClose();
    } catch (e) {
      console.error('[vault] switch failed', e);
      setError(t('vault.switchFailed'));
    } finally {
      setSwitchingId(null);
    }
  }

  // Closes synchronously so a click that opens another editor is not undone by
  // this one resuming after its await; the guard absorbs Enter-then-blur.
  async function commitRename(id: string, value: string) {
    if (editor.kind !== 'rename' || editor.id !== id) return;
    closeEditor();
    const name = value.trim();
    if (!name) return;
    await run('rename', () => renameVault(id, name));
  }

  async function commitCreate(value: string, path: string | null) {
    const name = value.trim();
    if (!name) return;
    await run('create', async () => {
      // Erst pruefen, dann den Editor schliessen: sonst sind Name und Ordner
      // weg, sobald der Ordner nicht taugt.
      if (path) {
        const probe = await probeVaultDir(path);
        if (probe.has_db) {
          setError(t('vault.folderHasVault'));
          return;
        }
        // Ein neuer Vault gehoert in einen leeren Ordner. Sonst vermischen sich
        // seine Dateien mit fremden, und "Dateien loeschen" muesste spaeter
        // entscheiden, was davon ihm gehoert.
        if (!probe.is_empty) {
          setError(t('vault.folderNotEmpty'));
          return;
        }
      }
      closeEditor();
      await addVault(await newVaultRecord(name, path ?? undefined));
    });
  }

  /** Adds a vault that already exists on disk — the route for a folder carried
      over from another machine. */
  async function handleOpenExisting() {
    closeEditor();
    const path = await pickFolder();
    if (!path) return;
    await run('open', async () => {
      if (!(await probeVaultDir(path)).has_db) {
        setError(t('vault.folderHasNoVault'));
        return;
      }
      if (vaults.some((v) => v.path === path)) {
        setError(t('vault.alreadyOpen'));
        return;
      }
      await addVault(await newVaultRecord(folderName(path), path));
    });
  }

  async function handleRelocate(id: string) {
    const path = await pickFolder();
    if (!path) return;
    await run('relocate', async () => {
      if (!(await probeVaultDir(path)).has_db) {
        setError(t('vault.folderHasNoVault'));
        return;
      }
      // Kein manuelles Aufraeumen von `missing` — die geaenderte Vault-Liste
      // laesst den Probe-Effekt ohnehin neu laufen.
      await relocateVault(id, path);
    });
  }

  async function handleRemove(id: string, deleteFiles: boolean) {
    closeEditor();
    setError('');
    try {
      await removeVault(id, deleteFiles);
    } catch (e) {
      console.error('[vault] remove failed', e);
      // `delete_vault_files` raeumt nur die eigenen Dateien weg und laesst den
      // Ordner stehen, sobald noch etwas anderes darin liegt.
      const leftover = String((e as Error)?.message ?? e).includes('VAULT_DIR_NOT_EMPTY');
      setError(t(leftover ? 'vault.deleteFilesLeftover' : 'vault.saveFailed'));
    }
  }

  return (
    <Modal
      title={t('vault.title')}
      onClose={onClose}
      widthClassName="w-[480px]"
      maxHeightClassName="max-h-[80vh]"
      bodyClassName="flex-1 overflow-y-auto px-5 py-4"
    >
      <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>{t('vault.hint')}</p>

      <div className="space-y-2">
        {vaults.map((v) => {
          if (editor.kind === 'rename' && editor.id === v.id) {
            return (
              <RenameRow
                key={v.id}
                value={editor.value}
                onChange={(value) => setEditor({ kind: 'rename', id: v.id, value })}
                onCommit={() => commitRename(v.id, editor.value)}
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
              onRename={() => setEditor({ kind: 'rename', id: v.id, value: v.name })}
              onRelocate={() => handleRelocate(v.id)}
              onDelete={
                !isActive && vaults.length > 1
                  ? () => setEditor({ kind: 'confirmDelete', id: v.id, deleteFiles: false })
                  : null
              }
            />
          );
        })}

        {editor.kind === 'create' ? (
          <CreateRow
            value={editor.value}
            path={editor.path}
            onChange={(value) => setEditor({ kind: 'create', value, path: editor.path })}
            onPickFolder={async () => {
              const path = await pickFolder();
              if (path) setEditor({ kind: 'create', value: editor.value, path });
            }}
            onCommit={() => commitCreate(editor.value, editor.path)}
            onCancel={closeEditor}
          />
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              className="vault-create flex-1"
              onClick={() => setEditor({ kind: 'create', value: '', path: null })}
            >
              <Plus size={16} className="shrink-0" />
              {t('vault.add')}
            </button>
            <button type="button" className="vault-create flex-1" onClick={handleOpenExisting}>
              <FolderOpen size={16} className="shrink-0" />
              {t('vault.open')}
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-xs mt-3 text-danger">{error}</p>}
    </Modal>
  );
}
