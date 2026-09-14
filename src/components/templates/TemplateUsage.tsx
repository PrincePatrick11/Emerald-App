import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../store/uiStore';
import type { EntryContentRow } from '../../store/blockCopies';
import { MODULES, viewTypeForEntryType } from '../../lib/modules';

/** So viele Einträge listet „Verwendung" — der Rest steht als Zahl darunter. */
const LIST_LIMIT = 8;

/**
 * Die Einträge, die Blöcke aus der Vorlage tragen — in der Seitenleiste ihrer
 * Seite, zuletzt geänderte zuerst. Ein Klick öffnet den Eintrag.
 */
export default function TemplateUsage({ entries }: { entries: readonly EntryContentRow[] }) {
  const { t } = useTranslation();
  const setActiveView = useUIStore((s) => s.setActiveView);

  return (
    <section className="space-y-2">
      <p className="label-xs">{t('templates.usage')}</p>
      <p className="text-xs text-stone-400">
        {entries.length > 0 ? t('templates.usedIn', { count: entries.length }) : t('templates.unused')}
      </p>
      {entries.length > 0 && (
        <ul className="space-y-0.5">
          {entries.slice(0, LIST_LIMIT).map((entry) => {
            const meta = MODULES[viewTypeForEntryType(entry.entryType)];
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-xs text-stone-400 hover:bg-stone-700/40 hover:text-stone-200"
                  onClick={() => setActiveView({ type: meta.id, id: entry.id, mode: 'view' })}
                  title={t(meta.navLabelKey)}
                >
                  <meta.icon size={12} className="flex-shrink-0" />
                  <span className="truncate">{entry.title || t(meta.untitledKey)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {entries.length > LIST_LIMIT && (
        <p className="text-xs text-stone-500">{t('templates.moreEntries', { count: entries.length - LIST_LIMIT })}</p>
      )}
      <p className="block-field-hint">{t('templates.copiesNote')}</p>
    </section>
  );
}
