export const OP_PROP_SELECT_CLASSES =
  'op-prop-select w-full bg-stone-800/60 rounded-md px-3 py-1.5 text-xs text-stone-300 outline-none ' +
  'border border-stone-700/40 focus:border-stone-600 transition-colors placeholder-stone-700';

/**
 * Die Fläche einer Zeile in den Seitenleisten-Listen mit Griff — platzierte
 * Elemente des Altars, Block-Verwaltung: gezogen, ausgewählt oder ruhend. Eine
 * Tailwind-Kette statt einer `@apply`-Klasse: die Parchment-Brücke in
 * `index.css` hängt an genau diesen Klassennamen.
 */
export function sidebarRowStateClasses({ dragging, selected }: { dragging: boolean; selected: boolean }): string {
  if (dragging) return 'border-jade-500/60 bg-jade-900/20 text-stone-300 opacity-50 scale-[0.98]';
  if (selected) return 'border-jade-600/70 bg-jade-900/40 text-jade-300';
  return 'border-stone-700/60 bg-stone-900/45 text-stone-400 hover:border-stone-500/70 hover:text-stone-300';
}
