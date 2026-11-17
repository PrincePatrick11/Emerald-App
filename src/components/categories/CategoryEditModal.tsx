import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Trash2 } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import EmojiPicker from '../ui/EmojiPicker';
import DashboardGlyph from '../ui/DashboardGlyph';
import { SidebarGroup } from '../ui/SidebarColumn';
import { FilterRow } from '../ui/FilterList';
import BlockGlyph from '../blocks/BlockGlyph';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import { DEFAULT_CATEGORY_EMOJI, categoryLabel } from '../../lib/categories';
import { dashboardLabel } from '../../lib/dashboards';
import { templateLabel } from '../../lib/blocks/blockAttrs';
import { CATEGORY_NAME_TAKEN, useCategoryStore } from '../../store/categoryStore';
import { useDashboardStore } from '../../store/dashboardStore';
import { useTemplateStore } from '../../store/templateStore';
import { useSettingsStore } from '../../store/settingsStore';
import type { Category } from '../../types';

/**
 * Creating or editing a category: emoji and name, the start template a new
 * entry in it begins with, and — for orientation — the dashboards it shows up
 * in. Which dashboards those are is the dashboards' business (their filter);
 * this only shows it. A built-in keeps its name and emoji; only its start
 * template changes. Saved on "Save"; "Cancel" changes nothing.
 */
export default function CategoryEditModal({ category, onClose, onDelete, onCreated }: {
  /** `undefined`: a new category. */
  category?: Category;
  onClose: () => void;
  /** Offered for a category of the user's own; the caller moves it to the trash with undo. */
  onDelete?: (category: Category) => void;
  /** A new category was saved (or one came back from the Trash by its name). */
  onCreated?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const addCategory = useCategoryStore((s) => s.addCategory);
  const updateCategory = useCategoryStore((s) => s.updateCategory);
  const setStartTemplate = useCategoryStore((s) => s.setStartTemplate);
  const templates = useTemplateStore((s) => s.templates);
  const defaultTemplateId = useSettingsStore((s) => s.settings.templates.defaultTemplateId);
  const dashboards = useDashboardStore((s) => s.dashboards);

  const builtin = !!category?.is_builtin;
  const [name, setName] = useState(category?.name ?? '');
  const [emoji, setEmoji] = useState(category?.emoji ?? DEFAULT_CATEGORY_EMOJI);
  // The stored start template as it is — also one in the Trash, which comes
  // back with its category when restored. It is only written when another one
  // is picked here.
  const [templateId, setTemplateId] = useState<string | null>(category?.template_id ?? null);
  // A start template in the Trash or gone counts as none — as `resolveStartTemplate` sees it.
  const activeTemplateId = templateId && templates.some((tpl) => tpl.id === templateId) ? templateId : null;
  const [error, setError] = useState<string | null>(null);

  const defaultTemplate = defaultTemplateId ? templates.find((tpl) => tpl.id === defaultTemplateId) : undefined;
  const filtering = category ? dashboards.filter((d) => d.filter.categories?.includes(category.id)) : [];
  const showingAll = dashboards.filter((d) => !d.filter.categories?.length);

  const save = async () => {
    const trimmed = name.trim();
    if (!builtin && !trimmed) return;
    try {
      // The category as it stands now — an add may have brought one back from
      // the trash, with the start template it had there.
      let saved: Pick<Category, 'id' | 'template_id'>;
      if (!category) saved = await addCategory(trimmed, emoji);
      else {
        if (!builtin) await updateCategory(category.id, trimmed, emoji);
        saved = category;
      }
      if ((saved.template_id ?? null) !== templateId) await setStartTemplate(saved.id, templateId);
      if (!category) onCreated?.(saved.id);
    } catch (err) {
      // The store throws on a taken name instead of returning an error value.
      if (err instanceof Error && err.message === CATEGORY_NAME_TAKEN) setError(t('categories.nameTaken'));
      else console.error('[CategoryEditModal] saving the category failed:', err);
      return;
    }
    onClose();
  };

  const dashboardRow = (d: (typeof dashboards)[number]) => (
    <li key={d.id} className="flex items-center gap-2.5 px-3 py-[5px] text-[13px] leading-5 text-soft">
      <span className="w-4 flex-shrink-0 flex items-center justify-center text-muted"><DashboardGlyph dashboard={d} size={14} /></span>
      <span className="truncate">{dashboardLabel(t, d)}</span>
    </li>
  );

  return (
    <Modal
      title={category ? t('categories.editTitle') : t('categories.add')}
      onClose={onClose}
      widthClassName="w-full max-w-md"
      bodyClassName="modal-body space-y-4"
      footer={(
        <>
          {category && !builtin && onDelete && (
            <Button tone="danger" className="mr-auto" onClick={() => { onClose(); onDelete(category); }}>
              <Trash2 size={14} /> {t('common.delete')}
            </Button>
          )}
          <Button tone="neutral" onClick={onClose}>{t('common.cancel')}</Button>
          <Button tone="jade" onClick={() => void save()} disabled={!builtin && !name.trim()}>{t('common.save')}</Button>
        </>
      )}
    >
      <div>
        <p className="label-xs mb-2">{t('categories.nameLabel')}</p>
        {builtin ? (
          <>
            <div className={`${OP_PROP_SELECT_CLASSES} w-full flex items-center gap-2 opacity-80`}>
              <span className="text-base">{emoji}</span>
              <span className="truncate">{categoryLabel(t, category)}</span>
            </div>
            <p className="text-xs text-subtle mt-1.5">{t('categories.builtinHint')}</p>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <EmojiPicker
              value={emoji}
              onChange={setEmoji}
              trigger={({ toggle }) => (
                <button
                  type="button"
                  onClick={toggle}
                  title={t('properties.icon')}
                  aria-label={t('properties.icon')}
                  className={`${OP_PROP_SELECT_CLASSES} w-9 flex items-center justify-center text-base`}
                >
                  {emoji}
                </button>
              )}
            />
            <input
              autoFocus
              value={name}
              onChange={(e) => { setName(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save(); } }}
              placeholder={t('categories.name')}
              aria-label={t('categories.nameLabel')}
              className={`${OP_PROP_SELECT_CLASSES} selectable flex-1 min-w-0`}
            />
          </div>
        )}
        {error && <p className="text-xs text-danger mt-1">{error}</p>}
      </div>

      <SidebarGroup label={t('categories.startTemplate')}>
        <p className="text-xs text-subtle mb-2">{t('categories.startTemplateHint')}</p>
        <div className="flex flex-col gap-px max-h-56 overflow-y-auto">
          <FilterRow
            active={activeTemplateId === null}
            onClick={() => setTemplateId(null)}
            lead={<FileText size={14} />}
            label={defaultTemplate
              ? t('categories.startTemplateDefaultNamed', { name: templateLabel(t, defaultTemplate) })
              : t('categories.startTemplateDefaultNone')}
          />
          {templates.map((tpl) => (
            <FilterRow
              key={tpl.id}
              active={activeTemplateId === tpl.id}
              onClick={() => setTemplateId(tpl.id)}
              lead={<BlockGlyph icon={tpl.icon} size={14} />}
              label={templateLabel(t, tpl)}
            />
          ))}
        </div>
      </SidebarGroup>

      {category && (
        <SidebarGroup label={t('categories.shownIn')}>
          <p className="text-xs text-subtle mb-2">{t('categories.shownInHint')}</p>
          {filtering.length > 0
            ? <ul className="flex flex-col gap-px">{filtering.map(dashboardRow)}</ul>
            : <p className="text-xs text-muted px-3 py-1">{t('categories.shownInNone')}</p>}
          {showingAll.length > 0 && (
            <>
              <p className="text-xs text-subtle mt-3 mb-1">{t('categories.shownEverywhere')}</p>
              <ul className="flex flex-col gap-px">{showingAll.map(dashboardRow)}</ul>
            </>
          )}
        </SidebarGroup>
      )}
    </Modal>
  );
}
