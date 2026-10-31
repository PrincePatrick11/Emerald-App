import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Minus, Star, type LucideIcon } from 'lucide-react';
import { useCategoryStore } from '../../store/categoryStore';
import { categoryLabel } from '../../lib/categories';
import { MODULES, viewTypeForEntryType } from '../../lib/modules';
import { ALL_CATEGORIES, TEMPLATE_ENTRY_TYPES, type AssignmentState, type TemplateEntryType } from '../../lib/blocks/templates';

/**
 * What a template's assignment dialog and the default-templates overview
 * in the dashboard have in common: the three levels, their icons and names. The
 * table (`AssignmentTable`) belongs only to the dialog; the overview has
 * the same structure but builds it as its own panel table without switches.
 */

/** The entry types with categories: the columns of the table. */
export const CATEGORY_TYPES = TEMPLATE_ENTRY_TYPES.filter((type) => type !== 'journal');

export const ASSIGNMENT_STATES: AssignmentState[] = ['off', 'assigned', 'default'];
export const ASSIGNMENT_STATE_ICONS: Record<AssignmentState, LucideIcon> = { off: Minus, assigned: Check, default: Star };

/** The names of the three levels, as legend, tooltips and sidebar show them. */
export function useAssignmentStateLabels(): Record<AssignmentState, string> {
  const { t } = useTranslation();
  return {
    off: t('templates.assign.off'),
    assigned: t('templates.assign.assigned'),
    default: t('templates.assign.default'),
  };
}

/** The legend above the table: icon, name and what the level does. */
export function AssignmentLegend({ states }: { states: readonly AssignmentState[] }) {
  const { t } = useTranslation();
  const labels = useAssignmentStateLabels();
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
      {states.map((state) => {
        const Icon = ASSIGNMENT_STATE_ICONS[state];
        return (
          <li key={state} className="flex items-center gap-1.5">
            <Icon size={12} />
            <span>{labels[state]}</span>
            <span className="text-[var(--text-subtle)]">— {t(`templates.assign.${state}Hint`)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** The header of an entry type: module icon and name. */
export function EntryTypeHeading({ entryType }: { entryType: TemplateEntryType }) {
  const { t } = useTranslation();
  const meta = MODULES[viewTypeForEntryType(entryType)];
  return (
    <p className="label-xs flex items-center gap-1.5">
      <meta.icon size={12} />
      {t(meta.navLabelKey)}
    </p>
  );
}

interface AssignmentTableProps {
  /** The content of a cell. `rowLabel` names the row, for labels that would be ambiguous without it. */
  cell: (entryType: TemplateEntryType, category: string | null, rowLabel: string) => ReactNode;
  /** A column after the entry types, one cell per category row; the dialog sets both at once there. */
  extraColumn?: { heading: ReactNode; cell: (category: string | null, rowLabel: string) => ReactNode };
}

/**
 * The table itself: journal as one row (its cell sits under wiki),
 * below it the header with the entry types and the rows "All categories",
 * "No category" and one per category. What goes in the cells is set by the dialog.
 */
export function AssignmentTable({ cell, extraColumn }: AssignmentTableProps) {
  const { t } = useTranslation();
  const categories = useCategoryStore((s) => s.categories);
  const label = (text: string, sub?: string) => (
    // `pt-1`: the switches are taller than a line of text; the label sits centred on the first line.
    <div className="min-w-0 pt-1">
      <p className="truncate text-xs text-[var(--text-secondary)]" title={text}>{text}</p>
      {sub && <p className="block-field-hint">{sub}</p>}
    </div>
  );

  const row = (category: string | null, rowLabel: string, sub?: string) => (
    <div key={category ?? ''} className="template-assign-row">
      {label(rowLabel, sub)}
      {CATEGORY_TYPES.map((type) => <div key={type} className="min-w-0">{cell(type, category, rowLabel)}</div>)}
      {extraColumn && <div className="min-w-0">{extraColumn.cell(category, rowLabel)}</div>}
    </div>
  );

  const everyEntry = t('templates.overview.everyEntry');
  return (
    <>
      <section className="space-y-2">
        <EntryTypeHeading entryType="journal" />
        <div className="template-assign-row">
          {label(everyEntry)}
          <div className="min-w-0">{cell('journal', ALL_CATEGORIES, everyEntry)}</div>
        </div>
      </section>

      <section className="space-y-1">
        <div className="template-assign-row template-assign-head">
          <span />
          {CATEGORY_TYPES.map((type) => <EntryTypeHeading key={type} entryType={type} />)}
          {extraColumn?.heading}
        </div>
        {row(ALL_CATEGORIES, t('templates.allCategories'), t('templates.assign.allCategoriesHint'))}
        {row(null, t('categories.uncategorized'))}
        {categories.map((cat) => row(cat.id, `${cat.emoji} ${categoryLabel(t, cat)}`))}
      </section>
    </>
  );
}
