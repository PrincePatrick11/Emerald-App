import { useTranslation } from 'react-i18next';
import { Circle, Hexagon, PaintBucket, Square, SquareDashed, Star } from 'lucide-react';
import PopoverButton from '../../shared/PopoverButton';
import { ToolbarGroup, ToolbarStepper } from '../../shared/toolbarParts';
import { MAX_SIDES, MIN_SIDES } from '../../../../lib/paint/document';
import { polygonPoints } from '../paint/render';
import type { CanvasAddition, CanvasElement, CanvasElementType } from '../types';
import { ColorPanel, NumberField, common } from './controlParts';

/** The shapes that can be added, the same as the paint mode's. */
export const CANVAS_SHAPES = ['rect', 'ellipse', 'polygon', 'star'] as const;
/** Besides those, the triangle and hexagon of older altars: polygons of three and six corners. */
export type CanvasShape = (typeof CANVAS_SHAPES)[number] | 'triangle' | 'hexagon';

export interface ShapeProps {
  shape: CanvasShape;
  /** `#rrggbb`, or `null` for no fill. */
  fill: string | null;
  /** `#rrggbb`, or `null` for no outline. */
  stroke: string | null;
  strokeWidth: number;
  /** Rounded corners of a rectangle. */
  cornerRadius: number;
  /** The corners of a polygon or the points of a star, `MIN_SIDES`–`MAX_SIDES`. */
  sides?: number;
}

export type ShapeElement = CanvasElement<ShapeProps>;

export const DEFAULT_FILL = '#d4af37';

/** A polygon's corners or a star's points, with the defaults where none are stored. */
export function shapeSides(props: Pick<ShapeProps, 'shape' | 'sides'>): number | null {
  switch (props.shape) {
    case 'polygon': return props.sides ?? 6;
    case 'star': return props.sides ?? 5;
    case 'triangle': return 3;
    case 'hexagon': return 6;
    default: return null;
  }
}

/** The outline of a shape in its box, as a path on `ctx`. */
export function shapePath(ctx: CanvasRenderingContext2D, props: Pick<ShapeProps, 'shape' | 'cornerRadius' | 'sides'>, w: number, h: number): void {
  ctx.beginPath();
  switch (props.shape) {
    case 'rect': {
      const r = Math.max(0, Math.min(props.cornerRadius, w / 2, h / 2));
      if (r > 0) ctx.roundRect(0, 0, w, h, r);
      else ctx.rect(0, 0, w, h);
      break;
    }
    case 'ellipse':
      ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      break;
    case 'triangle':
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      break;
    case 'polygon':
    case 'star':
      // The paint mode's polygons and stars, in the box.
      polygonPoints(props.shape, shapeSides(props)!, w / 2, h / 2, w / 2, h / 2).forEach(([px, py], i) => {
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      break;
    case 'hexagon':
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3;
        const px = w / 2 + Math.cos(angle) * (w / 2);
        const py = h / 2 + Math.sin(angle) * (h / 2);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
  }
}

const SHAPE_ICONS: Record<(typeof CANVAS_SHAPES)[number], React.ReactNode> = {
  rect: <Square size={14} />,
  ellipse: <Circle size={14} />,
  polygon: <Hexagon size={14} />,
  star: <Star size={14} />,
};

const SHAPE_KEYS: Record<(typeof CANVAS_SHAPES)[number], string> = { rect: 'r', ellipse: 'o', polygon: 'g', star: 's' };

const additions: CanvasAddition<ShapeProps>[] = CANVAS_SHAPES.map((shape) => ({
  key: shape,
  icon: SHAPE_ICONS[shape],
  shortcut: SHAPE_KEYS[shape],
  label: (t) => t(`canvas.shape.${shape}`),
  create: (_centre, artboard) => {
    const side = Math.round(Math.min(artboard.width, artboard.height) * 0.22);
    return {
      width: shape === 'rect' ? Math.round(side * 1.4) : side,
      height: side,
      props: {
        shape, fill: DEFAULT_FILL, stroke: null, strokeWidth: Math.max(2, Math.round(side / 40)), cornerRadius: 0,
        ...(shape === 'polygon' || shape === 'star' ? { sides: shapeSides({ shape }) ?? undefined } : {}),
      },
    };
  },
}));

function ShapeControls({ elements, update }: {
  elements: ShapeElement[];
  update: (patch: (el: ShapeElement) => Partial<ShapeElement> | null) => void;
}) {
  const { t } = useTranslation();
  const set = (props: Partial<ShapeProps>) => update((el) => ({ props: { ...el.props, ...props } }));
  const fill = common(elements, (el) => el.props.fill);
  const stroke = common(elements, (el) => el.props.stroke);
  // Corners for polygons (a triangle or hexagon becomes one), points for stars, when all selected are one of them.
  const cornered = elements.every((el) => el.props.shape !== 'star' && shapeSides(el.props) !== null);
  const starred = elements.every((el) => el.props.shape === 'star');
  const sides = common(elements, (el) => shapeSides(el.props));
  return (
    <ToolbarGroup>
      <PopoverButton icon={<PaintBucket size={14} style={fill ? { color: fill } : undefined} />} title={t('canvas.fill')} active={false}>
        {(close) => <ColorPanel value={fill} allowNone onPick={(color) => { set({ fill: color }); close(); }} />}
      </PopoverButton>
      <PopoverButton icon={<SquareDashed size={14} style={stroke ? { color: stroke } : undefined} />} title={t('canvas.outline')} active={false}>
        {(close) => (
          <div className="canvas-panel">
            <ColorPanel value={stroke} allowNone onPick={(color) => { set({ stroke: color }); if (!color) close(); }} />
            <NumberField
              label={t('canvas.outlineWidth')}
              value={common(elements, (el) => el.props.strokeWidth)}
              min={0}
              max={80}
              onChange={(value) => set({ strokeWidth: value })}
            />
            {elements.every((el) => el.props.shape === 'rect') && (
              <NumberField
                label={t('canvas.cornerRadius')}
                value={common(elements, (el) => el.props.cornerRadius)}
                min={0}
                max={400}
                onChange={(value) => set({ cornerRadius: value })}
              />
            )}
          </div>
        )}
      </PopoverButton>
      {(cornered || starred) && (
        <ToolbarStepper
          value={sides ?? (starred ? 5 : 6)}
          min={MIN_SIDES}
          max={MAX_SIDES}
          onChange={(n) => update((el) => ({ props: { ...el.props, shape: starred ? 'star' : 'polygon', sides: n } }))}
          label={t(starred ? 'editor.paint.points' : 'editor.paint.corners')}
        />
      )}
    </ToolbarGroup>
  );
}

export const shapeType: CanvasElementType<ShapeProps> = {
  type: 'shape',
  label: (el, t) => t(`canvas.shape.${el.props.shape}`),
  handles: 'all',
  draw: (ctx, el) => {
    const p = el.props;
    shapePath(ctx, p, el.width, el.height);
    if (p.fill) {
      ctx.fillStyle = p.fill;
      ctx.fill();
    }
    if (p.stroke && p.strokeWidth > 0) {
      ctx.strokeStyle = p.stroke;
      ctx.lineWidth = p.strokeWidth;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  },
  scaled: (el, sx, sy) => ({
    props: { ...el.props, strokeWidth: el.props.strokeWidth * Math.sqrt(sx * sy), cornerRadius: el.props.cornerRadius * Math.min(sx, sy) },
  }),
  additions,
  controls: ShapeControls,
};
