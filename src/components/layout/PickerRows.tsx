import { useTranslation } from 'react-i18next';
import {
  AlertTriangle, Check, Cloud, CloudDownload, CloudOff, FolderOpen, HardDrive, Loader2, Pencil, RotateCcw, Trash2, Vault, X,
} from 'lucide-react';
import Button from '../ui/Button';
import EmojiPicker from '../ui/EmojiPicker';
import InlineConfirm from '../ui/InlineConfirm';
import { DEFAULT_EMOJI_PICKER_EMOJIS } from '../../lib/emojiSearch';
import { newVaultTarget, splitPath, type Vault as VaultRecord } from '../../lib/vaultManager';

/**
 * The rows of the vault picker's list. One shape for every kind of vault —
 * here, synced, paused, only on the server — so the list reads as one list;
 * the kind is the quiet mark at the row's end.
 */

const INPUT_CLASS = 'input-field flex-1 min-w-0 rounded-md px-2.5 py-1.5 text-sm outline-none';
const CHECKBOX_CLASS =
  'mt-0.5 w-4 h-4 shrink-0 rounded border flex items-center justify-center transition-colors ' +
  'peer-focus-visible:ring-2 peer-focus-visible:ring-jade-500/35';

export type VaultState = 'local' | 'synced' | 'paused' | 'remote';

const STATE_ICON = { local: HardDrive, synced: Cloud, paused: CloudOff, remote: CloudDownload } as const;
const STATE_LABEL = {
  local: 'sync.stateLocal',
  synced: 'sync.stateSynced',
  paused: 'sync.statePaused',
  remote: 'sync.stateRemote',
} as const;

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

/** The mark at the end of a row: where the vault lives. */
function StateMark({ state }: { state: VaultState }) {
  const { t } = useTranslation();
  const Icon = STATE_ICON[state];
  return (
    <span className={`picker-state picker-state-${state}`} title={t(STATE_LABEL[state])} aria-label={t(STATE_LABEL[state])}>
      <Icon size={14} />
    </span>
  );
}

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
          <button type="button" className="picker-badge picker-badge-interactive" title={t('vault.icon')} onClick={toggle}>
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

function CommitButtons({ label, disabled, onCommit, onCancel }: {
  label: string;
  disabled: boolean;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1 shrink-0">
      <Button tone="jade" compact title={label} aria-label={label} disabled={disabled} onClick={onCommit}>
        <Check size={14} />
      </Button>
      <Button tone="neutral" compact title={t('vault.cancel')} aria-label={t('vault.cancel')} onClick={onCancel}>
        <X size={14} />
      </Button>
    </div>
  );
}

/**
 * Name and icon in one editor, committed together by the check button.
 *
 * Deliberately no commit on blur: the emoji picker's trigger and its search
 * field both take the focus away from this input, so a blur commit would close
 * the row mid-click and take the picker with it.
 */
export function EditRow({
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
    <div className="picker-row picker-row-open">
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
      <CommitButtons label={t('vault.save')} disabled={!name.trim()} onCommit={onCommit} onCancel={onCancel} />
    </div>
  );
}

export function CreateRow({
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
    <div className="picker-row picker-row-open flex-col items-stretch gap-2">
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
        <CommitButtons label={t('vault.create')} disabled={!name.trim()} onCommit={onCommit} onCancel={onCancel} />
      </div>
      <div className="pl-12">
        <VaultLocationRow target={target} customPath={customPath} onPickFolder={onPickFolder} onResetFolder={onResetFolder} />
      </div>
    </div>
  );
}

export function DeleteConfirmRow({
  vault, deleteFiles, busy, onToggleFiles, onConfirm, onCancel,
}: {
  vault: VaultRecord;
  deleteFiles: boolean;
  busy: boolean;
  onToggleFiles: (next: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="picker-row picker-row-open flex-col items-stretch gap-2">
      <div className="flex items-center gap-3">
        <div className="picker-badge">{busy ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}</div>
        <div className="picker-row-name flex-1 min-w-0">{vault.name}</div>
        <InlineConfirm
          message={t('vault.removeConfirm')}
          confirmLabel={t('vault.delete')}
          onConfirm={() => { if (!busy) onConfirm(); }}
          onCancel={onCancel}
        />
      </div>

      <label className="flex items-start gap-2 text-xs cursor-pointer pl-12" style={{ color: 'var(--text-muted)' }}>
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
            deleteFiles ? 'bg-jade-500/30 border-jade-500/60' : 'border-stone-600 hover:border-stone-400'
          }`}
        >
          {deleteFiles && <Check size={10} className="text-jade-400" />}
        </span>
        <span className="min-w-0">
          {t('vault.deleteFiles')}
          {deleteFiles && <span className="block mt-1 text-danger">{t('vault.deleteFilesWarning')}</span>}
        </span>
      </label>
    </div>
  );
}

/** A vault on this device. The open one is tinted; choosing it goes back to it. */
export function VaultRow({
  vault, isActive, unreachable, state, isSwitching, busy, onSwitch, onEdit, onRelocate, onDelete,
}: {
  vault: VaultRecord;
  isActive: boolean;
  unreachable: 'missing' | 'denied' | null;
  state: VaultState;
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
    <div className={`picker-row group${isActive ? ' picker-row-active' : ''}`}>
      <button
        type="button"
        className="picker-row-main"
        disabled={busy || (isUnreachable && !isActive)}
        onClick={onSwitch}
        title={isUnreachable ? undefined : isActive ? t('vault.backTo', { name: vault.name }) : vault.path}
      >
        {/* Status beats identity: during a switch and with an unreachable
            folder, what is going on matters, not which vault it is. */}
        <span className="picker-badge">
          {isSwitching
            ? <Loader2 size={16} className="animate-spin" />
            : isUnreachable
              ? <AlertTriangle size={16} className="text-danger" />
              : <VaultGlyph icon={vault.icon} size={16} />}
        </span>
        <span className="flex-1 min-w-0">
          <span className="picker-row-name">{vault.name}</span>
          {unreachable && (
            <span className="picker-row-meta text-danger">
              {t(unreachable === 'denied' ? 'vault.accessDenied' : 'vault.missing')}
            </span>
          )}
        </span>
      </button>

      <span className="picker-row-actions">
        {unreachable === 'missing' && (
          <Button tone="neutral" compact small title={t('vault.relocate')} aria-label={t('vault.relocate')} onClick={onRelocate}>
            <FolderOpen size={12} />
          </Button>
        )}
        <Button tone="neutral" compact small title={t('vault.edit')} aria-label={t('vault.edit')} onClick={onEdit}>
          <Pencil size={12} />
        </Button>
        <Button tone="danger" compact small title={t('vault.delete')} aria-label={t('vault.delete')} onClick={onDelete}>
          <Trash2 size={12} />
        </Button>
      </span>
      <StateMark state={state} />
    </div>
  );
}

/** A vault only on the server: choosing it fetches it. */
export function RemoteRow({
  name, size, isFetching, busy, confirming, onFetch, onDelete, onConfirmDelete, onCancelDelete,
}: {
  name: string;
  size: string;
  isFetching: boolean;
  busy: boolean;
  confirming: boolean;
  onFetch: () => void;
  onDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  const { t } = useTranslation();
  if (confirming) {
    return (
      <div className="picker-row picker-row-open">
        <span className="picker-badge"><Trash2 size={16} /></span>
        <span className="picker-row-name flex-1 min-w-0">{name}</span>
        <InlineConfirm
          message={t('sync.deleteFromServerConfirm')}
          onConfirm={() => { if (!busy) onConfirmDelete(); }}
          onCancel={onCancelDelete}
        />
      </div>
    );
  }
  return (
    <div className="picker-row picker-row-remote group">
      <button type="button" className="picker-row-main" disabled={busy} onClick={onFetch} title={t('sync.fetch')}>
        <span className="picker-badge">
          {isFetching ? <Loader2 size={16} className="animate-spin" /> : <Vault size={16} />}
        </span>
        <span className="flex-1 min-w-0">
          <span className="picker-row-name">{name}</span>
          <span className="picker-row-meta">{size}</span>
        </span>
      </button>
      <span className="picker-row-actions">
        <Button tone="danger" compact small title={t('sync.deleteFromServer')} aria-label={t('sync.deleteFromServer')} onClick={onDelete}>
          <Trash2 size={12} />
        </Button>
      </span>
      <StateMark state="remote" />
    </div>
  );
}
