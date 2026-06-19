import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// Vite 6 adds crossorigin to module scripts and preloads by default.
// In Tauri's custom protocol (tauri:// / https://tauri.localhost), this can
// trigger CORS checks that fail on some WebView2/WKWebView versions.
function stripCrossOrigin(): Plugin {
  return {
    name: 'strip-crossorigin',
    transformIndexHtml: {
      order: 'post',
      handler: (html: string) => html.replace(/ crossorigin(?:="[^"]*")?/g, ''),
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), stripCrossOrigin()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@tiptap") || id.includes("prosemirror")) return "tiptap";
          if (id.includes("@tauri-apps")) return "tauri";
          if (id.includes("i18next")) return "i18n";
          return "vendor";
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
