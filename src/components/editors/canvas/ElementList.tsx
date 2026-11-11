import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { keys } from './shortcuts';
import { Copy, Group, Trash2, Ungroup } from 'lucide-react';
import { DRAG_THRESHOLD_PX, trackPointerDrag } from '../../../lib/pointerDrag';
import { ToolbarBtn } from '../shared/toolbarParts';
import { drawElement } from './draw';
import { DOCK_THUMB_HEIGHT, DOCK_THUMB_WIDTH, DockButtons, DockOpacity, DockToggles, LayerDock } from './LayerDock';
import { common } from './elements/controlParts';
import { cachedCanvasImage } from './imageCache';
import { byZ, type CanvasElement, type CanvasTypes } from './types';

/** The element in small, fitted into the row's picture, drawn again when it changes or a picture arrives. */
const ElementThumb = memo(function ElementThumb({ el, types, resourceVersion }: {
  el: CanvasElement;
  types: CanvasTypes;
  resourceVersion: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = DOCK_THUMB_WIDTH * dpr, h = DOCK_THUMB_HEIGHT * dpr;
    canvas.width = w;
    canvas.height = h;
    const scale = 0.85 * Math.min(w / Math.max(el.width, 1), h / Math.max(el.height, 1));
    ctx.setTransform(scale, 0, 0, scale, (w - el.width * scale) / 2, (h - el.height * scale) / 2);
    drawElement(ctx, el, types, { image: cachedCanvasImage, time: null });
  }, [el, types, resourceVersion]);
  return <canvas ref={ref} className="paint-layer-thumb" style={{ width: DOCK_THUMB_WIDTH, height: DOCK_THUMB_HEIGHT }} aria-hidden />;
});

/** A row of the list: one element, or the head of a group with its members below it. */
type Row =
  | { kind: 'element'; el: CanvasElement; inGroup: boolean }
  | { kind: 'group'; group: string; members: CanvasElement[] };

/** The elements top first; members of a group that lie together in the stacking get a head row above them. */
function rowsOf(elements: readonly CanvasElement[]): Row[] {
  const top = byZ(elements).reverse();
  const rows: Row[] = [];
  for (let i = 0; i < top.length; i++) {
    const el = top[i];
    if (!el.group) {
      rows.push({ kind: 'element', el, inGroup: false });
      continue;
    }
    const members = [el];
    while (i + 1 < top.length && top[i + 1].group === el.group) members.push(top[++i]);
    rows.push({ kind: 'group', group: el.group, members });
    for (const member of members) rows.push({ kind: 'element', el: member, inGroup: true });
  }
  return rows;
}

export interface ElementListProps {
  elements: CanvasElement[];
  selectedIds: string[];
  types: CanvasTypes;
  /** The place's name for an element, before the type's. */
  labelOf?: (el: CanvasElement) => string | null | undefined;
  resourceVersion: number;
  canGroup: boolean;
  onSelect: (ids: string[]) => void;
  /** Changes the given elements (hidden, locked) in one step. */
  onPatch: (ids: string[], patch: Partial<Pick<CanvasElement, 'hidden' | 'locked'>>) => void;
  /** Moves the given elements so the lowest of them lands at `index` of the stacking among the others. */
  onMove: (ids: string[], index: number) => void;
  /** The opacity of the selected, unlocked elements, 0–1. */
  onOpacity: (opacity: number) => void;
  onDuplicate: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onRemove: () => void;
  onClose: () => void;
}

/**
 * The elements as a list laid over the stage's right side, the top one first,
 * as they lie on the artboard. A click selects (Shift or ⌘ adds), and picks
 * a single element out of a group; dragging a row changes the stacking; the
 * eye and the lock are on each row. A group shows as a head row over its
 * members: a click on it selects the group, its eye and lock act on all.
 * Below, like the paint mode's layers: the selection's opacity, then
 * duplicating, grouping, ungrouping and removing it.
 */
export default function ElementList({
  elements, selectedIds, types, labelOf, resourceVersion, canGroup, onSelect, onPatch, onMove,
  onOpacity, onDuplicate, onGroup, onUngroup, onRemove, onClose,
}: ElementListProps) {
  const { t } = useTranslation();
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const [drag, setDrag] = useState<{ ids: string[]; before: string | null } | null>(null);
  const rows = rowsOf(elements);
  const selected = new Set(selectedIds);

  const label = (el: CanvasElement) => labelOf?.(el) || types[el.type]?.label?.(el, t) || t('canvas.element');

  const pick = (ids: string[], e: React.MouseEvent) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      const all = ids.every((id) => selected.has(id));
      onSelect(all ? selectedIds.filter((id) => !ids.includes(id)) : [...selectedIds, ...ids.filter((id) => !selected.has(id))]);
    } else {
      onSelect(ids);
    }
  };

  /** Where a pointer at `clientY` drops: before the first other element whose row's middle lies below it. */
  const dropAt = (clientY: number, moving: string[]) => {
    const others = rows.filter((r): r is Extract<Row, { kind: 'element' }> => r.kind === 'element' && !moving.includes(r.el.id));
    const at = others.findIndex((r) => {
      const rect = rowRefs.current.get(r.el.id)?.getBoundingClientRect();
      return rect && clientY < rect.top + rect.height / 2;
    });
    // Rows run top first, the stacking bottom first.
    const index = at < 0 ? 0 : others.length - at;
    return { index, before: at < 0 ? null : others[at].el.id };
  };

  const startDrag = (e: React.PointerEvent, ids: string[]) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.editor-toolbar-btn')) return;
    let index: number | null = null;
    trackPointerDrag(e.nativeEvent, {
      threshold: DRAG_THRESHOLD_PX,
      onMove: (ev) => {
        const drop = dropAt(ev.clientY, ids);
        index = drop.index;
        setDrag({ ids, before: drop.before });
      },
      onEnd: ({ started, cancelled }) => {
        setDrag(null);
        if (started && !cancelled && index !== null) onMove(ids, index);
      },
    });
  };

  const toggles = (members: CanvasElement[]) => {
    const ids = members.map((el) => el.id);
    const hidden = members.every((el) => el.hidden);
    const locked = members.every((el) => el.locked);
    return <DockToggles locked={locked} hidden={hidden} onLock={() => onPatch(ids, { locked: !locked })} onHide={() => onPatch(ids, { hidden: !hidden })} />;
  };

  const selectedGroups = new Set(elements.filter((el) => el.group && selected.has(el.id)).map((el) => el.group));
  const editable = elements.filter((el) => selected.has(el.id) && !el.locked);
  const opacity = common(editable, (el) => Math.round(el.opacity * 100));

  return (
    <LayerDock
      title={t('canvas.layers.title')}
      onClose={onClose}
      footer={(<>
        <DockOpacity value={editable.length ? opacity : undefined} onChange={(percent) => onOpacity(percent / 100)} />
        <DockButtons>
          <ToolbarBtn onClick={onDuplicate} disabled={!editable.length} title={t('canvas.duplicate')}>
            <Copy size={14} />
          </ToolbarBtn>
          {canGroup && (<>
            <ToolbarBtn onClick={onGroup} disabled={editable.length < 2} title={t('canvas.layers.groupAction', { keys: keys('G') })}>
              <Group size={14} />
            </ToolbarBtn>
            <ToolbarBtn onClick={onUngroup} disabled={!selectedGroups.size} title={t('canvas.layers.ungroup', { keys: keys('G', true, true) })}>
              <Ungroup size={14} />
            </ToolbarBtn>
          </>)}
          <ToolbarBtn onClick={onRemove} disabled={!editable.length} title={t('canvas.remove')}>
            <Trash2 size={14} />
          </ToolbarBtn>
        </DockButtons>
      </>)}
    >
      {!rows.length && <p className="canvas-layers-empty">{t('canvas.layers.empty')}</p>}
      {rows.map((row) => {
        const ids = row.kind === 'group' ? row.members.map((el) => el.id) : [row.el.id];
        const isSelected = ids.every((id) => selected.has(id));
        const hidden = row.kind === 'group' ? row.members.every((el) => el.hidden) : row.el.hidden;
        const dragged = drag?.ids.some((id) => ids.includes(id));
        const dropTarget = row.kind === 'element' && drag?.before === row.el.id;
        return (
          <div
            key={row.kind === 'group' ? `group:${row.group}:${row.members[0].id}` : row.el.id}
            ref={row.kind === 'element'
              ? (el) => { if (el) rowRefs.current.set(row.el.id, el); else rowRefs.current.delete(row.el.id); }
              : undefined}
            className={[
              'paint-layer',
              row.kind === 'group' && 'canvas-layer-group',
              row.kind === 'element' && row.inGroup && 'canvas-layer-member',
              isSelected && 'paint-layer--active',
              hidden && 'paint-layer--hidden',
              dragged && 'paint-layer--dragged',
              dropTarget && 'paint-layer--drop-above',
            ].filter(Boolean).join(' ')}
            onPointerDown={(e) => startDrag(e, ids)}
            onClick={(e) => { if (!(e.target as HTMLElement).closest('.editor-toolbar-btn')) pick(ids, e); }}
            title={t('canvas.layers.hint')}
            aria-pressed={isSelected}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
              e.preventDefault();
              e.stopPropagation();
              onSelect(ids);
            }}
          >
            {row.kind === 'group'
              ? <span className="canvas-layer-group-icon"><Group size={14} /></span>
              : <ElementThumb el={row.el} types={types} resourceVersion={resourceVersion} />}
            <div className="paint-layer-text">
              <span className="paint-layer-name">
                <span className="truncate">
                  {row.kind === 'group' ? t('canvas.layers.group', { count: row.members.length }) : label(row.el)}
                </span>
              </span>
            </div>
            {toggles(row.kind === 'group' ? row.members : [row.el])}
          </div>
        );
      })}
      {drag && drag.before === null && <div className="canvas-layers-drop-end" />}
    </LayerDock>
  );
}
