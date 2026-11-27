import { useTranslation } from 'react-i18next';
import { CheckSquare, Plus, Square, X } from 'lucide-react';
import type { ChecklistItem } from '../../../lib/blocks/fieldKinds/checklist';
import { generateId } from '../../../lib/helpers';
import type { FieldKindView } from './fieldKindView';

function CheckButton({ checked, onToggle }: { checked: boolean; onToggle?: () => void }) {
  const Icon = checked ? CheckSquare : Square;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={!onToggle}
      onClick={onToggle}
      className={`block-check ${checked ? 'block-check--on' : ''}`}
    >
      <Icon size={14} />
    </button>
  );
}

function ChecklistEditor({ items, onChange }: { items: ChecklistItem[]; onChange: (items: ChecklistItem[]) => void }) {
  const { t } = useTranslation();
  const update = (id: string, patch: Partial<ChecklistItem>) =>
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  return (
    <div className="block-checklist">
      {items.map((item) => (
        <div key={item.id} className="block-checklist-item">
          <CheckButton checked={item.checked} onToggle={() => update(item.id, { checked: !item.checked })} />
          <input
            className="block-checklist-input selectable"
            value={item.text}
            placeholder={t('blocks.fields.itemPlaceholder')}
            onChange={(e) => update(item.id, { text: e.target.value })}
          />
          <button
            type="button"
            className="block-row-action"
            onClick={() => onChange(items.filter((i) => i.id !== item.id))}
            title={t('blocks.fields.removeItem')}
            aria-label={t('blocks.fields.removeItem')}
          >
            <X size={12} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="block-insert-btn"
        onClick={() => onChange([...items, { id: generateId(), text: '', checked: false }])}
      >
        <Plus size={12} />
        <span>{t('blocks.fields.addItem')}</span>
      </button>
    </div>
  );
}

const itemsOf = (stored: unknown): ChecklistItem[] => (Array.isArray(stored) ? stored : []);

export const checklistFieldView: FieldKindView = {
  Input: ({ stored, onChange }) => (
    <ChecklistEditor items={itemsOf(stored)} onChange={(items) => onChange(items.length ? items : undefined)} />
  ),
  // Items can be ticked while reading, unless the block or the entry says otherwise.
  Read: ({ stored, onChange }) => {
    const items = itemsOf(stored);
    return (
      <div className="block-checklist">
        {items.map((item) => (
          <div key={item.id} className={`block-checklist-item ${item.checked ? 'block-checklist-item--done' : ''}`}>
            <CheckButton
              checked={item.checked}
              onToggle={onChange ? () => onChange(items.map((i) => (i.id === item.id ? { ...i, checked: !i.checked } : i))) : undefined}
            />
            <span>{item.text}</span>
          </div>
        ))}
      </div>
    );
  },
};
