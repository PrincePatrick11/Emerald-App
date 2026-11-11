import type { ReactNode, Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { Redo, Undo } from 'lucide-react';

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
  active = false,
  title,
  disabled = false,
}: {
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
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

/** Undo and redo, first in every editor's bar. */
export function UndoRedoGroup({ undo, redo, canUndo, canRedo }: {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ToolbarGroup>
      <ToolbarBtn onClick={undo} disabled={!canUndo} title={t('editor.toolbar.undo')}>
        <Undo size={14} />
      </ToolbarBtn>
      <ToolbarBtn onClick={redo} disabled={!canRedo} title={t('editor.toolbar.redo')}>
        <Redo size={14} />
      </ToolbarBtn>
    </ToolbarGroup>
  );
}

/**
 * A column of tools over the left edge of a drawing or a stage (the paint
 * mode's and the canvas editor's), its tools in `ToolRailGroup`s; a group
 * with `divider` starts under a line. `children` may add a panel beside it.
 */
export function ToolRail({ label, railRef, children }: {
  label: string;
  railRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <div ref={railRef} className="editor-toolbar paint-rail" role="toolbar" aria-orientation="vertical" aria-label={label}>
      {children}
    </div>
  );
}

export function ToolRailGroup({ divider = false, children }: { divider?: boolean; children: ReactNode }) {
  return (
    <div className="paint-rail-group">
      {divider && <div className="paint-rail-divider" />}
      {children}
    </div>
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
