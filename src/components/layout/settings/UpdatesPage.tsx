import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, CloudOff, Download, Globe, RefreshCw } from 'lucide-react';
import Button from '../../ui/Button';
import SettingsSection from './SettingsSection';
import { formatBytes } from '../../../lib/helpers';
import {
  asUpdateError, checkForUpdate, installUpdate, onUpdateProgress, setUpdateSettings, updateSettings,
  type UpdateCheck, type UpdateError, type UpdateProgress,
} from '../../../lib/updates';
import packageJson from '../../../../package.json';

type Status = 'idle' | 'checking' | 'done' | 'failed' | 'installing';

/** Welcher Satz zu welchem Code gehoert. Was hier fehlt, faellt auf die
 *  allgemeine Meldung zurueck — ein neuer Code aus Rust bleibt dadurch
 *  lesbar, statt eine leere Zeile zu zeigen. */
const ERROR_KEYS: Record<string, string> = {
  unreachable: 'settings.updateErrorUnreachable',
  'unsupported-target': 'settings.updateErrorTarget',
  'unsupported-install': 'settings.updateUnsupported',
  'nothing-to-install': 'settings.updateErrorStale',
  'write-failed': 'settings.updateErrorWrite',
};

/** Zwei dieser Faelle sind kein Defekt: niemand hat geantwortet, oder es gibt
 *  fuer diese Plattform nichts. Die tragen kein Warndreieck. */
const CALM_CODES = new Set(['unreachable', 'unsupported-target']);

/**
 * Updates: suchen, installieren — und die Quelle, falls sie sich einmal ändert.
 *
 * Die Quelle steht hier als Feld, weil sie zur Installation gehört und nicht
 * zum Vault: sie landet in `{appDataDir}/update.json`, nicht in den
 * Vault-Einstellungen. Leer heißt, es gelten die eingebauten Adressen.
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
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourceSaved, setSourceSaved] = useState(false);

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

  // Der Fortschritt kommt als Ereignis aus Rust. Abonniert wird beim Öffnen der
  // Seite, nicht erst beim Klick: `download_and_install` sendet den ersten
  // Brocken u. U. schneller, als ein danach gesetzter Listener steht.
  const unlistenRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    let dead = false;
    onUpdateProgress(setProgress)
      .then((un) => { if (dead) un(); else unlistenRef.current = un; })
      .catch((e: unknown) => console.error('[updates] listen failed:', e));
    return () => {
      dead = true;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
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
      setError(err);
      setStatus('failed');
    }
  }

  async function install() {
    setStatus('installing');
    setError(null);
    try {
      await installUpdate();
      // Kommt hier nichts mehr an, ist es geglückt: die App startet neu.
    } catch (e: unknown) {
      const err = asUpdateError(e);
      console.error('[updates] install failed:', err.detail);
      setError(err);
      setStatus('failed');
      setProgress(null);
    }
  }

  async function saveSource(nextEndpoint: string, nextAutoCheck: boolean) {
    setSourceError(null);
    setSourceSaved(false);
    try {
      const saved = await setUpdateSettings(nextEndpoint, nextAutoCheck);
      setEndpoint(saved.endpoint);
      setSavedEndpoint(saved.endpoint);
      setAutoCheck(saved.auto_check);
      setSourceSaved(true);
      // Eine geänderte Quelle macht das letzte Ergebnis wertlos — es stammt
      // von woanders her.
      if (saved.endpoint !== savedEndpoint) {
        setResult(null);
        setStatus('idle');
      }
    } catch (e: unknown) {
      const err = asUpdateError(e);
      console.error('[updates] saving the source failed:', err.detail);
      setSourceError(t(ERROR_KEYS[err.code] ?? 'settings.updateSourceInvalid'));
    }
  }

  const busy = status === 'checking' || status === 'installing';
  const percent = progress?.total
    ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
    : null;

  return (
    <>
      <SettingsSection icon={<RefreshCw size={14} />} title={t('settings.updates')}>
        <div className="rounded-lg bg-stone-800/60 border border-stone-700/40 px-3 py-2.5 space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm text-stone-300 min-w-0">
              <span className="text-stone-500">{t('settings.version')}</span>
              <span className="truncate">{packageJson.version}</span>
            </span>
            <Button onClick={check} disabled={busy} tone="jade" className="shrink-0">
              <RefreshCw size={12} className={status === 'checking' ? 'animate-spin' : undefined} />
              {status === 'checking' ? t('settings.updateChecking') : t('settings.updateCheck')}
            </Button>
          </div>

          {status === 'done' && result && !result.available && (
            <p className="text-xs text-jade-400 flex items-center gap-1.5">
              <Check size={12} /> {t('settings.updateNone')}
            </p>
          )}

          {status === 'failed' && error && (
            // Der Originaltext des Plugins steht in der Konsole, nicht hier:
            // er ist englisch und nennt Dinge, die niemanden weiterbringen, der
            // nur wissen will, ob es eine neue Version gibt.
            <p className={`text-xs flex items-start gap-1.5 ${
              CALM_CODES.has(error.code) ? 'text-stone-400' : 'text-amber-400'
            }`}>
              {CALM_CODES.has(error.code)
                ? <CloudOff size={12} className="mt-0.5 shrink-0" />
                : <AlertTriangle size={12} className="mt-0.5 shrink-0" />}
              <span>{t(ERROR_KEYS[error.code] ?? 'settings.updateError')}</span>
            </p>
          )}

          {result?.available && (
            <div className="space-y-2 pt-2 border-t border-stone-700/40">
              <p className="text-sm text-stone-300">
                {t('settings.updateFound', { version: result.version })}
              </p>

              {result.notes && (
                <div>
                  <div className="label-xs mb-1">{t('settings.updateNotes')}</div>
                  <pre className="text-xs text-stone-400 whitespace-pre-wrap font-sans max-h-32 overflow-y-auto">
                    {result.notes}
                  </pre>
                </div>
              )}

              {!result.installable ? (
                <p className="text-xs text-amber-400 flex items-start gap-1.5">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  {t('settings.updateUnsupported')}
                </p>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <Button onClick={install} disabled={busy} variant="primary">
                      <Download size={14} />
                      {status === 'installing' ? t('settings.updateInstalling') : t('settings.updateInstall')}
                    </Button>
                    {status === 'installing' && (
                      <span className="text-xs text-stone-500">
                        {percent !== null
                          ? `${percent}%`
                          : progress && formatBytes(progress.downloaded, byteUnits)}
                      </span>
                    )}
                  </div>

                  {status === 'installing' && (
                    <div className="h-1 rounded-full bg-stone-700/60 overflow-hidden">
                      {/* Ohne bekannte Gesamtgröße bleibt der Balken leer statt
                          zu lügen — die Byte-Zahl daneben zeigt, dass es läuft. */}
                      <div
                        className="h-full bg-jade-500/70 transition-[width] duration-200"
                        style={{ width: `${percent ?? 0}%` }}
                      />
                    </div>
                  )}

                  <p className="text-xs text-stone-500">{t('settings.updateRestartHint')}</p>
                </>
              )}
            </div>
          )}
        </div>
      </SettingsSection>

      <SettingsSection icon={<Globe size={14} />} title={t('settings.updateSource')}>
        <div className="space-y-2">
          <p className="text-xs text-stone-500 leading-relaxed">{t('settings.updateSourceDesc')}</p>

          <div className="flex gap-2 items-start">
            <div className="flex-1">
              <input
                type="text"
                value={endpoint}
                onChange={(e) => { setEndpoint(e.target.value); setSourceSaved(false); setSourceError(null); }}
                placeholder={t('settings.updateSourcePlaceholder')}
                spellCheck={false}
                title={t('settings.updateSourceDesc')}
                className="w-full bg-stone-800 border border-stone-700/60 rounded px-2 py-1 text-xs text-stone-300 outline-none focus:border-jade-500/60"
              />
              {sourceError && <p className="text-xs text-amber-400 mt-1">{sourceError}</p>}
              {sourceSaved && !sourceError && (
                <p className="text-xs text-jade-400 mt-1 flex items-center gap-1">
                  <Check size={12} /> {t('settings.updateSourceSaved')}
                </p>
              )}
            </div>
            <Button
              onClick={() => saveSource(endpoint, autoCheck)}
              disabled={endpoint.trim() === savedEndpoint}
              tone="jade"
              className="shrink-0"
            >
              {t('common.save')}
            </Button>
            <Button
              onClick={() => saveSource('', autoCheck)}
              disabled={savedEndpoint === '' && endpoint === ''}
              tone="neutral"
              className="shrink-0"
            >
              {t('settings.updateSourceReset')}
            </Button>
          </div>

          <label className="flex items-center gap-2 cursor-pointer group pt-1">
            <div
              onClick={() => saveSource(savedEndpoint, !autoCheck)}
              className={`w-4 h-4 rounded border flex items-center justify-center transition-colors cursor-pointer ${
                autoCheck ? 'bg-jade-500/30 border-jade-500/60' : 'border-stone-600 hover:border-stone-400'
              }`}
            >
              {autoCheck && <Check size={10} className="text-jade-400" />}
            </div>
            <span className="text-xs text-stone-400 group-hover:text-stone-300 transition-colors">
              {t('settings.updateAutoCheck')}
            </span>
          </label>
          <p className="text-xs text-stone-500 leading-relaxed">{t('settings.updateAutoCheckDesc')}</p>
        </div>
      </SettingsSection>
    </>
  );
}
