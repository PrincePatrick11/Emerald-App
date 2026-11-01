import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '../ui/Button';
import { KeyField, onEnter } from './vaultKeyParts';
import { abandonLogin, adoptRemoteVault, remoteVaults, syncErrorCode, syncLogin, type RemoteVault } from '../../lib/sync/engine';
import { syncErrorKey } from '../../lib/sync/errors';
import { newVaultRecord, type Vault as VaultRecord } from '../../lib/vaultManager';
import { VAULT_KEY_CANCELLED } from '../../store/vaultKeyStore';
import { useVaultStore } from '../../store/vaultStore';
import { keyErrorOf } from '../../lib/vaultKeys';

/**
 * Fetches a vault from a sync server onto this device. Logging in comes first,
 * so nothing is left in the vault list if that fails. Then it is a vault like
 * any other with a `vault.key` and no database: the usual question for its
 * password opens it, and the first sync fills it.
 */
export default function ServerVaultForm({ target, onCancel, onDone }: {
  /** The folder for a vault of this name. */
  target: (name: string) => Promise<string | undefined>;
  onCancel: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const addVault = useVaultStore((s) => s.addVault);
  const switchVault = useVaultStore((s) => s.switchVault);

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [record, setRecord] = useState<VaultRecord | null>(null);
  const [remotes, setRemotes] = useState<RemoteVault[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function open(pending: VaultRecord, remote: RemoteVault) {
    await addVault(pending);
    await adoptRemoteVault(pending.id, remote.id);
    await switchVault(pending.id);
    onDone();
  }

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      if (keyErrorOf(e) === VAULT_KEY_CANCELLED) return;
      console.warn('[sync]', e);
      setError(t(syncErrorKey(syncErrorCode(e))));
    } finally {
      setBusy(false);
    }
  }

  const login = () => act(async () => {
    if (!name.trim() || !url.trim() || !username.trim() || !password) return;
    const pending = await newVaultRecord(name.trim(), { path: await target(name.trim()) });
    await syncLogin(pending.id, url, username, password, false);
    const found = await remoteVaults(pending.id);
    if (found.length === 1) {
      await open(pending, found[0]);
      return;
    }
    setRecord(pending);
    setRemotes(found);
  });

  async function cancel() {
    if (record) await abandonLogin(record.id).catch((e) => console.warn('[sync]', e));
    onCancel();
  }

  return (
    <div className="space-y-3">
      {record ? (
        remotes.length === 0 ? (
          <p className="text-sm text-secondary">{t('sync.noRemoteVaults')}</p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-secondary">{t('sync.pickRemote')}</p>
            {remotes.map((remote, i) => (
              <Button key={remote.id} className="w-full justify-center" disabled={busy} onClick={() => act(() => open(record, remote))}>
                {t('sync.remoteVault', { number: i + 1, count: remote.head })}
              </Button>
            ))}
          </div>
        )
      ) : (
        <>
          <KeyField label={t('sync.vaultName')}>
            <input type="text" autoFocus className="input-field settings-field" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
          </KeyField>
          <KeyField label={t('sync.url')}>
            <input type="url" spellCheck={false} className="input-field settings-field" placeholder="https://sync.example.com" value={url} disabled={busy} onChange={(e) => setUrl(e.target.value)} />
          </KeyField>
          <KeyField label={t('sync.username')}>
            <input type="text" spellCheck={false} autoComplete="username" className="input-field settings-field" value={username} disabled={busy} onChange={(e) => setUsername(e.target.value)} />
          </KeyField>
          <KeyField label={t('sync.password')}>
            <input type="password" autoComplete="current-password" className="input-field settings-field" value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)} onKeyDown={onEnter(login)} />
          </KeyField>
        </>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        {!record && (
          <Button variant="primary" className="flex-1 justify-center" disabled={busy || !name.trim() || !url.trim() || !username.trim() || !password} onClick={login}>
            {busy ? t('sync.connecting') : t('sync.fetch')}
          </Button>
        )}
        <Button variant="secondary" className="flex-1 justify-center" disabled={busy} onClick={cancel}>{t('common.cancel')}</Button>
      </div>
    </div>
  );
}
