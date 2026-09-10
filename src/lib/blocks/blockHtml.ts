import { escapeHtml } from '../internalLinkHtml';
import { generateId } from '../helpers';
import { TEXT_BLOCK_TYPE, type BlockInstance } from './types';

/**
 * Das Blockformat im gespeicherten `content` — Lesen und Schreiben.
 *
 * Ein Eintrag ist eine Folge von Blöcken; jeder steht als
 * `<section data-block="<typ>" data-block-id="<id>" …>inneres HTML</section>`
 * auf oberster Ebene des HTML. Drei Regeln tragen das Format:
 *
 * 1. Inhalt AUSSERHALB einer Block-Section ist Text. Altinhalt ohne jeden
 *    Wrapper ist damit ein einziger Textblock, und was Importe oder Migrationen
 *    als rohes HTML anhängen, wird zu einem weiteren Textblock — bestehende
 *    Einträge brauchen keine Migration.
 * 2. Ein einzelner Textblock ohne weitere Attribute wird OHNE Wrapper
 *    geschrieben. Die allermeisten Einträge bleiben so Byte für Byte, was sie
 *    waren; Export, Suche und ältere App-Versionen merken nichts.
 * 3. Block-Sections stehen nur auf oberster Ebene. TipTap kennt keinen
 *    Section-Knoten, im Text eines Blocks steht also keine.
 *
 * Bewusst ohne `DOMParser`, wie `extractInternalLinks`: Migrationen und
 * `scripts/check-blocks.mjs` laufen unter Node. Gelesen wird jedes Tag einmal,
 * quote-bewusst — ein `>` in einem gequoteten Attributwert beendet kein Tag,
 * und ein `</section>` in einem Attributwert oder Kommentar ist keins.
 * Gezählt werden nur `<section>`-Tags, auch gewöhnliche ohne `data-block` (aus
 * einem Import), damit deren End-Tag keinen Block vorzeitig schließt.
 *
 * Bewusst nachsichtig, wo Browser anders parsen würden: `<section data-block …/>`
 * gilt als leerer Block (ein Browser öffnete ein Element), ein gewöhnliches
 * `<section/>` zählt nicht in die Tiefe. Unbekannte benannte Entities in einem
 * Attributwert (`&hellip;`) bleiben stehen und werden beim Zurückschreiben zu
 * `&amp;hellip;` — der Wert selbst ändert sich dabei nicht.
 */

const TAG_RE = /<!--[\s\S]*?-->|<(\/?)([a-z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
const ATTR_RE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
/** Nur `data-*` wird durchgereicht. Alles andere an einer Section hat für das
 *  Format keine Bedeutung und soll auch keine bekommen (`onclick` …). */
const KEPT_ATTR_RE = /^data-[a-z0-9-]+$/;

const ENTITY_RE = /&(#x[0-9a-f]+|#\d+|quot|apos|lt|gt|amp|nbsp);/gi;
const NAMED_ENTITIES: Record<string, string> = {
  quot: '"', apos: "'", lt: '<', gt: '>', amp: '&', nbsp: ' ',
};

function decodeAttr(value: string): string {
  return value.replace(ENTITY_RE, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith('#')) {
      const cp = lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
      return cp <= 0x10ffff ? String.fromCodePoint(cp) : match;
    }
    return NAMED_ENTITIES[lower] ?? match;
  });
}

/** Die Attribute eines Section-Tags — `body` ist alles zwischen Tag-Name und `>`. */
function parseSectionAttrs(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.replace(/\/\s*$/, '').matchAll(ATTR_RE)) {
    const name = m[1].toLowerCase();
    // Wie im Browser gewinnt das erste Vorkommen eines Attributs.
    if (!KEPT_ATTR_RE.test(name) || name in out) continue;
    out[name] = decodeAttr(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

function toBlock(attrs: Record<string, string>, html: string): BlockInstance {
  const { 'data-block': type, 'data-block-id': id, ...rest } = attrs;
  return { id: id || generateId(), type, html, attrs: rest };
}

/**
 * Entschärft `<section`/`</section` im HTML, das ein Editor liefert. TipTap
 * schreibt nie ein echtes Section-Element — ein Treffer steht also immer in
 * einem Attributwert (der Titel eines verlinkten Eintrags im `data-label` eines
 * Chips, ein `alt`-Text). Ältere WebKit-Versionen escapen `<` in Attributwerten
 * nicht; der Parser oben sähe dort ein Block-Tag und risse den Eintrag
 * auseinander. `&lt;` dekodiert im Attribut zum selben Zeichen — verlustfrei.
 */
export function neutralizeSectionTags(html: string): string {
  return html.replace(/<(\/?section)\b/gi, '&lt;$1');
}

export function createTextBlock(html = ''): BlockInstance {
  return { id: generateId(), type: TEXT_BLOCK_TYPE, html, attrs: {} };
}

/** Die Blöcke eines gespeicherten Inhalts, in Reihenfolge. Leerer Inhalt → `[]`. */
export function parseBlocks(html: string): BlockInstance[] {
  const blocks: BlockInstance[] = [];
  if (!html) return blocks;

  let depth = 0;
  let looseFrom = 0;
  let open: { attrs: Record<string, string>; contentFrom: number } | null = null;

  const pushLoose = (to: number) => {
    const loose = html.slice(looseFrom, to);
    if (loose.trim()) blocks.push(createTextBlock(loose));
  };

  for (const m of html.matchAll(TAG_RE)) {
    // Kommentare (kein Tag-Name) und alles außer <section> überspringen.
    if (m[2]?.toLowerCase() !== 'section') continue;
    const tag = m[0];
    const at = m.index!;
    if (m[1] === '/') {
      if (depth === 0) continue; // verirrtes End-Tag — gehört zum losen Text
      depth--;
      if (depth === 0 && open) {
        blocks.push(toBlock(open.attrs, html.slice(open.contentFrom, at)));
        looseFrom = at + tag.length;
        open = null;
      }
      continue;
    }

    const selfClosing = /\/\s*$/.test(m[3]);
    if (depth === 0) {
      const attrs = parseSectionAttrs(m[3]);
      if (attrs['data-block']) {
        pushLoose(at);
        if (selfClosing) {
          blocks.push(toBlock(attrs, ''));
          looseFrom = at + tag.length;
          continue;
        }
        open = { attrs, contentFrom: at + tag.length };
      }
    }
    if (!selfClosing) depth++;
  }

  // Ein nie geschlossener Block behält alles bis zum Ende — lieber zu viel im
  // Block als verlorene Daten.
  if (open) blocks.push(toBlock(open.attrs, html.slice(open.contentFrom)));
  else pushLoose(html.length);

  // Doppelte IDs (von Hand kopierter Inhalt, ein Import) bekommen eine neue:
  // der Stapel führt Blöcke über ihre ID, und zwei gleiche verlören beim
  // Verschieben einen der beiden.
  const seen = new Set<string>();
  for (const block of blocks) {
    if (seen.has(block.id)) block.id = generateId();
    seen.add(block.id);
  }
  return blocks;
}

/** Eine Section, Attribute doppelt gequotet und escaped — dieselbe Form, die
 *  `DOMParser` + `innerHTML` beim Merge-Import wieder ausgeben. */
export function blockSectionHtml(block: BlockInstance): string {
  const attrs: Array<[string, string]> = [
    ['data-block', block.type],
    ['data-block-id', block.id],
    ...Object.entries(block.attrs),
  ];
  return `<section ${attrs.map(([k, v]) => `${k}="${escapeHtml(v)}"`).join(' ')}>${block.html}</section>`;
}

function isPlainTextBlock(block: BlockInstance): boolean {
  return block.type === TEXT_BLOCK_TYPE && Object.keys(block.attrs).length === 0;
}

/** Der gespeicherte Inhalt zu einer Blockfolge — siehe Regel 2 im Kopf. */
export function serializeBlocks(blocks: BlockInstance[]): string {
  if (blocks.length === 1 && isPlainTextBlock(blocks[0])) return blocks[0].html;
  return blocks.map(blockSectionHtml).join('');
}
