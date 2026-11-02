import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { useBlockDefinitionStore } from '../../store/blockDefinitionStore';
import { useUIStore } from '../../store/uiStore';
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
import DashboardItem from '../ui/DashboardItem';
import ContextMenu from '../ui/ContextMenu';
import { useOpenInNewTabAction } from '../../hooks/useOpenInNewTabAction';
import BlockGlyph from '../blocks/BlockGlyph';
import BlockDefinitionEditor from '../blocks/BlockDefinitionEditor';
import { useSessionState } from '../../store/sessionStore';
import { createItem } from '../../lib/createItem';

/**
 * The rail view "Blocks", built like the other dashboards: the list of
 * custom blocks, header (title, "New block", search, view and sorting —
 * both only for the custom ones) in the right sidebar. A click opens the block as a page of its own
 * (`{ type: 'blocks', id }`) — like an entry, with saving and display in
 * the sidebar. Custom blocks are inserted in every
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
  // An id without a definition (deleted, another vault in the remembered tab) falls back to the list.
  const selected = activeView.id ? definitions.find((d) => d.id === activeView.id) ?? null : null;

  const backToList = () => setActiveView({ type: 'blocks' });

  const create = () => createItem('blocks');

  /** To the trash without confirmation like everything else, with undo. Inserted copies stay. */
  const remove = async (def: BlockDefinition) => {
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

  return selected ? (
    <BlockDefinitionEditor
      key={selected.id}
      definition={selected}
      onClose={backToList}
      onDelete={() => void remove(selected)}
      isNew={activeView.isNew}
    />
  ) : (
    <BlockList onCreate={() => void create()} onDelete={(def) => void remove(def)} />
  );
}

/**
 * The built-in blocks below the custom ones, built like the library below
 * the altars — the same list as "Add block" in the entry. For reference
 * only: nothing can be created or edited on them, hence
 * resting tiles (frame, three columns, no hover) instead of clickable
 * dashboard rows. The search filters them too.
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
              // Tiles with a frame, but without hover and pointer: nothing can
              // be created or opened on them, they only show what exists.
              <ul className="grid grid-cols-3 gap-2">
                {presets.map((preset) => {
                  const Icon = preset.icon;
                  return (
                    <li
                      key={preset.id}
                      title={preset.descriptionKey ? t(preset.descriptionKey) : undefined}
                      className="panel flex min-w-0 items-center gap-3 rounded-lg px-3 py-2.5"
                    >
                      <Icon size={16} className="flex-shrink-0 text-muted" />
                      <span className="truncate text-sm text-secondary">{t(preset.labelKey)}</span>
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

/** The list of custom blocks in the shared dashboard scaffold. */
function BlockList({ onCreate, onDelete }: {
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
      tiebreak: (a, b) => definitionLabel(t, a).localeCompare(definitionLabel(t, b)),
    },
  ), [definitions, query, sort, t]);
  // Collapsed means an empty list instead of a special branch, as in the altar dashboard.
  const shown = customCollapsed ? [] : sorted;

  const renderRow = (def: BlockDefinition) => {
    const unsaved = def.id in drafts && (
      <span className="text-xs italic text-subtle flex-shrink-0">{t('editor.unsaved')}</span>
    );
    const counts = (
      <span className="text-xs text-subtle tabular-nums flex-shrink-0">
        {t('blocks.library.fieldCount', { count: def.elements.length })}
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
            </div>
            <div className="text-sm font-medium text-secondary truncate mb-1">{definitionLabel(t, def)}</div>
            {counts}
          </>
        ) : (
          <>
            <BlockGlyph icon={def.icon} size={14} />
            <span className="flex-1 min-w-0 text-sm text-soft truncate">{definitionLabel(t, def)}</span>
            {unsaved}
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
