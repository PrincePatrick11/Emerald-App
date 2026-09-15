import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../../store/uiStore';
import { useJournalStore } from '../../../store/journalStore';
import TagsField from '../fields/TagsField';
import LinkedEntriesField from '../fields/LinkedEntriesField';
import EntryTypeField from '../fields/EntryTypeField';
import PropertiesEditView from '../fields/PropertiesEditView';
import PropertiesReadView from '../fields/PropertiesReadView';
import { OP_PROP_SELECT_CLASSES } from '../../../lib/styleClasses';

/**
 * Journal hat keine eigenen Eigenschaften mehr — Paradigma, Bannung und
 * Meditation waren drei feste Felder auf je eine Wiki-Kategorie und sind seit
 * Migration v37 gewöhnliche Verlinkungen im Inhalt (im Feld darunter nach
 * Kategorie sortiert). Übrig bleiben Verlinkungen und Tags.
 */
export default function JournalPropertiesPanel() {
  const { t } = useTranslation();
  const activeView = useUIStore((s) => s.activeView);
  const isEditing = activeView.mode === 'edit';
  const entries = useJournalStore((s) => s.entries);
  const updateEntry = useJournalStore((s) => s.updateEntry);

  const entry = activeView.id ? entries.find((e) => e.id === activeView.id) : null;

  // Verknüpfungen aus den alten Spalten — siehe `legacyIds` in LinkedEntriesField.
  const legacyLinks = useMemo(() => [
    ...(entry?.linked_operation_ids ?? []).map((id) => ({ id, entryType: 'operation' as const })),
    ...(entry?.linked_wiki_ids ?? []).map((id) => ({ id, entryType: 'wiki' as const })),
  ], [entry?.linked_operation_ids, entry?.linked_wiki_ids]);

  if (!entry) {
    return <p className="text-xs text-stone-600 px-2 py-3">{t('properties.noEntry')}</p>;
  }

  const inputCls = OP_PROP_SELECT_CLASSES;

  if (!isEditing) {
    return (
      <PropertiesReadView>
        <div>
          <p className="label-xs mb-2">🔗 {t('properties.linkedEntries')}</p>
          <LinkedEntriesField content={entry.content} legacyIds={legacyLinks} />
        </div>
        <TagsField tags={entry.tags ?? []} readOnly />
      </PropertiesReadView>
    );
  }

  return (
    <PropertiesEditView>
      <EntryTypeField id={entry.id} type="journal" />

      <div>
        <p className="label-xs mb-2">🔗 {t('properties.linkedEntries')}</p>
        <LinkedEntriesField content={entry.content} legacyIds={legacyLinks} editable inputCls={inputCls} />
      </div>

      <TagsField tags={entry.tags ?? []} onChange={(tags) => updateEntry(entry.id, { tags })} />
    </PropertiesEditView>
  );
}
