import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import LibraryPageFrame from '../ui/LibraryPageFrame';
import PropertiesEditView from '../sidebar/fields/PropertiesEditView';
import LinkedEntriesField from '../sidebar/fields/LinkedEntriesField';
import TagsField from '../sidebar/fields/TagsField';
import Favicon from '../sidebar/fields/Favicon';
import BlockStack from '../blocks/BlockStack';
import BlockSidebarArea from '../blocks/BlockSidebarArea';
import TemplateAssignments from './TemplateAssignments';
import TemplateUsage from './TemplateUsage';
import { useTemplateStore } from '../../store/templateStore';
import { useTemplateDraftStore, type TemplateDraft } from '../../store/draftStore';
import type { EntryContentRow } from '../../store/blockCopies';
import { useDraftPage } from '../../hooks/useDraftPage';
import { useShrunkIcon } from '../../hooks/useShrunkIcon';
import { OP_PROP_SELECT_CLASSES } from '../../lib/styleClasses';
import { DEFAULT_TEMPLATE_ICON, type Template } from '../../lib/blocks/templates';

const draftOf = (d: TemplateDraft): TemplateDraft => ({
  name: d.name, icon: d.icon, description: d.description, title: d.title,
  content: d.content, tags: d.tags, assignments: d.assignments,
});

interface Props {
  template: Template;
  entries: readonly EntryContentRow[];
  /** Zurück zur Liste. Die Brotkrume lässt den Entwurf liegen; „Fertig" und „Abbrechen" erledigen ihn vorher. */
  onClose: () => void;
  onDelete: () => void;
}

/**
 * Die Seite einer Vorlage (`LibraryPageFrame`, wie ein eigener Block): Name
 * als Titel, Beschreibung, der Titel neuer Einträge und der Blockstapel —
 * derselbe Editor wie im Eintrag, immer im Bearbeiten. In der Seitenleiste
 * Icon, Tags, verlinkte Einträge, Zuweisungen mit Stern, die Block-Verwaltung
 * und die Einträge, die aus der Vorlage entstanden sind.
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
    save: updateTemplate,
    onClose,
    logTag: 'TemplateEditor',
  });
  // Nur der Anfangswert: der Stapel ist danach unkontrolliert (siehe BlockStack).
  const [initialContent] = useState(draft.content);
  const setIcon = useShrunkIcon((icon) => patch({ icon }), 'TemplateEditor');

  const sidebar = (
    <PropertiesEditView>
      <div>
        <p className="label-xs mb-2">{t('properties.icon')}</p>
        <Favicon
          value={draft.icon}
          onChange={(icon) => void setIcon(icon)}
          onRemove={() => void setIcon(DEFAULT_TEMPLATE_ICON)}
        />
      </div>

      <TagsField tags={draft.tags} onChange={(tags) => patch({ tags })} />

      <div>
        <p className="label-xs mb-2">🔗 {t('properties.linkedEntries')}</p>
        <LinkedEntriesField content={draft.content} editable inputCls={OP_PROP_SELECT_CLASSES} />
      </div>

      <TemplateAssignments
        templateId={template.id}
        assignments={draft.assignments}
        onChange={(assignments) => patch({ assignments })}
      />

      <BlockSidebarArea />

      <TemplateUsage entries={entries} />
    </PropertiesEditView>
  );

  return (
    <LibraryPageFrame
      backLabel={t('nav.templates')}
      onBack={onClose}
      icon={draft.icon}
      dirty={dirty}
      busy={busy}
      onDone={() => void finish()}
      onCancel={leave}
      onDelete={onDelete}
      name={draft.name}
      nameLabel={t('templates.name')}
      namePlaceholder={t('templates.namePlaceholder')}
      onNameChange={(name) => patch({ name })}
      sidebar={sidebar}
    >
      <div className="max-w-3xl space-y-6 mb-6">
        <textarea
          className={`${OP_PROP_SELECT_CLASSES} resize-none selectable`}
          rows={2}
          value={draft.description}
          placeholder={t('templates.descriptionPlaceholder')}
          aria-label={t('templates.description')}
          onChange={(e) => patch({ description: e.target.value })}
        />
        <div>
          <p className="label-xs mb-2">{t('templates.entryTitle')}</p>
          <input
            className={`${OP_PROP_SELECT_CLASSES} selectable`}
            value={draft.title}
            placeholder={t('templates.entryTitlePlaceholder')}
            aria-label={t('templates.entryTitle')}
            onChange={(e) => patch({ title: e.target.value })}
          />
        </div>
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
