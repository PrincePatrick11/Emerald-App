import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus } from 'lucide-react';
import { ACCEPTED_IMAGE_MIME, isAcceptedImageFile, isImageIcon } from '../../../lib/helpers';
import EmojiPicker from '../../ui/EmojiPicker';
import Button from '../../ui/Button';

export function FaviconGlyph({ value, size = 'sm' }: { value?: string | null; size?: 'sm' | 'lg' }) {
  if (!value) return null;
  const cls = size === 'lg' ? 'w-10 h-10 text-4xl' : 'w-5 h-5 text-base';
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
  label?: string;
}

export default function Favicon({ value, onChange, onRemove, readOnly = false, label }: FaviconProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isAcceptedImageFile(file) || file.type === 'image/svg+xml') { e.target.value = ''; return; }
    const reader = new FileReader();
    reader.onloadend = () => onChange?.(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  if (readOnly) {
    return (
      <div>
        {label && <p className="label-xs mb-2">{label}</p>}
        {value ? <FaviconGlyph value={value} size="lg" /> : <p className="text-xs text-stone-600">{t('properties.none')}</p>}
      </div>
    );
  }

  return (
    <div>
      {label && <p className="label-xs mb-2">{label}</p>}
      <input ref={inputRef} type="file" accept={ACCEPTED_IMAGE_MIME} className="hidden" onChange={handleUpload} />
      <EmojiPicker
        value={value ?? ''}
        onChange={(emoji) => onChange?.(emoji)}
        trigger={({ toggle }) =>
          value ? (
            <div className="flex items-center gap-2">
              <FaviconGlyph value={value} size="lg" />
              <div className="flex flex-col gap-0.5">
                <button onClick={() => inputRef.current?.click()} className="text-xs text-stone-500 hover:text-stone-300 transition-colors text-left">{t('wiki.changeIcon')}</button>
                <button onClick={toggle} className="text-xs text-stone-500 hover:text-stone-300 transition-colors text-left">{t('altar.chooseEmoji')}</button>
                <Button onClick={() => onRemove?.()} variant="danger" className="text-xs text-left">{t('wiki.removeIcon')}</Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <button onClick={() => inputRef.current?.click()} className="flex items-center gap-1.5 text-xs text-stone-600 hover:text-stone-400 transition-colors">
                <ImagePlus size={13} /> {t('wiki.addIcon')}
              </button>
              <button onClick={toggle} className="flex items-center gap-1.5 text-xs text-stone-600 hover:text-stone-400 transition-colors">
                ✨ {t('altar.chooseEmoji')}
              </button>
            </div>
          )
        }
      />
    </div>
  );
}
