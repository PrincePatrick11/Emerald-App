import { useTranslation } from 'react-i18next';
import { Settings } from 'lucide-react';
import { Suspense, lazy, useEffect, useState } from 'react';
import { AUX_VIEWS } from '../../lib/modules';
import { useUIStore } from '../../store/uiStore';
import { useVaultStore } from '../../store/vaultStore';
import { useAutoBackupStore } from '../../store/autoBackupStore';
import { useSettingsStore } from '../../store/settingsStore';
import { markAutoBackupErrorSeen } from '../../lib/autoBackup';
import { asUpdateError, checkForUpdate, updateSettings } from '../../lib/updates';
import VaultModal, { VaultGlyph } from './VaultModal';

// SettingsModal drags the complete backup/restore machinery (dbBackup)
// along with it — as a chunk of its own, only on first open.
// VaultModal stays eager: VaultGlyph is needed for the button here,
// and AppShell renders it on first start anyway.
const SettingsModal = lazy(() => import('./settings/SettingsModal'));
// Only the type — `import type` disappears on compilation and does not pull
// the module back into the main chunk.
import type { SettingsPage } from './settings/SettingsModal';
import RailButton from '../ui/RailButton';

/** Icon size of the row; the rail above it has 18. */
const FOOTER_ICON = 15;

const FOOTER_VIEWS = ['trash', 'tags', 'categories'] as const;

/**
 * The check at startup, once per app start: the bar is re-mounted,
 * e.g. after the altar's fullscreen, and would otherwise check again every time.
 */
let startupCheck: Promise<string | null> | undefined;
/** The dot on the gear has done its job — re-mounting does not show it again. */
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

/**
 * The narrow row under rail and entry list, for what is needed less often than
 * the modules: Settings, Trash, Tags and Categories side by side, the Vault in
 * the far corner. It takes the width of
 * the left side as a whole and wraps, so with the list hidden the buttons stack
 * in the width of the rail.
 */
export default function LeftSidebarFooter() {
  const { t } = useTranslation();
  const setActiveView = useUIStore((s) => s.setActiveView);
  const activeViewType = useUIStore((s) => s.activeView.type);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>('general');
  const [vaultOpen, setVaultOpen] = useState(false);
  // Selector on a primitive, not on the vault record: otherwise `find` returns
  // an object on every store update that zustand reads as changed.
  const activeVaultIcon = useVaultStore((s) => s.vaults.find((v) => v.id === s.activeVaultId)?.icon);
  const activeVaultId = useVaultStore((s) => s.activeVaultId);

  // The check at startup lives here and not in App.tsx because its only
  // visible result is the dot on the gear below. Found or not:
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
  // What the gear is currently reporting. The update takes precedence, it is the rarer message.
  const notice = updateVersion ? 'update' : backupFailed ? 'backup' : null;

  return (
    <div className="left-sidebar-footer sidebar-bottom-bar w-full flex-shrink-0 flex flex-wrap items-center gap-1 px-[9px] pt-1 pb-1.5">
      <RailButton
        // The target page is captured here and the dot cleared immediately:
        // it has done its job as soon as the window opens. The other way
        // round, the gear would jump to "Updates" for the rest of the
        // session — and clearing without this capture would mean the window
        // opens on "General" again, because both state changes land in the
        // same render.
        onClick={() => {
          setSettingsPage(notice === 'update' ? 'updates' : notice === 'backup' ? 'backup' : 'general');
          setSettingsOpen(true);
          setUpdateVersion(null);
          if (notice === 'update') dotSeen = true;
          if (notice === 'backup') markAutoBackupErrorSeen();
        }}
        title={
          notice === 'update' ? t('settings.updateFound', { version: updateVersion })
            : notice === 'backup' ? t('settings.autoBackupFailedDot')
              : t('nav.settings')
        }
        className="relative"
      >
        <Settings size={FOOTER_ICON} />
        {notice && (
          <span
            aria-hidden
            className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: notice === 'update' ? 'var(--accent)' : 'var(--danger-text)' }}
          />
        )}
      </RailButton>
      {FOOTER_VIEWS.map((type) => {
        const { icon: Icon, navLabelKey } = AUX_VIEWS[type];
        return (
          <RailButton key={type} active={activeViewType === type} onClick={() => setActiveView({ type })} title={t(navLabelKey)}>
            <Icon size={FOOTER_ICON} />
          </RailButton>
        );
      })}
      <RailButton onClick={() => setVaultOpen(true)} title={t('nav.vaults')} className="ml-auto">
        {/* 1px less only for the emoji: it carries no stroke width and otherwise
            looks too large next to the lucide icons. The fallback glyph is
            itself a lucide icon and stays at the size of its neighbours. */}
        <VaultGlyph icon={activeVaultIcon} size={activeVaultIcon ? FOOTER_ICON - 1 : FOOTER_ICON} />
      </RailButton>

      {vaultOpen && <VaultModal onClose={() => setVaultOpen(false)} />}
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
