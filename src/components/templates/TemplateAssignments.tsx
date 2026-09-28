import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SlidersHorizontal, Star } from 'lucide-react';
import SidebarSection, { SidebarEmpty } from '../sidebar/fields/SidebarSection';
import { useCategoryStore } from '../../store/categoryStore';
import {
  ALL_CATEGORIES, assignmentKey, sameAssignments, TEMPLATE_ENTRY_TYPES, type TemplateAssignment,
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
 * beides festlegt (`TemplateAssignmentsModal`) — dort steht auch, wessen
 * Standard ein Stern ablöst; ersetzt wird erst mit „Fertig".
 */
export default function TemplateAssignments({ templateId, name, assignments, onChange }: Props) {
  const { t } = useTranslation();
  const label = useAssignmentLabel();
  const [modalOpen, setModalOpen] = useState(false);

  const categories = useCategoryStore((s) => s.categories);
  const order = new Map(categories.map((c, i) => [c.id, i]));
  // Journal, Wiki, Operationen; darin in der Reihenfolge der Tabelle im Dialog.
  const sorted = [...assignments].sort((a, b) =>
    TEMPLATE_ENTRY_TYPES.indexOf(a.entryType) - TEMPLATE_ENTRY_TYPES.indexOf(b.entryType)
    || categoryRank(a.category, order) - categoryRank(b.category, order));

  return (
    <>
      {/* Derselbe Abschnitt wie Verlinkungen, Tags und Blöcke: gleicher Kopf, Zähler, gemerktes Auf/Zu. */}
      <SidebarSection storageKey="template-assignments-open" label={t('templates.assignments')} count={sorted.length}>
        {sorted.length === 0 ? (
          <SidebarEmpty>{t('templates.noAssignments')}</SidebarEmpty>
        ) : (
          <ul>
            {sorted.map((a) => (
              // Kein Icon vorn: der Text beginnt, wo die Icons der übrigen Zeilen beginnen.
              <li key={assignmentKey(a.entryType, a.category)} className="flex items-center gap-2 h-8 pl-2.5 pr-3 text-[13px] min-w-0">
                <span className="flex-1 min-w-0 truncate text-[var(--text-primary)]">{label(a.entryType, a.category)}</span>
                {a.isDefault && (
                  <span className="template-default-star" title={t('templates.assign.default')}>
                    <Star size={14} fill="currentColor" />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="sidebar-section-actions sidebar-section-actions--plain">
          <button type="button" className="sidebar-section-button" onClick={() => setModalOpen(true)}>
            <SlidersHorizontal size={13} className="flex-shrink-0" />
            <span className="min-w-0 truncate">{t('templates.assign.open')}</span>
          </button>
        </div>
      </SidebarSection>

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
    </>
  );
}
