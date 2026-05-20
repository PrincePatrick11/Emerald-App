import { useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ImagePlus, Eye, EyeOff } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useWikiStore } from '../../store/wikiStore';
import { useOperationStore } from '../../store/operationStore';
import { useJournalStore } from '../../store/journalStore';
import TagInput from '../editor/TagInput';
import LinkedOpsInput from './LinkedOpsInput';
import LinkedWikiInput from './LinkedWikiInput';
import { CustomPropertiesSection } from './CustomPropertiesSection';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';

export default function OpPropertiesPanel() {
  const { t } = useTranslation();
  const activeView = useUIStore((s) => s.activeView);
  const operations   = useOperationStore((s) => s.operations);
  const updateOperation = useOperationStore((s) => s.updateOperation);
  const opCategories = useOperationStore((s) => s.categories);
  const articles       = useWikiStore((s) => s.articles);
  const updateArticle  = useWikiStore((s) => s.updateArticle);
  const wikiCategories = useWikiStore((s) => s.wikiCategories);
  const entries      = useJournalStore((s) => s.entries);
  const updateEntry  = useJournalStore((s) => s.updateEntry);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const coverImageInputRef = useRef<HTMLInputElement>(null);

  const op      = activeView.type === 'operations' && activeView.id ? operations.find((o) => o.id === activeView.id) : null;
  const article = activeView.type === 'wiki'       && activeView.id ? articles.find((a) => a.id === activeView.id)   : null;
  const entry   = activeView.type === 'journal'    && activeView.id ? entries.find((e) => e.id === activeView.id)    : null;
  const sigilOperation = op?.category_id === 'sigils' ? op : null;
  const isSigilEditing = !!sigilOperation && activeView.mode === 'edit';

  // useMemo calls must come before any early returns (Rules of Hooks)
  const paradigmArticles    = useMemo(() => articles.filter((a) => a.category === 'paradigm'), [articles]);
  const bannungArticles     = useMemo(() => articles.filter((a) => a.category === 'bannung' && !a.deleted_at), [articles]);
  const meditationArticles  = useMemo(() => articles.filter((a) => a.category === 'meditation' && !a.deleted_at), [articles]);
  const sigilChargingArticles = useMemo(() => articles.filter((a) => a.category === 'sigil_charging' && !a.deleted_at), [articles]);

  const hasEntry = !!activeView.id && ['journal', 'wiki', 'operations'].includes(activeView.type);
  if (!hasEntry) {
    return <p className="text-xs text-stone-600 px-2 py-3">{t('properties.noEntry')}</p>;
  }

  const handleIconUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const data = reader.result as string;
      if (article) updateArticle(article.id, { icon: data });
      else if (op) updateOperation(op.id, { icon: data });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleCoverImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const data = reader.result as string;
      if (article) updateArticle(article.id, { cover_image: data });
      else if (op) updateOperation(op.id, { cover_image: data });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const entryType = activeView.type === 'operations' ? 'operation' : activeView.type as 'journal' | 'wiki';

  const currentTags: string[] = op?.tags ?? article?.tags ?? entry?.tags ?? [];
  const handleTagsChange = (tags: string[]) => {
    if (op)      updateOperation(op.id,      { tags });
    else if (article) updateArticle(article.id, { tags });
    else if (entry)   updateEntry(entry.id,     { tags });
  };

  const inputCls = OP_PROP_SELECT_CLASSES;

  return (
    <div className="space-y-5 px-1 py-2">
      {sigilOperation && (
        <div>
          <p className="label-xs mb-2">{t('properties.category')}</p>
          <select
            value={sigilOperation.category_id}
            onChange={(e) => updateOperation(sigilOperation.id, { category_id: e.target.value })}
            className={inputCls + ' cursor-pointer'}
          >
            {opCategories.map((c) => (
              <option key={c.id} value={c.id}>{c.emoji} {c.is_builtin ? t(`operations.categories.${c.id}`) : c.name}</option>
            ))}
          </select>
        </div>
      )}

      {sigilOperation && (
        <div>
          <p className="label-xs mb-2">⚡ {t('creation.chargingTechnique')}</p>
          <select
            value={sigilOperation.charging_technique_wiki_id ?? ''}
            onChange={(e) => updateOperation(sigilOperation.id, { charging_technique_wiki_id: e.target.value || null })}
            className={inputCls + ' cursor-pointer'}
          >
            <option value="">{t('properties.none')}</option>
            {sigilChargingArticles.map((article) => (
              <option key={article.id} value={article.id}>{article.title}</option>
            ))}
          </select>
        </div>
      )}

      {sigilOperation && (
        <div>
          <p className="label-xs mb-2">📅 {t('creation.targetDate')}</p>
          {isSigilEditing ? (
            <input
              type="date"
              value={sigilOperation.target_reveal_date ?? ''}
              onChange={(e) => updateOperation(sigilOperation.id, { target_reveal_date: e.target.value || null })}
              className={inputCls}
            />
          ) : (
            <div className="bg-stone-800/40 rounded-md px-3 py-2.5 border border-stone-700/40">
              <p className="text-xs text-stone-300 leading-5">
                {sigilOperation.target_reveal_date || t('properties.none')}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Fixed: Paradigm (journal only) ── */}
      {entry && (
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
      )}

      {/* ── Bannung (journal only) ── */}
      {entry && (
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
      )}

      {/* ── Meditation (journal only) ── */}
      {entry && (
        <>
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
        </>
      )}

      {/* ── Fixed: Linked Operations (journal only) ── */}
      {entry && (
        <div>
          <p className="label-xs mb-2">⚡ {t('properties.linkedOperations')}</p>
          <LinkedOpsInput
            ids={entry.linked_operation_ids ?? []}
            onChange={(ids) => updateEntry(entry.id, { linked_operation_ids: ids })}
            inputCls={inputCls}
          />
        </div>
      )}

      {/* ── Fixed: Linked Wiki Articles (journal only) ── */}
      {entry && (
        <div>
          <p className="label-xs mb-2">📖 {t('properties.linkedWikiArticles')}</p>
          <LinkedWikiInput
            ids={entry.linked_wiki_ids ?? []}
            onChange={(ids) => updateEntry(entry.id, { linked_wiki_ids: ids })}
            inputCls={inputCls}
          />
        </div>
      )}

      {/* ── Wiki: Category (above Tags) ── */}
      {article && (
        <div>
          <p className="label-xs mb-2">{t('properties.category')}</p>
          <select
            value={article.category}
            onChange={(e) => updateArticle(article.id, { category: e.target.value })}
            className={inputCls + ' cursor-pointer'}
          >
            {wikiCategories.map((c) => (
              <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* ── Operations: Category ── */}
      {op && !sigilOperation && (
        <div>
          <p className="label-xs mb-2">{t('properties.category')}</p>
          <select
            value={op.category_id}
            onChange={(e) => updateOperation(op.id, { category_id: e.target.value })}
            className={inputCls + ' cursor-pointer'}
          >
            {opCategories.map((c) => (
              <option key={c.id} value={c.id}>{c.emoji} {c.is_builtin ? t(`operations.categories.${c.id}`) : c.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* ── Wiki/Op: Icon ── */}
      {(article || (op && !sigilOperation)) && (
        <div>
          <p className="label-xs mb-2">{t('properties.icon')}</p>
          <input ref={iconInputRef} type="file" accept="image/*" className="hidden" onChange={handleIconUpload} />
          {(() => {
            const currentIcon = article?.icon ?? op?.icon;
            return currentIcon ? (
              <div className="flex items-center gap-2">
                <img src={currentIcon} alt="" className="w-10 h-10 object-cover rounded-lg border border-stone-700/40" />
                <div className="flex flex-col gap-0.5">
                  <button onClick={() => iconInputRef.current?.click()} className="text-xs text-stone-500 hover:text-stone-300 transition-colors text-left">{t('wiki.changeIcon')}</button>
                  <button onClick={() => article ? updateArticle(article.id, { icon: undefined }) : op && updateOperation(op.id, { icon: undefined })} className="text-xs text-stone-500 hover:text-red-400 transition-colors text-left">{t('wiki.removeIcon')}</button>
                </div>
              </div>
            ) : (
              <button onClick={() => iconInputRef.current?.click()} className="flex items-center gap-1.5 text-xs text-stone-600 hover:text-stone-400 transition-colors">
                <ImagePlus size={13} /> {t('wiki.addIcon')}
              </button>
            );
          })()}
        </div>
      )}

      {/* ── Wiki/Op: Cover Image ── */}
      {(article || (op && !sigilOperation)) && (
        <div>
          <p className="label-xs mb-2">{t('properties.coverImage')}</p>
          <input ref={coverImageInputRef} type="file" accept="image/*" className="hidden" onChange={handleCoverImageUpload} />
          {(() => {
            const currentCover = article?.cover_image ?? op?.cover_image;
            return currentCover ? (
              <div className="relative group">
                <img src={currentCover} alt="" className="w-full h-24 object-cover rounded-lg border border-stone-700/40" />
                <div className="absolute inset-0 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity bg-stone-900/60 rounded-lg">
                  <button onClick={() => coverImageInputRef.current?.click()} className="flex items-center gap-1 text-xs text-stone-200 px-2 py-1 bg-stone-800/80 rounded hover:bg-stone-700"><ImagePlus size={12} /> {t('properties.change')}</button>
                  <button onClick={() => article ? updateArticle(article.id, { cover_image: undefined }) : op && updateOperation(op.id, { cover_image: undefined })} className="flex items-center gap-1 text-xs text-red-400 px-2 py-1 bg-stone-800/80 rounded hover:bg-stone-700"><X size={12} /> {t('properties.remove')}</button>
                </div>
              </div>
            ) : (
              <button onClick={() => coverImageInputRef.current?.click()} className="flex items-center gap-1.5 text-xs text-stone-600 hover:text-stone-400 transition-colors">
                <ImagePlus size={13} /> {t('properties.addCoverImage')}
              </button>
            );
          })()}
        </div>
      )}

      {/* ── Fixed: Operation-specific properties ── */}
      {op && !sigilOperation && (
        <>
          <div>
            <p className="label-xs mb-2">{t('operations.active')}</p>
            <button
              onClick={() => updateOperation(op.id, { is_active: !op.is_active })}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                op.is_active
                  ? 'bg-jade-900/40 text-jade-400 border border-jade-800/40'
                  : 'bg-stone-800/60 text-stone-500 border border-stone-700/40'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${op.is_active ? 'bg-jade-400' : 'bg-stone-600'}`} />
              {op.is_active ? t('operations.active') : t('operations.inactive')}
            </button>
          </div>
          <div>
            <p className="label-xs mb-2">{t('operations.endDate')}</p>
            <input
              type="date"
              value={op.end_date ?? ''}
              onChange={(e) => updateOperation(op.id, { end_date: e.target.value || null })}
              className={inputCls}
            />
          </div>
          <div>
            <p className="label-xs mb-2">{t('operations.version')}</p>
            <input
              type="text"
              value={op.version ?? ''}
              onChange={(e) => updateOperation(op.id, { version: e.target.value || null })}
              placeholder={t('operations.versionPlaceholder')}
              className={inputCls}
            />
          </div>
        </>
      )}

      {/* ── Tags (all entry types, at bottom) ── */}
      {sigilOperation && (
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="label-xs">🖼️ {t('creation.types.sigil')}</p>
            <button
              onClick={() => updateOperation(sigilOperation.id, { show_sigil: !sigilOperation.show_sigil })}
              className="text-stone-500 hover:text-stone-300 transition-colors"
              title={sigilOperation.show_sigil ? t('creation.hideSigil') : t('creation.showSigil')}
            >
              {sigilOperation.show_sigil ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
          </div>
          <div className="bg-stone-800/40 rounded-md px-3 py-2.5 border border-stone-700/40">
            <p className={`text-xs leading-5 ${sigilOperation.show_sigil ? 'text-stone-300' : 'text-stone-600'}`}>
              {sigilOperation.show_sigil ? t('creation.showSigil') : t('creation.hidden')}
            </p>
          </div>
        </div>
      )}

      {sigilOperation && !isSigilEditing && (
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="label-xs">✍️ {t('creation.intention')}</p>
            <button
              onClick={() => updateOperation(sigilOperation.id, { show_intention_in_properties: !sigilOperation.show_intention_in_properties })}
              className="text-stone-500 hover:text-stone-300 transition-colors"
              title={sigilOperation.show_intention_in_properties ? t('creation.hideIntention') : t('creation.showIntention')}
            >
              {sigilOperation.show_intention_in_properties ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
          </div>
          <div className="bg-stone-800/40 rounded-md px-3 py-3 border border-stone-700/40">
            {sigilOperation.show_intention_in_properties ? (
              <p className="text-xs text-stone-300 whitespace-pre-wrap leading-5">
                {sigilOperation.intention_text || t('creation.intentionEmpty')}
              </p>
            ) : (
              <p className="text-xs text-stone-600">{t('creation.hidden')}</p>
            )}
          </div>
        </div>
      )}

      {sigilOperation && (
        <div>
          <p className="label-xs mb-2">{t('creation.description')}</p>
          <div className="bg-stone-800/40 rounded-md px-3 py-2 border border-stone-700/40">
            <textarea
              value={sigilOperation.description ?? ''}
              onChange={(e) => updateOperation(sigilOperation.id, { description: e.target.value })}
              placeholder={t('creation.descriptionPlaceholder')}
              className="w-full min-h-32 bg-transparent text-xs text-stone-300 outline-none placeholder-stone-600 resize-y selectable"
            />
          </div>
        </div>
      )}

      <div>
        <p className="label-xs mb-2">{t('properties.tags')}</p>
        <div className="bg-stone-800/40 rounded-md px-3 py-2 border border-stone-700/40">
          <TagInput tags={currentTags} onChange={handleTagsChange} />
        </div>
      </div>

      {!sigilOperation && <hr className="border-stone-700/40" />}

      {sigilOperation?.is_loaded && (
        <button
          onClick={() => updateOperation(sigilOperation.id, { is_loaded: false, show_sigil: true, show_intention_in_properties: true, show_letter_bank_in_properties: true })}
          className="w-full rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-xs font-medium text-red-300 transition-colors hover:bg-red-950/60"
        >
          {t('creation.unloadSigil')}
        </button>
      )}

      {/* ── Custom properties ── */}
      {!sigilOperation && (
        <CustomPropertiesSection
          entryId={activeView.id!}
          entryType={entryType}
        />
      )}
    </div>
  );
}
