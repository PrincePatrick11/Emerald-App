import { useTranslation } from 'react-i18next';
import {
  BookOpen,
  Library,
  Tag,
  Trash2,
  Flame,
  Wand2,
  Settings,
  CheckSquare,
  Vault,
} from 'lucide-react';
import { useState } from 'react';
import { useUIStore } from '../../store/uiStore';
import SettingsModal from './SettingsModal';
import VaultModal from './VaultModal';
import RailButton from '../ui/RailButton';

function PanelToggleIcon({ active, mirrored, size = 16 }: { active: boolean; mirrored?: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d={mirrored ? 'M15 3v18' : 'M9 3v18'} />
      {active && <path d="M4.5 4.5l15 15" />}
    </svg>
  );
}

export default function LeftSidebarRail() {
  const { t } = useTranslation();
  const {
    setActiveView, leftListOpen, toggleLeftList, rightSidebarOpen, toggleRightSidebar,
  } = useUIStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);

  return (
    <div className="left-sidebar-rail rail-divider flex flex-col items-center h-full w-14 flex-shrink-0 border-r">
      {/* Sidebar panel toggles — independent of the nav links below */}
      <div className="rail-divider w-full flex flex-col items-center gap-0.5 py-2 border-b">
        <RailButton onClick={toggleLeftList} title={leftListOpen ? t('sidebar.collapseList') : t('sidebar.expandList')}>
          <PanelToggleIcon active={leftListOpen} size={18} />
        </RailButton>
        <RailButton onClick={toggleRightSidebar} title={rightSidebarOpen ? t('sidebar.collapseProperties') : t('sidebar.expandProperties')}>
          <PanelToggleIcon active={rightSidebarOpen} mirrored size={18} />
        </RailButton>
      </div>

      {/* Main nav icons — navigate only, never touch the entry-list panel */}
      <div className="rail-divider w-full flex flex-col items-center gap-0.5 py-2 border-b">
        <RailButton onClick={() => setActiveView({ type: 'journal' })} title={t('nav.journal')}>
          <BookOpen size={18} />
        </RailButton>
        <RailButton onClick={() => setActiveView({ type: 'tasks' })} title={t('nav.tasks')}>
          <CheckSquare size={18} />
        </RailButton>
        <RailButton onClick={() => setActiveView({ type: 'operations' })} title={t('nav.operations')}>
          <Wand2 size={18} />
        </RailButton>
        <RailButton onClick={() => setActiveView({ type: 'wiki' })} title={t('nav.wiki')}>
          <Library size={18} />
        </RailButton>
        <RailButton onClick={() => setActiveView({ type: 'altar' })} title={t('nav.altar')}>
          <Flame size={18} />
        </RailButton>
      </div>

      {/* Bottom nav — always visible: Tags/Trash grouped, Vault/Settings set apart below a divider */}
      <div className="sidebar-bottom-bar w-full flex-1 flex flex-col items-center justify-end py-2">
        <div className="flex flex-col items-center gap-0.5">
          <RailButton onClick={() => setActiveView({ type: 'tags' })} title={t('nav.tags')}>
            <Tag size={18} />
          </RailButton>
          <RailButton onClick={() => setActiveView({ type: 'trash' })} title={t('nav.trash')}>
            <Trash2 size={18} />
          </RailButton>
        </div>
        <div className="rail-divider w-8 border-t my-1.5" />
        <div className="flex flex-col items-center gap-0.5">
          <RailButton onClick={() => setVaultOpen(true)} title={t('nav.vaults')}>
            <Vault size={18} />
          </RailButton>
          <RailButton onClick={() => setSettingsOpen(true)} title={t('nav.settings')}>
            <Settings size={18} />
          </RailButton>
        </div>
      </div>

      {vaultOpen && <VaultModal onClose={() => setVaultOpen(false)} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
