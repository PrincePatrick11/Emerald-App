/**
 * Die eine Kategorienliste für Wiki, Operationen, Aufgaben und Altar-Elemente
 * (Tabelle `categories`, seit v38). Vorher hielt jeder der vier Stores seinen
 * eigenen Slice mit denselben fünf Aktionen.
 *
 * Import-Regel: Dieser Store darf die Inhalts-Stores importieren (er hängt
 * nach dem endgültigen Löschen einer Kategorie deren Inhalte auch im Speicher
 * um); keiner von ihnen importiert zurück. Alle Zugriffe laufen zur Laufzeit
 * über `getState()`.
 */
import { create } from 'zustand';
import { getDb } from '../lib/db';
import { FALLBACK_CATEGORY_ID, reassignCategoryContent } from '../lib/schema';
import { categoryKey } from '../lib/categoryMerge';
import { generateId, nowIso } from '../lib/helpers';
import { fromRow, type DbRow } from '../lib/row';
import type { Category } from '../types';
import { useWikiStore } from './wikiStore';
import { useOperationStore } from './operationStore';
import { useTaskStore } from './taskStore';
import { useAltarStore } from './altarStore';

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
  restoreCategory: (id: string) => Promise<void>;
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

/** Erster freier Name der Form „Name", „Name (2)", „Name (3)", … */
function freeName(categories: Category[], name: string, exceptId: string): string {
  if (!nameTaken(categories, name, exceptId)) return name;
  for (let i = 2; ; i++) {
    const candidate = `${name} (${i})`;
    if (!nameTaken(categories, candidate, exceptId)) return candidate;
  }
}

/**
 * Hängt Inhalte, die auf eine der `ids` zeigen, in den geladenen Stores aufs
 * Sammelbecken um — das Gegenstück zu `reassignCategoryContent` für den
 * Speicher. Auch vom Papierkorb-Leeren benutzt; die vier Store-Formen sollen
 * nur an einer Stelle stehen.
 */
export function reassignCategoriesInMemory(ids: ReadonlySet<string>): void {
  const move = <T extends { category_id: string }>(x: T): T =>
    ids.has(x.category_id) ? { ...x, category_id: FALLBACK_CATEGORY_ID } : x;
  useWikiStore.setState((s) => ({ articles: s.articles.map(move) }));
  useOperationStore.setState((s) => ({ operations: s.operations.map(move) }));
  useTaskStore.setState((s) => ({ tasks: s.tasks.map(move) }));
  useAltarStore.setState((s) => ({
    items: s.items.map(move),
    placements: s.placements.map(move),
    previewPlacements: Object.fromEntries(
      Object.entries(s.previewPlacements).map(([k, list]) => [k, list.map(move)])
    ),
  }));
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

    // Vor dem Sammelbecken einsortieren, solange es am Ende steht — dort hält
    // es die Migration, und dort erwartet man es. Hat der Nutzer es verschoben,
    // kommt Neues schlicht ans Ende.
    const last = current[current.length - 1];
    const fallbackIsLast = last?.id === FALLBACK_CATEGORY_ID;
    const sortOrder = fallbackIsLast ? last.sort_order : (last?.sort_order ?? -1) + 1;

    const db = await getDb();
    if (fallbackIsLast) {
      await db.execute('UPDATE categories SET sort_order=$1 WHERE id=$2', [sortOrder + 1, FALLBACK_CATEGORY_ID]);
    }
    const cat: Category = {
      id: generateId(), name: trimmed, emoji, sort_order: sortOrder, is_builtin: false, deleted_at: null,
    };
    await db.execute(
      'INSERT INTO categories (id, name, emoji, sort_order, is_builtin) VALUES ($1,$2,$3,$4,0)',
      [cat.id, cat.name, cat.emoji, cat.sort_order]
    );
    set((s) => ({
      categories: [
        ...s.categories.map((c) => (fallbackIsLast && c.id === FALLBACK_CATEGORY_ID ? { ...c, sort_order: sortOrder + 1 } : c)),
        cat,
      ].sort((a, b) => a.sort_order - b.sort_order),
    }));
    return cat;
  },

  updateCategory: async (id, name, emoji) => {
    // Builtins heißen nach ihrem Locale-Key; ein gespeicherter Name wäre unsichtbar.
    if (get().categories.find((c) => c.id === id)?.is_builtin) return;
    const trimmed = name.trim();
    if (nameTaken(get().categories, trimmed, id)) throw new Error(CATEGORY_NAME_TAKEN);
    const db = await getDb();
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
    if (!rows[0]) return;
    const cat = fromRow.category(rows[0]);
    // Inzwischen kann eine gleichnamige aktive Kategorie entstanden sein —
    // dann bekommt die zurückgeholte einen Zusatz statt eines Fehlers. Ihr
    // alter Platz ist inzwischen vergeben (addCategory zählt weiter), also
    // ans Ende der Liste.
    const active = get().categories;
    const name = freeName(active, cat.name, id);
    const sortOrder = (active[active.length - 1]?.sort_order ?? -1) + 1;
    await db.execute(
      'UPDATE categories SET deleted_at=NULL, name=$1, sort_order=$2 WHERE id=$3',
      [name, sortOrder, id]
    );
    set((s) => ({
      categories: [...s.categories, { ...cat, name, sort_order: sortOrder, deleted_at: null }],
    }));
  },

  permanentlyDeleteCategory: async (id) => {
    if (id === FALLBACK_CATEGORY_ID) return;
    const db = await getDb();
    // Erst umhängen, dann löschen: die Zeile endgültig zu entfernen, während
    // Inhalte darauf zeigen, verbietet der Foreign Key.
    await reassignCategoryContent(db, id);
    await db.execute('DELETE FROM categories WHERE id=$1', [id]);
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
