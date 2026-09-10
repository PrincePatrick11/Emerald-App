import { useTranslation } from 'react-i18next';
import { EyeOff } from 'lucide-react';
import { formatEntryDateLong } from '../../lib/formatDate';
import { localDate } from '../../lib/blocks/sigil';

/** Was Rechner und Zeichnung zeigen, solange die Sigille geladen und verborgen ist — in beiden Modi. */
export default function SigilConcealed({ revealDate }: { revealDate: string | null }) {
  const { t } = useTranslation();
  return (
    <p className="block-sigil-concealed">
      <EyeOff size={12} className="flex-shrink-0" />
      <span>
        {revealDate
          ? t('creation.hiddenUntilDate', { date: formatEntryDateLong(localDate(revealDate)) })
          : t('blocks.sigil.hidden')}
      </span>
    </p>
  );
}
