import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./i18n";
import "./index.css";
import "tippy.js/dist/tippy.css";

// Apply theme before first render to avoid flash
if (localStorage.getItem('theme') === 'light') {
  document.documentElement.classList.add('light');
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
