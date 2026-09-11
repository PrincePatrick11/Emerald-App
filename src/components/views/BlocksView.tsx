import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PanelTopOpen, Trash2 } from 'lucide-react';
import { useBlockDefinitionStore } from '../../store/blockDefinitionStore';
import { copyUsage, useBlockContentRows, type CopyUsage } from '../../store/blockCopies';
import { useUIStore } from '../../store/uiStore';
import { useBlockDraftStore } from '../../store/blockDraftStore';
import { AUX_VIEWS } from '../../lib/modules';
import { definitionLabel } from '../../lib/blocks/blockAttrs';
import type { BlockDefinition } from '../../lib/blocks/definitions';
import Dashboard from '../ui/Dashboard';
import ContextMenu from '../ui/ContextMenu';
import BlockGlyph from '../blocks/BlockGlyph';
import BlockDefinitionEditor, { DeleteDefinitionModal } from '../blocks/BlockDefinitionEditor';

/**
 * Die Rail-Ansicht „Blöcke", gebaut wie die übrigen Dashboards: die Liste der
 * eigenen Blöcke, Kopf (Titel, „Neuer Block", Suche) in der rechten
 * Seitenleiste. Ein Klick öffnet den Block als eigene Seite
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
  const clearDraft = useBlockDraftStore((s) => s.setDraft);
  const rows = useBlockContentRows();
  /** Schnappschuss statt id: der Dialog zeigt nach dem Löschen noch seine Meldung. */
  const [deleting, setDeleting] = useState<BlockDefinition | null>(null);

  const usage = useMemo(() => copyUsage(rows, definitions), [rows, definitions]);
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
      entryCount={usage.get(deleting.id)?.entries ?? 0}
      onClose={() => setDeleting(null)}
      onDeleted={() => {
        clearDraft(deleting.id, null);
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
        <BlockList usage={usage} onOpen={open} onCreate={() => void create()} onDelete={setDeleting} />
      )}
      {deleteModal}
    </>
  );
}

/** Die Liste der eigenen Blöcke im gemeinsamen Dashboard-Gerüst. */
function BlockList({ usage, onOpen, onCreate, onDelete }: {
  usage: Map<string, CopyUsage>;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onDelete: (def: BlockDefinition) => void;
}) {
  const { t } = useTranslation();
  const definitions = useBlockDefinitionStore((s) => s.definitions);
  // Die Seite legt ungespeicherte Entwürfe im Store ab; hier nur der Hinweis darauf.
  const drafts = useBlockDraftStore((s) => s.drafts);
  const openViewInNewTab = useUIStore((s) => s.openViewInNewTab);
  const [search, setSearch] = useState('');
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  const query = search.trim().toLowerCase();
  const filtered = query
    ? definitions.filter((d) => `${definitionLabel(t, d)} ${d.description}`.toLowerCase().includes(query))
    : definitions;

  const renderRow = (def: BlockDefinition) => {
    const u = usage.get(def.id);
    const fieldCount = def.elements.filter((e) => !e.archived).length;
    return (
      <button
        type="button"
        onClick={() => onOpen(def.id)}
        onAuxClick={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            openViewInNewTab({ type: 'blocks', id: def.id });
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setCtxMenu({ id: def.id, x: e.clientX, y: e.clientY });
        }}
        className="panel-interactive w-full text-left flex items-center gap-3 px-4 py-3"
      >
        <BlockGlyph icon={def.icon} size={14} />
        <span className="flex-1 min-w-0">
          <span className="block text-sm text-stone-300 truncate">{definitionLabel(t, def)}</span>
          {def.description && <span className="block text-xs text-stone-500 truncate">{def.description}</span>}
        </span>
        {def.id in drafts && (
          <span className="text-xs italic text-stone-500 flex-shrink-0">{t('blocks.library.unsaved')}</span>
        )}
        {!!u?.outdated && (
          <span className="block-library-outdated-dot" title={t('blocks.library.outdated', { count: u.outdated })} />
        )}
        <span className="text-xs text-stone-500 tabular-nums flex-shrink-0">
          {t('blocks.library.fieldCount', { count: fieldCount })}
          {' · '}
          <span title={u?.entries ? t('blocks.library.usedIn', { count: u.entries }) : t('blocks.library.unused')}>
            {t('blocks.library.entryCount', { count: u?.entries ?? 0 })}
          </span>
        </span>
      </button>
    );
  };

  const headerLeft = (
    <div className="flex items-center gap-3 min-w-0">
      <AUX_VIEWS.blocks.icon size={18} className="text-stone-500 flex-shrink-0" />
      <h1 className="text-lg font-semibold text-stone-100 truncate">{t('nav.blocks')}</h1>
      <span className="text-xs text-stone-500 bg-stone-700/50 px-2 py-0.5 rounded-full">
        {definitions.length}
      </span>
    </div>
  );

  const menuDef = ctxMenu && definitions.find((d) => d.id === ctxMenu.id);

  return (
    <Dashboard<BlockDefinition>
      headerLeft={headerLeft}
      primaryAction={{ label: t('blocks.library.newBlock'), onClick: onCreate }}
      search={search}
      onSearch={setSearch}
      items={filtered}
      itemKey={(d) => d.id}
      renderItem={renderRow}
      grouping={{ mode: 'flat' }}
      isEmpty={definitions.length === 0}
      emptyState={{
        message: t('blocks.library.customHint'),
        messageClassName: 'text-stone-600 text-sm max-w-md mx-auto',
        actionLabel: t('blocks.library.newBlock'),
        onAction: onCreate,
      }}
      hasNoResults={filtered.length === 0}
      noResultsMessage={t('search.noResults')}
      contextMenuSlot={ctxMenu && menuDef && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          actions={[
            { label: t('contextMenu.openInNewTab'), icon: <PanelTopOpen size={12} />, onClick: () => openViewInNewTab({ type: 'blocks', id: menuDef.id }) },
            { label: t('contextMenu.delete'), icon: <Trash2 size={12} />, onClick: () => onDelete(menuDef), danger: true },
          ]}
        />
      )}
    />
  );
}
