import { useTranslation } from 'react-i18next';
import { EyeOff } from 'lucide-react';
import { formatIsoDateLong } from '../../lib/formatDate';

/** What calculator and drawing show while the sigil is charged and concealed, in both modes. */
export default function SigilConcealed({ revealDate }: { revealDate: string | null }) {
  const { t } = useTranslation();
  return (
    <p className="block-sigil-concealed">
      <EyeOff size={12} className="flex-shrink-0" />
      <span>
        {revealDate
          ? t('creation.hiddenUntilDate', { date: formatIsoDateLong(revealDate) })
          : t('blocks.sigil.hidden')}
      </span>
    </p>
  );
}
