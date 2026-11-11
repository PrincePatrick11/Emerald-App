import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { useBlockDefinitionStore } from '../../store/blockDefinitionStore';
import { useUIStore } from '../../store/uiStore';
import { useBlockDraftStore } from '../../store/draftStore';
import { AUX_VIEWS } from '../../lib/modules';
import { definitionLabel } from '../../lib/blocks/blockAttrs';
import type { BlockDefinition } from '../../lib/blocks/definitions';
import { BLOCK_PRESETS } from '../../lib/blocks/presets';
import { sortItems } from '../../lib/sortItems';
import { isCardView } from '../../lib/viewMode';
import { groupByMonth } from '../../lib/groupBy';
import { usePersistedFlag } from '../../hooks/usePersistedFlag';
import Dashboard from '../ui/Dashboard';
import CollapsibleGroupHeader from '../ui/CollapsibleGroupHeader';
import DashboardItem, { ROW_GEOMETRY_CLASS, RowContent, RowSymbol } from '../ui/DashboardItem';
import ContextMenu from '../ui/ContextMenu';
import { useOpenInNewTabAction } from '../../hooks/useOpenInNewTabAction';
import BlockGlyph from '../blocks/BlockGlyph';
import BlockDefinitionEditor from '../blocks/BlockDefinitionEditor';
import { useSessionState } from '../../store/sessionStore';
import { createItem } from '../../lib/createItem';
import { useLibraryItemRemove } from '../../hooks/useLibraryItemRemove';
import DashboardSection from '../ui/DashboardSection';

/**
 * The rail view "Blocks", built like the other dashboards: the list of
 * custom blocks, header (title, "New block", search, view and sorting —
 * both only for the custom ones) in the right sidebar. A click opens the block as a page of its own
 * (`{ type: 'blocks', id }`) — like an entry, with saving and display in
 * the sidebar. Custom blocks are inserted in every
 * entry via "Add block".
 */
export default function BlocksView() {
  const definitions = useBlockDefinitionStore((s) => s.definitions);
  const deleteDefinition = useBlockDefinitionStore((s) => s.deleteDefinition);
  const restoreDefinition = useBlockDefinitionStore((s) => s.restoreDefinition);
  const activeView = useUIStore((s) => s.activeView);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const clearDraft = useBlockDraftStore((s) => s.clearDraft);
  // An id without a definition (deleted, another vault in the remembered tab) falls back to the list.
  const selected = activeView.id ? definitions.find((d) => d.id === activeView.id) ?? null : null;

  const backToList = () => setActiveView({ type: 'blocks' });

  const create = () => createItem('blocks');

  // Inserted copies stay.
  const remove = useLibraryItemRemove({
    viewType: 'blocks', remove: deleteDefinition, restore: restoreDefinition, clearDraft, undoKey: 'undo.blockDefinitionDeleted', logTag: 'BlocksView',
  });

  return selected ? (
    <BlockDefinitionEditor
      key={selected.id}
      definition={selected}
      onClose={backToList}
      onDelete={() => void remove(selected.id)}
      isNew={activeView.isNew}
    />
  ) : (
    <BlockList onCreate={() => void create()} onDelete={(def) => void remove(def.id)} />
  );
}

/**
 * The built-in blocks below the custom ones — the same list as "Add block" in the entry. For reference
 * only: nothing can be created or edited on them, hence
 * resting rows (no hover, no pointer) instead of clickable ones. The search filters them too.
 */
function BuiltInBlocksSection({ query }: { query: string }) {
  const { t } = useTranslation();
  const presets = query
    ? BLOCK_PRESETS.filter((p) => t(p.labelKey).toLowerCase().includes(query))
    : BLOCK_PRESETS;

  return (
    <DashboardSection storageKey="blocks-builtin-collapsed" label={t('blocks.library.builtIn')}>
          {/* Deliberately the small line instead of `NoResults`: the list only
              becomes empty through the search, and the large "No results" is already above. */}
          {presets.length === 0
            ? <p className="text-xs text-subtle px-1 py-1">{t('search.noResults')}</p>
            : (
              <ul className="space-y-1.5">
                {presets.map((preset) => {
                  const Icon = preset.icon;
                  return (
                    <li
                      key={preset.id}
                      // The description is cut off in the row; here it can be read in full.
                      title={preset.descriptionKey ? t(preset.descriptionKey) : undefined}
                      className={`panel rounded-xl ${ROW_GEOMETRY_CLASS}`}
                    >
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
    </DashboardSection>
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
  // Collapsed means an empty list instead of a special branch, as in templates and the lexicon.
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
            <RowSymbol><BlockGlyph icon={def.icon} size={14} /></RowSymbol>
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
        <CollapsibleGroupHeader
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
