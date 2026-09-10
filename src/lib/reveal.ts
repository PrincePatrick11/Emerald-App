/**
 * „Hier ist es": zu einem Element scrollen und es kurz aufleuchten lassen —
 * für den Link-Chip im Text (`revealEntryLink`) und den Block im Stapel
 * (Sprung aus der Block-Verwaltung). Nur DOM, keine Komponenten.
 */

/** Scrollt das Element in die Mitte; bei reduzierter Bewegung ohne Animation. */
export function scrollIntoViewCentered(el: HTMLElement): void {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
}

// Pro Klasse ist je nur ein Element markiert. Ein zweiter Aufruf — auch auf
// dasselbe Element — setzt die Markierung neu, statt am noch laufenden ersten
// Durchlauf hängenzubleiben.
const flashing = new Map<string, { el: HTMLElement; timer: number }>();

/**
 * Setzt `className` für `ms` Millisekunden und startet dabei eine
 * CSS-Animation neu (Klasse ab, Reflow, Klasse an). `ms` muss zur Dauer der
 * Keyframes passen, die an der Klasse hängen.
 */
export function flashReveal(el: HTMLElement, className: string, ms: number): void {
  const previous = flashing.get(className);
  if (previous) {
    window.clearTimeout(previous.timer);
    previous.el.classList.remove(className);
  }
  el.classList.remove(className);
  void el.offsetWidth; // Reflow erzwingen, sonst startet die Animation nicht neu.
  el.classList.add(className);
  const timer = window.setTimeout(() => {
    el.classList.remove(className);
    flashing.delete(className);
  }, ms);
  flashing.set(className, { el, timer });
}
