import { create } from 'zustand';
import { getDb } from '../lib/db';
import { syncLinks } from '../lib/links';
import { generateId, nowIso } from '../lib/helpers';
import type { WikiArticle, WikiCategory, WikiCategoryDef } from '../types';

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || generateId();
}

interface WikiState {
  articles: WikiArticle[];
  wikiCategories: WikiCategoryDef[];
  loading: boolean;

  fetchArticles: () => Promise<void>;
  fetchCategories: () => Promise<void>;
  createArticle: (category?: WikiCategory) => Promise<WikiArticle>;
  updateArticle: (id: string, patch: Partial<WikiArticle>) => Promise<void>;
  deleteArticle: (id: string) => Promise<void>;
  restoreArticle: (id: string) => Promise<void>;
  permanentlyDeleteArticle: (id: string) => Promise<void>;
  getArticle: (id: string) => WikiArticle | undefined;
  getArticleBySlug: (slug: string) => WikiArticle | undefined;
  addWikiCategory: (name: string, emoji: string) => Promise<WikiCategoryDef>;
  updateWikiCategory: (id: string, name: string, emoji: string) => Promise<void>;
  deleteWikiCategory: (id: string) => Promise<void>;
  restoreWikiCategory: (id: string) => Promise<void>;
  permanentlyDeleteWikiCategory: (id: string) => Promise<void>;
}

export const useWikiStore = create<WikiState>((set, get) => ({
  articles: [],
  wikiCategories: [],
  loading: false,

  fetchCategories: async () => {
    const db = await getDb();
    const rows = await db.select<WikiCategoryDef[]>(
      'SELECT * FROM wiki_categories WHERE deleted_at IS NULL ORDER BY sort_order ASC, name ASC'
    );
    const wikiCategories = rows.map((r) => ({
      ...r,
      is_builtin: (r.is_builtin as unknown as number) !== 0,
    }));
    set({ wikiCategories });
  },

  fetchArticles: async () => {
    set({ loading: true });
    try {
      const db = await getDb();
      const catRows = await db.select<WikiCategoryDef[]>(
        'SELECT * FROM wiki_categories WHERE deleted_at IS NULL ORDER BY sort_order ASC, name ASC'
      );
      const wikiCategories = catRows.map((r) => ({
        ...r,
        is_builtin: (r.is_builtin as unknown as number) !== 0,
      }));
      const rows = await db.select<WikiArticle[]>(
        'SELECT *, ROWID as entry_number FROM wiki_articles WHERE deleted_at IS NULL ORDER BY title ASC'
      );
      const articles = rows.map((r) => ({
        ...r,
        tags: typeof r.tags === 'string' ? JSON.parse(r.tags) : r.tags,
      }));
      set({ articles, wikiCategories });
    } finally {
      set({ loading: false });
    }
  },

  createArticle: async (category = 'other') => {
    const db = await getDb();
    const now = nowIso();
    const id = generateId();
    const article: WikiArticle = {
      id,
      title: 'Untitled Article',
      slug: `untitled-${id.slice(0, 8)}`,
      content: '',
      category,
      created_at: now,
      updated_at: now,
      tags: [],
      deleted_at: null,
      cover_image: undefined,
    };
    await db.execute(
      `INSERT INTO wiki_articles (id, title, slug, content, category, created_at, updated_at, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        article.id,
        article.title,
        article.slug,
        article.content,
        article.category,
        article.created_at,
        article.updated_at,
        JSON.stringify(article.tags),
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
    const merged = {
      ...article,
      ...patch,
      updated_at: now,
      slug: patch.title && patch.title !== article.title ? slugify(patch.title) : article.slug,
    };

    await db.execute(
      `UPDATE wiki_articles
       SET title=$1, slug=$2, content=$3, category=$4, updated_at=$5, tags=$6, cover_image=$7, icon=$8
       WHERE id=$9`,
      [
        merged.title,
        merged.slug,
        merged.content,
        merged.category,
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
    const rows = await db.select<WikiArticle[]>(
      'SELECT *, ROWID as entry_number FROM wiki_articles WHERE deleted_at IS NULL ORDER BY title ASC'
    );
    const articles = rows.map((r) => ({
      ...r,
      tags: typeof r.tags === 'string' ? JSON.parse(r.tags) : r.tags,
    }));
    set({ articles });
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
    if (!cat || cat.is_builtin) return;
    await db.execute('UPDATE wiki_categories SET deleted_at=$1 WHERE id=$2', [nowIso(), id]);
    set((s) => ({ wikiCategories: s.wikiCategories.filter((c) => c.id !== id) }));
  },

  restoreWikiCategory: async (id) => {
    const db = await getDb();
    await db.execute('UPDATE wiki_categories SET deleted_at=NULL WHERE id=$1', [id]);
    const rows = await db.select<WikiCategoryDef[]>('SELECT * FROM wiki_categories WHERE id=$1', [id]);
    if (rows[0]) {
      const cat = { ...rows[0], is_builtin: (rows[0].is_builtin as unknown as number) !== 0 };
      set((s) => ({ wikiCategories: [...s.wikiCategories, cat].sort((a, b) => a.sort_order - b.sort_order) }));
    }
  },

  permanentlyDeleteWikiCategory: async (id) => {
    const db = await getDb();
    await db.execute('DELETE FROM wiki_categories WHERE id=$1', [id]);
  },
}));
