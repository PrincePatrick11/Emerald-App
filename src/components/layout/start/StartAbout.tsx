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
 *  does not navigate there itself. Only the symbol; the name is its tooltip
 *  and, for screen readers, its aria-label. */
function AboutLink({ icon, label, url }: { icon: ReactNode; label: string; url: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => { openUrl(url).catch((err: unknown) => console.error('[about] open failed:', err)); }}
      className="settings-about-link start-link"
    >
      {icon}
    </button>
  );
}

/** Version, author, licence, links. */
export default function StartAbout() {
  const { t, i18n } = useTranslation();
  const language = LANGUAGE_OPTIONS.some((o) => o.code === i18n.resolvedLanguage) ? i18n.resolvedLanguage : 'en';

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3">
        <EmeraldMark size={36} />
        <div className="min-w-0">
          <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Emerald App</div>
          <div className="text-xs text-muted">{t('settings.tagline')}</div>
        </div>
      </div>

      <dl className="picker-stats mt-6">
        <dt>{t('settings.version')}</dt>
        <dd>{packageJson.version}</dd>
        <dt>{t('settings.author')}</dt>
        <dd>{packageJson.author}</dd>
        <dt>{t('settings.license')}</dt>
        <dd>{packageJson.license}</dd>
      </dl>

      <div className="flex items-center gap-1 mt-6 -ml-1.5">
        <AboutLink icon={<Globe size={16} />} label={t('settings.website')} url={`${WEBSITE_BASE}/${language}/`} />
        <AboutLink icon={<GithubMark size={16} />} label="GitHub" url={packageJson.homepage} />
        <AboutLink icon={<PatreonMark size={16} />} label="Patreon" url={PATREON_URL} />
        <AboutLink icon={<DiscordMark size={16} />} label="Discord" url={DISCORD_URL} />
      </div>
    </div>
  );
}
