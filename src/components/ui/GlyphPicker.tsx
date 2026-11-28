import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useOutsideClick } from '../../hooks/useOutsideClick';
import SearchField from './SearchField';

// Every picker prefers this many cells per row, shrinking down to MIN_COLUMNS when the
// viewport is too narrow, regardless of trigger width or cell count.
const COLUMNS = 5;
const MIN_COLUMNS = 3;

/** Gap between trigger and popover. */
const ANCHOR_GAP = 4;
/** Minimum distance to the window edge so the popover does not stick to it. */
const VIEWPORT_MARGIN = 12;

/** Fixed-position coordinates for the portalled popover. */
type Placement = { left?: number; right?: number; top?: number; bottom?: number };

/** One choice of the grid. */
export interface GlyphCell {
  key: string;
  content: ReactNode;
  active: boolean;
  onPick: () => void;
  /** Tooltip and accessible name — for a glyph that does not speak for itself. */
  label?: string;
}

export interface GlyphPickerProps {
  /** The cells for a search (`''` before one); `null` while the search is still loading. */
  cells: (query: string) => GlyphCell[] | null;
  /** Told whenever the popover opens or closes — for data only an open picker needs. */
  onOpenChange?: (open: boolean) => void;
  searchPlaceholder: string;
  emptyText: string;
  /** Renders the trigger button; receives the current open state and a toggle handler. */
  trigger: (args: { open: boolean; toggle: () => void }) => ReactNode;
  /** Popover horizontal anchor edge, relative to the trigger. */
  align?: 'left' | 'right';
  /** Cell size and the glyph size of the cells' text. */
  size?: 'sm' | 'lg';
  /** Classes for the wrapper div. Layout only — the popover is portalled out. */
  wrapperClassName?: string;
}

/**
 * The popover behind `EmojiPicker` and `DashboardSymbolPicker`: open state, outside
 * click and Escape in the capture phase, a search above a grid of cells, the
 * chosen cell in jade. The pickers only bring their cells. The `emoji-picker-*`
 * classes are the emoji picker's by history and style every cell alike.
 */
export default function GlyphPicker({
  cells,
  onOpenChange,
  searchPlaceholder,
  emptyText,
  trigger,
  align = 'left',
  size = 'sm',
  wrapperClassName = 'relative flex-shrink-0',
}: GlyphPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  useEffect(() => {
    if (!open) setQuery('');
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  // popoverRef as well: the popover hangs in the portal and is no longer a descendant
  // of the trigger. `escape: 'capture'` so that Escape closes only the picker
  // and not the surrounding modal (whose bubble handler would otherwise win).
  useOutsideClick(open, () => setOpen(false), { refs: [ref, popoverRef], escape: 'capture' });

  /**
   * Anchors the portalled popover to the trigger, in viewport coordinates.
   *
   * Flips above the trigger when there is more room there — the only direction
   * left once the popover no longer has a scroll container to grow into.
   */
  const place = useCallback(() => {
    const anchor = ref.current?.getBoundingClientRect();
    if (!anchor) return;
    const box = popoverRef.current;
    const height = box?.offsetHeight ?? 0;
    const width = box?.offsetWidth ?? 0;

    const spaceBelow = window.innerHeight - anchor.bottom - VIEWPORT_MARGIN;
    const spaceAbove = anchor.top - VIEWPORT_MARGIN;
    const flip = height > spaceBelow && spaceAbove > spaceBelow;

    const vertical: Placement = flip
      ? { bottom: window.innerHeight - anchor.top + ANCHOR_GAP }
      : { top: anchor.bottom + ANCHOR_GAP };

    // Shift back at the window edge instead of sticking half out.
    const clamp = (value: number) =>
      width > 0
        ? Math.min(Math.max(VIEWPORT_MARGIN, value), Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN))
        : Math.max(VIEWPORT_MARGIN, value);

    setPlacement(
      align === 'right'
        ? { ...vertical, right: clamp(window.innerWidth - anchor.right) }
        : { ...vertical, left: clamp(anchor.left) }
    );
  }, [align]);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    // Runs before paint, so the popover is already measurable in the DOM and
    // is never visible in the wrong place.
    place();
    window.addEventListener('resize', place);
    // capture, so that scrolling of any ancestor arrives too.
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  const textSizeClass = size === 'lg' ? 'text-xl' : 'text-base';
  const cell = size === 'lg' ? '2.25rem' : '1.75rem';
  const gap = '0.25rem';
  // Sized on the grid itself (not the padded/bordered popover box) so the column math is exact —
  // computing this against the outer box's border-box width previously rounded-md 5 columns down to 4.
  const colsWidth = (n: number) => `calc(${cell} * ${n} + ${gap} * ${n - 1})`;
  // Space reserved on the right for the macOS overlay scrollbar. The scroll container (and the
  // search input) remain at colsWidth(COLUMNS); the grid is narrowed by this amount so the
  // overlay scrollbar appears in the gap between the grid's right edge and the container's right
  // edge instead of on top of the last column.
  const SCROLLBAR_GUTTER = '0.5rem';
  // Applied to the search input — sets the popover width via flex-col's stretch behaviour.
  const sizeStyle = {
    width: colsWidth(COLUMNS),
    minWidth: colsWidth(MIN_COLUMNS),
    maxWidth: 'calc(100vw - 3rem)',
  };
  // Grid is slightly narrower so the scrollbar has room to the right without overlapping cells.
  // repeat(COLUMNS, minmax(0, 1fr)) forces exactly COLUMNS equal columns at any container width.
  const gridStyle = {
    width: `calc(${colsWidth(COLUMNS)} - ${SCROLLBAR_GUTTER})`,
    minWidth: `calc(${colsWidth(MIN_COLUMNS)} - ${SCROLLBAR_GUTTER})`,
    maxWidth: `calc(100vw - 3rem - ${SCROLLBAR_GUTTER})`,
    gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))`,
  };

  const shown = cells(query.trim().toLowerCase());

  return (
    <div ref={ref} className={wrapperClassName}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {/* In a portal instead of in the trigger: otherwise the first ancestor with
          `overflow` clips the popover, in the vault picker for example its scrolling list,
          in which there is not even anything to scroll. Positioning is done
          by itself, in viewport coordinates (see `place`), and `z-[9999]`
          is the level that ContextMenu and MenuDropdown use for overlays above
          a modal (z-50). */}
      {open && createPortal(
        <div
          ref={popoverRef}
          className="emoji-picker-popover fixed z-[9999] border rounded-lg shadow-menu p-2 flex flex-col gap-2"
          style={{ ...placement, visibility: placement ? 'visible' : 'hidden' }}
        >
          <SearchField
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            style={sizeStyle}
          />
          {/* overflow-x-hidden prevents a horizontal scrollbar on macOS when
              space-taking (non-overlay) scrollbars are in use. The grid is
              intentionally narrower than the container (gridStyle vs sizeStyle)
              so the overlay scrollbar has room at the right without covering the
              last column. */}
          <div className="max-h-56 overflow-y-auto overflow-x-hidden">
            <div className="grid gap-1" style={gridStyle}>
              {shown === null ? null : shown.length === 0 ? (
                <p className="col-span-full py-2 text-center text-xs text-muted">{emptyText}</p>
              ) : (
                shown.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => { c.onPick(); setOpen(false); }}
                    title={c.label}
                    aria-label={c.label}
                    className={`emoji-picker-item ${textSizeClass} aspect-square flex items-center justify-center rounded-md transition-colors ${c.active ? 'emoji-picker-item-active' : 'emoji-picker-item-idle'}`}
                  >
                    {c.content}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
