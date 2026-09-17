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
 * Zuweisung und Standard einer Vorlage auf einen Blick: Journal als eine
 * Zeile, darunter Wiki und Operationen als Tabelle — „Alle Kategorien" (die
 * ganze Eintragsart), „Ohne Kategorie" und jede Kategorie. Jede Zelle wählt
 * zwischen nicht zugewiesen, zur Wahl und Standard; die letzte Spalte setzt
 * eine Kategorie für beide Eintragsarten zugleich.
 *
 * Bearbeitet wird eine Kopie; „Übernehmen" legt sie in den Entwurf der Seite,
 * gespeichert wird erst mit „Fertig". Zuweisungen zu Kategorien im Papierkorb
 * tauchen hier nicht auf und bleiben unberührt.
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

  /** Eine Zelle: die Auswahl, darunter wer sonst Standard ist — oder wen der Stern hier ablöst. */
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

  /** Die Spalte „Beide": zeigt einen Stand nur, wenn Wiki und Operationen ihn teilen. */
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
      bodyClassName="flex min-h-0 flex-1 flex-col"
    >
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <div className="space-y-2">
          <p className="block-field-hint">{t('templates.assign.hint')}</p>
          <AssignmentLegend states={ASSIGNMENT_STATES} />
        </div>

        <AssignmentTable
          variant="dialog"
          cell={cell}
          extraColumn={{
            heading: <p className="label-xs" title={t('templates.assign.bothHint')}>{t('templates.assign.both')}</p>,
            cell: bothCell,
          }}
        />
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t px-4 py-3" style={{ borderColor: 'var(--border-soft)' }}>
        <Button tone="neutral" onClick={onClose}>{t('common.cancel')}</Button>
        <Button tone="jade" onClick={() => onApply(working)}>{t('templates.assign.apply')}</Button>
      </div>
    </Modal>
  );
}
