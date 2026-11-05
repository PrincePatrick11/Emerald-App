import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import EmeraldMark from '../../ui/EmeraldMark';
import { LANGUAGE_OPTIONS } from '../../../i18n';
import packageJson from '../../../../package.json';
import { DiscordMark, GithubMark, PatreonMark } from '../settings/BrandIcons';
import StartLanguage from './StartLanguage';

/** The website offers the same four languages as the app, under the same
 *  codes. A fifth language in LANGUAGE_OPTIONS needs a page there too —
 *  otherwise the link leads nowhere and falls back to English here. */
const WEBSITE_BASE = 'https://the-emerald-app.de';
const PATREON_URL = 'https://www.patreon.com/cw/PrincePatrick';
const DISCORD_URL = 'https://discord.gg/3TpYUn2AkM';

/** A link that leaves the app: `openUrl` instead of <a href>, so the WebView
 *  does not navigate there itself. */
function BrandLink({ icon, label, url }: { icon: ReactNode; label: string; url: string }) {
  return (
    <button
      type="button"
      onClick={() => { openUrl(url).catch((err: unknown) => console.error('[about] open failed:', err)); }}
      className="start-brand-link"
    >
      {icon}
      {label}
    </button>
  );
}

/** The start page's left column, on the frame: the mark, the name, the
 *  tagline, the links, and at the foot the language, author and licence. */
export default function StartBrand() {
  const { t, i18n } = useTranslation();
  const language = LANGUAGE_OPTIONS.some((o) => o.code === i18n.resolvedLanguage) ? i18n.resolvedLanguage : 'en';

  return (
    <aside className="start-brand">
      <div className="flex flex-col gap-7">
        <EmeraldMark size={112} />
        <div className="space-y-3">
          <h1 className="start-brand-title">Emerald App</h1>
          <p className="start-brand-tagline">{t('settings.tagline')}</p>
        </div>
        <nav className="flex flex-wrap gap-1 -ml-2.5" aria-label={t('start.links')}>
          <BrandLink icon={<Globe size={14} />} label={t('settings.website')} url={`${WEBSITE_BASE}/${language}/`} />
          <BrandLink icon={<GithubMark size={14} />} label="GitHub" url={packageJson.homepage} />
          <BrandLink icon={<PatreonMark size={14} />} label="Patreon" url={PATREON_URL} />
          <BrandLink icon={<DiscordMark size={14} />} label="Discord" url={DISCORD_URL} />
        </nav>
      </div>
      <div className="mt-auto pt-8 space-y-3">
        <StartLanguage />
        <p className="text-xs text-subtle">{packageJson.author} · {packageJson.license}</p>
      </div>
    </aside>
  );
}
