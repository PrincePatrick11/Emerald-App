/**
 * The connection to a vault database — the interface of
 * `@tauri-apps/plugin-sql`, but via our own commands in `db.rs`.
 *
 * The plugin opened any path the WebView named, and could not encrypt a
 * connection. Here a database is named by vault ID and
 * file; Rust resolves the path through the vault registry.
 *
 * `execute`, `select` and `close` behave as with the plugin: values are
 * bound the same way, rows come as objects in column order, and every
 * statement lands on an arbitrary connection of the pool — a
 * transaction holds only within a single `execute` string.
 */
import { invoke } from '@tauri-apps/api/core';

export interface QueryResult {
  rowsAffected: number;
  lastInsertId?: number;
}

/** The database files of a vault (`DbFile` in `db.rs`). */
export type DbFile = 'main' | 'importStaging';

export default class Database {
  /** The handle under which Rust keeps the pool. */
  readonly path: string;

  private constructor(path: string) {
    this.path = path;
  }

  static async load(vaultId: string, file: DbFile = 'main'): Promise<Database> {
    return new Database(await invoke<string>('db_load', { vaultId, file }));
  }

  async execute(query: string, bindValues?: unknown[]): Promise<QueryResult> {
    const [rowsAffected, lastInsertId] = await invoke<[number, number]>('db_execute', {
      db: this.path,
      query,
      values: bindValues ?? [],
    });
    return { rowsAffected, lastInsertId };
  }

  /**
   * Several statements as one transaction on one connection
   * (`db_batch`) — all or none. A loop over `execute` would commit the
   * file once per statement. Returns the total number of affected rows.
   */
  async batch(statements: ReadonlyArray<readonly [query: string, bindValues?: readonly unknown[]]>): Promise<number> {
    if (!statements.length) return 0;
    return invoke<number>('db_batch', {
      db: this.path,
      statements: statements.map(([query, values]) => [query, values ?? []]),
    });
  }

  async select<T>(query: string, bindValues?: unknown[]): Promise<T> {
    return invoke<T>('db_select', { db: this.path, query, values: bindValues ?? [] });
  }

  /** Closes this pool. Unlike with the plugin, never all of them. */
  async close(): Promise<boolean> {
    return invoke<boolean>('db_close', { db: this.path });
  }
}
