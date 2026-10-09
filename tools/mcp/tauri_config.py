"""Generates the Tauri config overlay for the MCP instance.

Two jobs, both of which have to happen at launch time rather than in a file
checked into this repo:

  1. Its own identifier, productName and Vite port, so it runs next to the
     regular dev build without sharing a database or a port.

  2. Moving the window off-screen and out of the taskbar, so driving the app
     from an agent does not put a window in the user's face.

The window object is read from the app checkout's own platform config and
copied verbatim before the overlay keys go on top. Tauri replaces the
`app.windows` array wholesale instead of merging it (see
Documentation/build.md), so an overlay that spelled the window out itself
would silently drop whatever the app changed there - `decorations: false` and `shadow`
on Windows today, something else tomorrow.

Why off-screen and not `visible: false`: WebView2 stops producing frames for a
window it considers hidden, and Page.captureScreenshot then returns a stale or
empty image. An off-screen window keeps compositing (given the browser flags in
instance.browser_args) and screenshots keep working.

The position written here is only where the window is *born* - one pixel inside
the corner of the desktop - because Windows refuses a creation rectangle that
lies entirely off-screen and silently falls back to the default cascade
position instead. window.hide_instance_windows() moves it the rest of the way
once the app is up. See window.py.
"""

from __future__ import annotations

import copy
import json
import logging
import os
import sys
from pathlib import Path

from instance import Instance
from window import creation_origin

log = logging.getLogger("emerald-tauri-config")


def platform_config_name() -> str:
    if sys.platform == "win32":
        return "tauri.windows.conf.json"
    if sys.platform == "darwin":
        return "tauri.macos.conf.json"
    return "tauri.linux.conf.json"


def _read_json(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def load_base_window(checkout: Path) -> dict:
    """The app's own window object for this platform, or {} if it has none."""
    src_tauri = checkout / "src-tauri"
    for name in (platform_config_name(), "tauri.conf.json"):
        windows = _read_json(src_tauri / name).get("app", {}).get("windows")
        if isinstance(windows, list) and windows and isinstance(windows[0], dict):
            return copy.deepcopy(windows[0])
    return {}


def build_config(inst: Instance, base_window: dict | None = None) -> dict:
    window = copy.deepcopy(base_window) if base_window is not None else load_base_window(inst.checkout)

    width = float(window.get("width") or 1280)
    height = float(window.get("height") or 800)
    x, y = creation_origin(width, height)

    window.update({
        "title": inst.product_name,
        "x": x,
        "y": y,
        "skipTaskbar": True,
        "focus": False,
        "visible": True,
        # Everything below is inherited-value defence rather than a setting we
        # need. The base window object is copied verbatim, so any of these
        # appearing in the app's platform config later would quietly undo
        # the off-screen placement: `center` overrides x/y outright, maximized
        # and fullscreen snap the window onto a monitor, `preventOverflow`
        # clamps it back into the work area, and `visible: false` is the exact
        # thing this module exists to avoid.
        "center": False,
        "maximized": False,
        "fullscreen": False,
        "preventOverflow": None,
        "alwaysOnTop": False,
    })

    return {
        "$schema": "https://schema.tauri.app/config/2",
        "identifier": inst.identifier,
        "productName": inst.product_name,
        "build": {
            "beforeDevCommand": "npm run dev -- --port " + str(inst.vite_port) + " --strictPort",
            "devUrl": "http://localhost:" + str(inst.vite_port),
        },
        "app": {"windows": [window]},
    }


def write_config(inst: Instance) -> Path:
    """Write the generated config for this instance and return its path.

    Note for anyone extending build_config: this file lives under the MCP state
    dir, not next to the app's tauri.conf.json, so a relative path in it would
    resolve against the wrong directory. Today nothing in it is a path.
    """
    inst.config_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = inst.config_path.with_name(inst.config_path.name + ".tmp." + str(os.getpid()))
    tmp.write_text(json.dumps(build_config(inst), indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, inst.config_path)
    return inst.config_path


if __name__ == "__main__":
    from instance import resolve_instance
    print(json.dumps(build_config(resolve_instance()), indent=2))
