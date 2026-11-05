import { useTranslation } from 'react-i18next';
import { showStartSection, type StartSection } from '../../../store/vaultPickerStore';

const SECTIONS: { id: StartSection; labelKey: string }[] = [
  { id: 'server', labelKey: 'start.server' },
  { id: 'appearance', labelKey: 'start.appearance' },
  { id: 'updates', labelKey: 'start.updates' },
  { id: 'about', labelKey: 'start.about' },
];

/** The start page's right column shows one section at a time: these switch it. */
export default function StartTabs({ section }: { section: StartSection }) {
  const { t } = useTranslation();
  return (
    <div className="start-tabs" role="tablist" aria-label={t('start.sections')}>
      {SECTIONS.map(({ id, labelKey }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={section === id}
          className={`start-tab${section === id ? ' start-tab-active' : ''}`}
          onClick={() => showStartSection(id)}
        >
          {t(labelKey)}
        </button>
      ))}
    </div>
  );
}
