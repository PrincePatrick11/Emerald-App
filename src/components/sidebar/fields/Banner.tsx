import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, X } from 'lucide-react';
import { ACCEPTED_IMAGE_MIME, isAcceptedImageFile } from '../../../lib/helpers';
import Button from '../../ui/Button';

interface BannerProps {
  value?: string;
  onChange?: (dataUrl: string) => void;
  onRemove?: () => void;
  readOnly?: boolean;
}

/**
 * Das Titelbild-Feld: Auswahl, Upload-Prüfung und Vorschau.
 *
 * Bewusst ohne eigene Beschriftung und ohne umschließenden Block — es steht
 * ausschließlich in `IconCoverField`, wo Icon und Titelbild sich eine
 * Überschrift und eine Knopfzeile teilen. Ein gesetztes Titelbild ist `w-full`
 * und rutscht damit im umbrechenden Flex-Container von selbst auf eine eigene
 * Zeile, während der leere Zustand als schmaler Knopf in der Zeile bleibt.
 */
export default function Banner({ value, onChange, onRemove, readOnly = false }: BannerProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isAcceptedImageFile(file)) {
      setNotice(t('common.unsupportedImageFormat'));
      window.setTimeout(() => setNotice(null), 2500);
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => onChange?.(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const preview = value
    ? <img src={value} alt="" className="w-full h-24 object-cover rounded-lg border border-stone-700/40" />
    : null;

  // Das „— Keine —" trägt `IconCoverField` für beide Felder zusammen; ein
  // eigenes hier würde es doppeln.
  if (readOnly) return preview;

  return (
    <>
      <input ref={inputRef} type="file" accept={ACCEPTED_IMAGE_MIME} className="hidden" onChange={handleUpload} />
      {value ? (
        <div className="relative group w-full">
          {preview}
          <div className="absolute inset-0 flex items-center justify-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity bg-stone-900/60 rounded-lg">
            <Button tone="neutral" small onClick={() => inputRef.current?.click()}><ImagePlus size={12} /> {t('properties.change')}</Button>
            <Button tone="danger" small onClick={() => onRemove?.()}><X size={12} /> {t('properties.remove')}</Button>
          </div>
        </div>
      ) : (
        // Nur das Stichwort, sonst passt der Knopf nicht neben die
        // Icon-Knöpfe; die volle Beschriftung sitzt im `title`.
        <Button tone="neutral" small title={t('properties.addCoverImage')} onClick={() => inputRef.current?.click()}>
          <ImagePlus size={12} /> {t('properties.coverImage')}
        </Button>
      )}
      {notice && <p className="w-full text-xs text-red-400 mt-1">{notice}</p>}
    </>
  );
}
