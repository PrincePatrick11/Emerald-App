import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { useBlockDefinitionStore } from '../../store/blockDefinitionStore';
import { useUIStore } from '../../store/uiStore';
import { useBlockDraftStore } from '../../store/draftStore';
import { AUX_VIEWS } from '../../lib/modules';
import { definitionLabel } from '../../lib/blocks/blockAttrs';
import type { BlockDefinition } from '../../lib/blocks/definitions';
import { BLOCK_PRESETS } from '../../lib/blocks/presets';
import { usePersistedFlag } from '../../hooks/usePersistedFlag';
import CollapsibleGroupHeader from '../ui/CollapsibleGroupHeader';
import { ROW_GEOMETRY_CLASS, RowContent } from '../ui/DashboardItem';
import { useOpenInNewTabAction } from '../../hooks/useOpenInNewTabAction';
import BlockGlyph from '../blocks/BlockGlyph';
import BlockDefinitionEditor from '../blocks/BlockDefinitionEditor';
import { createItem } from '../../lib/createItem';
import { useLibraryItemRemove } from '../../hooks/useLibraryItemRemove';
import DashboardSection from '../ui/DashboardSection';
import CollectionDashboard, { useCollectionState } from './CollectionDashboard';

/**
 * The rail view "Blocks", a collection like the others: the list of custom
 * blocks, header (title, "New block", search, view and sorting — both only
 * for the custom ones) in the right sidebar. A click opens the block as a page of its own
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

/** The custom blocks as a collection; the built-in ones follow below. */
function BlockList({ onCreate, onDelete }: {
  onCreate: () => void;
  onDelete: (def: BlockDefinition) => void;
}) {
  const { t } = useTranslation();
  const definitions = useBlockDefinitionStore((s) => s.definitions);
  // The page keeps unsaved drafts in the store; here only the indication of them.
  const drafts = useBlockDraftStore((s) => s.drafts);
  const openInNewTabAction = useOpenInNewTabAction();
  const state = useCollectionState('blocks');
  const [customCollapsed, toggleCustom] = usePersistedFlag('blocks-custom-collapsed');

  return (
    <CollectionDashboard<BlockDefinition>
      state={state}
      title={t('nav.blocks')}
      primaryAction={{ label: t('blocks.library.newBlock'), onClick: onCreate }}
      items={definitions}
      itemKey={(d) => d.id}
      itemTitle={(d) => definitionLabel(t, d)}
      itemDate={(d) => d.updated_at}
      describe={(def) => ({
        icon: <BlockGlyph icon={def.icon} size={14} />,
        cardIcon: <BlockGlyph icon={def.icon} size={16} />,
        title: definitionLabel(t, def),
        meta: (
          <span className="tabular-nums">
            {def.id in drafts && <span className="italic">{t('editor.unsaved')} · </span>}
            {t('blocks.library.fieldCount', { count: def.elements.length })}
          </span>
        ),
        view: { type: 'blocks', id: def.id },
      })}
      contextActions={(def) => [
        openInNewTabAction({ type: 'blocks', id: def.id }),
        { label: t('contextMenu.delete'), icon: <Trash2 size={12} />, onClick: () => onDelete(def), danger: true },
      ]}
      emptyState={{
        icon: AUX_VIEWS.blocks.icon,
        title: t('emptyState.blocks.title'),
        description: t('emptyState.blocks.description'),
        actionLabel: t('blocks.library.newBlock'),
        onAction: onCreate,
      }}
      // Collapsed means an empty list instead of a special branch, as in templates and the lexicon.
      collapsed={customCollapsed}
      contentHeader={
        <CollapsibleGroupHeader
          label={t('blocks.library.custom')}
          collapsed={customCollapsed}
          onToggleCollapse={toggleCustom}
        />
      }
      contentFooter={<BuiltInBlocksSection query={state.query} />}
    />
  );
}
