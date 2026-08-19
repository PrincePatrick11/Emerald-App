import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Menu } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../../store/uiStore';
import { useOperationStore } from '../../../store/operationStore';
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
 * `compact` folds all four into a single button holding them as submenus.
 * `TitleBar` decides when, from the room actually left over — the bar never
 * shrinks to make space for the search field, only to stop it disappearing.
 */
export default function TitleBarMenuBar({ compact }: { compact: boolean }) {
  const { t } = useTranslation();
  const activeView = useUIStore((s) => s.activeView);
  const operations = useOperationStore((s) => s.operations);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  // Only a keyboard-opened menu pulls focus into its panel. Opening by mouse
  // must leave focus where it was, or Cut/Copy lose the editor's selection.
  const [focusPanelOnOpen, setFocusPanelOnOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openMenu === null) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenMenu(null); };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenu]);

  const enabled = computeMenuEnabledState(activeView, operations);
  const close = () => setOpenMenu(null);

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
        { kind: 'item', label: t('menu.resetView'), onSelect: () => dispatchMenuAction('reset-sidebar-widths') },
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

  // Collapsed, the same four menus become submenus of one button, so every
  // item stays reachable and `menuActions` still has a single definition.
  const bar: Array<{ id: string; label: ReactNode; title?: string; nodes: MenuNode[] }> = compact
    ? [{
        id: 'all',
        label: <Menu size={15} />,
        title: t('titlebar.menu'),
        nodes: menus.map((menu) => ({ kind: 'submenu', label: menu.label, children: menu.nodes })),
      }]
    : menus;

  /** Left/Right walk the bar, opening as they go once a menu is already open. */
  const onBarKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const triggers = [...(barRef.current?.querySelectorAll<HTMLButtonElement>('.titlebar-menu-trigger') ?? [])];
    const current = triggers.indexOf(document.activeElement as HTMLButtonElement);
    if (current === -1) return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' ? 1 : -1;
    const next = (current + step + triggers.length) % triggers.length;
    triggers[next].focus();
    if (openMenu !== null) setOpenMenu(bar[next].id);
  };

  return (
    <div ref={barRef} onKeyDown={onBarKeyDown} className="flex items-center h-full flex-shrink-0" role="menubar">
      {bar.map((menu) => (
        <div key={menu.id} className="relative h-full flex items-center">
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={openMenu === menu.id}
            data-open={openMenu === menu.id || undefined}
            className="titlebar-menu-trigger"
            title={menu.title}
            aria-label={menu.title}
            // Cancelling mousedown keeps the editor's selection alive, so the
            // Edit menu's Cut and Copy still have something to act on.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setFocusPanelOnOpen(false); setOpenMenu(openMenu === menu.id ? null : menu.id); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setFocusPanelOnOpen(true); setOpenMenu(menu.id); }
            }}
            // Once a menu is open, hovering a sibling switches to it — the
            // standard menu-bar behaviour.
            onMouseEnter={() => { if (openMenu !== null) setOpenMenu(menu.id); }}
          >
            {menu.label}
          </button>
          {openMenu === menu.id && (
            <MenuDropdown
              nodes={menu.nodes}
              positionClass="top-full left-0 mt-px"
              onClose={close}
              autoFocus={focusPanelOnOpen}
            />
          )}
        </div>
      ))}
    </div>
  );
}
