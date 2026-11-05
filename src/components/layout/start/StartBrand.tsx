import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import EmeraldMark from '../../ui/EmeraldMark';
import { LANGUAGE_OPTIONS } from '../../../i18n';
import packageJson from '../../../../package.json';
import { DiscordMark, GithubMark, PatreonMark } from '../settings/BrandIcons';

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
 *  tagline, the links, and at the foot the version and the author. */
export default function StartBrand({ width }: { width: number }) {
  const { t, i18n } = useTranslation();
  const language = LANGUAGE_OPTIONS.some((o) => o.code === i18n.resolvedLanguage) ? i18n.resolvedLanguage : 'en';

  return (
    <aside className="start-brand" style={{ width }}>
      <div className="flex flex-col gap-7">
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <EmeraldMark size={84} />
            {/* Two lines beside the mark, as tall as it is. */}
            <h1 className="start-brand-title">
              <span className="block">Emerald</span>
              <span className="block">App</span>
            </h1>
          </div>
          <p className="start-brand-tagline">{t('settings.tagline')}</p>
        </div>
        <nav className="flex flex-col items-start gap-0.5 -ml-2.5" aria-label={t('start.links')}>
          <BrandLink icon={<Globe size={14} />} label={t('settings.website')} url={`${WEBSITE_BASE}/${language}/`} />
          <BrandLink icon={<GithubMark size={14} />} label="GitHub" url={packageJson.homepage} />
          <BrandLink icon={<PatreonMark size={14} />} label="Patreon" url={PATREON_URL} />
          <BrandLink icon={<DiscordMark size={14} />} label="Discord" url={DISCORD_URL} />
        </nav>
      </div>
      <div className="mt-auto pt-8 flex items-center justify-between gap-3 text-xs text-subtle">
        <span className="truncate">{packageJson.author}</span>
        <span className="shrink-0 tabular-nums">{t('start.version', { version: packageJson.version })}</span>
      </div>
    </aside>
  );
}
