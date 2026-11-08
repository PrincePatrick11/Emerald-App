import { create } from 'zustand';
import { getDb } from '../lib/db';
import { generateId, nowIso } from '../lib/helpers';
import { serialized } from '../lib/serialize';
import { readUserSymbol, type UserSymbol } from '../lib/userSymbols';

/**
 * The vault's own symbols for the canvas editor's library (table `symbols`,
 * since v58), newest first. Made from drawings; removing one takes it out at
 * once, and `restoreSymbol` puts it back for undo.
 */
interface SymbolState {
  symbols: UserSymbol[];
  fetchSymbols: () => Promise<void>;
  addSymbol: (symbol: Pick<UserSymbol, 'name' | 'd' | 'solid' | 'weight'>) => Promise<UserSymbol>;
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
    const symbol: UserSymbol = { id: generateId(), created_at: nowIso(), ...input, name: input.name.trim().slice(0, 80) };
    await insert(symbol);
    set((s) => ({ symbols: newestFirst([symbol, ...s.symbols]) }));
    return symbol;
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
