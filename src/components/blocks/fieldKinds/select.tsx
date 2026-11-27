import { useTranslation } from 'react-i18next';
import Dropdown from '../../ui/Dropdown';
import type { SelectElement } from '../../../lib/blocks/fieldKinds/fieldKind';
import OptionsEditor from '../OptionsEditor';
import type { FieldKindView } from './fieldKindView';

export const selectFieldView: FieldKindView<SelectElement> = {
  Input: function SelectInput({ element, stored, onChange }) {
    const { t } = useTranslation();
    const options = element.options ?? [];
    if (options.length === 0) return <p className="block-field-hint">{t('blocks.fields.noOptions')}</p>;
    return (
      <Dropdown<string>
        portal
        // A deleted option shows "Select …" instead of its raw ID.
        value={options.some((o) => o.id === stored) ? (stored as string) : ''}
        onChange={(v) => onChange(v || undefined)}
        options={[
          { value: '', label: t('blocks.fields.choose') },
          ...options.map((o) => ({ value: o.id, label: o.label || t('blocks.fields.optionPlaceholder') })),
        ]}
      />
    );
  },
  Read: ({ element, stored }) => <span>{element.options?.find((o) => o.id === stored)?.label ?? ''}</span>,
  Settings: ({ element, onPatch, variant }) => (
    <OptionsEditor
      variant={variant === 'panel' ? 'panel' : 'default'}
      options={element.options ?? []}
      onChange={(options) => onPatch({ options })}
    />
  ),
};
