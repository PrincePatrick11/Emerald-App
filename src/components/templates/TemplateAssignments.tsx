import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SlidersHorizontal, Star, X } from 'lucide-react';
import ContextMenu from '../ui/ContextMenu';
import { EditPropertyRow } from '../sidebar/fields/EditProperties';
import { useCategoryStore } from '../../store/categoryStore';
import {
  ALL_CATEGORIES, sameAssignments, TEMPLATE_ENTRY_TYPES, type TemplateAssignment,
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
 * „Zuweisung" als Eigenschaft einer Vorlage: ein Wert-Knopf — „Überall", die
 * eine Zuweisung (mit Stern, wenn sie Standard ist) oder die Zahl —, der den
 * Dialog öffnet, in dem man Zuweisung und Standard festlegt
 * (`TemplateAssignmentsModal`); dort steht auch, wessen Standard ein Stern
 * ablöst, ersetzt wird erst mit „Fertig". Keine Liste darunter: jede Variante
 * davon las sich als eigene Einträge statt als Wert der Eigenschaft.
 */
export default function TemplateAssignments({ templateId, name, assignments, onChange }: Props) {
  const { t } = useTranslation();
  const label = useAssignmentLabel();
  const parts = useAssignmentParts();
  const [modalOpen, setModalOpen] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const categories = useCategoryStore((s) => s.categories);
  const order = new Map(categories.map((c, i) => [c.id, i]));
  // Journal, Wiki, Operationen; darin in der Reihenfolge der Tabelle im Dialog.
  const sorted = [...assignments].sort((a, b) =>
    TEMPLATE_ENTRY_TYPES.indexOf(a.entryType) - TEMPLATE_ENTRY_TYPES.indexOf(b.entryType)
    || categoryRank(a.category, order) - categoryRank(b.category, order));

  // Eine Zuweisung zeigt der Knopf selbst, mehrere als Zahl; die ganze Liste
  // (★ für einen Standard) steht im Tooltip und im Dialog.
  const single = sorted.length === 1 ? sorted[0] : null;
  const singleParts = single ? parts(single.entryType, single.category) : null;
  const summary = sorted.length === 0
    ? t('templates.availableEverywhere')
    : singleParts ? singleParts.place ?? singleParts.type : t('templates.assignmentCount', { count: sorted.length });
  const tooltip = sorted.length === 0
    ? t('templates.assign.open')
    : sorted.map((a) => `${label(a.entryType, a.category)}${a.isDefault ? ' ★' : ''}`).join('\n');

  return (
    <>
      <EditPropertyRow icon={<SlidersHorizontal size={14} />} label={t('templates.assignment')}>
        {/* Wie Icon und Titelbild: leer öffnet der Knopf gleich den Dialog,
            sonst ein Menü — festlegen oder alle Zuweisungen lösen. */}
        <button
          type="button"
          aria-haspopup={sorted.length === 0 ? 'dialog' : 'menu'}
          aria-expanded={sorted.length === 0 ? undefined : menu !== null}
          aria-label={`${t('templates.assignment')}: ${summary}`}
          title={tooltip}
          className="prop-value-btn"
          onClick={(e) => {
            if (sorted.length === 0) { setModalOpen(true); return; }
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ x: r.right, y: r.bottom + 4 });
          }}
        >
          <span className="min-w-0 truncate">{summary}</span>
          {single?.isDefault && (
            <span className="template-default-star" aria-label={t('templates.assign.default')}>
              <Star size={12} fill="currentColor" />
            </span>
          )}
        </button>
      </EditPropertyRow>

      {menu && (
        <ContextMenu
          align="right"
          minWidth={120}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          actions={[
            { label: t('templates.assign.assignShort'), icon: <SlidersHorizontal size={12} />, onClick: () => setModalOpen(true) },
            // Landet wie jede Änderung im Entwurf — gilt erst mit „Fertig".
            { label: t('templates.assign.clearShort'), icon: <X size={12} />, onClick: () => onChange([]), danger: true },
          ]}
        />
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
    </>
  );
}
