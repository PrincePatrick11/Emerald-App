import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Folder } from 'lucide-react';
import { useCategoryStore } from '../../../store/categoryStore';
import { categoryLabel } from '../../../lib/categories';
import SidebarSection, { SidebarPropertyRow } from './SidebarSection';
import { LinkedEntriesSection } from './LinkedEntriesField';
import { TagsSection } from './TagsField';
import type { BlockTagChip } from '../../ui/TagInput';
import { BlockReadActions } from '../../blocks/BlockSidebarArea';

/**
 * The read view of an entry in the right sidebar: properties, links, tags,
 * and the actions its blocks offer while reading. A fragment, so that
 * the blocks below (`BlockSidebarArea`) follow at the same spacing.
 * Without `properties` the properties section is omitted.
 */
export default function EntryReadSections({ properties, content, tags, blockTags }: {
  properties?: ReactNode;
  content: string;
  tags: string[];
  /** The tags the entry's blocks give, marked as theirs. */
  blockTags?: readonly BlockTagChip[];
}) {
  return (
    <>
      {properties && <PropertiesSection>{properties}</PropertiesSection>}
      <LinkedEntriesSection content={content} />
      <TagsSection tags={tags} blockTags={blockTags} />
      <BlockReadActions />
    </>
  );
}

/** The "Properties" section, also used by the block builder, which otherwise has different sections. */
export function PropertiesSection({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return <SidebarSection storageKey="entry-sidebar-properties-open" label={t('properties.title')}>{children}</SidebarSection>;
}

/** The category as a property; a deleted one shows "None" instead of the raw id. */
export function CategoryPropertyRow({ categoryId }: { categoryId?: string | null }) {
  const { t } = useTranslation();
  const category = useCategoryStore((s) => s.categories.find((c) => c.id === categoryId));
  return (
    <SidebarPropertyRow
      icon={<Folder size={14} />}
      label={t('properties.category')}
      value={category ? <><span className="font-normal">{category.emoji}</span><span className="truncate">{categoryLabel(t, category)}</span></> : t('properties.noCategory')}
      muted={!category}
    />
  );
}
