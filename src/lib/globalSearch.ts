import type {
  ActiveView, AltarItem, AltarRecord, JournalEntry, Operation, Tag, Task, WikiArticle,
} from '../types';
import { foldTypography, plainTextFor } from './searchText';
import { viewTypeForEntryType } from './tabs';

/**
 * The global search behind the title bar's field.
 *
 * Everything it reads is already in memory: `AppShell` loads every module into
 * its store at startup and the stores stay in sync on each mutation, so this is
 * a filter over arrays rather than a query. That is also why there is no FTS5
 * table and no migration — one would mean keeping a second copy of every entry
 * in step with the first, for no gain at this size.
 *
 * Kept free of JSX like the rest of `lib/`: which icon a kind gets and what its
 * badge is called is the component's business, and `t()` does not belong here.
 */

export type SearchKind =
  | 'journal' | 'wiki' | 'operation' | 'task'
  | 'altar' | 'altarItem' | 'tag' | 'category';

/** The module a category belongs to, which is the only way to open one. */
export type CategoryModule = 'wiki' | 'operations' | 'tasks' | 'altar';

export interface SearchSnippet {
  before: string;
  match: string;
  after: string;
}

export interface SearchHit {
  /**
   * Stable identity of a hit, unique across the whole result list.
   *
   * `kind` and `id` together are not enough: the four category tables ship the
   * same built-in ids — `other` exists in Wiki, Operations *and* Altar,
   * `herb`/`deity`/`symbol`/`tool` in Wiki and Altar. Two of those are
   * different things that open different modules, so the module is part of
   * what tells them apart.
   */
  key: string;
  kind: SearchKind;
  id: string;
  title: string;
  /** Steers the snippet and which of the two the row highlights. */
  matchedIn: 'title' | 'tag' | 'content';
  /** Only ever set for `matchedIn: 'content'`. */
  snippet?: SearchSnippet;
  /** Only set for `kind: 'category'`. */
  module?: CategoryModule;
  categoryId?: string;
  entryNumber?: number;
  /** Sort tie-break. Tags and categories have no timestamp and pass `''`. */
  updatedAt: string;
  score: number;
}

export interface SearchCategory {
  id: string;
  /** Already translated: built-in categories are named by a locale key. */
  name: string;
  module: CategoryModule;
}

export interface SearchCorpus {
  journal: JournalEntry[];
  wiki: WikiArticle[];
  operations: Operation[];
  tasks: Task[];
  altars: AltarRecord[];
  altarItems: AltarItem[];
  tags: Tag[];
  categories: SearchCategory[];
}

export interface SearchResults {
  /** What the view shows — the head of the sorted list. */
  hits: SearchHit[];
  /** Uncapped, so the list can say how much it is not showing. */
  total: number;
}

/**
 * A single letter matches nearly every body of text, so the content pass waits
 * for the second one. Titles and tags are short enough to stay useful at one.
 */
const MIN_CONTENT_QUERY = 2;

const SNIPPET_LEAD = 40;
const SNIPPET_TRAIL = 80;

const SCORE = {
  titlePrefix: 100,
  title: 80,
  tagExact: 60,
  tag: 50,
  content: 30,
} as const;

function snippetAt(text: string, index: number, length: number): SearchSnippet {
  const start = Math.max(0, index - SNIPPET_LEAD);
  const end = Math.min(text.length, index + length + SNIPPET_TRAIL);
  return {
    before: (start > 0 ? '…' : '') + text.slice(start, index),
    match: text.slice(index, index + length),
    after: text.slice(index + length, end) + (end < text.length ? '…' : ''),
  };
}

/**
 * Both sides of every comparison go through this and nothing else — including
 * the result list's own highlighting, which has to land on exactly the
 * characters this function decided were a match.
 */
export const comparable = (text: string) => foldTypography(text.toLowerCase());

interface FieldMatch {
  matchedIn: SearchHit['matchedIn'];
  score: number;
  snippet?: SearchSnippet;
}

/**
 * Scores one record against the query — the best field wins, not the first.
 *
 * The order is the ranking: a title beats a tag beats the body. `contents` is a
 * thunk because reaching it is the expensive half — for the content fields of
 * the three editor modules it parses HTML — and most records never get there.
 */
function matchRecord(
  q: string,
  title: string,
  tags: string[] | null | undefined,
  contents: () => string[],
): FieldMatch | null {
  const titleIndex = comparable(title).indexOf(q);
  if (titleIndex === 0) return { matchedIn: 'title', score: SCORE.titlePrefix };
  if (titleIndex > 0) return { matchedIn: 'title', score: SCORE.title };

  if (tags?.length) {
    let best = 0;
    for (const tag of tags) {
      const lower = comparable(tag);
      if (lower === q) { best = SCORE.tagExact; break; }
      if (lower.includes(q)) best = SCORE.tag;
    }
    if (best) return { matchedIn: 'tag', score: best };
  }

  if (q.length < MIN_CONTENT_QUERY) return null;
  for (const text of contents()) {
    if (!text) continue;
    // The index comes from the folded text, the snippet is cut from the
    // original — which is why every fold is one character for one character.
    // The highlight then shows the entry's own punctuation, not the query's.
    const index = comparable(text).indexOf(q);
    if (index < 0) continue;
    return { matchedIn: 'content', score: SCORE.content, snippet: snippetAt(text, index, q.length) };
  }
  return null;
}

const notDeleted = <T extends { deleted_at?: string | null }>(item: T) => !item.deleted_at;

/**
 * Scores the whole corpus and returns every hit, best first.
 *
 * Nothing is cut here. How many of them a view shows is the view's business,
 * and keeping the cut out of this function is what lets it show more without
 * searching again.
 */
export function searchCorpus(corpus: SearchCorpus, rawQuery: string): SearchHit[] {
  const q = comparable(rawQuery.trim());
  if (!q) return [];

  const hits: SearchHit[] = [];

  const push = (
    kind: SearchKind,
    id: string,
    title: string,
    match: FieldMatch | null,
    extra: Partial<Pick<SearchHit, 'updatedAt' | 'module' | 'categoryId' | 'entryNumber'>> = {},
  ) => {
    if (!match) return;
    hits.push({
      key: `${kind}:${extra.module ?? ''}:${id}`,
      kind,
      id,
      title,
      updatedAt: '',
      ...extra,
      matchedIn: match.matchedIn,
      snippet: match.snippet,
      score: match.score,
    });
  };

  for (const entry of corpus.journal.filter(notDeleted)) {
    push('journal', entry.id, entry.title,
      matchRecord(q, entry.title, entry.tags,
        () => [plainTextFor(entry.id, entry.updated_at, entry.content)]),
      { updatedAt: entry.updated_at, entryNumber: entry.entry_number });
  }

  for (const article of corpus.wiki.filter(notDeleted)) {
    push('wiki', article.id, article.title,
      // The slug rides along with the tags: it is a short handle the way a tag
      // is, and it is what an internal link spells once the title has drifted.
      matchRecord(q, article.title, [...article.tags, article.slug],
        () => [plainTextFor(article.id, article.updated_at, article.content)]),
      { updatedAt: article.updated_at, categoryId: article.category_id, entryNumber: article.entry_number });
  }

  for (const op of corpus.operations.filter(notDeleted)) {
    push('operation', op.id, op.title,
      matchRecord(q, op.title, op.tags, () => [
        op.description ?? '',
        op.intention_text ?? '',
        plainTextFor(op.id, op.updated_at, op.content),
      ]),
      { updatedAt: op.updated_at, categoryId: op.category_id, entryNumber: op.entry_number });
  }

  for (const task of corpus.tasks.filter(notDeleted)) {
    // `description` is plain text already — no editor ever wrote it.
    push('task', task.id, task.title,
      matchRecord(q, task.title, task.tags, () => [task.description]),
      { updatedAt: task.updated_at, categoryId: task.category_id });
  }

  for (const altar of corpus.altars) {
    push('altar', altar.id, altar.title,
      matchRecord(q, altar.title, null, () => [altar.intention]),
      { updatedAt: altar.updated_at });
  }

  for (const item of corpus.altarItems) {
    push('altarItem', item.id, item.name,
      matchRecord(q, item.name, null, () => [item.note]),
      { categoryId: item.category_id });
  }

  for (const tag of corpus.tags) {
    push('tag', tag.id, tag.name, matchRecord(q, tag.name, null, () => []));
  }

  for (const category of corpus.categories) {
    push('category', category.id, category.name,
      matchRecord(q, category.name, null, () => []),
      { module: category.module });
  }

  hits.sort((a, b) =>
    b.score - a.score
    || b.updatedAt.localeCompare(a.updatedAt)
    || a.title.localeCompare(b.title));

  return hits;
}

/**
 * Where a hit opens.
 *
 * Not every kind has a page of its own: an altar item lives inside the altar
 * module's library and a category is only ever a grouping, so both land on
 * their module rather than on themselves. That is the honest ceiling of what
 * the app can address today, not a shortcut.
 */
export function viewForSearchHit(hit: Pick<SearchHit, 'kind' | 'id' | 'module'>): ActiveView | null {
  switch (hit.kind) {
    case 'journal':
    case 'wiki':
    case 'operation':
      return { type: viewTypeForEntryType(hit.kind), id: hit.id, mode: 'view' };
    case 'altar':
      return { type: 'altar', id: hit.id, mode: 'view' };
    case 'task':
      return { type: 'tasks', id: hit.id };
    case 'altarItem':
      return { type: 'altar' };
    case 'tag':
      // With the id, `TagsView` selects the tag rather than merely opening.
      return { type: 'tags', id: hit.id };
    case 'category':
      return hit.module ? { type: hit.module } : null;
  }
}
