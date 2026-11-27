import { useTranslation } from 'react-i18next';
import { OP_PROP_SELECT_CLASSES } from '../../../lib/styleClasses';
import type { FieldKindView } from './fieldKindView';

export const numberFieldView: FieldKindView = {
  Input: ({ stored, onChange }) => (
    <input
      type="number"
      className={OP_PROP_SELECT_CLASSES}
      value={typeof stored === 'number' ? stored : ''}
      onChange={(e) => onChange(Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : undefined)}
    />
  ),
  Read: function NumberRead({ stored }) {
    const { i18n } = useTranslation();
    return <span>{(stored as number).toLocaleString(i18n.language)}</span>;
  },
};
