import { useTranslation } from 'react-i18next';
import { Circle, Hexagon, PaintBucket, Shapes, Square, SquareDashed, Star, Triangle } from 'lucide-react';
import PopoverButton from '../../shared/PopoverButton';
import { ToolbarGroup } from '../../shared/toolbarParts';
import type { CanvasAddition, CanvasElement, CanvasElementType } from '../types';
import { ColorPanel, NumberField, common } from './controlParts';

export const CANVAS_SHAPES = ['rect', 'ellipse', 'triangle', 'star', 'hexagon'] as const;
export type CanvasShape = (typeof CANVAS_SHAPES)[number];

export interface ShapeProps {
  shape: CanvasShape;
  /** `#rrggbb`, or `null` for no fill. */
  fill: string | null;
  /** `#rrggbb`, or `null` for no outline. */
  stroke: string | null;
  strokeWidth: number;
  /** Rounded corners of a rectangle. */
  cornerRadius: number;
}

export type ShapeElement = CanvasElement<ShapeProps>;

export const DEFAULT_FILL = '#d4af37';

/** The outline of a shape in its box, as a path on `ctx`. */
export function shapePath(ctx: CanvasRenderingContext2D, props: Pick<ShapeProps, 'shape' | 'cornerRadius'>, w: number, h: number): void {
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
    case 'star': {
      const points = 5;
      for (let i = 0; i < points * 2; i++) {
        const radius = i % 2 === 0 ? 1 : 0.42;
        const angle = -Math.PI / 2 + (i * Math.PI) / points;
        const px = w / 2 + Math.cos(angle) * (w / 2) * radius;
        const py = h / 2 + Math.sin(angle) * (h / 2) * radius * 1.05 + h * 0.03;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
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

const SHAPE_ICONS: Record<CanvasShape, React.ReactNode> = {
  rect: <Square size={14} />,
  ellipse: <Circle size={14} />,
  triangle: <Triangle size={14} />,
  star: <Star size={14} />,
  hexagon: <Hexagon size={14} />,
};

const additions: CanvasAddition<ShapeProps>[] = CANVAS_SHAPES.map((shape) => ({
  key: shape,
  icon: SHAPE_ICONS[shape],
  label: (t) => t(`canvas.shape.${shape}`),
  create: (_centre, artboard) => {
    const side = Math.round(Math.min(artboard.width, artboard.height) * 0.22);
    return {
      width: shape === 'rect' ? Math.round(side * 1.4) : side,
      height: side,
      props: { shape, fill: DEFAULT_FILL, stroke: null, strokeWidth: Math.max(2, Math.round(side / 40)), cornerRadius: 0 },
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
    </ToolbarGroup>
  );
}

export const shapeType: CanvasElementType<ShapeProps> = {
  type: 'shape',
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
  additionsGroup: { icon: <Shapes size={14} />, label: (t) => t('canvas.addShape') },
  controls: ShapeControls,
};
