import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Shapes, type LucideIcon } from 'lucide-react';
import InlineConfirm from '../../ui/InlineConfirm';
import SegmentedControl from '../../ui/SegmentedControl';
import { MODULE_LIST, viewTypeForEntryType } from '../../../lib/modules';
import { changeEntryType, typeChangeDropsProperties, type ConvertibleEntryType } from '../../../lib/entryTypeChange';
import { EditPropertyRow } from './EditProperties';
import { useUIStore } from '../../../store/uiStore';
import { guardKey, isEnding } from '../../../store/leaveGuardStore';

// The modules with a block stack, in rail order and with their rail glyphs: journal, operations, wiki.
const TYPE_MODULES = MODULE_LIST.filter((meta) => meta.usesBlocks);
const TYPES = TYPE_MODULES.map((meta) => meta.entryType as ConvertibleEntryType);
const ICONS = Object.fromEntries(TYPE_MODULES.map((meta) => [meta.entryType, meta.icon])) as Record<ConvertibleEntryType, LucideIcon>;
const LABEL_KEYS = Object.fromEntries(TYPE_MODULES.map((meta) => [meta.entryType, meta.navLabelKey])) as Record<ConvertibleEntryType, string>;

/**
 * The type of an entry when editing: the first property, as segments
 * instead of a value button. A change moves the entry to the other module immediately
 * (`lib/entryTypeChange.ts`); if category, icon or cover image would be lost
 * in the process, the row below asks first.
 */
export default function EntryTypeField({ id, type, properties }: {
  id: string;
  type: ConvertibleEntryType;
  /** What only wiki and operation carry; the journal has none of it. */
  properties?: { category_id: string | null; icon?: string; cover_image?: string };
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<ConvertibleEntryType | null>(null);
  // The edit lock: after the change the sidebar of the new module
  // redraws this row while it is still writing.
  const locked = useUIStore((s) => s.editLocked);
  // Asked of the store, not of the rendered state: the lock applies from the click.
  // Likewise while the page is ending (`isEnding`).
  const mayChange = () => !useUIStore.getState().editLocked && !isEnding(guardKey(viewTypeForEntryType(type), id));

  const run = (to: ConvertibleEntryType) => {
    if (!mayChange()) return;
    setPending(null);
    changeEntryType(id, type, to)
      .catch((e: unknown) => console.error('[EntryTypeField] type change failed:', e));
  };

  const select = (to: ConvertibleEntryType) => {
    if (to === type || !mayChange()) return;
    if (properties && typeChangeDropsProperties(properties, to)) setPending(to);
    else run(to);
  };

  return (
    <>
      <EditPropertyRow icon={<Shapes size={14} />} label={t('properties.type')}>
        <SegmentedControl
          ariaLabel={t('properties.type')}
          options={TYPES.map((value) => {
            const Icon = ICONS[value];
            return { value, label: t(LABEL_KEYS[value]), icon: <Icon size={14} /> };
          })}
          value={type}
          onChange={select}
          disabled={locked}
        />
      </EditPropertyRow>
      {pending && (
        <div className="pl-[9px] pr-3 pb-1">
          <InlineConfirm
            wrap
            small
            message={t('properties.typeDropsProperties')}
            confirmLabel={t('properties.changeType')}
            onConfirm={() => run(pending)}
            onCancel={() => setPending(null)}
          />
        </div>
      )}
    </>
  );
}
