"""Keeps an instance's window out of the user's way (Windows).

An agent driving Emerald should not put a window in front of whoever is using
the machine. The obvious answer, `visible: false` in the Tauri config, is the
wrong one: WebView2 stops producing frames for a window it considers hidden,
and Page.captureScreenshot then hands back a stale or empty image. Moving the
window off-screen keeps it compositing, so screenshots stay honest.

That has to happen in two steps, because Windows will not create a window
whose rectangle lies entirely outside the virtual screen — ask for
(-6000, -6000) in the config and you get the default cascade position instead,
in the middle of the screen. So:

  1. The generated config asks for `creation_origin()`, one pixel inside the
     bottom-right corner of the virtual screen. That is accepted, so the window
     appears as a sliver rather than as a full window in the user's face.
  2. Once the CDP target is up, `hide_instance_windows()` moves it the rest of
     the way out with SetWindowPos, which has no such restriction, and marks it
     WS_EX_TOOLWINDOW so it is in neither the taskbar nor Alt-Tab.

Step 2 runs on every (re)attach, not just the first: `tauri dev` restarts the
app whenever the Rust source changes, and the replacement window would
otherwise come back on screen.

  EMERALD_MCP_OFFSCREEN_XY="40,40"  keeps the window on screen, for watching a
                                    run. An on-screen position also leaves the
                                    taskbar entry alone, so you can find it.
"""

from __future__ import annotations

import ctypes
import logging
import os
import sys
from ctypes import wintypes
from pathlib import Path

log = logging.getLogger("emerald-window")

IS_WINDOWS = sys.platform == "win32"

# Far out, but deliberately nowhere near (-32000, -32000): that is where
# Windows parks a minimized window, and colliding with that sentinel makes
# every later diagnosis ambiguous.
FALLBACK_OFFSCREEN = (-6000.0, -6000.0)
MIN_COORD = -30000.0
MAX_COORD = -2000.0

SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN = 76, 77
SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN = 78, 79

GWL_EXSTYLE = -20
WS_EX_TOOLWINDOW = 0x00000080
SWP_NOSIZE, SWP_NOZORDER, SWP_NOACTIVATE = 0x0001, 0x0004, 0x0010
SW_HIDE, SW_SHOWNA = 0, 8
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000


def _user32():
    return ctypes.windll.user32


def dpi_scale() -> float:
    if not IS_WINDOWS:
        return 1.0
    try:
        dpi = _user32().GetDpiForSystem()
        return (dpi / 96.0) if dpi else 1.0
    except Exception:
        return 1.0


def virtual_screen() -> tuple[float, float, float, float]:
    """(left, top, right, bottom) of the whole desktop, in logical pixels —
    the unit Tauri's window config uses."""
    if not IS_WINDOWS:
        return (0.0, 0.0, 1920.0, 1080.0)
    try:
        u = _user32()
        scale = dpi_scale()
        left = u.GetSystemMetrics(SM_XVIRTUALSCREEN) / scale
        top = u.GetSystemMetrics(SM_YVIRTUALSCREEN) / scale
        width = u.GetSystemMetrics(SM_CXVIRTUALSCREEN) / scale
        height = u.GetSystemMetrics(SM_CYVIRTUALSCREEN) / scale
        return (left, top, left + width, top + height)
    except Exception:
        return (0.0, 0.0, 1920.0, 1080.0)


def _override() -> tuple[float, float] | None:
    raw = os.environ.get("EMERALD_MCP_OFFSCREEN_XY")
    if not raw:
        return None
    try:
        x, y = raw.split(",", 1)
        return float(x), float(y)
    except ValueError:
        log.warning("ignoring malformed EMERALD_MCP_OFFSCREEN_XY=%r", raw)
        return None


def offscreen_origin(width: float, height: float) -> tuple[float, float]:
    """Where the window ends up: clear of every monitor."""
    forced = _override()
    if forced:
        return forced
    left, top, _, _ = virtual_screen()
    x = min(MAX_COORD, max(MIN_COORD, left - width - 500))
    y = min(MAX_COORD, max(MIN_COORD, top - height - 500))
    return float(x), float(y)


def creation_origin(width: float, height: float) -> tuple[float, float]:
    """Where the window is *born*: one pixel inside the bottom-right corner.

    Windows ignores a creation rectangle that is entirely off-screen and falls
    back to its default position — which is the middle of the screen, the worst
    possible outcome. A single pixel of overlap is enough for the position to
    be honoured, and is what the user briefly sees before step 2 moves it.
    """
    forced = _override()
    if forced:
        return forced
    _, _, right, bottom = virtual_screen()
    return float(right - 1), float(bottom - 1)


def is_on_screen(x: float, y: float) -> bool:
    left, top, right, bottom = virtual_screen()
    return left <= x < right and top <= y < bottom


# -- finding an instance's windows --------------------------------------------

def _process_image_path(pid: int) -> str | None:
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return None
    try:
        size = wintypes.DWORD(32768)
        buf = ctypes.create_unicode_buffer(size.value)
        if not kernel32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)):
            return None
        return buf.value
    finally:
        kernel32.CloseHandle(handle)


def _window_title(hwnd) -> str:
    buf = ctypes.create_unicode_buffer(512)
    _user32().GetWindowTextW(hwnd, buf, 512)
    return buf.value


MIN_MAIN_WINDOW_SIZE = 200


def find_instance_windows(target_dir: Path, product_name: str) -> list[int]:
    """Top-level windows belonging to this instance's app.

    Ownership is decided by the executable path: that is the one thing unique
    to the instance by construction, since it builds into its own Cargo
    target directory. It also keeps this off the regular dev build.

    Among that process's windows, the title picks the main one. When no title
    matches - an instance started before the generated config existed carries
    the app's own title - fall back to size, which still excludes the 16x16
    helper windows Tauri keeps around and the hidden PDF-export webview.
    """
    owned = _owned_windows(target_dir)
    by_title = [h for h in owned if _window_title(h) == product_name]
    if by_title:
        return by_title
    return [h for h in owned if _is_main_sized(h)]


def _owned_windows(target_dir: Path) -> list[int]:
    """Visible top-level windows of any process running out of `target_dir`."""
    if not IS_WINDOWS:
        return []
    u = _user32()
    wanted = str(target_dir).lower()
    owned: list[int] = []
    pid_cache: dict[int, str | None] = {}

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def visit(hwnd, _lparam):
        if not u.IsWindowVisible(hwnd):
            return True
        pid = wintypes.DWORD()
        u.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        key = pid.value
        if key not in pid_cache:
            pid_cache[key] = _process_image_path(key)
        path = pid_cache[key]
        if path and path.lower().startswith(wanted):
            owned.append(hwnd)
        return True

    u.EnumWindows(visit, 0)
    return owned


def _is_main_sized(hwnd) -> bool:
    left, top, right, bottom = _rect(hwnd)
    return (right - left) >= MIN_MAIN_WINDOW_SIZE and (bottom - top) >= MIN_MAIN_WINDOW_SIZE


def _rect(hwnd) -> tuple[int, int, int, int]:
    class RECT(ctypes.Structure):
        _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long),
                    ("right", ctypes.c_long), ("bottom", ctypes.c_long)]
    r = RECT()
    _user32().GetWindowRect(hwnd, ctypes.byref(r))
    return (r.left, r.top, r.right, r.bottom)


def _move_offscreen(hwnd, x: int, y: int, mark_toolwindow: bool) -> None:
    u = _user32()
    # The taskbar and Alt-Tab only re-read WS_EX_TOOLWINDOW across a
    # hide/show, and showing again while already off-screen keeps the flash to
    # the sliver the window was created as. SW_SHOWNA rather than SW_SHOW so
    # this never takes focus away from whatever the user is doing.
    u.ShowWindow(hwnd, SW_HIDE)
    if mark_toolwindow:
        style = u.GetWindowLongW(hwnd, GWL_EXSTYLE)
        u.SetWindowLongW(hwnd, GWL_EXSTYLE, style | WS_EX_TOOLWINDOW)
    u.SetWindowPos(hwnd, 0, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE)
    u.ShowWindow(hwnd, SW_SHOWNA)


def hide_instance_windows(inst) -> dict:
    """Move this instance's window out of sight. This is what the server
    calls on every attach and every `status`."""
    return hide_windows_for(inst.target_dir, inst.product_name)


def hide_windows_for(target_dir: Path, product_name: str) -> dict:
    """Idempotent and best-effort: it runs on the path of every reattach and
    must never break a tool call."""
    if not IS_WINDOWS:
        return {"moved": 0, "reason": "not Windows"}

    hwnds = find_instance_windows(target_dir, product_name)
    if not hwnds:
        return {"moved": 0, "reason": "no matching window found"}

    left, top, right, bottom = _rect(hwnds[0])
    x, y = offscreen_origin(float(right - left) or 1280.0, float(bottom - top) or 800.0)
    scale = dpi_scale()
    px, py = int(x * scale), int(y * scale)
    on_screen = is_on_screen(x, y)

    moved = []
    for hwnd in hwnds:
        rect = _rect(hwnd)
        if rect[0] == px and rect[1] == py:
            continue  # already where it belongs
        _move_offscreen(hwnd, px, py, mark_toolwindow=not on_screen)
        moved.append({"hwnd": int(hwnd), "from": rect[:2], "to": (px, py)})

    if moved:
        log.info("moved %d window(s) to %s,%s", len(moved), px, py)
    return {"moved": len(moved), "position": (px, py), "on_screen": on_screen, "windows": moved}
