import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../store/uiStore';
import type { EntryContentRow } from '../../store/blockCopies';
import { MODULES, viewTypeForEntryType } from '../../lib/modules';
import { displayTitle } from '../../lib/entryTitle';
import SidebarSection, { SidebarEmpty, SidebarItemRow } from '../sidebar/fields/SidebarSection';

/** This many entries are listed under "Usage"; the rest is shown as a number below. */
const LIST_LIMIT = 8;

/**
 * The entries that carry blocks from the template: a section of the
 * sidebar of its page, with the count in the header, most recently changed first.
 * A click opens the entry.
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
