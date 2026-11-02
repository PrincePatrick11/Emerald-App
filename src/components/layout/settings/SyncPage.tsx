import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cloud, HardDrive, MonitorSmartphone } from 'lucide-react';
import Button from '../../ui/Button';
import RemoteVaultList from '../RemoteVaultList';
import { KeyField, onEnter } from '../vaultKeyParts';
import {
  deleteRemoteVault, pauseVault, removeDevice, resumeVault, serverDevices, serverStatus, syncErrorCode, syncNow,
  syncPair, syncUnpair, uploadOpenVault, type ServerDevices, type ServerStatus,
} from '../../../lib/sync/engine';
import { syncErrorKey } from '../../../lib/sync/errors';
import { formatTimeDistance } from '../../../lib/formatDate';
import { useSyncStore } from '../../../store/syncStore';
import { useVaultStore } from '../../../store/vaultStore';
import SettingsSection, { SettingsDescription, SettingsStatus } from './SettingsSection';

/** The one server this installation talks to, and which vaults are on it. */
export default function SyncPage() {
  const { t } = useTranslation();
  const vaults = useVaultStore((s) => s.vaults);
  const activeId = useVaultStore((s) => s.activeVaultId);
  const switchVault = useVaultStore((s) => s.switchVault);
  const running = useSyncStore((s) => s.running);
  const syncError = useSyncStore((s) => s.error);
  const lastSync = useSyncStore((s) => s.lastSync);
  const conflicts = useSyncStore((s) => s.conflicts);

  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [devices, setDevices] = useState<ServerDevices | null>(null);
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [listVersion, setListVersion] = useState(0);
  const [newPassword, setNewPassword] = useState('');
  const adoptServerPassword = useVaultStore((s) => s.adoptServerPassword);

  const refresh = useCallback(async () => {
    const next = await serverStatus();
    setStatus(next);
    if (next.url) {
      setUrl(next.url);
      serverDevices().then(setDevices, (e) => console.warn('[sync] devices', e));
    } else {
      setDevices(null);
    }
    setListVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    refresh().catch((e) => console.error('[sync] status', e));
  }, [refresh, activeId]);

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await refresh();
    } catch (e) {
      console.warn('[sync]', e);
      setError(t(syncErrorKey(syncErrorCode(e))));
    } finally {
      setBusy(false);
    }
  }

  const submit = () => act(async () => {
    if (!url.trim() || !key.trim()) return;
    await syncPair(url, key);
    setKey('');
    await syncNow();
  });

  if (!status) return null;
  // The token here can look fine and still have been taken on the server.
  const removed = syncError === 'SYNC_NEEDS_LOGIN';
  const showForm = !status.url || removed || status.needsKey;
  const syncMessage = syncError ? t(syncErrorKey(syncError)) : '';

  return (
    <>
      <SettingsSection icon={<Cloud size={14} />} title={t('sync.title')} description={t('sync.description')}>
        {showForm ? (
          <div className="space-y-3">
            {(removed || status.needsKey) && <SettingsDescription>{t('sync.needsLogin')}</SettingsDescription>}
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
              {busy ? t('sync.connecting') : removed || status.needsKey ? t('sync.login') : t('sync.connect')}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm text-secondary break-all">{t('sync.connectedTo', { url: status.url })}</div>
            <div className="text-xs text-muted">
              {running ? t('sync.running') : lastSync ? t('sync.last', { time: formatTimeDistance(new Date(lastSync)) }) : t('sync.notYet')}
            </div>
            {!status.remembered && Object.keys(status.links).length > 0 && <SettingsStatus tone="muted">{t('sync.noKeychain')}</SettingsStatus>}
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
            <div className="flex items-center gap-2 flex-wrap">
              <Button onClick={() => act(syncNow)} disabled={busy || running}>{t('sync.now')}</Button>
              <Button tone="danger" onClick={() => act(syncUnpair)} disabled={busy || running}>{t('sync.disconnectServer')}</Button>
            </div>
            <SettingsDescription>{t('sync.disconnectServerHint')}</SettingsDescription>
          </div>
        )}
        {error && <SettingsStatus tone="error" className="mt-3">{error}</SettingsStatus>}
      </SettingsSection>

      {!showForm && (
        <>
          <SettingsSection icon={<HardDrive size={14} />} title={t('sync.vaultsHere')} description={t('sync.vaultsHereHint')}>
            <div className="space-y-2">
              {vaults.map((vault) => {
                const link = status.links[vault.id];
                const open = vault.id === activeId;
                return (
                  <div key={vault.id} className="settings-row">
                    <span className="text-sm text-secondary min-w-0 truncate">
                      {vault.name} · {!link ? t('sync.stateLocal') : link.paused ? t('sync.statePaused') : t('sync.stateSynced')}
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      {confirming === vault.id ? (
                        <>
                          <Button tone="danger" disabled={busy} onClick={() => act(async () => { await deleteRemoteVault(link.remote, vault.id); setConfirming(null); })}>{t('sync.reallyDelete')}</Button>
                          <Button disabled={busy} onClick={() => setConfirming(null)}>{t('common.cancel')}</Button>
                        </>
                      ) : !open ? (
                        <Button disabled={busy} onClick={() => act(() => switchVault(vault.id).then(() => undefined))}>{t('sync.openVault')}</Button>
                      ) : !link ? (
                        <Button variant="primary" disabled={busy} onClick={() => act(() => uploadOpenVault(vault.id, vault.name))}>{t('sync.upload')}</Button>
                      ) : (
                        <>
                          {link.paused
                            ? <Button disabled={busy} onClick={() => act(() => resumeVault(vault.id))}>{t('sync.resume')}</Button>
                            : <Button disabled={busy} onClick={() => act(() => pauseVault(vault.id))}>{t('sync.pause')}</Button>}
                          <Button tone="danger" disabled={busy} onClick={() => setConfirming(vault.id)}>{t('sync.deleteFromServer')}</Button>
                        </>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </SettingsSection>

          <SettingsSection icon={<Cloud size={14} />} title={t('sync.vaultsThere')} description={t('sync.vaultsThereHint')}>
            <RemoteVaultList
              key={listVersion}
              exclude={Object.values(status.links).map((link) => link.remote)}
              onChange={() => { void refresh(); }}
            />
          </SettingsSection>

          {devices && (
            <SettingsSection icon={<MonitorSmartphone size={14} />} title={t('sync.devices')} description={t('sync.removeHint')}>
              <div className="space-y-2">
                {devices.devices.map((device) => (
                  <div key={device.id} className="settings-row">
                    <span className="text-sm text-secondary min-w-0 truncate">
                      {device.name || t('sync.unnamedDevice')}
                      {device.id === devices.me
                        ? ` (${t('sync.thisDevice')})`
                        : ` · ${t('sync.lastSeen', { time: formatTimeDistance(new Date(device.last_seen * 1000)) })}`}
                    </span>
                    {device.id !== devices.me && (
                      <Button tone="danger" className="shrink-0" disabled={busy} onClick={() => act(() => removeDevice(device.id))}>
                        {t('sync.removeDevice')}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </SettingsSection>
          )}
        </>
      )}
    </>
  );
}
