import { useTranslation } from 'react-i18next';
import {
  canBeEmpty, elementLabel, elementKindLabelKey, parseFields, serializeFields, withFieldUse, type ElementDef, type FieldsModel,
} from '../../lib/blocks/fields';
import { useFieldFallbackText } from './useFieldFallbackText';
import FieldUseToggles from './FieldUseToggles';
import { fieldKindView } from './fieldKindViews';
import { SwitchRow } from '../ui/Switch';
import type { BlockSidebarEditProps } from './blockSidebarViews';

/**
 * The settings of a field block, expanded below its row in edit mode: per
 * element the label, where it shows outside the block (info line, panel,
 * filter and sort), the settings of its own kind (a choice's options), and whether it is hidden when empty in
 * read mode; for the whole block "completely
 * read-only". Every change rewrites the block (JSON + fallback)
 * via the stack, and Cancel rolls it back. Labels and inputs in the
 * sidebar's style (`.panel-field-label`, `.panel-input`).
 */
export default function FieldsSidebarEdit({ block, update }: BlockSidebarEditProps) {
  const { t } = useTranslation();
  const text = useFieldFallbackText();
  const model = parseFields(block);

  const write = (next: FieldsModel) => update(serializeFields(block, next, text));
  const patchElement = (id: string, patch: Partial<ElementDef>) =>
    write({ ...model, elements: model.elements.map((el) => (el.id === id ? { ...el, ...patch } : el)) });
  const elements = model.elements;

  return (
    <div className="min-w-0 space-y-3">
      {elements.map((element, index) => {
        const hides = element.hideWhenEmpty ?? model.display.readHideEmpty;
        const Settings = fieldKindView(element)?.Settings;
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

            <div>
              <span className="panel-field-label">{t('blocks.fields.uses.label')}</span>
              <FieldUseToggles element={element} onChange={(use, on) => patchElement(element.id, { uses: withFieldUse(element, use, on).uses })} />
            </div>

            {Settings && <Settings element={element} variant="panel" onPatch={(patch) => patchElement(element.id, patch)} />}

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
