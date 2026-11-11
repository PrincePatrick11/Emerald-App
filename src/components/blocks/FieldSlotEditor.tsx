import { useTranslation } from 'react-i18next';
import { ImagePlus, X } from 'lucide-react';
import { imageFromSlot, imageSlotHtml, type ElementDef } from '../../lib/blocks/fields';
import { imageSrc } from '../../lib/images';
import { pickPictures } from '../../store/imagePickerStore';
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
  const filename = imageFromSlot(slot);

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
          <button type="button" className="block-insert-btn" onClick={() => onChange(null)}>
            <X size={12} />
            <span>{t('properties.remove')}</span>
          </button>
        )}
      </div>
    </div>
  );
}
