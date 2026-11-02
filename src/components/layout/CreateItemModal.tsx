import { useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { createItem } from '../../lib/createItem';
import { CREATABLE_VIEWS } from '../../lib/modules';
import Modal from '../ui/Modal';

/** Tiles per row; the arrow keys need it, and so does the grid below. */
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

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    // Tab wraps as well: `Modal` holds no focus, and the page behind it is out of reach anyway.
    const step = e.key === 'Tab' ? (e.shiftKey ? -1 : 1) : KEY_STEPS[e.key];
    if (!step) return;
    e.preventDefault();
    const count = CREATABLE_VIEWS.length;
    tiles.current[(index + step + count) % count]?.focus();
  };

  // The modal goes first: leaving an open edit may ask its own question.
  const choose = (id: (typeof CREATABLE_VIEWS)[number]['id']) => {
    onClose();
    createItem(id).catch((err: unknown) => console.error('[CreateItemModal] creating failed:', err));
  };

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
            className="panel-interactive create-item-tile"
          >
            <Icon size={18} />
            <span className="min-w-0 max-w-full truncate">{t(navLabelKey)}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
