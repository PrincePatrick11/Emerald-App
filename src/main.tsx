import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./i18n";
import "./themes/emerald-noctis.css";
import "./themes/emerald-parchment.css";
import "./index.css";
import "tippy.js/dist/tippy.css";
import { applyTheme, normalizeThemeId } from "./themes/theme";

// Apply theme before first render to avoid flash
applyTheme(normalizeThemeId(localStorage.getItem('theme-id') ?? localStorage.getItem('theme')));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
