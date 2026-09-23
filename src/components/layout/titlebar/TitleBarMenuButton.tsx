import { useRef, useState, type ReactNode } from 'react';
import { useOutsideClick } from '../../../hooks/useOutsideClick';
import RailButton from '../../ui/RailButton';
import MenuDropdown, { type MenuNode } from './MenuDropdown';

interface Props {
  /** Tooltip und Name für Screenreader — der Knopf zeigt nur sein Icon. */
  label: string;
  icon: ReactNode;
  nodes: MenuNode[];
}

/**
 * Ein Icon-Knopf der Titelleiste, der ein Menü aufklappt — im selben Stil wie
 * Zurück, Vor und die Lupe daneben (`RailButton`).
 */
export default function TitleBarMenuButton({ label, icon, nodes }: Props) {
  const [open, setOpen] = useState(false);
  // Only a keyboard-opened menu pulls focus into its panel. Opening by mouse
  // must leave focus where it was, or Cut/Copy lose the editor's selection.
  const [focusPanelOnOpen, setFocusPanelOnOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useOutsideClick(open, () => setOpen(false), { refs: [rootRef], escape: true });

  return (
    <div ref={rootRef} className="relative flex items-center flex-shrink-0">
      <RailButton
        aria-haspopup="menu"
        aria-expanded={open}
        data-open={open || undefined}
        title={label}
        aria-label={label}
        // Cancelling mousedown keeps the editor's selection alive, so the
        // Edit menu's Cut and Copy still have something to act on.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => { setFocusPanelOnOpen(false); setOpen(!open); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setFocusPanelOnOpen(true); setOpen(true); }
        }}
      >
        {icon}
      </RailButton>
      {open && (
        <MenuDropdown
          nodes={nodes}
          positionClass="top-full left-0 mt-1"
          onClose={() => setOpen(false)}
          autoFocus={focusPanelOnOpen}
        />
      )}
    </div>
  );
}
