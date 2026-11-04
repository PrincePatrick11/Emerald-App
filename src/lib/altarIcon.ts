import { createLucideIcon } from 'lucide-react';

/** Lucide has no altar: a candle on a table, drawn to its grid and stroke. */
export const AltarIcon = createLucideIcon('Altar', [
  ['path', { d: 'M12 2c-1.2 1.4-1.8 2.3-1.8 3.3a1.8 1.8 0 0 0 3.6 0C13.8 4.3 13.2 3.4 12 2z', key: 'flame' }],
  ['path', { d: 'M12 9v3', key: 'candle' }],
  ['path', { d: 'M3 12h18', key: 'top' }],
  ['path', { d: 'M6 12v9', key: 'left' }],
  ['path', { d: 'M18 12v9', key: 'right' }],
  ['path', { d: 'M6 17h12', key: 'shelf' }],
]);
