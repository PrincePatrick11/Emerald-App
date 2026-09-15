import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import IconToggleGroup from '../../ui/IconToggleGroup';
import InlineConfirm from '../../ui/InlineConfirm';
import { MODULE_LIST } from '../../../lib/modules';
import { changeEntryType, typeChangeDropsProperties, type ConvertibleEntryType } from '../../../lib/entryTypeChange';

// Die Module mit Blockstapel, in Rail-Reihenfolge und mit ihren Rail-Glyphen — Journal, Operationen, Wiki.
const TYPE_MODULES = MODULE_LIST.filter((meta) => meta.usesBlocks);
const TYPES = TYPE_MODULES.map((meta) => meta.entryType as ConvertibleEntryType);
const ICONS = Object.fromEntries(TYPE_MODULES.map((meta) => [meta.entryType, meta.icon])) as Record<ConvertibleEntryType, LucideIcon>;
const LABEL_KEYS = Object.fromEntries(TYPE_MODULES.map((meta) => [meta.entryType, meta.navLabelKey])) as Record<ConvertibleEntryType, string>;

/**
 * Der Typ eines Eintrags im Bearbeiten — über der Kategorie, als Icon-Reihe
 * wie die Sortierung. Ein Wechsel zieht den Eintrag sofort ins andere Modul um
 * (`lib/entryTypeChange.ts`); fielen dabei Kategorie, Icon oder Titelbild weg,
 * fragt die Reihe vorher nach.
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
    <div>
      <p className="label-xs mb-2">{t('properties.type')}</p>
      <IconToggleGroup
        label={t('properties.type')}
        options={TYPES.map((value) => ({ value, label: t(LABEL_KEYS[value]) }))}
        icons={ICONS}
        value={type}
        onChange={select}
        isDisabled={() => busy}
      />
      {pending && (
        <div className="mt-2">
          <InlineConfirm
            wrap
            message={t('properties.typeDropsProperties')}
            confirmLabel={t('properties.changeType')}
            onConfirm={() => run(pending)}
            onCancel={() => setPending(null)}
          />
        </div>
      )}
    </div>
  );
}
