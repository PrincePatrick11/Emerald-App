import { getDb } from './db';

export interface BacklinkEntry {
  id: string;
  title: string;
  type: 'journal' | 'wiki' | 'operation';
}

/** Parses HTML content and returns all internal link nodes found. */
function extractInternalLinks(
  html: string
): Array<{ id: string; entryType: string }> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const spans = doc.querySelectorAll('span[data-type="internalLink"]');
  return Array.from(spans).map((span) => ({
    id: span.getAttribute('data-id') ?? '',
    entryType: span.getAttribute('data-entry-type') ?? 'wiki',
  })).filter((l) => l.id);
}

/** Updates the links table for a given source after content is saved. */
export async function syncLinks(
  sourceId: string,
  sourceType: 'journal' | 'wiki' | 'operation',
  content: string
): Promise<void> {
  const db = await getDb();
  const links = extractInternalLinks(content);

  await db.execute('DELETE FROM links WHERE source_id=$1', [sourceId]);

  for (const link of links) {
    await db.execute(
      `INSERT OR IGNORE INTO links (source_id, source_type, target_id, target_type)
       VALUES ($1, $2, $3, $4)`,
      [sourceId, sourceType, link.id, link.entryType]
    );
  }
}

/** Returns all entries/articles that link TO the given target. */
export async function fetchBacklinks(
  targetId: string
): Promise<BacklinkEntry[]> {
  const db = await getDb();

  const journalLinks = await db.select<
    Array<{ id: string; title: string }>
  >(
    `SELECT je.id, je.title FROM links l
     JOIN journal_entries je ON l.source_id = je.id
     WHERE l.target_id = $1 AND l.source_type = 'journal'`,
    [targetId]
  );

  const wikiLinks = await db.select<
    Array<{ id: string; title: string }>
  >(
    `SELECT wa.id, wa.title FROM links l
     JOIN wiki_articles wa ON l.source_id = wa.id
     WHERE l.target_id = $1 AND l.source_type = 'wiki'`,
    [targetId]
  );

  const operationLinks = await db.select<
    Array<{ id: string; title: string }>
  >(
    `SELECT o.id, o.title FROM links l
     JOIN operations o ON l.source_id = o.id
     WHERE l.target_id = $1 AND l.source_type = 'operation'`,
    [targetId]
  );

  return [
    ...journalLinks.map((r) => ({ ...r, type: 'journal' as const })),
    ...wikiLinks.map((r) => ({ ...r, type: 'wiki' as const })),
    ...operationLinks.map((r) => ({ ...r, type: 'operation' as const })),
  ];
}
