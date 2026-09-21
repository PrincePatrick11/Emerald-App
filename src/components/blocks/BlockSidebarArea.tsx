import { useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Eye, EyeOff, GripVertical, LayoutTemplate, MoreHorizontal, Pencil, Plus, Puzzle, Type } from 'lucide-react';
import ContextMenu, { type ContextMenuAction } from '../ui/ContextMenu';
import Button from '../ui/Button';
import SidebarSectionHeader from '../sidebar/fields/SidebarSectionHeader';
import { useUIStore } from '../../store/uiStore';
import { useBlockSessionStore, type BlockSession } from '../../store/blockSessionStore';
import { useBlockDefinitionStore } from '../../store/blockDefinitionStore';
import BlockGlyph from './BlockGlyph';
import { usePersistedFlag } from '../../hooks/usePersistedFlag';
import { usePointerReorder } from '../../hooks/usePointerReorder';
import { sidebarRowStateClasses } from '../../lib/styleClasses';
import { resolveBlockType, type BlockTypeMeta } from '../../lib/blocks/blockTypes';
import {
  blockLabel, blockTypeLabel, customBlockTitle, hiddenAttrValue, isBlockHidden, showsTitleInRead, showTitleAttrValue,
} from '../../lib/blocks/blockAttrs';
import { BLOCK_ATTR, type BlockInstance } from '../../lib/blocks/types';
import { blockIcon } from '../../lib/blocks/presets';
import { blockHoldsLocked, sigilState, todayIso } from '../../lib/blocks/sigil';
import { BLOCK_SIDEBAR_VIEWS } from './blockSidebarViews';
import { addBlockActions, commonBlockActions } from './blockActions';

/** Was die Liste zeigt: beim Bearbeiten alles, beim Lesen nur, was man lesen kann. */
function listedBlocks(session: BlockSession): BlockInstance[] {
  return session.isEditing ? session.blocks : session.blocks.filter((b) => !isBlockHidden(b));
}

/**
 * Die Block-Verwaltung des geöffneten Eintrags in der rechten Seitenleiste:
 * im Bearbeitungsmodus Liste mit Griff, Auge und Menü (Umbenennen, Titel im
 * Lesemodus, Duplizieren, Entfernen) plus „Block hinzufügen"; im Lesemodus
 * eine Gliederung der sichtbaren Blöcke, deren Zeilen zum Block springen —
 * dort nur, wenn es mehr als einen gibt. Bringt ein Blocktyp Einstellungen mit
 * (`blockSidebarViews.ts`), klappt ein Klick auf seine Zeile sie darunter auf —
 * wie die platzierten Elemente des Altars.
 *
 * Alles läuft über die API, die der `BlockStack` im `blockSessionStore`
 * veröffentlicht — die Seitenleiste ändert nie selbst am Eintrag.
 */
export default function BlockSidebarArea() {
  const activeViewId = useUIStore((s) => s.activeView.id);
  const session = useBlockSessionStore((s) => s.session);
  if (!session || session.entryId !== activeViewId) return null;
  if (!session.isEditing && listedBlocks(session).length < 2) return null;
  // Pro Montage des Stapels neu: ein offenes Menü oder Umbenennen darf einen
  // Cancel-Remount nicht überleben — es gehörte zum Stapel davor.
  return <BlockManager key={session.sessionId} session={session} />;
}

function BlockManager({ session }: { session: BlockSession }) {
  const { t } = useTranslation();
  const [open, toggleOpen] = usePersistedFlag('blocks-sidebar-open', true);
  const [menu, setMenu] = useState<{ x: number; y: number; actions: ContextMenuAction[] } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { isEditing, api } = session;
  const rows = listedBlocks(session);
  // Ohne Animation, wie die platzierten Elemente des Altars.
  const { listRef, visualItems, draggingId, startDrag } = usePointerReorder(rows, (ordered) => api.reorder(ordered.map((b) => b.id)));
  const definitions = useBlockDefinitionStore((s) => s.definitions);
  // Was eine geladene Sigille sperrt, lässt sich nicht duplizieren (siehe BlockStack.duplicate).
  const sigil = sigilState(session.blocks, todayIso());

  const openAddMenu = (e: MouseEvent) => setMenu({
    x: e.clientX,
    y: e.clientY,
    actions: addBlockActions(t, (presetId) => api.insert(session.blocks.length, presetId), definitions),
  });

  const openRowMenu = (e: MouseEvent, block: BlockInstance, meta: BlockTypeMeta | undefined) => {
    const showsTitle = showsTitleInRead(block, meta);
    setMenu({
      x: e.clientX,
      y: e.clientY,
      actions: [
        { label: t('blocks.rename'), icon: <Pencil size={12} />, onClick: () => setRenamingId(block.id) },
        {
          label: t('blocks.showTitle'),
          icon: showsTitle ? <Check size={12} /> : <Type size={12} />,
          onClick: () => api.setAttr(block.id, BLOCK_ATTR.showTitle, showTitleAttrValue(!showsTitle, meta)),
        },
        ...commonBlockActions(t, meta, {
          duplicate: blockHoldsLocked(sigil, block.id) ? undefined : () => api.duplicate(block.id),
          remove: () => api.remove(block.id),
        }),
      ],
    });
  };

  return (
    <div className="pb-4 border-t border-stone-700/60">
      <SidebarSectionHeader label={t('blocks.sidebarTitle')} open={open} onToggle={toggleOpen} className="pt-4" />

      {open && (
        <>
          <div ref={listRef} className="mt-2 space-y-1">
            {visualItems.map((block) => {
              const meta = resolveBlockType(block);
              const settings = blockSettings(session, block, meta);
              const selected = selectedId === block.id;
              return (
                <ManagerRow
                  key={block.id}
                  block={block}
                  meta={meta}
                  label={blockLabel(t, block, meta)}
                  typeLabel={blockTypeLabel(t, block, meta)}
                  isEditing={isEditing}
                  // Umbenennen nur beim Bearbeiten: im Lesemodus entginge die
                  // Änderung dem Autosave und später der Cancel-Baseline.
                  renaming={isEditing && renamingId === block.id}
                  onRenamed={(title) => {
                    setRenamingId(null);
                    if (title !== undefined) api.setAttr(block.id, BLOCK_ATTR.title, title.trim() || null);
                  }}
                  selected={selected}
                  isDragging={draggingId === block.id}
                  onGripPointerDown={(e) => startDrag(e, block.id)}
                  onActivate={() => {
                    if (!selected) api.reveal(block.id);
                    setSelectedId(selected ? null : block.id);
                  }}
                  onToggleHidden={() => api.setAttr(block.id, BLOCK_ATTR.hidden, hiddenAttrValue(!isBlockHidden(block)))}
                  onOpenMenu={(e) => openRowMenu(e, block, meta)}
                  settings={settings}
                />
              );
            })}
          </div>
          {isEditing && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button tone="neutral" small onClick={openAddMenu}>
                <Plus size={12} />
                <span>{t('blocks.add')}</span>
              </Button>
              {session.templates && (
                <Button tone="neutral" small onClick={api.openTemplatePicker}>
                  <LayoutTemplate size={12} />
                  <span>{t('templates.insert.button')}</span>
                </Button>
              )}
            </div>
          )}
        </>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} actions={menu.actions} onClose={() => setMenu(null)} />}
    </div>
  );
}

interface ManagerRowProps {
  block: BlockInstance;
  meta: BlockTypeMeta | undefined;
  label: string;
  typeLabel: string;
  isEditing: boolean;
  renaming: boolean;
  /** Neuer Titel, oder `undefined` für „abgebrochen". */
  onRenamed: (title: string | undefined) => void;
  /** Ausgewählt — hat der Block Einstellungen, stehen sie aufgeklappt unter der Zeile. */
  selected: boolean;
  isDragging: boolean;
  onGripPointerDown: (e: PointerEvent) => void;
  /** Klick auf die Beschriftung: zum Block springen, aus- oder abwählen. */
  onActivate: () => void;
  onToggleHidden: () => void;
  onOpenMenu: (e: MouseEvent) => void;
  /** Die Einstellungen des Blocks (`null`: keine) — unter der Zeile, damit sie beim Ziehen mitwandern. */
  settings: ReactNode;
}

/**
 * Eine Zeile der Verwaltungsliste — dieselbe Form wie die platzierten Elemente
 * des Altars, mit denselben Zuständen (`sidebarRowStateClasses`).
 */
function ManagerRow({
  block, meta, label, typeLabel, isEditing, renaming, onRenamed, selected, isDragging, onGripPointerDown, onActivate, onToggleHidden, onOpenMenu, settings,
}: ManagerRowProps) {
  const { t } = useTranslation();
  const cancelledRef = useRef(false);
  const hidden = isBlockHidden(block);
  const glyph = blockIcon(block, meta) ?? Puzzle;

  return (
    <div>
      <div
        onContextMenu={isEditing ? (e) => { e.preventDefault(); onOpenMenu(e); } : undefined}
        className={`w-full flex items-center gap-2 rounded border px-2 py-1.5 transition-all select-none ${
          sidebarRowStateClasses({ dragging: isDragging, selected })
        } ${hidden ? 'opacity-50' : ''}`}
      >
        {isEditing && (
          <span
            onPointerDown={onGripPointerDown}
            className="block-row-action cursor-grab active:cursor-grabbing touch-none"
            title={t('blocks.dragToMove')}
          >
            <GripVertical size={12} />
          </span>
        )}
        {renaming ? (
          <>
            <BlockGlyph icon={glyph} />
            <input
              autoFocus
              defaultValue={customBlockTitle(block) ?? ''}
              placeholder={typeLabel}
              onFocus={() => { cancelledRef.current = false; }}
              onBlur={(e) => onRenamed(cancelledRef.current ? undefined : e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') { cancelledRef.current = true; e.currentTarget.blur(); }
              }}
              className="block-row-rename flex-1 min-w-0 bg-transparent text-[11px] font-medium text-stone-200 outline-none selectable"
            />
          </>
        ) : (
          <button type="button" onClick={onActivate} title={t('blocks.jumpTo')} aria-pressed={selected} className="block-row-label">
            <BlockGlyph icon={glyph} />
            <span className="truncate text-[11px] font-medium">{label}</span>
          </button>
        )}
        {isEditing && (
          <>
            <button
              type="button"
              onClick={onToggleHidden}
              className={`block-row-action ${hidden ? 'block-row-action--on' : ''}`}
              title={hidden ? t('blocks.show') : t('blocks.hide')}
              aria-label={hidden ? t('blocks.show') : t('blocks.hide')}
            >
              {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
            <button
              type="button"
              onClick={onOpenMenu}
              className="block-row-action"
              title={t('blocks.actions')}
              aria-label={t('blocks.actions')}
            >
              <MoreHorizontal size={12} />
            </button>
          </>
        )}
      </div>
      {selected && settings !== null && (
        <div className="mt-1 mb-2 rounded border border-stone-700/50 bg-stone-900/40 px-2 py-2">{settings}</div>
      )}
    </div>
  );
}

/**
 * Die Einstellungen, die ein Blocktyp in die Seitenleiste mitbringt
 * (`blockSidebarViews.ts`) — `null`, wenn er für diesen Modus keine hat.
 */
function blockSettings(session: BlockSession, block: BlockInstance, meta: BlockTypeMeta | undefined): ReactNode {
  const { isEditing, api } = session;
  const views = meta ? BLOCK_SIDEBAR_VIEWS.get(meta.id) : undefined;
  if (isEditing && views?.Edit) {
    const Edit = views.Edit;
    return (
      <Edit
        block={block}
        setAttr={(name, value) => api.setAttr(block.id, name, value)}
        update={(next) => api.update(block.id, next)}
      />
    );
  }
  if (!isEditing && views?.Read) {
    const Read = views.Read;
    return <Read block={block} />;
  }
  return null;
}
