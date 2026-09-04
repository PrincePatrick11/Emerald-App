import { getDb } from './db';
import { extractInternalLinks } from './internalLinkHtml';
import type { ContentType } from '../types';

export interface BacklinkEntry {
  id: string;
  title: string;
  /** Bewusst schmaler als ContentType: Link-QUELLEN sind nur die Module mit
   *  Editor — tasks/altar können Ziel sein, aber nie Quelle. */
  type: 'journal' | 'wiki' | 'operation';
}

/** Was das Verlinkungs-Feld der Seitenleiste an den Editor schickt. Deckt sich
 *  mit `SuggestionItem` (dort mit `label` als Pflichtfeld), bleibt hier aber
 *  eigenständig: `lib/` importiert keine Komponenten. */
export interface EntryLinkRequest {
  id: string;
  entryType: ContentType;
  label: string;
  icon?: string | null;
  /** Überschrift über dem angehängten Link — siehe `SuggestionItem.categoryLabel`. */
  categoryLabel?: string;
  entry_number?: number | null;
}

const VALID_ENTRY_TYPES: readonly string[] = ['journal', 'wiki', 'operation', 'task', 'altar'];
/** Standard-UUIDs und die beim Merge-Import vorangestellte 8-Zeichen-Kennung. */
const LINK_ID_RE = /^([0-9a-z]{8}-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ist das ein plausibles Link-Ziel? Die Link-Events reisen über
 * `document` und sind damit für jedes Skript im WebView erreichbar; die
 * Handler prüfen deshalb, was sie bekommen, bevor sie navigieren oder gar in
 * den Eintrag schreiben. Eine Prüfung für alle drei Events (Navigieren,
 * Anhängen, Anzeigen) — vorher hatte nur das Navigieren eine, als Kopie.
 */
export function isValidLinkTarget(target: { id?: unknown; entryType?: unknown } | null | undefined): boolean {
  if (!target) return false;
  return typeof target.id === 'string'
    && LINK_ID_RE.test(target.id)
    && VALID_ENTRY_TYPES.includes(String(target.entryType).trim());
}

/**
 * Die Seitenleiste kennt den TipTap-Editor nicht — sie bittet ihn per Event,
 * einen Link unten anzuhängen. Dasselbe Muster wie `internal-link-navigate`
 * und `routine-drop`; der Editor der geöffneten Ansicht hört zu, solange er
 * editierbar ist.
 */
export const APPEND_ENTRY_LINK_EVENT = 'entry-link-append';

/** `true`, wenn ein editierbarer Editor die Bitte angenommen hat (er quittiert
 *  mit `preventDefault`). `false` heißt: es lauscht gerade keiner — der Aufrufer
 *  darf den Link dann nicht als eingefügt behandeln. */
export function requestEntryLinkAppend(item: EntryLinkRequest): boolean {
  const event = new CustomEvent<EntryLinkRequest>(APPEND_ENTRY_LINK_EVENT, {
    detail: item,
    cancelable: true,
  });
  return !document.dispatchEvent(event);
}

/**
 * Bitte an den geöffneten Editor, zu einem Link im Inhalt zu springen und ihn
 * kurz hervorzuheben. Gegenstück zum Anhängen — nach derselben Quittungsregel:
 * `false` heißt, der Link steht nicht (mehr) im Eintrag, und der Aufrufer darf
 * stattdessen zum Ziel navigieren.
 */
export const REVEAL_ENTRY_LINK_EVENT = 'entry-link-reveal';

export function requestEntryLinkReveal(target: { id: string; entryType: ContentType }): boolean {
  const event = new CustomEvent(REVEAL_ENTRY_LINK_EVENT, {
    detail: target,
    cancelable: true,
  });
  return !document.dispatchEvent(event);
}

/**
 * Bitte an den Editor, den Link aus dem Inhalt zu entfernen. Nach derselben
 * Quittungsregel: `false` heißt, es lauscht kein editierbarer Editor oder der
 * Link steht nicht im Text.
 *
 * `categoryLabel` gehört mit dazu, auch wenn es zum Finden des Links nicht
 * gebraucht wird: der Editor räumt einen angehängten Verlinkungs-Block nur
 * dann mitsamt seiner Überschrift ab, wenn deren Text genau diese Kategorie
 * ist. Ohne die Angabe bliebe die Überschrift stehen.
 */
export const REMOVE_ENTRY_LINK_EVENT = 'entry-link-remove';

export function requestEntryLinkRemove(
  target: { id: string; entryType: ContentType; categoryLabel?: string },
): boolean {
  const event = new CustomEvent(REMOVE_ENTRY_LINK_EVENT, {
    detail: target,
    cancelable: true,
  });
  return !document.dispatchEvent(event);
}

/**
 * Die Gegenseite der drei `requestEntryLink*`-Bitten: prüft das Ziel und
 * quittiert per `preventDefault`, wenn `handler` die Bitte angenommen hat.
 * Gibt die Abmeldefunktion zurück.
 *
 * Zusammen mit den Request-Funktionen liegt damit das ganze Protokoll hier —
 * vorher stand die Empfängerseite dreimal fast gleich im RichEditor.
 */
export function subscribeEntryLinkRequest(
  eventName: string,
  handler: (target: EntryLinkRequest) => boolean,
): () => void {
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<EntryLinkRequest>).detail;
    if (!isValidLinkTarget(detail)) return;
    if (handler(detail)) e.preventDefault();
  };
  document.addEventListener(eventName, listener);
  return () => document.removeEventListener(eventName, listener);
}

/** Updates the links table for a given source after content is saved. */
export async function syncLinks(
  sourceId: string,
  sourceType: 'journal' | 'wiki' | 'operation',
  content: string
): Promise<void> {
  const db = await getDb();
  const links = extractInternalLinks(content);

  await db.execute('DELETE FROM links WHERE source_id=$1', [sourceId]);

  for (const link of links) {
    await db.execute(
      `INSERT OR IGNORE INTO links (source_id, source_type, target_id, target_type)
       VALUES ($1, $2, $3, $4)`,
      [sourceId, sourceType, link.id, link.entryType]
    );
  }
}

/** Returns all entries/articles that link TO the given target. */
export async function fetchBacklinks(
  targetId: string
): Promise<BacklinkEntry[]> {
  const db = await getDb();

  const journalLinks = await db.select<
    Array<{ id: string; title: string }>
  >(
    `SELECT je.id, je.title FROM links l
     JOIN journal_entries je ON l.source_id = je.id
     WHERE l.target_id = $1 AND l.source_type = 'journal'`,
    [targetId]
  );

  const wikiLinks = await db.select<
    Array<{ id: string; title: string }>
  >(
    `SELECT wa.id, wa.title FROM links l
     JOIN wiki_articles wa ON l.source_id = wa.id
     WHERE l.target_id = $1 AND l.source_type = 'wiki'`,
    [targetId]
  );

  const operationLinks = await db.select<
    Array<{ id: string; title: string }>
  >(
    `SELECT o.id, o.title FROM links l
     JOIN operations o ON l.source_id = o.id
     WHERE l.target_id = $1 AND l.source_type = 'operation'`,
    [targetId]
  );

  return [
    ...journalLinks.map((r) => ({ ...r, type: 'journal' as const })),
    ...wikiLinks.map((r) => ({ ...r, type: 'wiki' as const })),
    ...operationLinks.map((r) => ({ ...r, type: 'operation' as const })),
  ];
}
