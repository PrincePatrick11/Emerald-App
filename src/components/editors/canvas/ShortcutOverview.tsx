import { useTranslation } from 'react-i18next';
import Modal from '../../ui/Modal';
import { PAINT_TOOL_DEFS, toolEnabled } from './paint/PaintToolbar';
import type { PaintFeatures } from './paint/features';
import type { CanvasFeatures } from './features';
import type { CanvasTypes } from './types';
import { altKey, deleteKey, modKey, shiftKey, keys } from './shortcuts';

/** A row: the keys or gestures (each one chip, alternatives side by side) and what they do. */
interface Row { keys: string[]; label: string }
interface Section { title: string; rows: Row[] }

const ARROWS = '← ↑ → ↓';

/**
 * Every key and gesture of the canvas editor in one window, opened with `?`
 * or the bar's button: in the paint mode the drawing's, otherwise the
 * stage's, each only where its feature is on.
 */
export default function ShortcutOverview({ painting, features, paintFeatures, types, canLeavePaint, onClose }: {
  painting: boolean;
  features: CanvasFeatures;
  paintFeatures: PaintFeatures;
  types: CanvasTypes;
  /** The paint mode can be left (Escape), not fixed to one drawing. */
  canLeavePaint: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const k = (name: string) => t(`canvas.keys.${name}`);
  const with_ = (modifier: string, gesture: string) => `${modifier} ${k(gesture)}`;
  const row = (chips: (string | false)[], label: string): Row => ({ keys: chips.filter((c): c is string => !!c), label });

  const view: Section = {
    title: k('view'),
    rows: [
      features.zoom && row([k('scroll'), with_(k('space'), 'drag'), k('middleDrag')], k('pan')),
      features.zoom && row([with_(modKey(), 'scroll'), k('pinch')], k('zoom')),
      features.zoom && row([keys('0')], t('canvas.fit')),
      row(['?'], k('title')),
    ].filter((r): r is Row => !!r),
  };
  const history: Row[] = features.history
    ? [row([keys('Z')], k('undo')), row([keys('Z', true, true), keys('Y')], k('redo'))]
    : [];

  let sections: Section[];
  if (painting) {
    const select = paintFeatures.select;
    sections = [
      {
        title: t('canvas.tools'),
        rows: PAINT_TOOL_DEFS.filter((d) => toolEnabled(d.tool, paintFeatures))
          .map((d) => row([d.key.toUpperCase()], t(`editor.paint.tools.${d.tool}`))),
      },
      {
        title: k('drawing'),
        rows: [
          row(['[', ']'], k('brushSize')),
          paintFeatures.picker && row([altKey()], k('pickWhileHeld')),
          row([with_(shiftKey(), 'drag')], k('straight')),
          paintFeatures.shapes && row([with_(altKey(), 'drag')], k('fromCentre')),
          ...history,
        ].filter((r): r is Row => !!r),
      },
      ...(select ? [{
        title: k('selection'),
        rows: [
          row([with_(shiftKey(), 'click')], k('addToSelection')),
          row([keys('A')], t('menu.selectAll')),
          row([keys('C')], t('menu.copy')),
          row([keys('X')], t('menu.cut')),
          row([keys('V')], t('menu.paste')),
          row([keys('D')], t('canvas.duplicate')),
          row([deleteKey()], t('canvas.remove')),
          row([ARROWS], k('nudge')),
          row([`${shiftKey()} ${ARROWS}`], k('nudgeMore')),
          row([with_(shiftKey(), 'drag')], k('moveStraight')),
          row([with_(shiftKey(), 'turn')], k('turnSteps')),
          row(['Esc'], canLeavePaint ? k('deselectOrLeave') : k('deselect')),
        ],
      }] : []),
      view,
    ];
  } else {
    const additions = Object.values(types).flatMap((type) => type.additions ?? []).filter((a) => a.shortcut);
    sections = [
      ...(additions.length ? [{
        title: t('canvas.tools'),
        rows: [
          row(['V'], t('editor.paint.tools.select')),
          ...additions.map((a) => row([a.shortcut!.toUpperCase()], a.label(t))),
          row(['Esc'], k('dropTool')),
        ],
      }] : []),
      {
        title: k('selection'),
        rows: [
          row([with_(shiftKey(), 'click'), with_(modKey(), 'click')], k('addToSelection')),
          row([k('dragEmpty')], k('frame')),
          row([k('doubleClick')], k('member')),
          row(['↵'], k('edit')),
          row([keys('A')], t('menu.selectAll')),
          row(['Esc'], k('deselect')),
          row([k('rightClick')], k('menu')),
        ],
      },
      {
        title: k('editing'),
        rows: [
          row([keys('C')], t('menu.copy')),
          row([keys('X')], t('menu.cut')),
          row([keys('V')], t('menu.paste')),
          row([keys('D')], t('canvas.duplicate')),
          row([deleteKey()], t('canvas.remove')),
          row([ARROWS], k('nudge')),
          row([`${shiftKey()} ${ARROWS}`], k('nudgeMore')),
          features.group && row([keys('G')], t('canvas.menu.group')),
          features.group && row([keys('G', true, true)], t('canvas.menu.ungroup')),
          features.arrange && row([keys(']')], t('canvas.forward')),
          features.arrange && row([keys('[')], t('canvas.backward')),
          features.arrange && row([keys(']', true, true)], t('canvas.toFront')),
          features.arrange && row([keys('[', true, true)], t('canvas.toBack')),
          ...history,
        ].filter((r): r is Row => !!r),
      },
      {
        title: k('whileDragging'),
        rows: [
          additions.length > 0 && row([with_(shiftKey(), 'drag')], k('square')),
          row([with_(shiftKey(), 'scale')], k('keepProportions')),
          row([with_(altKey(), 'scale')], k('fromCentre')),
          features.guides && row([with_(altKey(), 'drag')], k('noSnap')),
        ].filter((r): r is Row => !!r),
      },
      view,
    ];
  }

  return (
    <Modal title={k('title')} onClose={onClose} widthClassName="w-[760px] max-w-full" maxHeightClassName="max-h-[85vh]">
      <div className="canvas-keys">
        {sections.filter((s) => s.rows.length).map((section) => (
          <section key={section.title} className="canvas-keys-section">
            <h3>{section.title}</h3>
            {section.rows.map((r) => (
              <div key={r.label + r.keys.join()} className="canvas-keys-row">
                <span>{r.label}</span>
                <span className="canvas-keys-chips">
                  {r.keys.map((key) => <kbd key={key}>{key}</kbd>)}
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  );
}
