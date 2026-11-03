import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cloud, MonitorSmartphone } from 'lucide-react';
import Button from '../ui/Button';
import RemoteVaultList from './RemoteVaultList';
import { KeyField, onEnter } from './vaultKeyParts';
import SettingsSection, { SettingsDescription, SettingsStatus } from './settings/SettingsSection';
import {
  removeDevice, serverDevices, serverStatus, syncErrorCode, syncNow, syncPair, syncUnpair,
  type ServerDevices, type ServerStatus,
} from '../../lib/sync/engine';
import { syncErrorKey } from '../../lib/sync/errors';
import { formatTimeDistance } from '../../lib/formatDate';
import { useSyncStore } from '../../store/syncStore';
import { useVaultStore } from '../../store/vaultStore';

/**
 * The server in the vault picker: connecting it, the vaults on it that are not
 * here yet, the devices, disconnecting it.
 *
 * Nothing here needs an open vault — the picker may have none. Every call goes
 * to `sync.rs` commands that read only `sync.json` and the keychain; fetching
 * a vault writes its `vault.key` into the new folder and then opens it through
 * the picker like any other (`onOpen`). Putting a vault on the server needs it
 * open, so that stays under Settings → Sync.
 */
export default function PickerServerSection({ onOpen, onChange }: {
  onOpen: (vaultId: string) => Promise<void>;
  /** The links changed: the picker's sync marks follow. */
  onChange: () => void;
}) {
  const { t } = useTranslation();
  const syncError = useSyncStore((s) => s.error);
  const vaults = useVaultStore((s) => s.vaults);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [devices, setDevices] = useState<ServerDevices | null>(null);
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [listVersion, setListVersion] = useState(0);

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
  }, [refresh]);

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await refresh();
      onChange();
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
    // With a vault open behind the picker it catches up at once; without
    // one this returns straight away.
    await syncNow();
  });

  if (!status) return null;
  // The token here can look fine and still have been taken on the server.
  const removed = syncError === 'SYNC_NEEDS_LOGIN';
  const showForm = !status.url || removed || status.needsKey;

  return (
    <>
      <SettingsSection icon={<Cloud size={14} />} title={t('sync.server')} description={t('sync.description')}>
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
            <SettingsDescription>{t('sync.keychainWarning')}</SettingsDescription>
            <Button variant="primary" onClick={submit} disabled={busy || !url.trim() || !key.trim()}>
              {busy ? t('sync.connecting') : removed || status.needsKey ? t('sync.login') : t('sync.connect')}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm text-secondary break-all">{t('sync.connectedTo', { url: status.url })}</div>
            {status.unencrypted && <SettingsStatus tone="muted">{t('sync.unencrypted')}</SettingsStatus>}
            <div>
              <div className="label-xs mb-1">{t('sync.vaultsThere')}</div>
              <SettingsDescription className="mb-2">{t('sync.vaultsThereHint')}</SettingsDescription>
              <RemoteVaultList
                key={listVersion}
                // Only vaults still in the list here: one removed from it keeps
                // its link in `sync.json`, and must still be fetchable.
                exclude={Object.entries(status.links)
                  .filter(([id]) => vaults.some((vault) => vault.id === id))
                  .map(([, link]) => link.remote)}
                onOpen={onOpen}
                onChange={() => { void refresh(); onChange(); }}
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button tone="danger" onClick={() => act(syncUnpair)} disabled={busy}>{t('sync.disconnectServer')}</Button>
            </div>
            <SettingsDescription>{t('sync.disconnectServerHint')}</SettingsDescription>
          </div>
        )}
        {error && <SettingsStatus tone="error" className="mt-3">{error}</SettingsStatus>}
      </SettingsSection>

      {!showForm && devices && (
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
  );
}
