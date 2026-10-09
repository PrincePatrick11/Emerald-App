#!/usr/bin/env bash
# ── Emerald DevTools — start an isolated MCP instance ──
# The POSIX counterpart of start_emerald_mcp.bat. Every per-instance value
# arrives in the environment, set by launcher.py from instance.py, so several
# worktrees can run at once:
#
#   EMERALD_MCP_SLOT          instance number (0 = the main checkout)
#   EMERALD_APP_DIR           app checkout to build
#   EMERALD_TAURI_CONFIG      generated overlay: identifier, ports, window
#   EMERALD_MCP_APP_DATA      app data dir, where vaults.json lives
#   EMERALD_WEBVIEW2_ARGS     debug port and the anti-throttling flags
#   EMERALD_SEED_TARGET_FROM  Cargo target dir to warm-start this one from
#   CARGO_TARGET_DIR          this instance's build directory
#
# Run by hand with none of them set, it reproduces slot 0: port 9223 and the
# checked-in tauri.mcp.conf.json.
#
# In practice the MCP is driven on Windows; this file exists so the two
# launchers stay in step rather than one of them quietly rotting.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# EMERALD_DIR is the older name for the same thing; keep honouring it.
EMERALD_APP_DIR="${EMERALD_APP_DIR:-${EMERALD_DIR:-$SCRIPT_DIR/../..}}"
EMERALD_TAURI_CONFIG="${EMERALD_TAURI_CONFIG:-$SCRIPT_DIR/tauri.mcp.conf.json}"
EMERALD_MCP_SLOT="${EMERALD_MCP_SLOT:-0 (manual)}"

if [[ ! -f "$EMERALD_APP_DIR/package.json" || ! -f "$EMERALD_APP_DIR/src-tauri/tauri.conf.json" ]]; then
    echo "ERROR: Emerald-App not found at $EMERALD_APP_DIR" >&2
    echo "       Override with EMERALD_APP_DIR=/path/to/Emerald-App $0" >&2
    exit 1
fi

# WebView2 / wry reads WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS at startup. The
# fallback is slot 0's own command line: --disable-features replaces wry's
# defaults rather than merging with them, hence the repeated ms* features, and
# CalculateNativeWinOcclusion is what keeps an off-screen window compositing so
# screenshots are fresh frames rather than stale ones.
export WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="${EMERALD_WEBVIEW2_ARGS:---remote-debugging-port=9223 --remote-allow-origins=* --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion}"

echo "Slot:          $EMERALD_MCP_SLOT"
echo "App dir:       $EMERALD_APP_DIR"
echo "Tauri config:  $EMERALD_TAURI_CONFIG"
echo "App data:      ${EMERALD_MCP_APP_DATA:-<unset>}"
echo "WebView2 args: $WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"
echo

cd "$EMERALD_APP_DIR"

# A fresh git worktree has no usable node_modules — `git worktree add` does not
# copy it — so nothing below would run without this.
if [[ ! -x "node_modules/.bin/tauri" ]]; then
    echo "node_modules is missing or incomplete in $PWD - running npm install ..."
    npm install
fi

# Give a brand-new instance a vault with test data in it. Skips instances that
# already have a vaults.json, so an instance you have been working in is never
# touched. Failure is not fatal: the app then starts into its own vault setup.
if [[ -n "${EMERALD_MCP_APP_DATA:-}" ]]; then
    seed_args=()
    [[ "${EMERALD_MCP_SEED:-}" == "force" ]] && seed_args+=(--force)
    echo "Provisioning seed vault ..."
    node "$SCRIPT_DIR/seed/provision.mjs" \
        --checkout "$EMERALD_APP_DIR" \
        --app-data "$EMERALD_MCP_APP_DATA" \
        "${seed_args[@]}" \
      || echo "WARNING: seed provisioning failed - the app will start with its own vault setup"
    echo
fi

# Reclaim build directories of slots whose worktree is gone, and of ones nobody
# has used in a while. Running instances and slot 0 are never touched. Done here
# rather than in the server because deleting several GB would stall a tool call.
if [[ -n "${EMERALD_MCP_PYTHON:-}" ]]; then
    echo "Stopping idle instances and pruning unused build directories ..."
    "$EMERALD_MCP_PYTHON" "${EMERALD_MCP_DIR:-$SCRIPT_DIR}/instance.py" --reap \
      || echo "WARNING: reap failed - continuing"
    "$EMERALD_MCP_PYTHON" "${EMERALD_MCP_DIR:-$SCRIPT_DIR}/instance.py" --prune \
      || echo "WARNING: prune failed - continuing"
    echo
fi

# Two instances would otherwise fight over target/debug/emerald. Each gets its
# own target dir, outside both repos: nested inside src-tauri it would look
# like a source change to `tauri dev`'s watcher (infinite rebuild loop), and
# anywhere in Emerald-App it would leave several GB in the official repo.
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/emerald-mcp-target}"

# Copy an existing warm target dir rather than paying for a cold build. -a
# preserves timestamps, which Cargo compares; a copy without them would rebuild
# everything and defeat the point.
if [[ -n "${EMERALD_SEED_TARGET_FROM:-}" && ! -d "$CARGO_TARGET_DIR/debug" && -d "$EMERALD_SEED_TARGET_FROM/debug" ]]; then
    echo "Seeding Cargo target dir from $EMERALD_SEED_TARGET_FROM ..."
    mkdir -p "$CARGO_TARGET_DIR"
    cp -a "$EMERALD_SEED_TARGET_FROM/." "$CARGO_TARGET_DIR/" \
      || echo "WARNING: seed copy failed - falling back to a cold build"
    echo
fi

# A target dir copied from another slot or moved elsewhere still carries
# absolute paths from where it was built; tauri's build scripts read their
# permission files from there. Rewriting them is a no-op when nothing moved.
if [[ -n "${EMERALD_MCP_PYTHON:-}" ]]; then
    "$EMERALD_MCP_PYTHON" "${EMERALD_MCP_DIR:-$SCRIPT_DIR}/instance.py" --relocate-target "$CARGO_TARGET_DIR" >/dev/null \
      || echo "WARNING: could not relocate $CARGO_TARGET_DIR - a moved build dir may fail to build"
fi

exec npx tauri dev --config "$EMERALD_TAURI_CONFIG"
