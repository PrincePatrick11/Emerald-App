import { isMacOS } from '../../../lib/platform';

/** A key with the platform's modifiers, as menus and the overview show it: `⇧⌘G` on macOS, `Ctrl+Shift+G` elsewhere. */
export function keys(key: string, mod = true, shift = false): string {
  if (isMacOS) return `${shift ? '⇧' : ''}${mod ? '⌘' : ''}${key}`;
  return [mod && 'Ctrl', shift && 'Shift', key].filter(Boolean).join('+');
}

/** The modifier keys alone, by their platform names. */
export const SHIFT_KEY = isMacOS ? '⇧' : 'Shift';
export const ALT_KEY = isMacOS ? '⌥' : 'Alt';
export const MOD_KEY = isMacOS ? '⌘' : 'Ctrl';
export const DELETE_KEY = isMacOS ? '⌫' : 'Del';
