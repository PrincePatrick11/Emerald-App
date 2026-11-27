import type { ElementDef, FieldPrefill, FieldValue } from './fieldKind';

/**
 * The prefill of a kind whose value is its prefill as it is (short text,
 * number, date, choice, yes/no): checked with `parse`, taken over unchanged.
 */
export function plainPrefill<E extends ElementDef>(parse: (raw: unknown, element: E) => FieldValue | undefined): FieldPrefill<E> {
  return {
    parse,
    toStored: (prefill) => prefill,
    // Unchecked: the builder holds what is typed (a number while retyping); reading the definition checks it.
    fromStored: (stored) => stored,
  };
}
