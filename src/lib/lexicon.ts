/**
 * Das Lexikon als Regelwerk: das Alphabet einer Sprache, das Nachschlagen
 * ihrer Vokabeln und das Übersetzen eines Textes damit.
 *
 * Übersetzt wird ausschließlich aus dem, was im Vault steht — es geht kein
 * Wort ins Netz (siehe `Documentation/security.md`). Was das Lexikon nicht
 * kennt, bleibt unübersetzt stehen und wird als solches gemeldet, statt still
 * verschluckt oder geraten zu werden.
 *
 * Import-Regel wie im übrigen `lib/`: keine Stores, keine Komponenten, kein
 * i18n — hier steht nur die Regel, die Oberfläche beschriftet sie.
 */
import type { AlphabetPair, Language, LexiconEntry } from '../types';

/** Womit eine neue Sprache anfängt — das Emoji des Lexikon-Dashboards. */
export const DEFAULT_LANGUAGE_ICON = '🗣️';

/**
 * Richtung der Übersetzung. `toLanguage` schreibt den eigenen Text in die
 * Sprache um (Vokabel: `translation` → `term`), `fromLanguage` zurück.
 */
export type TranslateDirection = 'toLanguage' | 'fromLanguage';

/**
 * Woraus die Übersetzung schöpft: die Vokabelliste, die Zeichentabelle oder
 * beides — wobei „beides" heißt, dass ein Wort zuerst als Vokabel gesucht und
 * erst danach Zeichen für Zeichen umgeschrieben wird.
 */
export type TranslateMode = 'words' | 'letters' | 'both';

/**
 * Ein Stück Ergebnis. `source` ist, was im Eingabetext stand — die Oberfläche
 * zeigt es im Tooltip und markiert damit, was nicht getroffen wurde.
 */
export interface TranslationSegment {
  text: string;
  source: string;
  /** `gap` ist alles zwischen den Wörtern: Leerzeichen, Satzzeichen, Zeilenumbrüche. */
  kind: 'word' | 'letters' | 'unknown' | 'gap';
}

export interface TranslationResult {
  segments: TranslationSegment[];
  /** Die Segmente zusammengesetzt — was der Kopieren-Knopf nimmt. */
  text: string;
  /** Wie viele Wörter der Eingabetext hatte (ohne Zwischenräume). */
  wordCount: number;
  /** Wie viele davon das Lexikon nicht kennt. */
  unknownCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Alphabet
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ein Zeichenpaar wirkt nur, wenn beide Seiten etwas tragen — die eine Regel
 * dafür, hier statt dreimal einzeln ausgeschrieben.
 */
export function isUsablePair(pair: AlphabetPair): boolean {
  return pair.from.trim() !== '' && pair.to.trim() !== '';
}

/**
 * Ob die Zeile überhaupt aufgehoben wird. Halb gefüllt ja — wer die linke
 * Seite noch nachträgt, soll die rechte beim nächsten Laden wiederfinden;
 * ganz leer nein, das ist eine Zeile, die es nie gab.
 */
export function isFilledPair(pair: AlphabetPair): boolean {
  return pair.from.trim() !== '' || pair.to.trim() !== '';
}

/**
 * Das Alphabet aus der JSON-Spalte. Wie überall beim Lesen fremder Daten
 * (`row.ts`): kaputter Inhalt wird zu einer leeren Tabelle, nicht zu einem
 * Fehler — eine unlesbare Zeile darf nicht das ganze Lexikon aufhalten.
 */
export function parseAlphabet(value: unknown): AlphabetPair[] {
  const raw = typeof value === 'string' ? safeParse(value) : value;
  if (!Array.isArray(raw)) return [];
  const pairs: AlphabetPair[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const pair = {
      from: String((item as AlphabetPair).from ?? ''),
      to: String((item as AlphabetPair).to ?? ''),
    };
    if (isFilledPair(pair)) pairs.push(pair);
  }
  return pairs;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function alphabetToJson(pairs: readonly AlphabetPair[]): string {
  return JSON.stringify(pairs.map((p) => ({ from: p.from, to: p.to })));
}

/**
 * Die Zeichentabelle als Nachschlagewerk, längste Folge zuerst.
 *
 * Die Sortierung ist der ganze Trick: steht „t" vor „th", fände die Umschrift
 * nie das „th", weil sie beim ersten Treffer weitergeht.
 */
function transliterationTable(
  pairs: readonly AlphabetPair[],
  direction: TranslateDirection,
): [string, string][] {
  const table: [string, string][] = [];
  const seen = new Set<string>();
  for (const pair of pairs) {
    if (!isUsablePair(pair)) continue;
    const [from, to] = direction === 'toLanguage' ? [pair.from, pair.to] : [pair.to, pair.from];
    const key = from.toLowerCase();
    // Zwei Zeilen mit derselben linken Seite: die erste gilt, wie bei den Vokabeln.
    if (seen.has(key)) continue;
    seen.add(key);
    table.push([key, to]);
  }
  return table.sort((a, b) => b[0].length - a[0].length);
}

/**
 * Schreibt `text` Zeichen für Zeichen um. Was in keiner Zeile der Tabelle
 * steht, bleibt unverändert stehen — ein Satzzeichen soll nicht verschwinden,
 * bloß weil das Alphabet es nicht kennt.
 */
function transliterate(
  text: string,
  pairs: readonly AlphabetPair[],
  direction: TranslateDirection,
): string {
  const table = transliterationTable(pairs, direction);
  if (table.length === 0) return text;
  let out = '';
  let i = 0;
  outer: while (i < text.length) {
    for (const [from, to] of table) {
      // Je Stelle kleinschreiben statt einmal für den ganzen Text: `İ` wird
      // beim Kleinschreiben zwei Zeichen lang, und eine vorab gebaute Kopie
      // liefe damit gegenüber `text` aus dem Takt — ab dort wäre jede
      // Position falsch.
      const slice = text.slice(i, i + from.length);
      if (slice.toLowerCase() === from) {
        out += to;
        i += from.length;
        continue outer;
      }
    }
    out += text[i];
    i += 1;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vokabeln
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Beide Seiten jedes Vergleichs laufen hierdurch: Kleinschreibung, und die
 * typografischen Apostrophe auf den geraden zusammengezogen — sonst findet
 * ein mit „’" eingepflegtes Wort seine mit „'" getippte Eingabe nicht.
 */
function fold(text: string): string {
  return text.toLowerCase().replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim();
}

/** Wortzeichen: Buchstaben, Ziffern, kombinierende Zeichen und der Wortapostroph. */
const WORD_RE = /[\p{L}\p{N}\p{M}'’]+/gu;

interface Token {
  text: string;
  isWord: boolean;
}

/**
 * Zerlegt den Text in Wörter und alles dazwischen. Beides bleibt erhalten:
 * Zeilenumbrüche und Satzzeichen stehen im Ergebnis an derselben Stelle wie in
 * der Eingabe, damit eine übersetzte Anrufung ihre Form behält.
 */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of text.matchAll(WORD_RE)) {
    const start = match.index ?? 0;
    if (start > last) tokens.push({ text: text.slice(last, start), isWord: false });
    tokens.push({ text: match[0], isWord: true });
    last = start + match[0].length;
  }
  if (last < text.length) tokens.push({ text: text.slice(last), isWord: false });
  return tokens;
}

interface VocabularyIndex {
  /** Gefalteter Suchbegriff → Übersetzung. */
  byKey: Map<string, string>;
  /** Aus wie vielen Wörtern der längste Eintrag besteht — die Obergrenze der Phrasensuche. */
  maxWords: number;
}

/**
 * Die Vokabeln einer Sprache als Nachschlagewerk für eine Richtung.
 *
 * Mehrwortige Einträge sind ausdrücklich erlaubt („guter Geist" → …): der
 * Index merkt sich die längste Wortzahl, und `translateText` probiert an jeder
 * Stelle die längste Phrase zuerst. Zwei Einträge mit derselben linken Seite:
 * der erste in der Liste gewinnt, also der mit der kleineren `sort_order`.
 */
function vocabularyIndex(
  entries: readonly LexiconEntry[],
  direction: TranslateDirection,
): VocabularyIndex {
  const byKey = new Map<string, string>();
  let maxWords = 1;
  for (const entry of entries) {
    const [from, to] = direction === 'toLanguage'
      ? [entry.translation, entry.term]
      : [entry.term, entry.translation];
    const key = fold(from);
    if (!key || !to.trim() || byKey.has(key)) continue;
    byKey.set(key, to.trim());
    const words = key.split(' ').length;
    if (words > maxWords) maxWords = words;
  }
  return { byKey, maxWords };
}

/**
 * Überträgt die Schreibweise der Vorlage auf das Ergebnis: GROSS bleibt groß,
 * Erstes groß bleibt erstes groß, alles andere bleibt, wie es eingepflegt
 * wurde. Ohne das käme ein Satzanfang klein aus der Übersetzung zurück.
 */
function matchCase(source: string, translated: string): string {
  const letters = source.replace(/[^\p{L}]/gu, '');
  if (letters.length > 1 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) {
    return translated.toUpperCase();
  }
  const first = source[0] ?? '';
  if (first === first.toUpperCase() && first !== first.toLowerCase()) {
    return translated.charAt(0).toUpperCase() + translated.slice(1);
  }
  return translated;
}

// ─────────────────────────────────────────────────────────────────────────────
// Übersetzen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Übersetzt `text` mit dem, was die Sprache mitbringt.
 *
 * Wort für Wort, nicht Satz für Satz: eine Grammatik hat ein selbstgepflegtes
 * Lexikon nicht, und so zu tun, als hätte es eine, wäre die unehrlichere
 * Variante. Was nicht gefunden wird, steht unverändert und markiert im
 * Ergebnis — mit `both` erst, nachdem auch die Zeichentabelle danebenstand.
 */
export function translateText(
  text: string,
  language: Pick<Language, 'alphabet'>,
  entries: readonly LexiconEntry[],
  direction: TranslateDirection,
  mode: TranslateMode,
): TranslationResult {
  const segments: TranslationSegment[] = [];
  let wordCount = 0;
  let unknownCount = 0;

  if (!text.trim()) return { segments, text: '', wordCount, unknownCount };

  // Reine Umschrift: das Lexikon spielt keine Rolle, der Text läuft als Ganzes
  // durch die Tabelle — auch die Satzzeichen, die sie kennen darf.
  if (mode === 'letters') {
    for (const token of tokenize(text)) {
      if (!token.isWord) {
        segments.push({ text: transliterate(token.text, language.alphabet, direction), source: token.text, kind: 'gap' });
        continue;
      }
      wordCount += 1;
      const out = transliterate(token.text, language.alphabet, direction);
      // Unverändert heißt: kein Zeichen des Wortes stand in der Tabelle.
      if (out === token.text) unknownCount += 1;
      segments.push({ text: out, source: token.text, kind: out === token.text ? 'unknown' : 'letters' });
    }
    return toResult(segments, wordCount, unknownCount);
  }

  const index = vocabularyIndex(entries, direction);
  const tokens = tokenize(text);

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (!token.isWord) {
      segments.push({ text: token.text, source: token.text, kind: 'gap' });
      i += 1;
      continue;
    }

    const phrase = longestMatchAt(tokens, i, index);
    if (phrase) {
      wordCount += phrase.words.length;
      segments.push({ text: matchCase(phrase.words[0], phrase.hit), source: phrase.source, kind: 'word' });
      i = phrase.nextIndex;
      continue;
    }

    wordCount += 1;
    i += 1;
    // „Beides": erst das Lexikon, dann die Zeichentabelle. Kommt das Wort auch
    // daraus unverändert zurück, kennt die Sprache es wirklich nicht.
    if (mode === 'both') {
      const rewritten = transliterate(token.text, language.alphabet, direction);
      if (rewritten !== token.text) {
        segments.push({ text: rewritten, source: token.text, kind: 'letters' });
        continue;
      }
    }
    unknownCount += 1;
    segments.push({ text: token.text, source: token.text, kind: 'unknown' });
  }

  return toResult(segments, wordCount, unknownCount);
}

/**
 * Der längste Vokabeltreffer ab `start` — Phrasen zuerst, damit „guter Geist"
 * nicht schon bei „guter" endet.
 */
function longestMatchAt(
  tokens: readonly Token[],
  start: number,
  index: VocabularyIndex,
): { words: string[]; source: string; hit: string; nextIndex: number } | null {
  for (let span = Math.min(index.maxWords, tokens.length - start); span >= 1; span -= 1) {
    const phrase = phraseAt(tokens, start, span);
    if (!phrase) continue;
    const hit = index.byKey.get(fold(phrase.words.join(' ')));
    if (hit !== undefined) return { ...phrase, hit };
  }
  return null;
}

/**
 * Die `span` Wörter ab `start` als eine Phrase — samt dem, wie sie im
 * Eingabetext aussah, und der Stelle dahinter.
 *
 * Zwischen ihnen darf nur Zwischenraum **innerhalb einer Zeile** stehen: ein
 * Satzzeichen beendet die Phrase ohnehin, und ein Zeilenumbruch tut es auch.
 * Sonst verschwände er im Ergebnis — die Übersetzung tritt an die Stelle der
 * ganzen Phrase, und der Text verlöre eine Zeile, die er im Original hatte.
 */
function phraseAt(
  tokens: readonly Token[],
  start: number,
  span: number,
): { words: string[]; source: string; nextIndex: number } | null {
  const words: string[] = [];
  let source = '';
  let i = start;
  while (i < tokens.length && words.length < span) {
    const token = tokens[i];
    if (token.isWord) {
      words.push(token.text);
    } else if (token.text.trim() !== '' || /[\n\r]/.test(token.text)) {
      return null;
    }
    source += token.text;
    i += 1;
  }
  return words.length === span ? { words, source, nextIndex: i } : null;
}

function toResult(segments: TranslationSegment[], wordCount: number, unknownCount: number): TranslationResult {
  return { segments, text: segments.map((s) => s.text).join(''), wordCount, unknownCount };
}

/**
 * Die Vokabeln einer Sprache in Anzeigereihenfolge — `sort_order`, bei
 * Gleichstand alphabetisch nach dem Begriff. Eine Wahrheit für die Tabelle auf
 * der Sprachseite, die Übersetzung und die Zählung im Dashboard.
 */
export function entriesOfLanguage(
  entries: readonly LexiconEntry[],
  languageId: string,
): LexiconEntry[] {
  return entries
    .filter((e) => e.language_id === languageId)
    .sort((a, b) => a.sort_order - b.sort_order || a.term.localeCompare(b.term));
}
