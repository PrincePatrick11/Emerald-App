import { useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { showStartSection, type StartSection } from '../../../store/vaultPickerStore';

const SECTIONS: { id: StartSection; labelKey: string }[] = [
  { id: 'server', labelKey: 'start.server' },
  { id: 'appearance', labelKey: 'start.appearance' },
  { id: 'updates', labelKey: 'start.updates' },
  { id: 'about', labelKey: 'start.about' },
];

/** The panel the tabs control; `VaultPicker` gives it this id. */
export const START_PANEL_ID = 'start-panel';
export const startTabId = (section: StartSection) => `start-tab-${section}`;

/**
 * The start page's right column shows one section at a time: these switch it.
 * The tabs pattern with a roving tab stop: Tab reaches the chosen tab, the
 * arrow keys, Home and End move between them and choose at once.
 */
export default function StartTabs({ section }: { section: StartSection }) {
  const { t } = useTranslation();
  const refs = useRef<Partial<Record<StartSection, HTMLButtonElement | null>>>({});

  const onKeyDown = (e: KeyboardEvent) => {
    const index = SECTIONS.findIndex(({ id }) => id === section);
    const next = e.key === 'ArrowRight' ? (index + 1) % SECTIONS.length
      : e.key === 'ArrowLeft' ? (index - 1 + SECTIONS.length) % SECTIONS.length
        : e.key === 'Home' ? 0
          : e.key === 'End' ? SECTIONS.length - 1
            : null;
    if (next === null) return;
    e.preventDefault();
    const id = SECTIONS[next].id;
    showStartSection(id);
    refs.current[id]?.focus();
  };

  return (
    <div className="start-tabs" role="tablist" aria-label={t('start.sections')} onKeyDown={onKeyDown}>
      {SECTIONS.map(({ id, labelKey }) => (
        <button
          key={id}
          ref={(el) => { refs.current[id] = el; }}
          id={startTabId(id)}
          type="button"
          role="tab"
          aria-selected={section === id}
          aria-controls={START_PANEL_ID}
          tabIndex={section === id ? 0 : -1}
          className={`start-tab${section === id ? ' start-tab-active' : ''}`}
          onClick={() => showStartSection(id)}
        >
          {t(labelKey)}
        </button>
      ))}
    </div>
  );
}
