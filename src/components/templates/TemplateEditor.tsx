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
import { useTemplateStore } from '../../store/templateStore';
import { useCategoryStore } from '../../store/categoryStore';
import TemplateCategoriesField from './TemplateCategoriesField';
import { useTemplateDraftStore, type TemplateDraft } from '../../store/draftStore';
import { templateLabel } from '../../lib/blocks/blockAttrs';
import { useDraftPage } from '../../hooks/useDraftPage';
import { useShrunkIcon } from '../../hooks/useShrunkIcon';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import { DEFAULT_TEMPLATE_ICON, type Template } from '../../lib/blocks/templates';

const draftOf = (tpl: Template): TemplateDraft => ({
  name: tpl.name, icon: tpl.icon, title: tpl.title,
  content: tpl.content, tags: tpl.tags, categories: { add: [], remove: [] },
});

interface Props {
  template: Template;
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
 * icon, the categories that start with it, linked entries, tags and the
 * block management.
 *
 * A draft is edited (`useDraftPage`); only "Done" saves the
 * changed fields. Entries never change: they carry copies.
 */
export default function TemplateEditor({ template, onClose, onDelete, isNew }: Props) {
  const { t } = useTranslation();
  const updateTemplate = useTemplateStore((s) => s.updateTemplate);
  const setTemplateCategories = useCategoryStore((s) => s.setTemplateCategories);

  /** The template's fields through its store; the categories' start templates as the toggles made here. */
  const save = async (id: string, { categories, ...fields }: Partial<TemplateDraft>) => {
    await updateTemplate(id, fields);
    if (categories) await setTemplateCategories(id, categories);
  };

  const { draft, patch, dirty, busy, finish, cancel } = useDraftPage({
    store: useTemplateDraftStore,
    viewType: 'templates',
    id: template.id,
    label: (current) => templateLabel(t, current),
    saved: draftOf(template),
    save,
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
      </PropertiesSection>

      <TemplateCategoriesField templateId={template.id} changes={draft.categories} onChange={(categories) => patch({ categories })} />

      <LinkedEntriesField content={draft.content} />

      <TagsField tags={draft.tags} onChange={(tags) => patch({ tags })} />

      <BlockSidebarArea />
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
