import { useTranslation } from 'react-i18next';
import { MODULES, type EntryModuleId } from '../../lib/modules';

interface Props<M extends EntryModuleId> {
  /** Spalten in dieser Reihenfolge — fest, damit die Zahlen untereinander fluchten. */
  modules: readonly M[];
  counts: Record<M, number>;
}

/**
 * Die Verwendungszähler je Modul: Modul-Icon plus Zahl, gedimmt bei 0, der
 * Modulname im Tooltip. Die eine Stelle für diese Reihe — Kategorien- und
 * Tags-Ansicht zeigen damit, wo etwas benutzt wird.
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
            className={`flex items-center gap-1 text-xs tabular-nums ${count ? 'text-stone-400' : 'text-stone-600'}`}
          >
            <Icon size={12} />
            {count}
          </span>
        );
      })}
    </span>
  );
}
