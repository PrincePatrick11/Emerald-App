import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Images } from 'lucide-react';
import { searchPictures, useVaultPictures, type PictureItem } from '../../hooks/useVaultPictures';
import { ListSearchField } from '../ui/ListToolbar';
import ImageTile from './ImageTile';

/**
 * "Images" below a canvas, two rows that scroll sideways under a head with the search: the pictures to search and drag out (the
 * `imageDragState` channel), or click to place one in the middle.
 */
export default function ImageStrip({ onPick }: { onPick: (item: PictureItem) => void }) {
  const { t } = useTranslation();
  const { pictures } = useVaultPictures();
  const [search, setSearch] = useState('');
  const shown = searchPictures(pictures, search);
  const gridRef = useRef<HTMLDivElement>(null);

  // A plain wheel scrolls the row sideways, not the page; a trackpad does so by itself.
  // A listener of its own: React's wheel listener is passive and cannot stop the page.
  const hasGrid = shown.length > 0;
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || grid.scrollWidth <= grid.clientWidth) return;
      e.preventDefault();
      grid.scrollLeft += e.deltaY;
    };
    grid.addEventListener('wheel', onWheel, { passive: false });
    return () => grid.removeEventListener('wheel', onWheel);
  }, [hasGrid]);
  return (
    <div className="image-strip">
      <div className="image-strip-head">
        <Images size={14} className="text-subtle flex-shrink-0" />
        <span className="image-strip-title">{t('nav.images')}</span>
        <span className="image-strip-count">{shown.length}</span>
        <ListSearchField value={search} onChange={setSearch} placeholder={t('images.searchPlaceholder')} className="image-strip-search" />
      </div>
      {shown.length === 0 ? (
        <p className="text-xs text-subtle py-6 text-center">{pictures.length ? t('images.noMatch') : t('images.stripEmpty')}</p>
      ) : (
        <div ref={gridRef} className="image-strip-grid">
          {shown.map((item) => (
            <ImageTile key={item.file} file={item.file} image={item.image} compact draggable onClick={() => onPick(item)} />
          ))}
        </div>
      )}
    </div>
  );
}
