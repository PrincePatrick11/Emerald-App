import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';
import { generateId } from '../../lib/helpers';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import type { SelectOption } from '../../lib/blocks/fields';

/**
 * Die Optionen eines Auswahl-Elements: umbenennen, entfernen, hinzufügen.
 * Werte speichern die Options-ID, Umbenennen verliert also nichts. Geteilt von
 * der Block-Seitenleiste und dem Baukasten der Blöcke-Ansicht.
 */
export default function OptionsEditor({ options, onChange }: { options: SelectOption[]; onChange: (options: SelectOption[]) => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1">
      <p className="label-xs">{t('blocks.fields.options')}</p>
      {options.map((option) => (
        <div key={option.id} className="flex items-center gap-1.5">
          <input
            className={OP_PROP_SELECT_CLASSES}
            value={option.label}
            placeholder={t('blocks.fields.optionPlaceholder')}
            onChange={(e) => onChange(options.map((o) => (o.id === option.id ? { ...o, label: e.target.value } : o)))}
          />
          <button
            type="button"
            className="block-row-action"
            onClick={() => onChange(options.filter((o) => o.id !== option.id))}
            title={t('blocks.fields.removeOption')}
            aria-label={t('blocks.fields.removeOption')}
          >
            <X size={12} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="block-insert-btn"
        onClick={() => onChange([...options, { id: generateId(), label: '' }])}
      >
        <Plus size={12} />
        <span>{t('blocks.fields.addOption')}</span>
      </button>
    </div>
  );
}
