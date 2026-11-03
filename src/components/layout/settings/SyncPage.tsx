import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cloud, Vault } from 'lucide-react';
import Button from '../../ui/Button';
import InlineConfirm from '../../ui/InlineConfirm';
import { KeyField } from '../vaultKeyParts';
import {
  deleteRemoteVault, pauseVault, resumeVault, serverStatus, syncErrorCode, syncNow, uploadOpenVault,
  type ServerStatus,
} from '../../../lib/sync/engine';
import { syncErrorKey } from '../../../lib/sync/errors';
import { formatTimeDistance } from '../../../lib/formatDate';
import { useSyncStore } from '../../../store/syncStore';
import { VAULT_KEY_CANCELLED } from '../../../store/vaultKeyStore';
import { activeVault, useVaultStore } from '../../../store/vaultStore';
import { openVaultPicker } from '../../../store/vaultPickerStore';
import SettingsSection, { SettingsStatus } from './SettingsSection';

/**
 * The open vault and the server: whether it is there, how it stands, syncing
 * now. Everything about the server itself — connecting, the vaults on it,
 * devices — lives in the vault picker, which needs no open vault.
 */
export default function SyncPage() {
  const { t } = useTranslation();
  const vault = useVaultStore(activeVault);
  const running = useSyncStore((s) => s.running);
  const syncError = useSyncStore((s) => s.error);
  const lastSync = useSyncStore((s) => s.lastSync);
  const conflicts = useSyncStore((s) => s.conflicts);
  const adoptServerPassword = useVaultStore((s) => s.adoptServerPassword);

  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  const refresh = useCallback(async () => {
    setStatus(await serverStatus());
  }, []);

  useEffect(() => {
    refresh().catch((e) => console.error('[sync] status', e));
  }, [refresh, vault?.id]);

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await refresh();
    } catch (e) {
      if (e === VAULT_KEY_CANCELLED) return;
      console.warn('[sync]', e);
      setError(t(syncErrorKey(syncErrorCode(e))));
    } finally {
      setBusy(false);
    }
  }

  if (!status || !vault) return null;
  // The token here can look fine and still have been taken on the server.
  const loggedOut = syncError === 'SYNC_NEEDS_LOGIN' || status.needsKey;
  const connected = status.url !== null && !loggedOut;
  const link = status.links[vault.id];
  const syncMessage = syncError && syncError !== 'SYNC_NEEDS_LOGIN' ? t(syncErrorKey(syncError)) : '';

  const pointer = (
    <div>
      <Button onClick={() => { void openVaultPicker(); }}>
        <Vault size={14} />
        {t('sync.openPicker')}
      </Button>
    </div>
  );

  return (
    <>
      <SettingsSection icon={<Cloud size={14} />} title={t('sync.title')}>
        {!connected ? (
          <div className="space-y-3">
            <SettingsStatus tone="muted">{loggedOut ? t('sync.needsLogin') : t('sync.noServer')}</SettingsStatus>
            {pointer}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="settings-row">
              <span className="text-sm text-secondary min-w-0 truncate">
                {vault.name} · {!link ? t('sync.stateLocal') : link.paused ? t('sync.statePaused') : t('sync.stateSynced')}
              </span>
              <span className="flex items-center gap-2 shrink-0">
                {confirming && link ? (
                  <InlineConfirm
                    message={t('sync.deleteFromServerConfirm')}
                    confirmLabel={t('sync.reallyDelete')}
                    onConfirm={() => {
                      if (busy) return;
                      void act(async () => { await deleteRemoteVault(link.remote, vault.id); setConfirming(false); });
                    }}
                    onCancel={() => setConfirming(false)}
                  />
                ) : !link ? (
                  <Button variant="primary" disabled={busy} onClick={() => act(() => uploadOpenVault(vault.id, vault.name))}>{t('sync.upload')}</Button>
                ) : (
                  <>
                    {link.paused
                      ? <Button disabled={busy} onClick={() => act(() => resumeVault(vault.id))}>{t('sync.resume')}</Button>
                      : <Button disabled={busy} onClick={() => act(() => pauseVault(vault.id))}>{t('sync.pause')}</Button>}
                    <Button tone="danger" disabled={busy} onClick={() => setConfirming(true)}>{t('sync.deleteFromServer')}</Button>
                  </>
                )}
              </span>
            </div>
            {syncMessage && <SettingsStatus tone="error">{syncMessage}</SettingsStatus>}
            {link && (
              <>
                <div className="text-xs text-muted">
                  {running ? t('sync.running') : lastSync ? t('sync.last', { time: formatTimeDistance(new Date(lastSync)) }) : t('sync.notYet')}
                </div>
                {conflicts > 0 && <SettingsStatus tone="muted">{t('sync.conflicts', { count: conflicts })}</SettingsStatus>}
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
                {!link.paused && (
                  <div>
                    <Button onClick={() => act(syncNow)} disabled={busy || running}>{t('sync.now')}</Button>
                  </div>
                )}
              </>
            )}
            {pointer}
          </div>
        )}
        {error && <SettingsStatus tone="error" className="mt-3">{error}</SettingsStatus>}
      </SettingsSection>
    </>
  );
}
