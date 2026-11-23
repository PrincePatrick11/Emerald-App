import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Trash2 } from 'lucide-react';
import { useImageStore } from '../../store/imageStore';
import { deletePicture, placesShowing } from '../../store/imageActions';
import { useUndoStore } from '../../store/undoStore';
import { useTagStore } from '../../store/tagStore';
import { useDeepLink } from '../../hooks/useDeepLink';
import { useNewFormRequest } from '../../hooks/useNewFormRequest';
import { useFileDrop } from '../../hooks/useFileDrop';
import { AUX_VIEWS } from '../../lib/modules';
import { imageSrc } from '../../lib/images';
import { useVaultPictures, type PictureItem } from '../../hooks/useVaultPictures';
import ImageTile from '../images/ImageTile';
import ImageEditModal from '../images/ImageEditModal';
import AddImagesModal from '../images/AddImagesModal';
import { isImportPath } from '../../lib/importPaths';
import { useImportWindowStore } from '../../store/importWindowStore';
import CollectionDashboard, { useCollectionState } from './CollectionDashboard';

type ImageItem = PictureItem;

/**
 * "Images", a collection like tags and categories: every picture the
 * vault stores — added here or in texts, fields and drawings — with a name,
 * tags and a note where it has them. Cards show the picture large, the list a
 * small one beside the name. A click edits a picture; "Add images", the
 * rail's plus, or pictures dropped onto the view (import files go to the import
 * window) open the dialog that stores and names new ones.
 */
export default function ImagesView() {
  const { t } = useTranslation();
  const images = useImageStore((s) => s.images);
  const { pictures: all, loaded } = useVaultPictures();
  const allTags = useTagStore((s) => s.tags);
  const state = useCollectionState('images');
  const [editing, setEditing] = useState<(ImageItem & { confirmDelete?: boolean }) | null>(null);
  const [adding, setAdding] = useState(false);
  const [dropped, setDropped] = useState<string[]>([]);
  const pushUndo = useUndoStore((s) => s.push);
  // The rail's plus: "Image" opens this view with the dialog that adds pictures.
  useNewFormRequest(() => setAdding(true));

  // Files dropped anywhere over the view go into the add dialog, opening it.
  // Files the import window takes are its own (`useImportDrop`); while it is open, every drop is.
  const importOpen = useImportWindowStore((s) => s.open);
  const { dragOver } = useFileDrop(!editing && !importOpen, (all) => {
    const paths = all.filter((path) => !isImportPath(path));
    if (paths.length === 0) return;
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

  const usedTags = allTags.filter((tag) => all.some((i) => i.image?.tags.includes(tag.id)));
  const closeAdding = () => { setAdding(false); setDropped([]); };
  const unnamed = t('images.unnamed');

  return (
    <>
      <CollectionDashboard<ImageItem>
        state={state}
        title={t('nav.images')}
        primaryAction={{ label: t('images.add'), onClick: () => setAdding(true) }}
        items={all}
        loading={!loaded}
        itemKey={(item) => item.file}
        // Unnamed pictures sort as their placeholder, not as an empty string ahead of everything.
        itemTitle={(item) => item.image?.name || unnamed}
        // A file without a row has no date: it sorts last among the newest.
        itemDate={(item) => item.image?.created_at ?? ''}
        dateField="created"
        noTimeline
        matchesSearch={(item, q) => (item.image?.note ?? '').toLowerCase().includes(q)}
        filter={{
          label: t('nav.tags'),
          // As before: the pictures carrying every chosen tag.
          match: 'all',
          chips: usedTags.map((tag) => ({ value: tag.id, label: tag.name, test: (item) => !!item.image?.tags.includes(tag.id) })),
        }}
        cardsClassName="images-grid"
        describe={(item) => ({
          icon: (
            <img src={imageSrc(item.file)} alt="" loading="lazy" decoding="async" draggable={false}
              className="w-8 h-8 object-contain rounded-md" />
          ),
          title: item.image?.name
            ? item.image.name
            : <span className="italic text-subtle">{unnamed}</span>,
          meta: item.image?.note || undefined,
          onOpen: () => setEditing(item),
        })}
        renderItem={(item, layout, openMenu) => (layout === 'card'
          ? (
            <ImageTile
              file={item.file}
              image={item.image}
              onClick={() => setEditing(item)}
              onContextMenu={(e) => openMenu(item, e)}
            />
          )
          : undefined)}
        contextActions={(item) => [
          { label: t('images.edit'), icon: <Pencil size={12} />, onClick: () => setEditing(item) },
          // Still shown in texts: the dialog asks first. Otherwise straight away, with Undo.
          {
            label: t('contextMenu.delete'),
            icon: <Trash2 size={12} />,
            danger: true,
            onClick: () => {
              void placesShowing(item.file).then((places) => {
                if (places.length) setEditing({ ...item, confirmDelete: true });
                else void deletePicture(item.file, item.image, t('undo.imageDeleted'), pushUndo);
              });
            },
          },
        ]}
        emptyState={{
          icon: AUX_VIEWS.images.icon,
          title: t('emptyState.images.title'),
          description: t('emptyState.images.description'),
          actionLabel: t('images.add'),
          onAction: () => setAdding(true),
        }}
      />
      {adding && <AddImagesModal dropped={dropped} dragOver={dragOver} onClose={closeAdding} />}
      {editing && (
        <ImageEditModal file={editing.file} image={editing.image} confirmDelete={editing.confirmDelete} onClose={() => setEditing(null)} />
      )}
    </>
  );
}
