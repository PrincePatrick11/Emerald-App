/**
 * Queues asynchronous tasks with the same key strictly one after another.
 *
 * Why: the update methods of the content stores read a snapshot from the
 * store, mix in the patch and write the COMPLETE row back to the
 * database. If two updates for the same entry overlap (e.g.
 * editor autosave and a property change from the sidebar), the second
 * takes its snapshot before the first has updated the store — its UPDATE
 * then overwrites the first's freshly saved fields with the old
 * state. Serialized per entry ID, the second only starts once the first
 * is done including `set()`, and sees its result in the snapshot.
 *
 * Keys come from `serialKey`, so that the same domain does not run under two
 * spellings. A task must not await another serialized task under its own
 * key — it would wait for itself and
 * stand forever. The chain deliberately has no timeout: a task that never
 * settles occupies its key permanently.
 */
const tails = new Map<string, Promise<void>>();

export function serialKey(
  domain:
    | 'entry' | 'task' | 'tag' | 'blockDefinition' | 'template'
    | 'language' | 'image',
  id: string,
): string {
  return `${domain}:${id}`;
}

/**
 * The one key of handing out entry numbers: `createEntry` and the sync (a page
 * of changes, a snapshot restore) both read the highest number and write later,
 * and the number is unique (`idx_entries_number`).
 */
export const ENTRY_NUMBER_KEY = serialKey('entry', '#new');

/**
 * Waits until all currently queued chains have drained. For the
 * moments when the database is swapped out from under the stores
 * (vault switch, replace import): tasks that queue up afterwards must be
 * prevented by the caller itself (editor lock, navigating away from the entry).
 */
export function drainSerialized(): Promise<void> {
  return Promise.all([...tails.values()]).then(() => undefined);
}

/** Waits until everything currently queued under `key` is done — without writing anything itself. */
export function settled(key: string): Promise<void> {
  return serialized(key, async () => {});
}

export function serialized<T>(key: string, task: () => Promise<T>): Promise<T> {
  // The remembered chain end is error-handled — a failed update must not
  // drag its successors down. It is logged here anyway: many callers
  // are fire-and-forget, and because the tail "handles" the rejection, there
  // would otherwise not even be the unhandled-rejection message in the console.
  // The caller itself sees the rejection of its own task unchanged.
  const prev = tails.get(key) ?? Promise.resolve();
  const run = prev.then(task);
  const tail = run.then(
    () => undefined,
    (err) => { console.error(`[serialized] ${key} failed:`, err); },
  );
  tails.set(key, tail);
  // Clear finished chains out of the map, otherwise it keeps growing with every
  // ID ever touched.
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}
