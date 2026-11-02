import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, CircleDashed, CornerDownRight, FilePlus, Layers } from 'lucide-react';
import { GroupDivider } from '../ui/Dashboard';
import Dropdown from '../ui/Dropdown';
import BlockGlyph from '../blocks/BlockGlyph';
import { useTemplateStore } from '../../store/templateStore';
import { useCategoryStore } from '../../store/categoryStore';
import { usePersistedFlag } from '../../hooks/usePersistedFlag';
import { templateLabel } from '../../lib/blocks/blockAttrs';
import { categoryLabel } from '../../lib/categories';
import { MODULES, viewTypeForEntryType } from '../../lib/modules';
import { ALL_CATEGORIES, assignedTemplateAt, TEMPLATE_ENTRY_TYPES, type TemplateEntryType } from '../../lib/blocks/templates';

/** The section as a whole is a setting, like the altar library. */
const COLLAPSED_KEY = 'templates-defaults-collapsed';

/** The entry types with categories: the columns of the table. */
const CATEGORY_TYPES = TEMPLATE_ENTRY_TYPES.filter((type) => type !== 'journal');

/** Category column somewhat wider, wiki and operations share the rest. */
const GRID = 'grid grid-cols-[minmax(9rem,1.3fr)_repeat(2,minmax(0,1fr))] items-center gap-x-6';

/** The header of an entry type: module icon and name. */
function EntryTypeHeading({ entryType }: { entryType: TemplateEntryType }) {
  const { t } = useTranslation();
  const meta = MODULES[viewTypeForEntryType(entryType)];
  return (
    <p className="label-xs flex items-center gap-1.5">
      <meta.icon size={12} />
      {t(meta.navLabelKey)}
    </p>
  );
}

/**
 * The one place that says where a template applies, below the template list: at
 * the top journal on its own (it has no categories, as a column of the table it
 * would be almost empty), below it one row per category ("All categories", "No
 * category", then each category) with wiki and operations as columns. A cell
 * chooses the template new entries of that combination start with, and applies
 * at once. Without one of its own it names what applies instead.
 */
export default function TemplateAssignmentTable() {
  const { t } = useTranslation();
  const templates = useTemplateStore((s) => s.templates);
  const assignTemplate = useTemplateStore((s) => s.assignTemplate);
  const categories = useCategoryStore((s) => s.categories);
  const [collapsed, toggle] = usePersistedFlag(COLLAPSED_KEY);

  if (templates.length === 0) return null;

  const options = [
    { value: '', label: t('templates.overview.none') },
    ...templates.map((tpl) => ({ value: tpl.id, label: templateLabel(t, tpl), icon: <BlockGlyph icon={tpl.icon} size={14} /> })),
  ];

  const cell = (entryType: TemplateEntryType, category: string | null, rowLabel: string) => {
    const current = assignedTemplateAt(templates, entryType, category);
    const fallback = !current && category !== ALL_CATEGORIES ? assignedTemplateAt(templates, entryType, ALL_CATEGORIES) : undefined;
    return (
      <Dropdown
        portal
        value={current?.id ?? ''}
        options={options}
        onChange={(id) => {
          assignTemplate(entryType, category, id || null).catch((e: unknown) => {
            console.error('[TemplateAssignmentTable] assigning failed:', e);
          });
        }}
        trigger={({ toggle: open }) => (
          <button
            type="button"
            className="template-assign-cell text-sm"
            aria-label={`${rowLabel} – ${t(MODULES[viewTypeForEntryType(entryType)].navLabelKey)}: ${current ? templateLabel(t, current) : t('templates.overview.none')}`}
            onClick={open}
          >
            {current ? (
              <>
                <BlockGlyph icon={current.icon} size={14} />
                <span className="truncate">{templateLabel(t, current)}</span>
              </>
            ) : fallback ? (
              <span className="block-field-hint flex min-w-0 items-center gap-1.5" title={t('templates.overview.fallback', { name: templateLabel(t, fallback) })}>
                <CornerDownRight size={12} className="flex-shrink-0" />
                <span className="truncate">{templateLabel(t, fallback)}</span>
              </span>
            ) : (
              <span className="block-field-hint" title={t('templates.overview.none')}>—</span>
            )}
            <ChevronDown size={12} className="template-assign-chevron" />
          </button>
        )}
      />
    );
  };

  // The fixed emoji column keeps the names aligned; the two rows
  // without a category of their own carry an icon there instead of an emoji.
  const named = (glyph: ReactNode, name: string) => (
    <>
      <span className="flex w-5 flex-shrink-0 justify-center text-[var(--text-muted)]">{glyph}</span>
      <span className="truncate">{name}</span>
    </>
  );

  // "All categories" is the fallback of all other rows and therefore stands
  // out with a bold name, and only that; a shaded row was too loud.
  const row = (category: string | null, name: string, glyph: ReactNode) => (
    <div key={category ?? ''} className={`${GRID} border-t border-[var(--border-soft)] py-1.5`}>
      <div
        className={`flex min-w-0 items-center gap-2 text-sm text-[var(--text-primary)]${
          category === ALL_CATEGORIES ? ' font-semibold' : ''
        }`}
      >
        {named(glyph, name)}
      </div>
      {CATEGORY_TYPES.map((type) => <div key={type} className="min-w-0">{cell(type, category, name)}</div>)}
    </div>
  );

  return (
    <div className="mt-8">
      <GroupDivider label={t('templates.overview.title')} collapsed={collapsed} onToggleCollapse={toggle} />
      {!collapsed && (
        <>
          <p className="mb-3 text-xs text-[var(--text-muted)]">{t('templates.overview.hint')}</p>
          <div className="panel px-4">
            {/* Journal: one row, the cell spanning both columns. */}
            <div className="py-3">
              <EntryTypeHeading entryType="journal" />
            </div>
            <div className={`${GRID} border-t border-[var(--border-soft)] py-1.5`}>
              <div className="flex min-w-0 items-center gap-2 text-sm text-[var(--text-primary)]">
                {named(<FilePlus size={14} />, t('templates.overview.everyEntry'))}
              </div>
              <div className="min-w-0">{cell('journal', ALL_CATEGORIES, t('templates.overview.everyEntry'))}</div>
            </div>

            <div className={`${GRID} border-t border-[var(--border-soft)] pt-5 pb-3`}>
              <span className="label-xs">{t('templates.overview.category')}</span>
              {CATEGORY_TYPES.map((type) => <EntryTypeHeading key={type} entryType={type} />)}
            </div>
            {row(ALL_CATEGORIES, t('templates.allCategories'), <Layers size={14} />)}
            {row(null, t('categories.uncategorized'), <CircleDashed size={14} />)}
            {categories.map((cat) => row(cat.id, categoryLabel(t, cat), cat.emoji))}
          </div>
        </>
      )}
    </div>
  );
}
