import { useTranslation } from 'react-i18next';
import { Copy, FileDown, Trash2 } from 'lucide-react';
import { useTemplateStore } from '../../store/templateStore';
import { useTemplateDraftStore } from '../../store/draftStore';
import { useUIStore } from '../../store/uiStore';
import { AUX_VIEWS } from '../../lib/modules';
import { usePersistedFlag } from '../../hooks/usePersistedFlag';
import { templateLabel } from '../../lib/blocks/blockAttrs';
import type { Template } from '../../lib/blocks/templates';
import CollapsibleGroupHeader from '../ui/CollapsibleGroupHeader';
import CollectionDashboard, { useCollectionState } from './CollectionDashboard';
import { useTagStore } from '../../store/tagStore';
import { useOpenInNewTabAction } from '../../hooks/useOpenInNewTabAction';
import BlockGlyph from '../blocks/BlockGlyph';
import TemplateEditor from '../templates/TemplateEditor';
import DefaultTemplateSection from '../templates/DefaultTemplateSection';
import { createItem } from '../../lib/createItem';
import { useLibraryItemRemove } from '../../hooks/useLibraryItemRemove';

/**
 * The rail view "Templates", built like "Blocks": the list of templates in the
 * shared dashboard scaffold, a click opens the template as a page of its own
 * (`{ type: 'templates', id }`). Below it the vault's default template
 * (`DefaultTemplateSection`). Deleting moves a template to the trash (with
 * undo) — entries created from it stay as they are.
 */
export default function TemplatesView() {
  const templates = useTemplateStore((s) => s.templates);
  const deleteTemplate = useTemplateStore((s) => s.deleteTemplate);
  const restoreTemplate = useTemplateStore((s) => s.restoreTemplate);
  const activeView = useUIStore((s) => s.activeView);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const clearDraft = useTemplateDraftStore((s) => s.clearDraft);

  // An id without a template (deleted, another vault in the remembered tab) falls back to the list.
  const selected = activeView.id ? templates.find((tpl) => tpl.id === activeView.id) ?? null : null;

  const backToList = () => setActiveView({ type: 'templates' });

  const create = () => createItem('templates');

  const remove = useLibraryItemRemove({
    viewType: 'templates', remove: deleteTemplate, restore: restoreTemplate, clearDraft, undoKey: 'undo.templateDeleted', logTag: 'TemplatesView',
  });

  return selected ? (
    <TemplateEditor
      key={selected.id}
      template={selected}
      onClose={backToList}
      onDelete={() => void remove(selected.id)}
      isNew={activeView.isNew}
    />
  ) : (
    <TemplateList onCreate={() => void create()} onDelete={(tpl) => void remove(tpl.id)} />
  );
}

/** `.emerald` export of a template — the format module is large and only loaded here, as in the menu. */
async function exportTemplate(id: string): Promise<void> {
  const { exportErrorMessage } = await import('../../lib/export');
  try {
    const { exportTemplateAsEmerald } = await import('../../lib/emeraldFormat');
    await exportTemplateAsEmerald(id);
  } catch (e) {
    await exportErrorMessage(e, 'emerald');
  }
}

/**
 * The list of templates as a collection — view, sorting and a tag filter like
 * every collection, under a collapsible heading like the default template below.
 */
function TemplateList({ onCreate, onDelete }: {
  onCreate: () => void;
  onDelete: (template: Template) => void;
}) {
  const { t } = useTranslation();
  const templates = useTemplateStore((s) => s.templates);
  const duplicateTemplate = useTemplateStore((s) => s.duplicateTemplate);
  const tags = useTagStore((s) => s.tags);
  // The page keeps unsaved drafts in the store; here only the indication of them.
  const drafts = useTemplateDraftStore((s) => s.drafts);
  const openInNewTabAction = useOpenInNewTabAction();
  const state = useCollectionState('templates');
  const [collapsed, toggleCollapsed] = usePersistedFlag('templates-list-collapsed');

  const usedTags = tags.filter((tag) => templates.some((tpl) => tpl.tags.includes(tag.id)));

  return (
    <CollectionDashboard<Template>
      state={state}
      title={t('nav.templates')}
      primaryAction={{ label: t('templates.newTemplate'), onClick: onCreate }}
      items={templates}
      itemKey={(tpl) => tpl.id}
      itemTitle={(tpl) => templateLabel(t, tpl)}
      itemDate={(tpl) => tpl.updated_at}
      filter={{
        label: t('nav.tags'),
        chips: usedTags.map((tag) => ({ value: tag.id, label: tag.name, test: (tpl) => tpl.tags.includes(tag.id) })),
      }}
      describe={(tpl) => ({
        icon: <BlockGlyph icon={tpl.icon} size={14} />,
        cardIcon: <BlockGlyph icon={tpl.icon} size={20} />,
        title: templateLabel(t, tpl),
        trailing: tpl.id in drafts && <span className="text-xs italic text-subtle flex-shrink-0">{t('editor.unsaved')}</span>,
        view: { type: 'templates', id: tpl.id },
      })}
      contextActions={(tpl) => [
        openInNewTabAction({ type: 'templates', id: tpl.id }),
        { label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: () => void duplicateTemplate(tpl.id) },
        { label: t('menu.exportEmerald'), icon: <FileDown size={12} />, onClick: () => void exportTemplate(tpl.id) },
        { label: t('contextMenu.delete'), icon: <Trash2 size={12} />, onClick: () => onDelete(tpl), danger: true },
      ]}
      emptyState={{
        icon: AUX_VIEWS.templates.icon,
        title: t('emptyState.templates.title'),
        description: t('emptyState.templates.description'),
        actionLabel: t('templates.newTemplate'),
        onAction: onCreate,
      }}
      // Collapsed means an empty list instead of a special branch — like blocks and the lexicon.
      collapsed={collapsed}
      contentHeader={
        <CollapsibleGroupHeader
          label={t('nav.templates')}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
        />
      }
      contentFooter={<DefaultTemplateSection />}
    />
  );
}
