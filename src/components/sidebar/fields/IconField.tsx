import { useTranslation } from 'react-i18next';
import Favicon from './Favicon';

/**
 * Das Icon-Feld einer Bibliotheksseite: die Überschrift „Icon" über
 * `Favicon`, und ein Entfernen, das auf das Standard-Icon des Moduls
 * zurückfällt statt auf nichts — ein eigener Block, eine Vorlage und eine
 * Sprache tragen immer eines.
 *
 * Die Überschrift getrennt von `Favicon`, weil das Feld sie nicht überall
 * mitbringt: im `IconCoverField` teilt es sie sich mit dem Titelbild, und der
 * Altar hat seinen eigenen aufklappbaren Kopf (siehe `Favicon`).
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
