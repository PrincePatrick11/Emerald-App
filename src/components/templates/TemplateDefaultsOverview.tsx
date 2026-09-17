import { useTranslation } from 'react-i18next';
import { CornerDownRight } from 'lucide-react';
import { GroupDivider } from '../ui/Dashboard';
import BlockGlyph from '../blocks/BlockGlyph';
import { useTemplateStore } from '../../store/templateStore';
import { useUIStore } from '../../store/uiStore';
import { usePersistedFlag } from '../../hooks/usePersistedFlag';
import { templateLabel } from '../../lib/blocks/blockAttrs';
import {
  ALL_CATEGORIES, assignmentStateAt, defaultTemplateAt,
  type AssignmentState, type Template, type TemplateEntryType,
} from '../../lib/blocks/templates';
import {
  AssignmentLegend, AssignmentTable, ASSIGNMENT_STATE_ICONS, useAssignmentStateLabels,
} from './assignmentParts';

/** Der Abschnitt als Ganzes ist eine Einstellung — wie die Altar-Bibliothek. */
const COLLAPSED_KEY = 'templates-defaults-collapsed';

/** Was die Übersicht zeigt — „nicht zugewiesen" ist hier einfach eine leere Zelle. */
const SHOWN_STATES: AssignmentState[] = ['default', 'assigned'];

/**
 * Die Gesamtübersicht unter der Vorlagenliste, nur zum Ansehen — dieselbe
 * Tabelle wie der Zuweisungs-Dialog einer Vorlage: Journal als eine Zeile,
 * Wiki und Operationen als Spalten mit „Alle Kategorien", „Ohne Kategorie"
 * und jeder Kategorie. Eine Zelle nennt den Standard (Stern) und die Vorlagen,
 * die dort zur Wahl stehen; ohne eigenen Standard, was stattdessen greift.
 * Ein Name öffnet die Vorlage — geändert wird nur dort.
 */
export default function TemplateDefaultsOverview() {
  const { t } = useTranslation();
  const templates = useTemplateStore((s) => s.templates);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const stateLabels = useAssignmentStateLabels();
  const [collapsed, toggle] = usePersistedFlag(COLLAPSED_KEY);

  if (templates.length === 0) return null;

  const link = (template: Template, state: AssignmentState) => {
    const Icon = ASSIGNMENT_STATE_ICONS[state];
    return (
      <button
        key={template.id}
        type="button"
        className="template-overview-link text-xs"
        onClick={() => setActiveView({ type: 'templates', id: template.id })}
        title={`${templateLabel(t, template)} — ${stateLabels[state]}`}
      >
        <span className={state === 'default' ? 'template-default-star' : 'template-overview-state'}>
          <Icon size={12} fill={state === 'default' ? 'currentColor' : 'none'} />
        </span>
        <BlockGlyph icon={template.icon} size={12} />
        <span className="truncate">{templateLabel(t, template)}</span>
      </button>
    );
  };

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
      <div className="flex min-w-0 flex-col items-start gap-1 pt-0.5">
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

  return (
    <div className="mt-8">
      <GroupDivider label={t('templates.overview.title')} collapsed={collapsed} onToggleCollapse={toggle} />
      {!collapsed && (
        <div className="space-y-5">
          <AssignmentTable variant="overview" cell={cell} />

          <AssignmentLegend states={SHOWN_STATES} />
        </div>
      )}
    </div>
  );
}
