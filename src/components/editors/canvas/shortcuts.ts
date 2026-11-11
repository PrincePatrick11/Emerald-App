import i18n from '../../../i18n';
import { isMacOS } from '../../../lib/platform';

/** A modifier by its name on this keyboard: the symbol on macOS, the word on the key elsewhere (`Strg`, `Maj`, …). */
function named(mac: string, key: 'shift' | 'ctrl' | 'alt' | 'delete'): string {
  return isMacOS ? mac : i18n.t(`canvas.keyNames.${key}`);
}

/** A key with the platform's modifiers, as menus and the overview show it: `⇧⌘G` on macOS, `Ctrl+Shift+G` elsewhere. */
export function keys(key: string, mod = true, shift = false): string {
  if (isMacOS) return `${shift ? '⇧' : ''}${mod ? '⌘' : ''}${key}`;
  return [mod && modKey(), shift && shiftKey(), key].filter(Boolean).join('+');
}

/** The modifier keys alone, by their platform names. */
export const shiftKey = () => named('⇧', 'shift');
export const altKey = () => named('⌥', 'alt');
export const modKey = () => named('⌘', 'ctrl');
export const deleteKey = () => named('⌫', 'delete');
