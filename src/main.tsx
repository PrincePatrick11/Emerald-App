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
import { readDeviceMirror } from "./lib/deviceSettings";
import { platformName } from "./lib/platform";
import { initSplash } from "./lib/splash";

// The device's theme and the last opened vault's fonts before the first
// render, from their localStorage mirrors: `device.json` and the vault's
// settings are only read once the app runs, and nothing should flash until
// then (not even on the start page).
const bootDevice = readDeviceMirror();
const bootAppearance = readAppearanceMirror();
applyTheme(bootDevice.theme, bootDevice.customThemes);
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
const savedLanguage = bootDevice.language;
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
