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
  label?: string;
}

export default function Banner({ value, onChange, onRemove, readOnly = false, label }: BannerProps) {
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

  const title = label ?? t('properties.coverImage');

  if (readOnly) {
    return (
      <div>
        <p className="label-xs mb-2">{title}</p>
        {value ? (
          <img src={value} alt="" className="w-full h-24 object-cover rounded-lg border border-stone-700/40" />
        ) : (
          <p className="text-xs text-stone-600">{t('properties.none')}</p>
        )}
      </div>
    );
  }

  return (
    <div>
      <p className="label-xs mb-2">{title}</p>
      <input ref={inputRef} type="file" accept={ACCEPTED_IMAGE_MIME} className="hidden" onChange={handleUpload} />
      {value ? (
        <div className="relative group">
          <img src={value} alt="" className="w-full h-24 object-cover rounded-lg border border-stone-700/40" />
          <div className="absolute inset-0 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity bg-stone-900/60 rounded-lg">
            <button onClick={() => inputRef.current?.click()} className="flex items-center gap-1 text-xs text-stone-200 px-2 py-1 bg-stone-800/80 rounded hover:bg-stone-700"><ImagePlus size={12} /> {t('properties.change')}</button>
            <Button onClick={() => onRemove?.()} variant="danger" className="flex items-center gap-1 px-2 py-1"><X size={12} /> {t('properties.remove')}</Button>
          </div>
        </div>
      ) : (
        <button onClick={() => inputRef.current?.click()} className="flex items-center gap-1.5 text-xs text-stone-600 hover:text-stone-400 transition-colors">
          <ImagePlus size={13} /> {t('properties.addCoverImage')}
        </button>
      )}
      {notice && <p className="text-xs text-red-400 mt-1">{notice}</p>}
    </div>
  );
}
