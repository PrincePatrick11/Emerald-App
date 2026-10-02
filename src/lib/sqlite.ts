/**
 * Die Verbindung zu einer Vault-Datenbank — die Schnittstelle von
 * `@tauri-apps/plugin-sql`, aber über die eigenen Befehle in `db.rs`.
 *
 * Das Plugin öffnete jeden Pfad, den die WebView nannte, und konnte eine
 * Verbindung nicht verschlüsseln. Hier wird eine Datenbank über Vault-Id und
 * Datei benannt; den Pfad löst Rust über die Vault-Registry auf.
 *
 * `execute`, `select` und `close` verhalten sich wie beim Plugin: Werte werden
 * genauso gebunden, Zeilen kommen als Objekte in Spaltenreihenfolge, und jede
 * Anweisung landet auf einer beliebigen Verbindung des Pools — eine
 * Transaktion hält nur innerhalb eines `execute`-Strings.
 */
import { invoke } from '@tauri-apps/api/core';

export interface QueryResult {
  rowsAffected: number;
  lastInsertId?: number;
}

/** Die Datenbankdateien eines Vaults (`DbFile` in `db.rs`). */
export type DbFile = 'main' | 'importStaging';

export default class Database {
  /** Der Handle, unter dem Rust den Pool führt. */
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
   * Mehrere Anweisungen als eine Transaktion auf einer Verbindung
   * (`db_batch`) — alle oder keine. Eine Schleife über `execute` schriebe die
   * Datei je Anweisung einmal fest. Liefert die betroffenen Zeilen insgesamt.
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

  /** Schließt diesen Pool. Anders als beim Plugin nie alle. */
  async close(): Promise<boolean> {
    return invoke<boolean>('db_close', { db: this.path });
  }
}
