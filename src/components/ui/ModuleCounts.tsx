import { useTranslation } from 'react-i18next';
import { MODULES, type EntryModuleId } from '../../lib/modules';

interface Props<M extends EntryModuleId> {
  /** Columns in this order; fixed so the numbers line up one below the other. */
  modules: readonly M[];
  counts: Record<M, number>;
}

/**
 * The usage counters per module: module icon plus number, dimmed at 0, the
 * module name in the tooltip. The one place for this row; the categories and
 * tags views use it to show where something is used.
 */
export default function ModuleCounts<M extends EntryModuleId>({ modules, counts }: Props<M>) {
  const { t } = useTranslation();
  return (
    <span className="flex items-center gap-3 flex-shrink-0">
      {modules.map((id) => {
        const Icon = MODULES[id].icon;
        const count = counts[id];
        return (
          <span
            key={id}
            title={t(MODULES[id].navLabelKey)}
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
