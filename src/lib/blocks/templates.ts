import { generateId } from '../helpers';
import { parseBlocks, serializeBlocks } from './blockHtml';
import { isDefinitionId } from './definitions';
import { withChargeUnloaded, withMappedChargeTargets } from './sigil';
import { BLOCK_ATTR, TEXT_BLOCK_TYPE, type BlockInstance } from './types';

/**
 * Vorlagen (Tabelle `templates`, seit v43): ein vorausgefüllter Eintrag —
 * optionaler Titel, Blockstapel mit Inhalt, Tags —, den man beim Anlegen oder
 * später in Journal, Wiki und Operationen einsetzt.
 *
 * Eine Vorlage ist typübergreifend und kennt keine typeigenen Eigenschaften.
 * Was sie in einen Eintrag bringt, ist eine Kopie: Änderungen an der Vorlage
 * wirken nie auf bestehende Einträge. Jeder eingesetzte Block merkt sich nur,
 * aus welcher Vorlage er kam (`data-template-origin`) — so zählt das Dashboard
 * die Einträge, und Ersetzen oder Entfernen der Blöcke nimmt die Herkunft mit.
 * Eine Vorlage ohne Blöcke hinterlässt deshalb keine Herkunft.
 *
 * Rein und DOM-frei wie der Rest von `lib/blocks`: Migrationen und
 * `scripts/check-blocks.mjs` benutzen es.
 */

/** Die Eintragsarten, in die eine Vorlage passt — die Module mit Blockstapel. */
export const TEMPLATE_ENTRY_TYPES = ['journal', 'wiki', 'operation'] as const;
export type TemplateEntryType = (typeof TEMPLATE_ENTRY_TYPES)[number];

/** Die Kategorie-Stufe „alle Kategorien" — der Rückfall, wenn die genaue Kombination keinen Standard hat. */
export const ALL_CATEGORIES = '*';

/**
 * Eine Zuweisung: in Einträgen dieser Kombination steht die Vorlage zur Wahl,
 * mit `isDefault` wird sie beim Anlegen eingesetzt.
 * `category`: `'*'` = alle Kategorien, `null` = ohne Kategorie, sonst eine
 * Kategorie-ID. Journal kennt keine Kategorien und hat immer `'*'`.
 */
export interface TemplateAssignment {
  entryType: TemplateEntryType;
  category: string | null;
  isDefault: boolean;
}

export interface Template {
  id: string;
  name: string;
  /** Emoji oder Bild (Data-URL), wie bei eigenen Blöcken. */
  icon: string;
  description: string;
  /** Der Titel, den ein neuer Eintrag bekommt — leer = der Standardtitel des Typs. */
  title: string;
  /** Der Blockstapel, im selben Format wie der Inhalt eines Eintrags. */
  content: string;
  tags: string[];
  assignments: TemplateAssignment[];
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export const DEFAULT_TEMPLATE_ICON = '📄';

/** Die eingebaute Sigillen-Vorlage: Standard für Operation × Sigillen. Bearbeit- und löschbar; die feste ID lässt Migration und Import sie wiedererkennen. */
export const SIGIL_TEMPLATE_ID = 'core-sigil';

/** Eine Vorlagen-ID aus fremder Quelle — sie landet in `data-template-origin`. Dieselbe Regel wie für Definitionen. */
export function isTemplateId(id: unknown): id is string {
  return isDefinitionId(id);
}

function isEntryType(value: unknown): value is TemplateEntryType {
  return (TEMPLATE_ENTRY_TYPES as readonly unknown[]).includes(value);
}

/** Schlüssel einer Kombination — je Schlüssel höchstens eine Zuweisung und ein Standard. */
export function assignmentKey(entryType: TemplateEntryType, category: string | null): string {
  return `${entryType}|${category === null ? '' : category}`;
}

/** Mehr Kombinationen als Eintragsarten × Kategorien gibt es nicht; alles darüber stammt aus einer präparierten Datei. */
const MAX_ASSIGNMENTS = 500;

/**
 * Zuweisungen aus JSON (Zeile, Backup, `.emerald`): Unlesbares fällt weg,
 * Journal bekommt immer `'*'`, doppelte Kombinationen gehen ineinander auf.
 * Eine Kategorie-ID folgt derselben Regel für harmlose IDs wie Definitionen.
 */
export function parseAssignments(raw: unknown): TemplateAssignment[] {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const byKey = new Map<string, TemplateAssignment>();
  for (const item of value.slice(0, MAX_ASSIGNMENTS)) {
    if (typeof item !== 'object' || item === null) continue;
    const { entryType, category, isDefault } = item as Record<string, unknown>;
    if (!isEntryType(entryType)) continue;
    let cat: string | null;
    if (entryType === 'journal' || category === ALL_CATEGORIES) cat = ALL_CATEGORIES;
    else if (category === null) cat = null;
    else if (isDefinitionId(category)) cat = category;
    else continue;
    const key = assignmentKey(entryType, cat);
    const prev = byKey.get(key);
    byKey.set(key, { entryType, category: cat, isDefault: isDefault === true || (prev?.isDefault ?? false) });
  }
  return [...byKey.values()];
}

/** Die Vorlage als Datenbankzeile — `tags`/`assignments` als JSON-Text. */
export function templateToRow(template: Template) {
  return { ...template, tags: JSON.stringify(template.tags), assignments: JSON.stringify(template.assignments) };
}

/** Die Kategorie-ID einer Zuweisung — `null` für „alle" und „ohne Kategorie", die auf keine Zeile zeigen. */
export function assignedCategoryId(a: Pick<TemplateAssignment, 'category'>): string | null {
  return a.category === null || a.category === ALL_CATEGORIES ? null : a.category;
}

/** Die Kombinationen, in denen diese Zuweisungen Standard sind. */
export function defaultKeys(assignments: readonly TemplateAssignment[]): Set<string> {
  return new Set(assignments.filter((a) => a.isDefault).map((a) => assignmentKey(a.entryType, a.category)));
}

/** Die Zuweisungen ohne Stern für diese Kombinationen. */
export function withoutDefaultsFor(assignments: readonly TemplateAssignment[], keys: ReadonlySet<string>): TemplateAssignment[] {
  return assignments.map((a) => (a.isDefault && keys.has(assignmentKey(a.entryType, a.category)) ? { ...a, isDefault: false } : a));
}

/** Die Zuweisungen mit Stern für diese Kombination — die Zuweisung kommt dazu, wenn sie fehlt. */
export function withDefaultAt(
  assignments: readonly TemplateAssignment[],
  entryType: TemplateEntryType,
  category: string | null,
): TemplateAssignment[] {
  const key = assignmentKey(entryType, category);
  const has = assignments.some((a) => assignmentKey(a.entryType, a.category) === key);
  return has
    ? assignments.map((a) => (assignmentKey(a.entryType, a.category) === key ? { ...a, isDefault: true } : a))
    : [...assignments, { entryType, category, isDefault: true }];
}

/**
 * Die Änderungen einer Bearbeitung (`base` → `draft`) auf den aktuellen Stand
 * gelegt: hinzugefügte und entfernte Kombinationen, gesetzte und genommene
 * Sterne. Was inzwischen anderswo geschah — ein Stern aus der Übersicht, eine
 * gelöschte Kategorie —, bleibt, soweit die Bearbeitung es nicht selbst
 * angefasst hat.
 */
export function mergeAssignmentChanges(
  base: readonly TemplateAssignment[],
  draft: readonly TemplateAssignment[],
  current: readonly TemplateAssignment[],
): TemplateAssignment[] {
  const keyOf = (a: TemplateAssignment) => assignmentKey(a.entryType, a.category);
  const baseByKey = new Map(base.map((a) => [keyOf(a), a]));
  const draftByKey = new Map(draft.map((a) => [keyOf(a), a]));
  const result = new Map(current.map((a) => [keyOf(a), a]));
  for (const key of baseByKey.keys()) {
    if (!draftByKey.has(key)) result.delete(key);
  }
  for (const [key, a] of draftByKey) {
    const before = baseByKey.get(key);
    if (!before) {
      result.set(key, a);
    } else if (before.isDefault !== a.isDefault && result.has(key)) {
      result.set(key, { ...result.get(key)!, isDefault: a.isDefault });
    }
  }
  return [...result.values()];
}

/** Die Vorlage, die genau diese Kombination als Standard hält — ohne Rückfall. */
export function defaultTemplateAt(
  templates: readonly Template[],
  entryType: TemplateEntryType,
  category: string | null,
): Template | undefined {
  return templates.find((t) => t.assignments.some((a) => a.isDefault && matches(a, entryType, category)));
}

function matches(a: TemplateAssignment, entryType: TemplateEntryType, category: string | null): boolean {
  return a.entryType === entryType && a.category === category;
}

/**
 * Der Standard für einen neuen Eintrag: erst die genaue Kombination (bei
 * Journal gibt es nur „alle"), dann „alle Kategorien" — sonst keiner.
 * `templates` sind die aktiven in Anzeigereihenfolge; hätten zwei denselben
 * Standard (nur über eine präparierte Datei), gewinnt die erste.
 */
export function resolveDefaultTemplate(
  templates: readonly Template[],
  entryType: TemplateEntryType,
  categoryId: string | null,
): Template | null {
  const levels = entryType === 'journal' ? [ALL_CATEGORIES] : [categoryId, ALL_CATEGORIES];
  for (const category of levels) {
    const hit = defaultTemplateAt(templates, entryType, category);
    if (hit) return hit;
  }
  return null;
}

/**
 * Die Vorlagen, die in einem Eintrag zur Wahl stehen: die dieser Kombination
 * (genau oder „alle Kategorien") zugewiesenen zuerst, dahinter die ohne
 * Zuweisung. Wer nur anderen Kombinationen zugewiesen ist, fehlt.
 */
export function templatesFor(
  templates: readonly Template[],
  entryType: TemplateEntryType,
  categoryId: string | null,
): Template[] {
  const category = entryType === 'journal' ? ALL_CATEGORIES : categoryId;
  const assigned = templates.filter((t) =>
    t.assignments.some((a) => matches(a, entryType, category) || matches(a, entryType, ALL_CATEGORIES)));
  const unassigned = templates.filter((t) => t.assignments.length === 0);
  return [...assigned, ...unassigned];
}

/** Ein Ladungsziel (Block-ID oder `<Block-ID>:<Element-ID>`) auf die neue Block-ID. */
function remapTarget(target: string, ids: ReadonlyMap<string, string>): string {
  const colon = target.indexOf(':');
  const next = ids.get(colon < 0 ? target : target.slice(0, colon));
  return next === undefined ? target : next + (colon < 0 ? '' : target.slice(colon));
}

/**
 * Die Blöcke der Vorlage als neue Blöcke für einen Eintrag: eigene IDs (zwei
 * Anwendungen im selben Eintrag stören sich nicht), Ladungsziele auf die neuen
 * IDs, jede Ladung entladen, jeder Block mit Herkunft.
 */
export function instantiateTemplateBlocks(template: Pick<Template, 'id' | 'content'>): BlockInstance[] {
  const blocks = parseBlocks(withChargeUnloaded(template.content));
  const ids = new Map(blocks.map((b) => [b.id, generateId()]));
  return blocks.map((block) => withMappedChargeTargets({
    ...block,
    id: ids.get(block.id)!,
    attrs: { ...block.attrs, [BLOCK_ATTR.template]: template.id },
  }, (target) => remapTarget(target, ids)));
}

/** Titel, Inhalt und Tags, mit denen ein neuer Eintrag beginnt. */
export interface EntryStart {
  title: string;
  content: string;
  tags: string[];
}

/** Womit ein neuer Eintrag aus der Vorlage beginnt — ohne Vorlage leer, mit dem Standardtitel des Typs. */
export function templateStart(
  template: Pick<Template, 'id' | 'title' | 'content' | 'tags'> | null,
  fallbackTitle: string,
): EntryStart {
  if (!template) return { title: fallbackTitle, content: '', tags: [] };
  return {
    title: template.title.trim() || fallbackTitle,
    content: serializeBlocks(instantiateTemplateBlocks(template)),
    tags: [...template.tags],
  };
}

/** Nur Absätze, Zeilenumbrüche und Leerraum — was ein frischer Textblock enthält. */
const EMPTY_TEXT_RE = /^(?:\s|&nbsp;|<p>|<\/p>|<p\s[^<>]*>|<br\s*\/?>)*$/i;

/**
 * Ist der Inhalt leer — keine Blöcke oder nur leere, gewöhnliche Textblöcke?
 * Dann gilt ein Eintrag als unberührt, und ein Standard darf ihn füllen.
 */
export function isContentEmpty(content: string): boolean {
  return parseBlocks(content).every((block) =>
    block.type === TEXT_BLOCK_TYPE && !block.attrs[BLOCK_ATTR.template] && EMPTY_TEXT_RE.test(block.html));
}

/**
 * Die Blöcke eines Inhalts, vergleichbar gemacht: Block-IDs (auch in
 * Ladungszielen) durch ihre Position ersetzt, Attribute sortiert, Leerraum
 * am Rand des inneren HTML weg — zwei Anwendungen derselben Vorlage sehen
 * dann gleich aus.
 */
function comparableBlocks(content: string): string {
  const blocks = parseBlocks(content);
  const byPosition = (value: string) => blocks.reduce((v, b, i) => v.split(b.id).join(`#${i}`), value);
  return JSON.stringify(blocks.map((b) => ({
    type: b.type,
    html: byPosition(b.html.trim()),
    attrs: Object.keys(b.attrs).sort().map((k) => [k, byPosition(b.attrs[k])]),
  })));
}

/**
 * Steht im Inhalt noch genau das, was die Vorlage (in ihrer jetzigen Fassung)
 * einsetzt — nichts geändert, nichts dazu? Dann darf ein genauerer Standard
 * ihn ersetzen. Wurde die Vorlage seither geändert, gilt der Inhalt als
 * geändert: lieber einen Tausch auslassen als Arbeit überschreiben.
 */
export function isUnchangedTemplateContent(content: string, template: Pick<Template, 'id' | 'content'>): boolean {
  if (!content.includes(template.id)) return false;
  return comparableBlocks(content) === comparableBlocks(serializeBlocks(instantiateTemplateBlocks(template)));
}

/** Die Vorlagen, aus denen diese Blöcke stammen — jede einmal, in Reihenfolge. */
export function templateOriginsOf(blocks: readonly BlockInstance[]): string[] {
  const ids = new Set<string>();
  for (const block of blocks) {
    const id = block.attrs[BLOCK_ATTR.template];
    if (id) ids.add(id);
  }
  return [...ids];
}

/** Tags der Vorlage an eine Liste anhängen — ohne doppelte Namen (Groß/Klein egal). */
export function mergeTemplateTags(tags: readonly string[], added: readonly string[]): string[] {
  const seen = new Set(tags.map((t) => t.toLowerCase()));
  const out = [...tags];
  for (const tag of added) {
    if (seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out;
}
