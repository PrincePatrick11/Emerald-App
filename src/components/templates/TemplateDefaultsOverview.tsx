import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleDashed, CornerDownRight, FilePlus, Layers } from 'lucide-react';
import { GroupDivider } from '../ui/Dashboard';
import BlockGlyph from '../blocks/BlockGlyph';
import { useTemplateStore } from '../../store/templateStore';
import { useCategoryStore } from '../../store/categoryStore';
import { useUIStore } from '../../store/uiStore';
import { usePersistedFlag } from '../../hooks/usePersistedFlag';
import { templateLabel } from '../../lib/blocks/blockAttrs';
import { categoryLabel } from '../../lib/categories';
import {
  ALL_CATEGORIES, assignmentStateAt, defaultTemplateAt,
  type AssignmentState, type Template, type TemplateEntryType,
} from '../../lib/blocks/templates';
import { ASSIGNMENT_STATE_ICONS, CATEGORY_TYPES, EntryTypeHeading, useAssignmentStateLabels } from './assignmentParts';

/** Der Abschnitt als Ganzes ist eine Einstellung — wie die Altar-Bibliothek. */
const COLLAPSED_KEY = 'templates-defaults-collapsed';

/** Kategorie-Spalte etwas breiter, Wiki und Operationen teilen sich den Rest. */
const GRID = 'grid grid-cols-[minmax(9rem,1.3fr)_repeat(2,minmax(0,1fr))] items-center gap-x-6';

/**
 * Die Gesamtübersicht unter der Vorlagenliste, nur zum Ansehen, in einem
 * Panel: oben Journal für sich — es hat keine Kategorien, als Spalte der
 * Tabelle stünde es fast leer —, darunter die Tabelle mit einer Zeile je
 * Kategorie („Alle Kategorien", „Ohne Kategorie", dann jede Kategorie) und
 * Wiki und Operationen als Spalten; derselbe Aufbau wie im Zuweisungs-Dialog.
 * Eine Zelle nennt den Standard und die Vorlagen, die dort zur Wahl stehen;
 * ohne eigenen Standard, was stattdessen greift. Der Standard steht ohne
 * Stern, eine Vorlage nur zur Wahl mit Häkchen. Ein Name öffnet die Vorlage —
 * geändert wird nur dort.
 */
export default function TemplateDefaultsOverview() {
  const { t } = useTranslation();
  const templates = useTemplateStore((s) => s.templates);
  const categories = useCategoryStore((s) => s.categories);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const stateLabels = useAssignmentStateLabels();
  const [collapsed, toggle] = usePersistedFlag(COLLAPSED_KEY);

  // Der Standard steht ohne Zeichen — er ist, was die Tabelle zeigt. Nur eine
  // Vorlage, die dort bloß zur Wahl steht, trägt das leise Häkchen.
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
   * Eine Zelle: Standard, dann die Vorlagen zur Wahl. Ohne eigenen Standard
   * steht darunter, was stattdessen greift — auch neben Vorlagen zur Wahl, die
   * beim Anlegen nichts einsetzen. Ganz leer bleibt ein Strich.
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

  // „Alle Kategorien" ist der Rückfall aller übrigen Zeilen und hebt sich
  // deshalb mit fettem Namen ab — nur damit, eine hinterlegte Zeile war zu laut.
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

  // Die feste Emoji-Spalte hält die Namen in einer Flucht; die beiden Zeilen
  // ohne eigene Kategorie tragen dort ein Icon statt eines Emojis.
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
          <p className="mb-3 text-xs text-[var(--text-muted)]">{t('templates.overview.hint')}</p>
          <div className="panel px-4">
            {/* Journal: eine Zeile, die Zelle über beide Spalten. */}
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
