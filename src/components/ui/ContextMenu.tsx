import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export interface ContextMenuAction {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
}

interface Props {
  x: number;
  y: number;
  actions: ContextMenuAction[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, actions, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    if (!ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    setPos({
      left: x + width > window.innerWidth - 8 ? x - width : x,
      top:  y + height > window.innerHeight - 8 ? y - height : y,
    });
  }, [x, y]);

  useEffect(() => {
    const onMouse = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    // Delay to skip the right-click mousedown that opened this menu
    const tid = setTimeout(() => document.addEventListener('mousedown', onMouse), 50);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(tid);
      document.removeEventListener('mousedown', onMouse);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="context-menu fixed z-[9999] border border-stone-700/60 rounded-lg shadow-2xl py-1 min-w-[160px]"
      style={{ left: pos.left, top: pos.top }}
    >
      {actions.map((action, i) => (
        <button
          key={i}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => { action.onClick(); onClose(); }}
          className={`context-menu-item w-full text-left px-3 py-2 text-xs flex items-center gap-2.5 transition-colors ${
            action.danger
              ? 'context-menu-item-danger text-red-400 hover:text-red-300 hover:bg-red-900/20'
              : 'context-menu-item-default text-stone-300 hover:text-stone-100 hover:bg-stone-700/50'
          }`}
        >
          {action.icon}
          {action.label}
        </button>
      ))}
    </div>
  );
}
