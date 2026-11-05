import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Circle, Eraser, FlipHorizontal2, Hexagon, Lasso, Layers, Minus, Move, MousePointer2, PaintBucket, PenTool, Pipette, Redo,
  Square, SquareDashed, Star, Trash2, Undo, type LucideIcon,
} from 'lucide-react';
import {
  isBoxShape, MAX_RAYS, MAX_SIDES, MIN_RAYS, MIN_SIDES, PAINT_SIZE_MAX, PAINT_SIZE_MIN, type Symmetry,
} from '../../../../lib/paint/document';
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
  { tool: 'polygon', icon: Hexagon, key: 'g' },
  { tool: 'star', icon: Star, key: 's' },
  { tool: 'fill', icon: PaintBucket, key: 'b' },
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
    case 'fill': return features.fill;
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

      {((features.shapes && isBoxShape(api.tool)) || features.symmetry) && (<>
        <ToolbarDivider />
        <ToolbarGroup>
          {features.shapes && isBoxShape(api.tool) && (
            <ToolbarBtn
              onClick={() => api.setFilled(!api.filled)}
              active={api.filled}
              title={t(api.filled ? 'editor.paint.filled' : 'editor.paint.outlined')}
            >
              {api.filled ? <Square size={14} fill="currentColor" /> : <SquareDashed size={14} />}
            </ToolbarBtn>
          )}
          {features.shapes && (api.tool === 'polygon' || api.tool === 'star') && (
            <Stepper
              value={api.sides}
              min={MIN_SIDES}
              max={MAX_SIDES}
              onChange={api.setSides}
              label={t(api.tool === 'star' ? 'editor.paint.points' : 'editor.paint.corners')}
            />
          )}
          {features.symmetry && (
            <PopoverButton
              icon={<FlipHorizontal2 size={14} />}
              title={t('editor.paint.symmetry.title')}
              active={api.symmetry.kind !== 'off'}
            >
              {(close) => <SymmetryPanel value={api.symmetry} onChange={api.setSymmetry} close={close} />}
            </PopoverButton>
          )}
        </ToolbarGroup>
      </>)}

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

/** A small number with a minus and a plus, for the corners of a polygon or the points of a star. */
function Stepper({ value, min, max, onChange, label }: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
}) {
  return (
    <span className="paint-stepper" title={label}>
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label={`${label} −`}>−</button>
      <span className="paint-stepper-value" aria-label={label}>{value}</span>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label={`${label} +`}>+</button>
    </span>
  );
}

/** Off, mirrored, four quarters, or radial with its number of rays. */
function SymmetryPanel({ value, onChange, close }: { value: Symmetry; onChange: (value: Symmetry) => void; close: () => void }) {
  const { t } = useTranslation();
  const rays = value.kind === 'radial' ? value.rays : 6;
  const options: { kind: Symmetry['kind']; label: string }[] = [
    { kind: 'off', label: t('editor.paint.symmetry.off') },
    { kind: 'mirror', label: t('editor.paint.symmetry.mirror') },
    { kind: 'quad', label: t('editor.paint.symmetry.quad') },
    { kind: 'radial', label: t('editor.paint.symmetry.radial') },
  ];
  return (
    <div className="paint-symmetry">
      {options.map((o) => (
        <button
          key={o.kind}
          type="button"
          className={`paint-symmetry-option${value.kind === o.kind ? ' paint-symmetry-option--active' : ''}`}
          onClick={() => {
            onChange(o.kind === 'radial' ? { kind: 'radial', rays } : { kind: o.kind } as Symmetry);
            if (o.kind !== 'radial') close();
          }}
        >
          {o.label}
        </button>
      ))}
      {value.kind === 'radial' && (
        <div className="paint-symmetry-rays">
          <span>{t('editor.paint.symmetry.rays')}</span>
          <Stepper value={rays} min={MIN_RAYS} max={MAX_RAYS} onChange={(n) => onChange({ kind: 'radial', rays: n })} label={t('editor.paint.symmetry.rays')} />
        </div>
      )}
    </div>
  );
}
