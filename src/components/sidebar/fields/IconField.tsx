import { useTranslation } from 'react-i18next';
import Favicon from './Favicon';

/**
 * Das Icon-Feld der Seite einer Sprache: die Überschrift „Icon" über
 * `Favicon`, und ein Entfernen, das auf das Standard-Icon des Moduls
 * zurückfällt statt auf nichts — eine Sprache trägt immer eines. Eigene
 * Blöcke und Vorlagen zeigen ihr Icon als `MediaPropertyRow`.
 */
export default function IconField({ value, onChange, fallback }: {
  value: string;
  onChange: (icon: string) => void;
  /** Das Icon, auf das „Entfernen" zurücksetzt. */
  fallback: string;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <p className="label-xs mb-2">{t('properties.icon')}</p>
      <Favicon value={value} onChange={onChange} onRemove={() => onChange(fallback)} />
    </div>
  );
}
