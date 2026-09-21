import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { useBlockDefinitionStore } from '../../store/blockDefinitionStore';
import { copyUsage, useBlockContentRows, type CopyUsage } from '../../store/blockCopies';
import { useTemplateStore } from '../../store/templateStore';
import { useUIStore, type SortMode } from '../../store/uiStore';
import { useBlockDraftStore } from '../../store/draftStore';
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
import BlockDefinitionEditor, { DeleteDefinitionModal } from '../blocks/BlockDefinitionEditor';

/**
 * Die Rail-Ansicht „Blöcke", gebaut wie die übrigen Dashboards: die Liste der
 * eigenen Blöcke, Kopf (Titel, „Neuer Block", Suche, Ansicht und Sortierung —
 * beide nur für die eigenen) in der rechten Seitenleiste. Ein Klick öffnet den Block als eigene Seite
 * (`{ type: 'blocks', id }`) — wie ein Eintrag, mit Speichern, Anzeige und
 * Verwendung in der Seitenleiste. Eingefügt werden eigene Blöcke in jedem
 * Eintrag über „Block hinzufügen".
 */
export default function BlocksView() {
  const { t } = useTranslation();
  const definitions = useBlockDefinitionStore((s) => s.definitions);
  const createDefinition = useBlockDefinitionStore((s) => s.createDefinition);
  const activeView = useUIStore((s) => s.activeView);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const clearDraft = useBlockDraftStore((s) => s.clearDraft);
  const rows = useBlockContentRows();
  /** Schnappschuss statt id: der Dialog zeigt nach dem Löschen noch seine Meldung. */
  const [deleting, setDeleting] = useState<BlockDefinition | null>(null);

  const templates = useTemplateStore((s) => s.templates);
  const usage = useMemo(() => copyUsage(rows, templates, definitions), [rows, templates, definitions]);
  // Eine id ohne Definition (gelöscht, anderer Vault im gemerkten Tab) fällt auf die Liste zurück.
  const selected = activeView.id ? definitions.find((d) => d.id === activeView.id) ?? null : null;

  const open = (id: string) => setActiveView({ type: 'blocks', id });
  const backToList = () => setActiveView({ type: 'blocks' });

  const create = async () => {
    const def = await createDefinition(t('blocks.library.defaultName'));
    open(def.id);
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

  // Ein Rückgabepfad für Seite und Liste: der Löschdialog muss den Wechsel
  // von der gelöschten Seite zur Liste mit seinem Zustand überleben.
  return (
    <>
      {selected ? (
        <BlockDefinitionEditor
          key={selected.id}
          definition={selected}
          usage={usage.get(selected.id)}
          onClose={backToList}
          onDelete={() => setDeleting(selected)}
        />
      ) : (
        <BlockList usage={usage} onCreate={() => void create()} onDelete={setDeleting} />
      )}
      {deleteModal}
    </>
  );
}

/**
 * Die eingebauten Blöcke unter den eigenen, gebaut wie die Bibliothek unter
 * den Altären — dieselbe Liste wie „Block hinzufügen" im Eintrag. Nur zum
 * Nachschlagen: anlegen oder bearbeiten lässt sich an ihnen nichts, darum
 * schlichte Kacheln statt klickbarer Dashboard-Zeilen. Die Suche filtert mit.
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
        count={presets.length}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
      />
      {!collapsed && (
        <>
          {presets.length === 0
            ? <p className="text-xs text-stone-700 px-1 py-1">{t('search.noResults')}</p>
            : (
              // Bewusst ohne Rahmen und Hover: nichts daran sieht klickbar aus.
              <ul className="grid [grid-template-columns:repeat(auto-fill,minmax(11rem,1fr))] gap-x-4">
                {presets.map((preset) => {
                  const Icon = preset.icon;
                  return (
                    <li
                      key={preset.id}
                      title={preset.descriptionKey ? t(preset.descriptionKey) : undefined}
                      className="flex items-center gap-2 px-1 py-1.5 min-w-0 text-stone-400"
                    >
                      <Icon size={14} className="flex-shrink-0 text-stone-500" />
                      <span className="text-sm truncate">{t(preset.labelKey)}</span>
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

/** Wonach sich die eigenen Blöcke sortieren lassen: zuletzt geändert, Name, Verwendung. */
const BLOCK_SORTS: readonly SortMode[] = ['date_desc', 'date_asc', 'alpha_asc', 'alpha_desc', 'count_desc'];

/** Die Liste der eigenen Blöcke im gemeinsamen Dashboard-Gerüst. */
function BlockList({ usage, onCreate, onDelete }: {
  usage: Map<string, CopyUsage>;
  onCreate: () => void;
  onDelete: (def: BlockDefinition) => void;
}) {
  const { t } = useTranslation();
  const definitions = useBlockDefinitionStore((s) => s.definitions);
  // Die Seite legt ungespeicherte Entwürfe im Store ab; hier nur der Hinweis darauf.
  const drafts = useBlockDraftStore((s) => s.drafts);
  const openInNewTabAction = useOpenInNewTabAction();
  const [search, setSearch] = useState('');
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
  // Zugeklappt eine leere Liste statt eines Sonderzweigs, wie im Altar-Dashboard.
  const shown = customCollapsed ? [] : sorted;

  const renderRow = (def: BlockDefinition) => {
    const u = usage.get(def.id);
    const fieldCount = def.elements.filter((e) => !e.archived).length;
    const unsaved = def.id in drafts && (
      <span className="text-xs italic text-stone-500 flex-shrink-0">{t('editor.unsaved')}</span>
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
      <span className="text-xs text-stone-500 tabular-nums flex-shrink-0">
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
            <div className="text-sm font-medium text-stone-200 truncate mb-1">{definitionLabel(t, def)}</div>
            {counts}
          </>
        ) : (
          <>
            <BlockGlyph icon={def.icon} size={14} />
            <span className="flex-1 min-w-0 text-sm text-stone-300 truncate">{definitionLabel(t, def)}</span>
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
      titleIcon={AUX_VIEWS.blocks.icon}
      titleCount={definitions.length}
      primaryAction={{ label: t('blocks.library.newBlock'), onClick: onCreate }}
      view={view}
      sort={sort}
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
        message: t('blocks.library.customHint'),
        messageClassName: 'text-stone-600 text-sm max-w-md mx-auto',
        actionLabel: t('blocks.library.newBlock'),
        onAction: onCreate,
      }}
      hasNoResults={!customCollapsed && sorted.length === 0}
      noResultsMessage={t('search.noResults')}
      contentHeader={
        <GroupDivider
          label={t('blocks.library.custom')}
          count={sorted.length}
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
