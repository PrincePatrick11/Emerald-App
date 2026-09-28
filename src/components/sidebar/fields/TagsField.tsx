import { useTranslation } from 'react-i18next';
import TagInput from '../../editor/TagInput';
import SidebarSection, { SidebarEmpty } from './SidebarSection';

/**
 * Das Tag-Feld der Eigenschaften-Seitenleiste im Bearbeiten: Beschriftung und
 * `TagInput` in seinem Feldrahmen. Journal, Wiki, Operationen und die Seite
 * einer Vorlage zeigen es gleich; gelesen wird über `TagsSection`.
 */
export default function TagsField({ tags, onChange }: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <p className="label-xs mb-2">{t('properties.tags')}</p>
      <div className="bg-stone-800/40 rounded-md px-3 py-2 border border-stone-700/40">
        <TagInput tags={tags} onChange={onChange} />
      </div>
    </div>
  );
}

/** Die Tags in der Leseansicht: ein Abschnitt mit Zähler, darunter die Chips. */
export function TagsSection({ tags }: { tags: string[] }) {
  const { t } = useTranslation();
  return (
    <SidebarSection storageKey="entry-sidebar-tags-open" label={t('properties.tags')} count={tags.length}>
      {tags.length === 0
        ? <SidebarEmpty>{t('properties.noTags')}</SidebarEmpty>
        // Wie eine Zeile: der Chip beginnt, wo die Icons der Zeilen beginnen
        // (10px), und 24px Chip plus `py-1` ergeben ihre 32px Höhe.
        : <div className="pl-2.5 pr-3 py-1"><TagInput tags={tags} onChange={() => {}} readOnly chipSize="row" /></div>}
    </SidebarSection>
  );
}
