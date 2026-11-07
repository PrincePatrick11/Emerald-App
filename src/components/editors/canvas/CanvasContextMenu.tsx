import type { TFunction } from 'i18next';
import {
  BringToFront, ClipboardPaste, Copy, CopyPlus, Eye, EyeOff, Group, Lock, LockOpen, Maximize, MousePointerSquareDashed,
  Ruler, Scissors, SendToBack, Trash2, Ungroup,
} from 'lucide-react';
import type { ContextMenuAction } from '../../ui/ContextMenu';
import { isMacOS } from '../../../lib/platform';
import type { ArrangeMove } from './canvasActions';
import type { CanvasFeatures } from './features';
import type { CanvasElement } from './types';

/** A key with the platform's modifiers, as the menu shows it: `⇧⌘G` on macOS, `Ctrl+Shift+G` elsewhere. */
function keys(key: string, mod = true, shift = false): string {
  if (isMacOS) return `${shift ? '⇧' : ''}${mod ? '⌘' : ''}${key}`;
  return [mod && 'Ctrl', shift && 'Shift', key].filter(Boolean).join('+');
}

export interface CanvasMenuContext {
  t: TFunction;
  features: CanvasFeatures;
  /** What the menu acts on: the selection, after the right click picked what was under it. */
  selected: CanvasElement[];
  /** A locked element that was right-clicked; it cannot be selected, only unlocked. */
  locked: CanvasElement | null;
  canPaste: boolean;
  canRulers: boolean;
  rulers: boolean;
  cut: () => void;
  copy: () => void;
  /** Pastes with the copies' middle where the menu was opened. */
  pasteHere: () => void;
  duplicate: () => void;
  arrange: (move: ArrangeMove) => void;
  group: () => void;
  ungroup: () => void;
  patch: (ids: string[], patch: Partial<Pick<CanvasElement, 'hidden' | 'locked'>>) => void;
  remove: () => void;
  selectAll: () => void;
  fit: () => void;
  toggleRulers: () => void;
}

/**
 * The entries of the canvas editor's right-click menu: on an element what
 * the selection can do, in the order of the bar and the element list; on a
 * locked one only unlocking it; on the empty stage pasting, selecting all
 * and the view. Entries that do not fit the moment are greyed out, not left
 * out, so the menu keeps its shape.
 */
export function canvasMenuActions(c: CanvasMenuContext): ContextMenuAction[] {
  const { t, features } = c;
  if (c.locked) {
    const id = c.locked.id;
    return [{ label: t('canvas.layers.unlock'), icon: <LockOpen size={12} />, onClick: () => c.patch([id], { locked: false }) }];
  }
  const paste: ContextMenuAction = {
    label: t('menu.paste'), icon: <ClipboardPaste size={12} />, shortcut: keys('V'), onClick: c.pasteHere, disabled: !c.canPaste,
  };
  if (!c.selected.length) {
    const actions: ContextMenuAction[] = [
      paste,
      { label: t('menu.selectAll'), icon: <MousePointerSquareDashed size={12} />, shortcut: keys('A'), onClick: c.selectAll },
    ];
    if (features.zoom) actions.push({ label: t('canvas.fit'), icon: <Maximize size={12} />, shortcut: keys('0'), onClick: c.fit, separator: true });
    if (c.canRulers) {
      actions.push({ label: t('canvas.rulers'), icon: <Ruler size={12} />, onClick: c.toggleRulers, separator: !features.zoom, shortcut: c.rulers ? '✓' : undefined });
    }
    return actions;
  }

  const ids = c.selected.map((el) => el.id);
  const editable = c.selected.filter((el) => !el.locked);
  const hidden = c.selected.every((el) => el.hidden);
  const actions: ContextMenuAction[] = [
    { label: t('menu.cut'), icon: <Scissors size={12} />, shortcut: keys('X'), onClick: c.cut, disabled: !editable.length },
    { label: t('menu.copy'), icon: <Copy size={12} />, shortcut: keys('C'), onClick: c.copy },
    paste,
    { label: t('canvas.duplicate'), icon: <CopyPlus size={12} />, shortcut: keys('D'), onClick: c.duplicate },
  ];
  if (features.arrange) {
    actions.push(
      { label: t('canvas.toFront'), icon: <BringToFront size={12} />, shortcut: keys(']', true, true), onClick: () => c.arrange('front'), separator: true, disabled: !editable.length },
      { label: t('canvas.forward'), shortcut: keys(']'), onClick: () => c.arrange('forward'), disabled: !editable.length },
      { label: t('canvas.backward'), shortcut: keys('['), onClick: () => c.arrange('backward'), disabled: !editable.length },
      { label: t('canvas.toBack'), icon: <SendToBack size={12} />, shortcut: keys('[', true, true), onClick: () => c.arrange('back'), disabled: !editable.length },
    );
  }
  if (features.group) {
    actions.push(
      { label: t('canvas.menu.group'), icon: <Group size={12} />, shortcut: keys('G'), onClick: c.group, separator: true, disabled: editable.length < 2 },
      { label: t('canvas.menu.ungroup'), icon: <Ungroup size={12} />, shortcut: keys('G', true, true), onClick: c.ungroup, disabled: !c.selected.some((el) => el.group) },
    );
  }
  actions.push(
    { label: t('canvas.layers.lock'), icon: <Lock size={12} />, onClick: () => c.patch(ids, { locked: true }), separator: true },
    { label: t(hidden ? 'canvas.layers.show' : 'canvas.layers.hide'), icon: hidden ? <Eye size={12} /> : <EyeOff size={12} />, onClick: () => c.patch(ids, { hidden: !hidden }) },
    { label: t('canvas.remove'), icon: <Trash2 size={12} />, shortcut: isMacOS ? '⌫' : 'Del', onClick: c.remove, danger: true, separator: true, disabled: !editable.length },
  );
  return actions;
}
