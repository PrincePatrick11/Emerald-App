#!/usr/bin/env bash
# ── Emerald DevTools — start Tauri as the MCP instance (macOS, Linux) ──
# Started by launcher.py, which sets these from instance.py:
#
#   EMERALD_APP_DIR           app checkout to build
#   EMERALD_TAURI_CONFIG      generated overlay: identifier, ports, window
#   EMERALD_MCP_APP_DATA      the instance's app data dir, where vaults.json lives
#   EMERALD_TAURI_FEATURES    cargo features: the dev bridge
#   EMERALD_DEVBRIDGE_PORT    port the dev bridge answers on
#   CARGO_TARGET_DIR          the instance's build directory
#
# Run by hand with none of them set, it uses the same defaults: port 9223,
# the checked-in tauri.mcp.conf.json, and no test data.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EMERALD_APP_DIR="${EMERALD_APP_DIR:-$SCRIPT_DIR/../..}"
EMERALD_TAURI_CONFIG="${EMERALD_TAURI_CONFIG:-$SCRIPT_DIR/tauri.mcp.conf.json}"
EMERALD_TAURI_FEATURES="${EMERALD_TAURI_FEATURES:-devbridge}"
export EMERALD_DEVBRIDGE_PORT="${EMERALD_DEVBRIDGE_PORT:-9223}"

if [[ ! -f "$EMERALD_APP_DIR/package.json" || ! -f "$EMERALD_APP_DIR/src-tauri/tauri.conf.json" ]]; then
    echo "ERROR: no Emerald checkout at $EMERALD_APP_DIR" >&2
    echo "       Override with EMERALD_APP_DIR=/path/to/Emerald-App $0" >&2
    exit 1
fi

echo "App dir:       $EMERALD_APP_DIR"
echo "Tauri config:  $EMERALD_TAURI_CONFIG"
echo "Features:      $EMERALD_TAURI_FEATURES"
echo "Bridge port:   $EMERALD_DEVBRIDGE_PORT"
echo

cd "$EMERALD_APP_DIR"

# A fresh git worktree has no usable node_modules — `git worktree add` does not
# copy it — so nothing below would run without this.
if [[ ! -x "node_modules/.bin/tauri" ]]; then
    echo "node_modules is missing or incomplete in $PWD - running npm install ..."
    npm install
fi

# Give a brand-new instance a vault with test data in it. Skips an instance
# that already has a vaults.json, so one you have been working in is never
# touched. Failure is not fatal: the app then starts into its own vault setup.
if [[ -n "${EMERALD_MCP_APP_DATA:-}" ]]; then
    seed_args=()
    [[ "${EMERALD_MCP_SEED:-}" == "force" ]] && seed_args+=(--force)
    echo "Provisioning seed vault ..."
    node "$SCRIPT_DIR/seed/provision.mjs" \
        --checkout "$EMERALD_APP_DIR" \
        --app-data "$EMERALD_MCP_APP_DATA" \
        ${seed_args[@]+"${seed_args[@]}"} \
      || echo "WARNING: seed provisioning failed - the app will start with its own vault setup"
    echo
fi

# A build directory of its own, outside the repository: the regular dev build
# keeps src-tauri/target to itself, and a directory inside src-tauri would look
# like a source change to `tauri dev`'s watcher.
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/.local/share/emerald-mcp-target}"

exec npx tauri dev --config "$EMERALD_TAURI_CONFIG" --features "$EMERALD_TAURI_FEATURES"
