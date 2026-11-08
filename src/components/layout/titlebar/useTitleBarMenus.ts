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
 * The content of the title bar's menus.
 *
 * On macOS, Edit and View are in the system menu bar instead
 * (`install_native_menu` in `src-tauri/src/lib.rs`, the only platform with a
 * native menu); Export and Import are in the title bar everywhere.
 *
 * Content only: where the four menus sit is decided by `TitleBar` —
 * Edit and View behind the three-line button, Export and
 * Import as buttons of their own behind the arrows.
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

  // The three-line button is the Emerald menu, as on macOS: Switch Vault…,
  // Check for Updates…, About Emerald App, then Edit and View as submenus.
  const appMenu: MenuNode[] = [
    { kind: 'item', label: t('menu.switchVault'), onSelect: () => dispatchMenuAction('switch-vault') },
    { kind: 'item', label: t('menu.checkUpdates'), onSelect: () => dispatchMenuAction('check-updates') },
    { kind: 'item', label: t('menu.about'), onSelect: () => dispatchMenuAction('show-about') },
    { kind: 'separator' },
    ...[edit, view].map((menu): MenuNode => ({ kind: 'submenu', label: menu.label, children: menu.nodes })),
  ];

  return { appMenu, exportMenu, importMenu };
}
