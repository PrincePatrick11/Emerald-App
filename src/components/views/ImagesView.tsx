import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/shallow';
import { useImageStore } from '../../store/imageStore';
import { useTagStore } from '../../store/tagStore';
import { useSessionState } from '../../store/sessionStore';
import { useDeepLink } from '../../hooks/useDeepLink';
import { useFileDrop } from '../../hooks/useFileDrop';
import { AUX_VIEWS } from '../../lib/modules';
import type { VaultImage } from '../../types';
import Dashboard from '../ui/Dashboard';
import ImageTile from '../images/ImageTile';
import ImageEditModal from '../images/ImageEditModal';
import AddImagesModal from '../images/AddImagesModal';

/** A picture of the view: a stored file, with its details if it has any. */
interface ImageItem {
  file: string;
  image: VaultImage | null;
}

/** Named pictures by name, then the unnamed ones, newest details first among equals. */
function byName(a: ImageItem, b: ImageItem): number {
  const an = a.image?.name ?? '';
  const bn = b.image?.name ?? '';
  if (!an !== !bn) return an ? -1 : 1;
  return an.localeCompare(bn) || a.file.localeCompare(b.file);
}

/**
 * "Images", a place of their own like tags and categories: every picture the
 * vault stores — added here or in texts, fields and drawings — with a name,
 * tags and a note where it has them. A click edits a picture; "Add images",
 * or files dropped onto the view, open the dialog that stores and names new ones.
 */
export default function ImagesView() {
  const { t } = useTranslation();
  const { images, files, loaded } = useImageStore(useShallow((s) => ({ images: s.images, files: s.files, loaded: s.loaded })));
  const allTags = useTagStore((s) => s.tags);
  const [search, setSearch] = useSessionState('images.search', '');
  const [tagFilter, setTagFilter] = useSessionState<string[]>('images.tags', []);
  const [editing, setEditing] = useState<ImageItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [dropped, setDropped] = useState<string[]>([]);

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

  // The folder can have changed since the vault opened (texts, drawings).
  useEffect(() => { void useImageStore.getState().refreshFiles(); }, []);

  const all = useMemo<ImageItem[]>(() => {
    const byFile = new Map(images.map((image) => [image.file, image]));
    const listed = new Set<string>();
    const items: ImageItem[] = [];
    for (const { name } of files) {
      listed.add(name);
      items.push({ file: name, image: byFile.get(name) ?? null });
    }
    // Details whose file the folder did not list (yet): still shown.
    for (const image of images) if (!listed.has(image.file)) items.push({ file: image.file, image });
    return items.sort(byName);
  }, [images, files]);

  const query = search.trim().toLowerCase();
  const searched = all.filter((item) => !query
    || (item.image?.name ?? '').toLowerCase().includes(query)
    || (item.image?.note ?? '').toLowerCase().includes(query));
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
        renderItem={(item) => <ImageTile file={item.file} image={item.image} onClick={() => setEditing(item)} />}
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
      {editing && <ImageEditModal file={editing.file} image={editing.image} onClose={() => setEditing(null)} />}
    </>
  );
}
