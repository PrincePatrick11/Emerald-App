import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, Smile, X } from 'lucide-react';
import { ACCEPTED_IMAGE_MIME, isAcceptedImageFile, isImageIcon } from '../../../lib/helpers';
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
 * Bewusst ohne eigene Beschriftung und ohne umschließenden Block — beide
 * Aufrufer bringen ihre Überschrift selbst mit: `IconCoverField` teilt sie sich
 * mit dem Titelbild, der Altar hat seinen eigenen aufklappbaren Kopf.
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

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isAcceptedImageFile(file) || file.type === 'image/svg+xml') { e.target.value = ''; return; }
    const reader = new FileReader();
    reader.onloadend = () => onChange?.(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Das „— Keine —" trägt der Aufrufer für Icon und Titelbild zusammen; ein
  // eigenes hier würde es doppeln.
  if (readOnly) return value ? <FaviconGlyph value={value} /> : null;

  return (
    <>
      <input ref={inputRef} type="file" accept={ACCEPTED_IMAGE_MIME} className="hidden" onChange={handleUpload} />
      <EmojiPicker
        value={value ?? ''}
        onChange={(emoji) => onChange?.(emoji)}
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
