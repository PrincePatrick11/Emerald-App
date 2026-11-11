import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Images, Plus, Tag as TagIcon, X } from 'lucide-react';
import { searchPictures, useVaultPictures, type PictureItem } from '../../hooks/useVaultPictures';
import { useTagStore } from '../../store/tagStore';
import { useHorizontalWheel } from '../../hooks/useHorizontalWheel';
import { ListSearchField } from '../ui/ListToolbar';
import Dropdown from '../ui/Dropdown';
import ImageTile from './ImageTile';

/**
 * "Images" below a canvas: a head with the tag filter, "+" and the search,
 * over two rows of pictures that scroll sideways. A picture is dragged out
 * (the `imageDragState` channel) or clicked to be placed in the middle. The
 * tag narrows them down (`tag`, '' for all); pictures "+" adds carry it (the
 * canvas owns the dialog, `onAdd`).
 */
export default function ImageStrip({ onPick, tag, onTagChange, onAdd }: {
  onPick: (item: PictureItem) => void;
  tag: string;
  onTagChange: (tag: string) => void;
  onAdd: () => void;
}) {
  const { t } = useTranslation();
  const { pictures } = useVaultPictures();
  const tags = useTagStore((s) => s.tags);
  const [search, setSearch] = useState('');
  const shown = searchPictures(pictures, search).filter((item) => !tag || item.image?.tags.includes(tag));
  const gridRef = useRef<HTMLDivElement>(null);
  const tagOptions = useMemo(() => [
    { value: '', label: t('images.allTags') },
    ...[...tags].sort((a, b) => a.name.localeCompare(b.name)).map((x) => ({ value: x.id, label: x.name })),
  ], [tags, t]);

  // The grid is only rendered while there are pictures.
  useHorizontalWheel(gridRef, [shown.length > 0]);
  return (
    <div className="image-strip">
      <div className="image-strip-head">
        <Images size={14} className="text-subtle flex-shrink-0" />
        <span className="image-strip-title">{t('nav.images')}</span>
        <span className="image-strip-count">{shown.length}</span>
        <button type="button" className="image-strip-add" onClick={onAdd} title={t('images.add')} aria-label={t('images.add')}>
          <Plus size={14} />
        </button>
        <div className="image-strip-tools">
          {tags.length > 0 && (
            <div className={`image-strip-tag${tag ? ' image-strip-tag--on' : ''}`}>
              <Dropdown
                value={tag}
                options={tagOptions}
                onChange={onTagChange}
                align="right"
                portal
                trigger={({ open, toggle, selectedLabel }) => (
                  <button type="button" onClick={toggle} aria-haspopup="listbox" aria-expanded={open} className="image-strip-tag-trigger">
                    <TagIcon size={12} className="flex-shrink-0" />
                    <span className="truncate">{selectedLabel}</span>
                    {!tag && <ChevronDown size={12} className="flex-shrink-0" />}
                  </button>
                )}
              />
              {tag && (
                <button
                  type="button"
                  className="image-strip-tag-clear"
                  onClick={() => onTagChange('')}
                  title={t('images.clearTag')}
                  aria-label={t('images.clearTag')}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )}
          <ListSearchField value={search} onChange={setSearch} placeholder={t('images.searchPlaceholder')} className="image-strip-search" />
        </div>
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
