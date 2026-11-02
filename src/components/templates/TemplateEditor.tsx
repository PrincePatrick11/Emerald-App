import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import LibraryPageFrame from '../ui/LibraryPageFrame';
import { Smile } from 'lucide-react';
import LinkedEntriesField from '../sidebar/fields/LinkedEntriesField';
import TagsField from '../sidebar/fields/TagsField';
import { PropertiesSection } from '../sidebar/fields/EntryReadSections';
import { EditSidebarBody, MediaPropertyRow } from '../sidebar/fields/EditProperties';
import BlockStack from '../blocks/BlockStack';
import BlockSidebarArea, { BlockAddActions } from '../blocks/BlockSidebarArea';
import TemplateAssignments from './TemplateAssignments';
import TemplateUsage from './TemplateUsage';
import { useTemplateStore } from '../../store/templateStore';
import { useTemplateDraftStore, type TemplateDraft } from '../../store/draftStore';
import type { EntryContentRow } from '../../store/blockCopies';
import { templateLabel } from '../../lib/blocks/blockAttrs';
import { useDraftPage } from '../../hooks/useDraftPage';
import { useShrunkIcon } from '../../hooks/useShrunkIcon';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import { DEFAULT_TEMPLATE_ICON, mergeAssignmentChanges, type Template } from '../../lib/blocks/templates';

const draftOf = (d: TemplateDraft): TemplateDraft => ({
  name: d.name, icon: d.icon, title: d.title,
  content: d.content, tags: d.tags, assignments: d.assignments,
});

interface Props {
  template: Template;
  entries: readonly EntryContentRow[];
  /** Back to the list. The back link above the title leaves the draft behind; "Done" and "Cancel" settle it first. */
  onClose: () => void;
  onDelete: () => void;
  /** Just created with "New": "Cancel" moves it to the trash (`onDelete`). */
  isNew?: boolean;
}

/**
 * A template's page (`LibraryPageFrame`, like a custom block): name
 * as title, the title of new entries and the block stack,
 * the same editor as in an entry, always in edit mode. In the sidebar:
 * icon, linked entries, tags, assignment and default (set in the
 * dialog), the block management and the entries that arose from the
 * template.
 *
 * A draft is edited (`useDraftPage`); only "Done" saves the
 * changed fields, and in doing so applies chosen stars, which the other templates
 * then lack. Entries never change: they carry copies.
 */
export default function TemplateEditor({ template, entries, onClose, onDelete, isNew }: Props) {
  const { t } = useTranslation();
  const updateTemplate = useTemplateStore((s) => s.updateTemplate);
  const { draft, patch, dirty, busy, finish, cancel } = useDraftPage({
    store: useTemplateDraftStore,
    viewType: 'templates',
    id: template.id,
    label: (current) => templateLabel(t, current),
    saved: draftOf(template),
    // Assignments as a change on top of the current state; another template may have taken stars in the meantime.
    save: (id, patch, base) => updateTemplate(id, patch.assignments
      ? { ...patch, assignments: mergeAssignmentChanges(base.assignments, patch.assignments, useTemplateStore.getState().templates.find((t) => t.id === id)?.assignments ?? []) }
      : patch),
    onClose,
    onCancelNew: isNew ? onDelete : undefined,
    logTag: 'TemplateEditor',
  });
  // Only the initial value: the stack is uncontrolled afterwards (see BlockStack).
  const [initialContent] = useState(draft.content);
  const setIcon = useShrunkIcon((icon) => patch({ icon }), 'TemplateEditor');

  const sidebar = (
    <EditSidebarBody>
      <BlockAddActions />

      <PropertiesSection>
        <MediaPropertyRow
          rowIcon={<Smile size={14} />}
          label={t('properties.icon')}
          kind="icon"
          value={draft.icon}
          onChange={(icon) => void setIcon(icon)}
          fallback={DEFAULT_TEMPLATE_ICON}
        />
        <TemplateAssignments
          templateId={template.id}
          name={templateLabel(t, draft)}
          assignments={draft.assignments}
          onChange={(assignments) => patch({ assignments })}
        />
      </PropertiesSection>

      <LinkedEntriesField content={draft.content} />

      <TagsField tags={draft.tags} onChange={(tags) => patch({ tags })} />

      <BlockSidebarArea />

      <TemplateUsage entries={entries} />
    </EditSidebarBody>
  );

  return (
    <LibraryPageFrame
      backLabel={t('nav.templates')}
      onBack={onClose}
      draft={{ dirty, busy, onDone: () => void finish(), onCancel: cancel, onDelete }}
      name={draft.name}
      nameLabel={t('templates.name')}
      namePlaceholder={t('templates.namePlaceholder')}
      onNameChange={(name) => patch({ name })}
      sidebar={sidebar}
    >
      <div className="max-w-3xl mb-6">
        <p className="label-xs mb-2">{t('templates.entryTitle')}</p>
        <input
          className={`${OP_PROP_SELECT_CLASSES} selectable`}
          value={draft.title}
          placeholder={t('templates.entryTitlePlaceholder')}
          aria-label={t('templates.entryTitle')}
          onChange={(e) => patch({ title: e.target.value })}
        />
      </div>
      <p className="label-xs mb-2">{t('templates.content')}</p>
      <BlockStack
        entryId={template.id}
        initialContent={initialContent}
        placeholder={t('templates.contentPlaceholder')}
        onChange={(content) => patch({ content })}
        isEditing
      />
    </LibraryPageFrame>
  );
}
