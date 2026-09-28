import { useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Eye, EyeOff, CopyPlus, GripVertical, MoreHorizontal, Pencil, Plus, Puzzle, Type } from 'lucide-react';
import ContextMenu, { type ContextMenuAction } from '../ui/ContextMenu';
import SidebarSection, { SidebarItemRow } from '../sidebar/fields/SidebarSection';
import { useUIStore } from '../../store/uiStore';
import { useBlockSessionStore, type BlockSession } from '../../store/blockSessionStore';
import { useBlockDefinitionStore } from '../../store/blockDefinitionStore';
import BlockGlyph from './BlockGlyph';
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

/** Was die Gliederung im Lesemodus zeigt: nur, was man lesen kann. */
function readableBlocks(session: BlockSession): BlockInstance[] {
  return session.blocks.filter((b) => !isBlockHidden(b));
}

/** Die aufgeklappten Einstellungen eines Blocks unter seiner Zeile. */
function BlockSettingsBox({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`block-settings-panel ${className}`}>{children}</div>;
}

/**
 * Die Block-Verwaltung des geöffneten Eintrags in der rechten Seitenleiste:
 * im Bearbeitungsmodus Liste mit Griff, Auge und Menü (Umbenennen, Titel im
 * Lesemodus, Duplizieren, Entfernen) plus „Block hinzufügen"; im Lesemodus
 * eine Gliederung der sichtbaren Blöcke (`BlockOutline`), deren Zeilen zum
 * Block springen — dort nur, wenn es mehr als einen gibt. Bringt ein
 * Blocktyp Einstellungen mit (`blockSidebarViews.ts`), klappt ein Klick auf
 * seine Zeile sie darunter auf — wie die platzierten Elemente des Altars.
 *
 * Alles läuft über die API, die der `BlockStack` im `blockSessionStore`
 * veröffentlicht — die Seitenleiste ändert nie selbst am Eintrag.
 */
export default function BlockSidebarArea() {
  const activeViewId = useUIStore((s) => s.activeView.id);
  const session = useBlockSessionStore((s) => s.session);
  if (!session || session.entryId !== activeViewId) return null;
  // Beide pro Montage des Stapels neu (`key`): ein offenes Menü, Umbenennen oder
  // eine Auswahl darf einen Cancel-Remount nicht überleben — es gehörte zum Stapel davor.
  if (!session.isEditing) {
    if (readableBlocks(session).length < 2) return null;
    return <BlockOutline key={session.sessionId} session={session} />;
  }
  return <BlockManager key={session.sessionId} session={session} />;
}

/**
 * Die Gliederung im Lesemodus: ein Abschnitt wie Verlinkungen und Tags darüber
 * (`SidebarSection`), je sichtbarem Block eine Zeile. Ein Klick springt zum
 * Block; bringt sein Typ Einstellungen fürs Lesen mit, klappen sie darunter auf.
 */
function BlockOutline({ session }: { session: BlockSession }) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rows = readableBlocks(session);
  return (
    <SidebarSection storageKey="blocks-sidebar-open" label={t('blocks.sidebarTitle')} count={rows.length}>
      {rows.map((block) => {
        const meta = resolveBlockType(block);
        const selected = selectedId === block.id;
        const settings = selected ? blockSettings(session, block, meta) : null;
        return (
          <div key={block.id}>
            <SidebarItemRow
              icon={<BlockGlyph icon={blockIcon(block, meta) ?? Puzzle} size={14} />}
              label={blockLabel(t, block, meta)}
              title={t('blocks.jumpTo')}
              active={selected}
              onClick={() => {
                if (!selected) session.api.reveal(block.id);
                setSelectedId(selected ? null : block.id);
              }}
            />
            {settings !== null && <BlockSettingsBox className="mx-1">{settings}</BlockSettingsBox>}
          </div>
        );
      })}
    </SidebarSection>
  );
}

function BlockManager({ session }: { session: BlockSession }) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<{ x: number; y: number; actions: ContextMenuAction[] } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { api } = session;
  // Ohne Animation, wie die platzierten Elemente des Altars.
  const { listRef, visualItems, draggingId, startDrag } = usePointerReorder(session.blocks, (ordered) => api.reorder(ordered.map((b) => b.id)));
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
    <>
      {/* Derselbe Abschnitt wie im Lesen (`BlockOutline`): gleicher Kopf, gleiches
          Auf/Zu, gleicher Zähler — die Zeilen darin bleiben die der Verwaltung. */}
      <SidebarSection storageKey="blocks-sidebar-open" label={t('blocks.sidebarTitle')} count={session.blocks.length}>
        <div ref={listRef} className="space-y-1">
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
                renaming={renamingId === block.id}
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
        {/* Unter einer Linie abgesetzt: die Knöpfe gehören zur Liste, sind aber keine Zeilen darin. */}
        <div className="sidebar-section-actions">
          <button type="button" className="sidebar-section-button" onClick={openAddMenu}>
            <Plus size={13} className="flex-shrink-0" />
            <span className="min-w-0 truncate">{t('blocks.add')}</span>
          </button>
          {session.templates && (
            <button type="button" className="sidebar-section-button" onClick={api.openTemplatePicker}>
              <CopyPlus size={13} className="flex-shrink-0" />
              <span className="min-w-0 truncate">{t('templates.insert.button')}</span>
            </button>
          )}
        </div>
      </SidebarSection>

      {menu && <ContextMenu x={menu.x} y={menu.y} actions={menu.actions} onClose={() => setMenu(null)} />}
    </>
  );
}

interface ManagerRowProps {
  block: BlockInstance;
  meta: BlockTypeMeta | undefined;
  label: string;
  typeLabel: string;
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
 * Eine Zeile der Verwaltungsliste im Bearbeiten — dieselbe Form wie die platzierten Elemente
 * des Altars, mit denselben Zuständen (`sidebarRowStateClasses`).
 */
function ManagerRow({
  block, meta, label, typeLabel, renaming, onRenamed, selected, isDragging, onGripPointerDown, onActivate, onToggleHidden, onOpenMenu, settings,
}: ManagerRowProps) {
  const { t } = useTranslation();
  const cancelledRef = useRef(false);
  const hidden = isBlockHidden(block);
  const glyph = blockIcon(block, meta) ?? Puzzle;

  return (
    <div>
      <div
        onContextMenu={(e) => { e.preventDefault(); onOpenMenu(e); }}
        // 32px hoch, 13px und 14px-Icons wie die übrigen Zeilen der Seitenleiste.
        className={`w-full flex items-center gap-2 h-8 rounded border pl-1 pr-1 text-[13px] transition-all select-none ${
          // Ohne Rahmen, solange sie weder gewählt noch gezogen wird — die
          // Zustände darüber teilt sie mit den Elementen des Altars.
          isDragging || selected ? sidebarRowStateClasses({ dragging: isDragging, selected }) : 'block-manager-row--idle'
        } ${hidden ? 'opacity-50' : ''}`}
      >
        <span
          onPointerDown={onGripPointerDown}
          className="block-row-action cursor-grab active:cursor-grabbing touch-none"
          title={t('blocks.dragToMove')}
        >
          <GripVertical size={14} />
        </span>
        {renaming ? (
          <>
            <BlockGlyph icon={glyph} size={14} />
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
              className="block-row-rename flex-1 min-w-0 bg-transparent text-[13px] text-stone-200 outline-none selectable"
            />
          </>
        ) : (
          <button type="button" onClick={onActivate} title={t('blocks.jumpTo')} aria-pressed={selected} className="block-row-label">
            <BlockGlyph icon={glyph} size={14} />
            <span className={`truncate${selected ? ' font-semibold' : ''}`}>{label}</span>
          </button>
        )}
        <button
          type="button"
          onClick={onToggleHidden}
          className={`block-manager-icon-btn${hidden ? ' block-manager-icon-btn--on' : ''}`}
          title={hidden ? t('blocks.show') : t('blocks.hide')}
          aria-label={hidden ? t('blocks.show') : t('blocks.hide')}
        >
          {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
        <button
          type="button"
          onClick={onOpenMenu}
          className="block-manager-icon-btn"
          title={t('blocks.actions')}
          aria-label={t('blocks.actions')}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
      {selected && settings !== null && <BlockSettingsBox>{settings}</BlockSettingsBox>}
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
