import { create } from 'zustand';
import { getDb } from '../lib/db';
import { generateId, nowIso } from '../lib/helpers';
import { serialized } from '../lib/serialize';
import { readUserSymbol, SYMBOL_NAME_MAX, type UserSymbol } from '../lib/userSymbols';

/**
 * The vault's own symbols for the canvas editor's library (table `symbols`), newest first. Made from drawings; shown and renamed in the
 * collection "Symbols"; removing one takes it out at once, and
 * `restoreSymbol` puts it back for undo.
 */
interface SymbolState {
  symbols: UserSymbol[];
  fetchSymbols: () => Promise<void>;
  addSymbol: (symbol: Pick<UserSymbol, 'name' | 'd' | 'solid' | 'weight'>) => Promise<UserSymbol>;
  /** The name is trimmed and cut to `SYMBOL_NAME_MAX` characters, as on saving; an empty one is allowed (the library shows the symbol unnamed). */
  renameSymbol: (id: string, name: string) => Promise<void>;
  removeSymbol: (id: string) => Promise<UserSymbol | null>;
  restoreSymbol: (symbol: UserSymbol) => Promise<void>;
}

const WRITE_KEY = 'symbols';

async function insert(symbol: UserSymbol): Promise<void> {
  const db = await getDb();
  await db.execute(
    'INSERT OR REPLACE INTO symbols (id, name, d, solid, weight, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [symbol.id, symbol.name, symbol.d, symbol.solid, symbol.weight, symbol.created_at],
  );
}

const newestFirst = (list: UserSymbol[]) => [...list].sort((a, b) => b.created_at.localeCompare(a.created_at));

export const useSymbolStore = create<SymbolState>((set, get) => ({
  symbols: [],

  fetchSymbols: async () => {
    const db = await getDb();
    const rows = await db.select<Record<string, unknown>[]>('SELECT * FROM symbols ORDER BY created_at DESC');
    set({ symbols: rows.map(readUserSymbol).filter((s): s is UserSymbol => !!s) });
  },

  addSymbol: (input) => serialized(WRITE_KEY, async () => {
    const symbol: UserSymbol = { id: generateId(), created_at: nowIso(), ...input, name: input.name.trim().slice(0, SYMBOL_NAME_MAX) };
    await insert(symbol);
    set((s) => ({ symbols: newestFirst([symbol, ...s.symbols]) }));
    return symbol;
  }),

  renameSymbol: (id, name) => serialized(WRITE_KEY, async () => {
    const next = name.trim().slice(0, SYMBOL_NAME_MAX);
    const db = await getDb();
    await db.execute('UPDATE symbols SET name = $1 WHERE id = $2', [next, id]);
    set((s) => ({ symbols: s.symbols.map((x) => (x.id === id ? { ...x, name: next } : x)) }));
  }),

  removeSymbol: (id) => serialized(WRITE_KEY, async () => {
    const symbol = get().symbols.find((s) => s.id === id) ?? null;
    if (!symbol) return null;
    const db = await getDb();
    await db.execute('DELETE FROM symbols WHERE id = $1', [id]);
    set((s) => ({ symbols: s.symbols.filter((x) => x.id !== id) }));
    return symbol;
  }),

  restoreSymbol: (symbol) => serialized(WRITE_KEY, async () => {
    await insert(symbol);
    set((s) => ({ symbols: newestFirst([...s.symbols.filter((x) => x.id !== symbol.id), symbol]) }));
  }),
}));
