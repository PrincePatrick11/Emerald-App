/**
 * The one category list for entries and tasks (table `categories`).
 *
 * Import rule: this store may import the content stores, the dashboard store
 * and `entryEdit` — after permanently deleting a category it also reassigns
 * its contents, the dashboards' filters and the baselines of running edits in
 * memory; none of them imports back. All access goes
 * through `getState()` at runtime.
 */
import { create } from 'zustand';
import { getDb } from '../lib/db';
import { purgeCategory, reassignCategoryContent } from '../lib/schema';
import { categoryKey } from '../lib/categories';
import { generateId, nowIso } from '../lib/helpers';
import { fromRow, type DbRow } from '../lib/row';
import type { Category } from '../types';
import { useEntryStore } from './entryStore';
import { reassignBaselineCategories } from './entryEdit';
import { useTaskStore } from './taskStore';
import { reassignDashboardCategoriesInMemory } from './dashboardStore';

/** Error message from addCategory/updateCategory when the name is already taken. */
export const CATEGORY_NAME_TAKEN = 'CATEGORY_NAME_TAKEN';

export interface CategoryState {
  /** Active categories in display order. */
  categories: Category[];

  fetchCategories: () => Promise<void>;
  addCategory: (name: string, emoji: string) => Promise<Category>;
  updateCategory: (id: string, name: string, emoji: string) => Promise<void>;
  /** The template new entries of the category start with — `null`: the vault's default. Built-ins too. */
  setStartTemplate: (id: string, templateId: string | null) => Promise<void>;
  /** Soft delete. `false` if the category is built in. */
  deleteCategory: (id: string) => Promise<boolean>;
  /** The id of the category the content now sits in — its own, or the same-named one it merged into. */
  restoreCategory: (id: string) => Promise<string>;
  permanentlyDeleteCategory: (id: string) => Promise<void>;
  /** Writes the complete order of the active categories. */
  reorderCategories: (ids: string[]) => Promise<void>;
  getCategory: (id: string) => Category | undefined;
}

async function selectActive(db: Awaited<ReturnType<typeof getDb>>): Promise<Category[]> {
  const rows = await db.select<DbRow[]>(
    'SELECT * FROM categories WHERE deleted_at IS NULL ORDER BY sort_order ASC, name ASC'
  );
  return rows.map(fromRow.category);
}

function nameTaken(categories: Category[], name: string, exceptId?: string): boolean {
  const key = categoryKey(name);
  return categories.some((c) => c.id !== exceptId && categoryKey(c.name) === key);
}

/**
 * Reassigns contents that point at one of the `ids` to `to` in the loaded
 * stores (`null` = no category) — the in-memory counterpart to
 * `reassignCategoryContent`. Also used when emptying the trash;
 * the store shapes should live in one place only. The dashboards' filters
 * follow the same way.
 */
export function reassignCategoriesInMemory(ids: ReadonlySet<string>, to: string | null = null): void {
  const move = <T extends { category_id: string | null }>(x: T): T =>
    x.category_id && ids.has(x.category_id) ? { ...x, category_id: to } : x;
  useEntryStore.setState((s) => ({ entries: s.entries.map(move) }));
  useTaskStore.setState((s) => ({ tasks: s.tasks.map(move) }));
  // Also what a running edit would write back with Cancel.
  reassignBaselineCategories(ids, to);
  reassignDashboardCategoriesInMemory(ids, to);
}

/**
 * A name belongs to one category: `from` merges into `to` — its content and
 * its place in the dashboards' filters move over, the row disappears. `to`
 * keeps its own start template.
 */
async function mergeCategory(db: Awaited<ReturnType<typeof getDb>>, from: string, to: string): Promise<void> {
  await reassignCategoryContent(db, from, to);
  await db.execute('DELETE FROM categories WHERE id=$1', [from]);
  reassignCategoriesInMemory(new Set([from]), to);
}

export const useCategoryStore = create<CategoryState>((set, get) => ({
  categories: [],

  fetchCategories: async () => {
    const db = await getDb();
    set({ categories: await selectActive(db) });
  },

  addCategory: async (name, emoji) => {
    const trimmed = name.trim();
    const current = get().categories;
    if (nameTaken(current, trimmed)) throw new Error(CATEGORY_NAME_TAKEN);

    // A name belongs to one category — the same rule as for tags. If a
    // same-named one is in the trash, it comes back, along with what is still in
    // it, instead of a second one being created. The chosen emoji applies.
    const db = await getDb();
    const trashed = (await db.select<DbRow[]>('SELECT * FROM categories WHERE deleted_at IS NOT NULL')).map(fromRow.category);
    const namesake = trashed.find((c) => categoryKey(c.name) === categoryKey(trimmed));
    if (namesake) {
      // There is no active same-named one (checked above) — so it comes back as itself.
      const restoredId = await get().restoreCategory(namesake.id);
      if (!namesake.is_builtin && namesake.emoji !== emoji) await get().updateCategory(restoredId, namesake.name, emoji);
      return get().categories.find((c) => c.id === restoredId)!;
    }

    // To the end. Until v39, new ones were inserted before the catch-all `other`
    // so that it always stayed last — since it became an ordinary category, there
    // is no reason for that any more, and the order belongs to the
    // user anyway (dragging in the categories view).
    const last = get().categories[get().categories.length - 1];
    const sortOrder = (last?.sort_order ?? -1) + 1;

    const cat: Category = {
      id: generateId(), name: trimmed, emoji, sort_order: sortOrder, is_builtin: false, template_id: null, deleted_at: null,
    };
    await db.execute(
      'INSERT INTO categories (id, name, emoji, sort_order, is_builtin) VALUES ($1,$2,$3,$4,0)',
      [cat.id, cat.name, cat.emoji, cat.sort_order]
    );
    set((s) => ({ categories: [...s.categories, cat] }));
    return cat;
  },

  updateCategory: async (id, name, emoji) => {
    // Builtins are named after their locale key; a stored name would be invisible.
    if (get().categories.find((c) => c.id === id)?.is_builtin) return;
    const trimmed = name.trim();
    if (nameTaken(get().categories, trimmed, id)) throw new Error(CATEGORY_NAME_TAKEN);
    const db = await getDb();
    // As when creating: a same-named one in the trash is the same and merges
    // into this one, instead of surprisingly joining in when restored later.
    const trashed = (await db.select<DbRow[]>('SELECT * FROM categories WHERE deleted_at IS NOT NULL')).map(fromRow.category);
    for (const namesake of trashed.filter((c) => c.id !== id && categoryKey(c.name) === categoryKey(trimmed))) {
      await mergeCategory(db, namesake.id, id);
    }
    await db.execute('UPDATE categories SET name=$1, emoji=$2 WHERE id=$3', [trimmed, emoji, id]);
    set((s) => ({ categories: s.categories.map((c) => (c.id === id ? { ...c, name: trimmed, emoji } : c)) }));
  },

  setStartTemplate: async (id, templateId) => {
    const db = await getDb();
    await db.execute('UPDATE categories SET template_id=$1 WHERE id=$2', [templateId, id]);
    set((s) => ({ categories: s.categories.map((c) => (c.id === id ? { ...c, template_id: templateId } : c)) }));
  },

  deleteCategory: async (id) => {
    const cat = get().categories.find((c) => c.id === id);
    if (!cat || cat.is_builtin) return false;
    const db = await getDb();
    // Do NOT reassign on soft delete: the contents keep their category_id
    // (the row stays, the foreign key is satisfied) and appear
    // under "No category". A restore thus brings them back losslessly;
    // reassigning only happens in permanentlyDeleteCategory.
    await db.execute('UPDATE categories SET deleted_at=$1 WHERE id=$2', [nowIso(), id]);
    set((s) => ({ categories: s.categories.filter((c) => c.id !== id) }));
    return true;
  },

  restoreCategory: async (id) => {
    const db = await getDb();
    const rows = await db.select<DbRow[]>('SELECT * FROM categories WHERE id=$1', [id]);
    if (!rows[0]) return id;
    const cat = fromRow.category(rows[0]);
    // Already back — retrieved via its name (addCategory) while
    // the undo was still pending. Adding it a second time would duplicate it.
    if (!cat.deleted_at || get().categories.some((c) => c.id === id)) return id;
    // A same-named active category may have appeared in the meantime: the
    // restored one merges into it, like a tag into its same-named one.
    const active = get().categories;
    const namesake = active.find((c) => c.id !== id && categoryKey(c.name) === categoryKey(cat.name));
    if (namesake) {
      await mergeCategory(db, id, namesake.id);
      return namesake.id;
    }
    // Its old slot has been taken in the meantime (addCategory keeps counting), so to the end of the list.
    const sortOrder = (active[active.length - 1]?.sort_order ?? -1) + 1;
    await db.execute(
      'UPDATE categories SET deleted_at=NULL, sort_order=$1 WHERE id=$2',
      [sortOrder, id]
    );
    set((s) => ({
      categories: [...s.categories, { ...cat, sort_order: sortOrder, deleted_at: null }],
    }));
    return id;
  },

  permanentlyDeleteCategory: async (id) => {
    const db = await getDb();
    await purgeCategory(db, id);
    set((s) => ({ categories: s.categories.filter((c) => c.id !== id) }));
    // In memory too: a later update* would otherwise write the deleted category_id
    // back and fail on the foreign key.
    reassignCategoriesInMemory(new Set([id]));
  },

  reorderCategories: async (ids) => {
    if (!ids.length) return;
    const db = await getDb();
    const params: (string | number)[] = [];
    let caseExpr = '';
    const inParams: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      const idIdx = params.length + 1;
      params.push(ids[i], i);
      caseExpr += ` WHEN $${idIdx} THEN $${idIdx + 1}`;
      inParams.push(`$${idIdx}`);
    }
    await db.execute(
      `UPDATE categories SET sort_order = CASE id${caseExpr} END WHERE id IN (${inParams.join(',')})`,
      params,
    );
    const byId = new Map(get().categories.map((c) => [c.id, c]));
    set({
      categories: ids
        .map((id, i) => byId.get(id) && { ...byId.get(id)!, sort_order: i })
        .filter((c): c is Category => !!c),
    });
  },

  getCategory: (id) => get().categories.find((c) => c.id === id),
}));
