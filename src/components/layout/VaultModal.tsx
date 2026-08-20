import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, Pencil, Plus, Trash2, Vault, X } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { useVaultStore } from '../../store/vaultStore';

interface Props {
  onClose: () => void;
}

const INPUT_CLASS = 'input-field flex-1 min-w-0 rounded-lg px-2.5 py-1.5 text-sm outline-none';

/** The one open editor, if any — rename, delete confirmation and the create row
    are mutually exclusive, so they share a single state. */
type Editor =
  | { kind: 'none' }
  | { kind: 'rename'; id: string; value: string }
  | { kind: 'confirmDelete'; id: string }
  | { kind: 'create'; value: string };

export default function VaultModal({ onClose }: Props) {
  const { t } = useTranslation();

  const vaults = useVaultStore((s) => s.vaults);
  const activeVaultId = useVaultStore((s) => s.activeVaultId);
  const switchVault = useVaultStore((s) => s.switchVault);
  const createVault = useVaultStore((s) => s.createVault);
  const renameVault = useVaultStore((s) => s.renameVault);
  const removeVault = useVaultStore((s) => s.removeVault);

  const [editor, setEditor] = useState<Editor>({ kind: 'none' });
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const closeEditor = () => setEditor({ kind: 'none' });

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
    try {
      await renameVault(id, name);
    } catch (e) {
      console.error('[vault] rename failed', e);
      setError(t('vault.saveFailed'));
    }
  }

  async function commitCreate(value: string) {
    const name = value.trim();
    if (!name) return;
    closeEditor();
    try {
      await createVault(name);
    } catch (e) {
      console.error('[vault] create failed', e);
      setError(t('vault.saveFailed'));
    }
  }

  async function handleRemove(id: string) {
    closeEditor();
    try {
      await removeVault(id);
    } catch (e) {
      console.error('[vault] remove failed', e);
      setError(t('vault.saveFailed'));
    }
  }

  return (
    <Modal
      title={t('vault.title')}
      onClose={onClose}
      widthClassName="w-[440px]"
      maxHeightClassName="max-h-[80vh]"
      bodyClassName="flex-1 overflow-y-auto px-5 py-4"
    >
      <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>{t('vault.hint')}</p>

      <div className="space-y-2">
        {vaults.map((v) => {
          const isSwitching = switchingId === v.id;

          if (editor.kind === 'rename' && editor.id === v.id) {
            return (
              <div key={v.id} className="vault-card">
                <div className="vault-badge"><Vault size={16} /></div>
                <input
                  autoFocus
                  className={INPUT_CLASS}
                  value={editor.value}
                  onChange={(e) => setEditor({ kind: 'rename', id: v.id, value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(v.id, editor.value);
                    if (e.key === 'Escape') closeEditor();
                  }}
                  onBlur={() => commitRename(v.id, editor.value)}
                />
              </div>
            );
          }

          if (editor.kind === 'confirmDelete' && editor.id === v.id) {
            return (
              <div key={v.id} className="vault-card">
                <div className="vault-badge"><Trash2 size={16} /></div>
                <div className="flex-1 min-w-0">
                  <div className="vault-name">{v.name}</div>
                  <div className="vault-meta">{t('vault.deleteHint')}</div>
                </div>
                <Button onClick={() => handleRemove(v.id)} variant="danger" className="text-xs px-1">
                  {t('trash.confirmYes')}
                </Button>
                <Button onClick={closeEditor} variant="ghost" className="text-xs">
                  {t('trash.confirmNo')}
                </Button>
              </div>
            );
          }

          const isActive = v.id === activeVaultId;

          return (
            <div
              key={v.id}
              className={isActive ? 'vault-card vault-card-active' : 'vault-card vault-card-idle'}
            >
              <button
                type="button"
                disabled={isActive || switchingId !== null}
                onClick={() => handleSwitch(v.id)}
                title={isActive ? undefined : t('vault.switch')}
                className="flex items-center gap-3 flex-1 min-w-0 text-left"
              >
                <div className="vault-badge">
                  {isSwitching ? <Loader2 size={16} className="animate-spin" /> : <Vault size={16} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="vault-name">{v.name}</div>
                  <div className="vault-meta truncate">{isSwitching ? t('vault.switching') : v.dbName}</div>
                </div>
              </button>

              {isActive && <span className="vault-active-label">{t('vault.active')}</span>}

              <Button
                variant="ghost"
                title={t('vault.rename')}
                onClick={() => setEditor({ kind: 'rename', id: v.id, value: v.name })}
              >
                <Pencil size={14} />
              </Button>
              {!isActive && vaults.length > 1 && (
                <Button
                  variant="danger"
                  className="p-1.5"
                  title={t('vault.delete')}
                  onClick={() => setEditor({ kind: 'confirmDelete', id: v.id })}
                >
                  <Trash2 size={14} />
                </Button>
              )}
            </div>
          );
        })}

        {editor.kind === 'create' ? (
          <div className="vault-card">
            <div className="vault-badge"><Vault size={16} /></div>
            <input
              autoFocus
              className={INPUT_CLASS}
              placeholder={t('vault.namePlaceholder')}
              value={editor.value}
              onChange={(e) => setEditor({ kind: 'create', value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitCreate(editor.value);
                if (e.key === 'Escape') closeEditor();
              }}
            />
            <Button
              variant="ghost"
              title={t('vault.create')}
              disabled={!editor.value.trim()}
              onClick={() => commitCreate(editor.value)}
            >
              <Check size={14} />
            </Button>
            <Button variant="ghost" title={t('vault.cancel')} onClick={closeEditor}>
              <X size={14} />
            </Button>
          </div>
        ) : (
          <button type="button" className="vault-create" onClick={() => setEditor({ kind: 'create', value: '' })}>
            <Plus size={16} className="shrink-0" />
            {t('vault.add')}
          </button>
        )}
      </div>

      {error && (
        <p className="text-xs mt-3" style={{ color: 'var(--danger-text)' }}>{error}</p>
      )}
    </Modal>
  );
}
