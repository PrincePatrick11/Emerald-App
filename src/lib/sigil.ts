import type { Operation } from '../types';

/**
 * A loaded sigil hidden in all three places (drawing, intention, letter bank)
 * with a reveal date: hidden automatically until that date. Shared by the
 * sigil view, which reveals it once the date has come, and the export.
 */
export function isAutoHiddenSigil(op: Pick<Operation,
  'is_loaded' | 'target_reveal_date' | 'show_sigil' | 'show_intention_in_properties' | 'show_letter_bank_in_properties'>): boolean {
  return !!op.is_loaded && !!op.target_reveal_date
    && op.show_sigil === false
    && op.show_intention_in_properties === false
    && op.show_letter_bank_in_properties === false;
}

/** Today as yyyy-MM-dd (UTC), the form reveal dates are compared in. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
