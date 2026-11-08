import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/shallow';
import { useImageStore } from '../../store/imageStore';
import { useCategoryStore } from '../../store/categoryStore';
import { useTagStore } from '../../store/tagStore';
import { useImageNoticeStore } from '../../store/imageNoticeStore';
import { useSessionState } from '../../store/sessionStore';
import { useDeepLink } from '../../hooks/useDeepLink';
import { useCollapsedSet } from '../../hooks/useCollapsedSet';
import CollapsibleGroupHeader from '../ui/CollapsibleGroupHeader';
import { categoryLabel } from '../../lib/categories';
import { ACCEPTED_IMAGE_MIME } from '../../lib/helpers';
import { AUX_VIEWS } from '../../lib/modules';
import type { VaultImage } from '../../types';
import Dashboard, { type DashboardGroup } from '../ui/Dashboard';
import ImageTile from '../images/ImageTile';
import ImageEditModal from '../images/ImageEditModal';

/** A picture of the view: a stored file, with its row in "Images" if it has one. */
interface ImageItem {
  file: string;
  image: VaultImage | null;
}

/** The filter value of "no category" and of the group of files without a row. */
const NONE = '__none__';
const VAULT_ONLY = '__vault__';

/**
 * "Images", a place of their own like tags and categories: every picture
 * taken in, with name, emoji, category and tags, grouped by category; on
 * request also the files the vault stores without a row (in texts, fields,
 * drawings). "Add images" takes files from the disk; a click on a picture
 * edits it, or takes a vault file in.
 */
export default function ImagesView() {
  const { t } = useTranslation();
  const { images, files, loaded } = useImageStore(useShallow((s) => ({ images: s.images, files: s.files, loaded: s.loaded })));
  const categories = useCategoryStore((s) => s.categories);
  const tagsById = useTagStore((s) => s.tags);
  const [search, setSearch] = useSessionState('images.search', '');
  const [categoryFilter, setCategoryFilter] = useSessionState<string[]>('images.categories', []);
  const [tagFilter, setTagFilter] = useSessionState<string[]>('images.tags', []);
  const [showVault, setShowVault] = useSessionState('images.vault', false);
  const [editing, setEditing] = useState<ImageItem | null>(null);
  const { isCollapsed, toggle: toggleCollapsed } = useCollapsedSet('images');
  const inputRef = useRef<HTMLInputElement>(null);

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
    const taken = new Set(images.map((i) => i.file));
    const rows = images.map((image) => ({ file: image.file, image }));
    if (!showVault) return rows;
    return [...rows, ...files.filter((f) => !taken.has(f.name)).map((f) => ({ file: f.name, image: null }))];
  }, [images, files, showVault]);

  const query = search.trim().toLowerCase();
  const matchesSearch = (item: ImageItem) => !query
    || (item.image?.name ?? '').toLowerCase().includes(query)
    || (item.image?.note ?? '').toLowerCase().includes(query)
    || item.file.toLowerCase().includes(query);
  const searched = all.filter(matchesSearch);
  const inCategory = (item: ImageItem) => !categoryFilter.length
    || categoryFilter.includes(item.image ? item.image.category_id ?? NONE : VAULT_ONLY);
  const withTags = (item: ImageItem) => !tagFilter.length || tagFilter.every((id) => item.image?.tags.includes(id));
  const shown = searched.filter((item) => inCategory(item) && withTags(item));

  const groups = useMemo<DashboardGroup<ImageItem>[]>(() => {
    const byKey = new Map<string, ImageItem[]>();
    for (const item of shown) {
      const key = item.image ? item.image.category_id ?? NONE : VAULT_ONLY;
      byKey.set(key, [...(byKey.get(key) ?? []), item]);
    }
    const ordered = [
      ...categories.filter((c) => byKey.has(c.id)).map((c) => ({ key: c.id, label: categoryLabel(t, c) })),
      ...(byKey.has(NONE) ? [{ key: NONE, label: t('images.noCategory') }] : []),
      ...(byKey.has(VAULT_ONLY) ? [{ key: VAULT_ONLY, label: t('images.vaultOnly') }] : []),
    ];
    return ordered.map(({ key, label }) => ({ key, label, items: byKey.get(key)! }));
  }, [shown, categories, t]);

  const usedCategories = categories.filter((c) => searched.some((i) => i.image?.category_id === c.id));
  const usedTags = tagsById.filter((tag) => searched.some((i) => i.image?.tags.includes(tag.id)));
  const countWhere = (fn: (item: ImageItem) => boolean) => searched.filter(fn).length;

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const { skipped, failed } = await useImageStore.getState().addFiles(Array.from(list));
    if (skipped) useImageNoticeStore.getState().show({ kind: 'format' });
    for (const e of failed) console.error('[images] adding failed:', e);
  };

  const groupEmoji = (key: string) =>
    key === NONE ? '🖼️' : key === VAULT_ONLY ? '🗄️' : categories.find((c) => c.id === key)?.emoji ?? '📁';

  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  return (
    <>
      <Dashboard<ImageItem>
        title={t('nav.images')}
        primaryAction={{ label: t('images.add'), onClick: () => inputRef.current?.click() }}
        search={search}
        onSearch={setSearch}
        view="cards"
        cardsClassName="images-grid"
        filters={{
          activeFilterCount: categoryFilter.length + tagFilter.length,
          onClearAll: () => { setCategoryFilter([]); setTagFilter([]); },
          panelProps: {
            displayToggles: [{ label: t('images.showVault'), checked: showVault, onChange: setShowVault }],
            chipLabel: t('properties.category'),
            chips: [
              ...usedCategories.map((c) => ({
                value: c.id, label: categoryLabel(t, c), count: countWhere((i) => i.image?.category_id === c.id),
              })),
              { value: NONE, label: t('images.noCategory'), count: countWhere((i) => !!i.image && !i.image.category_id) },
              ...(showVault ? [{ value: VAULT_ONLY, label: t('images.vaultOnly'), count: countWhere((i) => !i.image) }] : []),
            ],
            selectedChips: categoryFilter,
            onChipToggle: (v) => setCategoryFilter((prev) => toggle(prev, v)),
            onAllChips: () => setCategoryFilter([]),
            allChipsCount: searched.length,
            statusLabel: t('nav.tags'),
            statusChips: usedTags.map((tag) => ({
              value: tag.id, label: tag.name, count: countWhere((i) => !!i.image?.tags.includes(tag.id)),
            })),
            selectedStatus: tagFilter,
            onStatusToggle: (v) => setTagFilter((prev) => toggle(prev, v)),
            onAllStatus: () => setTagFilter([]),
            allStatusCount: searched.length,
          },
        }}
        items={shown}
        itemKey={(item) => item.file}
        renderItem={(item) => <ImageTile file={item.file} image={item.image} onClick={() => setEditing(item)} />}
        isEmpty={loaded && all.length === 0}
        emptyState={{
          icon: AUX_VIEWS.images.icon,
          title: t('emptyState.images.title'),
          description: t('emptyState.images.description'),
          actionLabel: t('images.add'),
          onAction: () => inputRef.current?.click(),
        }}
        hasNoResults={shown.length === 0}
        grouping={{
          mode: 'category',
          groups,
          isGroupCollapsed: (group) => isCollapsed(group.key!),
          renderGroupHeader: (group) => (
            <CollapsibleGroupHeader
              emoji={groupEmoji(group.key!)}
              label={group.label}
              count={group.items.length}
              collapsed={isCollapsed(group.key!)}
              onToggleCollapse={() => toggleCollapsed(group.key!)}
            />
          ),
        }}
      />
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_IMAGE_MIME}
        multiple
        className="hidden"
        onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }}
      />
      {editing && <ImageEditModal file={editing.file} image={editing.image} onClose={() => setEditing(null)} />}
    </>
  );
}
