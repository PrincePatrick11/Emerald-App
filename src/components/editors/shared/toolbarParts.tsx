import type { ReactNode } from 'react';

/** The buttons of the toolbar, the selection menus and the find bar. */
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
