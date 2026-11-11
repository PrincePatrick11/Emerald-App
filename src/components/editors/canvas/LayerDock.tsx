import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Lock, LockOpen, X } from 'lucide-react';
import { ToolbarBtn } from '../shared/toolbarParts';

/**
 * The frame both lists of the canvas editor share, the element list and the
 * paint mode's layers: a panel over the stage's right side with a head, the
 * rows, and below them an opacity and a row of buttons for what is picked.
 */

/** Pictures in the rows: as wide as this, in the paint document's 3:2. */
export const DOCK_THUMB_WIDTH = 48;
export const DOCK_THUMB_HEIGHT = 32;

export function LayerDock({ title, onClose, footer, children }: {
  title: string;
  onClose: () => void;
  /** Below the rows: `DockOpacity` and `DockButtons`. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="paint-layers-dock" onPointerDown={(e) => e.stopPropagation()}>
      <div className="paint-layers-head">
        <span>{title}</span>
        <ToolbarBtn onClick={onClose} active={false} title={t('canvas.layers.close')}>
          <X size={13} />
        </ToolbarBtn>
      </div>
      <div className="paint-layers">{children}</div>
      {footer && <div className="paint-layer-actions">{footer}</div>}
    </div>
  );
}

/** The lock and the eye at the end of a row. */
export function DockToggles({ locked, hidden, onLock, onHide }: {
  locked: boolean;
  hidden: boolean;
  onLock: () => void;
  onHide: () => void;
}) {
  const { t } = useTranslation();
  return (<>
    <ToolbarBtn onClick={onLock} active={locked} title={t(locked ? 'canvas.layers.unlock' : 'canvas.layers.lock')}>
      {locked ? <Lock size={13} /> : <LockOpen size={13} />}
    </ToolbarBtn>
    <ToolbarBtn onClick={onHide} active={false} title={t(hidden ? 'canvas.layers.show' : 'canvas.layers.hide')}>
      {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
    </ToolbarBtn>
  </>);
}

/** The opacity of what is picked, 0–100; empty when the picked ones differ. */
export function DockOpacity({ value, onChange }: { value: number | undefined; onChange: (percent: number) => void }) {
  const { t } = useTranslation();
  return (
    <label className="paint-layer-opacity-field">
      <span>{t('canvas.layers.opacity')}</span>
      <input type="range" min={0} max={100} value={value ?? 100} onChange={(e) => onChange(Number(e.target.value))} className="accent-accent" />
      <span className="paint-size-value">{value ?? '–'}</span>
    </label>
  );
}

export function DockButtons({ children }: { children: ReactNode }) {
  return <div className="paint-layer-buttons">{children}</div>;
}
