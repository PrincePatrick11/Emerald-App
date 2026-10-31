import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DEFAULT_EMOJI_PICKER_EMOJIS, searchEmojis } from '../../lib/emojiSearch';
import { useEmojiSearchData } from '../../hooks/useEmojiSearchData';
import { useSettingsStore } from '../../store/settingsStore';
import { useOutsideClick } from '../../hooks/useOutsideClick';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

// Every picker prefers this many emoji per row, shrinking down to MIN_COLUMNS when the
// viewport is too narrow, regardless of trigger width or emoji count.
const COLUMNS = 5;
const MIN_COLUMNS = 3;

/** Gap between trigger and popover. */
const ANCHOR_GAP = 4;
/** Minimum distance to the window edge so the popover does not stick to it. */
const VIEWPORT_MARGIN = 12;

/** Fixed-position coordinates for the portalled popover. */
type Placement = { left?: number; right?: number; top?: number; bottom?: number };

interface EmojiPickerProps {
  value: string;
  onChange: (emoji: string) => void;
  /** Defaults to the vault's emoji set (Settings → Entries) — pass only to offer a narrower selection. */
  emojis?: string[];
  /** Renders the trigger button; receives the current open state and a toggle handler. */
  trigger: (args: { open: boolean; toggle: () => void }) => React.ReactNode;
  /** Popover horizontal anchor edge, relative to the trigger. */
  align?: 'left' | 'right';
  /** Glyph size of the emoji buttons inside the popover. */
  size?: 'sm' | 'lg';
  /** Classes for the wrapper div. Layout only — the popover is portalled out. */
  wrapperClassName?: string;
}

/** Shared emoji-picker popover: manages open state, outside-click/Escape-to-close, search, and themed chrome. */
export default function EmojiPicker({
  value,
  onChange,
  emojis,
  trigger,
  align = 'left',
  size = 'sm',
  wrapperClassName = 'relative flex-shrink-0',
}: EmojiPickerProps) {
  const { t } = useTranslation();
  const vaultEmojis = useSettingsStore((s) => s.settings.emojis.defaults);
  const offered = emojis ?? vaultEmojis ?? DEFAULT_EMOJI_PICKER_EMOJIS;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchData = useEmojiSearchData(open);
  const ref = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

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

  const emojiSizeClass = size === 'lg' ? 'text-xl' : 'text-base';
  const cell = size === 'lg' ? '2.25rem' : '1.75rem';
  const gap = '0.25rem';
  // Sized on the grid itself (not the padded/bordered popover box) so the column math is exact —
  // computing this against the outer box's border-box width previously rounded-md 5 columns down to 4.
  const colsWidth = (n: number) => `calc(${cell} * ${n} + ${gap} * ${n - 1})`;
  // Space reserved on the right for the macOS overlay scrollbar. The scroll container (and the
  // search input) remain at colsWidth(COLUMNS); the grid is narrowed by this amount so the
  // overlay scrollbar appears in the gap between the grid's right edge and the container's right
  // edge instead of on top of the last emoji column.
  const SCROLLBAR_GUTTER = '0.5rem';
  // Applied to the search input — sets the popover width via flex-col's stretch behaviour.
  const sizeStyle = {
    width: colsWidth(COLUMNS),
    minWidth: colsWidth(MIN_COLUMNS),
    maxWidth: 'calc(100vw - 3rem)',
  };
  // Grid is slightly narrower so the scrollbar has room to the right without overlapping emojis.
  // repeat(COLUMNS, minmax(0, 1fr)) forces exactly COLUMNS equal columns at any container width.
  const gridStyle = {
    width: `calc(${colsWidth(COLUMNS)} - ${SCROLLBAR_GUTTER})`,
    minWidth: `calc(${colsWidth(MIN_COLUMNS)} - ${SCROLLBAR_GUTTER})`,
    maxWidth: `calc(100vw - 3rem - ${SCROLLBAR_GUTTER})`,
    gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))`,
  };

  const trimmedQuery = query.trim().toLowerCase();
  const isSearchLoading = trimmedQuery !== '' && searchData === null;
  const displayedEmojis = trimmedQuery ? searchEmojis(searchData ?? [], trimmedQuery) : offered;

  return (
    <div ref={ref} className={wrapperClassName}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {/* In a portal instead of in the trigger: otherwise the first ancestor with
          `overflow` clips the popover, in the vault modal for example the scrolling body,
          in which there is not even anything to scroll. Positioning is done
          by itself, in viewport coordinates (see `place`), and `z-[9999]`
          is the level that ContextMenu and MenuDropdown use for overlays above
          a modal (z-50). */}
      {open && createPortal(
        <div
          ref={popoverRef}
          className="emoji-picker-popover fixed z-[9999] border rounded-lg shadow-menu p-2 flex flex-col gap-1.5"
          style={{ ...placement, visibility: placement ? 'visible' : 'hidden' }}
        >
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('common.searchEmoji')}
            className="emoji-picker-search box-border rounded-md px-2 py-1 text-xs outline-none"
            style={sizeStyle}
          />
          {/* overflow-x-hidden prevents a horizontal scrollbar on macOS when
              space-taking (non-overlay) scrollbars are in use. The grid is
              intentionally narrower than the container (gridStyle vs sizeStyle)
              so the overlay scrollbar has room at the right without covering the
              last emoji column. */}
          <div className="max-h-56 overflow-y-auto overflow-x-hidden">
            <div
              className="grid gap-1"
              style={gridStyle}
            >
              {isSearchLoading ? null : displayedEmojis.length === 0 ? (
                <p className="col-span-full py-2 text-center text-xs text-muted">{t('common.noEmojiResults')}</p>
              ) : (
                displayedEmojis.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => { onChange(emoji); setOpen(false); }}
                    className={`emoji-picker-item ${emojiSizeClass} aspect-square flex items-center justify-center rounded-md transition-colors ${value === emoji ? 'emoji-picker-item-active' : 'emoji-picker-item-idle'}`}
                  >
                    {emoji}
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
