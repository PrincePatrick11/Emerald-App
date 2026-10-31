import type { EntryType } from '../../types';
import { generateId } from '../helpers';
import { hasOwnTitle } from '../entryTitle';
import { parseBlocks, serializeBlocks } from './blockHtml';
import { isDefinitionId } from './definitions';
import { withChargeUnloaded, withMappedChargeTargets } from './sigil';
import { BLOCK_ATTR, TEXT_BLOCK_TYPE, type BlockInstance } from './types';

/**
 * Templates (table `templates`, since v43): a prefilled entry —
 * optional title, block stack with content, tags — that is applied when
 * creating an entry or later in journal, wiki and operations.
 *
 * A template is cross-type and knows no type-specific properties.
 * What it brings into an entry is a copy: changes to the template
 * never affect existing entries. Each inserted block only remembers
 * which template it came from (`data-template-origin`) — that is how the dashboard
 * counts the entries, and replacing or removing the blocks takes the origin along.
 * A template without blocks therefore leaves no origin.
 *
 * Pure and DOM-free like the rest of `lib/blocks`: migrations and
 * `scripts/check-blocks.mjs` use it.
 */

/** The entry types a template fits — the modules with a block stack, i.e. those of `entries`. */
export const TEMPLATE_ENTRY_TYPES = ['journal', 'wiki', 'operation'] as const satisfies readonly EntryType[];
export type TemplateEntryType = EntryType;

/** The category level "all categories" — the fallback when the exact combination has no default. */
export const ALL_CATEGORIES = '*';

/**
 * An assignment: in entries of this combination the template is available
 * to choose, with `isDefault` it is applied on creation.
 * `category`: `'*'` = all categories, `null` = no category, otherwise a
 * category ID. Journal knows no categories and always has `'*'`.
 */
export interface TemplateAssignment {
  entryType: TemplateEntryType;
  category: string | null;
  isDefault: boolean;
}

export interface Template {
  id: string;
  name: string;
  /** Emoji or image (data URL), as with custom blocks. */
  icon: string;
  /** The title a new entry gets — empty = the type's default title. */
  title: string;
  /** The block stack, in the same format as an entry's content. */
  content: string;
  /** Tag IDs, as with entries. */
  tags: string[];
  assignments: TemplateAssignment[];
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export const DEFAULT_TEMPLATE_ICON = '📄';

/** The built-in sigil template: default for operation × sigils. Editable and deletable; the fixed ID lets migration and import recognise it. */
export const SIGIL_TEMPLATE_ID = 'core-sigil';

/** A template ID from a foreign source — it ends up in `data-template-origin`. The same rule as for definitions. */
export function isTemplateId(id: unknown): id is string {
  return isDefinitionId(id);
}

function isEntryType(value: unknown): value is TemplateEntryType {
  return (TEMPLATE_ENTRY_TYPES as readonly unknown[]).includes(value);
}

/** Key of a combination — at most one assignment and one default per key. */
export function assignmentKey(entryType: TemplateEntryType, category: string | null): string {
  return `${entryType}|${category === null ? '' : category}`;
}

/** There are no more combinations than entry types × categories; anything above comes from a doctored file. */
export const MAX_ASSIGNMENTS = 500;

/**
 * Assignments from JSON (row, backup, `.emerald`): unreadable entries are dropped,
 * journal always gets `'*'`, duplicate combinations merge into one.
 * A category ID follows the same rule for harmless IDs as definitions.
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

/** The template as a database row — `tags`/`assignments` as JSON text. */
export function templateToRow(template: Template) {
  return { ...template, tags: JSON.stringify(template.tags), assignments: JSON.stringify(template.assignments) };
}

/** The category ID of an assignment — `null` for "all" and "no category", which point to no row. */
export function assignedCategoryId(a: Pick<TemplateAssignment, 'category'>): string | null {
  return a.category === null || a.category === ALL_CATEGORIES ? null : a.category;
}

/** The combinations in which these assignments are the default. */
export function defaultKeys(assignments: readonly TemplateAssignment[]): Set<string> {
  return new Set(assignments.filter((a) => a.isDefault).map((a) => assignmentKey(a.entryType, a.category)));
}

/** The assignments without the star for these combinations. */
export function withoutDefaultsFor(assignments: readonly TemplateAssignment[], keys: ReadonlySet<string>): TemplateAssignment[] {
  return assignments.map((a) => (a.isDefault && keys.has(assignmentKey(a.entryType, a.category)) ? { ...a, isDefault: false } : a));
}

/** How a template stands with respect to a combination: not assigned, available, or default. */
export type AssignmentState = 'off' | 'assigned' | 'default';

/** The state of a combination in these assignments. */
export function assignmentStateAt(
  assignments: readonly TemplateAssignment[],
  entryType: TemplateEntryType,
  category: string | null,
): AssignmentState {
  const hit = assignments.find((a) => matches(a, entryType, category));
  return hit ? (hit.isDefault ? 'default' : 'assigned') : 'off';
}

/**
 * The assignments with this state for the combination: `off` removes it,
 * otherwise it is added (at the end) or only changes its star — its
 * place in the list stays.
 */
export function withAssignmentState(
  assignments: readonly TemplateAssignment[],
  entryType: TemplateEntryType,
  category: string | null,
  state: AssignmentState,
): TemplateAssignment[] {
  if (state === 'off') return assignments.filter((a) => !matches(a, entryType, category));
  const isDefault = state === 'default';
  return assignments.some((a) => matches(a, entryType, category))
    ? assignments.map((a) => (matches(a, entryType, category) ? { ...a, isDefault } : a))
    : [...assignments, { entryType, category, isDefault }];
}

/**
 * The same assignments, regardless of order? `withAssignmentState`
 * appends a combination that is switched back on at the end — without this
 * comparison, toggling back and forth would count as a change.
 */
export function sameAssignments(a: readonly TemplateAssignment[], b: readonly TemplateAssignment[]): boolean {
  if (a.length !== b.length) return false;
  const keyOf = (x: TemplateAssignment) => `${assignmentKey(x.entryType, x.category)}|${x.isDefault}`;
  const keys = new Set(a.map(keyOf));
  return b.every((x) => keys.has(keyOf(x)));
}

/**
 * The changes of an editing session (`base` → `draft`) applied to the current
 * state: added and removed combinations, stars set and removed. What has
 * happened elsewhere in the meantime — a star that another template took
 * away, a deleted category — stays, as far as the editing session did not
 * touch it itself.
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

/** The template that holds exactly this combination as its default — without fallback. */
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
 * The default for a new entry: first the exact combination (for
 * journal there is only "all"), then "all categories" — otherwise none.
 * `templates` are the active ones in display order; if two had the same
 * default (only via a doctored file), the first wins.
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
 * The templates available to choose in an entry: those assigned to this
 * combination (exactly or "all categories") first, then those without
 * an assignment. Those assigned only to other combinations are missing.
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

/** A charge target (block ID or `<block ID>:<element ID>`) mapped to the new block ID. */
function remapTarget(target: string, ids: ReadonlyMap<string, string>): string {
  const colon = target.indexOf(':');
  const next = ids.get(colon < 0 ? target : target.slice(0, colon));
  return next === undefined ? target : next + (colon < 0 ? '' : target.slice(colon));
}

/**
 * The template's blocks as new blocks for an entry: their own IDs (two
 * applications in the same entry do not interfere), charge targets mapped to
 * the new IDs, every charge unloaded, every block with an origin.
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

/** Title, content and tags with which a new entry starts — and the template they came from. */
export interface EntryStart {
  title: string;
  content: string;
  tags: string[];
  templateId: string | null;
}

/** What a new entry starts with from the template — empty without a template, the title too. */
export function templateStart(template: Pick<Template, 'id' | 'title' | 'content' | 'tags'> | null): EntryStart {
  // Without a title from the template it stays empty — "Untitled…" is shown (`displayTitle`).
  if (!template) return { title: '', content: '', tags: [], templateId: null };
  return {
    title: template.title.trim(),
    content: serializeBlocks(instantiateTemplateBlocks(template)),
    tags: [...template.tags],
    templateId: template.id,
  };
}

/** Only paragraphs, line breaks and whitespace — what a fresh text block contains. */
const EMPTY_TEXT_RE = /^(?:\s|&nbsp;|<p>|<\/p>|<p\s[^<>]*>|<br\s*\/?>)*$/i;

/**
 * Are the blocks empty — none, or only empty, ordinary text blocks? Then
 * an entry counts as untouched, and a default may fill it.
 */
export function areBlocksEmpty(blocks: readonly BlockInstance[]): boolean {
  return blocks.every((block) => isTextBlockEmpty(block) && !block.attrs[BLOCK_ATTR.template]);
}

/** A text block without content — only empty paragraphs. In read mode it stays invisible. */
export function isTextBlockEmpty(block: BlockInstance): boolean {
  return block.type === TEXT_BLOCK_TYPE && EMPTY_TEXT_RE.test(block.html);
}

/** `areBlocksEmpty` for stored content. */
export function isContentEmpty(content: string): boolean {
  return areBlocksEmpty(parseBlocks(content));
}

/**
 * The content of an entry as a template: without the origin from other
 * templates (on applying, every block gets the new one anyway) and with the
 * sigil unloaded.
 */
export function contentForTemplate(content: string): string {
  const blocks = parseBlocks(withChargeUnloaded(content));
  if (!blocks.some((b) => b.attrs[BLOCK_ATTR.template])) return serializeBlocks(blocks);
  return serializeBlocks(blocks.map((b) => {
    const { [BLOCK_ATTR.template]: _origin, ...attrs } = b.attrs;
    return { ...b, attrs };
  }));
}

/** The templates these blocks come from — each once, in order. */
export function templateOriginsOf(blocks: readonly BlockInstance[]): string[] {
  const ids = new Set<string>();
  for (const block of blocks) {
    const id = block.attrs[BLOCK_ATTR.template];
    if (id) ids.add(id);
  }
  return [...ids];
}

/** Append the template's tags (IDs) to a list — without duplicates. */
export function mergeTemplateTags(tags: readonly string[], added: readonly string[]): string[] {
  return [...new Set([...tags, ...added])];
}

/** Title and tags of an entry — what a template touches besides the blocks. */
export interface TemplateFields {
  title: string;
  tags: string[];
}

/**
 * May a template set the title without overwriting one of the user's own?
 * Yes, as long as the entry has no title of its own (`hasOwnTitle`) — or still
 * carries the title of the template that is being replaced.
 */
export function mayTakeTemplateTitle(title: string, replaces?: Pick<Template, 'title'>): boolean {
  return !hasOwnTitle(title) || (!!replaces?.title.trim() && title.trim() === replaces.title.trim());
}

/**
 * Title and tags with the template: `title` sets its title (`'ifUntitled'`
 * only as long as `mayTakeTemplateTitle`), `tags` adds its tags.
 */
export function fieldsWithTemplate(
  fields: TemplateFields,
  template: Pick<Template, 'title' | 'tags'>,
  options: { title: boolean | 'ifUntitled'; tags: boolean; replaces?: Pick<Template, 'title'> },
): TemplateFields {
  const takeTitle = options.title === 'ifUntitled' ? mayTakeTemplateTitle(fields.title, options.replaces) : options.title;
  return {
    title: takeTitle && template.title.trim() ? template.title.trim() : fields.title,
    tags: options.tags ? mergeTemplateTags(fields.tags, template.tags) : fields.tags,
  };
}

/**
 * Title and tags without the template: the title becomes empty again if it is still
 * the template's; its tags are dropped — even one that the entry
 * already carried beforehand.
 */
export function fieldsWithoutTemplate(
  fields: TemplateFields,
  template: Pick<Template, 'title' | 'tags'>,
): TemplateFields {
  const removed = new Set(template.tags);
  return {
    title: template.title.trim() && fields.title === template.title.trim() ? '' : fields.title,
    tags: fields.tags.filter((tag) => !removed.has(tag)),
  };
}
