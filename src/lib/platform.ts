/**
 * Platform detection for the window chrome.
 *
 * A synchronous user-agent check rather than `@tauri-apps/plugin-os`: the
 * result decides how the title bar is laid out, so it has to be known before
 * the first paint. Every async alternative would render one frame with the
 * wrong layout first.
 */
/**
 * The `typeof` guards here and on `isTauri` are not decoration:
 * `scripts/schema-check.mjs` bundles `db.ts` for node, and this module is
 * pulled in via `images.ts`. An unguarded access to `navigator` or
 * `window` at load time blows up the harness on import, before any
 * check runs. Outside a browser the answer is simply "none
 * of it".
 */
const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;

export const isMacOS = /Mac OS X|Macintosh/.test(ua);
export const isWindows = /Windows/.test(ua);

export type PlatformName = 'macos' | 'windows' | 'linux';

export const platformName: PlatformName = isMacOS ? 'macos' : isWindows ? 'windows' : 'linux';

/** False when the app is opened in a plain browser, where no window APIs exist. */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Windows and Linux run the window undecorated, so the title bar draws its own
 * minimise / maximise / close buttons. macOS keeps its native traffic lights,
 * which also keeps native fullscreen working.
 */
export const usesCustomWindowControls = !isMacOS && isTauri;

