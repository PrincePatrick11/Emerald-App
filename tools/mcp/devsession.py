"""The regular dev session, started from the tray app.

This is the app you work in yourself, not an MCP instance: `npm run tauri:dev`
in the main checkout, with its own identifier (com.emerald.app.dev), debug
port 9222 and its window on screen as usual. The one thing the tray changes is
the console: run by hand, start_emerald_dev.bat holds a terminal open for as
long as the app runs; started from here, its output goes to a log file and no
console appears at all.
"""

from __future__ import annotations

import json
import os
import re
import socket
from pathlib import Path

import instance
import launcher
import procs
import window as winctl

DEV_CDP_PORT = 9222
DEV_VITE_PORT = 1420          # devUrl in the app's tauri.conf.json, strictPort
SCRIPT = instance.REPO_ROOT / "start_emerald_dev.bat"
KEEP_LOGS = 20
# A thin amber frame, so the dev window cannot be mistaken for the installed
# app, which looks otherwise identical. Stored in config.json as dev_border;
# an empty value switches it off.
DEFAULT_BORDER = "#c08a1e"

# Per-instance settings of the MCP environment. The tray itself never has
# them, but if it was started from a shell that did, they would turn the dev
# build into something else - CARGO_TARGET_DIR above all.
_MCP_ONLY = (
    "CARGO_TARGET_DIR",
    "EMERALD_TAURI_CONFIG",
    "EMERALD_WEBVIEW2_ARGS",
    "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
    "EMERALD_MCP_SLOT",
    "EMERALD_MCP_APP_DATA",
    "EMERALD_SEED_TARGET_FROM",
)


def dev_dir() -> Path:
    return instance.mcp_home() / "dev"


def _state_file() -> Path:
    return dev_dir() / "dev.json"


def _load() -> dict:
    try:
        data = json.loads(_state_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _save(data: dict) -> None:
    path = _state_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def target_dir() -> Path:
    """Where the dev build lands: the app's own default, since the dev
    session gets no CARGO_TARGET_DIR."""
    return instance.main_checkout() / "src-tauri" / "target"


def _listening(port: int) -> bool:
    """Vite binds to `localhost`, which on Windows is often ::1 only - a
    check against 127.0.0.1 alone reports a running dev server as absent."""
    for family, host in ((socket.AF_INET, "127.0.0.1"), (socket.AF_INET6, "::1")):
        try:
            with socket.socket(family, socket.SOCK_STREAM) as s:
                s.settimeout(0.3)
                if s.connect_ex((host, port)) == 0:
                    return True
        except OSError:
            continue
    return False


def status() -> dict:
    """Recognises a dev session however it was started - from here, from
    start_emerald_dev.bat, or as a plain `npm run tauri:dev`, which has no
    debug port at all. So the app is looked for by its executable, and a
    build in progress by the Vite server that `tauri dev` starts first."""
    data = _load()
    pid = data.get("pid")
    ours = bool(pid) and procs.pid_alive(int(pid))
    app_up = procs.exe_running_under(target_dir())
    if app_up:
        state = "running"
    elif ours or _listening(DEV_VITE_PORT):
        state = "starting"
    else:
        state = "stopped"
    return {
        "state": state,
        "ours": ours,
        # Up, but not through this app. Still stoppable, just by a less
        # precise route.
        "external": state != "stopped" and not ours,
        "debug_port": instance._port_in_use(DEV_CDP_PORT),
        "pid": int(pid) if ours else None,
        "log_path": data.get("log_path"),
        "checkout": str(instance.main_checkout()),
    }


def start() -> dict:
    current = status()
    if current["state"] != "stopped":
        return {"started": False, "reason": current["state"]}
    if not SCRIPT.exists():
        raise FileNotFoundError(f"dev launcher not found: {SCRIPT}")
    checkout = instance.main_checkout()
    if not instance.looks_like_emerald(checkout):
        raise FileNotFoundError(f"no Emerald checkout at {checkout}")

    env = os.environ.copy()
    for key in _MCP_ONLY:
        env.pop(key, None)
    env["EMERALD_APP_DIR"] = str(checkout)
    proc, log_path = launcher.spawn_script(SCRIPT, env, dev_dir() / "logs", "dev")
    _save({"pid": proc.pid, "log_path": str(log_path), "started_at": instance._now()})
    _trim_logs()
    return {"started": True, "pid": proc.pid, "log_path": str(log_path)}


def stop() -> bool:
    """End the dev session. Returns True if anything was running."""
    data = _load()
    pid = data.get("pid")
    if pid and procs.stop_tree(int(pid)):
        return True
    # Started some other way, or the pid is no longer ours: take down the app
    # by its build directory and Vite by its port, which together are what
    # would stop the next start from working.
    stopped = procs.stop_by_target_dir(target_dir())
    stopped += procs.stop_port_owner(DEV_VITE_PORT)
    return stopped > 0


def border_colour() -> str | None:
    value = instance.load_config().get("dev_border", DEFAULT_BORDER)
    if isinstance(value, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        return value.lower()
    return None


def set_border_colour(colour: str | None) -> None:
    instance.save_config({"dev_border": colour or ""})


def apply_border() -> int:
    """Put the configured frame on the dev window, whoever started it."""
    return winctl.set_border(target_dir(), border_colour())


def _trim_logs() -> None:
    logs = sorted((dev_dir() / "logs").glob("dev-*.log"), key=lambda p: p.stat().st_mtime)
    for old in logs[:-KEEP_LOGS]:
        try:
            old.unlink()
        except OSError:
            pass  # the one still being written, most likely
