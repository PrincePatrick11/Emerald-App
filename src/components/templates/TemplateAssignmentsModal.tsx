import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import IconToggleGroup from '../ui/IconToggleGroup';
import { useTemplateStore } from '../../store/templateStore';
import { MODULES, viewTypeForEntryType } from '../../lib/modules';
import { templateLabel } from '../../lib/blocks/blockAttrs';
import {
  assignmentStateAt, defaultTemplateAt, withAssignmentState,
  type AssignmentState, type TemplateAssignment, type TemplateEntryType,
} from '../../lib/blocks/templates';
import {
  AssignmentLegend, AssignmentTable, ASSIGNMENT_STATE_ICONS, ASSIGNMENT_STATES, CATEGORY_TYPES, useAssignmentStateLabels,
} from './assignmentParts';

interface Props {
  templateId: string;
  name: string;
  assignments: TemplateAssignment[];
  onApply: (assignments: TemplateAssignment[]) => void;
  onClose: () => void;
}

/**
 * Assignment and default of a template at a glance: journal as a single
 * row, below it wiki and operations as a table: "All categories" (the
 * whole entry type), "No category" and each category. Each cell chooses
 * between not assigned, selectable and default; the last column sets
 * a category for both entry types at once.
 *
 * A copy is edited; "Apply" puts it into the page's draft,
 * and saving only happens with "Done". Assignments to categories in the trash
 * do not appear here and stay untouched.
 */
export default function TemplateAssignmentsModal({ templateId, name, assignments, onApply, onClose }: Props) {
  const { t } = useTranslation();
  const templates = useTemplateStore((s) => s.templates);
  const [working, setWorking] = useState(assignments);

  const others = templates.filter((tpl) => tpl.id !== templateId);
  const stateLabels = useAssignmentStateLabels();
  const options = ASSIGNMENT_STATES.map((value) => ({ value, label: stateLabels[value] }));

  const stateAt = (entryType: TemplateEntryType, category: string | null) => assignmentStateAt(working, entryType, category);
  const setState = (cells: readonly [TemplateEntryType, string | null][], state: AssignmentState) =>
    setWorking((current) => cells.reduce((acc, [entryType, category]) => withAssignmentState(acc, entryType, category, state), current));

  /** One cell: the selection, below it who else is default, or whom the star supersedes here. */
  const cell = (entryType: TemplateEntryType, category: string | null, rowLabel: string) => {
    const state = stateAt(entryType, category);
    const holder = defaultTemplateAt(others, entryType, category);
    const column = t(MODULES[viewTypeForEntryType(entryType)].navLabelKey);
    const hint = holder && (state === 'default'
      ? t('templates.assign.replaces', { name: templateLabel(t, holder) })
      : t('templates.assign.heldBy', { name: templateLabel(t, holder) }));
    return (
      <div className="space-y-0.5">
        <IconToggleGroup
          label={`${rowLabel} – ${column}`}
          options={options}
          icons={ASSIGNMENT_STATE_ICONS}
          value={state}
          onChange={(next) => setState([[entryType, category]], next)}
        />
        {hint && (
          <p className={`block-field-hint truncate${state === 'default' ? ' template-assign-replaces' : ''}`} title={hint}>
            {hint}
          </p>
        )}
      </div>
    );
  };

  /** The "Both" column: shows a state only if wiki and operations share it. */
  const bothCell = (category: string | null, rowLabel: string) => {
    const states = CATEGORY_TYPES.map((type) => stateAt(type, category));
    return (
      <IconToggleGroup
        label={`${rowLabel} – ${t('templates.assign.both')}`}
        options={options}
        icons={ASSIGNMENT_STATE_ICONS}
        value={states.every((st) => st === states[0]) ? states[0] : null}
        onChange={(next) => setState(CATEGORY_TYPES.map((type) => [type, category] as const), next)}
      />
    );
  };

  return (
    <Modal
      title={t('templates.assign.title', { name })}
      onClose={onClose}
      widthClassName="w-[640px] max-w-full"
      maxHeightClassName="max-h-[85vh]"
      bodyClassName="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4"
      footer={
        <>
          <Button tone="neutral" onClick={onClose}>{t('common.cancel')}</Button>
          <Button tone="jade" onClick={() => onApply(working)}>{t('templates.assign.apply')}</Button>
        </>
      }
    >
        <div className="space-y-2">
          <p className="block-field-hint">{t('templates.assign.hint')}</p>
          <AssignmentLegend states={ASSIGNMENT_STATES} />
        </div>

        <AssignmentTable
          cell={cell}
          extraColumn={{
            heading: <p className="label-xs" title={t('templates.assign.bothHint')}>{t('templates.assign.both')}</p>,
            cell: bothCell,
          }}
        />
    </Modal>
  );
}
