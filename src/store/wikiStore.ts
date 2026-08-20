import { create } from 'zustand';
import type Database from '@tauri-apps/plugin-sql';
import { getDb, nextEntryNumber } from '../lib/db';
import { reassignCategoryContent } from '../lib/schema';
import { syncLinks } from '../lib/links';
import { generateId, nowIso } from '../lib/helpers';
import { fromRow, type DbRow } from '../lib/row';
import type { WikiArticle, WikiCategory, WikiCategoryDef } from '../types';

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || generateId();
}

/** slug has a UNIQUE constraint that applies to every row, including
 *  soft-deleted ones — so collisions must be checked against the DB, not just
 *  the in-memory (non-deleted) article list, or a title matching a
 *  soft-deleted article's slug would still fail the UPDATE. Appends
 *  -2, -3, ... until free. */
async function uniqueSlugify(db: Database, title: string, excludeId: string): Promise<string> {
  const base = slugify(title);
  const rows = await db.select<{ slug: string }[]>(
    'SELECT slug FROM wiki_articles WHERE id != $1 AND (slug = $2 OR slug LIKE $3)',
    [excludeId, base, `${base}-%`]
  );
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

interface WikiState {
  articles: WikiArticle[];
  wikiCategories: WikiCategoryDef[];
  loading: boolean;

  fetchArticles: () => Promise<void>;
  fetchCategories: () => Promise<void>;
  createArticle: (categoryId?: WikiCategory) => Promise<WikiArticle>;
  updateArticle: (id: string, patch: Partial<WikiArticle>) => Promise<void>;
  deleteArticle: (id: string) => Promise<void>;
  restoreArticle: (id: string) => Promise<void>;
  permanentlyDeleteArticle: (id: string) => Promise<void>;
  getArticle: (id: string) => WikiArticle | undefined;
  getArticleBySlug: (slug: string) => WikiArticle | undefined;
  addWikiCategory: (name: string, emoji: string) => Promise<WikiCategoryDef>;
  updateWikiCategory: (id: string, name: string, emoji: string) => Promise<void>;
  deleteWikiCategory: (id: string) => Promise<boolean>;
  restoreWikiCategory: (id: string) => Promise<void>;
  permanentlyDeleteWikiCategory: (id: string) => Promise<void>;
}

async function selectAllArticles(db: Database): Promise<WikiArticle[]> {
  const rows = await db.select<DbRow[]>(
    'SELECT * FROM wiki_articles WHERE deleted_at IS NULL ORDER BY title ASC'
  );
  return rows.map(fromRow.wikiArticle);
}

async function selectCategories(db: Database): Promise<WikiCategoryDef[]> {
  const rows = await db.select<DbRow[]>(
    'SELECT * FROM wiki_categories WHERE deleted_at IS NULL ORDER BY sort_order ASC, name ASC'
  );
  return rows.map(fromRow.category);
}

export const useWikiStore = create<WikiState>((set, get) => ({
  articles: [],
  wikiCategories: [],
  loading: false,

  fetchCategories: async () => {
    const db = await getDb();
    set({ wikiCategories: await selectCategories(db) });
  },

  fetchArticles: async () => {
    set({ loading: true });
    try {
      const db = await getDb();
      set({
        articles: await selectAllArticles(db),
        wikiCategories: await selectCategories(db),
      });
    } finally {
      set({ loading: false });
    }
  },

  createArticle: async (categoryId = 'other') => {
    const db = await getDb();
    const now = nowIso();
    const id = generateId();
    const entryNumber = await nextEntryNumber(db, 'wiki_articles');
    const article: WikiArticle = {
      id,
      entry_number: entryNumber,
      title: 'Untitled Article',
      slug: `untitled-${id.slice(0, 8)}`,
      content: '',
      category_id: categoryId,
      created_at: now,
      updated_at: now,
      tags: [],
      deleted_at: null,
      cover_image: undefined,
    };
    await db.execute(
      `INSERT INTO wiki_articles (id, title, slug, content, category_id, created_at, updated_at, tags, entry_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        article.id,
        article.title,
        article.slug,
        article.content,
        article.category_id,
        article.created_at,
        article.updated_at,
        JSON.stringify(article.tags),
        entryNumber,
      ]
    );
    set((s) => ({ articles: [...s.articles, article] }));
    return article;
  },

  updateArticle: async (id, patch) => {
    const db = await getDb();
    const now = nowIso();
    const article = get().articles.find((a) => a.id === id);
    if (!article) return;
    const slug = patch.title && patch.title !== article.title
      ? await uniqueSlugify(db, patch.title, id)
      : article.slug;
    const merged = {
      ...article,
      ...patch,
      updated_at: now,
      slug,
    };

    await db.execute(
      `UPDATE wiki_articles
       SET title=$1, slug=$2, content=$3, category_id=$4, updated_at=$5, tags=$6, cover_image=$7, icon=$8
       WHERE id=$9`,
      [
        merged.title,
        merged.slug,
        merged.content,
        merged.category_id,
        merged.updated_at,
        JSON.stringify(merged.tags),
        merged.cover_image ?? null,
        merged.icon ?? null,
        id,
      ]
    );
    set((s) => ({
      articles: s.articles.map((a) => (a.id === id ? merged : a)),
    }));
    syncLinks(id, 'wiki', merged.content).catch(console.error);
  },

  deleteArticle: async (id) => {
    const db = await getDb();
    try {
      const now = nowIso();
      await db.execute(
        'UPDATE wiki_articles SET deleted_at=$1 WHERE id=$2',
        [now, id]
      );
      await db.execute(
        'DELETE FROM links WHERE source_id=$1 OR target_id=$1',
        [id]
      );
      set((s) => ({ articles: s.articles.filter((a) => a.id !== id) }));
    } catch (e) {
      console.error('[deleteArticle] failed:', e);
      throw e;
    }
  },

  restoreArticle: async (id) => {
    const db = await getDb();
    await db.execute(
      'UPDATE wiki_articles SET deleted_at=NULL WHERE id=$1',
      [id]
    );
    set({ articles: await selectAllArticles(db) });
  },

  permanentlyDeleteArticle: async (id) => {
    const db = await getDb();
    await db.execute('DELETE FROM wiki_articles WHERE id=$1', [id]);
    await db.execute(
      'DELETE FROM links WHERE source_id=$1 OR target_id=$1',
      [id]
    );
  },

  getArticle: (id) => get().articles.find((a) => a.id === id),
  getArticleBySlug: (slug) => get().articles.find((a) => a.slug === slug),

  addWikiCategory: async (name, emoji) => {
    const db = await getDb();
    const cat: WikiCategoryDef = {
      id: generateId(), name, emoji, sort_order: 99, is_builtin: false,
    };
    await db.execute(
      `INSERT INTO wiki_categories (id, name, emoji, sort_order, is_builtin) VALUES ($1,$2,$3,$4,$5)`,
      [cat.id, cat.name, cat.emoji, cat.sort_order, 0]
    );
    set((s) => ({ wikiCategories: [...s.wikiCategories, cat] }));
    return cat;
  },

  updateWikiCategory: async (id, name, emoji) => {
    const db = await getDb();
    await db.execute('UPDATE wiki_categories SET name=$1, emoji=$2 WHERE id=$3', [name, emoji, id]);
    set((s) => ({ wikiCategories: s.wikiCategories.map((c) => c.id === id ? { ...c, name, emoji } : c) }));
  },

  deleteWikiCategory: async (id) => {
    const db = await getDb();
    const cat = get().wikiCategories.find((c) => c.id === id);
    if (!cat || cat.is_builtin) return false;
    await db.execute('UPDATE wiki_categories SET deleted_at=$1 WHERE id=$2', [nowIso(), id]);
    set((s) => ({ wikiCategories: s.wikiCategories.filter((c) => c.id !== id) }));
    return true;
  },

  restoreWikiCategory: async (id) => {
    const db = await getDb();
    await db.execute('UPDATE wiki_categories SET deleted_at=NULL WHERE id=$1', [id]);
    const rows = await db.select<DbRow[]>('SELECT * FROM wiki_categories WHERE id=$1', [id]);
    if (rows[0]) {
      const cat = fromRow.category(rows[0]);
      set((s) => ({ wikiCategories: [...s.wikiCategories, cat].sort((a, b) => a.sort_order - b.sort_order) }));
    }
  },

  permanentlyDeleteWikiCategory: async (id) => {
    const db = await getDb();
    await reassignCategoryContent(db, 'wiki_articles', id);
    await db.execute('DELETE FROM wiki_categories WHERE id=$1', [id]);
  },
}));
