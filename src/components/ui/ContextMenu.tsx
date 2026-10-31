import { useLayoutEffect, useRef, useState } from 'react';
import { useOutsideClick } from '../../hooks/useOutsideClick';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

export interface ContextMenuAction {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  /** Greyed out instead of hidden: a menu whose entries disappear depending on
   *  the situation changes its order on every call. Same
   *  meaning as disabled in MenuDropdown. */
  disabled?: boolean;
}

interface Props {
  x: number;
  y: number;
  actions: ContextMenuAction[];
  onClose: () => void;
  /**
   * `right`: `x` is the right edge; the menu ends there, like a
   * right-aligned `Dropdown`. For menus on a button at the right edge (the
   * sidebar's value buttons); otherwise it would first flip away to the left.
   */
  align?: 'left' | 'right';
  /** Minimum width in px; shorter for the terse menus of the value buttons (120). */
  minWidth?: number;
}

/** Distance the panel keeps from every window edge. */
const VIEWPORT_MARGIN = 8;

/**
 * Flip-then-clamp on one axis: flips the panel back to the cursor if
 * it would otherwise hit the far edge, and then shifts it into the window in every case.
 * Without the clamping, a menu taller than the click Y offset
 * gets a negative `top` and is cut off at the top.
 */
function place(cursor: number, size: number, viewport: number): number {
  const flipped = cursor + size > viewport - VIEWPORT_MARGIN ? cursor - size : cursor;
  const max = Math.max(VIEWPORT_MARGIN, viewport - size - VIEWPORT_MARGIN);
  return Math.min(Math.max(flipped, VIEWPORT_MARGIN), max);
}

export default function ContextMenu({ x, y, actions, onClose, align = 'left', minWidth = 160 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    if (!ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    setPos({
      left: place(align === 'right' ? x - width : x, width, window.innerWidth),
      top: place(y, height, window.innerHeight),
    });
  }, [x, y, align]);

  // Delay, to skip the right-clicking mousedown that opened this menu.
  // Escape in the capture phase: a menu above a modal is the topmost
  // layer, and without intercepting it the same key would also close the modal
  // below, whose handler is likewise attached to the document.
  useOutsideClick(true, onClose, { refs: [ref], escape: 'capture', delay: 50 });

  // Portal to `document.body`, for the same reason as in `EmojiPicker`:
  // `.app-sidebar` and `.app-main` carry `position: relative;
  // z-index: 1` in both themes and are thus sibling stacking contexts. Rendered
  // inline, the `z-[9999]` only applies inside the sidebar and loses against
  // the main area painted later; a higher number changes nothing about that.
  return createPortal(
    <div
      ref={ref}
      // `w-max`: at a click position near the window edge the menu would otherwise
      // shrink while being measured and end up wider than measured after being shifted.
      className="context-menu fixed z-[9999] w-max border border-stone-700/60 rounded-lg shadow-2xl py-1"
      style={{ left: pos.left, top: pos.top, minWidth }}
    >
      {actions.map((action, i) => (
        <button
          key={i}
          disabled={action.disabled}
          // stopPropagation keeps the menu open, preventDefault keeps the
          // selection alive: otherwise focus moves to this button on mousedown,
          // the selection in the field collapses and Copy
          // would have nothing left to copy. Same trick as in
          // MenuDropdown and TitleBarMenuButton.
          onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
          onClick={() => { action.onClick(); onClose(); }}
          className={`context-menu-item w-full text-left px-3 py-2 text-xs flex items-center gap-2.5 transition-colors ${
            action.danger
              ? 'context-menu-item-danger text-red-400 hover:text-red-300 hover:bg-red-900/20'
              : 'context-menu-item-default text-stone-300 hover:text-stone-100 hover:bg-stone-700/50'
          }${action.disabled ? ' opacity-45 cursor-default pointer-events-none' : ''}`}
        >
          {action.icon}
          {action.label}
        </button>
      ))}
    </div>,
    document.body
  );
}
