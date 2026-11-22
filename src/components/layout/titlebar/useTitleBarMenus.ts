import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../../store/uiStore';
import { dispatchMenuAction } from '../../../lib/menuActions';
import { cutSelection, copySelection, pasteFromClipboard, selectAll } from './editCommands';
import type { MenuNode } from './MenuDropdown';

interface TitleBarMenu {
  label: string;
  nodes: MenuNode[];
}

/**
 * The content of the title bar's menus.
 *
 * On macOS, Edit and View are in the system menu bar instead
 * (`install_native_menu` in `src-tauri/src/lib.rs`, the only platform with a
 * native menu); Import is in the title bar everywhere. Export is no menu: its
 * button opens the export menu (`ExportMenuModal`).
 *
 * Content only: where the menus sit is decided by `TitleBar` —
 * Edit and View behind the three-line button, Import as a
 * button of its own behind the arrows.
 */
export function useTitleBarMenus() {
  const { t } = useTranslation();
  const railOpen = useUIStore((s) => s.railOpen);
  const leftListOpen = useUIStore((s) => s.leftListOpen);
  const rightSidebarOpen = useUIStore((s) => s.rightSidebarOpen);
  const viewLocked = useUIStore((s) => s.viewLocked);

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

  return { appMenu, importMenu };
}
