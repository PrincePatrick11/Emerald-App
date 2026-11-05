import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import Button from '../ui/Button';
import InlineConfirm from '../ui/InlineConfirm';
import { onEnter } from './vaultKeyParts';
import {
  remoteVaults, removeDevice, serverDevices, serverStatus, syncErrorCode, syncNow, syncPair, syncUnpair,
  type RemoteVault, type ServerDevices, type ServerStatus,
} from '../../lib/sync/engine';
import { syncErrorKey } from '../../lib/sync/errors';
import { formatBytes } from '../../lib/helpers';
import { formatTimeAgo } from '../../lib/formatDate';
import { useSyncStore } from '../../store/syncStore';

/**
 * The server as the vault picker sees it: whether one is set and answers, the
 * vaults on it, the devices. Nothing here needs an open vault — the picker may
 * have none. Every call goes to `sync.rs` commands that read only `sync.json`
 * and the keychain.
 */
export interface ServerState {
  status: ServerStatus | null;
  remotes: RemoteVault[];
  devices: ServerDevices | null;
  /** `null` while unknown or without a server. */
  reachable: boolean | null;
  /** Set, but what opens it is gone, or the server took the token. */
  loggedOut: boolean;
  refresh: () => Promise<void>;
}

export function useServerState(): ServerState {
  const syncError = useSyncStore((s) => s.error);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [remotes, setRemotes] = useState<RemoteVault[]>([]);
  const [devices, setDevices] = useState<ServerDevices | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [refused, setRefused] = useState(false);

  const refresh = useCallback(async () => {
    const next = await serverStatus().catch(() => null);
    setStatus(next);
    if (!next?.url || next.needsKey) {
      setRemotes([]);
      setDevices(null);
      setReachable(null);
      return;
    }
    const [vaults, devs] = await Promise.allSettled([remoteVaults(), serverDevices()]);
    const failure = [vaults, devs].find((r): r is PromiseRejectedResult => r.status === 'rejected');
    const code = failure ? syncErrorCode(failure.reason) : null;
    setRefused(code === 'SYNC_NEEDS_LOGIN');
    setReachable(code === null ? true : code === 'SYNC_NEEDS_LOGIN' ? null : false);
    setRemotes(vaults.status === 'fulfilled' ? vaults.value : []);
    setDevices(devs.status === 'fulfilled' ? devs.value : null);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const loggedOut = !!status?.url && (status.needsKey || refused || syncError === 'SYNC_NEEDS_LOGIN');
  return { status, remotes, devices, reachable, loggedOut, refresh };
}

/** The start page's server section: connect, or how the server stands. */
export default function PickerServerPanel({ server }: { server: ServerState }) {
  const { t } = useTranslation();
  const lastSync = useSyncStore((s) => s.lastSync);
  const { status, remotes, devices, reachable, loggedOut, refresh } = server;
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<'disconnect' | string | null>(null);
  const units: [string, string, string] = [t('common.bytes'), t('common.kilobytes'), t('common.megabytes')];

  useEffect(() => {
    if (status?.url) setUrl((current) => current || status.url!);
  }, [status?.url]);

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
      setConfirming(null);
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
  const connected = !!status.url && !loggedOut;
  const tone = !connected ? 'off' : reachable === false ? 'down' : reachable ? 'up' : 'off';
  const stateLabel = !status.url
    ? t('sync.notConnected')
    : loggedOut
      ? t('sync.loggedOut')
      : reachable === null
        ? ''
        : reachable
          ? t('sync.reachable')
          : t('sync.unreachable');
  const used = remotes.reduce((sum, remote) => sum + remote.storedBytes, 0);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-1.5 text-xs mb-4 text-muted">
        <span className={`picker-dot picker-dot-${tone}`} aria-hidden />
        {stateLabel}
      </div>

      {!connected ? (
        <div className="space-y-3">
          <label className="block">
            <span className="picker-label">{t('sync.url')}</span>
            <input
              type="url"
              className="input-field settings-field"
              placeholder="https://sync.example.com"
              spellCheck={false}
              value={url}
              disabled={busy}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="picker-label">{t('sync.key')}</span>
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
          </label>
          <p className="text-xs leading-relaxed text-subtle">{t('sync.keychainWarning')}</p>
          <Button variant="primary" className="w-full justify-center" onClick={submit} disabled={busy || !url.trim() || !key.trim()}>
            {busy ? t('sync.connecting') : loggedOut ? t('sync.login') : t('sync.connect')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="text-sm break-all mb-4 text-secondary">{status.url}</div>
          <dl className="picker-stats">
            <dt>{t('sync.statLastSync')}</dt>
            <dd>{lastSync ? formatTimeAgo(new Date(lastSync)) : '–'}</dd>
            <dt>{t('sync.statDevices')}</dt>
            <dd>{devices ? devices.devices.length : '–'}</dd>
            <dt>{t('sync.statSpace')}</dt>
            <dd>{reachable ? formatBytes(used, units) : '–'}</dd>
          </dl>
          {status.unencrypted && <p className="text-xs mt-3 text-warning">{t('sync.unencryptedShort')}</p>}

          {devices && devices.devices.length > 0 && (
            <div className="mt-5 -mx-2 min-h-0 overflow-y-auto overflow-x-hidden">
              <div className="picker-label px-2">{t('sync.devices')}</div>
              <ul className="space-y-0.5">
                {devices.devices.map((device) => {
                  const me = device.id === devices.me;
                  return (
                    <li key={device.id} className="picker-device group">
                      <span className="min-w-0 truncate text-secondary">{device.name || t('sync.unnamedDevice')}</span>
                      {confirming === device.id ? (
                        <InlineConfirm
                          small
                          message={t('sync.removeDeviceConfirm')}
                          confirmLabel={t('sync.removeDevice')}
                          onConfirm={() => act(() => removeDevice(device.id))}
                          onCancel={() => setConfirming(null)}
                        />
                      ) : (
                        <span className="flex items-center gap-1 shrink-0">
                          <span className="text-xs text-subtle">
                            {me ? t('sync.thisDevice') : formatTimeAgo(new Date(device.last_seen * 1000))}
                          </span>
                          {!me && (
                            <button
                              type="button"
                              className="picker-device-remove"
                              title={t('sync.removeDevice')}
                              aria-label={t('sync.removeDevice')}
                              disabled={busy}
                              onClick={() => setConfirming(device.id)}
                            >
                              <X size={12} />
                            </button>
                          )}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="mt-auto pt-5">
            {confirming === 'disconnect' ? (
              <InlineConfirm
                message={t('sync.disconnectServerConfirm')}
                confirmLabel={t('sync.disconnectServer')}
                onConfirm={() => act(syncUnpair)}
                onCancel={() => setConfirming(null)}
              />
            ) : (
              <Button tone="neutral" disabled={busy} onClick={() => setConfirming('disconnect')}>{t('sync.disconnectServer')}</Button>
            )}
          </div>
        </div>
      )}
      {error && <p className="text-xs mt-3 text-danger">{error}</p>}
    </div>
  );
}
