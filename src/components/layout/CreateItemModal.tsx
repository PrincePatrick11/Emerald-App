import { useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { createEntryIn, createItem } from '../../lib/createItem';
import { categoryLabel } from '../../lib/categories';
import { dashboardLabel } from '../../lib/dashboards';
import { AUX_VIEWS, CREATABLE_VIEWS, DEFAULT_DASHBOARD_ICON, ENTRY_ICON } from '../../lib/modules';
import { useCategoryStore } from '../../store/categoryStore';
import { useDashboardStore } from '../../store/dashboardStore';
import { createDashboardAndOpen } from '../../store/dashboardActions';
import DashboardGlyph from '../ui/DashboardGlyph';
import Modal from '../ui/Modal';
import SearchField from '../ui/SearchField';
import type { Category, Dashboard } from '../../types';

interface Tile {
  key: string;
  label: string;
  icon: ReactNode;
  create: () => Promise<void>;
}

interface Group {
  key: string;
  title: string;
  icon?: ReactNode;
  tiles: Tile[];
}

/** Lower case and without accents: "kra" finds "Kräuter", "medi" "Méditation". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

const CategoryIcon = AUX_VIEWS.categories.icon;

function categoryIcon(category: Category): ReactNode {
  return category.emoji
    ? <span aria-hidden className="text-base leading-4">{category.emoji}</span>
    : <CategoryIcon size={16} />;
}

/**
 * The groups of tiles, top to bottom: each dashboard in rail order with a tile
 * per category of its filter (in the categories' own order; "All entries"
 * with one for an entry without a category, a dashboard filtering by tags
 * alone with one for an entry there), the categories no dashboard names, and
 * last everything else that can be created.
 */
function useGroups(): Group[] {
  const { t } = useTranslation();
  const dashboards = useDashboardStore((s) => s.dashboards);
  const categories = useCategoryStore((s) => s.categories);
  const all = dashboards.find((d) => d.builtin === 'all');
  const entryTile = (dashboard: Dashboard, category?: Category): Tile => {
    const withoutCategory = t(dashboard.builtin === 'all' ? 'categories.uncategorized' : 'createItem.entry');
    return {
      key: `entry:${dashboard.id}:${category?.id ?? ''}`,
      label: category ? categoryLabel(t, category) : withoutCategory,
      icon: category ? categoryIcon(category) : <ENTRY_ICON size={16} />,
      create: () => createEntryIn(dashboard.id, { categoryId: category?.id }),
    };
  };

  const groups: Group[] = dashboards.flatMap((d) => {
    const rule = d.filter.categories;
    // A category rule with none left alive matches nothing: no entry could be made there.
    const tiles = rule?.length
      ? categories.filter((c) => rule.includes(c.id)).map((c) => entryTile(d, c))
      : [entryTile(d)];
    return tiles.length ? [{ key: d.id, title: dashboardLabel(t, d), icon: <DashboardGlyph dashboard={d} size={14} />, tiles }] : [];
  });

  const shownSomewhere = new Set(dashboards.flatMap((d) => d.filter.categories ?? []));
  const inNoDashboard = categories.filter((c) => !shownSomewhere.has(c.id));
  if (all && inNoDashboard.length) {
    groups.push({ key: 'more-categories', title: t('createItem.moreCategories'), tiles: inNoDashboard.map((c) => entryTile(all, c)) });
  }

  groups.push({
    key: 'collections',
    title: t('createItem.collections'),
    tiles: [
      ...CREATABLE_VIEWS.map(({ id, icon: Icon, labelKey }) => ({ key: id, label: t(labelKey), icon: <Icon size={16} />, create: () => createItem(id) })),
      // The word the app uses for a dashboard everywhere; no `createItem.kind` copy of it.
      { key: 'new-dashboard', label: t('dashboards.dashboard'), icon: <DEFAULT_DASHBOARD_ICON size={16} />, create: createDashboardAndOpen },
    ],
  });
  return groups;
}

/** The nearest tile in the next row above or below `from`, by its centre: groups break the grid. */
function tileInNextRow(tiles: HTMLElement[], from: HTMLElement, down: boolean): HTMLElement | undefined {
  const at = from.getBoundingClientRect();
  const centre = at.left + at.width / 2;
  const rows = tiles
    .map((el) => ({ el, rect: el.getBoundingClientRect() }))
    .filter(({ rect }) => (down ? rect.top >= at.bottom - 1 : rect.bottom <= at.top + 1));
  if (!rows.length) return undefined;
  const rowTop = down ? Math.min(...rows.map((r) => r.rect.top)) : Math.max(...rows.map((r) => r.rect.top));
  return rows
    .filter((r) => Math.abs(r.rect.top - rowTop) < 1)
    .sort((a, b) => Math.abs(a.rect.left + a.rect.width / 2 - centre) - Math.abs(b.rect.left + b.rect.width / 2 - centre))[0]?.el;
}

/**
 * What the rail's plus opens: an entry in any category, grouped under the
 * dashboards that show it, and everything else that can be created. Typing
 * filters the tiles (by their name or their group's); the arrow keys move
 * through them, Enter takes the focused one — in the search field the first.
 */
export default function CreateItemModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const fieldRef = useRef<HTMLInputElement>(null);
  const tilesRef = useRef<HTMLDivElement>(null);
  // The height the tiles open with stays while filtering: the window keeps its
  // size and place, so the search field does not jump while typing.
  const [tilesHeight, setTilesHeight] = useState<number>();
  useLayoutEffect(() => setTilesHeight(tilesRef.current?.offsetHeight), []);
  const [fieldFocused, setFieldFocused] = useState(true);

  const query = fold(search.trim());
  const groups = useGroups()
    .map((g) => (!query || fold(g.title).includes(query) ? g : { ...g, tiles: g.tiles.filter((tile) => fold(tile.label).includes(query)) }))
    .filter((g) => g.tiles.length);
  const first = groups[0]?.tiles[0];

  const tileElements = () => [...(tilesRef.current?.querySelectorAll<HTMLButtonElement>('.create-item-tile') ?? [])];

  // The modal goes first: leaving an open edit may ask its own question.
  const choose = (tile: Tile) => {
    onClose();
    tile.create().catch((err: unknown) => console.error('[CreateItemModal] creating failed:', err));
  };

  // A press on a header or the padding takes the focus to nowhere, and with it
  // the keys: it goes back to where it was. After the event, since the
  // browser only then settles where the focus lands.
  const keepFocus = (e: FocusEvent<HTMLElement>) => {
    const from = e.currentTarget;
    setTimeout(() => {
      if (document.activeElement === document.body) from.focus();
    });
  };

  const onFieldKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && first) {
      e.preventDefault();
      choose(first);
    } else if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      tileElements()[0]?.focus();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const tiles = tileElements();
      tiles[tiles.length - 1]?.focus();
    }
  };

  const onTileKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tiles = tileElements();
    const index = tiles.indexOf(e.currentTarget);
    const field = fieldRef.current;
    let target: HTMLElement | null | undefined;
    if (e.key === 'ArrowLeft') target = tiles[index - 1] ?? tiles[tiles.length - 1];
    else if (e.key === 'ArrowRight') target = tiles[index + 1] ?? tiles[0];
    else if (e.key === 'ArrowDown') target = tileInNextRow(tiles, e.currentTarget, true);
    else if (e.key === 'ArrowUp') target = tileInNextRow(tiles, e.currentTarget, false) ?? field;
    // Tab runs through the field and the tiles in a ring: `Modal` holds no focus.
    else if (e.key === 'Tab') target = e.shiftKey ? (tiles[index - 1] ?? field) : (tiles[index + 1] ?? field);
    // Typing on a tile goes on in the search.
    else if (e.key === 'Backspace') {
      setSearch((s) => s.slice(0, -1));
      target = field;
    } else if (e.key.length === 1 && e.key !== ' ') {
      setSearch((s) => s + e.key);
      target = field;
    } else return;
    e.preventDefault();
    target?.focus();
  };

  return (
    <Modal
      title={t('createItem.title')}
      onClose={onClose}
      widthClassName="w-[620px] max-w-full"
      maxHeightClassName="max-h-[85vh]"
      bodyClassName="flex min-h-0 flex-1 flex-col"
    >
      <div className="px-3.5 pt-3.5">
        <SearchField
          inputRef={fieldRef}
          value={search}
          onValueChange={setSearch}
          // Typing right away filters; Enter on the open modal takes the first tile.
          autoFocus
          placeholder={t('createItem.search')}
          aria-label={t('createItem.search')}
          onKeyDown={onFieldKeyDown}
          onFocus={() => setFieldFocused(true)}
          onBlur={(e) => { setFieldFocused(false); keepFocus(e); }}
        />
      </div>
      <div ref={tilesRef} style={{ minHeight: tilesHeight }} className="modal-body min-h-0 flex-1 overflow-y-auto space-y-4 pt-3">
        {groups.length === 0 && <p className="text-xs text-subtle py-6 text-center">{t('search.noResults')}</p>}
        {groups.map((group) => (
          <section key={group.key} aria-label={group.title}>
            <h3 className="create-item-group label-xs">
              {group.icon}
              <span className="min-w-0 truncate">{group.title}</span>
            </h3>
            <div className="grid grid-cols-4 gap-2">
              {group.tiles.map((tile) => (
                <button
                  key={tile.key}
                  type="button"
                  onClick={() => choose(tile)}
                  onKeyDown={onTileKeyDown}
                  onBlur={keepFocus}
                  className={`panel-interactive create-item-tile${fieldFocused && tile === first ? ' is-default' : ''}`}
                >
                  {tile.icon}
                  <span className="min-w-0 max-w-full truncate">{tile.label}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  );
}
