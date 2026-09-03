import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../../store/uiStore';
import { useWikiStore } from '../../../store/wikiStore';
import { useJournalStore } from '../../../store/journalStore';
import TagInput from '../../editor/TagInput';
import LinkedEntriesField from '../fields/LinkedEntriesField';
import PropertiesEditView from '../fields/PropertiesEditView';
import PropertiesReadView from '../fields/PropertiesReadView';
import { PropertySummaryRow } from '../fields/PropertySummaryRow';
import SelectField from '../fields/SelectField';
import { OP_PROP_SELECT_CLASSES } from '../../../lib/styleClasses';

export default function JournalPropertiesPanel() {
  const { t } = useTranslation();
  const activeView = useUIStore((s) => s.activeView);
  const isEditing = activeView.mode === 'edit';
  const articles = useWikiStore((s) => s.articles);
  const entries = useJournalStore((s) => s.entries);
  const updateEntry = useJournalStore((s) => s.updateEntry);

  const entry = activeView.id ? entries.find((e) => e.id === activeView.id) : null;

  // Verknüpfungen aus den alten Spalten — siehe `legacyIds` in LinkedEntriesField.
  const legacyLinks = useMemo(() => [
    ...(entry?.linked_operation_ids ?? []).map((id) => ({ id, entryType: 'operation' as const })),
    ...(entry?.linked_wiki_ids ?? []).map((id) => ({ id, entryType: 'wiki' as const })),
  ], [entry?.linked_operation_ids, entry?.linked_wiki_ids]);

  const paradigmArticles = useMemo(() => articles.filter((a) => a.category_id === 'paradigm'), [articles]);
  const bannungArticles = useMemo(() => articles.filter((a) => a.category_id === 'bannung' && !a.deleted_at), [articles]);
  const meditationArticles = useMemo(() => articles.filter((a) => a.category_id === 'meditation' && !a.deleted_at), [articles]);

  if (!entry) {
    return <p className="text-xs text-stone-600 px-2 py-3">{t('properties.noEntry')}</p>;
  }

  const inputCls = OP_PROP_SELECT_CLASSES;

  if (!isEditing) {
    const paradigmaArt = entry.paradigm_id ? articles.find((a) => a.id === entry.paradigm_id) : undefined;
    const bannungArt = entry.bannung_type_wiki_id ? articles.find((a) => a.id === entry.bannung_type_wiki_id) : undefined;
    const meditationArt = entry.meditation_type_wiki_id ? articles.find((a) => a.id === entry.meditation_type_wiki_id) : undefined;

    return (
      <PropertiesReadView>
        <PropertySummaryRow label={`🌀 ${t('properties.paradigma')}`} value={paradigmaArt?.title ?? t('properties.none')} />
        <PropertySummaryRow label={`🚫 ${t('properties.bannung')}`} value={bannungArt?.title ?? t('properties.none')} />
        <PropertySummaryRow
          label={`🧘 ${t('properties.meditation')}`}
          value={meditationArt ? `${meditationArt.title}${entry.meditation_duration ? ` (${entry.meditation_duration} min)` : ''}` : t('properties.none')}
        />
        <div>
          <p className="label-xs mb-2">🔗 {t('properties.linkedEntries')}</p>
          <LinkedEntriesField content={entry.content} legacyIds={legacyLinks} />
        </div>
        <div>
          <p className="label-xs mb-2">{t('properties.tags')}</p>
          <TagInput tags={entry.tags ?? []} onChange={() => {}} readOnly />
        </div>
      </PropertiesReadView>
    );
  }

  return (
    <PropertiesEditView>
      <SelectField
        label={`🌀 ${t('properties.paradigma')}`}
        value={entry.paradigm_id}
        options={paradigmArticles}
        getId={(a) => a.id}
        getLabel={(a) => a.title}
        noneLabel={t('properties.none')}
        onChange={(paradigm_id) => updateEntry(entry.id, { paradigm_id })}
      />

      <SelectField
        label={`🚫 ${t('properties.bannung')}`}
        value={entry.bannung_type_wiki_id}
        options={bannungArticles}
        getId={(a) => a.id}
        getLabel={(a) => a.title}
        noneLabel={t('properties.none')}
        onChange={(id) => updateEntry(entry.id, { bannung_type_wiki_id: id, is_bannung: !!id })}
      />

      <SelectField
        label={`🧘 ${t('properties.meditation')}`}
        value={entry.meditation_type_wiki_id}
        options={meditationArticles}
        getId={(a) => a.id}
        getLabel={(a) => a.title}
        noneLabel={t('properties.none')}
        onChange={(id) => updateEntry(entry.id, { meditation_type_wiki_id: id, is_meditation: !!id })}
      />
      {entry.is_meditation && (
        <div>
          <p className="label-xs mb-2">⏱ {t('properties.meditationDuration')}</p>
          <input
            type="number"
            min="1"
            value={entry.meditation_duration ?? ''}
            onChange={(e) => updateEntry(entry.id, { meditation_duration: e.target.value ? parseInt(e.target.value, 10) : null })}
            placeholder={t('properties.meditationDurationPlaceholder')}
            className={inputCls}
          />
        </div>
      )}

      <div>
        <p className="label-xs mb-2">🔗 {t('properties.linkedEntries')}</p>
        <LinkedEntriesField content={entry.content} legacyIds={legacyLinks} editable inputCls={inputCls} />
      </div>

      <div>
        <p className="label-xs mb-2">{t('properties.tags')}</p>
        <div className="bg-stone-800/40 rounded-md px-3 py-2 border border-stone-700/40">
          <TagInput tags={entry.tags ?? []} onChange={(tags) => updateEntry(entry.id, { tags })} />
        </div>
      </div>
    </PropertiesEditView>
  );
}
