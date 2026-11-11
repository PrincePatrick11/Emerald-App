import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, FileDown, Trash2 } from 'lucide-react';
import { useTemplateStore } from '../../store/templateStore';
import { useTemplateDraftStore } from '../../store/draftStore';
import { useUIStore } from '../../store/uiStore';
import { AUX_VIEWS } from '../../lib/modules';
import { sortItems } from '../../lib/sortItems';
import { isCardView } from '../../lib/viewMode';
import { groupByMonth } from '../../lib/groupBy';
import { usePersistedFlag } from '../../hooks/usePersistedFlag';
import { templateLabel } from '../../lib/blocks/blockAttrs';
import type { Template } from '../../lib/blocks/templates';
import Dashboard from '../ui/Dashboard';
import CollapsibleGroupHeader from '../ui/CollapsibleGroupHeader';
import DashboardItem, { RowSymbol } from '../ui/DashboardItem';
import ContextMenu from '../ui/ContextMenu';
import { useOpenInNewTabAction } from '../../hooks/useOpenInNewTabAction';
import BlockGlyph from '../blocks/BlockGlyph';
import TemplateEditor from '../templates/TemplateEditor';
import TemplateAssignmentTable from '../templates/TemplateAssignmentTable';
import { useSessionState } from '../../store/sessionStore';
import { createItem } from '../../lib/createItem';
import { useLibraryItemRemove } from '../../hooks/useLibraryItemRemove';

/**
 * The rail view "Templates", built like "Blocks": the list of templates in the
 * shared dashboard scaffold, a click opens the template as a page of its own
 * (`{ type: 'templates', id }`). Below it the table of assignments per
 * combination. Deleting moves a template to the trash (with
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
    await exportErrorMessage(e, 'Emerald export');
  }
}

/**
 * The list of templates in the shared dashboard scaffold — with view and
 * sorting like the other dashboards, under a collapsible
 * heading like the assignments below.
 */
function TemplateList({ onCreate, onDelete }: {
  onCreate: () => void;
  onDelete: (template: Template) => void;
}) {
  const { t } = useTranslation();
  const templates = useTemplateStore((s) => s.templates);
  const duplicateTemplate = useTemplateStore((s) => s.duplicateTemplate);
  // The page keeps unsaved drafts in the store; here only the indication of them.
  const drafts = useTemplateDraftStore((s) => s.drafts);
  const openInNewTabAction = useOpenInNewTabAction();
  const prefs = useUIStore((s) => s.templatesPrefs);
  const setPrefs = useUIStore((s) => s.setTemplatesPrefs);
  const [collapsed, toggleCollapsed] = usePersistedFlag('templates-list-collapsed');
  const [search, setSearch] = useSessionState('templates.search', '');
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  const query = search.trim().toLowerCase();
  const filtered = query
    ? templates.filter((tpl) => templateLabel(t, tpl).toLowerCase().includes(query))
    : templates;
  const sorted = sortItems(filtered, prefs.sort, { date: (tpl) => tpl.updated_at, title: (tpl) => templateLabel(t, tpl) });

  const cards = isCardView(prefs.view);
  const renderItem = (template: Template) => {
    const unsaved = template.id in drafts && (
      <span className="text-xs italic text-subtle flex-shrink-0">{t('editor.unsaved')}</span>
    );
    return (
      <DashboardItem
        view={{ type: 'templates', id: template.id }}
        layout={cards ? 'card' : 'row'}
        onContextMenu={(e) => {
          e.preventDefault();
          setCtxMenu({ id: template.id, x: e.clientX, y: e.clientY });
        }}
      >
        {cards ? (
          <>
            <div className="flex items-center gap-2 mb-2">
              <BlockGlyph icon={template.icon} size={20} />
              <span className="flex-1" />
              {unsaved}
            </div>
            <div className="text-sm font-medium text-secondary truncate">{templateLabel(t, template)}</div>
          </>
        ) : (
          <>
            <RowSymbol><BlockGlyph icon={template.icon} size={14} /></RowSymbol>
            <span className="flex-1 min-w-0 text-sm text-soft truncate">{templateLabel(t, template)}</span>
            {unsaved}
          </>
        )}
      </DashboardItem>
    );
  };

  const menuTemplate = ctxMenu && templates.find((tpl) => tpl.id === ctxMenu.id);

  return (
    <Dashboard<Template>
      title={t('nav.templates')}
      primaryAction={{ label: t('templates.newTemplate'), onClick: onCreate }}
      view={prefs.view}
      sort={prefs.sort}
      sortDate="updated"
      onView={(view) => setPrefs({ view })}
      onSort={(sort) => setPrefs({ sort })}
      search={search}
      onSearch={setSearch}
      // Collapsed means an empty list instead of a special branch — like altar and blocks.
      items={collapsed ? [] : sorted}
      itemKey={(tpl) => tpl.id}
      renderItem={renderItem}
      grouping={
        prefs.view === 'timeline' && !collapsed
          ? { mode: 'timeline', groups: groupByMonth(sorted, (tpl) => tpl.updated_at) }
          : { mode: 'flat' }
      }
      isEmpty={!collapsed && templates.length === 0}
      emptyState={{
        icon: AUX_VIEWS.templates.icon,
        title: t('emptyState.templates.title'),
        description: t('emptyState.templates.description'),
        actionLabel: t('templates.newTemplate'),
        onAction: onCreate,
      }}
      hasNoResults={!collapsed && filtered.length === 0}
      contentHeader={
        <CollapsibleGroupHeader
          label={t('nav.templates')}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
        />
      }
      contentFooter={<TemplateAssignmentTable />}
      contextMenuSlot={ctxMenu && menuTemplate && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          actions={[
            openInNewTabAction({ type: 'templates', id: menuTemplate.id }),
            { label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: () => void duplicateTemplate(menuTemplate.id) },
            { label: t('menu.exportEmerald'), icon: <FileDown size={12} />, onClick: () => void exportTemplate(menuTemplate.id) },
            { label: t('contextMenu.delete'), icon: <Trash2 size={12} />, onClick: () => onDelete(menuTemplate), danger: true },
          ]}
        />
      )}
    />
  );
}
