import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlignHorizontalDistributeCenter, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart, AlignVerticalDistributeCenter, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart, ArrowDown, ArrowUp, BringToFront, Copy, Group, ImageDown, Layers, Layers2, Redo2, SendToBack, Trash2, Undo2,
  Ungroup, ZoomIn, ZoomOut,
} from 'lucide-react';
import { ToolbarBtn, ToolbarDivider, ToolbarGroup } from '../shared/toolbarParts';
import PopoverButton from '../shared/PopoverButton';
import type { CanvasController } from './CanvasEditor';
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
 * The canvas editor's bar. Like the text editor's, it shows what the canvas editor can do:
 * in the order of working, undo; what can be added (each registered type's
 * additions, several of one type behind one button); the controls of the
 * selected elements' types; where the selection sits (stacking, aligning),
 * grouping, duplicating and removing; and at the far end the element list
 * and saving as an image. Zoom
 * sits on the stage itself (`CanvasZoom`), so the bar stays one row.
 */
export default function CanvasToolbar({ controller: c, end }: { controller: CanvasController; end?: ReactNode }) {
  const { t } = useTranslation();
  const f = c.features;
  const editable = c.selected.filter((el) => !el.locked);
  const hasSelection = editable.length > 0;
  const types = Object.values(c.types);
  const adders = types.filter((type) => type.additions?.length);
  const selectedTypes = types.filter((type) => type.controls && editable.some((el) => el.type === type.type));
  const grouped = c.selected.some((el) => el.group);

  return (
    <div className="editor-toolbar canvas-toolbar">
      {f.history && (<>
        <ToolbarGroup>
          <ToolbarBtn onClick={c.undo} active={false} disabled={!c.canUndo} title={t('editor.toolbar.undo')}><Undo2 size={14} /></ToolbarBtn>
          <ToolbarBtn onClick={c.redo} active={false} disabled={!c.canRedo} title={t('editor.toolbar.redo')}><Redo2 size={14} /></ToolbarBtn>
        </ToolbarGroup>
        <ToolbarDivider />
      </>)}

      {adders.length > 0 && (<>
        <ToolbarGroup>
          {adders.map((type) => {
            const additions = type.additions!;
            if (additions.length === 1 || !type.additionsGroup) {
              return additions.map((addition) => (
                <ToolbarBtn key={`${type.type}:${addition.key}`} onClick={() => c.add(type.type, addition)} active={false} title={addition.label(t)}>
                  {addition.icon}
                </ToolbarBtn>
              ));
            }
            return (
              <PopoverButton key={type.type} icon={type.additionsGroup.icon} title={type.additionsGroup.label(t)} active={false}>
                {(close) => (
                  <ToolbarGroup>
                    {additions.map((addition) => (
                      <ToolbarBtn key={addition.key} onClick={() => { c.add(type.type, addition); close(); }} active={false} title={addition.label(t)}>
                        {addition.icon}
                      </ToolbarBtn>
                    ))}
                  </ToolbarGroup>
                )}
              </PopoverButton>
            );
          })}
        </ToolbarGroup>
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
          {f.arrange && (
            <PopoverButton icon={<Layers2 size={14} />} title={t('canvas.arrange')} active={false}>
              {(close) => (
                <ToolbarGroup>
                  <ToolbarBtn onClick={() => { c.arrange('front'); close(); }} active={false} title={t('canvas.toFront')}><BringToFront size={14} /></ToolbarBtn>
                  <ToolbarBtn onClick={() => c.arrange('forward')} active={false} title={t('canvas.forward')}><ArrowUp size={14} /></ToolbarBtn>
                  <ToolbarBtn onClick={() => c.arrange('backward')} active={false} title={t('canvas.backward')}><ArrowDown size={14} /></ToolbarBtn>
                  <ToolbarBtn onClick={() => { c.arrange('back'); close(); }} active={false} title={t('canvas.toBack')}><SendToBack size={14} /></ToolbarBtn>
                </ToolbarGroup>
              )}
            </PopoverButton>
          )}
          {f.align && (
            <PopoverButton
              icon={<AlignHorizontalJustifyCenter size={14} />}
              title={editable.length > 1 ? t('canvas.alignSelection') : t('canvas.alignArtboard')}
              active={false}
            >
              {() => (
                <ToolbarGroup>
                  {(Object.keys(ALIGN_ICONS) as AlignEdge[]).map((edge) => (
                    <ToolbarBtn key={edge} onClick={() => c.align(edge)} active={false} title={t(`canvas.align.${edge}`)}>
                      {ALIGN_ICONS[edge]}
                    </ToolbarBtn>
                  ))}
                  {editable.length > 2 && (<>
                    <ToolbarDivider />
                    <ToolbarBtn onClick={() => c.distribute('horizontal')} active={false} title={t('canvas.distributeHorizontal')}><AlignHorizontalDistributeCenter size={14} /></ToolbarBtn>
                    <ToolbarBtn onClick={() => c.distribute('vertical')} active={false} title={t('canvas.distributeVertical')}><AlignVerticalDistributeCenter size={14} /></ToolbarBtn>
                  </>)}
                </ToolbarGroup>
              )}
            </PopoverButton>
          )}
          {f.group && editable.length > 1 && (
            <ToolbarBtn onClick={c.group} active={false} title={t('canvas.layers.groupAction')}><Group size={14} /></ToolbarBtn>
          )}
          {f.group && grouped && (
            <ToolbarBtn onClick={c.ungroup} active={false} title={t('canvas.layers.ungroup')}><Ungroup size={14} /></ToolbarBtn>
          )}
          <ToolbarBtn onClick={c.duplicate} active={false} title={t('canvas.duplicate')}><Copy size={14} /></ToolbarBtn>
          <ToolbarBtn onClick={c.removeSelected} active={false} title={t('canvas.remove')}><Trash2 size={14} /></ToolbarBtn>
        </ToolbarGroup>
      )}

      <div className="editor-toolbar-end">
        {f.layers && (
          <ToolbarBtn onClick={c.toggleList} active={c.listOpen} title={t('canvas.layers.title')}><Layers size={14} /></ToolbarBtn>
        )}
        {f.export && c.onExport && (
          <ToolbarBtn onClick={c.onExport} active={false} title={t('canvas.export')}><ImageDown size={14} /></ToolbarBtn>
        )}
        {end}
      </div>
    </div>
  );
}

/** Zoom out, the level (a click fits the view), zoom in: a small bar in the stage's corner. */
export function CanvasZoom({ controller: c }: { controller: CanvasController }) {
  const { t } = useTranslation();
  return (
    <div className="editor-toolbar canvas-zoom">
      <ToolbarBtn onClick={c.zoomOut} active={false} title={t('canvas.zoomOut')}><ZoomOut size={14} /></ToolbarBtn>
      <ToolbarBtn onClick={c.fit} active={false} title={t('canvas.fit')}>
        <span className="editor-toolbar-btn-label tabular-nums">{Math.round(c.zoom * 100)}%</span>
      </ToolbarBtn>
      <ToolbarBtn onClick={c.zoomIn} active={false} title={t('canvas.zoomIn')}><ZoomIn size={14} /></ToolbarBtn>
    </div>
  );
}
