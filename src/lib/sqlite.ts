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

  async select<T>(query: string, bindValues?: unknown[]): Promise<T> {
    return invoke<T>('db_select', { db: this.path, query, values: bindValues ?? [] });
  }

  /** Schließt diesen Pool. Anders als beim Plugin nie alle. */
  async close(): Promise<boolean> {
    return invoke<boolean>('db_close', { db: this.path });
  }
}
