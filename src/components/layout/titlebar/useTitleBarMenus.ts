import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../../store/uiStore';
import { computeMenuEnabledState, dispatchMenuAction } from '../../../lib/menuActions';
import { cutSelection, copySelection, pasteFromClipboard, selectAll } from './editCommands';
import type { MenuNode } from './MenuDropdown';

export interface TitleBarMenu {
  label: string;
  nodes: MenuNode[];
}

/**
 * The application menu's content for Windows and Linux, where the title bar
 * renders it in HTML.
 *
 * macOS never renders this — there the native menu sits in the system menu
 * bar (`install_native_menu` in `src-tauri/src/lib.rs`), and that is the only
 * platform where the native menu is installed at all: an in-window HMENU or
 * GTK menubar would otherwise sit alongside this one.
 *
 * The items mirror the native menu exactly, down to which items are
 * disabled — both sides read that from `computeMenuEnabledState`.
 *
 * Nur der Inhalt: wo die vier Menüs stehen, entscheidet `TitleBar` —
 * Bearbeiten und Ansicht hinter dem Knopf mit drei Strichen, Export und
 * Import als eigene Knöpfe hinter den Pfeilen.
 */
export function useTitleBarMenus() {
  const { t } = useTranslation();
  const activeView = useUIStore((s) => s.activeView);
  const railOpen = useUIStore((s) => s.railOpen);
  const leftListOpen = useUIStore((s) => s.leftListOpen);
  const rightSidebarOpen = useUIStore((s) => s.rightSidebarOpen);
  const viewLocked = useUIStore((s) => s.viewLocked);
  const enabled = computeMenuEnabledState(activeView);

  const edit: TitleBarMenu = {
    label: t('menu.edit'),
    nodes: [
      { kind: 'item', label: t('menu.cut'), onSelect: cutSelection },
      { kind: 'item', label: t('menu.copy'), onSelect: copySelection },
      { kind: 'item', label: t('menu.paste'), onSelect: () => { void pasteFromClipboard(); } },
      { kind: 'separator' },
      { kind: 'item', label: t('menu.selectAll'), onSelect: selectAll },
    ],
  };
  const view: TitleBarMenu = {
    label: t('menu.view'),
    nodes: [
      { kind: 'item', label: t('menu.rail'), checked: railOpen, onSelect: () => dispatchMenuAction('toggle-rail') },
      { kind: 'item', label: t('menu.entryList'), checked: leftListOpen, onSelect: () => dispatchMenuAction('toggle-left-list') },
      { kind: 'item', label: t('menu.properties'), checked: rightSidebarOpen, onSelect: () => dispatchMenuAction('toggle-right-sidebar') },
      { kind: 'separator' },
      { kind: 'item', label: t('menu.resetView'), onSelect: () => dispatchMenuAction('reset-sidebar-widths') },
      { kind: 'item', label: t('menu.lockView'), checked: viewLocked, onSelect: () => dispatchMenuAction('toggle-view-lock') },
      { kind: 'item', label: t('menu.showSplash'), onSelect: () => dispatchMenuAction('show-splash') },
    ],
  };
  const exportMenu: TitleBarMenu = {
    label: t('menu.export'),
    nodes: [
      { kind: 'item', label: t('menu.exportPdf'), disabled: !enabled.pdfEnabled, onSelect: () => dispatchMenuAction('export-pdf') },
      { kind: 'item', label: t('menu.exportMarkdown'), disabled: !enabled.entryEnabled, onSelect: () => dispatchMenuAction('export-markdown') },
      { kind: 'item', label: t('menu.exportEmerald'), disabled: !enabled.emeraldEnabled, onSelect: () => dispatchMenuAction('export-emerald') },
      { kind: 'separator' },
      {
        kind: 'submenu',
        label: t('menu.exportAltarImage'),
        disabled: !enabled.altarImageEnabled,
        children: [
          { kind: 'item', label: t('menu.exportAltarJpeg'), onSelect: () => dispatchMenuAction('export-altar-jpeg') },
          { kind: 'item', label: t('menu.exportAltarPng'), onSelect: () => dispatchMenuAction('export-altar-png') },
          { kind: 'item', label: t('menu.exportAltarWebp'), onSelect: () => dispatchMenuAction('export-altar-webp') },
        ],
      },
    ],
  };
  const importMenu: TitleBarMenu = {
    label: t('menu.import'),
    nodes: [
      { kind: 'item', label: t('menu.importMarkdown'), onSelect: () => dispatchMenuAction('import-markdown') },
      { kind: 'item', label: t('menu.importEmerald'), onSelect: () => dispatchMenuAction('import-emerald') },
    ],
  };

  // Bearbeiten und Ansicht als Untermenüs des Knopfs mit drei Strichen.
  const appMenu: MenuNode[] = [edit, view].map((menu) => ({ kind: 'submenu', label: menu.label, children: menu.nodes }));

  return { appMenu, exportMenu, importMenu };
}
