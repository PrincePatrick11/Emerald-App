import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '../ui/Button';
import InlineConfirm from '../ui/InlineConfirm';
import { formatBytes } from '../../lib/helpers';
import { adoptRemoteVault, deleteRemoteVault, remoteVaults, syncErrorCode, type RemoteVault } from '../../lib/sync/engine';
import { syncErrorKey } from '../../lib/sync/errors';
import { keyErrorOf } from '../../lib/vaultKeys';
import { newVaultBaseDir, newVaultRecord, newVaultTarget, probeNewVaultTarget } from '../../lib/vaultManager';
import { VAULT_KEY_CANCELLED } from '../../store/vaultKeyStore';
import { useVaultStore } from '../../store/vaultStore';

/** A folder for a vault of this name that is not taken. */
async function freeTarget(name: string): Promise<{ name: string; path: string | undefined }> {
  const base = await newVaultBaseDir().catch(() => null);
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? name : `${name} ${n}`;
    const path = newVaultTarget(base, null, candidate);
    if (!path) return { name: candidate, path: undefined };
    if (!(await probeNewVaultTarget(path))) return { name: candidate, path };
  }
  throw new Error('no free folder');
}

/**
 * The vaults on the server that are not on this device: fetch one, or remove it
 * from the server. A fetched vault is one with a `vault.key` and no database: the
 * usual question for its password opens it, and the first sync fills it.
 *
 * Needs no open vault. `onOpen` is the vault picker's way of opening one.
 */
export default function RemoteVaultList({ exclude = [], onOpen, onChange }: {
  exclude?: readonly string[];
  onOpen: (vaultId: string) => Promise<void>;
  onChange?: () => void;
}) {
  const { t } = useTranslation();
  const addVault = useVaultStore((s) => s.addVault);
  const [remotes, setRemotes] = useState<RemoteVault[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const units: [string, string, string] = [t('common.bytes'), t('common.kilobytes'), t('common.megabytes')];

  const refresh = useCallback(async () => {
    try {
      setRemotes(await remoteVaults());
    } catch (e) {
      setError(t(syncErrorKey(syncErrorCode(e))));
    }
  }, [t]);

  useEffect(() => { void refresh(); }, [refresh]);

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

  const fetchVault = (remote: RemoteVault, label: string) => act(async () => {
    const target = await freeTarget(label);
    const record = await newVaultRecord(target.name, { path: target.path });
    await addVault(record);
    await adoptRemoteVault(record.id, remote.id, target.name);
    onChange?.();
    await onOpen(record.id);
  });

  const remove = (remote: RemoteVault) => act(async () => {
    await deleteRemoteVault(remote.id, null);
    setConfirming(null);
    await refresh();
    onChange?.();
  });

  const shown = remotes?.filter((remote) => !exclude.includes(remote.id)) ?? [];
  return (
    <div className="space-y-2">
      {remotes && shown.length === 0 && <p className="text-xs text-muted">{t('sync.nothingToFetch')}</p>}
      {shown.map((remote, i) => {
        const label = remote.name ?? t('sync.unnamedVault', { number: i + 1 });
        return (
          <div key={remote.id} className="settings-row">
            <span className="text-sm text-secondary min-w-0 truncate">
              {label} · {formatBytes(remote.storedBytes, units)}
            </span>
            <span className="flex items-center gap-2 shrink-0">
              {confirming === remote.id ? (
                <InlineConfirm
                  message={t('sync.deleteFromServerConfirm')}
                  confirmLabel={t('sync.reallyDelete')}
                  onConfirm={() => { if (!busy) void remove(remote); }}
                  onCancel={() => setConfirming(null)}
                />
              ) : (
                <>
                  <Button disabled={busy} onClick={() => fetchVault(remote, label)}>{t('sync.fetch')}</Button>
                  <Button tone="danger" disabled={busy} onClick={() => setConfirming(remote.id)}>{t('sync.deleteFromServer')}</Button>
                </>
              )}
            </span>
          </div>
        );
      })}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
