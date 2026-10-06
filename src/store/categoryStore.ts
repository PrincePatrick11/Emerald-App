/**
 * Die eine Kategorienliste für Wiki, Operationen, Aufgaben und Altar-Elemente
 * (Tabelle `categories`, seit v38). Vorher hielt jeder der vier Stores seinen
 * eigenen Slice mit denselben fünf Aktionen.
 *
 * Import-Regel: Dieser Store darf die Inhalts-Stores und den Vorlagen-Store
 * importieren (er hängt nach dem endgültigen Löschen einer Kategorie deren
 * Inhalte und Vorlagen-Zuweisungen auch im Speicher um); keiner von ihnen
 * importiert zurück. Alle Zugriffe laufen zur Laufzeit
 * über `getState()`.
 */
import { create } from 'zustand';
import { getDb } from '../lib/db';
import { purgeCategory, reassignCategoryContent } from '../lib/schema';
import { categoryKey } from '../lib/categoryMerge';
import { generateId, nowIso } from '../lib/helpers';
import { fromRow, type DbRow } from '../lib/row';
import type { Category } from '../types';
import { useEntryStore } from './entryStore';
import { reassignBaselineCategories } from './entryEdit';
import { useTaskStore } from './taskStore';
import { useAltarStore } from './altarStore';
import { dropCategoriesFromTemplatesInMemory, useTemplateStore } from './templateStore';

/** Fehlermeldung von addCategory/updateCategory, wenn der Name schon vergeben ist. */
export const CATEGORY_NAME_TAKEN = 'CATEGORY_NAME_TAKEN';

export interface CategoryState {
  /** Aktive Kategorien in Anzeigereihenfolge. */
  categories: Category[];

  fetchCategories: () => Promise<void>;
  addCategory: (name: string, emoji: string) => Promise<Category>;
  updateCategory: (id: string, name: string, emoji: string) => Promise<void>;
  /** Soft-Delete. `false`, wenn die Kategorie eingebaut ist. */
  deleteCategory: (id: string) => Promise<boolean>;
  /** Die id der Kategorie, in der der Inhalt jetzt steht — die eigene, oder die gleichnamige, in der sie aufging. */
  restoreCategory: (id: string) => Promise<string>;
  permanentlyDeleteCategory: (id: string) => Promise<void>;
  /** Schreibt die komplette Reihenfolge der aktiven Kategorien. */
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
 * Hängt Inhalte, die auf eine der `ids` zeigen, in den geladenen Stores auf
 * `to` um (`null` = ohne Kategorie) — das Gegenstück zu
 * `reassignCategoryContent` für den Speicher. Auch vom Papierkorb-Leeren
 * benutzt; die vier Store-Formen sollen nur an einer Stelle stehen. Vorlagen
 * verlieren die Zuweisung nur ohne `to`; beim Zusammenlegen lädt
 * `mergeCategory` sie neu.
 */
export function reassignCategoriesInMemory(ids: ReadonlySet<string>, to: string | null = null): void {
  const move = <T extends { category_id: string | null }>(x: T): T =>
    x.category_id && ids.has(x.category_id) ? { ...x, category_id: to } : x;
  useEntryStore.setState((s) => ({ entries: { ...s.entries, wiki: s.entries.wiki.map(move), operation: s.entries.operation.map(move) } }));
  useTaskStore.setState((s) => ({ tasks: s.tasks.map(move) }));
  useAltarStore.setState((s) => ({
    items: s.items.map(move),
    placements: s.placements.map(move),
    previewPlacements: Object.fromEntries(
      Object.entries(s.previewPlacements).map(([k, list]) => [k, list.map(move)])
    ),
  }));
  // Auch, was eine laufende Bearbeitung mit Cancel zurückschriebe.
  reassignBaselineCategories(ids, to);
  if (!to) dropCategoriesFromTemplatesInMemory(ids);
}

/**
 * Ein Name gehört einer Kategorie: `from` geht in `to` auf — ihr Inhalt und
 * ihre Vorlagen-Zuweisungen ziehen hinüber, die Zeile verschwindet.
 */
async function mergeCategory(db: Awaited<ReturnType<typeof getDb>>, from: string, to: string): Promise<void> {
  await reassignCategoryContent(db, from, to);
  await db.execute('DELETE FROM categories WHERE id=$1', [from]);
  reassignCategoriesInMemory(new Set([from]), to);
  await useTemplateStore.getState().fetchTemplates();
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

    // Ein Name gehört einer Kategorie — dieselbe Regel wie bei Tags. Liegt eine
    // gleichnamige im Papierkorb, kommt sie zurück, samt dem, was noch in ihr
    // steht, statt dass eine zweite entsteht. Das gewählte Emoji gilt.
    const db = await getDb();
    const trashed = (await db.select<DbRow[]>('SELECT * FROM categories WHERE deleted_at IS NOT NULL')).map(fromRow.category);
    const namesake = trashed.find((c) => categoryKey(c.name) === categoryKey(trimmed));
    if (namesake) {
      // Eine aktive Gleichnamige gibt es nicht (oben geprüft) — sie kommt also als sie selbst zurück.
      const restoredId = await get().restoreCategory(namesake.id);
      if (!namesake.is_builtin && namesake.emoji !== emoji) await get().updateCategory(restoredId, namesake.name, emoji);
      return get().categories.find((c) => c.id === restoredId)!;
    }

    // Ans Ende. Bis v39 schob sich Neues vor das Sammelbecken `other`, damit
    // das immer letztes blieb — seit es eine gewöhnliche Kategorie ist, gibt
    // es dafür keinen Grund mehr, und die Reihenfolge gehört ohnehin dem
    // Nutzer (Ziehen in der Kategorien-Ansicht).
    const last = get().categories[get().categories.length - 1];
    const sortOrder = (last?.sort_order ?? -1) + 1;

    const cat: Category = {
      id: generateId(), name: trimmed, emoji, sort_order: sortOrder, is_builtin: false, deleted_at: null,
    };
    await db.execute(
      'INSERT INTO categories (id, name, emoji, sort_order, is_builtin) VALUES ($1,$2,$3,$4,0)',
      [cat.id, cat.name, cat.emoji, cat.sort_order]
    );
    set((s) => ({ categories: [...s.categories, cat] }));
    return cat;
  },

  updateCategory: async (id, name, emoji) => {
    // Builtins heißen nach ihrem Locale-Key; ein gespeicherter Name wäre unsichtbar.
    if (get().categories.find((c) => c.id === id)?.is_builtin) return;
    const trimmed = name.trim();
    if (nameTaken(get().categories, trimmed, id)) throw new Error(CATEGORY_NAME_TAKEN);
    const db = await getDb();
    // Wie beim Anlegen: eine gleichnamige im Papierkorb ist dieselbe und geht
    // in dieser auf, statt beim Wiederherstellen später überraschend dazuzukommen.
    const trashed = (await db.select<DbRow[]>('SELECT * FROM categories WHERE deleted_at IS NOT NULL')).map(fromRow.category);
    for (const namesake of trashed.filter((c) => c.id !== id && categoryKey(c.name) === categoryKey(trimmed))) {
      await mergeCategory(db, namesake.id, id);
    }
    await db.execute('UPDATE categories SET name=$1, emoji=$2 WHERE id=$3', [trimmed, emoji, id]);
    set((s) => ({ categories: s.categories.map((c) => (c.id === id ? { ...c, name: trimmed, emoji } : c)) }));
  },

  deleteCategory: async (id) => {
    const cat = get().categories.find((c) => c.id === id);
    if (!cat || cat.is_builtin) return false;
    const db = await getDb();
    // Beim Soft-Delete NICHT umhängen: die Inhalte behalten ihre category_id
    // (die Zeile bleibt stehen, der Foreign Key ist zufrieden) und erscheinen
    // unter „Ohne Kategorie". Ein Restore holt sie so verlustfrei zurück;
    // umgehängt wird erst in permanentlyDeleteCategory.
    await db.execute('UPDATE categories SET deleted_at=$1 WHERE id=$2', [nowIso(), id]);
    set((s) => ({ categories: s.categories.filter((c) => c.id !== id) }));
    return true;
  },

  restoreCategory: async (id) => {
    const db = await getDb();
    const rows = await db.select<DbRow[]>('SELECT * FROM categories WHERE id=$1', [id]);
    if (!rows[0]) return id;
    const cat = fromRow.category(rows[0]);
    // Schon wieder da — über ihren Namen zurückgeholt (addCategory), während
    // das Rückgängig noch stand. Ein zweites Mal hinzufügen hieße doppelt.
    if (!cat.deleted_at || get().categories.some((c) => c.id === id)) return id;
    // Inzwischen kann eine gleichnamige aktive Kategorie entstanden sein: die
    // zurückgeholte geht in ihr auf, wie ein Tag in seinem gleichnamigen.
    const active = get().categories;
    const namesake = active.find((c) => c.id !== id && categoryKey(c.name) === categoryKey(cat.name));
    if (namesake) {
      await mergeCategory(db, id, namesake.id);
      return namesake.id;
    }
    // Ihr alter Platz ist inzwischen vergeben (addCategory zählt weiter), also ans Ende der Liste.
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
    // Auch im Speicher: ein späteres update* würde die gelöschte category_id
    // sonst zurückschreiben und am Foreign Key scheitern.
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
