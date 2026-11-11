import { useTranslation } from 'react-i18next';
import { LayoutGrid, Plus, Settings, type LucideIcon } from 'lucide-react';
import { Suspense, lazy, useEffect, useState } from 'react';
import { AUX_VIEWS, MODULES, type ViewId } from '../../lib/modules';
import { useUIStore } from '../../store/uiStore';
import { useVaultStore } from '../../store/vaultStore';
import { useAutoBackupStore } from '../../store/autoBackupStore';
import { useSettingsStore } from '../../store/settingsStore';
import { markAutoBackupErrorSeen } from '../../lib/autoBackup';
import { asUpdateError, checkForUpdate, updateSettings } from '../../lib/updates';
import { openVaultPicker } from '../../store/vaultPickerStore';
import CreateItemModal from './CreateItemModal';

// SettingsModal drags the complete backup/restore machinery (dbBackup)
// along with it — as a chunk of its own, only on first open.
const SettingsModal = lazy(() => import('./settings/SettingsModal'));
// Only the type — `import type` disappears on compilation and does not pull
// the module back into the main chunk.
import type { SettingsPage } from './settings/SettingsModal';
import RailButton from '../ui/RailButton';

/** Width of the rail: the 32px buttons with 6px of air each, tight, so the list
 *  moves close to the icons (`.app-sidebar-left-with-rail` in index.css).
 *  `AppShell` uses it to work out the width of the <aside> and the default width
 *  of the right sidebar, the title bar the width of the logo — that is why
 *  it is a number here instead of a class below: two truths would yield
 *  a clipped rail *and* wrong widths next to it. */
export const RAIL_WIDTH = 44;

/** Buttons of one group sit tight; the gap between groups is three times that. */
const RAIL_GROUP = 'w-full flex flex-col items-center gap-1';

/**
 * The check at startup, once per app start: the bar is re-mounted,
 * e.g. after the altar's fullscreen, and would otherwise check again every time.
 */
let startupCheck: Promise<string | null> | undefined;
/** The update dot has done its job — re-mounting does not show it again. */
let dotSeen = false;

function checkOnStart(): Promise<string | null> {
  startupCheck ??= (async () => {
    try {
      if (!(await updateSettings()).auto_check) return null;
      const found = await checkForUpdate();
      return found.available && found.installable ? found.version : null;
    } catch (e: unknown) {
      // No network, no source, no problem: the dot stays off. Only the
      // console is told — showing an error message unprompted at startup
      // would be worse than the missing update.
      console.error('[updates] check on start failed:', asUpdateError(e).detail);
      return null;
    }
  })();
  return startupCheck;
}

/** A small dot on a rail button: an update found (accent), a failed backup (danger). */
function RailDot({ tone }: { tone: 'accent' | 'danger' }) {
  return (
    <span
      aria-hidden
      className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full"
      style={{ backgroundColor: tone === 'accent' ? 'var(--accent)' : 'var(--danger-text)' }}
    />
  );
}

export default function LeftSidebarRail() {
  const { t } = useTranslation();
  const setActiveView = useUIStore((s) => s.setActiveView);
  const activeViewType = useUIStore((s) => s.activeView.type);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>('general');
  const [createOpen, setCreateOpen] = useState(false);
  const activeVaultId = useVaultStore((s) => s.activeVaultId);

  // The check at startup lives here and not in App.tsx because its only
  // visible result is the dot on the start page button below. Found or not:
  // it never announces itself — a window that opens unprompted would be
  // the kind of interruption a local app should not have.
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    void checkOnStart().then((version) => {
      if (!dead && version && !dotSeen) setUpdateVersion(version);
    });
    return () => { dead = true; };
  }, []);

  // A failed automatic backup reports at the same dot: failing silently is
  // the last thing it should do. Only while it is switched on — otherwise the
  // dot would lead to a page that shows nothing about it.
  const backupOn = useSettingsStore((s) => s.settings.backup.auto);
  const backupFailed = useAutoBackupStore((s) => s.error !== null && !s.errorSeen && s.vaultId === activeVaultId) && backupOn;

  // One button per view; it is highlighted as long as its view is open —
  // also with an entry open inside it.
  const viewButton = (type: ViewId, meta: { icon: LucideIcon; navLabelKey: string }) => (
    <RailButton
      key={type}
      active={activeViewType === type}
      onClick={() => setActiveView({ type })}
      title={t(meta.navLabelKey)}
    >
      <meta.icon size={18} />
    </RailButton>
  );

  return (
    <div
      // No divider to the list: both are part of the frame.
      // Scrolls without a bar when the window is too low for all the buttons.
      className="left-sidebar-rail scrollbar-none overflow-y-auto flex flex-col items-center h-full flex-shrink-0"
      style={{ width: RAIL_WIDTH }}
    >
      {/* The two sidebars are toggled by the "View" menu (useTitleBarMenus,
          native on macOS) — buttons of their own up here were a second place
          for the same thing. */}

      {/* Main nav icons — they never touch the entry-list panel. Groups are set
          apart by space alone: lines would be more dividers in a frame that has none. */}
      <div className="w-full flex-shrink-0 flex flex-col items-center gap-3 pb-2">
        <div className={RAIL_GROUP}>
          <RailButton onClick={() => setCreateOpen(true)} title={t('createItem.title')}>
            <Plus size={18} />
          </RailButton>
          {/* The way to the dashboard. It used to hang on the Emerald logo in the
              title bar, which nobody reads as a navigation target.
              Mind the MCP selectors: lucide exports `Home` as an alias of
              `House`, so the SVG carries `.lucide-house`, not `.lucide-home`. */}
          {viewButton('home', AUX_VIEWS.home)}
        </div>
        <div className={RAIL_GROUP}>
          {viewButton('journal', MODULES.journal)}
          {viewButton('tasks', MODULES.tasks)}
          {viewButton('operations', MODULES.operations)}
        </div>
        {/* The lexicon is not an entry module, but belongs with wiki and altar. */}
        <div className={RAIL_GROUP}>
          {viewButton('wiki', MODULES.wiki)}
          {viewButton('lexicon', AUX_VIEWS.lexicon)}
          {viewButton('altar', MODULES.altar)}
        </div>
        <div className={RAIL_GROUP}>
          {viewButton('templates', AUX_VIEWS.templates)}
          {viewButton('blocks', AUX_VIEWS.blocks)}
        </div>
      </div>

      {/* Bottom nav — always visible, read from the bottom: start page,
          Settings, Trash, Tags, Categories, Images */}
      <div className="sidebar-bottom-bar w-full flex-[1_0_auto] flex flex-col items-center justify-end gap-3 py-2">
        <div className={RAIL_GROUP}>
          {viewButton('images', AUX_VIEWS.images)}
          {viewButton('categories', AUX_VIEWS.categories)}
          {viewButton('tags', AUX_VIEWS.tags)}
          {viewButton('trash', AUX_VIEWS.trash)}
        </div>
        <div className={RAIL_GROUP}>
          <RailButton
            // The target is captured here and the dot cleared immediately: it
            // has done its job as soon as something opens.
            onClick={() => {
              setSettingsPage(backupFailed ? 'backup' : 'general');
              setSettingsOpen(true);
              if (backupFailed) markAutoBackupErrorSeen();
            }}
            title={backupFailed ? t('settings.autoBackupFailedDot') : t('nav.settings')}
            className="relative"
          >
            <Settings size={18} />
            {backupFailed && <RailDot tone="danger" />}
          </RailButton>
          {/* Last, at the very bottom: the start page, the app's cockpit.
              A found update shows here, since installing lives there. */}
          <RailButton
            onClick={() => {
              if (updateVersion) {
                setUpdateVersion(null);
                dotSeen = true;
                void openVaultPicker('updates');
                return;
              }
              void openVaultPicker();
            }}
            title={updateVersion ? t('settings.updateFound', { version: updateVersion }) : t('nav.startPage')}
            className="relative"
          >
            <LayoutGrid size={18} />
            {updateVersion && <RailDot tone="accent" />}
          </RailButton>
        </div>
      </div>

      {createOpen && <CreateItemModal onClose={() => setCreateOpen(false)} />}
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal
            onClose={() => setSettingsOpen(false)}
            initialPage={settingsPage}
          />
        </Suspense>
      )}
    </div>
  );
}
