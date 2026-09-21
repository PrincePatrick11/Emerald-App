import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, CloudOff, Download, Globe, RefreshCw } from 'lucide-react';
import Button from '../../ui/Button';
import BlockCheckbox from '../../blocks/BlockCheckbox';
import SettingsSection, { SettingsDescription } from './SettingsSection';
import { formatBytes } from '../../../lib/helpers';
import {
  asUpdateError, checkForUpdate, installUpdate, onUpdateProgress, setUpdateSettings, updateSettings,
  type UpdateCheck, type UpdateError, type UpdateProgress,
} from '../../../lib/updates';
import packageJson from '../../../../package.json';

type Status = 'idle' | 'checking' | 'done' | 'failed' | 'installing';

/** Die Meldung zu einem Code aus Prüfung oder Installation. Was hier fehlt,
 *  fällt auf `updateError` zurück — ein neuer Code aus Rust bleibt dadurch
 *  lesbar, statt eine leere Zeile zu zeigen. */
const ERROR_KEYS: Record<string, string> = {
  unreachable: 'settings.updateErrorUnreachable',
  'unsupported-target': 'settings.updateErrorTarget',
  'unsupported-install': 'settings.updateUnsupported',
  'nothing-to-install': 'settings.updateErrorStale',
  'install-failed': 'settings.updateErrorInstall',
};

/** Die Codes, die beim Speichern der Quelle fallen können — eine eigene
 *  Zuordnung, weil dieselben Wörter dort etwas anderes heißen. Vorher teilten
 *  sich beide eine Tabelle, und `invalid-url` fehlte darin *absichtlich*,
 *  damit der Rückfall greift: eine Lücke, die man nicht sieht. */
const SOURCE_ERROR_KEYS: Record<string, string> = {
  'invalid-url': 'settings.updateSourceInvalid',
  'write-failed': 'settings.updateErrorWrite',
};

/** Zwei Fälle sind kein Defekt: niemand hat geantwortet, oder es gibt für
 *  diese Plattform nichts. Die tragen kein Warndreieck. */
const CALM_CODES = new Set(['unreachable', 'unsupported-target']);

/** Was unter dem Quellenfeld steht — ein Feld statt zweier Flags, die sich
 *  ohnehin ausschließen. Der Fehler wird als Code gehalten und erst beim
 *  Rendern übersetzt, sonst bliebe die Meldung nach einem Sprachwechsel in
 *  der alten Sprache stehen. */
type SourceFeedback = { kind: 'saved' } | { kind: 'error'; code: string } | null;

/**
 * Updates: suchen, installieren — und die Quelle, falls sie sich einmal ändert.
 *
 * Die einzige Einstellungsseite, die nicht pro Vault gilt: welche Quelle diese
 * Installation fragt, gehört zur Installation, nicht zum Inhalt. Sie landet in
 * `{appDataDir}/update.json` neben `vaults.json`, nicht in der `settings.json`
 * des Vaults — sonst könnte ein importiertes Backup sie mitbringen.
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

  // Der Fortschritt kommt als Ereignis aus Rust. Abonniert wird beim Öffnen der
  // Seite, nicht erst beim Klick: `download_and_install` sendet den ersten
  // Brocken u. U. schneller, als ein danach gesetzter Listener steht.
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
      // Auch den alten Fund verwerfen: sonst stünde die Fehlermeldung neben
      // einem „Version X ist verfügbar" samt Knopf, das die gerade
      // gescheiterte Prüfung nicht mehr bestätigt.
      setResult(null);
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
      // `result` bleibt hier absichtlich stehen — der Fund gilt weiter, nur
      // das Installieren ist gescheitert, und ein zweiter Versuch soll nicht
      // erst neu suchen müssen.
      setError(err);
      setStatus('failed');
      setProgress(null);
    }
  }

  async function saveSource(nextEndpoint: string, nextAutoCheck: boolean) {
    setSourceFeedback(null);
    try {
      const saved = await setUpdateSettings(nextEndpoint, nextAutoCheck);
      setEndpoint(saved.endpoint);
      setSavedEndpoint(saved.endpoint);
      setAutoCheck(saved.auto_check);
      setSourceFeedback({ kind: 'saved' });
      // Eine geänderte Quelle macht das letzte Ergebnis wertlos — es stammt
      // von woanders her.
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
        {/* Wie die Aufraeum-Zeile im Speicher: eine Zeile mit ihrer Aktion,
            was daraus folgt steht darunter. */}
        <div className="space-y-2.5">
          <div className="settings-row">
            <span className="flex items-center gap-2 text-sm text-secondary min-w-0">
              <span className="text-muted">{t('settings.version')}</span>
              <span className="truncate">{packageJson.version}</span>
            </span>
            <Button onClick={check} disabled={busy} variant="secondary" className="shrink-0">
              <RefreshCw size={14} className={status === 'checking' ? 'animate-spin' : undefined} />
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
              CALM_CODES.has(error.code) ? 'text-muted' : 'text-danger'
            }`}>
              {CALM_CODES.has(error.code)
                ? <CloudOff size={12} className="mt-0.5 shrink-0" />
                : <AlertTriangle size={12} className="mt-0.5 shrink-0" />}
              <span>{t(ERROR_KEYS[error.code] ?? 'settings.updateError')}</span>
            </p>
          )}

          {result?.available && (
            <div className="space-y-2">
              <p className="text-sm text-secondary">
                {t('settings.updateFound', { version: result.version })}
              </p>

              {result.notes && (
                <div>
                  <div className="label-xs mb-1">{t('settings.updateNotes')}</div>
                  <pre className="text-xs text-muted whitespace-pre-wrap font-sans max-h-32 overflow-y-auto">
                    {result.notes}
                  </pre>
                </div>
              )}

              {!result.installable ? (
                <p className="text-xs text-muted flex items-start gap-1.5">
                  <CloudOff size={12} className="mt-0.5 shrink-0" />
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
                      <span className="text-xs text-muted">
                        {percent !== null
                          ? `${percent}%`
                          : progress && formatBytes(progress.downloaded, byteUnits)}
                      </span>
                    )}
                  </div>

                  {status === 'installing' && (
                    <div
                      className="h-1 rounded-full overflow-hidden"
                      style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 18%, transparent)' }}
                    >
                      {/* Ohne bekannte Gesamtgröße bleibt der Balken leer statt
                          zu lügen — die Byte-Zahl daneben zeigt, dass es läuft. */}
                      <div
                        className="h-full transition-[width] duration-200"
                        style={{ width: `${percent ?? 0}%`, backgroundColor: 'var(--accent)' }}
                      />
                    </div>
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
        <div className="space-y-2">
          <div className="flex gap-2 items-start">
            <div className="flex-1">
              <input
                type="text"
                value={endpoint}
                onChange={(e) => { setEndpoint(e.target.value); setSourceFeedback(null); }}
                placeholder={t('settings.updateSourcePlaceholder')}
                spellCheck={false}
                title={t('settings.updateSourceDesc')}
                className="input-field settings-field w-full"
              />
              {sourceFeedback?.kind === 'error' && (
                <p className="text-xs text-danger mt-1">
                  {t(SOURCE_ERROR_KEYS[sourceFeedback.code] ?? 'settings.updateSourceInvalid')}
                </p>
              )}
              {sourceFeedback?.kind === 'saved' && (
                <p className="text-xs text-jade-400 mt-1 flex items-center gap-1">
                  <Check size={12} /> {t('settings.updateSourceSaved')}
                </p>
              )}
            </div>
            <Button
              onClick={() => saveSource(endpoint, autoCheck)}
              disabled={endpoint.trim() === savedEndpoint}
              variant="primary"
              className="shrink-0"
            >
              {t('common.save')}
            </Button>
            <Button
              onClick={() => saveSource('', autoCheck)}
              disabled={savedEndpoint === '' && endpoint === ''}
              variant="secondary"
              className="shrink-0"
            >
              {t('settings.updateSourceReset')}
            </Button>
          </div>

          {/* Dasselbe Häkchen wie in der Datensicherung: ein echtes `input`,
              mit Tastatur erreichbar und in beiden Themes im Akzent. */}
          <BlockCheckbox
            checked={autoCheck}
            onChange={(next) => saveSource(savedEndpoint, next)}
            label={t('settings.updateAutoCheck')}
            hint={t('settings.updateAutoCheckDesc')}
          />
        </div>
      </SettingsSection>
    </>
  );
}
