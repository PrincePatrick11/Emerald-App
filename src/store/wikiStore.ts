import { create } from 'zustand';
import type Database from '@tauri-apps/plugin-sql';
import { getDb, nextEntryNumber } from '../lib/db';
import { generateId, nowIso } from '../lib/helpers';
import { needsWrite, stampFor, type WriteOptions } from '../lib/stamp';
import { serialKey, serialized } from '../lib/serialize';
import { fromRow, type DbRow } from '../lib/row';
import type { WikiArticle } from '../types';
import i18n from '../i18n';
import { displayTitle } from '../lib/entryTitle';
import { startOfNewEntry, useTemplateNoticeStore } from './templateStore';

interface WikiState {
  articles: WikiArticle[];
  loading: boolean;

  fetchArticles: () => Promise<void>;
  /** Mit dem Standard der Kombination (Vorlagen) — außer `blank`. */
  createArticle: (categoryId?: string | null, opts?: { blank?: boolean; createdAt?: string }) => Promise<WikiArticle>;
  duplicateArticle: (id: string) => Promise<WikiArticle | undefined>;
  updateArticle: (id: string, patch: Partial<WikiArticle>, options?: WriteOptions) => Promise<void>;
  deleteArticle: (id: string) => Promise<void>;
  restoreArticle: (id: string) => Promise<void>;
  permanentlyDeleteArticle: (id: string) => Promise<void>;
  getArticle: (id: string) => WikiArticle | undefined;
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

  createArticle: async (categoryId: string | null = null, { blank = false, createdAt } = {}) => {
    const db = await getDb();
    const now = nowIso();
    const id = generateId();
    const entryNumber = await nextEntryNumber(db, 'wiki_articles');
    const start = startOfNewEntry('wiki', categoryId, blank);
    const article: WikiArticle = {
      id,
      entry_number: entryNumber,
      title: start.title,
      content: start.content,
      category_id: categoryId,
      created_at: createdAt ?? now,
      updated_at: now,
      tags: start.tags,
      deleted_at: null,
      cover_image: undefined,
    };
    await db.execute(
      // `slug` ist ein Überbleibsel: NOT NULL UNIQUE, gelesen wird er nicht mehr.
      // Die ID erfüllt beides.
      `INSERT INTO wiki_articles (id, title, slug, content, category_id, created_at, updated_at, tags, entry_number)
       VALUES ($1, $2, $1, $3, $4, $5, $6, $7, $8)`,
      [
        article.id,
        article.title,
        article.content,
        article.category_id,
        article.created_at,
        article.updated_at,
        JSON.stringify(article.tags),
        entryNumber,
      ]
    );
    set((s) => ({ articles: [...s.articles, article] }));
    if (start.templateId) useTemplateNoticeStore.getState().show({ entryId: id, templateId: start.templateId });
    return article;
  },

  /** Kopiert alle Inhaltsfelder; die Identität bleibt beim neuen Artikel. */
  duplicateArticle: async (id) => {
    const src = get().articles.find((a) => a.id === id);
    if (!src) return undefined;
    const copy = await get().createArticle(src.category_id, { blank: true });
    const {
      id: _id,
      created_at: _created,
      updated_at: _updated,
      deleted_at: _deleted,
      entry_number: _number,
      ...fields
    } = src;
    await get().updateArticle(copy.id, { ...fields, title: displayTitle(i18n.t, 'wiki', src.title) + i18n.t('common.copySuffix') });
    return get().articles.find((a) => a.id === copy.id) ?? copy;
  },

  // serialized: siehe lib/serialize.ts.
  updateArticle: (id, patch, { touch } = {}) => serialized(serialKey('wiki', id), async () => {
    const article = get().articles.find((a) => a.id === id);
    if (!article || !needsWrite(article, patch, touch)) return;
    const db = await getDb();
    const merged = {
      ...article,
      ...patch,
      updated_at: stampFor(article.updated_at, touch),
    };

    await db.execute(
      `UPDATE wiki_articles
       SET title=$1, content=$2, category_id=$3, updated_at=$4, tags=$5, cover_image=$6, icon=$7
       WHERE id=$8`,
      [
        merged.title,
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
  }),

  deleteArticle: async (id) => {
    const db = await getDb();
    try {
      const now = nowIso();
      await db.execute(
        'UPDATE wiki_articles SET deleted_at=$1 WHERE id=$2',
        [now, id]
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
  },

  getArticle: (id) => get().articles.find((a) => a.id === id),
}));
