import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Single shared emoji set used by every emoji picker in the app, so the same choices are offered everywhere. */
export const DEFAULT_EMOJI_PICKER_EMOJIS = [
  '✨', '🌟', '⭐', '💫', '🌙', '☀️', '🌑', '🌕', '🌈', '🌀',
  '🔮', '☯️', '🔯', '🔱', '🪬', '🧿', '⚡', '👁️', '💀', '🎭',
  '🕯️', '🔥', '🪔', '🕎', '💡', '🔔', '📿', '🫧',
  '🌿', '🍃', '🌱', '🌾', '🪴', '🍀', '🌺', '🌸', '🦋', '🐉', '🦅', '🐍', '🐾',
  '⚗️', '🪄', '🗡️', '⚔️', '🛡️', '🔑', '📜', '🏺', '🪵', '🪑', '🧺', '🪟', '🛖', '🪜', '📦',
  '💎', '💜', '🪨',
  '📖', '📋', '📄', '📝', '✍️', '🗺️',
  '💼', '⏰', '🎯', '🧘', '💪', '🃏', '🧲', '🧹', '🧪', '🎵',
];

// Every picker prefers this many emoji per row, shrinking down to MIN_COLUMNS when the
// viewport is too narrow, regardless of trigger width or emoji count.
const COLUMNS = 5;
const MIN_COLUMNS = 3;
const MAX_SEARCH_RESULTS = 150;

// [emoji, searchable text] pairs generated from emojibase-data (compact.json per locale),
// covering the full standard Unicode emoji set (minus skin-tone variants and flag-building
// components) so search isn't limited to the curated DEFAULT_EMOJI_PICKER_EMOJIS above.
// Loaded lazily per-locale so the ~100-140KB dataset is only fetched once a picker is opened.
const SEARCH_DATA_LOADERS: Record<string, () => Promise<{ default: string[][] }>> = {
  en: () => import('../../lib/emojiSearchData/en.json'),
  de: () => import('../../lib/emojiSearchData/de.json'),
  es: () => import('../../lib/emojiSearchData/es.json'),
  fr: () => import('../../lib/emojiSearchData/fr.json'),
};

// Module-level cache so re-opening a picker (or opening a second one) doesn't re-fetch.
const searchDataCache: Record<string, string[][]> = {};

interface EmojiPickerProps {
  value: string;
  onChange: (emoji: string) => void;
  /** Defaults to the shared app-wide emoji set — pass only to offer a narrower selection. */
  emojis?: string[];
  /** Renders the trigger button; receives the current open state and a toggle handler. */
  trigger: (args: { open: boolean; toggle: () => void }) => React.ReactNode;
  /** Popover horizontal anchor edge, relative to the wrapper. */
  align?: 'left' | 'right';
  /** Glyph size of the emoji buttons inside the popover. */
  size?: 'sm' | 'lg';
  /** Classes for the wrapper div — must keep `relative` for popover positioning. */
  wrapperClassName?: string;
}

/** Shared emoji-picker popover: manages open state, outside-click/Escape-to-close, search, and themed chrome. */
export default function EmojiPicker({
  value,
  onChange,
  emojis = DEFAULT_EMOJI_PICKER_EMOJIS,
  trigger,
  align = 'left',
  size = 'sm',
  wrapperClassName = 'relative flex-shrink-0',
}: EmojiPickerProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchData, setSearchData] = useState<string[][] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const langCode = i18n.language?.slice(0, 2).toLowerCase();
  const locale = langCode && SEARCH_DATA_LOADERS[langCode] ? langCode : 'en';

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    const cached = searchDataCache[locale];
    if (cached) {
      setSearchData(cached);
      return;
    }
    let cancelled = false;
    SEARCH_DATA_LOADERS[locale]().then((mod) => {
      if (cancelled) return;
      searchDataCache[locale] = mod.default;
      setSearchData(mod.default);
    });
    return () => { cancelled = true; };
  }, [open, locale]);

  useEffect(() => {
    if (!open) return;
    const onMouse = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onMouse);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouse);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const alignClass = align === 'right' ? 'right-0' : 'left-0';
  const emojiSizeClass = size === 'lg' ? 'text-xl' : 'text-base';
  const cell = size === 'lg' ? '2.25rem' : '1.75rem';
  const gap = '0.25rem';
  // Sized on the grid itself (not the padded/bordered popover box) so the column math is exact —
  // computing this against the outer box's border-box width previously rounded 5 columns down to 4.
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
  const displayedEmojis = trimmedQuery
    ? (searchData ?? [])
        .filter(([, text]) => text.includes(trimmedQuery))
        .slice(0, MAX_SEARCH_RESULTS)
        .map(([emoji]) => emoji)
    : emojis;

  return (
    <div ref={ref} className={wrapperClassName}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div className={`emoji-picker-popover absolute top-full ${alignClass} mt-1 z-50 border rounded-lg shadow-xl p-2 flex flex-col gap-1.5`}>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('common.searchEmoji')}
            className="emoji-picker-search box-border rounded px-2 py-1 text-xs outline-none"
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
                <p className="col-span-full py-2 text-center text-xs text-stone-500">{t('common.noEmojiResults')}</p>
              ) : (
                displayedEmojis.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => { onChange(emoji); setOpen(false); }}
                    className={`emoji-picker-item ${emojiSizeClass} aspect-square flex items-center justify-center rounded transition-colors ${value === emoji ? 'emoji-picker-item-active' : 'emoji-picker-item-idle'}`}
                  >
                    {emoji}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
