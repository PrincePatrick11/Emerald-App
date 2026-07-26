import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  widthClassName?: string;
  maxHeightClassName?: string;
  bodyClassName?: string;
  className?: string;
}

export default function Modal({
  title,
  onClose,
  children,
  widthClassName = 'w-[480px]',
  maxHeightClassName,
  bodyClassName,
  className,
}: ModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
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
          <button onClick={onClose} className="btn-ghost">
            <X size={16} />
          </button>
        </div>
        <div className={bodyClassName ?? 'flex-1 overflow-y-auto'}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
