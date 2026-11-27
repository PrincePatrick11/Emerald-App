import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../../store/uiStore';
import { findEntry, useEntryStore } from '../../../store/entryStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { entryMoonPhase, MOON_PHASE_SYMBOLS } from '../../../lib/moonPhase';
import TagsField from '../fields/TagsField';
import LinkedEntriesField from '../fields/LinkedEntriesField';
import EntryReadSections, { CategoryPropertyRow, PropertiesSection } from '../fields/EntryReadSections';
import CategoryIconCoverRows from '../fields/CategoryIconCoverRows';
import { SidebarPropertyRow } from '../fields/SidebarSection';
import { BlockPropertyRows, useEntryBlockSources } from '../fields/BlockSourced';
import type { Entry, MoonPhase } from '../../../types';

/**
 * The moon phase as a property, only displayed even when editing: it
 * follows from the day the entry was created and is not chosen.
 */
function MoonPhaseRow({ phase }: { phase: MoonPhase }) {
  const { t } = useTranslation();
  return (
    <SidebarPropertyRow
      icon={<span className="text-sm">{MOON_PHASE_SYMBOLS[phase]}</span>}
      label={t('properties.moonPhase')}
      value={t(`moonPhase.${phase}`)}
    />
  );
}

/**
 * The properties of every entry: category, icon and cover image, the moon
 * phase for an entry of the category Journal (when the vault shows it, until
 * it becomes a block, #56), the rows the entry's blocks add, links and tags.
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
  const showMoonPhase = useSettingsStore((s) => s.settings.journal.moonPhase);
  const blocks = useEntryBlockSources(entry);
  const phase = entryMoonPhase(entry, showMoonPhase);

  if (!isEditing) {
    return (
      <EntryReadSections
        properties={(
          <>
            <CategoryPropertyRow categoryId={entry.category_id} />
            {phase && <MoonPhaseRow phase={phase} />}
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
        {phase && <MoonPhaseRow phase={phase} />}
        <BlockPropertyRows sources={blocks} />
      </PropertiesSection>
      <LinkedEntriesField content={entry.content} />
      <TagsField tags={entry.tags ?? []} onChange={(tags) => updateEntry(entry.id, { tags })} blockTags={blocks.blockTags} />
    </>
  );
}
