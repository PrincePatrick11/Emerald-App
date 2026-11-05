import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, RefreshCw, RotateCcw } from 'lucide-react';
import Button from '../../ui/Button';
import ProgressBar from '../../ui/ProgressBar';
import BlockCheckbox from '../../blocks/BlockCheckbox';
import { formatBytes } from '../../../lib/helpers';
import {
  asUpdateError, checkForUpdate, installUpdate, onUpdateProgress, setUpdateSettings, updateSettings,
  type UpdateCheck, type UpdateError, type UpdateProgress,
} from '../../../lib/updates';
import { settleBeforeExit } from '../../../lib/openEdits';
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
 * Updates: check, install, and the source in case it ever changes. All of it
 * belongs to the installation (`{appDataDir}/update.json`, `updates.rs`).
 */
export default function StartUpdates() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<UpdateCheck | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [error, setError] = useState<UpdateError | null>(null);
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

  const busy = status === 'checking' || status === 'installing';
  const installable = result?.available === true && result.installable;
  const percent = progress?.total ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100)) : null;

  return (
    <div className="space-y-6">
      <section>
        <dl className="picker-stats mb-3">
          <dt>{t('settings.version')}</dt>
          <dd>{packageJson.version}</dd>
        </dl>
        <Button tone="neutral" onClick={check} disabled={busy}>
          <RefreshCw size={12} className={status === 'checking' ? 'animate-spin' : undefined} />
          {status === 'checking' ? t('settings.updateChecking') : t('settings.updateCheck')}
        </Button>

        {status === 'done' && result && !result.available && (
          <p className="text-xs mt-2 text-muted">{t('settings.updateNone')}</p>
        )}
        {status === 'failed' && error && (
          <p className={`text-xs mt-2 ${CALM_CODES.has(error.code) ? 'text-muted' : 'text-danger'}`}>
            {t(ERROR_KEYS[error.code] ?? 'settings.updateError')}
          </p>
        )}
        {result?.available && (
          <div className="mt-3 space-y-2">
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {t('settings.updateFound', { version: result.version })}
            </p>
            {result.notes && (
              <pre className="start-notes">{result.notes}</pre>
            )}
            {installable ? (
              <>
                <Button tone="jade" onClick={install} disabled={busy}>
                  <Download size={12} />
                  {status === 'installing' ? t('settings.updateInstalling') : t('settings.updateInstall')}
                </Button>
                {status === 'installing' && (
                  <ProgressBar
                    percent={percent}
                    label={percent !== null ? `${percent}%` : progress && formatBytes(progress.downloaded, units)}
                  />
                )}
              </>
            ) : (
              <p className="text-xs text-muted">{t('settings.updateUnsupported')}</p>
            )}
          </div>
        )}
      </section>

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
        <div className="mt-4">
          <BlockCheckbox
            checked={autoCheck}
            onChange={(next) => saveSource(savedEndpoint, next, { keepTyped: true })}
            label={t('settings.updateAutoCheck')}
          />
        </div>
      </section>
    </div>
  );
}
