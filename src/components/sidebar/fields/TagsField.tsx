import { useTranslation } from 'react-i18next';
import TagInput from '../../editor/TagInput';
import { useTagMap, visibleTags } from '../../../store/tagStore';
import SidebarSection, { SidebarEmpty } from './SidebarSection';

/** Open/closed state of the tags; reading and editing share it. */
const OPEN_KEY = 'entry-sidebar-tags-open';

/**
 * The tags when editing: the same section as when reading (`TagsSection`,
 * same counter, same open/closed state), the chips with "×", and below them the field
 * "Add tag …". Journal, wiki, operations and a template's page
 * show it the same way.
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

/** The tags in the read view: a section with a counter, the chips below it. */
export function TagsSection({ tags }: { tags: string[] }) {
  const { t } = useTranslation();
  const count = visibleTags(tags, useTagMap()).length;
  return (
    <SidebarSection storageKey={OPEN_KEY} label={t('properties.tags')} count={count}>
      {count === 0
        ? <SidebarEmpty>{t('properties.noTags')}</SidebarEmpty>
        // Like a row: the chip starts where the icons of the rows start
        // (10px), and a 24px chip plus `py-1` gives their 32px height.
        : <div className="pl-2.5 pr-3 py-1"><TagInput tags={tags} onChange={() => {}} readOnly chipSize="row" /></div>}
    </SidebarSection>
  );
}
