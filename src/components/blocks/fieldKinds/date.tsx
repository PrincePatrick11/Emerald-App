import { storedString } from '../../../lib/blocks/fieldKinds/fieldKind';
import { formatIsoDateLong } from '../../../lib/formatDate';
import { OP_PROP_SELECT_CLASSES } from '../../../lib/styleClasses';
import type { FieldKindView } from './fieldKindView';

export const dateFieldView: FieldKindView = {
  Input: ({ stored, onChange }) => (
    <input
      type="date"
      className={OP_PROP_SELECT_CLASSES}
      value={storedString(stored) ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
    />
  ),
  Read: ({ stored }) => <span>{formatIsoDateLong(stored as string)}</span>,
};
