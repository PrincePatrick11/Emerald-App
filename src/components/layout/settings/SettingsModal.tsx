import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, FileText, HardDrive, PanelLeft, ShieldCheck, SlidersHorizontal, Cloud } from 'lucide-react';
import Modal from '../../ui/Modal';
import { useCloseOnKeepEditing } from '../../../hooks/useCloseOnKeepEditing';
import GeneralPage from './GeneralPage';
import SidebarPage from './SidebarPage';
import EntriesPage from './EntriesPage';
import SecurityPage from './SecurityPage';
import BackupPage from './BackupPage';
import StoragePage from './StoragePage';
import SyncPage from './SyncPage';

export type SettingsPage = 'general' | 'sidebar' | 'entries' | 'security' | 'sync' | 'backup' | 'storage';

const PAGES = [
  { id: 'general', labelKey: 'settings.pageGeneral', Icon: SlidersHorizontal },
  { id: 'sidebar', labelKey: 'settings.pageSidebar', Icon: PanelLeft },
  { id: 'entries', labelKey: 'settings.pageEntries', Icon: FileText },
  { id: 'security', labelKey: 'settings.pageSecurity', Icon: ShieldCheck },
  { id: 'sync', labelKey: 'settings.pageSync', Icon: Cloud },
  { id: 'backup', labelKey: 'settings.backup', Icon: Archive },
  { id: 'storage', labelKey: 'settings.storage', Icon: HardDrive },
] as const;

interface Props {
  onClose: () => void;
  /** Area the window opens with. The rail uses it to jump straight to
   *  "Backup" when an automatic backup failed. Updates and About are on the
   *  start page (`VaultPicker`), with language and theme. */
  initialPage?: SettingsPage;
}

export default function SettingsModal({ onClose, initialPage = 'general' }: Props) {
  const { t } = useTranslation();
  const [page, setPage] = useState<SettingsPage>(initialPage);
  // A page that must not be left right now — the security page
  // with a new recovery key that has not been saved yet.
  const [closeBlocked, setCloseBlocked] = useState(false);
  const blockClose = useCallback((blocked: boolean) => setCloseBlocked(blocked), []);
  // An import or update that got stuck on an edit in progress.
  useCloseOnKeepEditing(onClose);

  return (
    <Modal
      title={t('nav.settings')}
      onClose={onClose}
      dismissible={!closeBlocked}
      widthClassName="w-[680px]"
      // Fixed height instead of max-h: the three areas differ in height,
      // and a card that grows along jumps on every switch — the same
      // problem the link picker solves with h-[75vh]. The 680 is no
      // round random value: plus the 32 of the backdrop p-4 it stays below the
      // minimum window width of 720. Do not round up to 700.
      className="overflow-hidden h-[600px] max-h-[85vh]"
      bodyClassName="flex-1 flex overflow-hidden"
    >
      {/* Only Tab and Enter, no arrow-key navigation — the same scope as
          the link picker's tab bar. */}
      <nav
        role="tablist"
        aria-orientation="vertical"
        className="modal-rule w-[168px] shrink-0 border-r px-2 py-3 space-y-0.5"
      >
        {PAGES.map(({ id, labelKey, Icon }) => (
          <button
            key={id}
            id={`settings-tab-${id}`}
            role="tab"
            aria-selected={page === id}
            disabled={closeBlocked && page !== id}
            onClick={() => setPage(id)}
            // `border border-transparent` as the base state, because the
            // theme rule gives the active item a 1px border: without that
            // placeholder the column would jerk by 2px on every switch.
            //
            // Colour and surface come exclusively from the two theme rules.
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
        {page === 'sidebar' && <SidebarPage />}
        {page === 'entries' && <EntriesPage />}
        {page === 'security' && <SecurityPage onClose={onClose} onBlockClose={blockClose} />}
        {page === 'sync' && <SyncPage />}
        {page === 'backup' && <BackupPage />}
        {page === 'storage' && <StoragePage />}
      </div>
    </Modal>
  );
}
