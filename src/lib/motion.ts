/**
 * Die Feder, mit der framer-motion-`Reorder`-Listen ihre Einträge an den neuen
 * Platz schieben — Tab-Leiste, Blockstapel, Block-Verwaltung. Eine Konstante,
 * damit sich alle Umsortier-Listen gleich anfühlen.
 */
export const REORDER_SPRING = { type: 'spring', stiffness: 520, damping: 38, mass: 0.65 } as const;
