import { emit } from '@tauri-apps/api/event';
import { exportAsPDF, exportAsMarkdown, noEntryMessage, exportErrorMessage } from './export';
import { collectExportData } from './exportData';
import { exportAsEmerald, importFromEmerald, importFromMarkdown } from './emeraldFormat';
import { saveAltarImage, saveAltarPDF } from './altarExport';
import { useUIStore } from '../store/uiStore';
import { hasActiveVault, useVaultStore } from '../store/vaultStore';
import type { ActiveView, Operation } from '../types';

/**
 * The application menu's actions, shared by the two menus that can trigger
 * them: the native macOS menu (built in `src-tauri/src/lib.rs`, which emits
 * these ids as Tauri events, picked up by `AppShell`) and the HTML menu bar
 * in the title bar on Windows and Linux, which calls `runMenuAction` directly.
 *
 * The ids are the same strings on both paths — keep them in sync with
 * `install_native_menu` in `src-tauri/src/lib.rs`.
 */
export type MenuActionId =
  | 'reset-sidebar-widths'
  | 'toggle-left-list'
  | 'toggle-right-sidebar'
  | 'export-pdf'
  | 'export-markdown'
  | 'export-emerald'
  | 'export-altar-jpeg'
  | 'export-altar-png'
  | 'export-altar-webp'
  | 'import-markdown'
  | 'import-emerald';

/**
 * Actions `runMenuAction` handles on its own. `reset-sidebar-widths` is not
 * among them: it manipulates `AppShell`'s local width state, so it stays an
 * event that `AppShell`'s own listener answers (see `dispatchMenuAction`).
 */
export type SelfContainedMenuActionId = Exclude<MenuActionId, 'reset-sidebar-widths'>;

// Keyed rather than a plain array so that adding a `MenuActionId` without
// listing it here is a compile error, not a menu item that silently stops
// working on macOS.
const SELF_CONTAINED: Record<SelfContainedMenuActionId, true> = {
  'toggle-left-list': true,
  'toggle-right-sidebar': true,
  'export-pdf': true,
  'export-markdown': true,
  'export-emerald': true,
  'export-altar-jpeg': true,
  'export-altar-png': true,
  'export-altar-webp': true,
  'import-markdown': true,
  'import-emerald': true,
};

export const SELF_CONTAINED_MENU_ACTIONS = Object.keys(SELF_CONTAINED) as SelfContainedMenuActionId[];

/** Runs a menu action. Errors surface as native dialogs, matching the previous behaviour. */
export async function runMenuAction(id: SelfContainedMenuActionId): Promise<void> {
  // Diese beiden brauchen keinen Vault und stehen deshalb vor der Sperre
  // unten. Sie muessen es sogar: muda, Tauris Menue-Crate, kippt das Haekchen
  // eines nativen Check-Eintrags selbst, bevor es das Event schickt — ein
  // frueher Rueckkehren liesse auf macOS ein Haekchen ohne Zustand dahinter
  // stehen, das der auf genau diesen Zustand gekeyte Sync-Effekt in
  // `AppShell` nie korrigieren wuerde.
  switch (id) {
    case 'toggle-left-list':
      useUIStore.getState().toggleLeftList();
      return;
    case 'toggle-right-sidebar':
      useUIStore.getState().toggleRightSidebar();
      return;
  }

  // Waehrend der Vault-Einrichtung gibt es keine Datenbank, aber die Menuleiste
  // steht — sie sitzt in der Titelleiste, und die bleibt sichtbar, damit sich
  // das Fenster bedienen laesst. Ohne diese Sperre liefe „Exportieren" in einen
  // rohen NO_ACTIVE_VAULT-Dialog, und „Markdown importieren" wartete auf ein
  // Ziel-Modal, das im Setup gar nicht gemountet ist: das Versprechen loeste
  // sich nie auf und poppte auf, sobald der erste Vault fertig war.
  if (!hasActiveVault(useVaultStore.getState())) return;

  switch (id) {
    case 'export-pdf': {
      const view = useUIStore.getState().activeView;
      const isAltarReadingView = view.type === 'altar' && !!view.id && view.mode !== 'edit';
      if (isAltarReadingView) {
        saveAltarPDF().catch((err) => exportErrorMessage(err, 'PDF export'));
        return;
      }
      const data = await collectExportData();
      if (!data) { noEntryMessage(); return; }
      exportAsPDF(data).catch((err) => exportErrorMessage(err, 'PDF export'));
      return;
    }
    case 'export-markdown': {
      const data = await collectExportData();
      if (!data) { noEntryMessage(); return; }
      exportAsMarkdown(data).catch((err) => exportErrorMessage(err, 'Markdown export'));
      return;
    }
    case 'export-emerald':
      exportAsEmerald().catch((err) => exportErrorMessage(err, 'Emerald export'));
      return;
    case 'export-altar-jpeg':
      saveAltarImage('jpeg').catch((err) => exportErrorMessage(err, 'Image export'));
      return;
    case 'export-altar-png':
      saveAltarImage('png').catch((err) => exportErrorMessage(err, 'Image export'));
      return;
    case 'export-altar-webp':
      saveAltarImage('webp').catch((err) => exportErrorMessage(err, 'Image export'));
      return;
    case 'import-markdown':
      importFromMarkdown().catch((err) => exportErrorMessage(err, 'Markdown import'));
      return;
    case 'import-emerald':
      importFromEmerald().catch((err) => exportErrorMessage(err, 'Emerald import'));
      return;
    default: {
      // Compile error if a SelfContainedMenuActionId is left unhandled.
      const unhandled: never = id;
      throw new Error(`Unhandled menu action: ${String(unhandled)}`);
    }
  }
}

/**
 * Fires a menu action from the HTML menu bar. `reset-sidebar-widths` is
 * re-emitted as a Tauri event so `AppShell`'s existing listener handles it,
 * exactly as it does for the native macOS menu — one handler, both platforms.
 */
export function dispatchMenuAction(id: MenuActionId): void {
  if (id === 'reset-sidebar-widths') {
    emit('reset-sidebar-widths').catch(() => {/* desktop-only, ignore in browser preview */});
    return;
  }
  void runMenuAction(id);
}

export interface MenuEnabledState {
  /** Markdown export — journal / wiki / non-sigil operation entries only. */
  entryEnabled: boolean;
  /** PDF export — entries, plus an Altar's reading view (exports the rendered altar). */
  pdfEnabled: boolean;
  /** Emerald export — same availability as PDF. */
  emeraldEnabled: boolean;
  /** "Export as Image" (JPEG/PNG/WebP) — Altar reading view only. */
  altarImageEnabled: boolean;
}

/**
 * Decides which export menu items are available for the current view. Pure so
 * that the HTML menu bar can call it during render off a subscribed
 * `operations` list rather than reading the store outside React.
 *
 * Sigil operations are excluded: that category has its own view
 * (`OperationSigilView`) and export isn't wired up for it, so its menu items
 * stay disabled rather than offering a broken action.
 */
export function computeMenuEnabledState(activeView: ActiveView, operations: Operation[]): MenuEnabledState {
  const isSigilOperation =
    activeView.type === 'operations' && !!activeView.id &&
    operations.find((o) => o.id === activeView.id)?.category_id === 'sigils';
  const isEntryView =
    (activeView.type === 'journal' ||
     activeView.type === 'wiki' ||
     (activeView.type === 'operations' && !isSigilOperation)) &&
    !!activeView.id;
  const isAltarReadingView =
    activeView.type === 'altar' && !!activeView.id && activeView.mode !== 'edit';

  return {
    entryEnabled: isEntryView,
    pdfEnabled: isEntryView || isAltarReadingView,
    emeraldEnabled: isEntryView || isAltarReadingView,
    altarImageEnabled: isAltarReadingView,
  };
}
