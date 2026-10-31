import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Info } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import EmeraldMark from '../../ui/EmeraldMark';
import { LANGUAGE_OPTIONS } from '../../../i18n';
import packageJson from '../../../../package.json';
import { DiscordMark, GithubMark, PatreonMark } from './BrandIcons';
import SettingsSection from './SettingsSection';

/** The website offers the same four languages as the app, under the same
 *  codes. A fifth language in LANGUAGE_OPTIONS therefore needs a page there too
 *  — otherwise the link leads nowhere and falls back to English
 *  here. */
const WEBSITE_BASE = 'https://the-emerald-app.de';
const PATREON_URL = 'https://www.patreon.com/cw/PrincePatrick';
const DISCORD_URL = 'https://discord.gg/3TpYUn2AkM';

/** A link that leaves the app: `openUrl` instead of <a href>, so the WebView
 *  does not navigate there itself. The same route as the links in the editor.
 *
 *  Only the symbol, in the accent colour — the name is in the tooltip and, for
 *  screen readers, in the aria-label. */
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

/** One row of the fact list: label on the left, value on the right. */
function AboutFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-secondary">{value}</span>
    </div>
  );
}

export default function AboutPage() {
  const { t, i18n } = useTranslation();

  const language = LANGUAGE_OPTIONS.some((o) => o.code === i18n.resolvedLanguage)
    ? i18n.resolvedLanguage
    : 'en';

  return (
    // With a section heading like every other page of the window; the
    // card inside holds the fact list together.
    <SettingsSection icon={<Info size={14} />} title={t('settings.about')}>
      <div className="panel px-4 py-3 space-y-1.5">
      {/* The mark stands in place of a row "App — Emerald App": it says
          the same and is the only static spot where the stone is large
          enough for its facets. */}
        <div className="settings-divider-bottom flex items-center gap-2.5 pb-2.5 mb-1">
          <EmeraldMark size={30} />
          <span className="text-sm text-secondary">Emerald App</span>
        </div>

        <p className="text-sm text-secondary">{t('settings.tagline')}</p>
        <p className="settings-divider-bottom text-sm leading-relaxed pb-2.5 mb-1 text-muted">
          {t('settings.taglineDetail')}
        </p>

        <AboutFact label={t('settings.version')} value={packageJson.version} />
        <AboutFact label={t('settings.author')} value={packageJson.author} />
        <AboutFact label={t('settings.license')} value={packageJson.license} />

        <div className="settings-divider-top flex justify-between items-center gap-3 text-sm pt-2.5 mt-1">
          <span className="shrink-0 text-muted">{t('settings.links')}</span>
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
