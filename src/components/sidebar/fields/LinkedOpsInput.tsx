import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOperationStore } from '../../../store/operationStore';
import { isImageIcon } from '../../../lib/helpers';
import { DEFAULT_ENTRY_EMOJI } from '../../../lib/modules';
import LinkedEntryPicker, { LINK_RESULT_LIMIT, LinkedEntryChip } from './LinkedEntryPicker';

/**
 * ID-Array-Editor für Operationen — heute nur noch für Routinen-Vorlagen
 * (`RoutinesPanel`). Was ein EINTRAG verlinkt, steht in seinem Inhalt und
 * gehört ins `LinkedEntriesField`.
 */
export default function LinkedOpsInput({
  ids, onChange, inputCls,
}: {
  ids: string[];
  onChange: (ids: string[]) => void;
  inputCls: string;
}) {
  const { t } = useTranslation();
  const operations = useOperationStore((s) => s.operations);
  const categories = useOperationStore((s) => s.categories);
  const [query, setQuery] = useState('');

  const iconOf = (op: typeof operations[number]) =>
    op.icon || categories.find((c) => c.id === op.category_id)?.emoji || DEFAULT_ENTRY_EMOJI.operation;

  const filtered = useMemo(() =>
    operations
      .filter((o) => !ids.includes(o.id) && !o.deleted_at &&
        o.title.toLowerCase().includes(query.toLowerCase()))
      .slice(0, LINK_RESULT_LIMIT),
    [operations, ids, query]);

  const selectedOps = useMemo(() =>
    ids.map((id) => operations.find((o) => o.id === id)).filter(Boolean) as typeof operations,
    [ids, operations]);

  const opIcon = (icon: string) => isImageIcon(icon)
    ? <img src={icon} alt="" className="w-4 h-4 object-cover rounded flex-shrink-0" />
    : <span className="flex-shrink-0">{icon}</span>;

  return (
    <LinkedEntryPicker
      chips={selectedOps.map((op) => (
        <LinkedEntryChip
          key={op.id}
          icon={opIcon(iconOf(op))}
          label={op.title}
          onRemove={() => onChange(ids.filter((i) => i !== op.id))}
          removeTitle={t('properties.removeLink')}
        />
      ))}
      results={filtered}
      resultKey={(op) => op.id}
      onSelect={(op) => onChange([...ids, op.id])}
      query={query}
      onQueryChange={setQuery}
      placeholder={t('search.operations')}
      inputCls={inputCls}
      renderResult={(op) => (
        <>
          {opIcon(iconOf(op))}
          <span className="truncate">{op.title}</span>
        </>
      )}
    />
  );
}
