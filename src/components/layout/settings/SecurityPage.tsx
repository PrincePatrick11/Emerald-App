import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, Loader2, Lock, ShieldCheck, Smartphone } from 'lucide-react';
import Button from '../../ui/Button';
import { SwitchRow } from '../../ui/Switch';
import RecoveryKeyBox from '../RecoveryKeyBox';
import {
  KeyField, NewPasswordFields, ReencryptProgressLine, keyErrorText, newPasswordProblem, onEnter,
} from '../vaultKeyParts';
import { isVaultRemembered, keychainAvailable, setVaultRemembered } from '../../../lib/vaultKeys';
import { useVaultStore } from '../../../store/vaultStore';
import { useVaultKeyStore } from '../../../store/vaultKeyStore';
import SettingsSection, { SettingsStatus } from './SettingsSection';

/**
 * The open vault's key: remember, lock, change password — or, for a plain
 * vault, encrypt it.
 *
 * Changing the password re-encrypts the vault under a new key and brings a
 * new recovery key; so does encrypting. It is shown here until it is
 * confirmed to be stored — for that long, and while the run is going,
 * `onBlockClose` keeps the settings window open.
 */
export default function SecurityPage({ onClose, onBlockClose }: {
  onClose: () => void;
  onBlockClose: (blocked: boolean) => void;
}) {
  const vaultId = useVaultStore((s) => s.activeVaultId);
  // As the gate found it on opening; `undefined` would offer what may not apply.
  const encrypted = useVaultKeyStore((s) => s.encrypted[vaultId]);
  // The encrypt section stays until its recovery key is confirmed, although
  // the reopened vault already counts as encrypted.
  const [encrypting, setEncrypting] = useState(false);

  if (encrypted === undefined) return null;
  return encrypted && !encrypting
    ? <EncryptedVaultSecurity vaultId={vaultId} onClose={onClose} onBlockClose={onBlockClose} />
    : <EncryptSection vaultId={vaultId} onBlockClose={onBlockClose} onStarted={() => setEncrypting(true)} onFinished={() => setEncrypting(false)} />;
}

/** Keeps the settings window open while `holding`. */
function useHoldOpen(holding: boolean, onBlockClose: (blocked: boolean) => void) {
  useEffect(() => {
    onBlockClose(holding);
    return () => onBlockClose(false);
  }, [holding, onBlockClose]);
}

/** A run's new recovery key, shown until the user confirms it is stored. */
function NewRecoveryKey({ recoveryKey, doneText, reopenFailed, onDone }: {
  recoveryKey: string;
  doneText: string;
  reopenFailed: boolean;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [stored, setStored] = useState(false);
  return (
    <div className="space-y-4">
      <SettingsStatus tone="success">{doneText}</SettingsStatus>
      {reopenFailed && <SettingsStatus tone="error">{t('security.reopenFailed')}</SettingsStatus>}
      <RecoveryKeyBox recoveryKey={recoveryKey} stored={stored} onStoredChange={setStored} />
      <div className="flex justify-end">
        <Button tone="jade" disabled={!stored} onClick={onDone}>{t('vaultKey.done')}</Button>
      </div>
    </div>
  );
}

/**
 * A plain vault: encrypt it with a password, for good. Ends on the new
 * recovery key; after "Done" the page shows the encrypted vault's sections.
 */
function EncryptSection({ vaultId, onBlockClose, onStarted, onFinished }: {
  vaultId: string;
  onBlockClose: (blocked: boolean) => void;
  /** Before the run: from here on the page stays on this section. */
  onStarted: () => void;
  /** After "Done", or when the run failed. */
  onFinished: () => void;
}) {
  const { t } = useTranslation();
  const encryptActive = useVaultStore((s) => s.encryptActive);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [reopenFailed, setReopenFailed] = useState(false);
  useHoldOpen(busy || Boolean(recoveryKey), onBlockClose);

  async function submit() {
    if (busy) return;
    const problem = newPasswordProblem(t, password, repeat);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError('');
    onStarted();
    try {
      const result = await encryptActive(password);
      if (!result) { onFinished(); return; }
      setRecoveryKey(result.recoveryKey);
      setReopenFailed(Boolean(result.reopenFailed));
      setPassword('');
      setRepeat('');
    } catch (err) {
      onFinished();
      setError(keyErrorText(t, err, 'security.encryptFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    // Once encrypted, "this vault is not encrypted" would be wrong above the recovery key.
    <SettingsSection icon={<ShieldCheck size={14} />} title={t('security.encryptTitle')} description={recoveryKey ? undefined : t('security.encryptHint')}>
      {recoveryKey ? (
        <NewRecoveryKey recoveryKey={recoveryKey} doneText={t('security.encrypted')} reopenFailed={reopenFailed} onDone={onFinished} />
      ) : (
        <div className="space-y-4">
          <NewPasswordFields
            t={t}
            password={password}
            repeat={repeat}
            onPassword={setPassword}
            onRepeat={setRepeat}
            disabled={busy}
            autoFocus={false}
            onSubmit={submit}
          />
          <p className="text-xs text-secondary">{t('security.encryptOldBackups')}</p>
          {error && <SettingsStatus tone="error">{error}</SettingsStatus>}
          <ReencryptProgressLine vaultId={vaultId} active={busy} />
          <div className="flex justify-end">
            <Button tone="jade" disabled={busy || !password} onClick={submit}>
              {busy && <Loader2 size={14} className="animate-spin" />}
              {t('security.encryptSubmit')}
            </Button>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}

/** An encrypted vault: remember on this device, lock, change password. */
function EncryptedVaultSecurity({ vaultId, onClose, onBlockClose }: {
  vaultId: string;
  onClose: () => void;
  onBlockClose: (blocked: boolean) => void;
}) {
  const { t } = useTranslation();
  const changePassword = useVaultStore((s) => s.changePassword);
  const lockActive = useVaultStore((s) => s.lockActive);

  const [keychain, setKeychain] = useState(true);
  const [remembered, setRemembered] = useState(false);
  const [rememberError, setRememberError] = useState(false);
  const [rememberBusy, setRememberBusy] = useState(false);

  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [reopenFailed, setReopenFailed] = useState(false);

  useEffect(() => {
    let live = true;
    keychainAvailable().then((available) => { if (live) setKeychain(available); }, () => {});
    isVaultRemembered(vaultId).then((value) => { if (live) setRemembered(value); }, () => {});
    return () => { live = false; };
  }, [vaultId]);

  // The window must close neither during re-encryption nor with an unsaved
  // recovery key.
  const holding = busy || Boolean(recoveryKey);
  useHoldOpen(holding, onBlockClose);

  async function toggleRemember(next: boolean) {
    setRememberBusy(true);
    setRememberError(false);
    try {
      const now = await setVaultRemembered(vaultId, next);
      setRemembered(now);
      setRememberError(now !== next);
    } catch (err) {
      console.error('[security] remember', err);
      setRememberError(true);
    } finally {
      setRememberBusy(false);
    }
  }

  async function submitPassword() {
    if (busy || !current) return;
    const problem = newPasswordProblem(t, password, repeat);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError('');
    try {
      const result = await changePassword(current, password);
      if (!result) return;
      setRecoveryKey(result.recoveryKey);
      setRemembered(result.remembered);
      setReopenFailed(Boolean(result.reopenFailed));
      setCurrent('');
      setPassword('');
      setRepeat('');
    } catch (err) {
      setError(keyErrorText(t, err, 'security.changeFailed'));
    } finally {
      setBusy(false);
    }
  }

  function finishRecovery() {
    setRecoveryKey('');
    setReopenFailed(false);
  }

  return (
    <>
      <SettingsSection icon={<Smartphone size={14} />} title={t('vaultKey.remember')} description={t('security.rememberHint')}>
        <SwitchRow
          variant="panel"
          label={t('vaultKey.remember')}
          title={t('security.rememberTooltip')}
          hint={keychain ? undefined : t('vaultKey.rememberUnavailable')}
          checked={keychain && remembered}
          disabled={!keychain || rememberBusy}
          onChange={toggleRemember}
        />
        {rememberError && <SettingsStatus tone="error" className="mt-2">{t('security.rememberError')}</SettingsStatus>}
      </SettingsSection>

      <SettingsSection icon={<Lock size={14} />} title={t('security.lockTitle')} description={t('security.lockHint')}>
        <Button
          tone="neutral"
          title={t('security.lockTooltip')}
          disabled={holding}
          onClick={() => { onClose(); void lockActive(); }}
        >
          <Lock size={14} />
          {t('security.lockNow')}
        </Button>
      </SettingsSection>

      <SettingsSection icon={<KeyRound size={14} />} title={t('security.changeTitle')} description={t('security.changeHint')}>
        {recoveryKey ? (
          <NewRecoveryKey recoveryKey={recoveryKey} doneText={t('security.changed')} reopenFailed={reopenFailed} onDone={finishRecovery} />
        ) : (
          <div className="space-y-4">
            <KeyField label={t('security.currentPassword')}>
              <input
                type="password"
                autoComplete="current-password"
                title={t('security.currentPasswordTooltip')}
                className="input-field settings-field"
                value={current}
                disabled={busy}
                onChange={(e) => setCurrent(e.target.value)}
                onKeyDown={onEnter(submitPassword)}
              />
            </KeyField>
            <NewPasswordFields
              t={t}
              password={password}
              repeat={repeat}
              onPassword={setPassword}
              onRepeat={setRepeat}
              disabled={busy}
              autoFocus={false}
              onSubmit={submitPassword}
            />
            {error && <SettingsStatus tone="error">{error}</SettingsStatus>}
            <ReencryptProgressLine vaultId={vaultId} active={busy} />
            <div className="flex justify-end">
              <Button
                tone="jade"
                title={t('security.changeTooltip')}
                disabled={busy || !current || !password}
                onClick={submitPassword}
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                {t('security.changeSubmit')}
              </Button>
            </div>
          </div>
        )}
      </SettingsSection>
    </>
  );
}
