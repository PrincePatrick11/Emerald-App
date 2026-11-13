/**
 * Changing an entry's type — journal, operation and wiki among each other,
 * the three modules with a block stack. Tasks have a different data model
 * and stay what they are.
 *
 * The entry keeps its id: its row in `entries` gets the new type,
 * and everything that addresses it via `(id, type)` follows — link chips in
 * entries, templates and the presets of custom blocks, the `task_links` rows,
 * open tabs and their histories. Title, content, tags and
 * creation date stay; the number (`entry_number`) continues counting in the new type.
 * Category, icon and cover image move along between wiki and operation — the
 * journal has none of them, they are dropped there (the sidebar asks beforehand).
 *
 * The content stays as it is: a default only applies on creation. The
 * templates of the new type are then ready to be inserted by hand.
 *
 * A change in the middle of editing belongs to the edit: its baseline
 * moves along (`store/entryEdit.ts`), and Cancel brings the entry back the same
 * way (`revertEntryType`) — into its module, with its old number.
 *
 * Without a transaction (see `normalizeSchema.ts`): first the row, then the
 * references. If it aborts in between, at worst individual chips still
 * show the old type — the entry itself is never duplicated and never gone (until v48
 * the row moved between three tables).
 *
 * Import rule like `dbBackup`: reads and writes the stores from the outside; none
 * of them imports back.
 */
import { OWNER, planContentWrite, readContent, type BlockOwnerKind } from './blockStore';
import type Database from './sqlite';
import { getDb, nextEntryNumber } from './db';
import { nowIso } from './helpers';
import { retypeInternalLinks } from './internalLinkHtml';
import { serialKey, serialized } from './serialize';
import { viewTypeForEntryType } from './modules';
import { parseDefinitionElements, remapDefinitionDefaults } from './blocks/definitions';
import { hasOwnTitle } from './entryTitle';
import { carryBaseline, originOfEdit, pendingEntryWrites, retypeBaselineLinks, type BaselineFields, type EditOrigin } from '../store/entryEdit';
import { useBlockDraftStore, useTemplateDraftStore } from '../store/draftStore';
import { mapEntries, useEntryStore, withAddedEntry, withSortedEntry, withoutIds } from '../store/entryStore';
import { useTaskStore } from '../store/taskStore';
import { useTemplateStore } from '../store/templateStore';
import { useBlockDefinitionStore } from '../store/blockDefinitionStore';
import { useUIStore, withEditLock } from '../store/uiStore';
import type { Entry, EntryType } from '../types';

/** The types an entry can switch between — the modules with a block stack. */
export type ConvertibleEntryType = EntryType;

/** What an entry takes along through the type change. */
type EntryCore = Pick<Entry, 'id' | 'title' | 'content' | 'tags' | 'created_at' | 'category_id' | 'icon' | 'cover_image'>;


/**
 * Does the entry lose anything when it becomes `to`? Only the journal has fewer
 * properties than the other two.
 */
export function typeChangeDropsProperties(entry: Pick<EntryCore, 'category_id' | 'icon' | 'cover_image'>, to: ConvertibleEntryType): boolean {
  return to === 'journal' && !!(entry.category_id || entry.icon || entry.cover_image);
}

/** The reversal of a type change: where to, and with which state. */
interface Revert {
  origin: EditOrigin;
  fields: BaselineFields;
  /** "Last modified" from the start of the edit. */
  stamp: string | undefined;
}

/**
 * The number an entry already had once in `type` — or the next one,
 * if someone else has taken it in the meantime (`nextEntryNumber` continues from the highest
 * value, and that may have been this entry).
 */
async function formerEntryNumber(db: Database, type: ConvertibleEntryType, id: string, former: number | undefined): Promise<number> {
  if (former !== undefined) {
    const taken = await db.select<{ id: string }[]>(
      'SELECT id FROM entries WHERE type=$1 AND entry_number=$2 AND id<>$3 LIMIT 1', [type, former, id]
    );
    if (!taken.length) return former;
  }
  return nextEntryNumber(db, type);
}

/** Gives the row the new type — along with the fields from `core`, the number in its numbering and the stamp. */
async function retypeRow(
  db: Database, to: ConvertibleEntryType, core: EntryCore, entryNumber: number, updatedAt: string,
): Promise<Entry> {
  const entry: Entry = { ...core, type: to, entry_number: entryNumber, updated_at: updatedAt, deleted_at: null };
  // The blocks as rows, only those that changed; `content` in memory as what they give (`blockStore.ts`).
  const owner = { kind: 'entry', id: entry.id } as const;
  const blocks = await planContentWrite(db, owner, entry.content, updatedAt);
  entry.content = blocks.content;
  await db.batch([
    [
      `UPDATE entries
          SET type=$1, entry_number=$2, title=$3, category_id=$4, icon=$5, cover_image=$6, updated_at=$7, tags=$8
        WHERE id=$9`,
      [to, entry.entry_number, entry.title, entry.category_id, entry.icon ?? null, entry.cover_image ?? null,
        entry.updated_at, JSON.stringify(entry.tags), entry.id],
    ],
    ...blocks.statements,
  ]);
  blocks.commit();
  return entry;
}

/**
 * Rewrites the blocks of every entry or template that carries a chip pointing
 * at `id` — also in the trash, otherwise a restored entry would come back with
 * a dead link. Who points at it is in `block_refs`. Without `updated_at`:
 * nobody changed anything about the content of these entries. Returns the new
 * contents per id, for the stores.
 */
async function retypeLinkingOwners(
  db: Database, kind: BlockOwnerKind, id: string, to: ConvertibleEntryType,
): Promise<Map<string, string>> {
  const { column } = OWNER[kind];
  const rows = await db.select<{ owner: string }[]>(
    `SELECT DISTINCT b.${column} AS owner
       FROM block_refs r JOIN blocks b ON b.row_id = r.block_row
      WHERE r.target_kind = 'entry' AND r.target = $1 AND b.${column} IS NOT NULL`,
    [id],
  );
  const changed = new Map<string, string>();
  const now = nowIso();
  for (const { owner: ownerId } of rows) {
    // The entry itself was written by `retypeRow`, under its own key.
    if (kind === 'entry' && ownerId === id) continue;
    // The block holding the chip is rewritten along, with its references —
    // under the key its own saves run under (an entry's, the template store's
    // one), so that they and this write of its blocks cannot interleave.
    const owner = { kind, id: ownerId } as const;
    const write = async () => {
      // Read under the key: an autosave may have written meanwhile.
      const current = await readContent(db, owner);
      if (current === null) return;
      const next = retypeInternalLinks(current, id, to);
      if (next === current) return;
      const blocks = await planContentWrite(db, owner, next, now);
      await db.batch(blocks.statements);
      blocks.commit();
      changed.set(ownerId, blocks.content);
    };
    await serialized(kind === 'entry' ? serialKey('entry', ownerId) : serialKey('template', '*'), write);
  }
  return changed;
}

function withContent<T extends { id: string; content: string }>(items: T[], changed: Map<string, string>): T[] {
  return changed.size ? items.map((item) => (changed.has(item.id) ? { ...item, content: changed.get(item.id)! } : item)) : items;
}

/**
 * Changes the type of entry `id` from `from` to `to` and opens it
 * everywhere under the new type. If it is currently open in edit mode, the
 * input in progress is saved first; editing then continues in the new
 * module.
 */
export async function changeEntryType(id: string, from: ConvertibleEntryType, to: ConvertibleEntryType): Promise<void> {
  if (from === to) return;
  // Locked while it writes: Done and Cancel belong to the view
  // that is about to be torn down, and after the change they would act on a pair of
  // type and id that no longer exists.
  await withEditLock(async () => {
    // An icon still being shrunk belongs to the edit before the change: it
    // lands first, and a change to the journal then drops it like any icon.
    await pendingEntryWrites(id);
    // Before the chain below: the flush itself runs under the entry's key.
    await useUIStore.getState().editActions?.flush?.();
    // The content moves along — also for an entry that was never open since startup.
    await useEntryStore.getState().ensureEntryContent(id);
    await retypeEntry(id, from, to);
  });
}

/** Sets the link presets of custom blocks that point at `id` to the type `to` — `hit` if there was one. */
function retypeDefinitionTargets(elements: unknown, id: string, to: ConvertibleEntryType): { next: unknown; hit: boolean } {
  let hit = false;
  const next = remapDefinitionDefaults(elements, (name) => name, (target) => {
    if (target.id !== id) return target;
    hit = true;
    return { ...target, entryType: to };
  });
  return { next, hit };
}

/**
 * What is not saved yet and still points at the entry: the
 * baselines of other edits and the drafts of templates and
 * custom blocks (`base` as well as `draft` — "Done" saves only the difference).
 * Without this, the old type would come back there with the next Cancel or Done.
 */
function retypeUnsavedLinks(id: string, to: ConvertibleEntryType): void {
  retypeBaselineLinks(id, to);

  const templateDrafts = useTemplateDraftStore.getState().drafts;
  for (const [draftId, entry] of Object.entries(templateDrafts)) {
    const base = retypeInternalLinks(entry.base.content, id, to);
    const draft = retypeInternalLinks(entry.draft.content, id, to);
    if (base === entry.base.content && draft === entry.draft.content) continue;
    useTemplateDraftStore.getState().saveDraft(draftId, {
      base: { ...entry.base, content: base },
      draft: { ...entry.draft, content: draft },
    });
  }

  const blockDrafts = useBlockDraftStore.getState().drafts;
  for (const [draftId, entry] of Object.entries(blockDrafts)) {
    const base = retypeDefinitionTargets(entry.base.elements, id, to);
    const draft = retypeDefinitionTargets(entry.draft.elements, id, to);
    if (!base.hit && !draft.hit) continue;
    useBlockDraftStore.getState().saveDraft(draftId, {
      base: { ...entry.base, elements: parseDefinitionElements(base.next) },
      draft: { ...entry.draft, elements: parseDefinitionElements(draft.next) },
    });
  }
}

/**
 * Reverts the type changes of an edit: the entry `id`, currently of
 * type `from`, becomes again what it was on entering — type and number from
 * `origin`, the fields from the baseline, "last modified" included.
 * The open page is then in reading mode. Without a flush: the input in progress
 * is discarded anyway. `false` if the entry no longer exists under `from`.
 */
export function revertEntryType(
  id: string, from: ConvertibleEntryType, origin: EditOrigin, fields: BaselineFields, stamp: string | undefined,
): Promise<boolean> {
  return retypeEntry(id, from, origin.type, { origin, fields, stamp });
}

/**
 * The one path in both directions: the row, then everything that addresses the entry
 * via `(id, type)`. With `revert` the fields come from the
 * baseline instead of the store, and the edit ends.
 */
function retypeEntry(id: string, from: ConvertibleEntryType, to: ConvertibleEntryType, revert?: Revert): Promise<boolean> {
  return serialized(serialKey('entry', id), async () => {
    const source = useEntryStore.getState().getEntry(id, from);
    if (!source) return false;
    const db = await getDb();

    const fields = { ...source, ...revert?.fields };
    const core: EntryCore = {
      id: source.id,
      tags: fields.tags,
      created_at: source.created_at,
      category_id: fields.category_id,
      icon: fields.icon,
      cover_image: fields.cover_image,
      // An untitled entry is afterwards called like an untitled one of the new type.
      // Without a title of its own it stays empty — "Untitled…" shows the new kind by itself.
      // The baseline, on the other hand, comes back as it was.
      title: (revert || hasOwnTitle(fields.title)) ? fields.title : '',
      // A link of the entry to itself moves along.
      content: retypeInternalLinks(fields.content, id, to),
      ...(to === 'journal' ? { category_id: null, icon: undefined, cover_image: undefined } : {}),
    };
    // Back to the type from the start of the edit — via Cancel or by hand —
    // the entry gets its number from back then again.
    const origin = revert?.origin ?? originOfEdit(id, from);
    const entryNumber = origin?.type === to
      ? await formerEntryNumber(db, to, id, origin.entry_number)
      : await nextEntryNumber(db, to);
    const converted = await retypeRow(db, to, core, entryNumber, revert?.stamp ?? nowIso());

    const entryContent = await retypeLinkingOwners(db, 'entry', id, to);
    const templateContent = await retypeLinkingOwners(db, 'template', id, to);

    const definitionRows = await db.select<{ id: string; elements: string }[]>(
      'SELECT id, elements FROM block_definitions WHERE elements LIKE $1', [`%${id}%`]
    );
    let definitionsChanged = false;
    for (const row of definitionRows) {
      const { next, hit } = retypeDefinitionTargets(row.elements, id, to);
      if (!hit) continue;
      await db.execute('UPDATE block_definitions SET elements=$1 WHERE id=$2', [next, row.id]);
      definitionsChanged = true;
    }

    await db.execute('UPDATE task_links SET target_type=$1 WHERE target_id=$2', [to, id]);

    // No await in between: the new type is in the store before the view
    // switches, and the old one disappears only with it — no frame in which
    // the open tab points at an entry that does not exist.
    // When reverted, the entry is back in its place, not at the front like a new one.
    useEntryStore.setState((s) => ({ entries: (revert ? withSortedEntry : withAddedEntry)(s.entries, converted) }));
    // The baseline of the edit moves along before the tabs do; after
    // a revert it is over, and it lapses with the switch to reading mode.
    if (!revert) carryBaseline(id, from, to, { type: from, entry_number: source.entry_number });
    useUIStore.getState().retypeEntryViews(id, viewTypeForEntryType(from), viewTypeForEntryType(to), { endEdit: !!revert });
    useEntryStore.setState((s) => ({
      entries: mapEntries(s.entries, (list, type) => {
        const next = withContent(list, entryContent);
        return type === from ? next.filter((e) => e.id !== id) : next;
      }),
      // The rewritten contents are the latest state: a reload still in
      // progress (`fetchEntries`) must not replace them with its older one.
      pendingContent: s.pendingContent && withoutIds(s.pendingContent, entryContent.keys()),
    }));
    useTemplateStore.setState((s) => ({ templates: withContent(s.templates, templateContent) }));
    useTaskStore.setState((s) => ({
      links: s.links.map((link) => (link.target_id === id ? { ...link, target_type: to } : link)),
    }));
    if (definitionsChanged) void useBlockDefinitionStore.getState().fetchDefinitions();
    retypeUnsavedLinks(id, to);
    return true;
  });
}
