import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import EditDialogFooter from '../ui/EditDialogFooter';
import TagInput, { commitDraftTags, type DraftTag } from '../ui/TagInput';
import FilterList from '../ui/FilterList';
import Favicon from '../sidebar/fields/Favicon';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import { useShrunkIcon } from '../../hooks/useShrunkIcon';
import { DEFAULT_CATEGORY_EMOJI, categoryLabel } from '../../lib/categories';
import { dashboardLabel, ruleAlive } from '../../lib/dashboards';
import { useTagStore } from '../../store/tagStore';
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
  const liveTags = useTagStore((s) => s.tags);
  const [categoryIds, setCategoryIds] = useState<string[]>(dashboard.filter.categories ?? []);
  const [tags, setTags] = useState<string[]>(dashboard.filter.tags ?? []);
  // A rule that names only categories or tags that are gone shows nothing — until the user changes that rule.
  const [categoriesTouched, setCategoriesTouched] = useState(false);
  const [tagsTouched, setTagsTouched] = useState(false);
  const categoriesGone = !categoriesTouched && !ruleAlive(dashboard.filter.categories, new Set(categories.map((c) => c.id)));
  const tagsGone = !tagsTouched && !ruleAlive(dashboard.filter.tags, new Set(liveTags.map((tag) => tag.id)));
  // Tags typed here are created on saving, not before.
  const [draftTags, setDraftTags] = useState<DraftTag[]>([]);
  const [newCategory, setNewCategory] = useState('');
  const [categoryError, setCategoryError] = useState<string | null>(null);

  const save = async () => {
    await pendingIcon.current;
    // A dashboard of the user's own needs a name; a built-in falls back to its translated one.
    const nextName = name.trim() || (dashboard.builtin ? '' : dashboardLabel(t, dashboard));
    const finalTags = await commitDraftTags(tags, draftTags);
    // A rule the user did not touch stays as it is — even an emptied one, which shows nothing: saving a new name must not turn it into "all". A touched, empty rule is no rule.
    const kept = (touched: boolean, ids: string[], stored: string[] | undefined) => (touched ? (ids.length ? ids : undefined) : stored);
    const categoriesRule = kept(categoriesTouched, categoryIds, dashboard.filter.categories);
    const tagsRule = kept(tagsTouched, finalTags, dashboard.filter.tags);
    await updateDashboard(dashboard.id, {
      name: nextName,
      icon,
      ...(categoriesTouched || tagsTouched
        ? { filter: { ...(categoriesRule && { categories: categoriesRule }), ...(tagsRule && { tags: tagsRule }) } }
        : {}),
    });
    onClose();
  };

  const changeCategories = (next: (prev: string[]) => string[]) => {
    setCategoryIds(next);
    setCategoriesTouched(true);
  };

  const toggleCategory = (id: string) =>
    changeCategories((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));

  const createCategory = async () => {
    const trimmed = newCategory.trim();
    if (!trimmed) return;
    try {
      const created = await addCategory(trimmed, DEFAULT_CATEGORY_EMOJI);
      changeCategories((prev) => (prev.includes(created.id) ? prev : [...prev, created.id]));
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
        <EditDialogFooter onDelete={isAll ? undefined : () => void remove()} onCancel={onClose} onSave={() => void save()} />
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
            {categoriesGone && <p className="text-xs text-danger mb-2" role="alert">{t('dashboards.categoriesGone')}</p>}
            <div className="max-h-56 overflow-y-auto">
              <FilterList
                chips={categories.map((c) => ({ value: c.id, label: categoryLabel(t, c), emoji: c.emoji }))}
                selected={categoryIds}
                onToggle={toggleCategory}
                onAll={() => changeCategories(() => [])}
                allActive={categoriesGone ? false : undefined}
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
            {tagsGone && (
              <div className="mb-2">
                <p className="text-xs text-danger mb-1.5" role="alert">{t('dashboards.tagsGone')}</p>
                <Button small onClick={() => { setTags([]); setTagsTouched(true); }}>{t('dashboards.removeTagFilter')}</Button>
              </div>
            )}
            <TagInput
              tags={tags}
              onChange={(next) => { setTags(next); setTagsTouched(true); }}
              drafts={draftTags}
              onDraftsChange={(next) => { setDraftTags(next); setTagsTouched(true); }}
              flush
            />
          </div>
        </>
      )}
    </Modal>
  );
}
