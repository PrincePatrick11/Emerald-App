import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { changeAppLanguage } from "./i18n";
import "./themes/emerald-noctis.css";
import "./themes/emerald-parchment.css";
import "./index.css";
import "tippy.js/dist/tippy.css";
// Die Schriften liegen in der App (`npm run fonts`) — nichts wird aus dem Netz geladen.
import "./fonts.css";
import { applyEditorFont, applyEditorFontSize, applyTheme, applyUIFont, applyUIScale } from "./themes/theme";
import { readAppearanceMirror } from "./lib/vaultSettings";
import { platformName } from "./lib/platform";
import { initSplash } from "./lib/splash";

// Theme und Schriften des zuletzt geoeffneten Vaults vor dem ersten Render —
// seine eigenen Einstellungen setzt der settingsStore erst, wenn der Vault
// geladen ist, und bis dahin soll nichts aufblitzen (auch nicht im Vault-Setup).
const bootAppearance = readAppearanceMirror();
applyTheme(bootAppearance.theme);
applyUIFont(bootAppearance.uiFont);
applyEditorFont(bootAppearance.editorFont);
applyUIScale(bootAppearance.uiScale);
applyEditorFontSize(bootAppearance.editorFontSize);

// Expose the platform to CSS (html[data-platform='macos'] reserves room for
// the native traffic lights in the title bar). Set before first render for
// the same reason as the theme above.
document.documentElement.dataset.platform = platformName;

// Die gespeicherte Sprache VOR dem ersten Render aktivieren — wie das Theme
// oben, damit die App nicht kurz auf Englisch aufblitzt und dann umspringt.
// Englisch ist im Bundle; alles andere laedt einen lokalen Chunk nach, das
// sind einstellige Millisekunden. Schlaegt es fehl, startet die App englisch.
const savedLanguage = bootAppearance.language;
const languageReady =
  savedLanguage === "en" ? Promise.resolve() : changeAppLanguage(savedLanguage).catch(() => {});
// Sicherheitsnetz: settelt der Locale-Chunk wider Erwarten nie, rendert die
// App nach 2s trotzdem (dann englisch) statt ein leeres Fenster zu zeigen.
const languageDeadline = new Promise<void>((resolve) => setTimeout(resolve, 2000));

// Muss laufen, solange der Ladebildschirm noch im DOM steht — deshalb hier
// und nicht in einer Komponente. Warum, steht an `initSplash()`.
initSplash();

void Promise.race([languageReady, languageDeadline]).then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
