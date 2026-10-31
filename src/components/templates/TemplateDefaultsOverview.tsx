import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleDashed, CornerDownRight, FilePlus, Layers } from 'lucide-react';
import { GroupDivider } from '../ui/Dashboard';
import BlockGlyph from '../blocks/BlockGlyph';
import { useTemplateStore } from '../../store/templateStore';
import { useCategoryStore } from '../../store/categoryStore';
import { useUIStore } from '../../store/uiStore';
import { useSettingsStore } from '../../store/settingsStore';
import { usePersistedFlag } from '../../hooks/usePersistedFlag';
import { templateLabel } from '../../lib/blocks/blockAttrs';
import { categoryLabel } from '../../lib/categories';
import {
  ALL_CATEGORIES, assignmentStateAt, defaultTemplateAt,
  type AssignmentState, type Template, type TemplateEntryType,
} from '../../lib/blocks/templates';
import { ASSIGNMENT_STATE_ICONS, CATEGORY_TYPES, EntryTypeHeading, useAssignmentStateLabels } from './assignmentParts';

/** The section as a whole is a setting, like the altar library. */
const COLLAPSED_KEY = 'templates-defaults-collapsed';

/** Category column somewhat wider, wiki and operations share the rest. */
const GRID = 'grid grid-cols-[minmax(9rem,1.3fr)_repeat(2,minmax(0,1fr))] items-center gap-x-6';

/**
 * The overall overview below the template list, view only, in a
 * panel: at the top journal on its own (it has no categories, as a column of the
 * table it would be almost empty), below it the table with one row per
 * category ("All categories", "No category", then each category) and
 * wiki and operations as columns; the same structure as in the assignment dialog.
 * A cell names the default and the templates selectable there;
 * without its own default, what applies instead. The default appears without a
 * star, a template that is only selectable with a check mark. A name opens the template;
 * changes are made only there.
 */
export default function TemplateDefaultsOverview() {
  const { t } = useTranslation();
  const applyDefault = useSettingsStore((s) => s.settings.templates.applyDefault);
  const templates = useTemplateStore((s) => s.templates);
  const categories = useCategoryStore((s) => s.categories);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const stateLabels = useAssignmentStateLabels();
  const [collapsed, toggle] = usePersistedFlag(COLLAPSED_KEY);

  // The default appears without a mark; it is what the table shows. Only a
  // template that is merely selectable there carries the quiet check mark.
  const link = (template: Template, state: AssignmentState) => (
    <button
      key={template.id}
      type="button"
      className="template-overview-link text-sm"
      onClick={() => setActiveView({ type: 'templates', id: template.id })}
      title={`${templateLabel(t, template)} — ${stateLabels[state]}`}
    >
      {state === 'assigned' && (
        <span className="template-overview-state">
          <ASSIGNMENT_STATE_ICONS.assigned size={14} />
        </span>
      )}
      <BlockGlyph icon={template.icon} size={14} />
      <span className="truncate">{templateLabel(t, template)}</span>
    </button>
  );

  /**
   * One cell: default, then the selectable templates. Without its own default,
   * what applies instead is shown below, even next to selectable templates that
   * insert nothing on creation. Completely empty, a dash remains.
   */
  const cell = (entryType: TemplateEntryType, category: string | null) => {
    const current = defaultTemplateAt(templates, entryType, category);
    const choices = templates.filter((tpl) => assignmentStateAt(tpl.assignments, entryType, category) === 'assigned');
    const fallback = !current && category !== ALL_CATEGORIES ? defaultTemplateAt(templates, entryType, ALL_CATEGORIES) : undefined;
    return (
      <div className="flex min-w-0 flex-col items-start gap-1">
        {current && link(current, 'default')}
        {choices.map((tpl) => link(tpl, 'assigned'))}
        {fallback ? (
          <span
            className="block-field-hint flex max-w-full items-center gap-1.5"
            title={t('templates.overview.fallback', { name: templateLabel(t, fallback) })}
          >
            <CornerDownRight size={12} className="flex-shrink-0" />
            <span className="truncate">{templateLabel(t, fallback)}</span>
          </span>
        ) : !current && choices.length === 0 && (
          <span className="block-field-hint" title={t('templates.overview.none')}>—</span>
        )}
      </div>
    );
  };

  // "All categories" is the fallback of all other rows and therefore stands
  // out with a bold name, and only that; a shaded row was too loud.
  const row = (category: string | null, label: ReactNode) => (
    <div key={category ?? ''} className={`${GRID} border-t border-[var(--border-soft)] py-2.5`}>
      <div
        className={`flex min-w-0 items-center gap-2 text-sm text-[var(--text-primary)]${
          category === ALL_CATEGORIES ? ' font-semibold' : ''
        }`}
      >
        {label}
      </div>
      {CATEGORY_TYPES.map((type) => <div key={type} className="min-w-0">{cell(type, category)}</div>)}
    </div>
  );

  // The fixed emoji column keeps the names aligned; the two rows
  // without a category of their own carry an icon there instead of an emoji.
  const named = (glyph: ReactNode, name: string) => (
    <>
      <span className="flex w-5 flex-shrink-0 justify-center text-[var(--text-muted)]">{glyph}</span>
      <span className="truncate">{name}</span>
    </>
  );

  return (
    <div className="mt-8">
      <GroupDivider label={t('templates.overview.title')} collapsed={collapsed} onToggleCollapse={toggle} />
      {!collapsed && (
        <>
          <p className="mb-3 text-xs text-[var(--text-muted)]">
            {t(applyDefault ? 'templates.overview.hint' : 'templates.overview.hintOff')}
          </p>
          <div className="panel px-4">
            {/* Journal: one row, the cell spanning both columns. */}
            <div className="py-3">
              <EntryTypeHeading entryType="journal" />
            </div>
            <div className={`${GRID} border-t border-[var(--border-soft)] py-2.5`}>
              <div className="flex min-w-0 items-center gap-2 text-sm text-[var(--text-primary)]">
                {named(<FilePlus size={14} />, t('templates.overview.everyEntry'))}
              </div>
              <div className="col-span-2 min-w-0">{cell('journal', ALL_CATEGORIES)}</div>
            </div>

            <div className={`${GRID} border-t border-[var(--border-soft)] pt-5 pb-3`}>
              <span className="label-xs">{t('templates.overview.category')}</span>
              {CATEGORY_TYPES.map((type) => <EntryTypeHeading key={type} entryType={type} />)}
            </div>
            {row(ALL_CATEGORIES, named(<Layers size={14} />, t('templates.allCategories')))}
            {row(null, named(<CircleDashed size={14} />, t('categories.uncategorized')))}
            {categories.map((cat) => row(cat.id, named(cat.emoji, categoryLabel(t, cat))))}
          </div>
        </>
      )}
    </div>
  );
}
