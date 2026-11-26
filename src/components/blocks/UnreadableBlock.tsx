import { useTranslation } from 'react-i18next';
import { CircleAlert } from 'lucide-react';
import { UNREADABLE_NOTICE } from '../../lib/blocks/blockTypes';

/**
 * A block this app cannot read (`blockReadState`): of a type it does not
 * know or in a newer data format (`newer`), or with damaged data (`broken`).
 * It shows only a notice, never what the block holds — its markup may carry
 * what its type conceals. It cannot be edited, only moved or removed; the
 * stack writes it back unchanged.
 */
export default function UnreadableBlock({ reason }: { reason: 'newer' | 'broken' }) {
  const { t } = useTranslation();
  return (
    <p className="block-unreadable">
      <CircleAlert size={12} aria-hidden />
      <span>{t(UNREADABLE_NOTICE[reason])}</span>
    </p>
  );
}
