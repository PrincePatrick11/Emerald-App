import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useOutsideClick } from '../../../hooks/useOutsideClick';
import { OP_PROP_SELECT_CLASSES } from '../../../lib/styleClasses';
import { isImageIcon } from '../../../lib/helpers';
import { DEFAULT_ENTRY_EMOJI } from '../../../lib/modules';
import type { SuggestionItem } from '../../../lib/linkItems';

/** The icon of a link target in chips and hit rows: image (altar), emoji, or the default of its kind. */
export function LinkItemIcon({ item }: { item: SuggestionItem }) {
  const icon = item.displayIcon || item.icon || DEFAULT_ENTRY_EMOJI[item.entryType];
  return isImageIcon(icon)
    ? <img src={icon} alt="" className="w-4 h-4 object-cover rounded flex-shrink-0" />
    : <span className="flex-shrink-0">{icon}</span>;
}

interface Props<T> {
  /** Hits for the current input; filtering stays with the caller, who
   *  knows its own stock. */
  results: T[];
  resultKey: (item: T) => string;
  renderResult: (item: T) => ReactNode;
  onSelect: (item: T) => void;
  query: string;
  onQueryChange: (query: string) => void;
  placeholder: string;
  /**
   * The inset field of the edit sidebar (`.sidebar-add-field`):
   * icon before the input, both in one frame. Without it the search row
   * has the field look of the panels.
   */
  fieldIcon?: ReactNode;
}

/** Height of the menu (`max-h-40`); from here on it opens upwards. */
const MENU_MAX_HEIGHT = 160;

/**
 * The chip of a link. `onClick` makes the label clickable (the
 * links field jumps to the spot in the text with it), `onRemove` attaches the "×".
 * Without either it is a pure display.
 */
export function LinkedEntryChip({
  icon, label, labelMaxWidth = 'max-w-[110px]', onClick, onRemove, removeTitle,
}: {
  icon: ReactNode;
  label: string;
  labelMaxWidth?: string;
  onClick?: () => void;
  onRemove?: () => void;
  removeTitle?: string;
}) {
  const body = (
    <>
      {icon}
      <span className={`truncate ${labelMaxWidth}`}>{label}</span>
    </>
  );
  return (
    <span className="linked-entry-chip flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-well-strong border border-edge text-soft transition-colors">
      {onClick ? (
        <button
          onClick={onClick}
          className="flex items-center gap-1 min-w-0 hover:text-primary transition-colors"
          title={label}
        >
          {body}
        </button>
      ) : body}
      {onRemove && (
        <button
          onClick={onRemove}
          className="text-faint hover:text-muted ml-0.5 flex-shrink-0"
          title={removeTitle}
          aria-label={removeTitle}
        >
          <X size={12} />
        </button>
      )}
    </span>
  );
}

/**
 * The shared shell of the link fields: search row and results menu
 * (with `fieldIcon` in the sidebar's inset look, `.sidebar-add-field`). This scaffold used to appear three times, almost verbatim, in
 * `LinkedEntriesField` and two ID fields that have since been removed.
 *
 * The menu hangs on `body` via a portal and is `fixed`, like `Dropdown` with
 * `portal` and `ContextMenu`: the fields sit in the `overflow-y-auto` of the
 * right sidebar, and an absolutely positioned menu would be clipped there at the
 * bottom edge.
 *
 * What does NOT belong here: the chips themselves and what a hit means. The
 * three fields have different contracts: two edit an ID array,
 * one reads the links from the entry's content.
 */
export default function LinkedEntryPicker<T>({
  results, resultKey, renderResult, onSelect,
  query, onQueryChange, placeholder, fieldIcon,
}: Props<T>) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<CSSProperties | null>(null);

  // menuRef as well: in the portal the menu is not a descendant of the wrapper.
  useOutsideClick(open, () => setOpen(false), { refs: [wrapRef, menuRef], escape: true });

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!wrapRef.current) return;
      const r = wrapRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom;
      const openUp = spaceBelow < MENU_MAX_HEIGHT && r.top > spaceBelow;
      setMenuPos({
        position: 'fixed',
        zIndex: 9999,
        width: r.width,
        left: r.left,
        ...(openUp ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      });
    };
    place();
    // `capture: true` so that scrolling of the right sidebar counts too;
    // a fixed-position menu otherwise does not move along with its anchor.
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, query, results.length]);

  // Closing AND clearing belong together; previously each field did this itself.
  const select = (item: T) => {
    onSelect(item);
    onQueryChange('');
    setOpen(false);
  };

  return (
    <div>
      <div ref={wrapRef} className={fieldIcon ? 'sidebar-add-field relative' : 'relative'}>
        {fieldIcon}
        <input
          value={query}
          onChange={(e) => { onQueryChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          aria-label={placeholder}
          className={fieldIcon ? 'selectable' : OP_PROP_SELECT_CLASSES}
        />
        {open && createPortal(
          <div
            ref={menuRef}
            className="linked-entry-menu border border-edge rounded-lg shadow-xl py-1 max-h-40 overflow-y-auto"
            style={menuPos ?? { position: 'fixed', visibility: 'hidden' }}
          >
            {results.length === 0 ? (
              <p className="text-xs text-faint px-3 py-2">{t('search.noResultsShort')}</p>
            ) : results.map((item) => (
              <button
                key={resultKey(item)}
                // Only defuse mousedown (the blur would close the menu before the
                // click); the action fires on click so the row
                // stays reachable by keyboard too.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(item)}
                className="linked-entry-menu-item w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs text-muted hover:text-secondary"
              >
                {renderResult(item)}
              </button>
            ))}
          </div>,
          document.body,
        )}
      </div>
    </div>
  );
}
