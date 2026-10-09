#!/usr/bin/env bash
# ── Emerald DevTools — start the Tauri app with WebView2 remote debugging ──
# This script does NOT modify the Emerald-App repo. It only sets the env var
# that the WebView2 host process reads at startup.
#
# After the window opens, the MCP server (started separately by your LLM
# client) connects to http://127.0.0.1:9222/json and drives the WebView.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EMERALD_DIR="${EMERALD_DIR:-$SCRIPT_DIR/../..}"

if [[ ! -f "$EMERALD_DIR/package.json" ]]; then
    echo "ERROR: Emerald-App not found at $EMERALD_DIR" >&2
    echo "       Override with EMERALD_DIR=/path/to/Emerald-App $0" >&2
    exit 1
fi

# WebView2 / wry reads WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS at startup.
# Prepend our debug-port flag to anything the caller may have set.
EXTRA="${WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:-}"
export WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="$EXTRA --remote-debugging-port=9222 --remote-allow-origins=*"

echo "Starting Emerald in dev mode with WebView2 debug port 9222..."
echo "WebView2 args: $WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"
echo "(Close the app window or Ctrl+C here to stop.)"
echo

cd "$EMERALD_DIR"
exec npm run tauri:dev