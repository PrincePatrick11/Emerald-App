import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, HardDrive, Info, PanelLeft, SlidersHorizontal } from 'lucide-react';
import Modal from '../../ui/Modal';
import { useVaultStore } from '../../../store/vaultStore';
import { VaultGlyph } from '../VaultModal';
import GeneralPage from './GeneralPage';
import SidebarPage from './SidebarPage';
import BackupPage from './BackupPage';
import StoragePage from './StoragePage';
import AboutPage from './AboutPage';

export type SettingsPage = 'general' | 'sidebar' | 'backup' | 'storage' | 'about';

const PAGES = [
  { id: 'general', labelKey: 'settings.pageGeneral', Icon: SlidersHorizontal },
  { id: 'sidebar', labelKey: 'settings.pageSidebar', Icon: PanelLeft },
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
  const vault = useVaultStore((s) => s.vaults.find((v) => v.id === s.activeVaultId));

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
        className="w-[168px] shrink-0 border-r px-2 py-3 flex flex-col gap-0.5"
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
        {/* Jede Einstellung gehoert dem offenen Vault — unten in der Spalte,
            damit das beim Umstellen nicht ueberrascht. */}
        {vault && (
          <p className="mt-auto flex items-center gap-2 px-2.5 pt-3 text-xs text-stone-500 min-w-0">
            <span className="shrink-0"><VaultGlyph icon={vault.icon} size={12} /></span>
            <span className="truncate" title={vault.name}>{t('settings.appliesToVault', { name: vault.name })}</span>
          </p>
        )}
      </nav>

      <div
        role="tabpanel"
        aria-labelledby={`settings-tab-${page}`}
        className="flex-1 overflow-y-auto px-5 py-4 space-y-6"
      >
        {page === 'general' && <GeneralPage />}
        {page === 'sidebar' && <SidebarPage />}
        {page === 'backup' && <BackupPage />}
        {page === 'storage' && <StoragePage />}
        {page === 'about' && <AboutPage />}
      </div>
    </Modal>
  );
}
