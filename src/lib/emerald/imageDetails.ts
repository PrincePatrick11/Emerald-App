import type Database from '../sqlite';
import { generateId, nowIso } from '../helpers';
import { readTags, SQL_PARAM_CHUNK, tagInsertStatements } from '../tagRefs';
import { storedNameStem, type ManifestImage } from './manifest';

/**
 * The details of the pictures in "Images" (`images`, `image_tags`) as a
 * `.emerald` file of entries and templates carries them — out of the vault
 * and back in. Without stores: `scripts/schema-check.mjs` runs both under Node.
 */

/**
 * The details of the stored pictures `files` that are in "Images" — not those
 * in the trash —, with the names of their live tags in their order.
 */
export async function imageDetailsOf(db: Database, files: readonly string[]): Promise<ManifestImage[]> {
  const out: ManifestImage[] = [];
  for (let i = 0; i < files.length; i += SQL_PARAM_CHUNK) {
    const chunk = files.slice(i, i + SQL_PARAM_CHUNK);
    const marks = chunk.map((_, n) => `$${n + 1}`).join(', ');
    const rows = await db.select<{ id: string; file: string; name: string; note: string }[]>(
      `SELECT id, file, name, note FROM images WHERE deleted_at IS NULL AND file IN (${marks})`, chunk,
    );
    // Tags by name — a tag in the trash stays behind, as an item's does (`liveTagNames`).
    const tags = await db.select<{ owner: string; name: string }[]>(
      `SELECT it.image_id AS owner, t.name AS name FROM image_tags it JOIN tags t ON t.id = it.tag_id
        JOIN images i ON i.id = it.image_id
        WHERE i.deleted_at IS NULL AND i.file IN (${marks}) AND t.deleted_at IS NULL ORDER BY it.rowid`,
      chunk,
    );
    for (const row of rows) {
      const names = tags.filter((t) => t.owner === row.id).map((t) => t.name);
      out.push({ file: row.file, name: row.name, note: row.note, tags: names });
    }
  }
  return out;
}

/**
 * Takes the pictures of a file into "Images" with their details. `storedNames`:
 * the hash part of a name in the file → the name stored here; a picture the
 * file did not bring is skipped. `tagIdsOf` turns the tag names into IDs of
 * this vault, by the rule items follow.
 *
 * A picture not yet in "Images" arrives with name, note and tags. One already
 * there (the same file: the same vault, not compressed on export) keeps a name
 * and note it has, takes the file's where empty, gains the tags and comes back
 * from the trash — close to `useImageStore.takeIn`, which leaves the note alone.
 *
 * Returns how many pictures were added or changed.
 */
export async function importImageDetails(
  db: Database,
  details: readonly ManifestImage[],
  storedNames: ReadonlyMap<string, string>,
  tagIdsOf: (names: string[]) => Promise<string[]>,
): Promise<number> {
  let changed = 0;
  const done = new Set<string>();
  for (const detail of details) {
    const file = storedNames.get(storedNameStem(detail.file));
    if (!file || done.has(file)) continue;
    done.add(file);
    const tags = await tagIdsOf(detail.tags);
    const at = nowIso();
    const [row] = await db.select<{ id: string; name: string; note: string; deleted_at: string | null }[]>(
      'SELECT id, name, note, deleted_at FROM images WHERE file=$1', [file],
    );
    if (!row) {
      const id = generateId();
      await db.batch([
        [
          'INSERT INTO images (id, file, name, note, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$5)',
          [id, file, detail.name, detail.note, at],
        ],
        ...tagInsertStatements('image', id, tags),
      ]);
      changed++;
      continue;
    }
    const known = new Set(await readTags(db, 'image', row.id));
    const added = tags.filter((id) => !known.has(id));
    const name = row.name || detail.name;
    const note = row.note || detail.note;
    if (!row.deleted_at && !added.length && name === row.name && note === row.note) continue;
    await db.batch([
      [
        // Taken in anew, as from the disk: the places it was taken out of are forgotten.
        `UPDATE images SET name=$1, note=$2, updated_at=$3${row.deleted_at ? ", deleted_at=NULL, detached='[]'" : ''} WHERE id=$4`,
        [name, note, at, row.id],
      ],
      ...tagInsertStatements('image', row.id, added),
    ]);
    changed++;
  }
  return changed;
}
