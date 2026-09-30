import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../store/uiStore';
import type { EntryContentRow } from '../../store/blockCopies';
import { MODULES, viewTypeForEntryType } from '../../lib/modules';
import { displayTitle } from '../../lib/entryTitle';
import SidebarSection, { SidebarEmpty, SidebarItemRow } from '../sidebar/fields/SidebarSection';

/** So viele Einträge listet „Verwendung" — der Rest steht als Zahl darunter. */
const LIST_LIMIT = 8;

/**
 * Die Einträge, die Blöcke aus der Vorlage tragen — ein Abschnitt der
 * Seitenleiste ihrer Seite, mit der Zahl im Kopf, zuletzt geänderte zuerst.
 * Ein Klick öffnet den Eintrag.
 */
export default function TemplateUsage({ entries }: { entries: readonly EntryContentRow[] }) {
  const { t } = useTranslation();
  const setActiveView = useUIStore((s) => s.setActiveView);

  return (
    <SidebarSection storageKey="template-usage-open" label={t('templates.usage')} count={entries.length}>
      {entries.length === 0 && <SidebarEmpty>{t('templates.unused')}</SidebarEmpty>}
      {entries.slice(0, LIST_LIMIT).map((entry) => {
        const meta = MODULES[viewTypeForEntryType(entry.entryType)];
        return (
          <SidebarItemRow
            key={entry.id}
            icon={<meta.icon size={14} />}
            label={displayTitle(t, entry.entryType, entry.title)}
            meta={t(meta.navLabelKey)}
            onClick={() => setActiveView({ type: meta.id, id: entry.id, mode: 'view' })}
          />
        );
      })}
      {entries.length > LIST_LIMIT && (
        <SidebarEmpty>{t('templates.moreEntries', { count: entries.length - LIST_LIMIT })}</SidebarEmpty>
      )}
    </SidebarSection>
  );
}
