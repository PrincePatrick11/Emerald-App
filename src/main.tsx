import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { changeAppLanguage, savedAppLanguage } from "./i18n";
import "./themes/emerald-noctis.css";
import "./themes/emerald-parchment.css";
import "./index.css";
import "tippy.js/dist/tippy.css";
import { applyTheme, normalizeThemeId } from "./themes/theme";
import { platformName } from "./lib/platform";

// Load Google Fonts asynchronously so they never block the initial render.
// The render-blocking <link rel="stylesheet"> was moved here from index.html.
// With font-display:swap the app renders immediately with system fonts and
// swaps to the custom fonts once the Google Fonts CSS has loaded.
const _fontLink = document.createElement('link');
_fontLink.rel = 'stylesheet';
_fontLink.href = 'https://fonts.googleapis.com/css2?family=Alegreya:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=IBM+Plex+Sans:wght@400;500;600;700&family=Inter:wght@300;400;500;600&family=Lora:ital,wght@0,400;0,500;0,600;1,400;1,500;1,600&family=Merriweather:wght@400;500;700&family=Nunito:wght@400;500;600;700&family=Source+Sans+3:wght@400;500;600;700&display=swap';
document.head.appendChild(_fontLink);

// Apply theme before first render to avoid flash
applyTheme(normalizeThemeId(localStorage.getItem('theme-id') ?? localStorage.getItem('theme')));

// Expose the platform to CSS (html[data-platform='macos'] reserves room for
// the native traffic lights in the title bar). Set before first render for
// the same reason as the theme above.
document.documentElement.dataset.platform = platformName;

// Die gespeicherte Sprache VOR dem ersten Render aktivieren — wie das Theme
// oben, damit die App nicht kurz auf Englisch aufblitzt und dann umspringt.
// Englisch ist im Bundle; alles andere laedt einen lokalen Chunk nach, das
// sind einstellige Millisekunden. Schlaegt es fehl, startet die App englisch.
const savedLanguage = savedAppLanguage();
const languageReady =
  savedLanguage === "en" ? Promise.resolve() : changeAppLanguage(savedLanguage).catch(() => {});
// Sicherheitsnetz: settelt der Locale-Chunk wider Erwarten nie, rendert die
// App nach 2s trotzdem (dann englisch) statt ein leeres Fenster zu zeigen.
const languageDeadline = new Promise<void>((resolve) => setTimeout(resolve, 2000));

void Promise.race([languageReady, languageDeadline]).then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
