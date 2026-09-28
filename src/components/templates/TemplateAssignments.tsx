import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, SlidersHorizontal, Star } from 'lucide-react';
import { EditPropertyRow } from '../sidebar/fields/EditProperties';
import { SidebarItemRow } from '../sidebar/fields/SidebarSection';
import { useCategoryStore } from '../../store/categoryStore';
import { MODULES, viewTypeForEntryType } from '../../lib/modules';
import {
  ALL_CATEGORIES, assignmentKey, sameAssignments, TEMPLATE_ENTRY_TYPES, type TemplateAssignment,
} from '../../lib/blocks/templates';
import { useAssignmentLabel, useAssignmentParts } from './useAssignmentLabel';
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
 * „Zuweisung" als Eigenschaft einer Vorlage: ein Wert-Knopf („Überall" oder
 * die Zahl der Zuweisungen), der den Dialog öffnet, in dem man Zuweisung und
 * Standard festlegt (`TemplateAssignmentsModal`) — dort steht auch, wessen
 * Standard ein Stern ablöst; ersetzt wird erst mit „Fertig". Darunter als
 * gewöhnliche Zeilen, was gerade gilt: Modul-Icon, Kategorie, rechts der Stern
 * eines Standards.
 */
export default function TemplateAssignments({ templateId, name, assignments, onChange }: Props) {
  const { t } = useTranslation();
  const label = useAssignmentLabel();
  const parts = useAssignmentParts();
  const [modalOpen, setModalOpen] = useState(false);

  const categories = useCategoryStore((s) => s.categories);
  const order = new Map(categories.map((c, i) => [c.id, i]));
  // Journal, Wiki, Operationen; darin in der Reihenfolge der Tabelle im Dialog.
  const sorted = [...assignments].sort((a, b) =>
    TEMPLATE_ENTRY_TYPES.indexOf(a.entryType) - TEMPLATE_ENTRY_TYPES.indexOf(b.entryType)
    || categoryRank(a.category, order) - categoryRank(b.category, order));

  const summary = sorted.length === 0 ? t('templates.availableEverywhere') : t('templates.assignmentCount', { count: sorted.length });

  return (
    <>
      <EditPropertyRow icon={<SlidersHorizontal size={14} />} label={t('templates.assignment')}>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={`${t('templates.assignment')}: ${summary}`}
          title={t('templates.assign.open')}
          className="prop-value-btn"
          onClick={() => setModalOpen(true)}
        >
          <span className="min-w-0 truncate">{summary}</span>
          <ChevronDown size={13} />
        </button>
      </EditPropertyRow>

      {/* Wie die übrigen Zeilen der Seitenleiste: Modul-Icon, Kategorie, rechts
          der Stern eines Standards. Ein Klick öffnet ebenfalls den Dialog. */}
      {sorted.map((a) => {
        const { type, place } = parts(a.entryType, a.category);
        const Icon = MODULES[viewTypeForEntryType(a.entryType)].icon;
        return (
          <SidebarItemRow
            key={assignmentKey(a.entryType, a.category)}
            icon={<Icon size={14} />}
            label={place ?? type}
            title={label(a.entryType, a.category)}
            onClick={() => setModalOpen(true)}
            action={a.isDefault ? (
              <span className="template-default-star w-6 justify-center" title={t('templates.assign.default')}>
                <Star size={14} fill="currentColor" />
              </span>
            ) : <span className="w-6 flex-shrink-0" />}
          />
        );
      })}

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
