import { useTranslation } from 'react-i18next';
import TabIconButton from '../ui/TabIconButton';
import { canUse, elementUses, FIELD_USE_SETTINGS, FIELD_USES, type ElementDef, type FieldUse } from '../../lib/blocks/fields';

/**
 * A field's three settings of how it shows outside its block — info line,
 * properties panel, filter and sort (`FieldUse`) — as three small icon
 * switches in a shared frame, each with its tooltip. The same in the
 * builder and in the block's sidebar. A use the field's kind cannot have
 * stays in its place, greyed out, so the rows line up.
 *
 * A change names the one use and its new state; the caller applies it to
 * the field as it is then (`withFieldUse`), so two quick clicks both hold.
 */
export default function FieldUseToggles({ element, onChange }: { element: ElementDef; onChange: (use: FieldUse, on: boolean) => void }) {
  const { t } = useTranslation();
  const uses = elementUses(element);
  return (
    <div role="group" aria-label={t('blocks.fields.uses.label')} className="inline-flex flex-shrink-0 gap-px p-0.5 rounded-md border border-edge bg-well-strong">
      {FIELD_USES.map((use) => {
        const { icon: Icon, labelKey, hintKey } = FIELD_USE_SETTINGS[use];
        const available = canUse(element.kind, use);
        const title = available
          ? `${t(labelKey)} — ${t(hintKey)}`
          : `${t(labelKey)} — ${t('blocks.fields.uses.unavailable')}`;
        return (
          <TabIconButton
            key={use}
            compact
            active={uses[use]}
            aria-pressed={uses[use]}
            disabled={!available}
            title={title}
            aria-label={title}
            onClick={() => onChange(use, !uses[use])}
          >
            <Icon size={14} />
          </TabIconButton>
        );
      })}
    </div>
  );
}
