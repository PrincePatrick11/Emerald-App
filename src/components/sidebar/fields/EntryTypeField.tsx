import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Shapes, type LucideIcon } from 'lucide-react';
import InlineConfirm from '../../ui/InlineConfirm';
import { MODULE_LIST } from '../../../lib/modules';
import { changeEntryType, typeChangeDropsProperties, type ConvertibleEntryType } from '../../../lib/entryTypeChange';
import { EditPropertyRow } from './EditProperties';

// Die Module mit Blockstapel, in Rail-Reihenfolge und mit ihren Rail-Glyphen — Journal, Operationen, Wiki.
const TYPE_MODULES = MODULE_LIST.filter((meta) => meta.usesBlocks);
const TYPES = TYPE_MODULES.map((meta) => meta.entryType as ConvertibleEntryType);
const ICONS = Object.fromEntries(TYPE_MODULES.map((meta) => [meta.entryType, meta.icon])) as Record<ConvertibleEntryType, LucideIcon>;
const LABEL_KEYS = Object.fromEntries(TYPE_MODULES.map((meta) => [meta.entryType, meta.navLabelKey])) as Record<ConvertibleEntryType, string>;

/**
 * Der Typ eines Eintrags im Bearbeiten — die erste Eigenschaft, als Segmente
 * statt Wert-Knopf. Ein Wechsel zieht den Eintrag sofort ins andere Modul um
 * (`lib/entryTypeChange.ts`); fielen dabei Kategorie, Icon oder Titelbild weg,
 * fragt die Zeile darunter vorher nach.
 */
export default function EntryTypeField({ id, type, properties }: {
  id: string;
  type: ConvertibleEntryType;
  /** Was nur Wiki und Operation tragen — das Journal hat nichts davon. */
  properties?: { category_id: string | null; icon?: string; cover_image?: string };
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<ConvertibleEntryType | null>(null);
  const [busy, setBusy] = useState(false);

  const run = (to: ConvertibleEntryType) => {
    setPending(null);
    setBusy(true);
    changeEntryType(id, type, to)
      .catch((e: unknown) => console.error('[EntryTypeField] type change failed:', e))
      .finally(() => setBusy(false));
  };

  const select = (to: ConvertibleEntryType) => {
    if (to === type || busy) return;
    if (properties && typeChangeDropsProperties(properties, to)) setPending(to);
    else run(to);
  };

  return (
    <>
      <EditPropertyRow icon={<Shapes size={14} />} label={t('properties.type')}>
        <div role="group" aria-label={t('properties.type')} className="prop-segments">
          {TYPES.map((value) => {
            const Icon = ICONS[value];
            const label = t(LABEL_KEYS[value]);
            const active = value === type;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                aria-label={label}
                title={label}
                disabled={busy}
                onClick={() => select(value)}
                className={`prop-segment${active ? ' prop-segment--active' : ''}`}
              >
                <Icon size={13} />
              </button>
            );
          })}
        </div>
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
