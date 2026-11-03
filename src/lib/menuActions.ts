import { emit } from '@tauri-apps/api/event';
import { useUIStore } from '../store/uiStore';
import { hasActiveVault, useVaultStore } from '../store/vaultStore';
import { openVaultPicker, useVaultPickerStore } from '../store/vaultPickerStore';
import { showSplash } from './splash';
import type { ActiveView } from '../types';

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
  | 'toggle-rail'
  | 'toggle-left-list'
  | 'toggle-right-sidebar'
  | 'toggle-view-lock'
  | 'show-splash'
  | 'switch-vault'
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
  'toggle-rail': true,
  'toggle-left-list': true,
  'toggle-right-sidebar': true,
  'toggle-view-lock': true,
  'show-splash': true,
  'switch-vault': true,
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
  // These four need no vault and therefore come before the guard
  // below. They even have to: muda, Tauri's menu crate, flips the checkmark
  // of a native check item itself before it sends the event — returning
  // early would leave a checkmark on macOS with no state behind it,
  // which the sync effect in `AppShell`, keyed on exactly that state,
  // would never correct.
  switch (id) {
    case 'toggle-rail':
      useUIStore.getState().toggleRail();
      return;
    case 'toggle-left-list':
      useUIStore.getState().toggleLeftList();
      return;
    case 'toggle-right-sidebar':
      useUIStore.getState().toggleRightSidebar();
      return;
    case 'toggle-view-lock':
      useUIStore.getState().toggleViewLock();
      return;
    // Shows the loading screen once more, until somewhere is clicked.
    // Sits up here with the toggles because, like them, it needs no
    // vault — it should be viewable in the vault picker too,
    // which is the moment when one is most likely to look for it.
    case 'show-splash':
      showSplash();
      return;
    // Emerald → "Switch vault…". With no vault open the picker is up already.
    case 'switch-vault':
      void openVaultPicker();
      return;
  }

  // In the vault picker without a vault there is no database, but the macOS
  // menu bar is still there (the HTML menu is not drawn over the picker).
  // Without this guard, "Export" would run into a raw NO_ACTIVE_VAULT dialog,
  // and "Import Markdown" would wait for a target modal that is not even
  // mounted then: the promise would never resolve and would pop up as soon as
  // the first vault was ready.
  //
  // The same holds while the picker is up over an open vault: no view of the
  // vault is there to act on.
  if (!hasActiveVault(useVaultStore.getState()) || useVaultPickerStore.getState().open) return;

  // The export/import modules (including turndown and marked) are only loaded on the
  // first menu call — otherwise they would hang on the startup path via AppShell.
  switch (id) {
    case 'export-pdf': {
      const { exportAsPDF, noEntryMessage, exportErrorMessage } = await import('./export');
      const view = useUIStore.getState().activeView;
      const isAltarReadingView = view.type === 'altar' && !!view.id && view.mode !== 'edit';
      if (isAltarReadingView) {
        const { saveAltarPDF } = await import('./altarExport');
        saveAltarPDF().catch((err) => exportErrorMessage(err, 'PDF export'));
        return;
      }
      const { collectExportData } = await import('./exportData');
      const data = await collectExportData();
      if (!data) { noEntryMessage(); return; }
      exportAsPDF(data).catch((err) => exportErrorMessage(err, 'PDF export'));
      return;
    }
    case 'export-markdown': {
      const { exportAsMarkdown, noEntryMessage, exportErrorMessage } = await import('./export');
      const { collectExportData } = await import('./exportData');
      const data = await collectExportData();
      if (!data) { noEntryMessage(); return; }
      exportAsMarkdown(data).catch((err) => exportErrorMessage(err, 'Markdown export'));
      return;
    }
    case 'export-emerald': {
      const { exportErrorMessage } = await import('./export');
      const { exportAsEmerald } = await import('./emeraldFormat');
      exportAsEmerald().catch((err) => exportErrorMessage(err, 'Emerald export'));
      return;
    }
    case 'export-altar-jpeg':
    case 'export-altar-png':
    case 'export-altar-webp': {
      const { exportErrorMessage } = await import('./export');
      const { saveAltarImage } = await import('./altarExport');
      const format = id.slice('export-altar-'.length) as 'jpeg' | 'png' | 'webp';
      saveAltarImage(format).catch((err) => exportErrorMessage(err, 'Image export'));
      return;
    }
    case 'import-markdown': {
      const { exportErrorMessage } = await import('./export');
      const { importFromMarkdown } = await import('./emeraldFormat');
      importFromMarkdown().catch((err) => exportErrorMessage(err, 'Markdown import'));
      return;
    }
    case 'import-emerald': {
      const { exportErrorMessage } = await import('./export');
      const { importFromEmerald } = await import('./emeraldFormat');
      importFromEmerald().catch((err) => exportErrorMessage(err, 'Emerald import'));
      return;
    }
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
  /** Markdown export — journal / wiki / operation entries. */
  entryEnabled: boolean;
  /** PDF export — entries, plus an Altar's reading view (exports the rendered altar). */
  pdfEnabled: boolean;
  /** Emerald export — like PDF, plus an open template page. */
  emeraldEnabled: boolean;
  /** "Export as Image" (JPEG/PNG/WebP) — Altar reading view only. */
  altarImageEnabled: boolean;
}

/**
 * Decides which export menu items are available for the current view. Pure so
 * that the HTML menu bar can call it during render.
 *
 * A concealed sigil needs no exception here: the export leaves its calculator
 * and drawing out on its own (`renderBlocksForExport`, `withoutConcealed`).
 */
export function computeMenuEnabledState(activeView: ActiveView): MenuEnabledState {
  const isEntryView =
    (activeView.type === 'journal' ||
     activeView.type === 'wiki' ||
     activeView.type === 'operations') &&
    !!activeView.id;
  const isAltarReadingView =
    activeView.type === 'altar' && !!activeView.id && activeView.mode !== 'edit';
  const isTemplatePage = activeView.type === 'templates' && !!activeView.id;

  return {
    entryEnabled: isEntryView,
    pdfEnabled: isEntryView || isAltarReadingView,
    emeraldEnabled: isEntryView || isAltarReadingView || isTemplatePage,
    altarImageEnabled: isAltarReadingView,
  };
}
