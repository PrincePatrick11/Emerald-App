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
  readOnly?: boolean;
}

/**
 * Icon und Titelbild unter einer Beschriftung, ihre Knöpfe in einer Zeile —
 * statt zweier Blöcke mit je eigener Überschrift, die im Leerzustand vier
 * Zeilen für zwei Klicks brauchten.
 *
 * Ein gesetztes Titelbild bleibt in voller Breite und rutscht durch sein
 * `w-full` im umbrechenden Flex-Container von selbst unter die Knopfzeile.
 *
 * Nur für die Module mit beidem (Wiki, Operationen). Der Altar hat kein
 * Titelbild und benutzt `Favicon` weiter allein.
 */
export default function IconCoverField({
  icon, cover, onIconChange, onIconRemove, onCoverChange, onCoverRemove, readOnly = false,
}: IconCoverFieldProps) {
  const { t } = useTranslation();

  return (
    <div>
      <p className="label-xs mb-2">{t('properties.iconAndCover')}</p>
      {readOnly && !icon && !cover ? (
        <p className="text-xs text-stone-600">{t('properties.none')}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Favicon
            value={icon}
            onChange={onIconChange}
            onRemove={onIconRemove}
            readOnly={readOnly}
          />
          <Banner
            value={cover}
            onChange={onCoverChange}
            onRemove={onCoverRemove}
            readOnly={readOnly}
          />
        </div>
      )}
    </div>
  );
}
