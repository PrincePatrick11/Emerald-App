import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error node builtin; the project has no @types/node
import { execFileSync } from "node:child_process";

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

// The branch an MCP test instance was started from, shown in its title bar so
// a window can be told apart from the others. The MCP launcher
// (tools/mcp/launcher.py) sets EMERALD_MCP_APP_DATA for every instance it
// starts; any other dev run and every release build get an empty string.
// @ts-expect-error process is a nodejs global
const mcpInstance = Boolean(process.env.EMERALD_MCP_APP_DATA);

function instanceBranch(): string {
  if (!mcpInstance) return "";
  // Vite runs in the checkout, so git answers for it.
  const git = (...args: string[]): string =>
    execFileSync("git", args, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    const branch = git("rev-parse", "--abbrev-ref", "HEAD");
    return branch === "HEAD" ? git("rev-parse", "--short", "HEAD") : branch;
  } catch {
    return "";
  }
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), stripCrossOrigin()],
  define: {
    "import.meta.env.VITE_EMERALD_INSTANCE_BRANCH": JSON.stringify(instanceBranch()),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          // React before Tiptap: @tiptap/react imports react-dom, and without
          // a rule of its own Rollup pulled react-dom into the tiptap chunk,
          // which startup then loaded too, although only the editor and
          // BlockStack (both lazy) need Tiptap.
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "react";
          if (id.includes("@tiptap") || id.includes("prosemirror")) return "tiptap";
          // The builder's canvas (Konva with its React renderer), only for the altar.
          if (/[\\/]node_modules[\\/](konva|react-konva|react-reconciler|its-fine)[\\/]/.test(id)) return "konva";
          if (id.includes("@tauri-apps")) return "tauri";
          if (id.includes("i18next")) return "i18n";
          // No catch-all "vendor" chunk any more: it forced turndown, marked
          // and framer-motion into an eagerly loaded block, although their
          // importers are now loaded dynamically. Without a rule, Rollup
          // splits along the import() boundaries by itself.
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
