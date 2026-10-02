import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, Loader2, Lock, Smartphone } from 'lucide-react';
import Button from '../../ui/Button';
import { SwitchRow } from '../../ui/Switch';
import RecoveryKeyBox from '../RecoveryKeyBox';
import { KeyField, NewPasswordFields, keyErrorText, newPasswordProblem, onEnter } from '../vaultKeyParts';
import { isVaultRemembered, keychainAvailable, setVaultRemembered } from '../../../lib/vaultKeys';
import { useVaultStore } from '../../../store/vaultStore';
import SettingsSection, { SettingsStatus } from './SettingsSection';

/**
 * Der Schlüssel des offenen Vaults: merken, sperren, Passwort ändern.
 *
 * Das Passwort zu ändern verschlüsselt den Vault unter einem neuen Schlüssel
 * neu und bringt einen neuen Wiederherstellungsschlüssel. Der wird hier
 * gezeigt, bis bestätigt ist, dass er aufbewahrt ist — so lange, und solange
 * die Änderung läuft, hält `onBlockClose` das Einstellungsfenster offen.
 */
export default function SecurityPage({ onClose, onBlockClose }: {
  onClose: () => void;
  onBlockClose: (blocked: boolean) => void;
}) {
  const { t } = useTranslation();
  const vaultId = useVaultStore((s) => s.activeVaultId);
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
  const [stored, setStored] = useState(false);

  useEffect(() => {
    let live = true;
    keychainAvailable().then((available) => { if (live) setKeychain(available); }, () => {});
    isVaultRemembered(vaultId).then((value) => { if (live) setRemembered(value); }, () => {});
    return () => { live = false; };
  }, [vaultId]);

  // Weder während der Neuverschlüsselung noch mit einem ungesicherten
  // Wiederherstellungsschlüssel darf das Fenster zugehen.
  const holding = busy || Boolean(recoveryKey);
  useEffect(() => {
    onBlockClose(holding);
    return () => onBlockClose(false);
  }, [holding, onBlockClose]);

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
    setStored(false);
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
          <div className="space-y-4">
            <SettingsStatus tone="success">{t('security.changed')}</SettingsStatus>
            {reopenFailed && <SettingsStatus tone="error">{t('security.reopenFailed')}</SettingsStatus>}
            <RecoveryKeyBox recoveryKey={recoveryKey} stored={stored} onStoredChange={setStored} />
            <div className="flex justify-end">
              <Button tone="jade" disabled={!stored} onClick={finishRecovery}>{t('vaultKey.done')}</Button>
            </div>
          </div>
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
