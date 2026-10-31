import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { changeAppLanguage } from "./i18n";
import "./themes/emerald-noctis.css";
import "./themes/emerald-parchment.css";
import "./index.css";
import "tippy.js/dist/tippy.css";
// The fonts ship with the app (`npm run fonts`) — nothing is loaded from the network.
import "./fonts.css";
import { applyEditorFont, applyEditorFontSize, applyTheme, applyUIFont, applyUIScale } from "./themes/theme";
import { readAppearanceMirror } from "./lib/vaultSettings";
import { platformName } from "./lib/platform";
import { initSplash } from "./lib/splash";

// Theme and fonts of the last opened vault before the first render — the
// settingsStore only applies its own settings once the vault is loaded, and
// nothing should flash until then (not even in the vault setup).
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

// Activate the saved language BEFORE the first render — like the theme
// above, so the app does not flash English briefly and then switch.
// English is in the bundle; anything else loads a local chunk, which takes
// single-digit milliseconds. If that fails, the app starts in English.
const savedLanguage = bootAppearance.language;
const languageReady =
  savedLanguage === "en" ? Promise.resolve() : changeAppLanguage(savedLanguage).catch(() => {});
// Safety net: if the locale chunk unexpectedly never settles, the app
// renders after 2s anyway (in English) instead of showing an empty window.
const languageDeadline = new Promise<void>((resolve) => setTimeout(resolve, 2000));

// Must run while the loading screen is still in the DOM — hence here and
// not in a component. The reason is documented at `initSplash()`.
initSplash();

void Promise.race([languageReady, languageDeadline]).then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
