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

/** A small whole number with − and + beside it: the corners of a polygon, the rays of a symmetry. */
export function ToolbarStepper({ value, min, max, onChange, label }: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
}) {
  return (
    <span className="paint-stepper" title={label}>
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label={`${label} −`}>−</button>
      <span className="paint-stepper-value" aria-label={label}>{value}</span>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label={`${label} +`}>+</button>
    </span>
  );
}
