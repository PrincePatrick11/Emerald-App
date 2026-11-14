import { useTranslation } from 'react-i18next';
import { Shapes, type LucideIcon } from 'lucide-react';
import SegmentedControl from '../../ui/SegmentedControl';
import { MODULE_LIST, isEntryView, type EntryModuleId } from '../../../lib/modules';
import { matchesFilter } from '../../../lib/dashboards';
import { startCategoryOf } from '../../../lib/createItem';
import { EditPropertyRow } from './EditProperties';
import { useUIStore, withEditLock } from '../../../store/uiStore';
import { useEntryStore } from '../../../store/entryStore';
import { builtinDashboard, useDashboardStore } from '../../../store/dashboardStore';
import { carryBaseline, pendingEntryWrites } from '../../../store/entryEdit';
import { viewOfEntry } from '../../../store/entryViews';
import { guardKey, isEnding } from '../../../store/leaveGuardStore';
import type { Entry } from '../../../types';

type Area = 'journal' | 'operations' | 'wiki';

// The modules with a block stack, in rail order and with their rail glyphs: journal, operations, wiki.
const AREAS = MODULE_LIST.filter((meta) => meta.usesBlocks) as (typeof MODULE_LIST[number] & { id: Area })[];
const ICONS = Object.fromEntries(AREAS.map((meta) => [meta.id, meta.icon])) as Record<Area, LucideIcon>;

/**
 * Moves the entry into the module `to`: it takes the first category of that
 * module's dashboard — unless its category already belongs there — and its
 * tabs follow. Inside an edit the edit goes on in the new view, and Cancel
 * brings category and tab back (`useEntryEditor`).
 */
async function moveToArea(entry: Entry, from: EntryModuleId, to: Area): Promise<void> {
  await withEditLock(async () => {
    // An icon still being shrunk belongs to the edit before the move.
    await pendingEntryWrites(entry.id);
    await useUIStore.getState().editActions?.flush?.();
    const current = useEntryStore.getState().getEntry(entry.id);
    if (!current) return;
    const dashboard = builtinDashboard(useDashboardStore.getState().dashboards, to);
    if (!dashboard || !matchesFilter(current, dashboard.filter)) {
      await useEntryStore.getState().updateEntry(entry.id, { category_id: startCategoryOf(to) });
    }
    carryBaseline(entry.id, from, to);
    useUIStore.getState().moveEntryViews(entry.id, from, to);
  });
}

/**
 * Which module an entry belongs to, when editing: the first property, as
 * segments instead of a value button. An entry has no type — the choice sets
 * its category to the first one of that module's dashboard, so a choice here
 * is a change of category the category row below shows at once.
 */
export default function EntryAreaField({ entry }: { entry: Entry }) {
  const { t } = useTranslation();
  // The edit lock: while the move writes, the sidebar of the new module redraws this row.
  const locked = useUIStore((s) => s.editLocked);
  const view = useUIStore((s) => s.activeView.type);
  // Re-renders with the dashboards: the area follows from their filters.
  useDashboardStore((s) => s.modules);
  const area = viewOfEntry(entry);

  const select = (to: Area) => {
    // Asked of the store, not of the rendered state: the lock applies from the click.
    // Likewise while the page is ending (`isEnding`).
    if (useUIStore.getState().editLocked || !isEntryView(view) || isEnding(guardKey(view, entry.id))) return;
    if (to === area && to === view) return;
    moveToArea(entry, view, to).catch((e: unknown) => console.error('[EntryAreaField] moving the entry failed:', e));
  };

  return (
    <EditPropertyRow icon={<Shapes size={14} />} label={t('properties.area')}>
      <SegmentedControl
        ariaLabel={t('properties.area')}
        options={AREAS.map((meta) => {
          const Icon = ICONS[meta.id];
          return { value: meta.id, label: t(meta.navLabelKey), icon: <Icon size={14} /> };
        })}
        value={area}
        onChange={select}
        disabled={locked}
      />
    </EditPropertyRow>
  );
}
