import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
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
import { GroupDivider } from '../ui/Dashboard';
import { AltarItemTile } from './AltarItemTile';

/** Der Abschnitt als Ganzes ist eine Einstellung, keine Arbeitsgeste — anders
 *  als die Kategorien darin (useCollapsedSet, bewusst nicht persistiert). */
const SECTION_COLLAPSED_KEY = 'altar-library-collapsed';

interface Props {
  /** Das Suchfeld des Dashboards — trifft hier den Elementnamen. */
  search: string;
  onNewElement: (categoryId?: string) => void;
  onEditElement: (item: AltarItem) => void;
}

/**
 * Die Altar-Bibliothek unter den Altären im Dashboard: 70px-Kacheln, dieselben
 * wie in der Leiste des Editors — dort zum Ziehen auf die Leinwand, hier zum
 * Bearbeiten. Sortierung und Gruppierung kommen aus dem Store, ihre Regler
 * stehen im Dashboard-Kopf.
 */
export function AltarLibrarySection({ search, onNewElement, onEditElement }: Props) {
  const { t } = useTranslation();
  const items = useAltarStore((s) => s.items);
  const allCategories = useCategoryStore((s) => s.categories);
  const { isCollapsed: isGroupCollapsed, toggle } = useCollapsedSet('altar-library');
  const [sectionCollapsed, toggleSection] = usePersistedFlag(SECTION_COLLAPSED_KEY);
  // Die Regler dazu stehen im Dashboard-Kopf (AltarView), darum im Store.
  const { sort, grouping } = useUIStore((s) => s.altarLibraryPrefs);

  const query = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    const matched = query ? items.filter((item) => item.name.toLowerCase().includes(query)) : items;
    return sortItems(matched, sort, { date: (item) => item.created_at, title: (item) => item.name });
  }, [items, query, sort]);

  // Nur Kategorien, in denen wirklich etwas liegt. `categoriesUsedBy` täte
  // seit v39 dasselbe — es nimmt das Sammelbecken nicht mehr immer mit auf —,
  // filtert aber gegen die Volliste statt gegen die schon gesuchte.
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

  const emptyHint = (
    <p className="text-xs text-stone-700 px-1 py-1">
      {query ? t('search.noResults') : t('altar.noElements')}
    </p>
  );

  const renderBody = () => {
    // Ohne Gruppen: ein Raster über alle Elemente. Die Kategorie-Köpfe
    // entfallen mitsamt ihrem „hier anlegen" — dafür steht der Knopf in der
    // Dashboard-Kopfzeile.
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
                // Waisen: ihre Kategorie liegt im Papierkorb — es gibt
                // nichts, worin man ein Element anlegen könnte.
                <CollapsibleGroupHeader
                  collapsed={isCollapsed}
                  onToggleCollapse={() => toggle(UNCATEGORIZED_KEY)}
                  emoji={ALTAR_UNCATEGORIZED_EMOJI}
                  label={group.label}
                  count={group.items.length}
                />
              )}
              {isCollapsed ? null : group.items.length === 0
                ? <p className="text-xs text-stone-700 px-1 py-1">{t('altar.noElements')}</p>
                : renderTiles(group.items)}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="mt-8">
      {/* Dieselbe Trennlinien-Überschrift wie die Timeline-Gruppen des
          Dashboards — hier mit Chevron und Zähler. */}
      <GroupDivider
        label={t('altar.libraryTitle')}
        count={filtered.length}
        collapsed={sectionCollapsed}
        onToggleCollapse={toggleSection}
      />

      {!sectionCollapsed && renderBody()}
    </div>
  );
}