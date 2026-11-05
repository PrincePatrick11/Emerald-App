import { useTranslation } from 'react-i18next';
import {
  AlertTriangle, Check, CloudDownload, FolderOpen, Loader2, Pencil, Plus, RotateCcw, Trash2, Vault, X,
} from 'lucide-react';
import Button from '../ui/Button';
import BlockCheckbox from '../blocks/BlockCheckbox';
import EmojiPicker from '../ui/EmojiPicker';
import InlineConfirm from '../ui/InlineConfirm';
import { DEFAULT_EMOJI_PICKER_EMOJIS } from '../../lib/emojiSearch';
import { newVaultTarget, splitPath, type Vault as VaultRecord } from '../../lib/vaultManager';

/**
 * The tiles of the vault picker's grid, editing included, and the rows that
 * open across it (create, confirm). One shape for every kind of vault — here, synced,
 * paused, only on the server — so the grid reads as one list; the kind is the
 * line under the name.
 */

const INPUT_CLASS = 'input-field flex-1 min-w-0 rounded-md px-2.5 py-1.5 text-sm outline-none';

export type VaultState = 'local' | 'synced' | 'paused' | 'remote';

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
          <Button variant="ghost" className="shrink-0" title={t('vault.defaultFolder')} aria-label={t('vault.defaultFolder')} onClick={onResetFolder}>
            <RotateCcw size={14} />
          </Button>
        )}
      </div>
      <span className="block text-xs break-all">
        <span className="text-subtle">{targetParent}</span>
        <span className="text-muted">{targetLeaf}</span>
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

/** The line under a tile's name: where the vault lives, in words, with a dot
 *  in the state's colour. */
function StateLine({ state, extra }: { state: VaultState; extra?: string }) {
  const { t } = useTranslation();
  return (
    <span className={`picker-tile-state picker-tile-state-${state}`}>
      <span className="picker-tile-dot" aria-hidden />
      <span className="truncate">{extra ? `${t(STATE_LABEL[state])} · ${extra}` : t(STATE_LABEL[state])}</span>
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
          <button type="button" className="picker-badge picker-badge-interactive" title={t('vault.icon')} aria-label={t('vault.icon')} onClick={toggle}>
            <VaultGlyph icon={icon} size={16} />
          </button>
        )}
      />
      {icon && (
        <Button variant="ghost" title={t('vault.resetIcon')} aria-label={t('vault.resetIcon')} onClick={() => onChange(undefined)}>
          <RotateCcw size={14} />
        </Button>
      )}
    </>
  );
}

function CommitButtons({ label, disabled, small, onCommit, onCancel }: {
  label: string;
  disabled: boolean;
  /** 24px, for the tile. */
  small?: boolean;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const size = small ? 12 : 14;
  return (
    <div className="flex items-center gap-1 shrink-0">
      <Button tone="jade" compact small={small} title={label} aria-label={label} disabled={disabled} onClick={onCommit}>
        <Check size={size} />
      </Button>
      <Button tone="neutral" compact small={small} title={t('vault.cancel')} aria-label={t('vault.cancel')} onClick={onCancel}>
        <X size={size} />
      </Button>
    </div>
  );
}

/**
 * Name and icon in one editor, committed together by the check button. It
 * stays a tile: the badge picks the icon, the field below takes the name.
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
    <div className="picker-tile picker-tile-editing">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <IconField icon={icon} onChange={onChangeIcon} />
        </div>
        <CommitButtons small label={t('vault.save')} disabled={!name.trim()} onCommit={onCommit} onCancel={onCancel} />
      </div>
      <input
        autoFocus
        className="input-field w-full min-w-0 rounded-md px-2.5 py-1 text-sm outline-none"
        aria-label={t('vault.namePlaceholder')}
        value={name}
        onChange={(e) => onChangeName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCommit();
          if (e.key === 'Escape') onCancel();
        }}
      />
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
          message={t(deleteFiles ? 'vault.deleteConfirmFiles' : 'vault.removeConfirm')}
          confirmLabel={t('vault.delete')}
          onConfirm={() => { if (!busy) onConfirm(); }}
          onCancel={onCancel}
        />
      </div>

      <div className="pl-12">
        <BlockCheckbox
          checked={deleteFiles}
          onChange={onToggleFiles}
          label={t('vault.deleteFiles')}
          hint={deleteFiles ? t('vault.deleteFilesWarning') : undefined}
          tone="danger"
        />
      </div>
    </div>
  );
}

/** A vault on this device, as a tile. The open one is tinted and says so;
 *  choosing it goes back to it. Edit and delete show in its corner on hover or
 *  focus. */
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
    <div className={`picker-tile group${isActive ? ' picker-tile-active' : ''}`}>
      <button
        type="button"
        className="picker-tile-main"
        disabled={busy || (isUnreachable && !isActive)}
        onClick={onSwitch}
        title={isUnreachable ? undefined : isActive ? t('vault.backTo', { name: vault.name }) : vault.path}
      >
        {/* Status beats identity: during a switch and with an unreachable
            folder, what is going on matters, not which vault it is. */}
        <span className="picker-badge">
          {isSwitching
            ? <Loader2 size={18} className="animate-spin" />
            : isUnreachable
              ? <AlertTriangle size={18} className="text-danger" />
              : <VaultGlyph icon={vault.icon} size={18} />}
        </span>
        <span className="block min-w-0">
          <span className="picker-row-name">{vault.name}</span>
          {unreachable ? (
            <span className="picker-tile-state text-danger">
              <span className="truncate">{t(unreachable === 'denied' ? 'vault.accessDenied' : 'vault.missing')}</span>
            </span>
          ) : (
            <StateLine state={state} />
          )}
        </span>
      </button>

      <span className="picker-tile-corner">
        {isActive && <span className="picker-tile-open">{t('start.opened')}</span>}
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
      </span>
    </div>
  );
}

/** A vault only on the server, as a tile with a dashed edge: choosing it fetches it. */
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
    <div className="picker-tile picker-tile-remote group">
      <button type="button" className="picker-tile-main" disabled={busy} onClick={onFetch} title={t('sync.fetch')}>
        <span className="picker-badge">
          {isFetching ? <Loader2 size={18} className="animate-spin" /> : <CloudDownload size={18} />}
        </span>
        <span className="block min-w-0">
          <span className="picker-row-name">{name}</span>
          <StateLine state="remote" extra={size} />
        </span>
      </button>
      <span className="picker-tile-corner">
        <span className="picker-row-actions">
          <Button tone="danger" compact small title={t('sync.deleteFromServer')} aria-label={t('sync.deleteFromServer')} onClick={onDelete}>
            <Trash2 size={12} />
          </Button>
        </span>
      </span>
    </div>
  );
}

/** The last tile: a new vault. */
export function CreateTile({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="picker-tile-new" onClick={onClick}>
      <Plus size={16} />
      {t('vault.add')}
    </button>
  );
}
