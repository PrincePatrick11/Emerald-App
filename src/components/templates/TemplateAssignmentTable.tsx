import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, CircleDashed, CornerDownRight, FilePlus, Layers, SlidersHorizontal } from 'lucide-react';
import DashboardSection from '../ui/DashboardSection';
import Dropdown from '../ui/Dropdown';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { EditPropertyRow } from '../sidebar/fields/EditProperties';
import BlockGlyph from '../blocks/BlockGlyph';
import { useTemplateStore } from '../../store/templateStore';
import { useCategoryStore } from '../../store/categoryStore';
import { templateLabel } from '../../lib/blocks/blockAttrs';
import { categoryLabel } from '../../lib/categories';
import { MODULES, viewTypeForEntryType } from '../../lib/modules';
import { ALL_CATEGORIES, assignedTemplateAt, TEMPLATE_ENTRY_TYPES, type TemplateEntryType } from '../../lib/blocks/templates';

/** The entry types with categories: the columns of the table. */
const CATEGORY_TYPES = TEMPLATE_ENTRY_TYPES.filter((type) => type !== 'journal');

/** Category column somewhat wider, wiki and operations share the rest. */
const GRID = 'grid grid-cols-[minmax(9rem,1.3fr)_repeat(2,minmax(0,1fr))] items-center gap-x-6';

/** The header of an entry type: module icon and name. */
function EntryTypeHeading({ entryType }: { entryType: TemplateEntryType }) {
  const { t } = useTranslation();
  const meta = MODULES[viewTypeForEntryType(entryType)];
  return (
    <p className="label-xs flex items-center gap-1.5">
      <meta.icon size={12} />
      {t(meta.navLabelKey)}
    </p>
  );
}

/**
 * One combination: the template new entries of it start with, or what applies
 * instead. With `templateId` (the template's own page) a click puts this template
 * into the cell or takes it out again; otherwise it chooses from all templates.
 */
function AssignmentCell({ entryType, category, rowLabel, templateId }: {
  entryType: TemplateEntryType;
  category: string | null;
  rowLabel: string;
  templateId?: string;
}) {
  const { t } = useTranslation();
  const templates = useTemplateStore((s) => s.templates);
  const assignTemplate = useTemplateStore((s) => s.assignTemplate);

  const assign = (id: string | null) => {
    assignTemplate(entryType, category, id).catch((e: unknown) => {
      console.error('[AssignmentCell] assigning failed:', e);
    });
  };

  const current = assignedTemplateAt(templates, entryType, category);
  const fallback = !current && category !== ALL_CATEGORIES ? assignedTemplateAt(templates, entryType, ALL_CATEGORIES) : undefined;
  const label = `${rowLabel} – ${t(MODULES[viewTypeForEntryType(entryType)].navLabelKey)}: ${current ? templateLabel(t, current) : t('templates.overview.none')}`;
  const content = current ? (
    <>
      <BlockGlyph icon={current.icon} size={14} />
      <span className="truncate">{templateLabel(t, current)}</span>
    </>
  ) : fallback ? (
    <span className="block-field-hint flex min-w-0 items-center gap-1.5" title={t('templates.overview.fallback', { name: templateLabel(t, fallback) })}>
      <CornerDownRight size={12} className="flex-shrink-0" />
      <span className="truncate">{templateLabel(t, fallback)}</span>
    </span>
  ) : (
    <span className="block-field-hint" title={t('templates.overview.none')}>—</span>
  );

  if (templateId) {
    const own = current?.id === templateId;
    return (
      <button
        type="button"
        className="template-assign-cell text-sm"
        aria-label={label}
        aria-pressed={own}
        onClick={() => assign(own ? null : templateId)}
      >
        {content}
        {own && <Check size={12} className="ml-auto flex-shrink-0 text-[var(--accent-text)]" />}
      </button>
    );
  }
  return (
    <Dropdown
      portal
      value={current?.id ?? ''}
      options={[
        { value: '', label: t('templates.overview.none') },
        ...templates.map((tpl) => ({ value: tpl.id, label: templateLabel(t, tpl), icon: <BlockGlyph icon={tpl.icon} size={14} /> })),
      ]}
      onChange={(id) => assign(id || null)}
      trigger={({ toggle }) => (
        <button type="button" className="template-assign-cell text-sm" aria-label={label} onClick={toggle}>
          {content}
          <ChevronDown size={12} className="template-assign-chevron" />
        </button>
      )}
    />
  );
}

/**
 * The table of where templates apply: at the top journal on its own (it has no
 * categories, as a column of the table it would be almost empty), below it one
 * row per category ("All categories", "No category", then each category) with
 * wiki and operations as columns. A change applies at once.
 */
function AssignmentGrid({ templateId }: { templateId?: string }) {
  const { t } = useTranslation();
  const categories = useCategoryStore((s) => s.categories);

  // "All categories" is the fallback of all other rows and therefore stands
  // out with a bold name, and only that; a shaded row was too loud. The fixed
  // emoji column keeps the names aligned.
  const row = (types: readonly TemplateEntryType[], category: string | null, name: string, glyph: ReactNode, bold = false) => (
    <div key={category ?? ''} className={`${GRID} border-t border-[var(--border-soft)] py-1.5`}>
      <div className={`flex min-w-0 items-center gap-2 text-sm text-primary${bold ? ' font-semibold' : ''}`}>
        <span className="flex w-5 flex-shrink-0 justify-center text-muted">{glyph}</span>
        <span className="truncate">{name}</span>
      </div>
      {types.map((type) => (
        <div key={type} className="min-w-0">
          <AssignmentCell entryType={type} category={category} rowLabel={name} templateId={templateId} />
        </div>
      ))}
    </div>
  );

  // No frame of its own: the dashboard puts it in a panel, the window is one already.
  return (
    <div>
      <div className="py-3">
        <EntryTypeHeading entryType="journal" />
      </div>
      {row(['journal'], ALL_CATEGORIES, t('templates.overview.everyEntry'), <FilePlus size={14} />)}

      <div className={`${GRID} border-t border-[var(--border-soft)] pt-5 pb-3`}>
        <span className="label-xs">{t('templates.overview.category')}</span>
        {CATEGORY_TYPES.map((type) => <EntryTypeHeading key={type} entryType={type} />)}
      </div>
      {row(CATEGORY_TYPES, ALL_CATEGORIES, t('templates.allCategories'), <Layers size={14} />, true)}
      {row(CATEGORY_TYPES, null, t('categories.uncategorized'), <CircleDashed size={14} />)}
      {categories.map((cat) => row(CATEGORY_TYPES, cat.id, categoryLabel(t, cat), cat.emoji))}
    </div>
  );
}

/** The table below the template list on the dashboard. The key keeps the state of the earlier overview. */
export default function TemplateAssignmentTable() {
  const { t } = useTranslation();
  const hasTemplates = useTemplateStore((s) => s.templates.length > 0);
  if (!hasTemplates) return null;
  return (
    <DashboardSection storageKey="templates-defaults-collapsed" label={t('templates.overview.title')}>
      <p className="mb-3 text-xs text-muted">{t('templates.overview.hint')}</p>
      <div className="panel px-4">
        <AssignmentGrid />
      </div>
    </DashboardSection>
  );
}

/**
 * The template's own "Assignments" property: the count, and the same table in a
 * window, where a click assigns this template. Applies at once, not with "Done".
 */
export function TemplateAssignmentProperty({ templateId, name }: { templateId: string; name: string }) {
  const { t } = useTranslation();
  const count = useTemplateStore((s) => s.templates.find((tpl) => tpl.id === templateId)?.assignments.length ?? 0);
  const [open, setOpen] = useState(false);
  return (
    <>
      <EditPropertyRow icon={<SlidersHorizontal size={14} />} label={t('templates.overview.title')}>
        <button type="button" className={`prop-value-btn${count > 0 ? '' : ' prop-value-btn--muted'}`} aria-haspopup="dialog" onClick={() => setOpen(true)}>
          <span className="min-w-0 truncate">{count > 0 ? count : '—'}</span>
        </button>
      </EditPropertyRow>
      {open && (
        <Modal
          title={t('templates.assignTitle', { name })}
          onClose={() => setOpen(false)}
          widthClassName="w-[640px] max-w-full"
          maxHeightClassName="max-h-[85vh]"
          bodyClassName="min-h-0 flex-1 space-y-3 overflow-y-auto modal-body"
          footer={<Button tone="jade" onClick={() => setOpen(false)}>{t('common.ok')}</Button>}
        >
          <p className="block-field-hint">{t('templates.assignHint')}</p>
          <AssignmentGrid templateId={templateId} />
        </Modal>
      )}
    </>
  );
}
