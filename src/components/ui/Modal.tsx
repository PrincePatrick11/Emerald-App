import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import Button from './Button';
import { usesCustomWindowControls } from '../../lib/platform';
import { isHistoryButton } from '../../lib/mouseButtons';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  widthClassName?: string;
  maxHeightClassName?: string;
  bodyClassName?: string;
  className?: string;
  /** The action row, pinned below the body whatever its height. */
  footer?: React.ReactNode;
  /** `false` removes every way out — no X, no Escape, no backdrop click. For a
   *  modal the app cannot continue past, such as first-run vault setup. */
  dismissible?: boolean;
}

/**
 * The open modals, the most recently opened on top. Escape belongs only to the
 * topmost; otherwise one press over a second modal (the
 * unlock over the vault window) would close both. A topmost modal that cannot be closed
 * swallows Escape: the one below must not go either.
 */
const openModals: symbol[] = [];

/** Whether at least one `Modal` is currently open; menus, dropdowns and pickers do not count. */
export function hasOpenModal(): boolean {
  return openModals.length > 0;
}

export default function Modal({
  title,
  onClose,
  children,
  widthClassName = 'w-[480px]',
  maxHeightClassName,
  bodyClassName,
  className,
  footer,
  dismissible = true,
}: ModalProps) {
  const [self] = useState(() => Symbol('modal'));
  useEffect(() => {
    openModals.push(self);
    return () => {
      const at = openModals.lastIndexOf(self);
      if (at !== -1) openModals.splice(at, 1);
    };
  }, [self]);

  useEffect(() => {
    if (!dismissible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openModals[openModals.length - 1] === self) onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, dismissible, self]);

  // A modal with no way out must not cover the title bar. On Windows
  // and Linux the window runs without system decoration, and there the bar *is*
  // dragging, minimising and closing. A backdrop over it, with no X, no
  // Escape and no backdrop click, would leave only Alt+F4. For closable
  // modals the full overlay stays: there the way out is the modal itself.
  const clearsTitleBar = !dismissible && usesCustomWindowControls;

  return createPortal(
    <div
      className={`fixed inset-x-0 bottom-0 ${clearsTitleBar ? 'top-10' : 'top-0'} z-50 flex items-center justify-center modal-backdrop p-4`}
      onMouseDown={(e) => {
        // A thumb button would otherwise close the modal and navigate back on release.
        if (dismissible && !isHistoryButton(e) && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal-card ${widthClassName} ${maxHeightClassName ?? ''} flex flex-col${className ? ` ${className}` : ''}`}
      >
        <div className="modal-header">
          <h2 className="min-w-0 truncate text-sm font-semibold text-primary">{title}</h2>
          {dismissible && (
            <Button onClick={onClose} variant="ghost" className="-mr-1.5 shrink-0">
              <X size={16} />
            </Button>
          )}
        </div>
        <div className={bodyClassName ?? 'flex-1 overflow-y-auto'}>{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
