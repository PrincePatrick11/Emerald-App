import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';
import { useUIStore } from '../../../store/uiStore';
import { useWikiStore } from '../../../store/wikiStore';
import { useOperationStore } from '../../../store/operationStore';
import TagInput from '../../editor/TagInput';
import PropertiesEditView from '../fields/PropertiesEditView';
import PropertiesReadView from '../fields/PropertiesReadView';
import { PropertySummaryRow } from '../fields/PropertySummaryRow';
import Favicon from '../fields/Favicon';
import Banner from '../fields/Banner';
import SelectField from '../fields/SelectField';
import { OP_PROP_SELECT_CLASSES } from '../../../lib/styleClasses';
import { categoryLabel } from '../../../lib/categories';
import { formatEntryDate } from '../../../lib/formatDate';
import CategorySelect from '../../ui/CategorySelect';
import Button from '../../ui/Button';

export default function OperationPropertiesPanel() {
  const { t } = useTranslation();
  const activeView = useUIStore((s) => s.activeView);
  const isEditing = activeView.mode === 'edit';
  const operations = useOperationStore((s) => s.operations);
  const updateOperation = useOperationStore((s) => s.updateOperation);
  const opCategories = useOperationStore((s) => s.categories);
  const articles = useWikiStore((s) => s.articles);

  const op = activeView.id ? operations.find((o) => o.id === activeView.id) : null;
  const sigilOperation = op?.category_id === 'sigils' ? op : null;

  const sigilChargingArticles = useMemo(
    () => articles.filter((a) => a.category_id === 'sigil_charging' && !a.deleted_at),
    [articles]
  );

  if (!op) {
    return <p className="text-xs text-stone-600 px-2 py-3">{t('properties.noEntry')}</p>;
  }

  const inputCls = OP_PROP_SELECT_CLASSES;
  const category = opCategories.find((c) => c.id === op.category_id);
  // Gelöschte Kategorie: „Keine" statt der rohen category_id.
  const categoryDisplay = category ? `${category.emoji} ${categoryLabel(t, 'operations', category)}` : t('properties.none');

  if (!isEditing) {
    if (sigilOperation) {
      const chargingArt = sigilOperation.charging_technique_wiki_id
        ? articles.find((a) => a.id === sigilOperation.charging_technique_wiki_id) : undefined;
      return (
        <PropertiesReadView>
          <PropertySummaryRow label={t('properties.category')} value={categoryDisplay} />
          <PropertySummaryRow label={`⚡ ${t('creation.chargingTechnique')}`} value={chargingArt?.title ?? t('properties.none')} />
          <PropertySummaryRow label={`📅 ${t('creation.targetDate')}`} value={sigilOperation.target_reveal_date ? formatEntryDate(sigilOperation.target_reveal_date) : t('properties.none')} />

          <div>
            <p className="label-xs mb-2">🖼️ {t('creation.types.sigil')}</p>
            <div className="bg-stone-800/40 rounded-md px-3 py-2.5 border border-stone-700/40">
              <p className={`text-xs leading-5 ${sigilOperation.show_sigil ? 'text-stone-300' : 'text-stone-600'}`}>
                {sigilOperation.show_sigil ? t('creation.showSigil') : t('creation.hidden')}
              </p>
            </div>
          </div>

          <div>
            <p className="label-xs mb-2">✍️ {t('creation.intention')}</p>
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

          <div>
            <p className="label-xs mb-2">{t('creation.description')}</p>
            <div className="bg-stone-800/40 rounded-md px-3 py-2 border border-stone-700/40">
              <p className="text-xs text-stone-300 whitespace-pre-wrap leading-5 min-h-[2rem]">
                {sigilOperation.description || t('properties.none')}
              </p>
            </div>
          </div>

          <div>
            <p className="label-xs mb-2">{t('properties.tags')}</p>
            <TagInput tags={op.tags ?? []} onChange={() => {}} readOnly />
          </div>
        </PropertiesReadView>
      );
    }

    return (
      <PropertiesReadView>
        <PropertySummaryRow label={t('properties.category')} value={categoryDisplay} />
        <Favicon value={op.icon} readOnly label={t('properties.icon')} />
        <Banner value={op.cover_image} readOnly />
        <PropertySummaryRow
          label={t('operations.active')}
          value=""
          badge={op.is_active ? { label: t('operations.active'), tone: 'jade' } : { label: t('operations.inactive'), tone: 'muted' }}
        />
        <PropertySummaryRow label={t('operations.endDate')} value={op.end_date ? formatEntryDate(op.end_date) : t('properties.none')} />
        <PropertySummaryRow label={t('operations.version')} value={op.version || t('properties.none')} />
        <div>
          <p className="label-xs mb-2">{t('properties.tags')}</p>
          <TagInput tags={op.tags ?? []} onChange={() => {}} readOnly />
        </div>
      </PropertiesReadView>
    );
  }

  return (
    <PropertiesEditView>
      <div>
        <p className="label-xs mb-2">{t('properties.category')}</p>
        <CategorySelect
          categories={opCategories}
          value={op.category_id}
          onChange={(category_id) => updateOperation(op.id, { category_id })}
          getLabel={(c) => categoryLabel(t, 'operations', c)}
          variant="field"
        />
      </div>

      {sigilOperation && (
        <>
          <SelectField
            label={`⚡ ${t('creation.chargingTechnique')}`}
            value={sigilOperation.charging_technique_wiki_id}
            options={sigilChargingArticles}
            getId={(a) => a.id}
            getLabel={(a) => a.title}
            noneLabel={t('properties.none')}
            onChange={(charging_technique_wiki_id) => updateOperation(sigilOperation.id, { charging_technique_wiki_id })}
          />

          <div>
            <p className="label-xs mb-2">📅 {t('creation.targetDate')}</p>
            <input
              type="date"
              value={sigilOperation.target_reveal_date ?? ''}
              onChange={(e) => updateOperation(sigilOperation.id, { target_reveal_date: e.target.value || null })}
              className={inputCls}
            />
          </div>
        </>
      )}

      {!sigilOperation && (
        <>
          <Favicon
            value={op.icon}
            onChange={(icon) => updateOperation(op.id, { icon })}
            onRemove={() => updateOperation(op.id, { icon: undefined })}
            label={t('properties.icon')}
          />

          <Banner
            value={op.cover_image}
            onChange={(cover_image) => updateOperation(op.id, { cover_image })}
            onRemove={() => updateOperation(op.id, { cover_image: undefined })}
          />

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

      {sigilOperation && (
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
          <TagInput tags={op.tags ?? []} onChange={(tags) => updateOperation(op.id, { tags })} />
        </div>
      </div>

      {sigilOperation?.is_loaded && (
        <Button
          onClick={() => updateOperation(sigilOperation.id, { is_loaded: false, show_sigil: true, show_intention_in_properties: true, show_letter_bank_in_properties: true })}
          variant="danger"
          className="w-full rounded-md border px-3 py-2 text-xs font-medium bg-[var(--danger-bg)] border-[var(--danger-border)] hover:border-[var(--danger-hover-border)]"
        >
          {t('creation.unloadSigil')}
        </Button>
      )}
    </PropertiesEditView>
  );
}
