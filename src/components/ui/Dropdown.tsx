import { useState, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useOutsideClick } from '../../hooks/useOutsideClick';

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  /** Optional leading emoji in the menu row (CategorySelect). */
  emoji?: string;
  /** Optional leading icon before the label (TaskRow priority menu: flag). */
  icon?: ReactNode;
  /** Additional classes for the menu row, e.g. a priority colour on the active row. */
  className?: string;
  /** Not selectable in the current combination (ListToolbar: alphabetical/category
   *  sorting in the timeline); `title` explains why. */
  disabled?: boolean;
  title?: string;
}

interface Props<T extends string> {
  /** Chip prefix ("Sort: "). Only relevant for the default trigger. */
  label?: string;
  value: T;
  options: DropdownOption<T>[];
  onChange: (v: T) => void;
  /** Anchor edge of the menu; default 'left'. */
  align?: 'left' | 'right';
  /**
   * Portals the menu to document.body (fixed); needed when the trigger sits in
   * an overflow container (properties panels), where an absolutely
   * positioned menu would be clipped. Same pattern as ContextMenu.
   */
  portal?: boolean;
  /** Replaces the default chip trigger (EmojiPicker convention: the popover is unified, the trigger is not). */
  trigger?: (args: { open: boolean; toggle: () => void; selectedLabel: string }) => ReactNode;
}

/** Space below which the menu opens upwards instead of being clipped at the bottom. */
const MENU_MAX_HEIGHT = 240;

export default function Dropdown<T extends string>({
  label, value, options, onChange, align = 'left', portal = false, trigger,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [portalPos, setPortalPos] = useState<CSSProperties | null>(null);
  const selected = options.find((o) => o.value === value)?.label ?? value;

  // menuRef as well: in portal mode the menu is not a descendant of the wrapper.
  useOutsideClick(open, () => setOpen(false), { refs: [wrapRef, menuRef], escape: true });

  useLayoutEffect(() => {
    if (!open || !portal || !wrapRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < MENU_MAX_HEIGHT && r.top > spaceBelow;
    setPortalPos({
      position: 'fixed',
      zIndex: 9999,
      minWidth: r.width,
      ...(openUp
        ? { bottom: window.innerHeight - r.top + 4 }
        : { top: r.bottom + 4 }),
      ...(align === 'right'
        ? { right: window.innerWidth - r.right }
        : { left: r.left }),
    });
  }, [open, portal, align]);

  const toggle = () => setOpen((o) => !o);

  const menu = (
    <div
      ref={menuRef}
      className={`list-toolbar-menu ${portal ? '' : `absolute top-full ${align === 'right' ? 'right-0' : 'left-0'} mt-1 z-50`} rounded-lg py-1 min-w-[130px] max-h-60 overflow-y-auto`}
      style={portal ? (portalPos ?? { position: 'fixed', visibility: 'hidden' }) : undefined}
    >
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => { onChange(o.value); setOpen(false); }}
          disabled={o.disabled}
          title={o.title}
          className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            value === o.value
              ? 'list-toolbar-option-active'
              : 'list-toolbar-option-idle'
          } ${o.className ?? ''}`}
        >
          {o.emoji && <span>{o.emoji}</span>}
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="relative" ref={wrapRef}>
      {trigger ? (
        trigger({ open, toggle, selectedLabel: selected })
      ) : (
        <button
          onClick={toggle}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="list-toolbar-chip flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors"
        >
          {label && <span className="list-toolbar-chip-label mr-0.5">{label}</span>}
          {selected}
          <ChevronDown size={12} className="list-toolbar-chip-label" />
        </button>
      )}
      {open && (portal ? createPortal(menu, document.body) : menu)}
    </div>
  );
}
