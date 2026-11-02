import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cloud } from 'lucide-react';
import Button from '../../ui/Button';
import { KeyField, onEnter } from '../vaultKeyParts';
import { connectOpenVault, disconnectOpenVault, removeDevice, serverInfo, syncErrorCode, syncNow, syncPair, syncStatus, type ServerInfo, type SyncStatus } from '../../../lib/sync/engine';
import { formatBytes } from '../../../lib/helpers';
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
  const [key, setKey] = useState('');
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const adoptServerPassword = useVaultStore((s) => s.adoptServerPassword);

  const refresh = useCallback(async () => {
    const next = await syncStatus(vaultId);
    setStatus(next);
    if (next.url) setUrl(next.url);
    if (next.connected && next.hasRemote && !next.needsLogin) {
      serverInfo(vaultId).then(setInfo, (e) => console.warn('[sync] server info', e));
    } else {
      setInfo(null);
    }
  }, [vaultId]);

  useEffect(() => {
    refresh().catch((e) => console.error('[sync] status', e));
  }, [refresh, running]);

  const byteUnits: [string, string, string] = [t('common.bytes'), t('common.kilobytes'), t('common.megabytes')];

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await refresh();
      setKey('');
    } catch (e) {
      console.warn('[sync]', e);
      setError(t(syncErrorKey(syncErrorCode(e))));
    } finally {
      setBusy(false);
    }
  }

  const submit = () => act(async () => {
    if (!url.trim() || !key.trim()) return;
    await syncPair(vaultId, url, key);
    // A pairing that only renews a lost token: the vault is on the server already.
    if (!status?.hasRemote) await connectOpenVault(vaultId, vault?.name ?? '');
    else await syncNow();
  });

  if (!status) return null;
  // The token here can look fine and still have been taken on the server.
  const removed = syncError === 'SYNC_NEEDS_LOGIN';
  const showForm = !status.connected || status.needsLogin || removed || !status.hasRemote;
  const syncMessage = syncError ? t(syncErrorKey(syncError)) : '';

  return (
    <SettingsSection icon={<Cloud size={14} />} title={t('sync.title')} description={t('sync.description')}>
      {showForm ? (
        <div className="space-y-3">
          {(status.needsLogin || removed) && <SettingsDescription>{t('sync.needsLogin')}</SettingsDescription>}
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
          <KeyField label={t('sync.key')}>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              className="input-field settings-field"
              value={key}
              disabled={busy}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={onEnter(submit)}
            />
          </KeyField>
          <SettingsDescription>{t('sync.keyHint')}</SettingsDescription>
          <Button variant="primary" onClick={submit} disabled={busy || !url.trim() || !key.trim()}>
            {busy ? t('sync.connecting') : status.connected ? t('sync.login') : t('sync.connect')}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-sm text-secondary break-all">{t('sync.connectedTo', { url: status.url })}</div>
          <div className="text-xs text-muted">
            {running ? t('sync.running') : lastSync ? t('sync.last', { time: formatTimeDistance(new Date(lastSync)) }) : t('sync.notYet')}
          </div>
          {conflicts > 0 && <SettingsStatus tone="muted">{t('sync.conflicts', { count: conflicts })}</SettingsStatus>}
          {syncMessage && <SettingsStatus tone="error">{syncMessage}</SettingsStatus>}
          {syncError === 'SYNC_PASSWORD_CHANGED' && (
            <>
              <KeyField label={t('sync.newVaultPassword')}>
                <input
                  type="password"
                  autoComplete="current-password"
                  className="input-field settings-field"
                  value={newPassword}
                  disabled={busy}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </KeyField>
              <Button
                variant="primary"
                disabled={busy || !newPassword}
                onClick={() => act(async () => {
                  await adoptServerPassword(newPassword);
                  setNewPassword('');
                  await syncNow();
                })}
              >
                {t('sync.adoptPassword')}
              </Button>
            </>
          )}
          {info && (
            <div className="space-y-2">
              <div className="text-sm text-secondary">
                {t('sync.stored', { size: formatBytes(info.storedBytes, byteUnits), count: info.images })}
              </div>
              <div className="label-xs">{t('sync.devices')}</div>
              {info.devices.map((device) => (
                <div key={device.id} className="settings-row">
                  <span className="text-sm text-secondary min-w-0 truncate">
                    {device.name || t('sync.unnamedDevice')}
                    {device.id === info.me
                      ? ` (${t('sync.thisDevice')})`
                      : ` · ${t('sync.lastSeen', { time: formatTimeDistance(new Date(device.last_seen * 1000)) })}`}
                  </span>
                  {device.id !== info.me && (
                    <Button tone="danger" className="shrink-0" disabled={busy} onClick={() => act(() => removeDevice(vaultId, device.id))}>
                      {t('sync.removeDevice')}
                    </Button>
                  )}
                </div>
              ))}
              <SettingsDescription>{t('sync.removeHint')}</SettingsDescription>
            </div>
          )}
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
