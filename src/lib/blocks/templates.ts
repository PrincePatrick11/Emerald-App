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
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export const DEFAULT_TEMPLATE_ICON = '📄';

/** The built-in sigil template: the start template of the category Sigils. Editable and deletable; the fixed ID lets seed and import recognise it. */
export const SIGIL_TEMPLATE_ID = 'core-sigil';

/** The built-in altar template: the start template of the category Altars, editable and deletable like the sigil's. */
export const ALTAR_TEMPLATE_ID = 'core-altar';

/** A template ID from a foreign source. The same rule as for definitions. */
export function isTemplateId(id: unknown): id is string {
  return isDefinitionId(id);
}

/** The template as a database row — `tags` as JSON text. */
export function templateToRow(template: Template) {
  return { ...template, tags: JSON.stringify(template.tags) };
}

/**
 * The template a new entry starts with: its category's start template, else
 * the vault's default template — each only while it is active (in
 * `templates`, the active ones) — else none. A category whose template went
 * to the trash thus falls back to the default.
 */
export function resolveStartTemplate(
  templates: readonly Template[],
  category: { template_id: string | null } | null | undefined,
  defaultTemplateId: string | null,
): Template | null {
  for (const id of [category?.template_id ?? null, defaultTemplateId]) {
    const hit = id ? templates.find((t) => t.id === id) : undefined;
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
