import { useRef, useState, type ReactNode } from 'react';
import { useOutsideClick } from '../../../hooks/useOutsideClick';
import { ToolbarBtn } from './toolbarParts';

/**
 * A toolbar button with a small panel hanging under it (`.editor-toolbar-popover`),
 * for the editors' bars. A click elsewhere or Escape closes it, and so can the
 * panel itself through `close`; `onDismiss` runs then, to give the focus back
 * to the editor. A button in the right half of its bar opens the panel towards
 * the left, so it stays on the sheet.
 */
export default function PopoverButton({ icon, title, active, onDismiss, children }: {
  icon: ReactNode;
  title: string;
  active: boolean;
  onDismiss?: () => void;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [towardsStart, setTowardsStart] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const close = () => setOpen(false);
  useOutsideClick(open, () => { close(); onDismiss?.(); }, { refs: [ref], escape: true });

  const toggle = () => {
    if (!open) {
      const button = ref.current?.getBoundingClientRect();
      const bar = ref.current?.parentElement?.closest('.editor-toolbar')?.getBoundingClientRect();
      setTowardsStart(!!button && !!bar && button.left + button.width / 2 > bar.left + bar.width / 2);
    }
    setOpen((v) => !v);
  };

  return (
    <div ref={ref} className="relative">
      <ToolbarBtn onClick={toggle} active={active || open} title={title}>
        {icon}
      </ToolbarBtn>
      {open && (
        <div className={`editor-selection-menu editor-toolbar-popover${towardsStart ? ' editor-toolbar-popover--end' : ''}`}>
          {children(close)}
        </div>
      )}
    </div>
  );
}
