import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/shallow';
import { Settings } from 'lucide-react';
import { Suspense, lazy, useState } from 'react';
import { AUX_VIEWS, MODULE_LIST } from '../../lib/modules';
import { useUIStore } from '../../store/uiStore';
import { useVaultStore } from '../../store/vaultStore';
import VaultModal, { VaultGlyph } from './VaultModal';

// SettingsModal zieht die komplette Backup-/Restore-Maschinerie (dbBackup)
// hinter sich her — als eigener Chunk erst beim ersten Oeffnen.
// VaultModal bleibt eager: VaultGlyph wird fuer den Rail-Button gebraucht,
// und AppShell rendert es beim Erststart ohnehin.
const SettingsModal = lazy(() => import('./SettingsModal'));
import RailButton from '../ui/RailButton';

/** Breite der Rail. `AppShell` rechnet damit die Breite des <aside> und
 *  die Standardbreite der rechten Seitenleiste aus, deshalb steht sie als
 *  Zahl hier statt als `w-14`-Klasse unten: zwei Wahrheiten haetten eine
 *  geklippte Rail *und* eine falsche Breite rechts ergeben. */
export const RAIL_WIDTH = 56;

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
  const { setActiveView, leftListOpen, toggleLeftList, rightSidebarOpen, toggleRightSidebar, } = useUIStore(
    useShallow((s) => ({ setActiveView: s.setActiveView, leftListOpen: s.leftListOpen, toggleLeftList: s.toggleLeftList, rightSidebarOpen: s.rightSidebarOpen, toggleRightSidebar: s.toggleRightSidebar }))
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  // Selector auf ein Primitiv, nicht auf den Vault-Datensatz: `find` liefert
  // sonst bei jedem Store-Update ein Objekt, das zustand als geaendert liest.
  const activeVaultIcon = useVaultStore((s) => s.vaults.find((v) => v.id === s.activeVaultId)?.icon);

  return (
    <div
      className="left-sidebar-rail rail-divider flex flex-col items-center h-full flex-shrink-0 border-r"
      style={{ width: RAIL_WIDTH }}
    >
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
        {/* Der Weg zum Dashboard. Er hing vorher am Emerald-Logo in der
            Titelleiste, das niemand als Navigationsziel liest.
            Achtung bei MCP-Selektoren: lucide exportiert `Home` als Alias von
            `House`, das SVG traegt also `.lucide-house`, nicht `.lucide-home`. */}
        <RailButton onClick={() => setActiveView({ type: 'home' })} title={t(AUX_VIEWS.home.navLabelKey)}>
          <AUX_VIEWS.home.icon size={18} />
        </RailButton>
        {MODULE_LIST.map((mod) => (
          <RailButton key={mod.id} onClick={() => setActiveView({ type: mod.id })} title={t(mod.navLabelKey)}>
            <mod.icon size={18} />
          </RailButton>
        ))}
      </div>

      {/* Bottom nav — always visible: Tags/Trash grouped, Vault/Settings set apart below a divider */}
      <div className="sidebar-bottom-bar w-full flex-1 flex flex-col items-center justify-end py-2">
        <div className="flex flex-col items-center gap-0.5">
          <RailButton onClick={() => setActiveView({ type: 'tags' })} title={t(AUX_VIEWS.tags.navLabelKey)}>
            <AUX_VIEWS.tags.icon size={18} />
          </RailButton>
          <RailButton onClick={() => setActiveView({ type: 'trash' })} title={t(AUX_VIEWS.trash.navLabelKey)}>
            <AUX_VIEWS.trash.icon size={18} />
          </RailButton>
        </div>
        <div className="rail-divider w-8 border-t my-1.5" />
        <div className="flex flex-col items-center gap-0.5">
          <RailButton onClick={() => setVaultOpen(true)} title={t('nav.vaults')}>
            {/* 17px nur fuers Emoji: es traegt keine Strichstaerke und wirkt
                neben den lucide-Icons sonst zu gross. Das Ersatz-Glyph ist
                selbst ein lucide-Icon und bleibt bei den 18 seiner Nachbarn. */}
            <VaultGlyph icon={activeVaultIcon} size={activeVaultIcon ? 17 : 18} />
          </RailButton>
          <RailButton onClick={() => setSettingsOpen(true)} title={t('nav.settings')}>
            <Settings size={18} />
          </RailButton>
        </div>
      </div>

      {vaultOpen && <VaultModal onClose={() => setVaultOpen(false)} />}
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal onClose={() => setSettingsOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
