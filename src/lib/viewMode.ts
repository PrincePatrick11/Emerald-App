import type { ViewMode } from '../store/uiStore';

/**
 * Karten und Karten-in-voller-Breite teilen sich dieselbe Kachel — nur das
 * Raster darum unterscheidet sie (Dashboard: drei Spalten gegen eine). Views,
 * die ihre Kachel je nach Ansicht anders bauen, fragen deshalb hier statt auf
 * `view === 'cards'`; sonst fiele der neue Modus in jeder Ansicht einzeln auf
 * den Listen-Zweig zurück.
 */
export const isCardView = (view: ViewMode): boolean => view === 'cards' || view === 'cards_wide';

/** Die volle Breite unter den Kartenansichten: eine Spalte statt drei, und im
 *  Altar zusätzlich eine höhere Vorschau. */
export const isWideCardView = (view: ViewMode): boolean => view === 'cards_wide';
