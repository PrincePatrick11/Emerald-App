import { useTranslation } from 'react-i18next';
import { elementLabel } from '../../lib/blocks/blockAttrs';
import {
  activeElements, elementKindLabelKey, parseFields, serializeFields, type ElementDef, type FieldsModel,
} from '../../lib/blocks/fields';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import { useFieldFallbackText } from './useFieldFallbackText';
import OptionsEditor from './OptionsEditor';
import BlockCheckbox from './BlockCheckbox';
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
  const elements = activeElements(model);

  return (
    <div className="space-y-4">
      {/* Die Kopie eines eigenen Blocks: was hier geändert wird, bleibt in diesem Eintrag. */}
      {model.name && <p className="block-field-hint">{t('blocks.fields.copyHint', { name: model.name })}</p>}

      {elements.map((element) => {
        const hides = element.hideWhenEmpty ?? model.display.readHideEmpty;
        return (
          <div key={element.id} className="space-y-2">
            {elements.length > 1 && <p className="text-[10px] uppercase tracking-wider text-stone-500">{elementLabel(t, element)}</p>}
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
              <OptionsEditor options={element.options ?? []} onChange={(options) => patchElement(element.id, { options })} />
            )}

            <BlockCheckbox
              checked={hides}
              label={t('blocks.fields.hideEmpty')}
              onChange={(checked) => patchElement(element.id, {
                // Gleich der Blockregel: kein eigener Wert — die Regel des Blocks gilt.
                hideWhenEmpty: checked === model.display.readHideEmpty ? undefined : checked,
              })}
            />
          </div>
        );
      })}

      <BlockCheckbox
        checked={model.display.readOnly}
        label={t('blocks.fields.readOnly')}
        hint={t('blocks.fields.readOnlyHint')}
        onChange={(readOnly) => write({ ...model, display: { ...model.display, readOnly } })}
      />
    </div>
  );
}
