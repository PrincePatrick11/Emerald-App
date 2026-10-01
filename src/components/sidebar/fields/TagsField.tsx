import { useTranslation } from 'react-i18next';
import TagInput from '../../editor/TagInput';
import { useTagMap, visibleTags } from '../../../store/tagStore';
import SidebarSection, { SidebarEmpty } from './SidebarSection';

/** Auf/Zu der Tags — Lesen und Bearbeiten teilen es. */
const OPEN_KEY = 'entry-sidebar-tags-open';

/**
 * Die Tags im Bearbeiten: derselbe Abschnitt wie im Lesen (`TagsSection`,
 * gleicher Zähler, gleiches Auf/Zu), die Chips mit „×", darunter das Feld
 * „Tag hinzufügen …". Journal, Wiki, Operationen und die Seite einer Vorlage
 * zeigen es gleich.
 */
export default function TagsField({ tags, onChange }: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const { t } = useTranslation();
  const count = visibleTags(tags, useTagMap()).length;
  return (
    <SidebarSection storageKey={OPEN_KEY} label={t('properties.tags')} count={count}>
      {count === 0 && <SidebarEmpty>{t('properties.noTags')}</SidebarEmpty>}
      <div className="mt-1"><TagInput tags={tags} onChange={onChange} /></div>
    </SidebarSection>
  );
}

/** Die Tags in der Leseansicht: ein Abschnitt mit Zähler, darunter die Chips. */
export function TagsSection({ tags }: { tags: string[] }) {
  const { t } = useTranslation();
  const count = visibleTags(tags, useTagMap()).length;
  return (
    <SidebarSection storageKey={OPEN_KEY} label={t('properties.tags')} count={count}>
      {count === 0
        ? <SidebarEmpty>{t('properties.noTags')}</SidebarEmpty>
        // Wie eine Zeile: der Chip beginnt, wo die Icons der Zeilen beginnen
        // (10px), und 24px Chip plus `py-1` ergeben ihre 32px Höhe.
        : <div className="pl-2.5 pr-3 py-1"><TagInput tags={tags} onChange={() => {}} readOnly chipSize="row" /></div>}
    </SidebarSection>
  );
}
