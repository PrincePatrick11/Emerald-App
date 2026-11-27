import { useTranslation } from 'react-i18next';
import { ImagePlus, X } from 'lucide-react';
import { storedString } from '../../../lib/blocks/fieldKinds/fieldKind';
import { imageSlotHtml } from '../../../lib/blocks/fieldKinds/image';
import { imageFromSlot } from '../../../lib/blocks/toolkit';
import { imageSrc } from '../../../lib/images';
import { pickPictures } from '../../../store/imagePickerStore';
import type { FieldKindView } from './fieldKindView';

export const imageFieldView: FieldKindView = {
  Input: function ImageInput({ stored, onChange }) {
    const { t } = useTranslation();
    const filename = imageFromSlot(storedString(stored));

    // One picture, from "Images" or from the disk (the picture picker).
    const pick = async () => {
      const [file] = (await pickPictures({ multiple: false })) ?? [];
      if (file) onChange(imageSlotHtml(file));
    };

    return (
      <div className="block-image-field">
        {filename && <img src={imageSrc(filename)} alt="" className="block-field-image" />}
        <div className="flex items-center gap-2">
          {/* "Change"/"Remove" like the other image pickers (Favicon, MediaPropertyRow);
              only the empty state says "Choose image"; "Add cover image"
              would be wrong here. */}
          <button type="button" className="block-insert-btn" onClick={() => void pick()}>
            <ImagePlus size={12} />
            <span>{filename ? t('properties.change') : t('blocks.fields.chooseImage')}</span>
          </button>
          {filename && (
            <button type="button" className="block-insert-btn" onClick={() => onChange(undefined)}>
              <X size={12} />
              <span>{t('properties.remove')}</span>
            </button>
          )}
        </div>
      </div>
    );
  },
  Read: ({ stored }) => {
    const filename = imageFromSlot(storedString(stored));
    return filename ? <img src={imageSrc(filename)} alt="" className="block-field-image" /> : null;
  },
};
