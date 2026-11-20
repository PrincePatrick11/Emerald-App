import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import TagInput, { commitDraftTags, type DraftTag } from '../ui/TagInput';
import FilterList from '../ui/FilterList';
import Favicon from '../sidebar/fields/Favicon';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import { useShrunkIcon } from '../../hooks/useShrunkIcon';
import { DEFAULT_CATEGORY_EMOJI, categoryLabel } from '../../lib/categories';
import { dashboardLabel } from '../../lib/dashboards';
import { useDashboardStore, dashboardById } from '../../store/dashboardStore';
import { closeDashboardSettings, useDashboardSettingsStore } from '../../store/dashboardSettingsStore';
import { deleteDashboardWithUndo } from '../../store/dashboardActions';
import { CATEGORY_NAME_TAKEN, useCategoryStore } from '../../store/categoryStore';
import type { Dashboard } from '../../types';

/** The one settings dialog of the app's dashboards — mounted once, by `AppShell`. */
export function DashboardSettingsHost() {
  const openId = useDashboardSettingsStore((s) => s.openId);
  const dashboard = useDashboardStore((s) => dashboardById(s.dashboards, openId ?? undefined));
  if (!dashboard) return null;
  // Keyed: another dashboard starts with its own state.
  return <DashboardSettingsModal key={dashboard.id} dashboard={dashboard} onClose={closeDashboardSettings} />;
}

/**
 * Name, icon and filter of a dashboard: which categories and tags it shows.
 * Everything deselected shows every entry. Saved on "Save"; a category
 * created here exists at once and is ticked in the filter, so it shows up in
 * this dashboard. "All entries" has no filter and cannot be deleted.
 */
function DashboardSettingsModal({ dashboard, onClose }: { dashboard: Dashboard; onClose: () => void }) {
  const { t } = useTranslation();
  const updateDashboard = useDashboardStore((s) => s.updateDashboard);
  const categories = useCategoryStore((s) => s.categories);
  const addCategory = useCategoryStore((s) => s.addCategory);
  const isAll = dashboard.builtin === 'all';

  // A built-in without a name of its own shows the translated one — as the placeholder, so the field stays empty.
  const [name, setName] = useState(dashboard.name);
  const [icon, setIcon] = useState(dashboard.icon);
  // An uploaded picture becomes a 128px file in `icons/`; the row only names it. Save waits for it.
  const shrinkIcon = useShrunkIcon(setIcon, 'DashboardSettingsModal');
  const pendingIcon = useRef<Promise<void>>(Promise.resolve());
  const chooseIcon = (value: string) => { pendingIcon.current = shrinkIcon(value); };
  const [categoryIds, setCategoryIds] = useState<string[]>(dashboard.filter.categories ?? []);
  const [tags, setTags] = useState<string[]>(dashboard.filter.tags ?? []);
  // Tags typed here are created on saving, not before.
  const [draftTags, setDraftTags] = useState<DraftTag[]>([]);
  const [newCategory, setNewCategory] = useState('');
  const [categoryError, setCategoryError] = useState<string | null>(null);

  const save = async () => {
    await pendingIcon.current;
    // A dashboard of the user's own needs a name; a built-in falls back to its translated one.
    const nextName = name.trim() || (dashboard.builtin ? '' : dashboardLabel(t, dashboard));
    const finalTags = await commitDraftTags(tags, draftTags);
    // A filter the user did not touch stays as it is: an emptied category list shows nothing, and saving a new name must not turn it into "all".
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);
    const filterUnchanged = same(categoryIds, dashboard.filter.categories ?? []) && same(finalTags, dashboard.filter.tags ?? []);
    await updateDashboard(dashboard.id, {
      name: nextName,
      icon,
      ...(filterUnchanged ? {} : { filter: { categories: categoryIds, tags: finalTags } }),
    });
    onClose();
  };

  const toggleCategory = (id: string) =>
    setCategoryIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));

  const createCategory = async () => {
    const trimmed = newCategory.trim();
    if (!trimmed) return;
    try {
      const created = await addCategory(trimmed, DEFAULT_CATEGORY_EMOJI);
      setCategoryIds((prev) => (prev.includes(created.id) ? prev : [...prev, created.id]));
      setNewCategory('');
      setCategoryError(null);
    } catch (err) {
      if (err instanceof Error && err.message === CATEGORY_NAME_TAKEN) setCategoryError(t('categories.nameTaken'));
      else console.error('[DashboardSettingsModal] creating the category failed:', err);
    }
  };

  const remove = async () => {
    onClose();
    await deleteDashboardWithUndo(dashboard.id);
  };

  return (
    <Modal
      title={t('dashboards.settings')}
      onClose={onClose}
      widthClassName="w-full max-w-md"
      bodyClassName="modal-body space-y-3"
      footer={(
        <>
          {!isAll && (
            <Button tone="danger" className="mr-auto" onClick={() => void remove()}>
              <Trash2 size={14} /> {t('common.delete')}
            </Button>
          )}
          <Button tone="neutral" onClick={onClose}>{t('common.cancel')}</Button>
          <Button tone="jade" onClick={() => void save()}>{t('common.save')}</Button>
        </>
      )}
    >
      <p className="label-xs -mb-2">{t('dashboards.name')}</p>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save(); } }}
        placeholder={dashboardLabel(t, { name: '', builtin: dashboard.builtin })}
        className={`${OP_PROP_SELECT_CLASSES} selectable w-full`}
      />
      <div>
        <p className="label-xs mb-2">{t('properties.icon')}</p>
        <Favicon value={icon} onChange={chooseIcon} onRemove={() => chooseIcon('')} />
      </div>
      {isAll ? (
        <p className="text-xs text-subtle">{t('dashboards.allHasNoFilter')}</p>
      ) : (
        <>
          <div>
            <p className="label-xs mb-1">{t('dashboards.filterCategories')}</p>
            <p className="text-xs text-subtle mb-2">{t('dashboards.filterCategoriesHint')}</p>
            <div className="max-h-56 overflow-y-auto">
              <FilterList
                chips={categories.map((c) => ({ value: c.id, label: categoryLabel(t, c), emoji: c.emoji }))}
                selected={categoryIds}
                onToggle={toggleCategory}
                onAll={() => setCategoryIds([])}
              />
            </div>
            <div className="flex items-center gap-2 mt-2">
              <input
                value={newCategory}
                onChange={(e) => { setNewCategory(e.target.value); setCategoryError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void createCategory(); } }}
                placeholder={t('dashboards.newCategory')}
                aria-label={t('dashboards.newCategory')}
                className={`${OP_PROP_SELECT_CLASSES} selectable flex-1`}
              />
              <Button tone="jade" small onClick={() => void createCategory()} disabled={!newCategory.trim()}>
                <Plus size={12} /> {t('dashboards.addCategory')}
              </Button>
            </div>
            {categoryError && <p className="text-xs text-danger mt-1">{categoryError}</p>}
          </div>
          <div>
            <p className="label-xs mb-1">{t('dashboards.filterTags')}</p>
            <p className="text-xs text-subtle mb-2">{t('dashboards.filterTagsHint')}</p>
            <TagInput tags={tags} onChange={setTags} drafts={draftTags} onDraftsChange={setDraftTags} flush />
          </div>
        </>
      )}
    </Modal>
  );
}
