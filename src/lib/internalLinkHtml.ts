import type { ContentType } from '../types';

/**
 * Lesen und Schreiben des gespeicherten HTML eines internen Link-Chips —
 * bewusst ohne DB-Import, damit auch die Migration in `db.ts` es benutzen kann,
 * ohne einen Zyklus über `lib/links.ts` (das `getDb` zieht) aufzumachen.
 *
 * Das Markup muss zu `InternalLinkExtension` passen: `parseHTML` erkennt den
 * Chip an `span[data-type="internalLink"]`, die Attribute an ihren
 * `data-*`-Namen. Weicht das hier ab, liest TipTap den Chip als Text ein.
 */

const SPAN_TAG_RE = /<span\b[^>]*>/gi;

function tagAttr(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}=("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  if (!match) return null;
  return match[2] ?? match[3] ?? '';
}

/**
 * Alle internen Link-Ziele im Inhalt — nur `id` und `entryType`.
 *
 * Bewusst ohne `DOMParser`: diese Funktion liegt auf dem Datenbankpfad
 * (`syncLinks`, Migration v36) und muss auch ohne Browser laufen, sonst ist die
 * Migration im Schema-Harness (Node) nicht prüfbar. Für zwei Attribute reicht
 * das Lesen des Start-Tags — und beide sind Entity-frei: IDs sind UUIDs,
 * `entryType` ist ein festes Wort. Wer das Markup selbst umbaut, nimmt
 * `remapInternalLinks` weiter unten; das braucht einen echten DOM.
 */
export function extractInternalLinks(
  html: string
): Array<{ id: string; entryType: string }> {
  if (!html) return [];
  const out: Array<{ id: string; entryType: string }> = [];
  for (const match of html.matchAll(SPAN_TAG_RE)) {
    const tag = match[0];
    if (tagAttr(tag, 'data-type') !== 'internalLink') continue;
    const id = tagAttr(tag, 'data-id');
    if (!id) continue;
    out.push({ id, entryType: tagAttr(tag, 'data-entry-type') ?? 'wiki' });
  }
  return out;
}

/**
 * Trägt das gespeicherte HTML sichtbaren Inhalt? Ein frischer Eintrag ist
 * `<p></p>` — vor den ersten Verlinkungs-Block gehört dort keine Trennlinie,
 * denn sie trennt den Text von den Links, und Text gibt es noch keinen.
 *
 * Wie `extractInternalLinks` bewusst ohne `DOMParser`: die Migrationen fragen
 * das ebenfalls, und die laufen im Schema-Harness unter Node.
 */
export function isBlankContent(html: string): boolean {
  if (!html) return true;
  // Elemente, die für sich stehen — ein Bild ohne ein Wort daneben ist Inhalt.
  if (/<(img|hr|br|iframe|table|svg|video|audio|span)\b/i.test(html)) return false;
  return !html.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim();
}

export interface ParsedInternalLink {
  id: string;
  entryType: string;
  label: string;
}

/** Wohin ein Chip nach dem Umschreiben zeigt. `label` überschreibt den
 *  gespeicherten Anzeigetext — ohne das könnte er nach einem Wechsel des Ziels
 *  etwas anderes behaupten, als der Link tatsächlich trifft. */
export interface ResolvedInternalLink {
  id: string;
  label?: string;
}

/**
 * Schreibt die Ziel-IDs der Link-Chips im Inhalt um — der Reparaturschritt beim
 * Import in einen fremden Vault, wo dieselbe Notiz eine andere ID hat.
 *
 * `resolve` bekommt jeden Chip und gibt das Ziel im Ziel-Vault zurück, oder
 * `null`. Für `null` wird der Chip durch seinen Text ersetzt: ein Link, dessen
 * Ziel es hier nicht gibt, wäre sonst ein Chip, der beim Klick ins Nichts
 * führt — die Wörter, für die er stand, bleiben so wenigstens erhalten.
 */
export function remapInternalLinks(
  html: string,
  resolve: (link: ParsedInternalLink) => ResolvedInternalLink | null,
): string {
  if (!html.includes('data-type="internalLink"')) return html;

  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const span of Array.from(doc.querySelectorAll('span[data-type="internalLink"]'))) {
    const link: ParsedInternalLink = {
      id: span.getAttribute('data-id') ?? '',
      entryType: span.getAttribute('data-entry-type') ?? 'wiki',
      label: span.getAttribute('data-label') ?? span.textContent ?? '',
    };
    const resolved = link.id ? resolve(link) : null;
    if (resolved === null) {
      span.replaceWith(doc.createTextNode(link.label));
      continue;
    }
    if (resolved.id !== link.id) span.setAttribute('data-id', resolved.id);
    if (resolved.label !== undefined && resolved.label !== link.label) {
      span.setAttribute('data-label', resolved.label);
      span.textContent = resolved.label;
    }
  }
  return doc.body.innerHTML;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface InternalLinkChip {
  id: string;
  entryType: ContentType;
  label: string;
  icon?: string | null;
  entry_number?: number | null;
}

/**
 * Der Chip so, wie TipTaps `renderHTML` ihn schreiben würde. Leere Attribute
 * bleiben weg — `mergeAttributes` lässt `null` ebenfalls fallen.
 */
export function internalLinkChipHtml(chip: InternalLinkChip): string {
  const attrs: Array<[string, string]> = [
    ['data-type', 'internalLink'],
    ['class', 'internal-link'],
    ['data-id', chip.id],
    ['data-entry-type', chip.entryType],
    ['data-label', chip.label],
  ];
  if (chip.icon) attrs.push(['data-icon', chip.icon]);
  if (chip.entry_number != null) attrs.push(['data-entry-number', String(chip.entry_number)]);

  const rendered = attrs.map(([k, v]) => `${k}="${escapeHtml(v)}"`).join(' ');
  return `<span ${rendered}>${escapeHtml(chip.label || chip.id)}</span>`;
}

export interface LinkBlockOptions {
  /** `false` lässt die Trennlinie weg — für den ersten Block in einem noch
   *  leeren Eintrag, wo es nichts zu trennen gibt (siehe `isBlankContent`). */
  separator?: boolean;
  /** Text hinter dem Chip, im selben Absatz. Trägt die Meditationsdauer aus
   *  dem abgelösten Journal-Feld („(20 min)"), die kein Link-Ziel hat. */
  suffix?: string;
}

/**
 * Ein angehängter Verlinkungs-Block: Trennlinie, Kategorie als Überschrift,
 * dann der Chip. Die eine Definition dieses Blocks — `appendEntryLink` im
 * RichEditor, die Migrationen v36/v37 und der `.emerald`-Import setzen alle
 * hier an.
 */
export function internalLinkBlockHtml(
  chip: InternalLinkChip,
  categoryLabel: string,
  { separator = true, suffix }: LinkBlockOptions = {},
): string {
  const rule = separator ? '<hr>' : '';
  const heading = categoryLabel ? `<h3>${escapeHtml(categoryLabel)}</h3>` : '';
  const tail = suffix ? ` ${escapeHtml(suffix)}` : '';
  return `${rule}${heading}<p>${internalLinkChipHtml(chip)}${tail} </p>`;
}

/**
 * Derselbe Block ohne Chip — für eine abgelöste Angabe, deren Ziel es nicht
 * (mehr) gibt: ein gesetztes `is_bannung` ohne Artikel etwa. Ohne das ginge bei
 * der Migration v37 die Information ersatzlos verloren.
 */
export function plainBlockHtml(text: string, { separator = true }: LinkBlockOptions = {}): string {
  return `${separator ? '<hr>' : ''}<p>${escapeHtml(text)}</p>`;
}
