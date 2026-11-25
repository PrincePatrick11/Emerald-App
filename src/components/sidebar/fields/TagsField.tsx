import { useTranslation } from 'react-i18next';
import TagInput from '../../ui/TagInput';
import { useTagMap, visibleTags } from '../../../store/tagStore';
import SidebarSection, { SidebarEmpty } from './SidebarSection';
import type { BlockTagChip } from '../../ui/TagInput';

/** Open/closed state of the tags; reading and editing share it. */
const OPEN_KEY = 'entry-sidebar-tags-open';

/** The user's tags and the blocks' that are not in the trash. */
function useTagCount(tags: string[], blockTags: readonly BlockTagChip[]): number {
  const tagMap = useTagMap();
  return visibleTags(tags, tagMap).length + blockTags.filter((tag) => tagMap.has(tag.id)).length;
}

/**
 * The tags when editing: the same section as when reading (`TagsSection`,
 * same counter, same open/closed state), the chips with "×", and below them the field
 * "Add tag …". The entry page and a template's page
 * show it the same way. `blockTags` are those the entry's blocks give,
 * after the user's and marked as theirs (`useEntryBlockSources`).
 */
export default function TagsField({ tags, onChange, blockTags = [] }: {
  tags: string[];
  onChange: (tags: string[]) => void;
  blockTags?: readonly BlockTagChip[];
}) {
  const { t } = useTranslation();
  const count = useTagCount(tags, blockTags);
  return (
    <SidebarSection storageKey={OPEN_KEY} label={t('properties.tags')} count={count}>
      {count === 0 && <SidebarEmpty>{t('properties.noTags')}</SidebarEmpty>}
      <div className="mt-1"><TagInput tags={tags} onChange={onChange} blockTags={blockTags} /></div>
    </SidebarSection>
  );
}

/** The tags in the read view: a section with a counter, the chips below it. */
export function TagsSection({ tags, blockTags = [] }: { tags: string[]; blockTags?: readonly BlockTagChip[] }) {
  const { t } = useTranslation();
  const count = useTagCount(tags, blockTags);
  return (
    <SidebarSection storageKey={OPEN_KEY} label={t('properties.tags')} count={count}>
      {count === 0
        ? <SidebarEmpty>{t('properties.noTags')}</SidebarEmpty>
        // Like a row: the chip starts where the icons of the rows start
        // (10px), and a 24px chip plus `py-1` gives their 32px height.
        : <div className="pl-2.5 pr-3 py-1"><TagInput tags={tags} onChange={() => {}} readOnly chipSize="row" blockTags={blockTags} /></div>}
    </SidebarSection>
  );
}
