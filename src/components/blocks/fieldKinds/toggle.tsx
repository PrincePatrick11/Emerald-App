import { useTranslation } from 'react-i18next';
import { ToggleLeft, ToggleRight } from 'lucide-react';
import type { FieldKindView } from './fieldKindView';

/** A yes/no field's switch — content, not a setting (see `Switch` in `components/ui`). */
export function ToggleSwitch({ value, onChange, disabled = false }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  const Icon = value ? ToggleRight : ToggleLeft;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      disabled={disabled}
      onClick={() => onChange(!value)}
      className={`block-toggle ${value ? 'block-toggle--on' : ''}`}
    >
      <Icon size={14} />
      <span>{value ? t('blocks.fields.yes') : t('blocks.fields.no')}</span>
    </button>
  );
}

export const toggleFieldView: FieldKindView = {
  Input: ({ stored, onChange }) => <ToggleSwitch value={stored === true} onChange={onChange} />,
  // Switchable while reading, unless the block or the entry says otherwise.
  Read: ({ stored, onChange }) => <ToggleSwitch value={stored === true} onChange={(v) => onChange?.(v)} disabled={!onChange} />,
};
