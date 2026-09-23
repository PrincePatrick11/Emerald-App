import { useRef, useState } from 'react';
import { useOutsideClick } from '../../../hooks/useOutsideClick';
import { Menu } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../../store/uiStore';
import { computeMenuEnabledState, dispatchMenuAction } from '../../../lib/menuActions';
import { cutSelection, copySelection, pasteFromClipboard, selectAll } from './editCommands';
import MenuDropdown, { type MenuNode } from './MenuDropdown';

/**
 * The application menu, rendered in HTML for Windows and Linux.
 *
 * macOS never renders this — there the native menu sits in the system menu
 * bar (`install_native_menu` in `src-tauri/src/lib.rs`), and that is the only
 * platform where the native menu is installed at all: an in-window HMENU or
 * GTK menubar would otherwise sit alongside this one.
 *
 * The structure mirrors the native menu exactly, down to which items are
 * disabled — both sides read that from `computeMenuEnabledState`.
 *
 * Die vier Menüs stehen nicht als Leiste nebeneinander, sondern als
 * Untermenüs hinter einem einzigen Knopf mit drei Strichen.
 */
export default function TitleBarMenuBar() {
  const { t } = useTranslation();
  const activeView = useUIStore((s) => s.activeView);
  const railOpen = useUIStore((s) => s.railOpen);
  const leftListOpen = useUIStore((s) => s.leftListOpen);
  const rightSidebarOpen = useUIStore((s) => s.rightSidebarOpen);
  const [open, setOpen] = useState(false);
  // Only a keyboard-opened menu pulls focus into its panel. Opening by mouse
  // must leave focus where it was, or Cut/Copy lose the editor's selection.
  const [focusPanelOnOpen, setFocusPanelOnOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useOutsideClick(open, () => setOpen(false), { refs: [rootRef], escape: true });

  const enabled = computeMenuEnabledState(activeView);
  const close = () => setOpen(false);

  const menus: Array<{ id: string; label: string; nodes: MenuNode[] }> = [
    {
      id: 'edit',
      label: t('menu.edit'),
      nodes: [
        { kind: 'item', label: t('menu.cut'), onSelect: cutSelection },
        { kind: 'item', label: t('menu.copy'), onSelect: copySelection },
        { kind: 'item', label: t('menu.paste'), onSelect: () => { void pasteFromClipboard(); } },
        { kind: 'separator' },
        { kind: 'item', label: t('menu.selectAll'), onSelect: selectAll },
      ],
    },
    {
      id: 'view',
      label: t('menu.view'),
      nodes: [
        { kind: 'item', label: t('menu.rail'), checked: railOpen, onSelect: () => dispatchMenuAction('toggle-rail') },
        { kind: 'item', label: t('menu.entryList'), checked: leftListOpen, onSelect: () => dispatchMenuAction('toggle-left-list') },
        { kind: 'item', label: t('menu.properties'), checked: rightSidebarOpen, onSelect: () => dispatchMenuAction('toggle-right-sidebar') },
        { kind: 'separator' },
        { kind: 'item', label: t('menu.resetView'), onSelect: () => dispatchMenuAction('reset-sidebar-widths') },
        { kind: 'item', label: t('menu.showSplash'), onSelect: () => dispatchMenuAction('show-splash') },
      ],
    },
    {
      id: 'export',
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
    },
    {
      id: 'import',
      label: t('menu.import'),
      nodes: [
        { kind: 'item', label: t('menu.importMarkdown'), onSelect: () => dispatchMenuAction('import-markdown') },
        { kind: 'item', label: t('menu.importEmerald'), onSelect: () => dispatchMenuAction('import-emerald') },
      ],
    },
  ];

  const nodes: MenuNode[] = menus.map((menu) => ({ kind: 'submenu', label: menu.label, children: menu.nodes }));

  return (
    <div ref={rootRef} className="relative h-full flex items-center flex-shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        data-open={open || undefined}
        className="titlebar-menu-trigger"
        title={t('titlebar.menu')}
        aria-label={t('titlebar.menu')}
        // Cancelling mousedown keeps the editor's selection alive, so the
        // Edit menu's Cut and Copy still have something to act on.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => { setFocusPanelOnOpen(false); setOpen(!open); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setFocusPanelOnOpen(true); setOpen(true); }
        }}
      >
        <Menu size={15} />
      </button>
      {open && (
        <MenuDropdown
          nodes={nodes}
          positionClass="top-full left-0 mt-px"
          onClose={close}
          autoFocus={focusPanelOnOpen}
        />
      )}
    </div>
  );
}
