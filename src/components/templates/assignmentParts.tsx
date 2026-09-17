import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Minus, Star, type LucideIcon } from 'lucide-react';
import { useCategoryStore } from '../../store/categoryStore';
import { categoryLabel } from '../../lib/categories';
import { MODULES, viewTypeForEntryType } from '../../lib/modules';
import { ALL_CATEGORIES, TEMPLATE_ENTRY_TYPES, type AssignmentState, type TemplateEntryType } from '../../lib/blocks/templates';

/**
 * Was der Zuweisungs-Dialog einer Vorlage und die Standardvorlagen-Übersicht
 * im Dashboard gemeinsam haben — damit beide dieselbe Tabelle zeigen: Journal
 * als eine Zeile, Wiki und Operationen als Spalten, eine Zeile je Kategorie.
 */

/** Die Eintragsarten mit Kategorien — die Spalten der Tabelle. */
export const CATEGORY_TYPES = TEMPLATE_ENTRY_TYPES.filter((type) => type !== 'journal');

export const ASSIGNMENT_STATES: AssignmentState[] = ['off', 'assigned', 'default'];
export const ASSIGNMENT_STATE_ICONS: Record<AssignmentState, LucideIcon> = { off: Minus, assigned: Check, default: Star };

/** Die Namen der drei Stufen, wie Legende, Tooltips und Seitenleiste sie zeigen. */
export function useAssignmentStateLabels(): Record<AssignmentState, string> {
  const { t } = useTranslation();
  return {
    off: t('templates.assign.off'),
    assigned: t('templates.assign.assigned'),
    default: t('templates.assign.default'),
  };
}

/** Die Legende über der Tabelle: Icon, Name und was die Stufe bewirkt. */
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

/** Der Kopf einer Eintragsart: Modul-Icon und Name. */
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
  /** `dialog`: feste Spalten für die Schalter; `overview`: zwei Spalten, die sich die Breite teilen. */
  variant: 'dialog' | 'overview';
  /** Der Inhalt einer Zelle. `rowLabel` benennt die Zeile — für Beschriftungen, die ohne sie mehrdeutig wären. */
  cell: (entryType: TemplateEntryType, category: string | null, rowLabel: string) => ReactNode;
  /** Eine Spalte hinter den Eintragsarten, je Kategorie-Zeile eine Zelle — der Dialog setzt dort beide zugleich. */
  extraColumn?: { heading: ReactNode; cell: (category: string | null, rowLabel: string) => ReactNode };
}

/**
 * Die Tabelle selbst: Journal als eine Zeile (die Zelle steht unter Wiki),
 * darunter der Kopf mit den Eintragsarten und die Zeilen „Alle Kategorien",
 * „Ohne Kategorie" und je Kategorie. Was in den Zellen steht, geben Dialog
 * und Übersicht vor.
 */
export function AssignmentTable({ variant, cell, extraColumn }: AssignmentTableProps) {
  const { t } = useTranslation();
  const categories = useCategoryStore((s) => s.categories);
  const rowClass = `template-assign-row${variant === 'overview' ? ' template-assign-row--overview' : ''}`;
  // Die Schalter im Dialog sind höher als die Namen in der Übersicht; das Label sitzt mittig zur ersten Zeile.
  const labelPad = variant === 'dialog' ? 'pt-1' : 'pt-0.5';

  const label = (text: string, sub?: string) => (
    <div className={`min-w-0 ${labelPad}`}>
      <p className="truncate text-xs text-[var(--text-secondary)]" title={text}>{text}</p>
      {sub && <p className="block-field-hint">{sub}</p>}
    </div>
  );

  const row = (category: string | null, rowLabel: string, sub?: string) => (
    <div key={category ?? ''} className={rowClass}>
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
        <div className={rowClass}>
          {label(everyEntry)}
          <div className="min-w-0">{cell('journal', ALL_CATEGORIES, everyEntry)}</div>
        </div>
      </section>

      <section className="space-y-1">
        <div className={`${rowClass} template-assign-head`}>
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
