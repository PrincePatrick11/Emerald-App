import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../../store/uiStore';
import { findEntry, useEntryStore } from '../../../store/entryStore';
import TagsField from '../fields/TagsField';
import LinkedEntriesField from '../fields/LinkedEntriesField';
import EntryReadSections, { CategoryPropertyRow, PropertiesSection } from '../fields/EntryReadSections';
import CategoryIconCoverRows from '../fields/CategoryIconCoverRows';
import { BlockPropertyRows, useEntryBlockSources } from '../fields/BlockSourced';
import type { Entry } from '../../../types';

/**
 * The properties of every entry: category, icon and cover image, the rows
 * the entry's blocks add (the moon phase of its day, a sigil's target date),
 * links and tags.
 * What a block suggests or gives (icon, cover, rows, tags) is marked as the
 * block's (`useEntryBlockSources`). Everything else (status, sigil, charge
 * …) is blocks in the content and brings its own settings. What an entry is
 * follows from its category — changing it here is all there is to "moving"
 * an entry.
 */
export default function EntryPropertiesPanel() {
  const { t } = useTranslation();
  const activeView = useUIStore((s) => s.activeView);
  const entry = useEntryStore((s) => (activeView.id ? findEntry(s.entries, activeView.id) : undefined));
  if (!entry) {
    return <p className="text-xs text-subtle px-2 py-3">{t('properties.noEntry')}</p>;
  }
  return <EntryProperties entry={entry} isEditing={activeView.mode === 'edit'} />;
}

function EntryProperties({ entry, isEditing }: { entry: Entry; isEditing: boolean }) {
  const updateEntry = useEntryStore((s) => s.updateEntry);
  const blocks = useEntryBlockSources(entry);

  if (!isEditing) {
    return (
      <EntryReadSections
        properties={(
          <>
            <CategoryPropertyRow categoryId={entry.category_id} />
            <BlockPropertyRows sources={blocks} />
          </>
        )}
        content={entry.content}
        tags={entry.tags ?? []}
        blockTags={blocks.blockTags}
      />
    );
  }

  return (
    <>
      <PropertiesSection>
        <CategoryIconCoverRows entry={entry} update={(patch) => updateEntry(entry.id, patch)} blocks={blocks} />
        <BlockPropertyRows sources={blocks} />
      </PropertiesSection>
      <LinkedEntriesField content={entry.content} />
      <TagsField tags={entry.tags ?? []} onChange={(tags) => updateEntry(entry.id, { tags })} blockTags={blocks.blockTags} />
    </>
  );
}
