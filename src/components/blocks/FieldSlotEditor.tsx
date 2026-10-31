import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, X } from 'lucide-react';
import { imageFromSlot, imageSlotHtml, type ElementDef } from '../../lib/blocks/fields';
import { imageSrc, saveImage } from '../../lib/images';
import { ACCEPTED_IMAGE_MIME, isAcceptedImageFile, readFileAsDataUrl } from '../../lib/helpers';
import { prepareImageDataUrl } from '../../lib/imageLimits';
import { reportImageError } from '../../store/imageNoticeStore';
import { LinkEditor } from './BlockLink';
import { AltarFieldEditor } from './AltarField';

/**
 * The inputs for the element kinds whose value sits in the markup: link,
 * image, altar. The value is the slot content (link chip or `<img>`);
 * `onChange(null)` clears it. Shared by the field block in edit mode and
 * by the defaults in the block builder of the blocks view; the counterpart to
 * `FieldValueEditor` for the values in the JSON.
 */
export default function FieldSlotEditor({ element, slot, onChange }: {
  element: ElementDef;
  slot: string | undefined;
  onChange: (html: string | null) => void;
}) {
  switch (element.kind) {
    case 'link':
      return <LinkEditor slot={slot} onChange={onChange} />;
    case 'altar':
      return <AltarFieldEditor slot={slot} onChange={onChange} />;
    case 'image':
      return <ImageEditor slot={slot} onChange={onChange} />;
    default:
      return null;
  }
}

function ImageEditor({ slot, onChange }: { slot: string | undefined; onChange: (html: string | null) => void }) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const filename = imageFromSlot(slot);

  const showError = (key: string) => {
    setError(key);
    window.setTimeout(() => setError(null), 2500);
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!isAcceptedImageFile(file)) {
      showError('common.unsupportedImageFormat');
      return;
    }
    try {
      onChange(imageSlotHtml(await saveImage(await prepareImageDataUrl(await readFileAsDataUrl(file)))));
    } catch (e) {
      if (!reportImageError(e, 'field')) showError('blocks.fields.imageFailed');
    }
  };

  return (
    <div className="block-image-field">
      {filename && <img src={imageSrc(filename)} alt="" className="block-field-image" />}
      <div className="flex items-center gap-2">
        {/* "Change"/"Remove" like the other image pickers (Favicon, MediaPropertyRow);
            only the empty state says "Choose image"; "Add cover image"
            would be wrong here. */}
        <button type="button" className="block-insert-btn" onClick={() => inputRef.current?.click()}>
          <ImagePlus size={12} />
          <span>{filename ? t('properties.change') : t('blocks.fields.chooseImage')}</span>
        </button>
        {filename && (
          <button type="button" className="block-insert-btn" onClick={() => onChange(null)}>
            <X size={12} />
            <span>{t('properties.remove')}</span>
          </button>
        )}
        {error && <span className="block-field-error">{t(error)}</span>}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_IMAGE_MIME}
        className="hidden"
        onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }}
      />
    </div>
  );
}
