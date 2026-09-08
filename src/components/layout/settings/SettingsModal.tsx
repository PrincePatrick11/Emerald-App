import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, HardDrive, Info, SlidersHorizontal } from 'lucide-react';
import Modal from '../../ui/Modal';
import GeneralPage from './GeneralPage';
import BackupPage from './BackupPage';
import StoragePage from './StoragePage';
import AboutPage from './AboutPage';

export type SettingsPage = 'general' | 'backup' | 'storage' | 'about';

const PAGES = [
  { id: 'general', labelKey: 'settings.pageGeneral', Icon: SlidersHorizontal },
  { id: 'backup', labelKey: 'settings.backup', Icon: Archive },
  { id: 'storage', labelKey: 'settings.storage', Icon: HardDrive },
  { id: 'about', labelKey: 'settings.about', Icon: Info },
] as const;

interface Props {
  onClose: () => void;
  /** Bereich, mit dem das Fenster aufgeht. Heute verlinkt nichts hierher; der
   *  Prop macht einen spaeteren Direktsprung zu einer Zeile statt zu einem
   *  Umbau. */
  initialPage?: SettingsPage;
}

export default function SettingsModal({ onClose, initialPage = 'general' }: Props) {
  const { t } = useTranslation();
  const [page, setPage] = useState<SettingsPage>(initialPage);

  return (
    <Modal
      title={t('nav.settings')}
      onClose={onClose}
      widthClassName="w-[680px]"
      // Feste Hoehe statt max-h: die drei Bereiche sind unterschiedlich hoch,
      // und eine mitwachsende Karte springt bei jedem Wechsel — dasselbe
      // Problem, das der Link-Picker mit h-[75vh] loest. Die 680 sind kein
      // runder Zufallswert: plus die 32 des Backdrop-p-4 bleiben sie unter der
      // Fenster-Mindestbreite von 720. Nicht auf 700 aufrunden.
      className="overflow-hidden h-[600px] max-h-[85vh]"
      bodyClassName="flex-1 flex overflow-hidden"
    >
      {/* Nur Tab und Enter, keine Pfeiltasten-Navigation — derselbe Umfang wie
          bei der Tab-Leiste des Link-Pickers. */}
      <nav
        role="tablist"
        aria-orientation="vertical"
        className="w-[168px] shrink-0 border-r px-2 py-3 space-y-0.5"
        style={{ borderColor: 'var(--border-soft)' }}
      >
        {PAGES.map(({ id, labelKey, Icon }) => (
          <button
            key={id}
            id={`settings-tab-${id}`}
            role="tab"
            aria-selected={page === id}
            onClick={() => setPage(id)}
            // `border border-transparent` als Grundzustand, weil die
            // Theme-Regel dem aktiven Eintrag einen 1px-Rahmen gibt: ohne den
            // Platzhalter ruckte die Spalte bei jedem Wechsel um 2px.
            //
            // Farbe und Flaeche kommen ausschliesslich aus den beiden
            // Theme-Regeln, keine jade-/stone-Utility als Grundton: Parchment
            // biegt `.text-jade-300` weiter unten im Stylesheet auf ein helles
            // #ecfff7 um — gedacht fuer dunkle Jade-Flaechen. Bei gleicher
            // Spezifitaet gewinnt die spaetere Regel, und die aktive Zeile
            // stand weiss auf hellem Mint.
            className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md border border-transparent text-sm text-left transition-colors ${
              page === id ? 'settings-nav-item-active' : 'settings-nav-item-idle'
            }`}
          >
            <Icon size={14} />
            {t(labelKey)}
          </button>
        ))}
      </nav>

      <div
        role="tabpanel"
        aria-labelledby={`settings-tab-${page}`}
        className="flex-1 overflow-y-auto px-5 py-4 space-y-6"
      >
        {page === 'general' && <GeneralPage />}
        {page === 'backup' && <BackupPage />}
        {page === 'storage' && <StoragePage />}
        {page === 'about' && <AboutPage />}
      </div>
    </Modal>
  );
}
