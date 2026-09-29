import { isValidLinkTarget } from './internalLinkHtml';
import type { ContentType } from '../types';

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

// Steht in `internalLinkHtml.ts`, weil auch die reinen Blockmodule sie brauchen.
export { isValidLinkTarget };

/**
 * Die Seitenleiste kennt den TipTap-Editor nicht — sie bittet ihn per Event,
 * einen Link unten anzuhängen. Dasselbe Muster wie `internal-link-navigate`:
 * der Editor der geöffneten Ansicht hört zu, solange er editierbar ist.
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
