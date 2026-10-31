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
 * What `VaultKeyDialog` and the settings' security page share: the
 * labelled field, the "new password / repeat" pair, its validation
 * and the error texts of the key commands.
 */

export function KeyField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label-xs block mb-2">{label}</span>
      {children}
    </label>
  );
}

/** Enter submits — except in the middle of IME input. */
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

/** What is wrong with a new password, or `''`. */
export function newPasswordProblem(t: TFunction, password: string, repeat: string): string {
  if (password.length < MIN_PASSWORD_LENGTH) return t('vaultKey.tooShort', { count: MIN_PASSWORD_LENGTH });
  if (password !== repeat) return t('vaultKey.mismatch');
  return '';
}

/** The text for an error of the key commands; `fallbackKey` for anything unexpected. */
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
 * Disk size in MB or GB, in the notation of the language ("1,5 GB", "1,5 Go").
 * Not `formatBytes`: that stops at MB, and here it is about gigabytes.
 */
function diskSize(bytes: number): string {
  // The way the neighbouring file manager counts: Explorer in 1024s, Finder and
  // GNOME Files in 1000s — otherwise the numbers do not match.
  const base = isWindows ? 1024 : 1000;
  const gb = bytes >= base ** 3;
  return new Intl.NumberFormat(i18n.language, {
    style: 'unit',
    unit: gb ? 'gigabyte' : 'megabyte',
    maximumFractionDigits: gb ? 1 : 0,
  }).format(bytes / (gb ? base ** 3 : base ** 2));
}

/**
 * How far the re-encryption of `vaultId` has got — while `active`. With
 * a large vault it takes minutes; without a display it would look like a
 * hung program.
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
    // On the security page the line sits below the form — bring it into view.
    ref.current?.scrollIntoView({ block: 'nearest' });
    let unlisten: (() => void) | undefined;
    let live = true;
    void onReencryptProgress(vaultId, setProgress).then((off) => {
      if (live) unlisten = off; else off();
    });
    return () => { live = false; unlisten?.(); };
  }, [vaultId, active]);

  if (!active) return null;
  // Present before the first event, so the buttons below do not jump.
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
      {/* Only the change of phase is read aloud, not every single image. */}
      <p className="sr-only" role="status">{t(phase === 'images' ? 'vaultKey.progressImagesPhase' : STATIC_PROGRESS_LABEL[phase])}</p>
      <p className="text-xs text-secondary" aria-hidden="true">{phaseLabel}</p>
      <ProgressBar percent={percent} label={percent !== null ? `${percent}%` : undefined} ariaLabel={phaseLabel} />
    </div>
  );
}
