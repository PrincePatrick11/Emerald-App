import { useTranslation } from 'react-i18next';
import { LayoutGrid, Plus, Settings, type LucideIcon } from 'lucide-react';
import { Suspense, lazy, useEffect, useState } from 'react';
import { AUX_VIEWS, TASKS_VIEW, type ViewId } from '../../lib/modules';
import { useUIStore } from '../../store/uiStore';
import { autoBackupFailed, useAutoBackupStore } from '../../store/autoBackupStore';
import { useVaultImportStore } from '../../store/vaultImportStore';
import { markAutoBackupErrorSeen } from '../../lib/autoBackup';
import { asUpdateError, checkForUpdate, updateSettings } from '../../lib/updates';
import { openVaultPicker } from '../../store/vaultPickerStore';
import type { OpenedVaultFile } from '../../lib/dbBackup';
import CreateItemModal from './CreateItemModal';
import { useRailDashboards } from './RailDashboards';

// SettingsModal and the two dialogs of a whole vault are chunks of their own,
// loaded on first open — the latter drag the backup machinery (dbBackup) along.
const SettingsModal = lazy(() => import('./settings/SettingsModal'));
const VaultImportModal = lazy(() => import('./VaultImportModal'));
const VaultExportModal = lazy(() => import('./VaultExportModal'));
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
 * The check at startup, once per app start: the bar can be re-mounted
 * and would otherwise check again every time.
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
  const [createOpen, setCreateOpen] = useState(false);
  const railDashboards = useRailDashboards();

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

  // A `.vault.emerald` from the menu's import is replaced or merged in its
  // dialog, which takes the file over. A newer one replaces it there.
  const [importFile, setImportFile] = useState<OpenedVaultFile | null>(null);
  const vaultFilePending = useVaultImportStore((s) => s.pending !== null);
  useEffect(() => {
    if (!vaultFilePending) return;
    const file = useVaultImportStore.getState().take();
    if (file) setImportFile(file);
  }, [vaultFilePending]);
  const exportOpen = useVaultImportStore((s) => s.exportOpen);

  // A failed automatic backup reports at the start page button, where it is
  // set: failing silently is the last thing it should do.
  const backupFailed = useAutoBackupStore((s) => autoBackupFailed(s) && !s.errorSeen);

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
          {/* "All entries": the dashboard without a filter, so nothing can
              become unfindable. Every dashboard button carries `data-dashboard-id`
              for selectors that outlive a session. */}
          {railDashboards.allButton}
        </div>
        {/* The dashboards in their order (drag to move), then the tasks. */}
        <div className={RAIL_GROUP}>
          {railDashboards.group}
          {viewButton('tasks', TASKS_VIEW)}
        </div>
        <div className={RAIL_GROUP}>
          {viewButton('lexicon', AUX_VIEWS.lexicon)}
        </div>
        <div className={RAIL_GROUP}>
          {viewButton('templates', AUX_VIEWS.templates)}
          {viewButton('blocks', AUX_VIEWS.blocks)}
        </div>
      </div>

      {/* Bottom nav — always visible, read from the bottom: start page,
          Settings, Trash, Tags, Categories, Images, Symbols */}
      <div className="sidebar-bottom-bar w-full flex-[1_0_auto] flex flex-col items-center justify-end gap-3 py-2">
        <div className={RAIL_GROUP}>
          {viewButton('symbols', AUX_VIEWS.symbols)}
          {viewButton('images', AUX_VIEWS.images)}
          {viewButton('categories', AUX_VIEWS.categories)}
          {viewButton('tags', AUX_VIEWS.tags)}
          {viewButton('trash', AUX_VIEWS.trash)}
        </div>
        <div className={RAIL_GROUP}>
          <RailButton onClick={() => setSettingsOpen(true)} title={t('nav.settings')}>
            <Settings size={18} />
          </RailButton>
          {/* Last, at the very bottom: the start page, the app's cockpit.
              A found update shows here, since installing lives there — and a
              failed automatic backup, since it is set there. The dot is
              cleared once the page opens: then it has done its job. */}
          <RailButton
            onClick={() => {
              if (backupFailed) {
                // Seen only once the page is open — "Keep editing" keeps the dot.
                void openVaultPicker('backup').then((opened) => { if (opened) markAutoBackupErrorSeen(); });
                return;
              }
              if (updateVersion) {
                setUpdateVersion(null);
                dotSeen = true;
                void openVaultPicker('updates');
                return;
              }
              void openVaultPicker();
            }}
            title={backupFailed
              ? t('autoBackup.failedDot')
              : updateVersion ? t('settings.updateFound', { version: updateVersion }) : t('nav.startPage')}
            className="relative"
          >
            <LayoutGrid size={18} />
            {backupFailed ? <RailDot tone="danger" /> : updateVersion && <RailDot tone="accent" />}
          </RailButton>
        </div>
      </div>

      {createOpen && <CreateItemModal onClose={() => setCreateOpen(false)} />}
      {railDashboards.menu}
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal onClose={() => setSettingsOpen(false)} />
        </Suspense>
      )}
      {importFile && (
        <Suspense fallback={null}>
          {/* Keyed by the file: a newer one opens the dialog afresh. */}
          <VaultImportModal key={importFile.ticket} file={importFile} onClose={() => setImportFile(null)} />
        </Suspense>
      )}
      {exportOpen && (
        <Suspense fallback={null}>
          <VaultExportModal onClose={() => useVaultImportStore.getState().setExportOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
