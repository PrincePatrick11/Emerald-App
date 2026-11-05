import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The buttons of the editors' toolbars: the text editor's bar, selection
 * menus and find bar, and the paint editor's bar.
 */
export function ToolbarGroup({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}

// The narrow margin is deliberate: the bar wraps when the editor area
// gets tight, and every pixel saved pushes that wrap further out.
export function ToolbarDivider() {
  return <div className="editor-toolbar-divider" />;
}

export function ToolbarBtn({
  children,
  onClick,
  active,
  title,
  disabled = false,
}: {
  children: ReactNode;
  onClick: () => void;
  active: boolean;
  title: string;
  disabled?: boolean;
}) {
  // Size and states in index.css (`.editor-toolbar-btn`).
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`editor-toolbar-btn ${
        active ? 'editor-toolbar-btn-active' : disabled ? 'editor-toolbar-btn-disabled' : 'editor-toolbar-btn-idle'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * A toolbar button with a small panel hanging under it (`.editor-toolbar-popover`).
 * A click elsewhere and Escape close it; the panel gets `close` to close itself.
 * `column` stacks the panel's content instead of lining it up.
 */
export function PopoverButton({ icon, title, active, column = false, children }: {
  icon: ReactNode;
  title: string;
  active: boolean;
  column?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <ToolbarBtn onClick={() => setOpen((v) => !v)} active={active || open} title={title}>
        {icon}
      </ToolbarBtn>
      {open && (
        <div className={`editor-selection-menu editor-toolbar-popover${column ? ' editor-toolbar-popover--column' : ''}`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
