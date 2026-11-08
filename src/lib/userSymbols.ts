import { isSymbolPath, MAX_WEIGHT, MIN_WEIGHT } from '../components/editors/canvas/symbols/limits';

/** A symbol of the vault's own, as the table `symbols` holds it (since v58). */
export interface UserSymbol {
  id: string;
  name: string;
  /** Lines, path data in a box of 100 × 100; may be empty when it is all `solid`. */
  d: string;
  /** Filled parts, path data in the same box. */
  solid: string;
  weight: number;
  created_at: string;
}

/** A row as stored or from a foreign file: `null` if it has no id or no usable path at all. */
export function readUserSymbol(row: Record<string, unknown>): UserSymbol | null {
  const id = typeof row.id === 'string' ? row.id : '';
  const d = isSymbolPath(row.d) ? row.d : '';
  const solid = isSymbolPath(row.solid) ? row.solid : '';
  if (!id || (!d && !solid)) return null;
  const weight = Number(row.weight);
  return {
    id,
    name: typeof row.name === 'string' ? row.name.slice(0, 80) : '',
    d,
    solid,
    weight: Number.isFinite(weight) ? Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, weight)) : 5,
    created_at: typeof row.created_at === 'string' && row.created_at ? row.created_at : new Date().toISOString(),
  };
}

/** The id in the symbol library: own symbols live in the pack `own`. */
export const userSymbolId = (id: string) => `own.${id}`;
