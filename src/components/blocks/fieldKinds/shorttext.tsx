import { useTranslation } from 'react-i18next';
import { storedString } from '../../../lib/blocks/fieldKinds/fieldKind';
import { elementLabel } from '../../../lib/blocks/fields';
import { OP_PROP_SELECT_CLASSES } from '../../../lib/styleClasses';
import type { FieldKindView } from './fieldKindView';

export const shorttextFieldView: FieldKindView = {
  Input: function ShorttextInput({ element, stored, onChange }) {
    const { t } = useTranslation();
    return (
      <input
        className={OP_PROP_SELECT_CLASSES}
        value={storedString(stored) ?? ''}
        placeholder={elementLabel(t, element)}
        onChange={(e) => onChange(e.target.value || undefined)}
      />
    );
  },
  Read: ({ stored }) => <span>{stored as string}</span>,
};
