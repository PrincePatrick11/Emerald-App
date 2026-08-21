import { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight } from 'lucide-react';

export type MenuNode =
  /** `checked` macht den Eintrag zu einem Haekchen-Eintrag: gesetzt (auch auf
   *  `false`) reserviert er den fuehrenden Slot, undefined laesst ihn weg. */
  | { kind: 'item'; label: string; disabled?: boolean; checked?: boolean; onSelect: () => void }
  | { kind: 'separator' }
  | { kind: 'submenu'; label: string; disabled?: boolean; children: MenuNode[] };

/** Breite des fuehrenden Haekchen-Slots. Sobald ein Eintrag eines Panels
 *  ankreuzbar ist, bekommen ihn alle — sonst stuenden die Labels desselben
 *  Panels auf zwei verschiedenen Kanten. */
const CHECK_SLOT_CLASSES = 'w-3.5 flex-shrink-0';

interface Props {
  nodes: MenuNode[];
  /** Tailwind positioning for the panel; differs between root and submenu. */
  positionClass: string;
  /** Closes the whole menu. Called after any item is picked. */
  onClose: () => void;
  /** Root panels take focus on open; submenus inherit it from the parent. */
  autoFocus?: boolean;
}

/**
 * A dropdown panel for the title bar's menu bar.
 *
 * Deliberately separate from `ui/ContextMenu`: that one is positioned at a
 * cursor coordinate, has a timing hack to survive the right-click that opened
 * it, and knows nothing about disabled items or submenus.
 */
export default function MenuDropdown({ nodes, positionClass, onClose, autoFocus }: Props) {
  const [openSubmenu, setOpenSubmenu] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const hasChecks = nodes.some((node) => node.kind === 'item' && node.checked !== undefined);

  useEffect(() => {
    if (!autoFocus) return;
    panelRef.current?.querySelector<HTMLButtonElement>('.menu-item:not(:disabled)')?.focus();
  }, [autoFocus]);

  /** Up/Down move within the panel; Right/Left enter and leave a submenu. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...(panelRef.current?.querySelectorAll<HTMLButtonElement>(':scope > .menu-item:not(:disabled), :scope > div > .menu-item:not(:disabled)') ?? [])];
    if (items.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = e.key === 'ArrowDown' ? 1 : -1;
    items[(current + step + items.length) % items.length].focus();
  };

  return (
    <div
      ref={panelRef}
      onKeyDown={onKeyDown}
      className={`menu-surface absolute z-[9999] min-w-[13rem] py-1 ${positionClass}`}
      role="menu"
    >
      {nodes.map((node, i) => {
        if (node.kind === 'separator') {
          return <div key={i} className="menu-separator" role="separator" />;
        }

        if (node.kind === 'submenu') {
          const open = openSubmenu === i;
          return (
            <div
              key={i}
              className="relative"
              onMouseEnter={() => { if (!node.disabled) setOpenSubmenu(i); }}
              onMouseLeave={() => setOpenSubmenu((current) => (current === i ? null : current))}
            >
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                disabled={node.disabled}
                aria-haspopup="menu"
                aria-expanded={open}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setOpenSubmenu(open ? null : i)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight') { e.preventDefault(); setOpenSubmenu(i); }
                  if (e.key === 'ArrowLeft') { e.preventDefault(); setOpenSubmenu(null); }
                }}
              >
                {hasChecks && <span className={CHECK_SLOT_CLASSES} />}
                <span className="flex-1 text-left">{node.label}</span>
                <ChevronRight size={12} className="flex-shrink-0 opacity-70" />
              </button>
              {open && (
                // Flush against the parent panel on purpose: a gap here would
                // sit outside both elements, firing onMouseLeave and closing
                // the submenu while the pointer travels into it.
                <MenuDropdown
                  nodes={node.children}
                  positionClass="left-full top-0 -mt-1"
                  onClose={onClose}
                  autoFocus={openSubmenu === i}
                />
              )}
            </div>
          );
        }

        return (
          <button
            key={i}
            type="button"
            // Ein ankreuzbarer Eintrag ist eine andere Rolle als ein
            // ausloesender — ohne das bleibt das Haekchen rein optisch und ein
            // Screenreader erfaehrt nichts vom Zustand.
            role={node.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={node.checked}
            className="menu-item"
            disabled={node.disabled}
            // Cancelling mousedown keeps the editor's selection alive, so Cut
            // and Copy still have something to act on.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { onClose(); node.onSelect(); }}
          >
            {hasChecks && (
              <span className={CHECK_SLOT_CLASSES}>{node.checked && <Check size={12} />}</span>
            )}
            <span className="flex-1 text-left">{node.label}</span>
          </button>
        );
      })}
    </div>
  );
}
