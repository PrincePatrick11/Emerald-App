import { useTranslation } from 'react-i18next';
import { CheckSquare, Plus, Square, ToggleLeft, ToggleRight, X } from 'lucide-react';
import Dropdown from '../ui/Dropdown';
import { elementLabel } from '../../lib/blocks/blockAttrs';
import type { ChecklistItem, ElementDef, FieldValue } from '../../lib/blocks/fields';
import { generateId } from '../../lib/helpers';
import { MOON_PHASE_ORDER, MOON_PHASE_SYMBOLS } from '../../lib/moonPhase';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import type { MoonPhase } from '../../types';

/**
 * Die Eingaben für die Werte eines Feld-Elements, die im JSON stehen — alles
 * außer Verknüpfung, Bild und Altar (die stehen im Markup, siehe
 * `FieldSlotEditor`). Geteilt vom Feldblock im Bearbeitungsmodus und von den
 * Vorgaben im Baukasten der Blöcke-Ansicht. `onChange(undefined)` heißt „leer".
 */
export default function FieldValueEditor({ element, value, onChange }: {
  element: ElementDef;
  value: FieldValue | undefined;
  onChange: (value: FieldValue | undefined) => void;
}) {
  const { t } = useTranslation();

  switch (element.kind) {
    case 'shorttext':
      return (
        <input
          className={OP_PROP_SELECT_CLASSES}
          value={typeof value === 'string' ? value : ''}
          placeholder={elementLabel(t, element)}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );
    case 'number':
      return (
        <input
          type="number"
          className={OP_PROP_SELECT_CLASSES}
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => onChange(Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : undefined)}
        />
      );
    case 'date':
      return (
        <input
          type="date"
          className={OP_PROP_SELECT_CLASSES}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );
    case 'select': {
      const options = element.options ?? [];
      if (options.length === 0) return <p className="block-field-hint">{t('blocks.fields.noOptions')}</p>;
      return (
        <Dropdown<string>
          portal
          // Eine gelöschte Option zeigt „Auswählen …" statt ihrer rohen ID.
          value={options.some((o) => o.id === value) ? (value as string) : ''}
          onChange={(v) => onChange(v || undefined)}
          options={[
            { value: '', label: t('blocks.fields.choose') },
            ...options.map((o) => ({ value: o.id, label: o.label || t('blocks.fields.optionPlaceholder') })),
          ]}
        />
      );
    }
    case 'toggle':
      return <ToggleSwitch value={value === true} onChange={onChange} />;
    case 'checklist':
      return <ChecklistEditor items={Array.isArray(value) ? value : []} onChange={(items) => onChange(items.length ? items : undefined)} />;
    case 'moon':
      return (
        <Dropdown<string>
          portal
          value={MOON_PHASE_ORDER.includes(value as MoonPhase) ? (value as string) : ''}
          onChange={(v) => onChange(v || undefined)}
          options={[
            { value: '', label: t('blocks.fields.choose') },
            ...MOON_PHASE_ORDER.map((p) => ({ value: p, label: t(`moonPhase.${p}`), emoji: MOON_PHASE_SYMBOLS[p] })),
          ]}
        />
      );
    default: // Slot-Arten: FieldSlotEditor
      return null;
  }
}

export function ToggleSwitch({ value, onChange, disabled = false }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  const Icon = value ? ToggleRight : ToggleLeft;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      disabled={disabled}
      onClick={() => onChange(!value)}
      className={`block-toggle ${value ? 'block-toggle--on' : ''}`}
    >
      <Icon size={14} />
      <span>{value ? t('blocks.fields.yes') : t('blocks.fields.no')}</span>
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

export function CheckButton({ checked, onToggle }: { checked: boolean; onToggle?: () => void }) {
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
