import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Info } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import EmeraldMark from '../../ui/EmeraldMark';
import { LANGUAGE_OPTIONS } from '../../../i18n';
import packageJson from '../../../../package.json';
import { DiscordMark, GithubMark, PatreonMark } from './BrandIcons';
import SettingsSection from './SettingsSection';

/** Die Website fuehrt dieselben vier Sprachen wie die App, unter denselben
 *  Kuerzeln. Eine fuenfte Sprache in LANGUAGE_OPTIONS braucht deshalb auch dort
 *  eine Seite — sonst laeuft der Link ins Leere und faellt hier auf Englisch
 *  zurueck. */
const WEBSITE_BASE = 'https://the-emerald-app.de';
const PATREON_URL = 'https://www.patreon.com/cw/PrincePatrick';
const DISCORD_URL = 'https://discord.gg/3TpYUn2AkM';

/** Ein Link, der die App verlaesst: `openUrl` statt <a href>, damit die WebView
 *  nicht selbst dorthin navigiert. Gleicher Weg wie bei den Links im Editor.
 *
 *  Nur das Symbol, in der Akzentfarbe — der Name steht im Tooltip und, fuer
 *  Screenreader, im aria-label. */
function AboutLink({ icon, label, url }: { icon: ReactNode; label: string; url: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => { openUrl(url).catch((err: unknown) => console.error('[about] open failed:', err)); }}
      className="settings-about-link flex items-center transition-colors"
    >
      {icon}
    </button>
  );
}

/** Eine Zeile der Faktenliste: Beschriftung links, Wert rechts. */
function AboutFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ color: 'var(--text-secondary)' }}>{value}</span>
    </div>
  );
}

export default function AboutPage() {
  const { t, i18n } = useTranslation();

  const language = LANGUAGE_OPTIONS.some((o) => o.code === i18n.resolvedLanguage)
    ? i18n.resolvedLanguage
    : 'en';

  return (
    // Mit Abschnitts-Ueberschrift wie jede andere Seite des Fensters; die
    // Karte darin haelt die Faktenliste zusammen.
    <SettingsSection icon={<Info size={14} />} title={t('settings.about')}>
      <div className="panel px-4 py-3 space-y-1.5">
      {/* Die Marke steht anstelle einer Zeile "App — Emerald App": sie sagt
          dasselbe und ist die einzige stehende Stelle, an der der Stein gross
          genug fuer seinen Schliff ist. */}
        <div className="settings-divider-bottom flex items-center gap-2.5 pb-2.5 mb-1">
          <EmeraldMark size={30} />
          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Emerald App</span>
        </div>

        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('settings.tagline')}</p>
        <p className="settings-divider-bottom text-sm leading-relaxed pb-2.5 mb-1" style={{ color: 'var(--text-muted)' }}>
          {t('settings.taglineDetail')}
        </p>

        <AboutFact label={t('settings.version')} value={packageJson.version} />
        <AboutFact label={t('settings.author')} value={packageJson.author} />
        <AboutFact label={t('settings.license')} value={packageJson.license} />

        <div className="settings-divider-top flex justify-between items-center gap-3 text-sm pt-2.5 mt-1">
          <span className="shrink-0" style={{ color: 'var(--text-muted)' }}>{t('settings.links')}</span>
          <span className="flex items-center gap-3">
            <AboutLink icon={<Globe size={16} />} label={t('settings.website')} url={`${WEBSITE_BASE}/${language}/`} />
            <AboutLink icon={<GithubMark size={16} />} label="GitHub" url={packageJson.homepage} />
            <AboutLink icon={<PatreonMark size={16} />} label="Patreon" url={PATREON_URL} />
            <AboutLink icon={<DiscordMark size={16} />} label="Discord" url={DISCORD_URL} />
          </span>
        </div>
      </div>
    </SettingsSection>
  );
}
