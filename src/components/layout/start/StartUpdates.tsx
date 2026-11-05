import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, RefreshCw, RotateCcw, Server } from 'lucide-react';
import Button from '../../ui/Button';
import Modal from '../../ui/Modal';
import ProgressBar from '../../ui/ProgressBar';
import BlockCheckbox from '../../blocks/BlockCheckbox';
import { formatBytes } from '../../../lib/helpers';
import {
  asUpdateError, checkForUpdate, installUpdate, onUpdateProgress, setUpdateSettings, updateSettings,
  type UpdateCheck, type UpdateError, type UpdateProgress,
} from '../../../lib/updates';
import { settleBeforeExit } from '../../../lib/openEdits';
import { takeStartFocus, useVaultPickerStore } from '../../../store/vaultPickerStore';
import packageJson from '../../../../package.json';

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

/** Saving the source has codes of its own: the same words mean something else there. */
const SOURCE_ERROR_KEYS: Record<string, string> = {
  'invalid-url': 'settings.updateSourceInvalid',
  'write-failed': 'settings.updateErrorWrite',
};

/** Nobody answered, or nothing for this platform: not a defect. */
const CALM_CODES = new Set(['unreachable', 'unsupported-target']);

type SourceFeedback = { kind: 'saved' } | { kind: 'error'; code: string } | null;

/**
 * The right half of the start page's foot: the version, a check, and
 * installing what it found. "Update server" opens a dialog with the source,
 * the check on start and the release notes. All of it belongs to the installation
 * (`{appDataDir}/update.json`, `updates.rs`). "Check for Updates…" and the
 * update dot open the page with a check already running (`focus`).
 */
export default function StartUpdates() {
  const { t } = useTranslation();
  const focus = useVaultPickerStore((s) => s.focus);
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<UpdateCheck | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [error, setError] = useState<UpdateError | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [endpoint, setEndpoint] = useState('');
  const [savedEndpoint, setSavedEndpoint] = useState('');
  const [autoCheck, setAutoCheck] = useState(true);
  const [sourceFeedback, setSourceFeedback] = useState<SourceFeedback>(null);
  const units: [string, string, string] = [t('common.bytes'), t('common.kilobytes'), t('common.megabytes')];

  useEffect(() => {
    updateSettings()
      .then((s) => {
        setEndpoint(s.endpoint);
        setSavedEndpoint(s.endpoint);
        setAutoCheck(s.auto_check);
      })
      .catch((e: unknown) => console.error('[updates] settings failed:', e));
  }, []);

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

  async function saveSource(nextEndpoint: string, nextAutoCheck: boolean, { keepTyped = false } = {}) {
    setSourceFeedback(null);
    try {
      const saved = await setUpdateSettings(nextEndpoint, nextAutoCheck);
      if (!keepTyped) setEndpoint(saved.endpoint);
      setSavedEndpoint(saved.endpoint);
      setAutoCheck(saved.auto_check);
      setSourceFeedback({ kind: 'saved' });
      // A result from another source is worthless now.
      if (saved.endpoint !== savedEndpoint) {
        setResult(null);
        setStatus('idle');
      }
    } catch (e: unknown) {
      const err = asUpdateError(e);
      console.error('[updates] saving the source failed:', err.detail);
      setSourceFeedback({ kind: 'error', code: err.code });
    }
  }

  const closeSettings = () => {
    setSettingsOpen(false);
    setSourceFeedback(null);
    setEndpoint(savedEndpoint);
  };

  const busy = status === 'checking' || status === 'installing';
  const found = result?.available === true;
  const installable = found && result.installable;
  const percent = progress?.total ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100)) : null;

  const message = found
    ? <span className="text-secondary">{t('settings.updateFound', { version: result.version })}</span>
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
      <button type="button" className="start-foot-action" onClick={() => setSettingsOpen(true)}>
        <Server size={12} />
        {t('start.updateSettings')}
      </button>
      <span className="shrink-0 tabular-nums text-muted">{t('start.version', { version: packageJson.version })}</span>

      {settingsOpen && (
        <Modal title={t('start.updateSettings')} onClose={closeSettings} bodyClassName="modal-body">
          <div className="space-y-5">
            {found && result.notes && (
              <section>
                <div className="picker-label">{t('settings.updateFound', { version: result.version })}</div>
                <pre className="start-notes">{result.notes}</pre>
              </section>
            )}
            <section>
              <label className="block">
                <span className="picker-label">{t('settings.updateSource')}</span>
                <input
                  type="text"
                  value={endpoint}
                  onChange={(e) => { setEndpoint(e.target.value); setSourceFeedback(null); }}
                  placeholder={t('settings.updateSourcePlaceholder')}
                  spellCheck={false}
                  className="input-field settings-field"
                />
              </label>
              <div className="flex items-center gap-1.5 mt-2">
                <Button tone="neutral" onClick={() => saveSource(endpoint, autoCheck)} disabled={endpoint.trim() === savedEndpoint}>
                  {t('common.save')}
                </Button>
                <Button
                  tone="neutral"
                  compact
                  title={t('settings.updateSourceReset')}
                  aria-label={t('settings.updateSourceReset')}
                  onClick={() => saveSource('', autoCheck)}
                  disabled={savedEndpoint === '' && endpoint === ''}
                >
                  <RotateCcw size={12} />
                </Button>
                {sourceFeedback?.kind === 'saved' && <span className="text-xs text-muted ml-1">{t('settings.updateSourceSaved')}</span>}
                {sourceFeedback?.kind === 'error' && (
                  <span className="text-xs text-danger ml-1">{t(SOURCE_ERROR_KEYS[sourceFeedback.code] ?? 'settings.updateSourceInvalid')}</span>
                )}
              </div>
            </section>
            <BlockCheckbox
              checked={autoCheck}
              onChange={(next) => saveSource(savedEndpoint, next, { keepTyped: true })}
              label={t('settings.updateAutoCheck')}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
