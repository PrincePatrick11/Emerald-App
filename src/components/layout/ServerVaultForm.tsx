import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '../ui/Button';
import RemoteVaultList from './RemoteVaultList';
import { KeyField, onEnter } from './vaultKeyParts';
import { serverStatus, syncErrorCode, syncPair } from '../../lib/sync/engine';
import { syncErrorKey } from '../../lib/sync/errors';

/** Fetching a vault from the vault window: connect the server if need be, then pick one. */
export default function ServerVaultForm({ onCancel, onDone }: {
  onCancel: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [linked, setLinked] = useState<string[]>([]);
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    serverStatus().then((status) => {
      setConnected(status.url !== null && !status.needsKey);
      setLinked(Object.values(status.links).map((link) => link.remote));
      if (status.url) setUrl(status.url);
    }, () => setConnected(false));
  }, []);

  async function pair() {
    if (!url.trim() || !key.trim()) return;
    setBusy(true);
    setError('');
    try {
      await syncPair(url, key);
      const status = await serverStatus();
      setLinked(Object.values(status.links).map((link) => link.remote));
      setConnected(true);
    } catch (e) {
      console.warn('[sync]', e);
      setError(t(syncErrorKey(syncErrorCode(e))));
    } finally {
      setBusy(false);
    }
  }

  if (connected === null) return null;
  return (
    <div className="space-y-3">
      {connected ? (
        <RemoteVaultList exclude={linked} onFetched={onDone} />
      ) : (
        <>
          <KeyField label={t('sync.url')}>
            <input type="url" autoFocus spellCheck={false} className="input-field settings-field" placeholder="https://sync.example.com" value={url} disabled={busy} onChange={(e) => setUrl(e.target.value)} />
          </KeyField>
          <KeyField label={t('sync.key')}>
            <input type="password" spellCheck={false} autoComplete="off" className="input-field settings-field" value={key} disabled={busy} onChange={(e) => setKey(e.target.value)} onKeyDown={onEnter(pair)} />
          </KeyField>
          <p className="text-xs text-muted">{t('sync.keychainWarning')}</p>
        </>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        {!connected && (
          <Button variant="primary" className="flex-1 justify-center" disabled={busy || !url.trim() || !key.trim()} onClick={pair}>
            {busy ? t('sync.connecting') : t('sync.connect')}
          </Button>
        )}
        <Button variant="secondary" className="flex-1 justify-center" disabled={busy} onClick={onCancel}>{t('common.cancel')}</Button>
      </div>
    </div>
  );
}
