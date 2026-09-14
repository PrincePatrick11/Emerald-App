import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Star, X } from 'lucide-react';
import FieldDropdown from '../ui/FieldDropdown';
import Button from '../ui/Button';
import type { DropdownOption } from '../ui/Dropdown';
import { useCategoryStore } from '../../store/categoryStore';
import { useTemplateStore } from '../../store/templateStore';
import { categoryLabel } from '../../lib/categories';
import { MODULES, viewTypeForEntryType } from '../../lib/modules';
import { templateLabel } from '../../lib/blocks/blockAttrs';
import {
  ALL_CATEGORIES, assignmentKey, defaultTemplateAt, TEMPLATE_ENTRY_TYPES,
  type TemplateAssignment, type TemplateEntryType,
} from '../../lib/blocks/templates';
import { useAssignmentLabel } from './useAssignmentLabel';

/** Menüwert für „ohne Kategorie" — `null` ist kein Dropdown-Wert. */
const NO_CATEGORY = '__none__';

interface Props {
  templateId: string;
  assignments: TemplateAssignment[];
  onChange: (assignments: TemplateAssignment[]) => void;
}

/**
 * Die Zuweisungen einer Vorlage in ihrer Seitenleiste: je Kombination eine
 * Zeile mit Stern (Standard) und Entfernen, darunter Eintragsart und Kategorie
 * zum Hinzufügen. Setzt der Stern eine Kombination, die schon eine andere
 * Vorlage als Standard hält, sagt die Zeile, wen es trifft — ersetzt wird
 * erst mit „Fertig".
 */
export default function TemplateAssignments({ templateId, assignments, onChange }: Props) {
  const { t } = useTranslation();
  const categories = useCategoryStore((s) => s.categories);
  const templates = useTemplateStore((s) => s.templates);
  const label = useAssignmentLabel();
  const [entryType, setEntryType] = useState<TemplateEntryType>('journal');
  const [picked, setPicked] = useState<string>(ALL_CATEGORIES);

  // Eine gewählte Kategorie, die inzwischen gelöscht wurde, fällt auf „alle" zurück.
  const category = picked === ALL_CATEGORIES || picked === NO_CATEGORY || categories.some((c) => c.id === picked)
    ? picked
    : ALL_CATEGORIES;
  const chosenCategory = entryType === 'journal' ? ALL_CATEGORIES : category === NO_CATEGORY ? null : category;
  const taken = new Set(assignments.map((a) => assignmentKey(a.entryType, a.category)));
  const canAdd = !taken.has(assignmentKey(entryType, chosenCategory));

  /** Die andere aktive Vorlage, die diese Kombination als Standard hält. */
  const holder = (a: TemplateAssignment) =>
    defaultTemplateAt(templates.filter((tpl) => tpl.id !== templateId), a.entryType, a.category);

  const typeOptions: DropdownOption<TemplateEntryType>[] = TEMPLATE_ENTRY_TYPES.map((type) => ({
    value: type,
    label: t(MODULES[viewTypeForEntryType(type)].navLabelKey),
  }));
  const categoryOptions: DropdownOption<string>[] = [
    { value: ALL_CATEGORIES, label: t('templates.allCategories') },
    { value: NO_CATEGORY, label: t('categories.uncategorized') },
    ...categories.map((c) => ({ value: c.id, label: categoryLabel(t, c), emoji: c.emoji })),
  ];

  const add = () => {
    if (!canAdd) return;
    onChange([...assignments, { entryType, category: chosenCategory, isDefault: false }]);
  };
  const toggleDefault = (index: number) =>
    onChange(assignments.map((a, i) => (i === index ? { ...a, isDefault: !a.isDefault } : a)));
  const remove = (index: number) => onChange(assignments.filter((_, i) => i !== index));

  return (
    <section className="space-y-2">
      <p className="label-xs">{t('templates.assignments')}</p>
      <p className="block-field-hint">{t('templates.assignmentsHint')}</p>

      {assignments.length === 0 ? (
        <p className="text-xs text-stone-500">{t('templates.noAssignments')}</p>
      ) : (
        <ul className="space-y-1">
          {assignments.map((a, index) => {
            const other = a.isDefault ? holder(a) : undefined;
            const starLabel = a.isDefault ? t('templates.isDefault') : t('templates.makeDefault');
            return (
              <li key={assignmentKey(a.entryType, a.category)}>
                <div className="flex items-center gap-2">
                  <span className="flex-1 min-w-0 truncate text-xs text-[var(--text-secondary)]">{label(a.entryType, a.category)}</span>
                  <button
                    type="button"
                    className={`block-row-action${a.isDefault ? ' block-row-action--on' : ''}`}
                    onClick={() => toggleDefault(index)}
                    aria-pressed={a.isDefault}
                    title={starLabel}
                    aria-label={starLabel}
                  >
                    <Star size={12} fill={a.isDefault ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    type="button"
                    className="block-row-action"
                    onClick={() => remove(index)}
                    title={t('templates.removeAssignment')}
                    aria-label={t('templates.removeAssignment')}
                  >
                    <X size={12} />
                  </button>
                </div>
                {other && (
                  <p className="block-field-hint">{t('templates.replacesDefault', { name: templateLabel(t, other) })}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="space-y-1.5 pt-1">
        <FieldDropdown value={entryType} options={typeOptions} onChange={setEntryType} />
        {entryType !== 'journal' && <FieldDropdown value={category} options={categoryOptions} onChange={setPicked} />}
        <Button tone="neutral" small disabled={!canAdd} onClick={add} title={canAdd ? undefined : t('templates.alreadyAssigned')}>
          <Plus size={12} />
          <span>{t('templates.addAssignment')}</span>
        </Button>
      </div>
    </section>
  );
}
