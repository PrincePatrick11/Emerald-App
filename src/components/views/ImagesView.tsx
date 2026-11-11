import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Trash2 } from 'lucide-react';
import { useImageStore } from '../../store/imageStore';
import { deletePicture, placesShowing } from '../../store/imageActions';
import { useUndoStore } from '../../store/undoStore';
import { useTagStore } from '../../store/tagStore';
import { useSessionState } from '../../store/sessionStore';
import { useDeepLink } from '../../hooks/useDeepLink';
import { useFileDrop } from '../../hooks/useFileDrop';
import { AUX_VIEWS } from '../../lib/modules';
import { searchPictures, useVaultPictures, type PictureItem } from '../../hooks/useVaultPictures';
import Dashboard from '../ui/Dashboard';
import ContextMenu from '../ui/ContextMenu';
import ImageTile from '../images/ImageTile';
import ImageEditModal from '../images/ImageEditModal';
import AddImagesModal from '../images/AddImagesModal';

type ImageItem = PictureItem;

/**
 * "Images", a place of their own like tags and categories: every picture the
 * vault stores — added here or in texts, fields and drawings — with a name,
 * tags and a note where it has them. A click edits a picture; "Add images",
 * or files dropped onto the view, open the dialog that stores and names new ones.
 */
export default function ImagesView() {
  const { t } = useTranslation();
  const images = useImageStore((s) => s.images);
  const { pictures: all, loaded } = useVaultPictures();
  const allTags = useTagStore((s) => s.tags);
  const [search, setSearch] = useSessionState('images.search', '');
  const [tagFilter, setTagFilter] = useSessionState<string[]>('images.tags', []);
  const [editing, setEditing] = useState<(ImageItem & { confirmDelete?: boolean }) | null>(null);
  const [adding, setAdding] = useState(false);
  const [dropped, setDropped] = useState<string[]>([]);
  const [menu, setMenu] = useState<{ item: ImageItem; x: number; y: number } | null>(null);
  const pushUndo = useUndoStore((s) => s.push);

  // Files dropped anywhere over the view go into the add dialog, opening it.
  const { dragOver } = useFileDrop(!editing, (paths) => {
    setDropped((list) => [...list, ...paths]);
    setAdding(true);
  });

  // A search hit opens its picture.
  useDeepLink({
    type: 'images',
    items: images,
    rowAttribute: 'data-image-id',
    onOpen: (image) => setEditing({ file: image.file, image }),
  });

  const searched = searchPictures(all, search);
  const shown = searched.filter((item) => tagFilter.every((id) => item.image?.tags.includes(id)));
  const usedTags = allTags.filter((tag) => searched.some((i) => i.image?.tags.includes(tag.id)));

  const closeAdding = () => { setAdding(false); setDropped([]); };

  return (
    <>
      <Dashboard<ImageItem>
        title={t('nav.images')}
        primaryAction={{ label: t('images.add'), onClick: () => setAdding(true) }}
        search={search}
        onSearch={setSearch}
        view="cards"
        cardsClassName="images-grid"
        filters={usedTags.length ? {
          activeFilterCount: tagFilter.length,
          onClearAll: () => setTagFilter([]),
          panelProps: {
            chipLabel: t('nav.tags'),
            chips: usedTags.map((tag) => ({
              value: tag.id, label: tag.name, count: searched.filter((i) => i.image?.tags.includes(tag.id)).length,
            })),
            selectedChips: tagFilter,
            onChipToggle: (v) => setTagFilter((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])),
            onAllChips: () => setTagFilter([]),
            allChipsCount: searched.length,
          },
        } : undefined}
        items={shown}
        itemKey={(item) => item.file}
        renderItem={(item) => (
          <ImageTile
            file={item.file}
            image={item.image}
            onClick={() => setEditing(item)}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ item, x: e.clientX, y: e.clientY }); }}
          />
        )}
        contextMenuSlot={menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(null)}
            actions={[
              { label: t('images.edit'), icon: <Pencil size={12} />, onClick: () => setEditing(menu.item) },
              // Still shown in texts: the dialog asks first. Otherwise straight away, with Undo.
              {
                label: t('contextMenu.delete'),
                icon: <Trash2 size={12} />,
                danger: true,
                onClick: () => {
                  const { item } = menu;
                  void placesShowing(item.file).then((places) => {
                    if (places.length) setEditing({ ...item, confirmDelete: true });
                    else void deletePicture(item.file, item.image, t('undo.imageDeleted'), pushUndo);
                  });
                },
              },
            ]}
          />
        )}
        isEmpty={loaded && all.length === 0}
        emptyState={{
          icon: AUX_VIEWS.images.icon,
          title: t('emptyState.images.title'),
          description: t('emptyState.images.description'),
          actionLabel: t('images.add'),
          onAction: () => setAdding(true),
        }}
        hasNoResults={shown.length === 0}
        grouping={{ mode: 'flat' }}
      />
      {adding && <AddImagesModal dropped={dropped} dragOver={dragOver} onClose={closeAdding} />}
      {editing && (
        <ImageEditModal file={editing.file} image={editing.image} confirmDelete={editing.confirmDelete} onClose={() => setEditing(null)} />
      )}
    </>
  );
}
