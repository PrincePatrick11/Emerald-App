import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Circle, Eraser, Lasso, Layers, Minus, Move, MousePointer2, PenTool, Pipette, Redo, Square, Trash2, Undo, type LucideIcon,
} from 'lucide-react';
import { PAINT_SIZE_MAX, PAINT_SIZE_MIN } from '../../../../lib/paint/document';
import PopoverButton from '../../shared/PopoverButton';
import { ToolbarBtn, ToolbarDivider, ToolbarGroup } from '../../shared/toolbarParts';
import LayerPanel from './LayerPanel';
import type { PaintFeatures } from './features';
import type { EditorTool, PaintControls } from './usePaintTools';

interface ToolDef {
  tool: EditorTool;
  icon: LucideIcon;
  /** The key that picks it while the drawing has the focus. */
  key: string;
}

/** The tools that work on what is drawn, before the ones that draw. */
export const EDIT_TOOL_DEFS: readonly ToolDef[] = [
  { tool: 'select', icon: MousePointer2, key: 'v' },
  { tool: 'lasso', icon: Lasso, key: 'q' },
  { tool: 'move', icon: Move, key: 'm' },
];

export const DRAW_TOOL_DEFS: readonly ToolDef[] = [
  { tool: 'pen', icon: PenTool, key: 'p' },
  { tool: 'line', icon: Minus, key: 'l' },
  { tool: 'ellipse', icon: Circle, key: 'o' },
  { tool: 'rect', icon: Square, key: 'r' },
  { tool: 'eraser', icon: Eraser, key: 'e' },
  { tool: 'picker', icon: Pipette, key: 'i' },
];

export const PAINT_TOOL_DEFS: readonly ToolDef[] = [...EDIT_TOOL_DEFS, ...DRAW_TOOL_DEFS];

/** Is the tool offered with these features? */
export function toolEnabled(tool: EditorTool, features: PaintFeatures): boolean {
  switch (tool) {
    case 'pen': return true;
    case 'eraser': return features.eraser;
    case 'picker': return features.picker;
    case 'select': case 'lasso': case 'move': return features.select;
    default: return features.shapes;
  }
}

/**
 * The canvas editor's bar in the paint mode, in the app's toolbar style
 * (`.editor-toolbar`, shared buttons from `editors/shared/`). It shows what
 * the paint features switch on, in the order of drawing: undo and redo, the
 * tools that select and move, the drawing tools and the picker, colour and
 * size of the brush, the layers, and emptying and leaving the paint mode at
 * the far end.
 */
export default function PaintToolbar({ api, features, palette, end }: {
  api: PaintControls;
  features: PaintFeatures;
  palette: readonly string[];
  /** At the far end, after clearing: leaving the paint mode. */
  end?: ReactNode;
}) {
  const { t } = useTranslation();
  const shortcut = (label: string, key: string) => `${label} (${key.toUpperCase()})`;

  return (
    <div className="editor-toolbar paint-toolbar">
      <ToolbarGroup>
        <ToolbarBtn onClick={api.undo} active={false} disabled={!api.canUndo} title={t('editor.toolbar.undo')}>
          <Undo size={14} />
        </ToolbarBtn>
        <ToolbarBtn onClick={api.redo} active={false} disabled={!api.canRedo} title={t('editor.toolbar.redo')}>
          <Redo size={14} />
        </ToolbarBtn>
      </ToolbarGroup>

      {features.select && (<>
        <ToolbarDivider />
        <ToolbarGroup>
          {EDIT_TOOL_DEFS.filter((d) => toolEnabled(d.tool, features)).map(({ tool, icon: Icon, key }) => (
            <ToolbarBtn
              key={tool}
              onClick={() => api.setTool(tool)}
              active={api.tool === tool}
              title={shortcut(t(`editor.paint.tools.${tool}`), key)}
            >
              <Icon size={14} />
            </ToolbarBtn>
          ))}
        </ToolbarGroup>
      </>)}
      <ToolbarDivider />
      <ToolbarGroup>
        {DRAW_TOOL_DEFS.filter((d) => toolEnabled(d.tool, features)).map(({ tool, icon: Icon, key }) => (
          <ToolbarBtn
            key={tool}
            onClick={() => api.setTool(tool)}
            active={api.tool === tool}
            title={shortcut(t(`editor.paint.tools.${tool}`), key)}
          >
            <Icon size={14} />
          </ToolbarBtn>
        ))}
      </ToolbarGroup>

      <ToolbarDivider />
      <ToolbarGroup>
        <PopoverButton
          icon={<span className="paint-color-chip" style={{ backgroundColor: api.color }} />}
          title={t('editor.paint.color')}
          active={false}
        >
          {(close) => (
            <div className="flex items-center gap-1 px-1">
              {palette.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`editor-color-swatch${api.color === c ? ' editor-color-swatch--active' : ''}`}
                  style={{ background: c }}
                  title={c}
                  onClick={() => { api.setColor(c); close(); }}
                />
              ))}
              {features.customColor && (
                <label className="paint-custom-color" title={t('editor.paint.customColor')}>
                  <input
                    type="color"
                    value={api.color}
                    onChange={(e) => api.setColor(e.target.value.toLowerCase())}
                  />
                </label>
              )}
            </div>
          )}
        </PopoverButton>
        <PopoverButton
          icon={<span className="editor-toolbar-btn-label paint-size-label">{api.size}</span>}
          title={t('editor.paint.size')}
          active={false}
        >
          {() => (
            <div className="paint-size-panel">
              <span className="paint-size-preview">
                <span style={{ width: Math.min(api.size, 40), height: Math.min(api.size, 40), backgroundColor: api.tool === 'eraser' ? undefined : api.color }} />
              </span>
              <input
                type="range"
                min={PAINT_SIZE_MIN}
                max={PAINT_SIZE_MAX}
                value={api.size}
                onChange={(e) => api.setSize(Number(e.target.value))}
                className="paint-size-slider accent-accent"
                aria-label={t('editor.paint.size')}
              />
              <span className="paint-size-value">{api.size}</span>
            </div>
          )}
        </PopoverButton>
      </ToolbarGroup>

      {features.layers && (<>
        <ToolbarDivider />
        <PopoverButton icon={<Layers size={14} />} title={t('editor.paint.layers')} active={api.doc.layers.length > 1}>
          {() => <LayerPanel api={api} />}
        </PopoverButton>
      </>)}

      <div className="editor-toolbar-end">
        {features.clear && (
          <ToolbarBtn onClick={api.clear} active={false} title={t('editor.paint.clear')}>
            <Trash2 size={14} />
          </ToolbarBtn>
        )}
        {end}
      </div>
    </div>
  );
}
