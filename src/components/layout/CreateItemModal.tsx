import { useEffect, useRef, type FocusEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { createItem } from '../../lib/createItem';
import { CREATABLE_VIEWS, type CreatableViewId } from '../../lib/modules';
import Modal from '../ui/Modal';

/** Tiles per row, for the arrow keys; keep in step with `grid-cols-4` below. */
const COLUMNS = 4;

const KEY_STEPS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -COLUMNS,
  ArrowDown: COLUMNS,
};

/** What the rail's plus opens: one tile per thing that can be created. */
export default function CreateItemModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);

  // A press on the header or the padding takes the focus to nowhere, and with it
  // the ring and the keys: it goes back to the tile. After the event, since the
  // browser only then settles where the focus lands.
  const keepFocus = (e: FocusEvent<HTMLButtonElement>) => {
    const tile = e.currentTarget;
    setTimeout(() => {
      if (document.activeElement === document.body) tile.focus();
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    // Tab wraps as well: `Modal` holds no focus, and the page behind it is out of reach anyway.
    const step = e.key === 'Tab' ? (e.shiftKey ? -1 : 1) : KEY_STEPS[e.key];
    if (!step) return;
    e.preventDefault();
    const count = CREATABLE_VIEWS.length;
    tiles.current[(index + step + count) % count]?.focus();
  };

  // The modal goes first: leaving an open edit may ask its own question.
  const choose = (id: CreatableViewId) => {
    onClose();
    createItem(id).catch((err: unknown) => console.error('[CreateItemModal] creating failed:', err));
  };

  // On the window, not the tiles: a number works wherever the focus has gone.
  useEffect(() => {
    const onNumber = (e: globalThis.KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      // By the physical key first: on AZERTY the unshifted "1" key gives `&`.
      const number = /^(?:Digit|Numpad)([1-8])$/.exec(e.code)?.[1] ?? e.key;
      const view = CREATABLE_VIEWS[Number(number) - 1];
      if (!view) return;
      e.preventDefault();
      choose(view.id);
    };
    window.addEventListener('keydown', onNumber);
    return () => window.removeEventListener('keydown', onNumber);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `choose` only closes and creates
  }, []);

  return (
    <Modal title={t('createItem.title')} onClose={onClose} widthClassName="w-[440px] max-w-full">
      <div className="modal-body grid grid-cols-4 gap-2">
        {CREATABLE_VIEWS.map(({ id, icon: Icon, navLabelKey }, index) => (
          <button
            key={id}
            ref={(el) => { tiles.current[index] = el; }}
            type="button"
            // Enter on the open modal gives the most common choice: a journal entry.
            autoFocus={index === 0}
            onClick={() => choose(id)}
            onKeyDown={(e) => onKeyDown(e, index)}
            onBlur={keepFocus}
            aria-keyshortcuts={String(index + 1)}
            className="panel-interactive create-item-tile"
          >
            <span aria-hidden className="create-item-tile-number">{index + 1}</span>
            <Icon size={16} />
            <span className="min-w-0 max-w-full truncate">{t(navLabelKey)}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
