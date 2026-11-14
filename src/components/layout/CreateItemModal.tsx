import { useEffect, useRef, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { createEntryIn, createItem } from '../../lib/createItem';
import { dashboardLabel } from '../../lib/dashboards';
import { CREATABLE_VIEWS, DEFAULT_DASHBOARD_ICON, dashboardIcon } from '../../lib/modules';
import { useDashboardStore } from '../../store/dashboardStore';
import { createDashboardAndOpen } from '../../store/dashboardActions';
import { FaviconGlyph } from '../sidebar/fields/Favicon';
import Modal from '../ui/Modal';
import type { Dashboard } from '../../types';

interface Tile {
  key: string;
  label: string;
  icon: ReactNode;
  create: () => Promise<void>;
}

/** A dashboard's glyph on its tile: its own icon, else the built-in's rail icon. */
function tileIcon(d: Dashboard): ReactNode {
  if (d.icon) return <FaviconGlyph value={d.icon} className="w-4 h-4 text-sm" />;
  const Icon = dashboardIcon(d);
  return <Icon size={16} />;
}

/** Tiles per row, for the arrow keys; keep in step with `grid-cols-4` below. */
const COLUMNS = 4;

const KEY_STEPS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -COLUMNS,
  ArrowDown: COLUMNS,
};

/**
 * What the rail's plus opens: one tile per thing that can be created — first
 * an entry in each dashboard, in rail order (in its first category), "All
 * entries" (without one), then tasks, the libraries and a new dashboard.
 */
export default function CreateItemModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const dashboards = useDashboardStore((s) => s.dashboards);
  const ordered = [...dashboards.filter((d) => d.builtin !== 'all'), ...dashboards.filter((d) => d.builtin === 'all')];
  const tiles: Tile[] = [
    ...ordered.map((d) => ({ key: `dashboard:${d.id}`, label: dashboardLabel(t, d), icon: tileIcon(d), create: () => createEntryIn(d.id) })),
    ...CREATABLE_VIEWS.map(({ id, icon: Icon, navLabelKey }) => ({ key: id, label: t(navLabelKey), icon: <Icon size={16} />, create: () => createItem(id) })),
    { key: 'new-dashboard', label: t('dashboards.dashboard'), icon: <DEFAULT_DASHBOARD_ICON size={16} />, create: createDashboardAndOpen },
  ];
  const tilesRef = useRef(tiles);
  tilesRef.current = tiles;

  // A press on the header or the padding takes the focus to nowhere, and with it
  // the ring and the keys: it goes back to the tile. After the event, since the
  // browser only then settles where the focus lands.
  const keepFocus = (e: FocusEvent<HTMLButtonElement>) => {
    const tile = e.currentTarget;
    setTimeout(() => {
      if (document.activeElement === document.body) tile.focus();
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    // Tab wraps as well: `Modal` holds no focus, and the page behind it is out of reach anyway.
    const step = e.key === 'Tab' ? (e.shiftKey ? -1 : 1) : KEY_STEPS[e.key];
    if (!step) return;
    e.preventDefault();
    const count = tiles.length;
    tileRefs.current[(index + step + count) % count]?.focus();
  };

  // The modal goes first: leaving an open edit may ask its own question.
  const choose = (tile: Tile) => {
    onClose();
    tile.create().catch((err: unknown) => console.error('[CreateItemModal] creating failed:', err));
  };

  // On the window, not the tiles: a number works wherever the focus has gone.
  useEffect(() => {
    const onNumber = (e: globalThis.KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      // By the physical key first: on AZERTY the unshifted "1" key gives `&`.
      const number = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)?.[1] ?? e.key;
      if (!/^[1-9]$/.test(number)) return;
      const tile = tilesRef.current[Number(number) - 1];
      if (!tile) return;
      e.preventDefault();
      choose(tile);
    };
    window.addEventListener('keydown', onNumber);
    return () => window.removeEventListener('keydown', onNumber);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `choose` only closes and creates
  }, []);

  return (
    <Modal title={t('createItem.title')} onClose={onClose} widthClassName="w-[440px] max-w-full">
      <div className="modal-body grid grid-cols-4 gap-2">
        {tiles.map((tile, index) => (
          <button
            key={tile.key}
            ref={(el) => { tileRefs.current[index] = el; }}
            type="button"
            // Enter on the open modal gives the first dashboard — by default a journal entry.
            autoFocus={index === 0}
            onClick={() => choose(tile)}
            onKeyDown={(e) => onKeyDown(e, index)}
            onBlur={keepFocus}
            aria-keyshortcuts={index < 9 ? String(index + 1) : undefined}
            className="panel-interactive create-item-tile"
          >
            {index < 9 && <span aria-hidden className="create-item-tile-number">{index + 1}</span>}
            {tile.icon}
            <span className="min-w-0 max-w-full truncate">{tile.label}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
