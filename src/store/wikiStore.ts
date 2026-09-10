import { create } from 'zustand';
import type Database from '@tauri-apps/plugin-sql';
import { getDb, nextEntryNumber } from '../lib/db';
import { syncLinks } from '../lib/links';
import { generateId, nowIso } from '../lib/helpers';
import { serialKey, serialized } from '../lib/serialize';
import { fromRow, type DbRow } from '../lib/row';
import type { WikiArticle } from '../types';
import i18n from '../i18n';

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
  loading: boolean;

  fetchArticles: () => Promise<void>;
  createArticle: (categoryId?: string | null) => Promise<WikiArticle>;
  duplicateArticle: (id: string) => Promise<WikiArticle | undefined>;
  updateArticle: (id: string, patch: Partial<WikiArticle>) => Promise<void>;
  deleteArticle: (id: string) => Promise<void>;
  restoreArticle: (id: string) => Promise<void>;
  permanentlyDeleteArticle: (id: string) => Promise<void>;
  getArticle: (id: string) => WikiArticle | undefined;
  getArticleBySlug: (slug: string) => WikiArticle | undefined;
}

async function selectAllArticles(db: Database): Promise<WikiArticle[]> {
  const rows = await db.select<DbRow[]>(
    'SELECT * FROM wiki_articles WHERE deleted_at IS NULL ORDER BY title ASC'
  );
  return rows.map(fromRow.wikiArticle);
}

export const useWikiStore = create<WikiState>((set, get) => ({
  articles: [],
  loading: false,

  fetchArticles: async () => {
    set({ loading: true });
    try {
      const db = await getDb();
      set({ articles: await selectAllArticles(db) });
    } finally {
      set({ loading: false });
    }
  },

  createArticle: async (categoryId: string | null = null) => {
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

  /**
   * Kopiert alle Inhaltsfelder; Slug und Identitaet bleiben beim neuen
   * Artikel (updateArticle vergibt fuer den "(Copy)"-Titel selbst einen
   * eindeutigen Slug). Ersetzt die frueher dreifach kopierten Feldlisten.
   */
  duplicateArticle: async (id) => {
    const src = get().articles.find((a) => a.id === id);
    if (!src) return undefined;
    const copy = await get().createArticle(src.category_id);
    const {
      id: _id,
      slug: _slug,
      created_at: _created,
      updated_at: _updated,
      deleted_at: _deleted,
      entry_number: _number,
      ...fields
    } = src;
    await get().updateArticle(copy.id, { ...fields, title: src.title + i18n.t('common.copySuffix') });
    return get().articles.find((a) => a.id === copy.id) ?? copy;
  },

  // serialized: siehe lib/serialize.ts.
  updateArticle: (id, patch) => serialized(serialKey('wiki', id), async () => {
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
    // Eigener Schlüssel statt awaiten — wie in journalStore.updateEntry.
    void serialized(serialKey('links', id), () => syncLinks(id, 'wiki', merged.content));
  }),

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
}));
