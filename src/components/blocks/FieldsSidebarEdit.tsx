import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';
import { elementLabel } from '../../lib/blocks/blockAttrs';
import {
  elementKindLabelKey, parseFields, serializeFields, type ElementDef, type FieldsModel,
} from '../../lib/blocks/fields';
import { generateId } from '../../lib/helpers';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import { useFieldFallbackText } from './useFieldFallbackText';
import type { BlockSidebarEditProps } from './blockSidebarViews';

/**
 * Der Seitenleisten-Abschnitt eines Feldblocks im Bearbeitungsmodus: je
 * Element Beschriftung, bei einer Auswahl die Optionen, und ob es im
 * Lesemodus leer ausgeblendet wird; für den ganzen Block „komplett
 * schreibgeschützt". Jede Änderung schreibt den Block neu (JSON + Fallback) —
 * über den Stapel, Cancel dreht sie zurück.
 */
export default function FieldsSidebarEdit({ block, update }: BlockSidebarEditProps) {
  const { t } = useTranslation();
  const text = useFieldFallbackText();
  const model = parseFields(block);
  // Unlesbare Daten: keine Einstellungen — jede würde sie mit „leer" überschreiben.
  if (model.broken) return null;

  const write = (next: FieldsModel) => update(serializeFields(block, next, text));
  const patchElement = (id: string, patch: Partial<ElementDef>) =>
    write({ ...model, elements: model.elements.map((el) => (el.id === id ? { ...el, ...patch } : el)) });

  return (
    <div className="space-y-4">
      {model.elements.map((element) => {
        const hides = element.hideWhenEmpty ?? model.display.readHideEmpty;
        return (
          <div key={element.id} className="space-y-2">
            {model.elements.length > 1 && <p className="text-[10px] uppercase tracking-wider text-stone-500">{elementLabel(t, element)}</p>}
            <div className="space-y-1">
              <p className="label-xs">{t('blocks.fields.label')}</p>
              <input
                className={OP_PROP_SELECT_CLASSES}
                value={element.label}
                placeholder={t(elementKindLabelKey(element.kind))}
                onChange={(e) => patchElement(element.id, { label: e.target.value })}
              />
            </div>

            {element.kind === 'select' && (
              <OptionsEditor element={element} onChange={(options) => patchElement(element.id, { options })} />
            )}

            <label className="flex items-center gap-2 text-xs text-stone-400 cursor-pointer">
              <input
                type="checkbox"
                className="block-checkbox"
                checked={hides}
                onChange={(e) => patchElement(element.id, {
                  // Gleich der Blockregel: kein eigener Wert — die Regel des Blocks gilt.
                  hideWhenEmpty: e.target.checked === model.display.readHideEmpty ? undefined : e.target.checked,
                })}
              />
              {t('blocks.fields.hideEmpty')}
            </label>
          </div>
        );
      })}

      <label className="flex items-start gap-2 text-xs text-stone-400 cursor-pointer">
        <input
          type="checkbox"
          className="block-checkbox mt-0.5"
          checked={model.display.readOnly}
          onChange={(e) => write({ ...model, display: { ...model.display, readOnly: e.target.checked } })}
        />
        <span>
          {t('blocks.fields.readOnly')}
          <span className="block text-[10px] text-stone-600">{t('blocks.fields.readOnlyHint')}</span>
        </span>
      </label>
    </div>
  );
}

function OptionsEditor({ element, onChange }: { element: ElementDef; onChange: (options: NonNullable<ElementDef['options']>) => void }) {
  const { t } = useTranslation();
  const options = element.options ?? [];
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
