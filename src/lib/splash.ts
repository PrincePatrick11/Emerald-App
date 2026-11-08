/**
 * The loading screen from `index.html` — clear it away at startup, bring it
 * back while an unlocked vault loads, and show it once more on request.
 *
 * The markup itself lives there and not in a component: it has to be in the
 * first frame, long before React has mounted — otherwise exactly the white
 * window it is meant to cover stays visible. From here it is only
 * removed and re-attached, for the return after a question and for the preview.
 */

/** If the regular clearing never happens — render throws, database hangs —,
 *  the UI should still become visible at some point instead of an animation
 *  circling forever. A second, harder safety net for the case that even
 *  the bundle does not load is in the inline script in `index.html`. */
const FALLBACK_MS = 10_000;

/** The same net while a keychain prompt is open: that runs on the user's time, but
 *  a prompt nobody can reach must not leave the window buttons covered for good
 *  (on Windows and Linux the screen lies over them). */
const KEYCHAIN_WAIT_MS = 120_000;

/** Copy of the original, taken while it is still in the DOM. Without it
 *  neither `resumeSplash()` nor "Show loading screen" could show anything —
 *  the original is removed after startup. */
let template: HTMLElement | null = null;

/** The preview currently open, so that a second menu call does not stack
 *  a second layer. */
let openPreview: HTMLElement | null = null;

/** The loading screen currently up, not yet fading out. The DOM is no good for
 *  that: during fading out it is still in the DOM, a second call would find it
 *  and start a second fade-out. */
let current: HTMLElement | null = null;

let fallback: ReturnType<typeof setTimeout> | undefined;

function armFallback(ms = FALLBACK_MS): void {
  clearTimeout(fallback);
  fallback = setTimeout(hideSplash, ms);
}

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
 * Once at startup. Takes the copy, sets up the safety net and takes over
 * from the one in `index.html`.
 *
 * Must run while the original is still in the DOM — so in the module body of
 * `main.tsx` and not in a component. If `main.tsx` ever got an
 * HMR boundary, this would run again after a hot update, find no `#splash`
 * any more and the menu preview would stay silent until the next full reload.
 */
export function initSplash(): void {
  const splash = document.getElementById('splash');
  if (splash) {
    // The bundle has loaded, so the timer here takes over from the one in
    // `index.html`, which finds its target by this id. That one cannot be
    // paused, and a keychain prompt may well outlast it.
    splash.removeAttribute('id');
    template = splash.cloneNode(true) as HTMLElement;
    current = splash;
  }
  armFallback();
}

/**
 * Gives the safety net the longer limit until `wait` settles, then the regular
 * one again: a keychain prompt must not use up the time allowed for loading.
 */
export async function extendSplashDuring<T>(wait: Promise<T>): Promise<T> {
  if (current) armFallback(KEYCHAIN_WAIT_MS);
  try {
    return await wait;
  } finally {
    if (current) armFallback();
  }
}

/**
 * Brings the loading screen back after a question took it away: the vault is
 * unlocked now, but its data is still loading. Whoever opens the vault ends
 * this with `hideSplash()`.
 */
export function resumeSplash(): void {
  if (current || !template) return;
  current = template.cloneNode(true) as HTMLElement;
  document.body.appendChild(current);
  armFallback();
}

/**
 * Fades out the loading screen and removes it from the DOM. Can be called
 * repeatedly — the second call (safety net, StrictMode double mount)
 * does nothing.
 */
export function hideSplash(): void {
  const splash = current;
  if (!splash) return;
  current = null;
  clearTimeout(fallback);
  // No minimum display time: the loading screen stays exactly as long as
  // loading actually takes.
  fadeOutAndRemove(splash);
}

/** The loading screen standing in while a vault chosen in the picker opens. */
let openLoading: HTMLElement | null = null;
let loadingFallback: ReturnType<typeof setTimeout> | undefined;
/** Longer than `FALLBACK_MS`: opening a fetched vault includes its first sync. */
const LOADING_FALLBACK_MS = 30_000;

/**
 * Covers the window with the loading screen while a vault chosen in the
 * picker opens, until {@link hideLoadingScreen}. A fresh copy like the
 * preview, but without its click to dismiss: it goes once the vault is there.
 */
export function showLoadingScreen(): void {
  if (!template || openLoading) return;
  const el = template.cloneNode(true) as HTMLElement;
  el.removeAttribute('id');
  openLoading = el;
  document.body.appendChild(el);
  // The same net as `armFallback`, with room for a fetched vault's first sync:
  // a switch that never returns must not leave the window covered — on
  // Windows and Linux that covers its buttons too. The picker under it still
  // shows the switch going on.
  clearTimeout(loadingFallback);
  loadingFallback = setTimeout(hideLoadingScreen, LOADING_FALLBACK_MS);
}

/** Idempotent, like {@link hideSplash}. */
export function hideLoadingScreen(): void {
  clearTimeout(loadingFallback);
  const el = openLoading;
  openLoading = null;
  if (el) fadeOutAndRemove(el);
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
  if (openLoading) return;
  if (!template || openPreview) return;
  const el = template.cloneNode(true) as HTMLElement;

  // The drag region has to go: Tauri intercepts mousedown on it and
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
