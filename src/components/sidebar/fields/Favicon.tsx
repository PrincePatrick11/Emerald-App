import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, Smile, X } from 'lucide-react';
import { ACCEPTED_IMAGE_MIME, isAcceptedImageFile, isImageIcon, readFileAsDataUrl } from '../../../lib/helpers';
import EmojiPicker from '../../ui/EmojiPicker';
import Button from '../../ui/Button';

/** Nur das Glyph, ohne Auswahl — 20px, die Größe einer Zeilen-Meta-Angabe. */
export function FaviconGlyph({ value }: { value?: string | null }) {
  if (!value) return null;
  const cls = 'w-5 h-5 text-base';
  return isImageIcon(value) ? (
    <img src={value} alt="" className={`${cls} object-cover rounded border border-stone-700/40 flex-shrink-0`} />
  ) : (
    <span className={`${cls} leading-none flex items-center justify-center flex-shrink-0`}>{value}</span>
  );
}

interface FaviconProps {
  value?: string | null;
  onChange?: (value: string) => void;
  onRemove?: () => void;
  readOnly?: boolean;
}

/**
 * Das Icon-Feld: Glyph plus die drei Aktionen (Bild wählen, Emoji wählen,
 * entfernen) in einer Zeile.
 *
 * Gibt nur diese Zeile zurück: keine Beschriftung, kein „— Keine —" im
 * Lesemodus. Beides bringen die Aufrufer mit — `IconCoverField` teilt sich die
 * Überschrift mit dem Titelbild und trägt das „— Keine —" für beide Felder
 * zusammen, der Altar hat seinen eigenen aufklappbaren Kopf.
 *
 * Die Aktionen sind tonkodierte `Button`s in der dichten 24px-Stufe, wie die
 * Kategorien-Köpfe sie benutzen — sie müssen sich im `IconCoverField` eine
 * Textzeile mit dem Titelbild-Knopf teilen. Beschriftet nur mit dem Stichwort,
 * die ausgeschriebene Form steht im `title`.
 */
export default function Favicon({ value, onChange, onRemove, readOnly = false }: FaviconProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const pickFile = () => inputRef.current?.click();

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!isAcceptedImageFile(file) || file.type === 'image/svg+xml') return;
    try {
      onChange?.(await readFileAsDataUrl(file));
    } catch (err) {
      // Lieber gar nichts setzen als ein leeres Icon: ein abgebrochener Lesevorgang
      // hat kein Ergebnis, und der bisherige Wert ist besser als keiner.
      console.error('Failed to read icon:', err);
    }
  };

  if (readOnly) return <FaviconGlyph value={value} />;

  return (
    <>
      <input ref={inputRef} type="file" accept={ACCEPTED_IMAGE_MIME} className="hidden" onChange={handleUpload} />
      <EmojiPicker
        value={value ?? ''}
        onChange={(emoji) => onChange?.(emoji)}
        // Nicht der `flex-shrink-0`-Default: sonst könnte die Knopfzeile unten
        // nie umbrechen, sondern liefe in einer langen Sprache aus der
        // Seitenleiste heraus.
        wrapperClassName="relative min-w-0"
        trigger={({ toggle }) => (
          <div className="flex flex-wrap items-center gap-1.5">
            {value && <FaviconGlyph value={value} />}
            <Button tone="neutral" small title={value ? t('wiki.changeIcon') : t('wiki.addIcon')} onClick={pickFile}>
              <ImagePlus size={12} /> {value ? t('properties.change') : t('properties.icon')}
            </Button>
            <Button tone="neutral" small title={t('altar.chooseEmoji')} onClick={toggle}>
              <Smile size={12} /> {t('properties.emoji')}
            </Button>
            {/* Entfernen nur als Icon: mit Beschriftung liefe die Zeile aus der
                Seitenleiste heraus, und das X ist für eine destruktive
                Zeilenaktion eindeutig genug. */}
            {value && (
              <Button tone="danger" small compact title={t('wiki.removeIcon')} aria-label={t('wiki.removeIcon')} onClick={() => onRemove?.()}>
                <X size={12} />
              </Button>
            )}
          </div>
        )}
      />
    </>
  );
}
