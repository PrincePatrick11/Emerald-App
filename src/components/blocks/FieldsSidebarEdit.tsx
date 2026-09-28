import { useTranslation } from 'react-i18next';
import { elementLabel } from '../../lib/blocks/blockAttrs';
import {
  activeElements, canBeEmpty, elementKindLabelKey, parseFields, serializeFields, type ElementDef, type FieldsModel,
} from '../../lib/blocks/fields';
import { useFieldFallbackText } from './useFieldFallbackText';
import OptionsEditor from './OptionsEditor';
import { SwitchRow } from '../ui/Switch';
import type { BlockSidebarEditProps } from './blockSidebarViews';

/**
 * Die Einstellungen eines Feldblocks, aufgeklappt unter seiner Zeile im Bearbeitungsmodus: je
 * Element Beschriftung, bei einer Auswahl die Optionen, und ob es im
 * Lesemodus leer ausgeblendet wird; für den ganzen Block „komplett
 * schreibgeschützt". Jede Änderung schreibt den Block neu (JSON + Fallback) —
 * über den Stapel, Cancel dreht sie zurück. Beschriftungen und Eingaben im
 * Stil der Seitenleiste (`.panel-field-label`, `.panel-input`).
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
    <div className="space-y-3">
      {elements.map((element, index) => {
        const hides = element.hideWhenEmpty ?? model.display.readHideEmpty;
        return (
          <div key={element.id} className="space-y-2">
            {/* Mehrere Elemente: je ein leiser Unterabschnitt, ab dem zweiten mit Linie davor. */}
            {elements.length > 1 && (
              <p className={`panel-subheading${index > 0 ? ' panel-subheading--divided' : ''}`}>{elementLabel(t, element)}</p>
            )}
            <label className="block">
              <span className="panel-field-label">{t('blocks.fields.label')}</span>
              <input
                className="panel-input selectable"
                value={element.label}
                placeholder={t(elementKindLabelKey(element.kind))}
                onChange={(e) => patchElement(element.id, { label: e.target.value })}
              />
            </label>

            {element.kind === 'select' && (
              <OptionsEditor variant="panel" options={element.options ?? []} onChange={(options) => patchElement(element.id, { options })} />
            )}

            {canBeEmpty(element.kind) && (
              <SwitchRow
                variant="panel"
                checked={hides}
                label={t('blocks.fields.hideEmpty')}
                onChange={(checked) => patchElement(element.id, {
                  // Gleich der Blockregel: kein eigener Wert — die Regel des Blocks gilt.
                  hideWhenEmpty: checked === model.display.readHideEmpty ? undefined : checked,
                })}
              />
            )}
          </div>
        );
      })}

      <SwitchRow
        variant="panel"
        checked={model.display.readOnly}
        label={t('blocks.fields.readOnly')}
        hint={t('blocks.fields.readOnlyHint')}
        onChange={(readOnly) => write({ ...model, display: { ...model.display, readOnly } })}
      />
    </div>
  );
}
