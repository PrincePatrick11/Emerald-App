import type { ViewMode } from '../store/uiStore';

/**
 * Cards and full-width cards share the same tile — only the surrounding
 * grid distinguishes them (dashboard: three columns versus one). Views
 * that build their tile differently depending on the view therefore ask here instead of testing
 * `view === 'cards'`; otherwise the new mode would fall back to the list
 * branch separately in every view.
 */
export const isCardView = (view: ViewMode): boolean => view === 'cards' || view === 'cards_wide';

/** The full width among the card views: one column instead of three. */
export const isWideCardView = (view: ViewMode): boolean => view === 'cards_wide';
