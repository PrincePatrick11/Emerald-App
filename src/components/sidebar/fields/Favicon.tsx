import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, Smile, X } from 'lucide-react';
import { ACCEPTED_IMAGE_MIME, isImageIcon } from '../../../lib/helpers';
import EmojiPicker from '../../ui/EmojiPicker';
import { readIconFile } from '../../../lib/imageLimits';
import { reportImageError } from '../../../store/imageNoticeStore';
import Button from '../../ui/Button';

/**
 * Just the glyph, without selection. Default 20px, the size of a
 * row meta entry; `className` replaces the size where the icon should be
 * large (the altar card, when it replaces the preview).
 *
 * The one place that knows an icon is either an image or an emoji;
 * whoever decides that themselves forgets the emoji half.
 */
export function FaviconGlyph({ value, className = 'w-5 h-5 text-base' }: {
  value?: string | null;
  className?: string;
}) {
  if (!value) return null;
  return isImageIcon(value) ? (
    <img src={value} alt="" className={`${className} object-contain rounded border border-stone-700/40 flex-shrink-0`} />
  ) : (
    <span className={`${className} leading-none flex items-center justify-center flex-shrink-0`}>{value}</span>
  );
}

interface FaviconProps {
  value?: string | null;
  onChange?: (value: string) => void;
  onRemove?: () => void;
}

/**
 * The icon field: glyph plus the three actions (choose image, choose emoji,
 * remove) in one row.
 *
 * Returns only this row, without a label; the callers bring that
 * themselves: `IconField` (a language's page) its heading, the
 * altar its own collapsible header. The edit sidebar of
 * entries and library pages uses `MediaPropertyRow` instead. For editing only; reading
 * goes through `FaviconGlyph`.
 *
 * The actions are tone-coded `Button`s in the dense 24px size, as the
 * category headers use them. Labelled with just the keyword;
 * the spelled-out form is in the `title`.
 */
export default function Favicon({ value, onChange, onRemove }: FaviconProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const pickFile = () => inputRef.current?.click();

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const icon = await readIconFile(file);
      if (icon) onChange?.(icon);
    } catch (err) {
      // Better to set nothing at all than an empty icon: an aborted read
      // has no result, and the previous value is better than none.
      reportImageError(err, 'icon');
    }
  };

  return (
    <>
      <input ref={inputRef} type="file" accept={ACCEPTED_IMAGE_MIME} className="hidden" onChange={handleUpload} />
      <EmojiPicker
        value={value ?? ''}
        onChange={(emoji) => onChange?.(emoji)}
        // Not the `flex-shrink-0` default: otherwise the button row below
        // could never wrap, but would run out of the sidebar in a long
        // language.
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
            {/* Remove as an icon only: with a label the row would run out of the
                sidebar, and the X is unambiguous enough for a destructive
                row action. */}
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
