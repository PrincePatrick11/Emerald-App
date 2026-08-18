import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../../store/uiStore';
import { useWikiStore } from '../../../store/wikiStore';
import { useOperationStore } from '../../../store/operationStore';
import { useJournalStore } from '../../../store/journalStore';
import TagInput from '../../editor/TagInput';
import LinkedOpsInput from '../fields/LinkedOpsInput';
import LinkedWikiInput from '../fields/LinkedWikiInput';
import PropertiesEditView from '../fields/PropertiesEditView';
import PropertiesReadView from '../fields/PropertiesReadView';
import { PropertySummaryRow } from '../fields/PropertySummaryRow';
import { OP_PROP_SELECT_CLASSES } from '../../../lib/styleClasses';

export default function JournalPropertiesPanel() {
  const { t } = useTranslation();
  const activeView = useUIStore((s) => s.activeView);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const isEditing = activeView.mode === 'edit';
  const articles = useWikiStore((s) => s.articles);
  const operations = useOperationStore((s) => s.operations);
  const entries = useJournalStore((s) => s.entries);
  const updateEntry = useJournalStore((s) => s.updateEntry);

  const entry = activeView.id ? entries.find((e) => e.id === activeView.id) : null;

  const paradigmArticles = useMemo(() => articles.filter((a) => a.category === 'paradigm'), [articles]);
  const bannungArticles = useMemo(() => articles.filter((a) => a.category === 'bannung' && !a.deleted_at), [articles]);
  const meditationArticles = useMemo(() => articles.filter((a) => a.category === 'meditation' && !a.deleted_at), [articles]);

  if (!entry) {
    return <p className="text-xs text-stone-600 px-2 py-3">{t('properties.noEntry')}</p>;
  }

  const inputCls = OP_PROP_SELECT_CLASSES;

  if (!isEditing) {
    const paradigmaArt = entry.paradigm_id ? articles.find((a) => a.id === entry.paradigm_id) : undefined;
    const bannungArt = entry.bannung_type_wiki_id ? articles.find((a) => a.id === entry.bannung_type_wiki_id) : undefined;
    const meditationArt = entry.meditation_type_wiki_id ? articles.find((a) => a.id === entry.meditation_type_wiki_id) : undefined;
    const linkedOps = (entry.linked_operation_ids ?? []).map((id) => operations.find((o) => o.id === id)).filter(Boolean) as typeof operations;
    const linkedWiki = (entry.linked_wiki_ids ?? []).map((id) => articles.find((a) => a.id === id)).filter(Boolean) as typeof articles;

    return (
      <PropertiesReadView>
        <PropertySummaryRow label={`🌀 ${t('properties.paradigma')}`} value={paradigmaArt?.title ?? t('properties.none')} />
        <PropertySummaryRow label={`🚫 ${t('properties.bannung')}`} value={bannungArt?.title ?? t('properties.none')} />
        <PropertySummaryRow
          label={`🧘 ${t('properties.meditation')}`}
          value={meditationArt ? `${meditationArt.title}${entry.meditation_duration ? ` (${entry.meditation_duration} min)` : ''}` : t('properties.none')}
        />
        {linkedOps.length > 0 && (
          <div>
            <p className="label-xs mb-2">⚡ {t('properties.linkedOperations')}</p>
            <div className="flex flex-wrap gap-1">
              {linkedOps.map((op) => (
                <button
                  key={op.id}
                  onClick={() => setActiveView({ type: 'operations', id: op.id, mode: 'view' })}
                  className="linked-entry-chip flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-stone-800/60 border border-stone-700/40 text-stone-300 hover:border-stone-500/60 transition-colors"
                >
                  <span className="truncate max-w-[140px]">{op.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {linkedWiki.length > 0 && (
          <div>
            <p className="label-xs mb-2">📖 {t('properties.linkedWikiArticles')}</p>
            <div className="flex flex-wrap gap-1">
              {linkedWiki.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setActiveView({ type: 'wiki', id: a.id, mode: 'view' })}
                  className="linked-entry-chip flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-stone-800/60 border border-stone-700/40 text-stone-300 hover:border-stone-500/60 transition-colors"
                >
                  <span className="truncate max-w-[140px]">{a.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div>
          <p className="label-xs mb-2">{t('properties.tags')}</p>
          <TagInput tags={entry.tags ?? []} onChange={() => {}} readOnly />
        </div>
      </PropertiesReadView>
    );
  }

  return (
    <PropertiesEditView>
      <div>
        <p className="label-xs mb-2">🌀 {t('properties.paradigma')}</p>
        <select
          value={entry.paradigm_id ?? ''}
          onChange={(e) => updateEntry(entry.id, { paradigm_id: e.target.value || null })}
          className={inputCls + ' cursor-pointer'}
        >
          <option value="">{t('properties.none')}</option>
          {paradigmArticles.map((a) => (
            <option key={a.id} value={a.id}>{a.title}</option>
          ))}
        </select>
      </div>

      <div>
        <p className="label-xs mb-2">🚫 {t('properties.bannung')}</p>
        <select
          value={entry.bannung_type_wiki_id ?? ''}
          onChange={(e) => updateEntry(entry.id, {
            bannung_type_wiki_id: e.target.value || null,
            is_bannung: !!e.target.value,
          })}
          className={inputCls + ' cursor-pointer'}
        >
          <option value="">{t('properties.none')}</option>
          {bannungArticles.map((a) => (
            <option key={a.id} value={a.id}>{a.title}</option>
          ))}
        </select>
      </div>

      <div>
        <p className="label-xs mb-2">🧘 {t('properties.meditation')}</p>
        <select
          value={entry.meditation_type_wiki_id ?? ''}
          onChange={(e) => updateEntry(entry.id, {
            meditation_type_wiki_id: e.target.value || null,
            is_meditation: !!e.target.value,
          })}
          className={inputCls + ' cursor-pointer'}
        >
          <option value="">{t('properties.none')}</option>
          {meditationArticles.map((a) => (
            <option key={a.id} value={a.id}>{a.title}</option>
          ))}
        </select>
      </div>
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
        <p className="label-xs mb-2">⚡ {t('properties.linkedOperations')}</p>
        <LinkedOpsInput
          ids={entry.linked_operation_ids ?? []}
          onChange={(ids) => updateEntry(entry.id, { linked_operation_ids: ids })}
          inputCls={inputCls}
        />
      </div>

      <div>
        <p className="label-xs mb-2">📖 {t('properties.linkedWikiArticles')}</p>
        <LinkedWikiInput
          ids={entry.linked_wiki_ids ?? []}
          onChange={(ids) => updateEntry(entry.id, { linked_wiki_ids: ids })}
          inputCls={inputCls}
        />
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
