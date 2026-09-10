import { useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Check, Eye, EyeOff, GripVertical, MoreHorizontal, Pencil, Plus, Puzzle, Type } from 'lucide-react';
import ContextMenu, { type ContextMenuAction } from '../ui/ContextMenu';
import Button from '../ui/Button';
import SidebarSectionHeader from '../sidebar/fields/SidebarSectionHeader';
import { useUIStore } from '../../store/uiStore';
import { useBlockSessionStore, type BlockSession } from '../../store/blockSessionStore';
import { useBlockDefinitionStore } from '../../store/blockDefinitionStore';
import BlockGlyph from './BlockGlyph';
import { usePersistedFlag } from '../../hooks/usePersistedFlag';
import { REORDER_SPRING } from '../../lib/motion';
import { resolveBlockType, type BlockTypeMeta } from '../../lib/blocks/blockTypes';
import {
  blockLabel, blockTypeLabel, customBlockTitle, hiddenAttrValue, isBlockHidden, showsTitleInRead, showTitleAttrValue,
} from '../../lib/blocks/blockAttrs';
import { BLOCK_ATTR, type BlockInstance } from '../../lib/blocks/types';
import { blockIcon } from '../../lib/blocks/presets';
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
 * dort nur, wenn es mehr als einen gibt. Darunter die Abschnitte, die
 * Blocktypen mitbringen.
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
  const { isEditing, api } = session;
  const rows = listedBlocks(session);
  const definitions = useBlockDefinitionStore((s) => s.definitions);

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
        ...commonBlockActions(t, meta, { duplicate: () => api.duplicate(block.id), remove: () => api.remove(block.id) }),
      ],
    });
  };

  return (
    <div className="pb-4 border-t border-stone-700/60">
      <SidebarSectionHeader label={t('blocks.sidebarTitle')} open={open} onToggle={toggleOpen} className="pt-4" />

      {open && (
        <>
          <Reorder.Group as="div" axis="y" values={rows.map((b) => b.id)} onReorder={api.reorder} className="mt-2 space-y-1">
            {rows.map((block) => {
              const meta = resolveBlockType(block);
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
                  onReveal={() => api.reveal(block.id)}
                  onToggleHidden={() => api.setAttr(block.id, BLOCK_ATTR.hidden, hiddenAttrValue(!isBlockHidden(block)))}
                  onOpenMenu={(e) => openRowMenu(e, block, meta)}
                />
              );
            })}
          </Reorder.Group>
          {isEditing && (
            <Button tone="neutral" small className="mt-2" onClick={openAddMenu}>
              <Plus size={12} />
              <span>{t('blocks.add')}</span>
            </Button>
          )}
        </>
      )}

      <BlockSections session={session} />

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
  onReveal: () => void;
  onToggleHidden: () => void;
  onOpenMenu: (e: MouseEvent) => void;
}

/**
 * Eine Zeile der Verwaltungsliste — dieselbe Form wie die platzierten Elemente
 * des Altars. Die Zeilenfläche selbst bleibt die Tailwind-Kette von
 * `PlacedElementRow`: die Parchment-Brücke hängt an diesen Klassennamen, eine
 * eigene Klasse per `@apply` verlöre sie.
 */
function ManagerRow({
  block, meta, label, typeLabel, isEditing, renaming, onRenamed, onReveal, onToggleHidden, onOpenMenu,
}: ManagerRowProps) {
  const { t } = useTranslation();
  const controls = useDragControls();
  const cancelledRef = useRef(false);
  const hidden = isBlockHidden(block);
  const glyph = blockIcon(block, meta) ?? Puzzle;

  return (
    <Reorder.Item as="div" value={block.id} dragListener={false} dragControls={controls} transition={REORDER_SPRING} style={{ position: 'relative' }}>
      <div
        onContextMenu={isEditing ? (e) => { e.preventDefault(); onOpenMenu(e); } : undefined}
        className={`w-full flex items-center gap-2 rounded border px-2 py-1.5 transition-all select-none
                    border-stone-700/60 bg-stone-900/45 text-stone-400 hover:border-stone-500/70 hover:text-stone-300
                    ${hidden ? 'opacity-50' : ''}`}
      >
        {isEditing && (
          <span
            onPointerDown={(e) => controls.start(e)}
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
          <button type="button" onClick={onReveal} title={t('blocks.jumpTo')} className="block-row-label">
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
    </Reorder.Item>
  );
}

/** Die Abschnitte, die Blocktypen in die Seitenleiste mitbringen (`blockSidebarViews.ts`). */
function BlockSections({ session }: { session: BlockSession }) {
  const { t } = useTranslation();
  const { isEditing, api } = session;
  return (
    <>
      {listedBlocks(session).map((block) => {
        const meta = resolveBlockType(block);
        const views = meta ? BLOCK_SIDEBAR_VIEWS.get(meta.id) : undefined;
        const label = blockLabel(t, block, meta);
        if (isEditing && views?.Edit) {
          const Edit = views.Edit;
          return (
            <BlockSection key={block.id} type={block.type} label={label}>
              <Edit
                block={block}
                setAttr={(name, value) => api.setAttr(block.id, name, value)}
                update={(next) => api.update(block.id, next)}
              />
            </BlockSection>
          );
        }
        if (!isEditing && views?.Read) {
          const Read = views.Read;
          return (
            <BlockSection key={block.id} type={block.type} label={label}>
              <Read block={block} />
            </BlockSection>
          );
        }
        return null;
      })}
    </>
  );
}

function BlockSection({ type, label, children }: { type: string; label: string; children: ReactNode }) {
  const [open, toggle] = usePersistedFlag(`block-section-open:${type}`, true);
  return (
    <div className="mt-4 border-t border-stone-700/60">
      <SidebarSectionHeader label={label} open={open} onToggle={toggle} className="pt-4" />
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}
