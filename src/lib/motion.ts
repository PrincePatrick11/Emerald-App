/**
 * The spring with which framer-motion `Reorder` lists move their items to the new
 * position — tab bar, block stack, block management. One constant,
 * so that all reorderable lists feel the same.
 */
export const REORDER_SPRING = { type: 'spring', stiffness: 520, damping: 38, mass: 0.65 } as const;
