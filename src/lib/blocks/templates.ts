import type { EntryType } from '../../types';
import { generateId } from '../helpers';
import { hasOwnTitle } from '../entryTitle';
import { parseBlocks, serializeBlocks } from './blockHtml';
import { isDefinitionId } from './definitions';
import { withMappedChargeTargets } from './sigil';
import { TEXT_BLOCK_TYPE, type BlockInstance } from './types';

/**
 * Templates (table `templates`, since v43): a prefilled entry —
 * optional title, block stack with content, tags — that is applied when
 * creating an entry or later in journal, wiki and operations.
 *
 * A template is cross-type and knows no type-specific properties.
 * What it brings into an entry is a copy: changes to the template
 * never affect existing entries, and nothing in an entry remembers the template.
 *
 * Pure and DOM-free like the rest of `lib/blocks`: migrations and
 * `scripts/check-blocks.mjs` use it.
 */

/** The entry types a template fits — the modules with a block stack, i.e. those of `entries`. */
export const TEMPLATE_ENTRY_TYPES = ['journal', 'wiki', 'operation'] as const satisfies readonly EntryType[];
export type TemplateEntryType = EntryType;

/** The category level "all categories" — the fallback when the exact combination has no template. */
export const ALL_CATEGORIES = '*';

/**
 * An assignment: new entries of this combination start with a copy of the
 * template. `category`: `'*'` = all categories, `null` = no category, otherwise a
 * category ID. Journal knows no categories and always has `'*'`.
 */
export interface TemplateAssignment {
  entryType: TemplateEntryType;
  category: string | null;
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

/** The built-in sigil template: assigned to operation × sigils. Editable and deletable; the fixed ID lets migration and import recognise it. */
export const SIGIL_TEMPLATE_ID = 'core-sigil';

/** A template ID from a foreign source. The same rule as for definitions. */
export function isTemplateId(id: unknown): id is string {
  return isDefinitionId(id);
}

function isEntryType(value: unknown): value is TemplateEntryType {
  return (TEMPLATE_ENTRY_TYPES as readonly unknown[]).includes(value);
}

/** Key of a combination — at most one template per key. */
export function assignmentKey(entryType: TemplateEntryType, category: string | null): string {
  return `${entryType}|${category === null ? '' : category}`;
}

/** There are no more combinations than entry types × categories; anything above comes from a doctored file. */
export const MAX_ASSIGNMENTS = 500;

/**
 * Assignments from JSON (row, backup, draft): unreadable entries are dropped,
 * journal always gets `'*'`, duplicate combinations merge into one. An entry with
 * `isDefault: false` comes from older data, where it only offered the template
 * for selection — today that is not an assignment.
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
    if (!isEntryType(entryType) || isDefault === false) continue;
    let cat: string | null;
    if (entryType === 'journal' || category === ALL_CATEGORIES) cat = ALL_CATEGORIES;
    else if (category === null) cat = null;
    else if (isDefinitionId(category)) cat = category;
    else continue;
    byKey.set(assignmentKey(entryType, cat), { entryType, category: cat });
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

/** The template assigned exactly to this combination — without fallback. */
export function assignedTemplateAt(
  templates: readonly Template[],
  entryType: TemplateEntryType,
  category: string | null,
): Template | undefined {
  return templates.find((t) => t.assignments.some((a) => matches(a, entryType, category)));
}

function matches(a: TemplateAssignment, entryType: TemplateEntryType, category: string | null): boolean {
  return a.entryType === entryType && a.category === category;
}

/**
 * The template for a new entry: first the exact combination (for
 * journal there is only "all"), then "all categories" — otherwise none.
 * `templates` are the active ones in display order; if two held the same
 * combination (only via a doctored file), the first wins.
 */
export function resolveAssignedTemplate(
  templates: readonly Template[],
  entryType: TemplateEntryType,
  categoryId: string | null,
): Template | null {
  const levels = entryType === 'journal' ? [ALL_CATEGORIES] : [categoryId, ALL_CATEGORIES];
  for (const category of levels) {
    const hit = assignedTemplateAt(templates, entryType, category);
    if (hit) return hit;
  }
  return null;
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
 * the new IDs. Everything else comes as it is — a drawn or loaded sigil too.
 */
export function instantiateTemplateBlocks(template: Pick<Template, 'content'>): BlockInstance[] {
  const blocks = parseBlocks(template.content);
  const ids = new Map(blocks.map((b) => [b.id, generateId()]));
  return blocks.map((block) => withMappedChargeTargets(
    { ...block, id: ids.get(block.id)! },
    (target) => remapTarget(target, ids),
  ));
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
 * an entry counts as untouched, and a template replaces it instead of following it.
 */
export function areBlocksEmpty(blocks: readonly BlockInstance[]): boolean {
  return blocks.every(isTextBlockEmpty);
}

/** A text block without content — only empty paragraphs. In read mode it stays invisible. */
export function isTextBlockEmpty(block: BlockInstance): boolean {
  return block.type === TEXT_BLOCK_TYPE && EMPTY_TEXT_RE.test(block.html);
}

/** `areBlocksEmpty` for stored content. */
export function isContentEmpty(content: string): boolean {
  return areBlocksEmpty(parseBlocks(content));
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
 * Title and tags with the template: its title if the entry has none of its
 * own yet, its tags added.
 */
export function fieldsWithTemplate(
  fields: TemplateFields,
  template: Pick<Template, 'title' | 'tags'>,
): TemplateFields {
  return {
    title: !hasOwnTitle(fields.title) && template.title.trim() ? template.title.trim() : fields.title,
    tags: mergeTemplateTags(fields.tags, template.tags),
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
