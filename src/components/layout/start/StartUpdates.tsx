import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, RefreshCw } from 'lucide-react';
import Button from '../../ui/Button';
import ProgressBar from '../../ui/ProgressBar';
import { formatBytes } from '../../../lib/helpers';
import {
  asUpdateError, checkForUpdate, installUpdate, onUpdateProgress,
  type UpdateCheck, type UpdateError, type UpdateProgress,
} from '../../../lib/updates';
import { settleBeforeExit } from '../../../lib/openEdits';
import { takeStartFocus, useVaultPickerStore } from '../../../store/vaultPickerStore';

type Status = 'idle' | 'checking' | 'done' | 'failed' | 'installing';

/** The message for a code from checking or installing; anything new from Rust
 *  falls back to `updateError`, so it stays readable. */
const ERROR_KEYS: Record<string, string> = {
  unreachable: 'settings.updateErrorUnreachable',
  'unsupported-target': 'settings.updateErrorTarget',
  'unsupported-install': 'settings.updateUnsupported',
  'nothing-to-install': 'settings.updateErrorStale',
  'install-failed': 'settings.updateErrorInstall',
};

/** Nobody answered, or nothing for this platform: not a defect. */
const CALM_CODES = new Set(['unreachable', 'unsupported-target']);

/**
 * The right half of the start page's foot: a check, and installing what it
 * found, its release notes on pointing at the find. The version is under the
 * brand, the source in the Updates section (`StartUpdateSource`), which
 * remounts this when the source changes. "Check for Updates…" and the update
 * dot open the page with a check already running (`focus`).
 */
export default function StartUpdates() {
  const { t } = useTranslation();
  const focus = useVaultPickerStore((s) => s.focus);
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<UpdateCheck | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [error, setError] = useState<UpdateError | null>(null);
  const units: [string, string, string] = [t('common.bytes'), t('common.kilobytes'), t('common.megabytes')];

  // Subscribed on mount, not on click: the first chunk may arrive before a
  // listener set up afterwards is in place.
  useEffect(() => {
    let dead = false;
    let unlisten: (() => void) | null = null;
    onUpdateProgress(setProgress)
      .then((un) => { if (dead) un(); else unlisten = un; })
      .catch((e: unknown) => console.error('[updates] listen failed:', e));
    return () => { dead = true; unlisten?.(); };
  }, []);

  async function check() {
    setStatus('checking');
    setError(null);
    try {
      setResult(await checkForUpdate());
      setStatus('done');
    } catch (e: unknown) {
      const err = asUpdateError(e);
      console.error('[updates] check failed:', err.detail);
      setResult(null);
      setError(err);
      setStatus('failed');
    }
  }

  useEffect(() => {
    if (focus !== 'updates') return;
    takeStartFocus();
    if (status !== 'checking' && status !== 'installing') void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `status` is read once, when the focus arrives
  }, [focus]);

  async function install() {
    // Installing restarts the app without asking the window.
    if (!(await settleBeforeExit())) return;
    setStatus('installing');
    setError(null);
    try {
      await installUpdate();
    } catch (e: unknown) {
      const err = asUpdateError(e);
      console.error('[updates] install failed:', err.detail);
      setError(err);
      setStatus('failed');
      setProgress(null);
    }
  }

  const busy = status === 'checking' || status === 'installing';
  const found = result?.available === true;
  const installable = found && result.installable;
  const percent = progress?.total ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100)) : null;

  const message = found
    ? <span className="text-secondary" title={result.notes ?? undefined}>{t('settings.updateFound', { version: result.version })}</span>
    : status === 'done' && result
      ? <span>{t('settings.updateNone')}</span>
      : status === 'failed' && error
        ? <span className={CALM_CODES.has(error.code) ? undefined : 'text-danger'}>{t(ERROR_KEYS[error.code] ?? 'settings.updateError')}</span>
        : null;

  return (
    <div className="start-foot-updates">
      <span className="min-w-0 truncate" role="status">{message}</span>
      {found && !installable && <span className="min-w-0 truncate">{t('settings.updateUnsupported')}</span>}
      {status === 'installing' && (
        <div className="w-40 shrink-0">
          <ProgressBar
            percent={percent}
            label={percent !== null ? `${percent}%` : progress && formatBytes(progress.downloaded, units)}
          />
        </div>
      )}
      {installable ? (
        <Button tone="jade" onClick={install} disabled={busy}>
          <Download size={12} />
          {status === 'installing' ? t('settings.updateInstalling') : t('settings.updateInstall')}
        </Button>
      ) : (
        <button type="button" className="start-foot-action" onClick={check} disabled={busy}>
          <RefreshCw size={12} className={status === 'checking' ? 'animate-spin' : undefined} />
          {status === 'checking' ? t('settings.updateChecking') : t('settings.updateCheck')}
        </button>
      )}
    </div>
  );
}
