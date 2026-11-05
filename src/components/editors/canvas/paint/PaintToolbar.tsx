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

/** The tools in a column, laid over the drawing's left edge: what works on the drawing, what draws, and the bucket, eraser and picker. */
export function PaintToolRail({ api, features }: { api: PaintControls; features: PaintFeatures }) {
  const { t } = useTranslation();
  const groups = [
    EDIT_TOOL_DEFS,
    DRAW_TOOL_DEFS.filter((d) => d.tool !== 'fill' && d.tool !== 'eraser' && d.tool !== 'picker'),
    DRAW_TOOL_DEFS.filter((d) => d.tool === 'fill' || d.tool === 'eraser' || d.tool === 'picker'),
  ].map((defs) => defs.filter((d) => toolEnabled(d.tool, features))).filter((defs) => defs.length);
  return (
    <div className="editor-toolbar paint-rail" role="toolbar" aria-orientation="vertical" aria-label={t('editor.paint.toolsLabel')}>
      {groups.map((defs, i) => (
        <div key={i} className="paint-rail-group">
          {i > 0 && <div className="paint-rail-divider" />}
          {defs.map(({ tool, icon: Icon, key }) => (
            <ToolbarBtn
              key={tool}
              onClick={() => api.setTool(tool)}
              active={api.tool === tool}
              title={`${t(`editor.paint.tools.${tool}`)} (${key.toUpperCase()})`}
            >
              <Icon size={15} />
            </ToolbarBtn>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * The canvas editor's bar in the paint mode, in the app's toolbar style
 * (`.editor-toolbar`, shared buttons from `editors/shared/`); the tools
 * themselves are in `PaintToolRail`. What is always there keeps its place:
 * undo and redo, the colours and the size slider of the brush (right in the
 * bar, no click to open them), symmetry and the layer
 * panel's switch. What only the picked tool has (filled or outlined, the
 * corners of a polygon or points of a star) comes after them, so showing it
 * moves nothing; emptying and leaving the paint mode are at the far end.
 */
export default function PaintToolbar({ api, features, palette, layersOpen, onToggleLayers, end }: {
  api: PaintControls;
  features: PaintFeatures;
  palette: readonly string[];
  layersOpen: boolean;
  onToggleLayers: () => void;
  /** At the far end, after clearing: leaving the paint mode. */
  end?: ReactNode;
}) {
  const { t } = useTranslation();
  const boxShape = features.shapes && isBoxShape(api.tool);
  const cornered = features.shapes && (api.tool === 'polygon' || api.tool === 'star');

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

      <ToolbarDivider />
      <ToolbarGroup>
        <div className="paint-swatches" role="radiogroup" aria-label={t('editor.paint.color')}>
          {palette.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={api.color === c}
              className={`editor-color-swatch${api.color === c ? ' editor-color-swatch--active' : ''}`}
              style={{ background: c }}
              title={c}
              onClick={() => api.setColor(c)}
            />
          ))}
          {features.customColor && (
            <label
              className={`paint-custom-color${palette.includes(api.color) ? '' : ' paint-custom-color--active'}`}
              title={t('editor.paint.customColor')}
              style={palette.includes(api.color) ? undefined : { background: api.color }}
            >
              <input type="color" value={api.color} onChange={(e) => api.setColor(e.target.value.toLowerCase())} />
            </label>
          )}
        </div>
      </ToolbarGroup>

      <ToolbarDivider />
      <ToolbarGroup>
        <label className="paint-size-inline" title={t('editor.paint.size')}>
          <span className="paint-size-dot">
            <span style={{ width: Math.max(2, Math.min(api.size, 18)), height: Math.max(2, Math.min(api.size, 18)), backgroundColor: api.tool === 'eraser' ? undefined : api.color }} />
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
        </label>
      </ToolbarGroup>

      {(features.symmetry || features.layers) && (<>
        <ToolbarDivider />
        <ToolbarGroup>
          {features.symmetry && (
            <PopoverButton
              icon={<FlipHorizontal2 size={14} />}
              title={t('editor.paint.symmetry.title')}
              active={api.symmetry.kind !== 'off'}
            >
              {(close) => <SymmetryPanel value={api.symmetry} onChange={api.setSymmetry} close={close} />}
            </PopoverButton>
          )}
          {features.layers && (
            <ToolbarBtn onClick={onToggleLayers} active={layersOpen} title={t('editor.paint.layers')}>
              <Layers size={14} />
              {api.doc.layers.length > 1 && <span className="editor-toolbar-btn-label tabular-nums">{api.doc.layers.length}</span>}
            </ToolbarBtn>
          )}
        </ToolbarGroup>
      </>)}

      {boxShape && (<>
        <ToolbarDivider />
        <ToolbarGroup>
          <ToolbarBtn
            onClick={() => api.setFilled(!api.filled)}
            active={api.filled}
            title={t(api.filled ? 'editor.paint.filled' : 'editor.paint.outlined')}
          >
            {api.filled ? <Square size={14} fill="currentColor" /> : <SquareDashed size={14} />}
          </ToolbarBtn>
          {cornered && (
            <Stepper
              value={api.sides}
              min={MIN_SIDES}
              max={MAX_SIDES}
              onChange={api.setSides}
              label={t(api.tool === 'star' ? 'editor.paint.points' : 'editor.paint.corners')}
            />
          )}
        </ToolbarGroup>
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
