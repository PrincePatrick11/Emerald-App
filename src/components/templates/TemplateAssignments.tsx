import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SlidersHorizontal, Star } from 'lucide-react';
import Button from '../ui/Button';
import SidebarSectionHeader from '../sidebar/fields/SidebarSectionHeader';
import { usePersistedFlag } from '../../hooks/usePersistedFlag';
import { useTemplateStore } from '../../store/templateStore';
import { useCategoryStore } from '../../store/categoryStore';
import { templateLabel } from '../../lib/blocks/blockAttrs';
import {
  ALL_CATEGORIES, assignmentKey, defaultTemplateAt, sameAssignments, TEMPLATE_ENTRY_TYPES, type TemplateAssignment,
} from '../../lib/blocks/templates';
import { useAssignmentLabel } from './useAssignmentLabel';
import TemplateAssignmentsModal from './TemplateAssignmentsModal';

interface Props {
  templateId: string;
  name: string;
  assignments: TemplateAssignment[];
  onChange: (assignments: TemplateAssignment[]) => void;
}

/**
 * Rang einer Kategorie in der Liste — wie die Zeilen im Dialog: „Alle
 * Kategorien", „Ohne Kategorie", dann die Kategorien; eine im Papierkorb zuletzt.
 */
function categoryRank(category: string | null, order: ReadonlyMap<string, number>): number {
  if (category === ALL_CATEGORIES) return -2;
  if (category === null) return -1;
  return order.get(category) ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Zuweisung und Standard einer Vorlage in ihrer Seitenleiste: was gerade gilt,
 * als Liste mit Stern für die Standards, und der Knopf zum Dialog, in dem man
 * beides festlegt (`TemplateAssignmentsModal`). Löst ein Stern den Standard
 * einer anderen Vorlage ab, sagt die Zeile, wen es trifft — ersetzt wird erst
 * mit „Fertig".
 */
export default function TemplateAssignments({ templateId, name, assignments, onChange }: Props) {
  const { t } = useTranslation();
  const templates = useTemplateStore((s) => s.templates);
  const label = useAssignmentLabel();
  const [modalOpen, setModalOpen] = useState(false);
  // Eingeklappt bleibt eingeklappt — wie die Block-Verwaltung darunter.
  const [expanded, toggleExpanded] = usePersistedFlag('template-assignments-open', true);

  const others = templates.filter((tpl) => tpl.id !== templateId);
  const categories = useCategoryStore((s) => s.categories);
  const order = new Map(categories.map((c, i) => [c.id, i]));
  // Journal, Wiki, Operationen; darin in der Reihenfolge der Tabelle im Dialog.
  const sorted = [...assignments].sort((a, b) =>
    TEMPLATE_ENTRY_TYPES.indexOf(a.entryType) - TEMPLATE_ENTRY_TYPES.indexOf(b.entryType)
    || categoryRank(a.category, order) - categoryRank(b.category, order));

  return (
    <section className="border-t border-stone-700/60">
      <SidebarSectionHeader label={t('templates.assignments')} open={expanded} onToggle={toggleExpanded} className="pt-4" />

      {expanded && (
        <div className="mt-2 space-y-2">
          {sorted.length === 0 ? (
            <p className="text-xs text-stone-500">{t('templates.noAssignments')}</p>
          ) : (
            <ul className="space-y-1">
              {sorted.map((a) => {
                const other = a.isDefault ? defaultTemplateAt(others, a.entryType, a.category) : undefined;
                return (
                  <li key={assignmentKey(a.entryType, a.category)}>
                    <div className="flex items-center gap-2">
                      <span className="flex-1 min-w-0 truncate text-xs text-[var(--text-secondary)]">{label(a.entryType, a.category)}</span>
                      {a.isDefault && (
                        <span className="template-default-star" title={t('templates.assign.default')}>
                          <Star size={12} fill="currentColor" />
                        </span>
                      )}
                    </div>
                    {other && (
                      <p className="block-field-hint">{t('templates.replacesDefault', { name: templateLabel(t, other) })}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <Button tone="neutral" small onClick={() => setModalOpen(true)}>
            <SlidersHorizontal size={12} />
            <span>{t('templates.assign.open')}</span>
          </Button>
        </div>
      )}

      {modalOpen && (
        <TemplateAssignmentsModal
          templateId={templateId}
          name={name}
          assignments={assignments}
          onApply={(next) => {
            // Nichts wirklich geändert (auch nicht durch Hin und Her): der Entwurf bleibt unberührt.
            if (!sameAssignments(assignments, next)) onChange(next);
            setModalOpen(false);
          }}
          onClose={() => setModalOpen(false)}
        />
      )}
    </section>
  );
}
