/**
 * "It's here": scroll to an element and make it flash briefly —
 * for the link chip in the text (`revealEntryLink`) and the block in the stack
 * (jump from block management). DOM only, no components.
 */

/** Scrolls the element to the centre; with reduced motion, without animation. */
export function scrollIntoViewCentered(el: HTMLElement): void {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
}

// Only one element is marked per class. A second call — even on the
// same element — restarts the marking instead of getting stuck on the
// first run that is still going.
const flashing = new Map<string, { el: HTMLElement; timer: number }>();

/**
 * Sets `className` for `ms` milliseconds and restarts a
 * CSS animation in the process (class off, reflow, class on). `ms` must match the duration of the
 * keyframes attached to the class.
 */
export function flashReveal(el: HTMLElement, className: string, ms: number): void {
  const previous = flashing.get(className);
  if (previous) {
    window.clearTimeout(previous.timer);
    previous.el.classList.remove(className);
  }
  el.classList.remove(className);
  void el.offsetWidth; // Force a reflow, otherwise the animation does not restart.
  el.classList.add(className);
  const timer = window.setTimeout(() => {
    el.classList.remove(className);
    flashing.delete(className);
  }, ms);
  flashing.set(className, { el, timer });
}
