import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../../store/uiStore';
import { useEntryStore } from '../../../store/entryStore';
import TagsField from '../fields/TagsField';
import LinkedEntriesField from '../fields/LinkedEntriesField';
import EntryTypeField from '../fields/EntryTypeField';
import EntryReadSections, { PropertiesSection } from '../fields/EntryReadSections';
import { SidebarPropertyRow } from '../fields/SidebarSection';
import { useSettingsStore } from '../../../store/settingsStore';
import { entryMoonPhase, MOON_PHASE_SYMBOLS } from '../../../lib/moonPhase';
import type { MoonPhase } from '../../../types';

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
 * The properties of a journal entry: type and (display only) moon phase. Paradigm,
 * banishing and meditation were three fixed fields, one per wiki category,
 * and since migration v37 are ordinary links in the content (sorted by
 * category in the section below). Plus links and tags.
 */
export default function JournalPropertiesPanel() {
  const { t } = useTranslation();
  const activeView = useUIStore((s) => s.activeView);
  const isEditing = activeView.mode === 'edit';
  const entries = useEntryStore((s) => s.entries.journal);
  const updateEntry = useEntryStore((s) => s.updateEntry);

  const showMoonPhase = useSettingsStore((s) => s.settings.journal.moonPhase);

  const entry = activeView.id ? entries.find((e) => e.id === activeView.id) : null;

  if (!entry) {
    return <p className="text-xs text-faint px-2 py-3">{t('properties.noEntry')}</p>;
  }

  const phase = entryMoonPhase(entry, showMoonPhase);

  if (!isEditing) {
    return (
      <EntryReadSections
        properties={phase && <MoonPhaseRow phase={phase} />}
        content={entry.content}
        tags={entry.tags ?? []}
      />
    );
  }

  return (
    <>
      <PropertiesSection>
        <EntryTypeField id={entry.id} type="journal" />
        {phase && <MoonPhaseRow phase={phase} />}
      </PropertiesSection>
      <LinkedEntriesField content={entry.content} />
      <TagsField tags={entry.tags ?? []} onChange={(tags) => updateEntry(entry.id, { tags })} />
    </>
  );
}
