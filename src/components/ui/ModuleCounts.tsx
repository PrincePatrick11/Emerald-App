import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import { ENTRY_ICON, TASKS_VIEW, type ContentModuleId } from '../../lib/modules';

const COLUMNS: Record<ContentModuleId, { icon: LucideIcon; labelKey: string }> = {
  entries: { icon: ENTRY_ICON, labelKey: 'entries.label' },
  tasks: { icon: TASKS_VIEW.icon, labelKey: TASKS_VIEW.navLabelKey },
};

interface Props<M extends ContentModuleId> {
  /** Columns in this order; fixed so the numbers line up one below the other. */
  modules: readonly M[];
  counts: Record<M, number>;
}

/**
 * The usage counters: icon plus number per column (entries, tasks), dimmed
 * at 0, the name in the tooltip. The one place for this row; the categories
 * and tags views use it to show where something is used.
 */
export default function ModuleCounts<M extends ContentModuleId>({ modules, counts }: Props<M>) {
  const { t } = useTranslation();
  return (
    <span className="flex items-center gap-3 flex-shrink-0">
      {modules.map((id) => {
        const { icon: Icon, labelKey } = COLUMNS[id];
        const count = counts[id];
        return (
          <span
            key={id}
            title={t(labelKey)}
            className={`flex items-center gap-1 text-xs tabular-nums ${count ? 'text-muted' : 'text-subtle'}`}
          >
            <Icon size={12} />
            {count}
          </span>
        );
      })}
    </span>
  );
}
