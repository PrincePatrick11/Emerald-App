import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Package } from 'lucide-react';
import { useAltarStore } from '../../store/altarStore';
import { useCategoryStore } from '../../store/categoryStore';
import { useUIStore } from '../../store/uiStore';
import { categoryLabel } from '../../lib/categories';
import { ALTAR_UNCATEGORIZED_EMOJI } from '../../lib/altarConstants';
import { groupByCategory, UNCATEGORIZED_KEY } from '../../lib/groupBy';
import { sortItems } from '../../lib/sortItems';
import { useCollapsedSet } from '../../hooks/useCollapsedSet';
import { usePersistedFlag } from '../../hooks/usePersistedFlag';
import type { AltarItem } from '../../types';
import CollapsibleGroupHeader from '../ui/CollapsibleGroupHeader';
import EmptyState from '../ui/EmptyState';
import { AltarItemTile } from './AltarItemTile';

/** The section as a whole collapses with its own toggle, independently of
 *  the categories inside it (useCollapsedSet); both are kept per vault. */
const SECTION_COLLAPSED_KEY = 'altar-library-collapsed';

interface Props {
  /** The dashboard's search field; here it matches the element name. */
  search: string;
  onNewElement: (categoryId?: string) => void;
  onEditElement: (item: AltarItem) => void;
}

/**
 * The altar library below the altars in the dashboard: 70px tiles, the same
 * as in the editor's strip, where they are dragged onto the canvas and here
 * edited. Sorting and grouping come from the store, their controls
 * are in the dashboard header.
 */
export function AltarLibrarySection({ search, onNewElement, onEditElement }: Props) {
  const { t } = useTranslation();
  const items = useAltarStore((s) => s.items);
  const allCategories = useCategoryStore((s) => s.categories);
  const { isCollapsed: isGroupCollapsed, toggle } = useCollapsedSet('altar-library');
  const [sectionCollapsed, toggleSection] = usePersistedFlag(SECTION_COLLAPSED_KEY);
  // The controls for these are in the dashboard header (AltarView), hence the store.
  const { sort, grouping } = useUIStore((s) => s.altarLibraryPrefs);

  const query = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    const matched = query ? items.filter((item) => item.name.toLowerCase().includes(query)) : items;
    return sortItems(matched, sort, { date: (item) => item.created_at, title: (item) => item.name });
  }, [items, query, sort]);

  // Only categories that actually contain something. Since v39, `categoriesUsedBy`
  // would do the same (it no longer always includes the catch-all bucket),
  // but it filters against the full list instead of the already searched one.
  const categories = useMemo(() => {
    const used = new Set(filtered.map((item) => item.category_id));
    return allCategories.filter((cat) => used.has(cat.id));
  }, [allCategories, filtered]);

  const groups = groupByCategory(
    filtered, categories, (item) => item.category_id,
    (cat) => categoryLabel(t, cat), t('categories.uncategorized'),
  );

  const renderTiles = (groupItems: AltarItem[]) => (
    <div className="grid [grid-template-columns:repeat(auto-fill,70px)] gap-1.5 justify-start">
      {groupItems.map((item) => (
        <AltarItemTile key={item.id} item={item} onClick={() => onEditElement(item)} />
      ))}
    </div>
  );

  // Without a single element the library is empty, even while searching.
  // Otherwise only the search found nothing, for which the small line is enough;
  // the big "No results" is already shown above the altars.
  const emptyHint = items.length > 0
    ? <p className="text-xs text-subtle px-1 py-1">{t('search.noResults')}</p>
    : (
      <EmptyState
        icon={Package}
        title={t('emptyState.altarLibrary.title')}
        description={t('emptyState.altarLibrary.description')}
        actionLabel={t('altar.addElement')}
        onAction={() => onNewElement()}
      />
    );

  const renderBody = () => {
    // Without groups: one grid across all elements. The category headers
    // are dropped along with their "create here"; the button in the
    // dashboard header covers that.
    if (grouping === 'flat') return filtered.length === 0 ? emptyHint : renderTiles(filtered);
    if (groups.length === 0) return emptyHint;
    return (
      <div className="space-y-6">
        {groups.map((group) => {
          const isCollapsed = isGroupCollapsed(group.key!);
          const cat = group.key === UNCATEGORIZED_KEY
            ? null
            : allCategories.find((c) => c.id === group.key);
          return (
            <div key={group.key}>
              {cat ? (
                <CollapsibleGroupHeader
                  emoji={cat.emoji}
                  label={categoryLabel(t, cat)}
                  collapsed={isCollapsed}
                  onToggleCollapse={() => toggle(cat.id)}
                  count={group.items.length}
                  add={{ title: t('altar.addElement'), onClick: () => onNewElement(cat.id) }}
                />
              ) : (
                // Orphans: their category is in the trash, so there is
                // nothing to create an element in.
                <CollapsibleGroupHeader
                  collapsed={isCollapsed}
                  onToggleCollapse={() => toggle(UNCATEGORIZED_KEY)}
                  emoji={ALTAR_UNCATEGORIZED_EMOJI}
                  label={group.label}
                  count={group.items.length}
                />
              )}
              {isCollapsed ? null : group.items.length === 0
                ? <p className="text-xs text-subtle px-1 py-1">{t('altar.noElements')}</p>
                : renderTiles(group.items)}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="mt-8">
      <CollapsibleGroupHeader
        label={t('altar.libraryTitle')}
        collapsed={sectionCollapsed}
        onToggleCollapse={toggleSection}
      />

      {!sectionCollapsed && renderBody()}
    </div>
  );
}