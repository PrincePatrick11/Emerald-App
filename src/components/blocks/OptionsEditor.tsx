import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';
import { generateId } from '../../lib/helpers';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import type { SelectOption } from '../../lib/blocks/fields';

/**
 * Die Optionen eines Auswahl-Elements: umbenennen, entfernen, hinzufügen.
 * Werte speichern die Options-ID, Umbenennen verliert also nichts. Geteilt von
 * der Block-Seitenleiste (`variant="panel"`: Beschriftung, Eingaben und
 * „×" im Stil der Seitenleiste) und dem Baukasten der Blöcke-Ansicht.
 */
export default function OptionsEditor({ options, onChange, variant = 'default' }: {
  options: SelectOption[];
  onChange: (options: SelectOption[]) => void;
  variant?: 'default' | 'panel';
}) {
  const { t } = useTranslation();
  const panel = variant === 'panel';
  return (
    <div className={panel ? 'flex flex-col gap-1.5' : 'space-y-1'}>
      <p className={panel ? 'panel-field-label !mb-0' : 'label-xs'}>{t('blocks.fields.options')}</p>
      {options.map((option) => (
        <div key={option.id} className="flex items-center gap-1.5">
          <input
            className={panel ? 'panel-input selectable' : OP_PROP_SELECT_CLASSES}
            value={option.label}
            placeholder={t('blocks.fields.optionPlaceholder')}
            onChange={(e) => onChange(options.map((o) => (o.id === option.id ? { ...o, label: e.target.value } : o)))}
          />
          <button
            type="button"
            className={panel ? 'sidebar-row-remove' : 'block-row-action'}
            onClick={() => onChange(options.filter((o) => o.id !== option.id))}
            title={t('blocks.fields.removeOption')}
            aria-label={t('blocks.fields.removeOption')}
          >
            <X size={panel ? 13 : 12} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className={panel ? 'panel-add-row' : 'block-insert-btn'}
        onClick={() => onChange([...options, { id: generateId(), label: '' }])}
      >
        <Plus size={panel ? 13 : 12} />
        <span>{t('blocks.fields.addOption')}</span>
      </button>
    </div>
  );
}
