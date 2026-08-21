/**
 * Platform detection for the window chrome.
 *
 * A synchronous user-agent check rather than `@tauri-apps/plugin-os`: the
 * result decides how the title bar is laid out, so it has to be known before
 * the first paint. Every async alternative would render one frame with the
 * wrong layout first.
 */
/**
 * Die `typeof`-Wachen hier und an `isTauri` sind kein Zierrat:
 * `scripts/schema-check.mjs` buendelt `db.ts` fuer node, und ueber `images.ts`
 * haengt dieses Modul mit drin. Ein ungeschuetzter Zugriff auf `navigator` oder
 * `window` beim Laden sprengt den Harness beim Import, bevor irgendeine
 * Pruefung laeuft. Ausserhalb eines Browsers ist die Antwort schlicht "nichts
 * davon".
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

/**
 * The native menu is only installed on macOS (see `install_native_menu` in
 * `src-tauri/src/lib.rs`); Windows and Linux render the same items in the
 * title bar instead.
 */
export const usesHtmlMenuBar = !isMacOS;
