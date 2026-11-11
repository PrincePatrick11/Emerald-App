import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { searchPictures, useVaultPictures, type PictureItem } from '../../hooks/useVaultPictures';
import { ListSearchField } from '../ui/ListToolbar';
import ImageTile from './ImageTile';

/**
 * "Images" beside a canvas: the pictures to search and drag out (the
 * `imageDragState` channel), or click to place one in the middle.
 */
export default function ImageStrip({ onPick }: { onPick: (item: PictureItem) => void }) {
  const { t } = useTranslation();
  const { pictures } = useVaultPictures();
  const [search, setSearch] = useState('');
  const shown = searchPictures(pictures, search);
  return (
    <div className="image-strip">
      <ListSearchField value={search} onChange={setSearch} placeholder={t('images.searchPlaceholder')} />
      {shown.length === 0 ? (
        <p className="text-xs text-subtle py-4 text-center">{pictures.length ? t('images.noMatch') : t('images.stripEmpty')}</p>
      ) : (
        <div className="image-strip-grid">
          {shown.map((item) => (
            <ImageTile key={item.file} file={item.file} image={item.image} compact draggable onClick={() => onPick(item)} />
          ))}
        </div>
      )}
    </div>
  );
}
