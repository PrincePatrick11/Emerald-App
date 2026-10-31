import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Globe, RefreshCw, RotateCcw } from 'lucide-react';
import ProgressBar from '../../ui/ProgressBar';
import Button from '../../ui/Button';
import BlockCheckbox from '../../blocks/BlockCheckbox';
import SettingsSection, { SettingsDescription, SettingsStatus } from './SettingsSection';
import { formatBytes } from '../../../lib/helpers';
import {
  asUpdateError, checkForUpdate, installUpdate, onUpdateProgress, setUpdateSettings, updateSettings,
  type UpdateCheck, type UpdateError, type UpdateProgress,
} from '../../../lib/updates';
import packageJson from '../../../../package.json';
import { settleBeforeExit } from '../../../lib/openEdits';

type Status = 'idle' | 'checking' | 'done' | 'failed' | 'installing';

/** The message for a code from checking or installing. Whatever is missing
 *  here falls back to `updateError` — a new code from Rust thereby stays
 *  readable instead of showing an empty line. */
const ERROR_KEYS: Record<string, string> = {
  unreachable: 'settings.updateErrorUnreachable',
  'unsupported-target': 'settings.updateErrorTarget',
  'unsupported-install': 'settings.updateUnsupported',
  'nothing-to-install': 'settings.updateErrorStale',
  'install-failed': 'settings.updateErrorInstall',
};

/** The codes that can occur when saving the source — a mapping of its own,
 *  because the same words mean something different there. Before, both shared
 *  one table, and `invalid-url` was missing from it *on purpose* so that the
 *  fallback kicks in: a gap you cannot see. */
const SOURCE_ERROR_KEYS: Record<string, string> = {
  'invalid-url': 'settings.updateSourceInvalid',
  'write-failed': 'settings.updateErrorWrite',
};

/** Two cases are not a defect: nobody answered, or there is nothing for
 *  this platform. These carry no warning triangle. */
const CALM_CODES = new Set(['unreachable', 'unsupported-target']);

/** What appears under the source field — one field instead of two flags that
 *  exclude each other anyway. The error is kept as a code and only translated
 *  when rendering, otherwise the message would stay in the old language
 *  after a language change. */
type SourceFeedback = { kind: 'saved' } | { kind: 'error'; code: string } | null;

/**
 * Updates: check, install — and the source, in case it ever changes.
 *
 * The only settings page that does not apply per vault: which source this
 * installation asks belongs to the installation, not to the content. It ends up
 * in `{appDataDir}/update.json` next to `vaults.json`, not in the vault's
 * `settings.json` — otherwise an imported backup could bring it along.
 */
export default function UpdatesPage() {
  const { t } = useTranslation();

  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<UpdateCheck | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [error, setError] = useState<UpdateError | null>(null);

  const [endpoint, setEndpoint] = useState('');
  const [savedEndpoint, setSavedEndpoint] = useState('');
  const [autoCheck, setAutoCheck] = useState(true);
  const [sourceFeedback, setSourceFeedback] = useState<SourceFeedback>(null);

  const byteUnits: [string, string, string] = [
    t('common.bytes'), t('common.kilobytes'), t('common.megabytes'),
  ];

  useEffect(() => {
    updateSettings()
      .then((s) => {
        setEndpoint(s.endpoint);
        setSavedEndpoint(s.endpoint);
        setAutoCheck(s.auto_check);
      })
      .catch((e: unknown) => console.error('[updates] settings failed:', e));
  }, []);

  // Progress arrives as an event from Rust. It is subscribed to when the page
  // opens, not only on click: `download_and_install` may send the first
  // chunk faster than a listener set up afterwards is in place.
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
      // Discard the old finding too: otherwise the error message would sit
      // next to a "Version X is available" with its button, which the check
      // that just failed no longer confirms.
      setResult(null);
      setError(err);
      setStatus('failed');
    }
  }

  async function install() {
    // Installing restarts the app without asking the window — so first
    // settle what happens to edits in progress.
    if (!(await settleBeforeExit())) return;
    setStatus('installing');
    setError(null);
    try {
      await installUpdate();
      // If nothing arrives here anymore, it worked: the app restarts.
    } catch (e: unknown) {
      const err = asUpdateError(e);
      console.error('[updates] install failed:', err.detail);
      // `result` deliberately stays here — the finding still holds, only
      // installing failed, and a second attempt should not have to
      // search again first.
      setError(err);
      setStatus('failed');
      setProgress(null);
    }
  }

  /** `keepTyped`: only the checkbox — a typed, not yet saved address stays in the field. */
  async function saveSource(nextEndpoint: string, nextAutoCheck: boolean, { keepTyped = false } = {}) {
    setSourceFeedback(null);
    try {
      const saved = await setUpdateSettings(nextEndpoint, nextAutoCheck);
      if (!keepTyped) setEndpoint(saved.endpoint);
      setSavedEndpoint(saved.endpoint);
      setAutoCheck(saved.auto_check);
      setSourceFeedback({ kind: 'saved' });
      // A changed source makes the last result worthless — it comes from
      // somewhere else.
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
  // Two places ask for it — the button and the notice that stands in its
  // place; written separately, one of them would eventually differ from the other.
  const installable = result?.available === true && result.installable;
  const percent = progress?.total
    ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
    : null;

  return (
    <>
      <SettingsSection
        icon={<RefreshCw size={14} />}
        title={t('settings.updates')}
        description={t('settings.updatesDesc')}
      >
        {/* Like the cleanup row in Storage: one row with its action,
            what follows from it appears below. */}
        <div className="space-y-2.5">
          <div className="settings-row">
            <span className="flex items-center gap-2 text-sm text-secondary min-w-0">
              <span className="text-muted">{t('settings.version')}</span>
              <span className="truncate">{packageJson.version}</span>
            </span>
            <Button onClick={check} disabled={busy} tone="amber" className="shrink-0">
              <RefreshCw size={14} className={status === 'checking' ? 'animate-spin' : undefined} />
              {status === 'checking' ? t('settings.updateChecking') : t('settings.updateCheck')}
            </Button>
          </div>

          {status === 'done' && result && !result.available && (
            <SettingsStatus tone="success">{t('settings.updateNone')}</SettingsStatus>
          )}

          {status === 'failed' && error && (
            // The plugin's original text is in the console, not here:
            // it is in English and names things that help nobody who
            // only wants to know whether there is a new version.
            <SettingsStatus tone={CALM_CODES.has(error.code) ? 'muted' : 'error'}>
              {t(ERROR_KEYS[error.code] ?? 'settings.updateError')}
            </SettingsStatus>
          )}

          {result?.available && (
            <div className="space-y-2">
              {/* The same layout as the version row above: on the left what is
                  pending, on the right the button for it. */}
              <div className="settings-row">
                <span className="text-sm text-secondary min-w-0 truncate">
                  {t('settings.updateFound', { version: result.version })}
                </span>
                {installable && (
                  // The same button style as "Check for updates" above:
                  // one family within a section, otherwise two forms sit on
                  // top of each other that are meant to have the same weight.
                  <Button onClick={install} disabled={busy} tone="jade" className="shrink-0">
                    <Download size={14} />
                    {status === 'installing' ? t('settings.updateInstalling') : t('settings.updateInstall')}
                  </Button>
                )}
              </div>

              {result.notes && (
                <div>
                  <div className="label-xs mb-1">{t('settings.updateNotes')}</div>
                  {/* Third-party text gets a container, as the emoji list has
                      its own — without a border it ran out into the page. */}
                  <pre className="panel p-2 text-xs text-muted whitespace-pre-wrap font-sans max-h-32 overflow-y-auto">
                    {result.notes}
                  </pre>
                </div>
              )}

              {!installable ? (
                <SettingsStatus tone="muted">{t('settings.updateUnsupported')}</SettingsStatus>
              ) : (
                <>
                  {status === 'installing' && (
                    <ProgressBar
                      percent={percent}
                      label={percent !== null ? `${percent}%` : progress && formatBytes(progress.downloaded, byteUnits)}
                    />
                  )}

                  <SettingsDescription className="mb-0">{t('settings.updateRestartHint')}</SettingsDescription>
                </>
              )}
            </div>
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        icon={<Globe size={14} />}
        title={t('settings.updateSource')}
        description={t('settings.updateSourceDesc')}
      >
        <div className="space-y-3">
          {/* Field across the full width, the actions below it — the same
              layout as in the export, where a button row with its feedback sits
              under the fields. Side by side, only a remainder was left for the
              field, and the message stood under the field instead of by the
              button that triggered it. */}
          <input
            type="text"
            value={endpoint}
            onChange={(e) => { setEndpoint(e.target.value); setSourceFeedback(null); }}
            placeholder={t('settings.updateSourcePlaceholder')}
            spellCheck={false}
            title={t('settings.updateSourceDesc')}
            className="input-field settings-field"
          />

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              onClick={() => saveSource(endpoint, autoCheck)}
              disabled={endpoint.trim() === savedEndpoint}
              variant="primary"
            >
              {t('common.save')}
            </Button>
            <Button
              onClick={() => saveSource('', autoCheck)}
              disabled={savedEndpoint === '' && endpoint === ''}
              variant="secondary"
            >
              <RotateCcw size={14} />
              {t('settings.updateSourceReset')}
            </Button>
            {sourceFeedback?.kind === 'saved' && (
              <SettingsStatus tone="success">{t('settings.updateSourceSaved')}</SettingsStatus>
            )}
            {sourceFeedback?.kind === 'error' && (
              <SettingsStatus tone="error">
                {t(SOURCE_ERROR_KEYS[sourceFeedback.code] ?? 'settings.updateSourceInvalid')}
              </SettingsStatus>
            )}
          </div>

          {/* The same checkbox as in the backup: a real `input`,
              reachable by keyboard and in the accent colour in both themes. */}
          <BlockCheckbox
            checked={autoCheck}
            onChange={(next) => saveSource(savedEndpoint, next, { keepTyped: true })}
            label={t('settings.updateAutoCheck')}
            hint={t('settings.updateAutoCheckDesc')}
          />
        </div>
      </SettingsSection>
    </>
  );
}
