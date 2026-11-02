import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { useBlockDefinitionStore } from '../../store/blockDefinitionStore';
import { copyUsage, useBlockContentRows, type CopyUsage } from '../../store/blockCopies';
import { useTemplateStore } from '../../store/templateStore';
import { allEntries, useEntryStore, whenEntryContentLoaded } from '../../store/entryStore';
import { useUIStore, type SortMode } from '../../store/uiStore';
import { useBlockDraftStore } from '../../store/draftStore';
import { useUndoStore } from '../../store/undoStore';
import { generateId } from '../../lib/helpers';
import { AUX_VIEWS } from '../../lib/modules';
import { definitionLabel } from '../../lib/blocks/blockAttrs';
import type { BlockDefinition } from '../../lib/blocks/definitions';
import { BLOCK_PRESETS } from '../../lib/blocks/presets';
import { sortItems } from '../../lib/sortItems';
import { isCardView } from '../../lib/viewMode';
import { groupByMonth } from '../../lib/groupBy';
import { usePersistedFlag } from '../../hooks/usePersistedFlag';
import Dashboard, { GroupDivider } from '../ui/Dashboard';
import DashboardItem, { RowContent, RowIcon } from '../ui/DashboardItem';
import ContextMenu from '../ui/ContextMenu';
import { useOpenInNewTabAction } from '../../hooks/useOpenInNewTabAction';
import BlockGlyph from '../blocks/BlockGlyph';
import BlockDefinitionEditor, { DeleteDefinitionModal } from '../blocks/BlockDefinitionEditor';
import { useSessionState } from '../../store/sessionStore';
import { createItem } from '../../lib/createItem';

/**
 * The rail view "Blocks", built like the other dashboards: the list of
 * custom blocks, header (title, "New block", search, view and sorting —
 * both only for the custom ones) in the right sidebar. A click opens the block as a page of its own
 * (`{ type: 'blocks', id }`) — like an entry, with saving, display and
 * usage in the sidebar. Custom blocks are inserted in every
 * entry via "Add block".
 */
export default function BlocksView() {
  const { t } = useTranslation();
  const definitions = useBlockDefinitionStore((s) => s.definitions);
  const deleteDefinition = useBlockDefinitionStore((s) => s.deleteDefinition);
  const restoreDefinition = useBlockDefinitionStore((s) => s.restoreDefinition);
  const pushUndo = useUndoStore((s) => s.push);
  const activeView = useUIStore((s) => s.activeView);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const clearDraft = useBlockDraftStore((s) => s.clearDraft);
  const rows = useBlockContentRows();
  /** Snapshot instead of id: after deleting, the dialog still shows its message. */
  const [deleting, setDeleting] = useState<BlockDefinition | null>(null);

  const templates = useTemplateStore((s) => s.templates);
  const usage = useMemo(() => copyUsage(rows, templates, definitions), [rows, templates, definitions]);
  // An id without a definition (deleted, another vault in the remembered tab) falls back to the list.
  const selected = activeView.id ? definitions.find((d) => d.id === activeView.id) ?? null : null;

  const backToList = () => setActiveView({ type: 'blocks' });

  const create = () => createItem('blocks');

  /**
   * To the trash without confirmation like everything else, with undo. Only
   * where copies sit in entries or templates does the dialog ask whether they
   * should be removed too.
   */
  const remove = async (def: BlockDefinition) => {
    // While content is still loading (startup), `usage` counts too few copies —
    // and without copies no confirmation would appear. So wait first and count afresh.
    const fresh = useEntryStore.getState().pendingContent
      ? (await whenEntryContentLoaded(), copyUsage(allEntries(useEntryStore.getState().entries), useTemplateStore.getState().templates, definitions))
      : usage;
    const used = fresh.get(def.id);
    if ((used?.entries ?? 0) + (used?.templates ?? 0) > 0) {
      setDeleting(def);
      return;
    }
    try {
      await deleteDefinition(def.id);
    } catch (err) {
      // Nothing lost: block and draft stay where they were.
      console.error('[BlocksView] deleting the block failed:', err);
      return;
    }
    clearDraft(def.id);
    // The state after deleting — see TemplatesView.remove.
    if (useUIStore.getState().activeView.id === def.id) backToList();
    pushUndo({
      id: generateId(),
      description: t('undo.blockDefinitionDeleted'),
      undo: () => restoreDefinition(def.id),
    });
  };

  const deleteModal = deleting && (
    <DeleteDefinitionModal
      definition={deleting}
      usage={usage.get(deleting.id)}
      onClose={() => setDeleting(null)}
      onDeleted={() => {
        clearDraft(deleting.id);
        setDeleting(null);
        if (activeView.id === deleting.id) backToList();
      }}
    />
  );

  // One return path for page and list: the delete dialog has to survive the
  // switch from the deleted page to the list with its state.
  return (
    <>
      {selected ? (
        <BlockDefinitionEditor
          key={selected.id}
          definition={selected}
          usage={usage.get(selected.id)}
          onClose={backToList}
          onDelete={() => void remove(selected)}
          isNew={activeView.isNew}
        />
      ) : (
        <BlockList usage={usage} onCreate={() => void create()} onDelete={(def) => void remove(def)} />
      )}
      {deleteModal}
    </>
  );
}

/**
 * The built-in blocks below the custom ones, built like the library below
 * the altars — the same list as "Add block" in the entry. For reference
 * only: nothing can be created or edited on them, hence
 * resting rows (no hover, no pointer) instead of clickable ones. The search filters them too.
 */
function BuiltInBlocksSection({ query }: { query: string }) {
  const { t } = useTranslation();
  const [collapsed, toggleCollapsed] = usePersistedFlag('blocks-builtin-collapsed');
  const presets = query
    ? BLOCK_PRESETS.filter((p) => t(p.labelKey).toLowerCase().includes(query))
    : BLOCK_PRESETS;

  return (
    <div className="mt-8">
      <GroupDivider
        label={t('blocks.library.builtIn')}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
      />
      {!collapsed && (
        <>
          {/* Deliberately the small line instead of `NoResults`: the list only
              becomes empty through the search, and the large "No results" is already above. */}
          {presets.length === 0
            ? <p className="text-xs text-subtle px-1 py-1">{t('search.noResults')}</p>
            : (
              // The same rows as the list above, without hover or pointer:
              // nothing can be created or opened on them, they only show what exists.
              <ul className="space-y-1.5">
                {presets.map((preset) => {
                  const Icon = preset.icon;
                  return (
                    <li key={preset.id} className="panel flex min-w-0 items-center gap-3 rounded-xl px-4 h-11">
                      <RowContent
                        icon={<Icon size={14} className="text-muted" />}
                        title={t(preset.labelKey)}
                        meta={preset.descriptionKey ? t(preset.descriptionKey) : undefined}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
        </>
      )}
    </div>
  );
}

/** What the custom blocks can be sorted by: last modified, name, usage. */
const BLOCK_SORTS: readonly SortMode[] = ['date_desc', 'date_asc', 'alpha_asc', 'alpha_desc', 'count_desc'];

/** The list of custom blocks in the shared dashboard scaffold. */
function BlockList({ usage, onCreate, onDelete }: {
  usage: Map<string, CopyUsage>;
  onCreate: () => void;
  onDelete: (def: BlockDefinition) => void;
}) {
  const { t } = useTranslation();
  const definitions = useBlockDefinitionStore((s) => s.definitions);
  // The page keeps unsaved drafts in the store; here only the indication of them.
  const drafts = useBlockDraftStore((s) => s.drafts);
  const openInNewTabAction = useOpenInNewTabAction();
  const [search, setSearch] = useSessionState('blocks.search', '');
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [customCollapsed, toggleCustom] = usePersistedFlag('blocks-custom-collapsed');
  const { view, sort } = useUIStore((s) => s.blocksPrefs);
  const setPrefs = useUIStore((s) => s.setBlocksPrefs);
  const cards = isCardView(view);

  const query = search.trim().toLowerCase();
  const timeline = view === 'timeline';
  const sorted = useMemo(() => sortItems(
    query ? definitions.filter((d) => definitionLabel(t, d).toLowerCase().includes(query)) : definitions,
    sort,
    {
      date: (d) => d.updated_at,
      title: (d) => definitionLabel(t, d),
      count: (d) => usage.get(d.id)?.entries ?? 0,
      tiebreak: (a, b) => definitionLabel(t, a).localeCompare(definitionLabel(t, b)),
    },
  ), [definitions, query, sort, usage, t]);
  // Collapsed means an empty list instead of a special branch, as in the altar dashboard.
  const shown = customCollapsed ? [] : sorted;

  const renderRow = (def: BlockDefinition) => {
    const u = usage.get(def.id);
    const fieldCount = def.elements.filter((e) => !e.archived).length;
    const unsaved = def.id in drafts && (
      <span className="text-xs italic text-subtle flex-shrink-0">{t('editor.unsaved')}</span>
    );
    const outdatedDot = !!(u?.outdated || u?.outdatedTemplates) && (
      <span
        className="block-library-outdated-dot"
        title={[
          u.outdated ? t('blocks.library.outdated', { count: u.outdated }) : '',
          u.outdatedTemplates ? t('blocks.library.outdatedTemplates', { count: u.outdatedTemplates }) : '',
        ].filter(Boolean).join(' · ')}
      />
    );
    const counts = (
      <span className="text-xs text-subtle tabular-nums flex-shrink-0">
        {t('blocks.library.fieldCount', { count: fieldCount })}
        {' · '}
        <span title={u?.entries ? t('blocks.library.usedIn', { count: u.entries }) : t('blocks.library.unused')}>
          {t('blocks.library.entryCount', { count: u?.entries ?? 0 })}
        </span>
      </span>
    );
    return (
      <DashboardItem
        view={{ type: 'blocks', id: def.id }}
        layout={cards ? 'card' : 'row'}
        onContextMenu={(e) => {
          e.preventDefault();
          setCtxMenu({ id: def.id, x: e.clientX, y: e.clientY });
        }}
      >
        {cards ? (
          <>
            <div className="flex items-center gap-2 mb-2">
              <BlockGlyph icon={def.icon} size={16} />
              <span className="flex-1" />
              {unsaved}
              {outdatedDot}
            </div>
            <div className="text-sm font-medium text-secondary truncate mb-1">{definitionLabel(t, def)}</div>
            {counts}
          </>
        ) : (
          <>
            <RowIcon><BlockGlyph icon={def.icon} size={14} /></RowIcon>
            <span className="flex-1 min-w-0 text-sm text-soft truncate">{definitionLabel(t, def)}</span>
            {unsaved}
            {outdatedDot}
            {counts}
          </>
        )}
      </DashboardItem>
    );
  };


  const menuDef = ctxMenu && definitions.find((d) => d.id === ctxMenu.id);

  return (
    <Dashboard<BlockDefinition>
      title={t('nav.blocks')}
      primaryAction={{ label: t('blocks.library.newBlock'), onClick: onCreate }}
      view={view}
      sort={sort}
      sortDate="updated"
      onView={(next) => setPrefs({ view: next })}
      onSort={(next) => setPrefs({ sort: next })}
      sortModes={BLOCK_SORTS}
      search={search}
      onSearch={setSearch}
      items={shown}
      itemKey={(d) => d.id}
      renderItem={renderRow}
      grouping={timeline
        ? { mode: 'timeline', groups: groupByMonth(shown, (d) => d.updated_at) }
        : { mode: 'flat' }}
      isEmpty={!customCollapsed && definitions.length === 0}
      emptyState={{
        icon: AUX_VIEWS.blocks.icon,
        title: t('emptyState.blocks.title'),
        description: t('emptyState.blocks.description'),
        actionLabel: t('blocks.library.newBlock'),
        onAction: onCreate,
      }}
      hasNoResults={!customCollapsed && sorted.length === 0}
      contentHeader={
        <GroupDivider
          label={t('blocks.library.custom')}
          collapsed={customCollapsed}
          onToggleCollapse={toggleCustom}
        />
      }
      contentFooter={<BuiltInBlocksSection query={query} />}
      contextMenuSlot={ctxMenu && menuDef && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          actions={[
            openInNewTabAction({ type: 'blocks', id: menuDef.id }),
            { label: t('contextMenu.delete'), icon: <Trash2 size={12} />, onClick: () => onDelete(menuDef), danger: true },
          ]}
        />
      )}
    />
  );
}
