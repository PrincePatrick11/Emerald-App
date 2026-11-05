import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, RotateCcw } from 'lucide-react';
import Button from '../../ui/Button';
import BlockCheckbox from '../../blocks/BlockCheckbox';
import StartSection from './StartSection';
import { asUpdateError, setUpdateSettings, updateSettings } from '../../../lib/updates';

/** Saving the source has codes of its own: the same words mean something else there. */
const SOURCE_ERROR_KEYS: Record<string, string> = {
  'invalid-url': 'settings.updateSourceInvalid',
  'write-failed': 'settings.updateErrorWrite',
};

type Feedback = { kind: 'saved' } | { kind: 'error'; code: string } | null;

/**
 * The start page's Updates section, beside the server's: where updates come
 * from and whether the app looks on start. Empty is the built-in source. It
 * belongs to the installation (`{appDataDir}/update.json`, `updates.rs`).
 * `onSourceChanged` lets the foot drop a result from the old source.
 */
export default function StartUpdateSource({ onSourceChanged }: { onSourceChanged: () => void }) {
  const { t } = useTranslation();
  const [endpoint, setEndpoint] = useState('');
  const [savedEndpoint, setSavedEndpoint] = useState('');
  const [autoCheck, setAutoCheck] = useState(true);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    updateSettings()
      .then((s) => {
        setEndpoint(s.endpoint);
        setSavedEndpoint(s.endpoint);
        setAutoCheck(s.auto_check);
      })
      .catch((e: unknown) => console.error('[updates] settings failed:', e));
  }, []);

  async function save(nextEndpoint: string, nextAutoCheck: boolean, { keepTyped = false } = {}) {
    setFeedback(null);
    try {
      const saved = await setUpdateSettings(nextEndpoint, nextAutoCheck);
      if (!keepTyped) setEndpoint(saved.endpoint);
      setSavedEndpoint(saved.endpoint);
      setAutoCheck(saved.auto_check);
      setFeedback({ kind: 'saved' });
      if (saved.endpoint !== savedEndpoint) onSourceChanged();
    } catch (e: unknown) {
      const err = asUpdateError(e);
      console.error('[updates] saving the source failed:', err.detail);
      setFeedback({ kind: 'error', code: err.code });
    }
  }

  return (
    <StartSection id="start-updates-heading" icon={<RefreshCw size={12} />} label={t('start.updates')}>
      <div className="start-panel space-y-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={endpoint}
            onChange={(e) => { setEndpoint(e.target.value); setFeedback(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && endpoint.trim() !== savedEndpoint) void save(endpoint, autoCheck); }}
            placeholder={t('settings.updateSourcePlaceholder')}
            aria-label={t('settings.updateSource')}
            spellCheck={false}
            className="input-field settings-field flex-1 min-w-0"
          />
          <Button
            tone="neutral"
            compact
            title={t('settings.updateSourceReset')}
            aria-label={t('settings.updateSourceReset')}
            onClick={() => save('', autoCheck)}
            disabled={savedEndpoint === '' && endpoint === ''}
          >
            <RotateCcw size={12} />
          </Button>
          <Button tone="jade" className="shrink-0" onClick={() => save(endpoint, autoCheck)} disabled={endpoint.trim() === savedEndpoint}>
            {t('common.save')}
          </Button>
        </div>
        <BlockCheckbox
          checked={autoCheck}
          onChange={(next) => save(savedEndpoint, next, { keepTyped: true })}
          label={t('settings.updateAutoCheck')}
        />
      </div>
      {feedback?.kind === 'saved' && <p className="text-xs mt-2 px-0.5 text-subtle">{t('settings.updateSourceSaved')}</p>}
      {feedback?.kind === 'error' && (
        <p className="text-xs mt-2 px-0.5 text-danger">{t(SOURCE_ERROR_KEYS[feedback.code] ?? 'settings.updateSourceInvalid')}</p>
      )}
    </StartSection>
  );
}
