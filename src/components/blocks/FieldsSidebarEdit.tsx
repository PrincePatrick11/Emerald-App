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
 * The settings of a field block, expanded below its row in edit mode: per
 * element the label, for a choice the options, and whether it is hidden when empty in
 * read mode; for the whole block "completely
 * read-only". Every change rewrites the block (JSON + fallback)
 * via the stack, and Cancel rolls it back. Labels and inputs in the
 * sidebar's style (`.panel-field-label`, `.panel-input`).
 */
export default function FieldsSidebarEdit({ block, update }: BlockSidebarEditProps) {
  const { t } = useTranslation();
  const text = useFieldFallbackText();
  const model = parseFields(block);
  // Unreadable data: no settings; any would overwrite it with "empty".
  if (model.broken) return null;

  const write = (next: FieldsModel) => update(serializeFields(block, next, text));
  const patchElement = (id: string, patch: Partial<ElementDef>) =>
    write({ ...model, elements: model.elements.map((el) => (el.id === id ? { ...el, ...patch } : el)) });
  const elements = activeElements(model);

  return (
    <div className="min-w-0 space-y-3">
      {elements.map((element, index) => {
        const hides = element.hideWhenEmpty ?? model.display.readHideEmpty;
        return (
          <div key={element.id} className="space-y-2">
            {/* Several elements: one quiet subsection each, from the second on with a line before it. */}
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
                  // Same as the block rule: no value of its own; the block's rule applies.
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
