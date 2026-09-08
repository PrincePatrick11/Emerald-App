/**
 * Der Ladebildschirm aus `index.html` — abräumen beim Start, und auf Wunsch
 * noch einmal zeigen.
 *
 * Das Markup selbst liegt dort und nicht in einer Komponente: es muss im
 * ersten Frame stehen, lange bevor React gemountet ist — sonst bleibt genau
 * das weiße Fenster stehen, das es verdecken soll. Von hier aus wird es nur
 * noch entfernt und für die Vorschau wieder eingehängt.
 */

/** Mindeststandzeit. Ist die Datenbank schneller da — bei lokalem SQLite der
 *  Normalfall —, würde der Bildschirm sonst nur kurz aufblitzen, und das liest
 *  sich als Fehler, nicht als Ladevorgang. */
const MIN_VISIBLE_MS = 900;

/** Kommt es nie zum regulären Abräumen — Render wirft, Datenbank hängt —,
 *  soll trotzdem irgendwann die Oberfläche zu sehen sein statt einer ewig
 *  kreisenden Animation. Ein zweites, härteres Netz für den Fall, dass schon
 *  das Bundle nicht lädt, steht im Inline-Skript in `index.html`. */
const FALLBACK_MS = 10_000;

/** Kopie des Originals, gezogen solange es noch im DOM steht. Ohne sie
 *  könnte „Ladebildschirm anzeigen" nichts mehr zeigen — das Original ist
 *  nach dem Start entfernt. */
let template: HTMLElement | null = null;

/** Die gerade offene Vorschau, damit ein zweiter Menüaufruf keine zweite
 *  Ebene stapelt. */
let openPreview: HTMLElement | null = null;

/** Ob das Original schon behandelt wurde. Das DOM taugt dafür nicht: die
 *  Klasse `is-hiding` fällt erst nach der Mindeststandzeit, ein Zweitaufruf
 *  davor käme daran vorbei und zöge ein zweites Paar Timer auf. */
let dismissed = false;

/**
 * Blendet ein Splash-Element aus und entfernt es. Die Ausblenddauer kommt aus
 * der `transition` in `public/splash.css` statt aus einer Konstante hier: eine
 * Zahl, die auseinanderlaufen kann, ist eine Zahl zu viel. Ist die Transition
 * abgeschaltet, kommt 0 heraus und das Element verschwindet sofort.
 */
function fadeOutAndRemove(el: HTMLElement): void {
  const fadeMs = parseFloat(getComputedStyle(el).transitionDuration) * 1000 || 0;
  el.classList.add('is-hiding');
  setTimeout(() => el.remove(), fadeMs);
}

/**
 * Einmalig beim Hochfahren. Zieht die Kopie für die Vorschau und spannt das
 * Sicherheitsnetz auf.
 *
 * Muss laufen, solange das Original noch im DOM steht — also im Modulrumpf von
 * `main.tsx` und nicht in einer Komponente. Bekäme `main.tsx` je eine
 * HMR-Grenze, liefe dies nach einem Hot-Update erneut, fände kein `#splash`
 * mehr und die Menü-Vorschau bliebe bis zum nächsten vollen Reload stumm.
 */
export function initSplash(): void {
  const splash = document.getElementById('splash');
  if (splash) template = splash.cloneNode(true) as HTMLElement;
  setTimeout(hideSplash, FALLBACK_MS);
}

/**
 * Blendet den Ladebildschirm aus und entfernt ihn aus dem DOM. Mehrfach
 * aufrufbar — der zweite Aufruf (Sicherheitsnetz, StrictMode-Doppelmount)
 * tut nichts.
 */
export function hideSplash(): void {
  if (dismissed) return;
  const splash = document.getElementById('splash');
  if (!splash) return;
  dismissed = true;

  // `performance.now()` zählt ab Navigationsbeginn, also etwas vor dem ersten
  // Frame des Ladebildschirms — die Mindeststandzeit fällt dadurch minimal
  // kürzer aus als MIN_VISIBLE_MS. Genau genug für den Zweck.
  const remaining = Math.max(0, MIN_VISIBLE_MS - performance.now());
  setTimeout(() => fadeOutAndRemove(splash), remaining);
}

/**
 * Zeigt den Ladebildschirm noch einmal, bis irgendwo hingeklickt (oder
 * Escape gedrückt) wird — damit man ihn sich in Ruhe ansehen kann, statt ihn
 * beim Start im Vorbeigehen zu erwischen.
 *
 * Bewusst eine Kopie und nicht das Original: eine frische Kopie startet alle
 * Animationen von vorn, auch den einmaligen Auflauf des Schriftzugs.
 */
export function showSplash(): void {
  if (!template || openPreview) return;
  const el = template.cloneNode(true) as HTMLElement;

  // Die `id` gehört dem Original — `hideSplash()` sucht danach.
  el.removeAttribute('id');
  // Und das Drag-Region muss weg: Tauri fängt den mousedown darauf ab und
  // zieht daran das Fenster — auf allen drei Plattformen, nicht nur dort, wo
  // die Titelleiste selbst gezeichnet wird. Ein `click` käme nie an, und
  // genau der soll die Vorschau schließen.
  el.removeAttribute('data-tauri-drag-region');

  const dismiss = () => {
    // Der Klick-Listener bleibt über das Ausblenden hinweg am Element; ohne
    // diese Sperre zöge ein zweiter Klick währenddessen erneut Timer auf.
    if (openPreview !== el) return;
    openPreview = null;
    document.removeEventListener('keydown', onKeyDown, true);
    fadeOutAndRemove(el);
  };
  // Escape teilen sich mehrere Ebenen — `Modal`, `AltarView` und
  // `useOutsideClick`. Capture-Phase plus Abbruch der Weiterreichung, damit
  // die Vorschau zuerst drankommt und darunter nichts mitschließt.
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
