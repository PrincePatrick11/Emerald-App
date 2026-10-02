import type { TFunction } from 'i18next';
import { KEY_ERRORS, MIN_PASSWORD_LENGTH, keyErrorOf } from '../../lib/vaultKeys';

/**
 * Was `VaultKeyDialog` und die Sicherheitsseite der Einstellungen teilen: das
 * beschriftete Feld, das Paar „neues Passwort / wiederholen", dessen Prüfung
 * und die Fehlertexte der Schlüssel-Befehle.
 */

export function KeyField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label-xs block mb-2">{label}</span>
      {children}
    </label>
  );
}

/** Enter schickt ab — außer mitten in einer IME-Eingabe. */
export function onEnter(submit: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit();
  };
}

export function NewPasswordFields({ t, password, repeat, onPassword, onRepeat, disabled, autoFocus, onSubmit }: {
  t: TFunction;
  password: string;
  repeat: string;
  onPassword: (value: string) => void;
  onRepeat: (value: string) => void;
  disabled: boolean;
  autoFocus: boolean;
  onSubmit: () => void;
}) {
  return (
    <>
      <KeyField label={t('vaultKey.newPassword')}>
        <input
          type="password"
          autoFocus={autoFocus}
          autoComplete="new-password"
          className="input-field settings-field"
          value={password}
          disabled={disabled}
          onChange={(e) => onPassword(e.target.value)}
          onKeyDown={onEnter(onSubmit)}
        />
      </KeyField>
      <KeyField label={t('vaultKey.repeatPassword')}>
        <input
          type="password"
          autoComplete="new-password"
          className="input-field settings-field"
          value={repeat}
          disabled={disabled}
          onChange={(e) => onRepeat(e.target.value)}
          onKeyDown={onEnter(onSubmit)}
        />
      </KeyField>
    </>
  );
}

/** Was an einem neuen Passwort nicht stimmt, oder `''`. */
export function newPasswordProblem(t: TFunction, password: string, repeat: string): string {
  if (password.length < MIN_PASSWORD_LENGTH) return t('vaultKey.tooShort', { count: MIN_PASSWORD_LENGTH });
  if (password !== repeat) return t('vaultKey.mismatch');
  return '';
}

/** Der Text zu einem Fehler der Schlüssel-Befehle; `fallbackKey` für alles Unerwartete. */
export function keyErrorText(t: TFunction, err: unknown, fallbackKey: string): string {
  const code = keyErrorOf(err);
  if (code === KEY_ERRORS.wrongPassword) return t('vaultKey.wrongPassword');
  if (code === KEY_ERRORS.wrongRecoveryKey) return t('vaultKey.wrongRecoveryKey');
  if (code === KEY_ERRORS.passwordTooShort) return t('vaultKey.tooShort', { count: MIN_PASSWORD_LENGTH });
  console.error('[vault-key]', err);
  return t(fallbackKey);
}
