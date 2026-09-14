import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, FileDown, Star, Trash2 } from 'lucide-react';
import { useTemplateStore } from '../../store/templateStore';
import { useTemplateDraftStore } from '../../store/draftStore';
import { templateEntries, useBlockContentRows, type EntryContentRow } from '../../store/blockCopies';
import { useUIStore } from '../../store/uiStore';
import { useUndoStore } from '../../store/undoStore';
import { AUX_VIEWS } from '../../lib/modules';
import { generateId } from '../../lib/helpers';
import { templateLabel } from '../../lib/blocks/blockAttrs';
import type { Template } from '../../lib/blocks/templates';
import Dashboard from '../ui/Dashboard';
import DashboardItem from '../ui/DashboardItem';
import ContextMenu from '../ui/ContextMenu';
import { useOpenInNewTabAction } from '../../hooks/useOpenInNewTabAction';
import BlockGlyph from '../blocks/BlockGlyph';
import TemplateEditor from '../templates/TemplateEditor';
import { useAssignmentLabel } from '../templates/useAssignmentLabel';
import TemplateDefaultsOverview from '../templates/TemplateDefaultsOverview';

/**
 * Die Rail-Ansicht „Vorlagen", gebaut wie „Blöcke": die Liste der Vorlagen im
 * gemeinsamen Dashboard-Gerüst, ein Klick öffnet die Vorlage als eigene Seite
 * (`{ type: 'templates', id }`). Darunter die Gesamtübersicht der Standards
 * je Kombination. Löschen legt eine Vorlage in den Papierkorb (mit
 * Rückgängig) — Einträge aus ihr bleiben, wie sie sind.
 */
export default function TemplatesView() {
  const { t } = useTranslation();
  const templates = useTemplateStore((s) => s.templates);
  const createTemplate = useTemplateStore((s) => s.createTemplate);
  const deleteTemplate = useTemplateStore((s) => s.deleteTemplate);
  const restoreTemplate = useTemplateStore((s) => s.restoreTemplate);
  const activeView = useUIStore((s) => s.activeView);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const clearDraft = useTemplateDraftStore((s) => s.clearDraft);
  const pushUndo = useUndoStore((s) => s.push);
  const rows = useBlockContentRows();
  const entries = useMemo(() => templateEntries(rows), [rows]);

  // Eine id ohne Vorlage (gelöscht, anderer Vault im gemerkten Tab) fällt auf die Liste zurück.
  const selected = activeView.id ? templates.find((tpl) => tpl.id === activeView.id) ?? null : null;

  const open = (id: string) => setActiveView({ type: 'templates', id });
  const backToList = () => setActiveView({ type: 'templates' });

  const create = async () => {
    const template = await createTemplate(t('templates.defaultName'));
    open(template.id);
  };

  const remove = async (template: Template) => {
    try {
      await deleteTemplate(template.id);
    } catch (err) {
      // Nichts verloren: Vorlage und Entwurf bleiben, wo sie waren.
      console.error('[TemplatesView] deleting the template failed:', err);
      return;
    }
    clearDraft(template.id);
    if (activeView.id === template.id) backToList();
    pushUndo({
      id: generateId(),
      description: t('undo.templateDeleted'),
      undo: () => restoreTemplate(template.id),
    });
  };

  return selected ? (
    <TemplateEditor
      key={selected.id}
      template={selected}
      entries={entries.get(selected.id) ?? []}
      onClose={backToList}
      onDelete={() => void remove(selected)}
    />
  ) : (
    <TemplateList entries={entries} onCreate={() => void create()} onDelete={(tpl) => void remove(tpl)} />
  );
}

/** `.emerald`-Export einer Vorlage — das Format-Modul ist groß und wird erst hier geladen, wie im Menü. */
async function exportTemplate(id: string): Promise<void> {
  const { exportErrorMessage } = await import('../../lib/export');
  try {
    const { exportTemplateAsEmerald } = await import('../../lib/emeraldFormat');
    await exportTemplateAsEmerald(id);
  } catch (e) {
    await exportErrorMessage(e, 'Emerald export');
  }
}

/** Die Liste der Vorlagen im gemeinsamen Dashboard-Gerüst. */
function TemplateList({ entries, onCreate, onDelete }: {
  entries: Map<string, EntryContentRow[]>;
  onCreate: () => void;
  onDelete: (template: Template) => void;
}) {
  const { t } = useTranslation();
  const templates = useTemplateStore((s) => s.templates);
  const duplicateTemplate = useTemplateStore((s) => s.duplicateTemplate);
  // Die Seite legt ungespeicherte Entwürfe im Store ab; hier nur der Hinweis darauf.
  const drafts = useTemplateDraftStore((s) => s.drafts);
  const openInNewTabAction = useOpenInNewTabAction();
  const assignmentLabel = useAssignmentLabel();
  const [search, setSearch] = useState('');
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  const query = search.trim().toLowerCase();
  const filtered = query
    ? templates.filter((tpl) => `${templateLabel(t, tpl)} ${tpl.description}`.toLowerCase().includes(query))
    : templates;

  const renderRow = (template: Template) => {
    const count = entries.get(template.id)?.length ?? 0;
    const assigned = template.assignments.map((a) => assignmentLabel(a.entryType, a.category));
    const defaults = template.assignments.filter((a) => a.isDefault).map((a) => assignmentLabel(a.entryType, a.category));
    return (
      <DashboardItem
        view={{ type: 'templates', id: template.id }}
        layout="row"
        onContextMenu={(e) => {
          e.preventDefault();
          setCtxMenu({ id: template.id, x: e.clientX, y: e.clientY });
        }}
      >
        <BlockGlyph icon={template.icon} size={14} />
        <span className="flex-1 min-w-0">
          <span className="block text-sm text-stone-300 truncate">{templateLabel(t, template)}</span>
          <span className="block text-xs text-stone-500 truncate">
            {template.description || (assigned.length ? assigned.join(' · ') : t('templates.noAssignments'))}
          </span>
        </span>
        {template.id in drafts && (
          <span className="text-xs italic text-stone-500 flex-shrink-0">{t('editor.unsaved')}</span>
        )}
        {defaults.length > 0 && (
          <span className="template-default-star" title={t('templates.defaultFor', { list: defaults.join(', ') })}>
            <Star size={12} fill="currentColor" />
          </span>
        )}
        <span className="text-xs text-stone-500 tabular-nums flex-shrink-0">
          {t('templates.entryCount', { count })}
        </span>
      </DashboardItem>
    );
  };

  const menuTemplate = ctxMenu && templates.find((tpl) => tpl.id === ctxMenu.id);

  return (
    <Dashboard<Template>
      title={t('nav.templates')}
      titleIcon={AUX_VIEWS.templates.icon}
      titleCount={templates.length}
      primaryAction={{ label: t('templates.newTemplate'), onClick: onCreate }}
      search={search}
      onSearch={setSearch}
      items={filtered}
      itemKey={(tpl) => tpl.id}
      renderItem={renderRow}
      grouping={{ mode: 'flat' }}
      isEmpty={templates.length === 0}
      emptyState={{
        message: t('templates.emptyHint'),
        messageClassName: 'text-stone-600 text-sm max-w-md mx-auto',
        actionLabel: t('templates.newTemplate'),
        onAction: onCreate,
      }}
      hasNoResults={filtered.length === 0}
      noResultsMessage={t('search.noResults')}
      contentFooter={<TemplateDefaultsOverview />}
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
