import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import i18n from '../../i18n';
import { isWindows } from '../../lib/platform';
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

/**
 * Plattengröße in MB oder GB, in der Schreibweise der Sprache („1,5 GB", „1,5 Go").
 * Nicht `formatBytes`: das hört bei MB auf, und hier geht es um Gigabytes.
 */
function diskSize(bytes: number): string {
  // Wie der Dateimanager daneben rechnet: Explorer in 1024ern, Finder und
  // GNOME Files in 1000ern — sonst stimmen die Zahlen nicht überein.
  const base = isWindows ? 1024 : 1000;
  const gb = bytes >= base ** 3;
  return new Intl.NumberFormat(i18n.language, {
    style: 'unit',
    unit: gb ? 'gigabyte' : 'megabyte',
    maximumFractionDigits: gb ? 1 : 0,
  }).format(bytes / (gb ? base ** 3 : base ** 2));
}

/**
 * Wie weit die Neuverschlüsselung von `vaultId` ist — solange `active`. Bei
 * einem großen Vault dauert sie Minuten; ohne Anzeige sähe das aus wie ein
 * hängendes Programm.
 */
const STATIC_PROGRESS_LABEL = {
  database: 'vaultKey.progressDatabase',
  checking: 'vaultKey.progressChecking',
} as const;

export function ReencryptProgressLine({ vaultId, active }: { vaultId: string; active: boolean }) {
  const { t } = useTranslation();
  const [progress, setProgress] = useState<ReencryptProgress | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) { setProgress(null); return; }
    // Auf der Sicherheitsseite steht die Zeile unter dem Formular — ins Bild damit.
    ref.current?.scrollIntoView({ block: 'nearest' });
    let unlisten: (() => void) | undefined;
    let live = true;
    void onReencryptProgress(vaultId, setProgress).then((off) => {
      if (live) unlisten = off; else off();
    });
    return () => { live = false; unlisten?.(); };
  }, [vaultId, active]);

  if (!active) return null;
  // Vor dem ersten Ereignis schon da, damit die Knöpfe darunter nicht springen.
  const phase = progress?.phase ?? 'database';
  const number = (n: number) => n.toLocaleString(i18n.language);
  const phaseLabel = t(phase === 'images' ? 'vaultKey.progressImages' : STATIC_PROGRESS_LABEL[phase], {
    done: number(progress?.done ?? 0),
    total: number(progress?.total ?? 0),
  });
  const percent = progress?.phase === 'images' && progress.total > 0
    ? Math.round((progress.done / progress.total) * 100)
    : null;
  return (
    <div ref={ref} className="space-y-1.5">
      {/* Vorgelesen wird nur der Wechsel der Phase, nicht jedes einzelne Bild. */}
      <p className="sr-only" role="status">{t(phase === 'images' ? 'vaultKey.progressImagesPhase' : STATIC_PROGRESS_LABEL[phase])}</p>
      <p className="text-xs text-secondary" aria-hidden="true">{phaseLabel}</p>
      <ProgressBar percent={percent} label={percent !== null ? `${percent}%` : undefined} ariaLabel={phaseLabel} />
    </div>
  );
}
