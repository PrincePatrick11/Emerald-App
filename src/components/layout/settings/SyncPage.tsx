import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cloud } from 'lucide-react';
import Button from '../../ui/Button';
import { KeyField, onEnter } from '../vaultKeyParts';
import { connectOpenVault, disconnectOpenVault, syncErrorCode, syncLogin, syncNow, syncStatus, type SyncStatus } from '../../../lib/sync/engine';
import { syncErrorKey } from '../../../lib/sync/errors';
import { formatTimeDistance } from '../../../lib/formatDate';
import { useSyncStore } from '../../../store/syncStore';
import { activeVault, useVaultStore } from '../../../store/vaultStore';
import SettingsSection, { SettingsDescription, SettingsStatus } from './SettingsSection';

/** Whether the open vault syncs with a server, and with which. */
export default function SyncPage() {
  const { t } = useTranslation();
  const vault = useVaultStore(activeVault);
  const vaultId = vault?.id ?? '';
  const running = useSyncStore((s) => s.running);
  const syncError = useSyncStore((s) => s.error);
  const lastSync = useSyncStore((s) => s.lastSync);
  const conflicts = useSyncStore((s) => s.conflicts);

  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [signup, setSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const next = await syncStatus(vaultId);
    setStatus(next);
    if (next.url) setUrl(next.url);
    if (next.username) setUsername(next.username);
  }, [vaultId]);

  useEffect(() => {
    refresh().catch((e) => console.error('[sync] status', e));
  }, [refresh, running]);

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await refresh();
      setPassword('');
    } catch (e) {
      console.warn('[sync]', e);
      setError(t(syncErrorKey(syncErrorCode(e))));
    } finally {
      setBusy(false);
    }
  }

  const submit = () => act(async () => {
    if (!url.trim() || !username.trim() || !password) return;
    await syncLogin(vaultId, url, username, password, signup);
    // A login that only renews a lost token: the vault is on the server already.
    if (!status?.hasRemote) await connectOpenVault(vaultId, vault?.name ?? '');
  });

  if (!status) return null;
  const showForm = !status.connected || status.needsLogin || !status.hasRemote;
  const syncMessage = syncError ? t(syncErrorKey(syncError)) : '';

  return (
    <SettingsSection icon={<Cloud size={14} />} title={t('sync.title')} description={t('sync.description')}>
      {showForm ? (
        <div className="space-y-3">
          {status.needsLogin && <SettingsDescription>{t('sync.needsLogin')}</SettingsDescription>}
          <KeyField label={t('sync.url')}>
            <input
              type="url"
              className="input-field settings-field"
              placeholder="https://sync.example.com"
              spellCheck={false}
              value={url}
              disabled={busy}
              onChange={(e) => setUrl(e.target.value)}
            />
          </KeyField>
          <KeyField label={t('sync.username')}>
            <input
              type="text"
              autoComplete="username"
              spellCheck={false}
              className="input-field settings-field"
              value={username}
              disabled={busy}
              onChange={(e) => setUsername(e.target.value)}
            />
          </KeyField>
          <KeyField label={t('sync.password')}>
            <input
              type="password"
              autoComplete={signup ? 'new-password' : 'current-password'}
              className="input-field settings-field"
              value={password}
              disabled={busy}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={onEnter(submit)}
            />
          </KeyField>
          <SettingsDescription>{t('sync.passwordHint')}</SettingsDescription>
          {!status.connected && (
            <label className="flex items-center gap-2 text-sm text-secondary">
              <input type="checkbox" checked={signup} disabled={busy} onChange={(e) => setSignup(e.target.checked)} />
              {t('sync.signup')}
            </label>
          )}
          <Button variant="primary" onClick={submit} disabled={busy || !url.trim() || !username.trim() || !password}>
            {busy ? t('sync.connecting') : status.connected ? t('sync.login') : t('sync.connect')}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-sm text-secondary break-all">{t('sync.connectedTo', { url: status.url, username: status.username })}</div>
          <div className="text-xs text-muted">
            {running ? t('sync.running') : lastSync ? t('sync.last', { time: formatTimeDistance(new Date(lastSync)) }) : t('sync.notYet')}
          </div>
          {conflicts > 0 && <SettingsStatus tone="muted">{t('sync.conflicts', { count: conflicts })}</SettingsStatus>}
          {syncMessage && <SettingsStatus tone="error">{syncMessage}</SettingsStatus>}
          <div className="flex items-center gap-2 flex-wrap">
            <Button onClick={() => act(syncNow)} disabled={busy || running}>{t('sync.now')}</Button>
            <Button tone="danger" onClick={() => act(() => disconnectOpenVault(vaultId))} disabled={busy || running}>{t('sync.disconnect')}</Button>
          </div>
          <SettingsDescription>{t('sync.disconnectHint')}</SettingsDescription>
        </div>
      )}
      {error && <SettingsStatus tone="error" className="mt-3">{error}</SettingsStatus>}
    </SettingsSection>
  );
}
