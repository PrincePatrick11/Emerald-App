import { useTranslation } from 'react-i18next';
import Favicon from './Favicon';
import Banner from './Banner';

interface IconCoverFieldProps {
  icon?: string | null;
  cover?: string;
  onIconChange?: (value: string) => void;
  onIconRemove?: () => void;
  onCoverChange?: (dataUrl: string) => void;
  onCoverRemove?: () => void;
}

/**
 * Icon und Titelbild unter einer Beschriftung, ihre Knöpfe in einer Zeile —
 * statt zweier Blöcke mit je eigener Überschrift, die im Leerzustand vier
 * Zeilen für zwei Klicks brauchten.
 *
 * Ein gesetztes Titelbild bleibt in voller Breite und rutscht durch sein
 * `w-full` im umbrechenden Flex-Container von selbst unter die Knopfzeile.
 *
 * Nur fürs Bearbeiten — die Leseansicht zeigt beides im Eintrag selbst.
 * Nur für die Module mit beidem (Wiki, Operationen). Der Altar hat kein
 * Titelbild und benutzt `Favicon` weiter allein.
 */
export default function IconCoverField({
  icon, cover, onIconChange, onIconRemove, onCoverChange, onCoverRemove,
}: IconCoverFieldProps) {
  const { t } = useTranslation();

  return (
    <div>
      <p className="label-xs mb-2">{t('properties.iconAndCover')}</p>
      {/* `flex-wrap` ist tragend, nicht kosmetisch: das gesetzte Titelbild
          ist `w-full` und kommt nur dadurch unter die Knopfzeile statt in sie. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Favicon value={icon} onChange={onIconChange} onRemove={onIconRemove} />
        <Banner value={cover} onChange={onCoverChange} onRemove={onCoverRemove} />
      </div>
    </div>
  );
}
