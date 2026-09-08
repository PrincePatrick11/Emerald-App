import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import EmeraldMark from '../../ui/EmeraldMark';
import { LANGUAGE_OPTIONS } from '../../../i18n';
import packageJson from '../../../../package.json';
import { DiscordMark, GithubMark, PatreonMark } from './BrandIcons';

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

export default function AboutPage() {
  const { t, i18n } = useTranslation();

  const language = LANGUAGE_OPTIONS.some((o) => o.code === i18n.resolvedLanguage)
    ? i18n.resolvedLanguage
    : 'en';

  return (
    <div className="rounded-lg bg-stone-800/60 border border-stone-700/40 px-4 py-3 space-y-1.5">
      {/* Die Marke steht anstelle einer Zeile "App — Emerald App": sie sagt
          dasselbe und ist die einzige stehende Stelle, an der der Stein gross
          genug fuer seinen Schliff ist. */}
      <div className="flex items-center gap-2.5 pb-2.5 mb-1 border-b border-stone-700/40">
        <EmeraldMark size={30} />
        <span className="text-sm text-stone-300">Emerald App</span>
      </div>

      <p className="text-sm text-stone-300">{t('settings.tagline')}</p>
      <p className="text-sm text-stone-400 leading-relaxed pb-2.5 mb-1 border-b border-stone-700/40">
        {t('settings.taglineDetail')}
      </p>

      <div className="flex justify-between text-sm">
        <span className="text-stone-500">{t('settings.version')}</span>
        <span className="text-stone-300">{packageJson.version}</span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-stone-500">{t('settings.author')}</span>
        <span className="text-stone-300">{packageJson.author}</span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-stone-500">{t('settings.license')}</span>
        <span className="text-stone-300">{packageJson.license}</span>
      </div>

      <div className="flex justify-between items-center gap-3 text-sm pt-2.5 mt-1 border-t border-stone-700/40">
        <span className="text-stone-500 shrink-0">{t('settings.links')}</span>
        <span className="flex items-center gap-3">
          <AboutLink icon={<Globe size={16} />} label={t('settings.website')} url={`${WEBSITE_BASE}/${language}/`} />
          <AboutLink icon={<GithubMark size={16} />} label="GitHub" url={packageJson.homepage} />
          <AboutLink icon={<PatreonMark size={16} />} label="Patreon" url={PATREON_URL} />
          <AboutLink icon={<DiscordMark size={16} />} label="Discord" url={DISCORD_URL} />
        </span>
      </div>
    </div>
  );
}
