import { Fragment, useRef, useState, type ReactNode } from 'react';
import { useOutsideClick } from '../../../hooks/useOutsideClick';
import { useTranslation } from 'react-i18next';
import { keys } from './shortcuts';
import {
  AlignHorizontalDistributeCenter, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart, AlignVerticalDistributeCenter, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart, ArrowDown, ArrowUp, BringToFront, Copy, Group, ImageDown, ImagePlus, Layers, Layers2, Lock, LockOpen, MousePointer2, Ruler, SendToBack, Trash2,
  Ungroup, ZoomIn, ZoomOut,
} from 'lucide-react';
import { ToolbarBtn, ToolbarDivider, ToolbarGroup, ToolRail, ToolRailGroup, UndoRedoGroup } from '../shared/toolbarParts';
import PopoverButton from '../shared/PopoverButton';
import type { CanvasController } from './CanvasEditor';
import BackgroundPanel from './BackgroundPanel';
import { EMPTY_BACKGROUND } from './background';
import type { AlignEdge } from './canvasActions';

const ALIGN_ICONS: Record<AlignEdge, ReactNode> = {
  left: <AlignHorizontalJustifyStart size={14} />,
  hcenter: <AlignHorizontalJustifyCenter size={14} />,
  right: <AlignHorizontalJustifyEnd size={14} />,
  top: <AlignVerticalJustifyStart size={14} />,
  vcenter: <AlignVerticalJustifyCenter size={14} />,
  bottom: <AlignVerticalJustifyEnd size={14} />,
};

/**
 * The canvas editor's bar. Like the paint mode's, it keeps its place: undo
 * first, then what the selection has — the controls of the
 * selected elements' types; aligning the selection, and — without the
 * element list, which has them — stacking, grouping, duplicating and
 * removing; at the far end the background, the rulers, the element list and
 * saving as a picture. Zoom
 * sits on the stage itself (`CanvasZoom`), so the bar stays one row.
 */
export default function CanvasToolbar({ controller: c, end }: { controller: CanvasController; end?: ReactNode }) {
  const { t } = useTranslation();
  const f = c.features;
  const editable = c.selected.filter((el) => !el.locked);
  const hasSelection = editable.length > 0;
  const types = Object.values(c.types);
  const selectedTypes = types.filter((type) => type.controls && editable.some((el) => el.type === type.type));
  const grouped = c.selected.some((el) => el.group);
  // What aligns as one: a group, or an element on its own.
  const units = new Set(editable.map((el) => el.group ?? el.id)).size;

  return (
    <div className="editor-toolbar canvas-toolbar">
      {f.history && (<>
        <UndoRedoGroup undo={c.undo} redo={c.redo} canUndo={c.canUndo} canRedo={c.canRedo} />
        <ToolbarDivider />
      </>)}

      {selectedTypes.map((type) => {
        const Controls = type.controls!;
        return (
          <Fragment key={type.type}>
            <Controls
              elements={editable.filter((el) => el.type === type.type)}
              update={(patch) => c.update(type.type, patch)}
            />
            <ToolbarDivider />
          </Fragment>
        );
      })}

      {hasSelection && (
        <ToolbarGroup>
          {f.align && (
            <PopoverButton
              icon={<AlignHorizontalJustifyCenter size={14} />}
              title={units > 1 ? t('canvas.alignSelection') : t('canvas.alignArtboard')}
              active={false}
            >
              {() => (
                <ToolbarGroup>
                  {(Object.keys(ALIGN_ICONS) as AlignEdge[]).map((edge) => (
                    <ToolbarBtn key={edge} onClick={() => c.align(edge)} title={t(`canvas.align.${edge}`)}>
                      {ALIGN_ICONS[edge]}
                    </ToolbarBtn>
                  ))}
                  {units > 2 && (<>
                    <ToolbarDivider />
                    <ToolbarBtn onClick={() => c.distribute('horizontal')} title={t('canvas.distributeHorizontal')}><AlignHorizontalDistributeCenter size={14} /></ToolbarBtn>
                    <ToolbarBtn onClick={() => c.distribute('vertical')} title={t('canvas.distributeVertical')}><AlignVerticalDistributeCenter size={14} /></ToolbarBtn>
                  </>)}
                </ToolbarGroup>
              )}
            </PopoverButton>
          )}
          {/* With the element list, stacking, grouping, duplicating and removing live there, as the paint mode's layers do. */}
          {!f.layers && (<>
            {f.arrange && (
              <PopoverButton icon={<Layers2 size={14} />} title={t('canvas.arrange')} active={false}>
                {(close) => (
                  <ToolbarGroup>
                    <ToolbarBtn onClick={() => { c.arrange('front'); close(); }} title={t('canvas.toFront')}><BringToFront size={14} /></ToolbarBtn>
                    <ToolbarBtn onClick={() => c.arrange('forward')} title={t('canvas.forward')}><ArrowUp size={14} /></ToolbarBtn>
                    <ToolbarBtn onClick={() => c.arrange('backward')} title={t('canvas.backward')}><ArrowDown size={14} /></ToolbarBtn>
                    <ToolbarBtn onClick={() => { c.arrange('back'); close(); }} title={t('canvas.toBack')}><SendToBack size={14} /></ToolbarBtn>
                  </ToolbarGroup>
                )}
              </PopoverButton>
            )}
            {f.group && editable.length > 1 && (
              <ToolbarBtn onClick={c.group} title={t('canvas.layers.groupAction', { keys: keys('G') })}><Group size={14} /></ToolbarBtn>
            )}
            {f.group && grouped && (
              <ToolbarBtn onClick={c.ungroup} title={t('canvas.layers.ungroup', { keys: keys('G', true, true) })}><Ungroup size={14} /></ToolbarBtn>
            )}
            <ToolbarBtn onClick={c.duplicate} title={t('canvas.duplicate')}><Copy size={14} /></ToolbarBtn>
            <ToolbarBtn onClick={c.removeSelected} title={t('canvas.remove')}><Trash2 size={14} /></ToolbarBtn>
          </>)}
        </ToolbarGroup>
      )}

      <div className="editor-toolbar-end">
        {c.setBackground && <BackgroundPanel value={c.background ?? EMPTY_BACKGROUND} onChange={c.setBackground} images={c.backgroundImages} />}
        {c.canRulers && (
          <ToolbarBtn onClick={c.toggleRulers} active={c.rulers} title={t('canvas.rulers')}><Ruler size={14} /></ToolbarBtn>
        )}
        {c.rulers && (
          <ToolbarBtn
            onClick={c.toggleGuidesLocked}
            active={c.guidesLocked}
            title={t(c.guidesLocked ? 'canvas.unlockGuides' : 'canvas.lockGuides')}
          >
            {c.guidesLocked ? <Lock size={14} /> : <LockOpen size={14} />}
          </ToolbarBtn>
        )}
        {f.layers && (
          <ToolbarBtn onClick={c.toggleList} active={c.listOpen} title={t('canvas.layers.title')}><Layers size={14} /></ToolbarBtn>
        )}
        {f.export && c.onExport && (
          <ToolbarBtn onClick={c.onExport} title={t('canvas.export')}><ImageDown size={14} /></ToolbarBtn>
        )}
        {end}
      </div>
    </div>
  );
}

/**
 * The tools in a column over the stage's left edge, like the paint mode's:
 * selecting, then what each type can add (each type a group). A picked tool
 * draws its element on the stage and hands back to selecting.
 */
export function CanvasToolRail({ controller: c }: { controller: CanvasController }) {
  const { t } = useTranslation();
  const groups = Object.values(c.types).filter((type) => type.additions?.length);
  /** The tool whose choice (`picker`) is open beside the column. */
  const [picking, setPicking] = useState<{ type: string; key: string } | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  useOutsideClick(!!picking, () => setPicking(null), { refs: [railRef], escape: true });
  const open = picking && groups.find((type) => type.type === picking.type)?.additions?.find((a) => a.key === picking.key);
  const Picker = open ? open.picker : undefined;
  const label = (title: string, shortcut?: string) => (shortcut ? `${title} (${shortcut.toUpperCase()})` : title);
  return (
    <ToolRail railRef={railRef} label={t('canvas.tools')}>
      <ToolRailGroup>
        <ToolbarBtn onClick={() => c.setTool(null)} active={!c.tool} title={label(t('editor.paint.tools.select'), 'v')}>
          <MousePointer2 size={15} />
        </ToolbarBtn>
      </ToolRailGroup>
      {c.insertImage && (
        <ToolRailGroup divider>
          <ToolbarBtn onClick={() => { c.setTool(null); c.insertImage!(); }} title={t('canvas.insertImage')}>
            <ImagePlus size={15} />
          </ToolbarBtn>
        </ToolRailGroup>
      )}
      {groups.map((type) => (
        <ToolRailGroup key={type.type} divider>
          {type.additions!.map((addition) => (
            <ToolbarBtn
              key={addition.key}
              onClick={() => {
                if (addition.picker) setPicking((p) => (p?.type === type.type && p.key === addition.key ? null : { type: type.type, key: addition.key }));
                else c.setTool({ type: type.type, key: addition.key });
              }}
              active={c.tool?.type === type.type && c.tool.key === addition.key}
              title={label(addition.label(t), addition.shortcut)}
            >
              {addition.icon}
            </ToolbarBtn>
          ))}
        </ToolRailGroup>
      ))}
      {picking && Picker && (
        <div className="editor-selection-menu canvas-rail-picker">
          <Picker onPicked={() => { c.setTool(picking); setPicking(null); }} />
        </div>
      )}
    </ToolRail>
  );
}

/** Zoom out, the level (a click fits the view), zoom in: a small bar in the stage's corner. */
export function CanvasZoom({ controller: c }: { controller: CanvasController }) {
  const { t } = useTranslation();
  return (
    <div className="editor-toolbar canvas-zoom">
      <ToolbarBtn onClick={c.zoomOut} title={t('canvas.zoomOut')}><ZoomOut size={14} /></ToolbarBtn>
      <ToolbarBtn onClick={c.fit} title={t('canvas.fit')}>
        <span className="editor-toolbar-btn-label tabular-nums">{Math.round(c.zoom * 100)}%</span>
      </ToolbarBtn>
      <ToolbarBtn onClick={c.zoomIn} title={t('canvas.zoomIn')}><ZoomIn size={14} /></ToolbarBtn>
    </div>
  );
}
