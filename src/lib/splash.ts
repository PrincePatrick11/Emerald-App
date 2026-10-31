/**
 * The loading screen from `index.html` — clear it away at startup, and show
 * it once more on request.
 *
 * The markup itself lives there and not in a component: it has to be in the
 * first frame, long before React has mounted — otherwise exactly the white
 * window it is meant to cover stays visible. From here it is only
 * removed and re-attached for the preview.
 */

/** If the regular clearing never happens — render throws, database hangs —,
 *  the UI should still become visible at some point instead of an animation
 *  circling forever. A second, harder safety net for the case that even
 *  the bundle does not load is in the inline script in `index.html`. */
const FALLBACK_MS = 10_000;

/** Copy of the original, taken while it is still in the DOM. Without it
 *  "Show loading screen" could no longer show anything — the original is
 *  removed after startup. */
let template: HTMLElement | null = null;

/** The preview currently open, so that a second menu call does not stack
 *  a second layer. */
let openPreview: HTMLElement | null = null;

/** Whether the original has already been handled. The DOM is no good for that: during
 *  fading out `#splash` is still in the DOM, a second call would find it and
 *  start a second fade-out. */
let dismissed = false;

/**
 * Fades out a splash element and removes it. The fade duration comes from
 * the `transition` in `public/splash.css` instead of a constant here: a
 * number that can drift apart is one number too many. If the transition is
 * disabled, 0 comes out and the element disappears immediately.
 */
function fadeOutAndRemove(el: HTMLElement): void {
  const fadeMs = parseFloat(getComputedStyle(el).transitionDuration) * 1000 || 0;
  el.classList.add('is-hiding');
  setTimeout(() => el.remove(), fadeMs);
}

/**
 * Once at startup. Takes the copy for the preview and sets up the
 * safety net.
 *
 * Must run while the original is still in the DOM — so in the module body of
 * `main.tsx` and not in a component. If `main.tsx` ever got an
 * HMR boundary, this would run again after a hot update, find no `#splash`
 * any more and the menu preview would stay silent until the next full reload.
 */
export function initSplash(): void {
  const splash = document.getElementById('splash');
  if (splash) template = splash.cloneNode(true) as HTMLElement;
  setTimeout(hideSplash, FALLBACK_MS);
}

/**
 * Fades out the loading screen and removes it from the DOM. Can be called
 * repeatedly — the second call (safety net, StrictMode double mount)
 * does nothing.
 */
export function hideSplash(): void {
  if (dismissed) return;
  const splash = document.getElementById('splash');
  if (!splash) return;
  dismissed = true;
  // No minimum display time: the loading screen stays exactly as long as
  // loading actually takes.
  fadeOutAndRemove(splash);
}

/**
 * Shows the loading screen once more, until a click anywhere (or
 * Escape) — so that one can look at it in peace instead of catching it
 * in passing at startup.
 *
 * Deliberately a copy and not the original: a fresh copy restarts all
 * animations from the beginning, including the one-off run-up of the lettering.
 */
export function showSplash(): void {
  if (!template || openPreview) return;
  const el = template.cloneNode(true) as HTMLElement;

  // The `id` belongs to the original — `hideSplash()` looks for it.
  el.removeAttribute('id');
  // And the drag region has to go: Tauri intercepts mousedown on it and
  // drags the window with it — on all three platforms, not only where
  // the title bar itself is drawn. A `click` would never arrive, and
  // that is exactly what should close the preview. Only here on the root element; the
  // `.splash-drag` strip below it keeps its own.
  el.removeAttribute('data-tauri-drag-region');

  const dismiss = () => {
    // The click listener stays on the element throughout the fade-out; without
    // this guard a second click in the meantime would start timers again.
    if (openPreview !== el) return;
    openPreview = null;
    document.removeEventListener('keydown', onKeyDown, true);
    fadeOutAndRemove(el);
  };
  // Several layers share Escape — `Modal`, `AltarView` and
  // `useOutsideClick`. Capture phase plus stopping propagation, so that
  // the preview gets it first and nothing underneath closes along with it.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    dismiss();
  };

  el.addEventListener('click', dismiss);
  document.addEventListener('keydown', onKeyDown, true);
  openPreview = el;
  document.body.appendChild(el);
}
