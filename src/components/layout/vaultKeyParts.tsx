import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import i18n from '../../i18n';
import ProgressBar from '../ui/ProgressBar';
import {
  KEY_ERRORS, MIN_PASSWORD_LENGTH, keyErrorOf, onReencryptProgress, spaceShortfall, type ReencryptProgress,
} from '../../lib/vaultKeys';

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
  const space = spaceShortfall(err);
  if (space) return t('vaultKey.notEnoughSpace', { needed: diskSize(space.needed), free: diskSize(space.free) });
  console.error('[vault-key]', err);
  return t(fallbackKey);
}

/** Plattengröße in MB oder GB, in der Schreibweise der Sprache („1,5 GB", „1,5 Go"). */
function diskSize(bytes: number): string {
  const gb = bytes >= 1024 ** 3;
  return new Intl.NumberFormat(i18n.language, {
    style: 'unit',
    unit: gb ? 'gigabyte' : 'megabyte',
    maximumFractionDigits: gb ? 1 : 0,
  }).format(bytes / (gb ? 1024 ** 3 : 1024 ** 2));
}

/**
 * Wie weit die Neuverschlüsselung von `vaultId` ist — solange `active`. Bei
 * einem großen Vault dauert sie Minuten; ohne Anzeige sähe das aus wie ein
 * hängendes Programm.
 */
export function ReencryptProgressLine({ vaultId, active }: { vaultId: string; active: boolean }) {
  const { t } = useTranslation();
  const [progress, setProgress] = useState<ReencryptProgress | null>(null);

  useEffect(() => {
    if (!active) { setProgress(null); return; }
    let unlisten: (() => void) | undefined;
    let live = true;
    void onReencryptProgress(vaultId, setProgress).then((off) => {
      if (live) unlisten = off; else off();
    });
    return () => { live = false; unlisten?.(); };
  }, [vaultId, active]);

  if (!active || !progress) return null;
  const number = (n: number) => n.toLocaleString(i18n.language);
  const label = progress.phase === 'images'
    ? t('vaultKey.progressImages', { done: number(progress.done), total: number(progress.total) })
    : t(progress.phase === 'database' ? 'vaultKey.progressDatabase' : 'vaultKey.progressChecking');
  const percent = progress.phase === 'images' && progress.total > 0
    ? Math.round((progress.done / progress.total) * 100)
    : null;
  return (
    <div className="space-y-1.5" role="status">
      <p className="text-xs text-secondary">{label}</p>
      <ProgressBar percent={percent} label={percent !== null ? `${percent}%` : undefined} />
    </div>
  );
}
