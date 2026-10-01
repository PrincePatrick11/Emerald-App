import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import Button from './Button';
import { usesCustomWindowControls } from '../../lib/platform';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  widthClassName?: string;
  maxHeightClassName?: string;
  bodyClassName?: string;
  className?: string;
  /** `false` removes every way out — no X, no Escape, no backdrop click. For a
   *  modal the app cannot continue past, such as first-run vault setup. */
  dismissible?: boolean;
}

/**
 * Die offenen Modals, das zuletzt geöffnete oben. Escape gehört nur dem
 * obersten — sonst schlösse ein Druck über einem zweiten Modal (das
 * Entsperren über dem Vault-Fenster) beide. Ein nicht schließbares oberes
 * Modal schluckt Escape: das darunter darf dann auch nicht gehen.
 */
const openModals: symbol[] = [];

export default function Modal({
  title,
  onClose,
  children,
  widthClassName = 'w-[480px]',
  maxHeightClassName,
  bodyClassName,
  className,
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

  // Ein Modal ohne Ausweg darf die Titelleiste nicht verdecken. Auf Windows
  // und Linux laeuft das Fenster ohne Systemdekoration — die Leiste *ist* dort
  // Ziehen, Minimieren und Schliessen. Ein Backdrop darueber, ohne X, ohne
  // Escape und ohne Backdrop-Klick, liesse nur noch Alt+F4. Bei schliessbaren
  // Modalen bleibt es beim vollen Overlay: dort ist der Ausweg das Modal selbst.
  const clearsTitleBar = !dismissible && usesCustomWindowControls;

  return createPortal(
    <div
      className={`fixed inset-x-0 bottom-0 ${clearsTitleBar ? 'top-10' : 'top-0'} z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4`}
      onMouseDown={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal-card ${widthClassName} ${maxHeightClassName ?? ''} flex flex-col${className ? ` ${className}` : ''}`}
      >
        <div
          className="flex items-center justify-between px-4 py-3 border-b shrink-0"
          style={{ borderColor: 'var(--border-soft)' }}
        >
          <h2 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            {title}
          </h2>
          {dismissible && (
            <Button onClick={onClose} variant="ghost">
              <X size={16} />
            </Button>
          )}
        </div>
        <div className={bodyClassName ?? 'flex-1 overflow-y-auto'}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
