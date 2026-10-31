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
 * Rank of a category in the list, like the rows in the dialog: "All
 * categories", "No category", then the categories; one in the trash last.
 */
function categoryRank(category: string | null, order: ReadonlyMap<string, number>): number {
  if (category === ALL_CATEGORIES) return -2;
  if (category === null) return -1;
  return order.get(category) ?? Number.MAX_SAFE_INTEGER;
}

/**
 * "Assignment" as a property of a template: a value button ("Everywhere", the
 * single assignment (with a star if it is the default) or the count) that opens the
 * dialog in which assignment and default are set
 * (`TemplateAssignmentsModal`); it also shows whose default a star
 * supersedes, and replacement only happens with "Done". No list below: every variant
 * of that read as separate entries instead of as a value of the property.
 */
export default function TemplateAssignments({ templateId, name, assignments, onChange }: Props) {
  const { t } = useTranslation();
  const label = useAssignmentLabel();
  const parts = useAssignmentParts();
  const [modalOpen, setModalOpen] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const categories = useCategoryStore((s) => s.categories);
  const order = new Map(categories.map((c, i) => [c.id, i]));
  // Journal, wiki, operations; within them in the order of the table in the dialog.
  const sorted = [...assignments].sort((a, b) =>
    TEMPLATE_ENTRY_TYPES.indexOf(a.entryType) - TEMPLATE_ENTRY_TYPES.indexOf(b.entryType)
    || categoryRank(a.category, order) - categoryRank(b.category, order));

  // The button itself shows a single assignment, several as a count; the whole list
  // (★ for a default) is in the tooltip and in the dialog.
  const single = sorted.length === 1 ? sorted[0] : null;
  const singleParts = single ? parts(single.entryType, single.category) : null;
  let summary: string;
  if (sorted.length === 0) summary = t('templates.availableEverywhere');
  else if (singleParts) summary = singleParts.place ?? singleParts.type;
  else summary = t('templates.assignmentCount', { count: sorted.length });
  const tooltip = sorted.length === 0
    ? t('templates.assign.open')
    : sorted.map((a) => `${label(a.entryType, a.category)}${a.isDefault ? ' ★' : ''}`).join('\n');

  return (
    <>
      <EditPropertyRow icon={<SlidersHorizontal size={14} />} label={t('templates.assignment')}>
        {/* Like icon and cover image: when empty the button opens the dialog right away,
            otherwise a menu: set, or clear all assignments. */}
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
            // Ends up in the draft like any change; only applies with "Done".
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
            // Nothing really changed (not even by going back and forth): the draft stays untouched.
            if (!sameAssignments(assignments, next)) onChange(next);
            setModalOpen(false);
          }}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}
