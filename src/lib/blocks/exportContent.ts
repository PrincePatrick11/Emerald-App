import { isBlockHidden } from './blockAttrs';
import { parseBlocks, serializeBlocks } from './blockHtml';
import { todayIso, withoutConcealed } from './sigil';
import { BLOCK_ATTR } from './types';

/**
 * Was ein Export von einem Eintrag zeigen darf. Bis Phase 6 (Serializer je
 * Blocktyp) geht der gespeicherte Fallback der Blöcke hinaus — also muss
 * vorher weg, was im Lesemodus fehlt:
 * - ausgeblendete Blöcke (das Auge),
 * - Rechner und Zeichnung einer geladenen, noch verborgenen Sigille.
 */
export function contentForExport(content: string, today = todayIso()): string {
  const visible = withoutConcealed(content, today);
  if (!visible.includes(BLOCK_ATTR.hidden)) return visible;
  const blocks = parseBlocks(visible);
  const shown = blocks.filter((b) => !isBlockHidden(b));
  return shown.length === blocks.length ? visible : serializeBlocks(shown);
}
