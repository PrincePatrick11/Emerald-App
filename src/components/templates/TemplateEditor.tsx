import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import LibraryPageFrame from '../ui/LibraryPageFrame';
import { Smile } from 'lucide-react';
import LinkedEntriesField from '../sidebar/fields/LinkedEntriesField';
import TagsField from '../sidebar/fields/TagsField';
import { PropertiesSection } from '../sidebar/fields/EntryReadSections';
import { EditSidebarBody, MediaPropertyRow } from '../sidebar/fields/EditProperties';
import BlockStack from '../blocks/BlockStack';
import BlockSidebarArea from '../blocks/BlockSidebarArea';
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
  /** Zurück zur Liste. Der Zurück-Link über dem Titel lässt den Entwurf liegen; „Fertig" und „Abbrechen" erledigen ihn vorher. */
  onClose: () => void;
  onDelete: () => void;
}

/**
 * Die Seite einer Vorlage (`LibraryPageFrame`, wie ein eigener Block): Name
 * als Titel, der Titel neuer Einträge und der Blockstapel —
 * derselbe Editor wie im Eintrag, immer im Bearbeiten. In der Seitenleiste
 * Icon, verlinkte Einträge, Tags, Zuweisung und Standard (festgelegt im
 * Dialog), die Block-Verwaltung und die Einträge, die aus der Vorlage
 * entstanden sind.
 *
 * Bearbeitet wird ein Entwurf (`useDraftPage`); erst „Fertig" speichert die
 * geänderten Felder — und setzt dabei gewählte Sterne, die anderen Vorlagen
 * dann fehlen. Einträge ändern sich nie: sie tragen Kopien.
 */
export default function TemplateEditor({ template, entries, onClose, onDelete }: Props) {
  const { t } = useTranslation();
  const updateTemplate = useTemplateStore((s) => s.updateTemplate);
  const { draft, patch, dirty, busy, finish, leave } = useDraftPage({
    store: useTemplateDraftStore,
    id: template.id,
    saved: draftOf(template),
    // Zuweisungen als Änderung auf den aktuellen Stand — eine andere Vorlage kann inzwischen Sterne genommen haben.
    save: (id, patch, base) => updateTemplate(id, patch.assignments
      ? { ...patch, assignments: mergeAssignmentChanges(base.assignments, patch.assignments, useTemplateStore.getState().templates.find((t) => t.id === id)?.assignments ?? []) }
      : patch),
    onClose,
    logTag: 'TemplateEditor',
  });
  // Nur der Anfangswert: der Stapel ist danach unkontrolliert (siehe BlockStack).
  const [initialContent] = useState(draft.content);
  const setIcon = useShrunkIcon((icon) => patch({ icon }), 'TemplateEditor');

  const sidebar = (
    <EditSidebarBody>
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

      <LinkedEntriesField content={draft.content} />

      <TagsField tags={draft.tags} onChange={(tags) => patch({ tags })} />

      <TemplateAssignments
        templateId={template.id}
        name={templateLabel(t, draft)}
        assignments={draft.assignments}
        onChange={(assignments) => patch({ assignments })}
      />

      <BlockSidebarArea />

      <TemplateUsage entries={entries} />
    </EditSidebarBody>
  );

  return (
    <LibraryPageFrame
      backLabel={t('nav.templates')}
      onBack={onClose}
      draft={{ dirty, busy, onDone: () => void finish(), onCancel: leave, onDelete }}
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
