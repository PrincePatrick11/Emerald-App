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

Someone can also ask to *watch* a slot (the tray app's "Auf Hauptbildschirm
holen"). That is a stored preference - see instance.wants_visible - and
place_instance_windows(), which is what the server actually calls, honours it:
it brings the window on screen when it is not, leaves it alone when it is, and
never takes focus.

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
SW_HIDE, SW_SHOW, SW_SHOWNA, SW_RESTORE = 0, 5, 8, 9
SPI_GETWORKAREA = 0x0030
# Less than this much of a window on any monitor counts as out of sight. The
# one-pixel sliver a new window is born as has to count as hidden.
MIN_VISIBLE_PX = 120
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
    per instance by construction, since every slot builds into its own Cargo
    target directory. It also keeps this off the regular dev build and off
    other slots.

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
    """Move this instance's window out of sight, whatever was asked for."""
    return hide_windows_for(inst.target_dir, inst.product_name)


def hide_windows_for(target_dir: Path, product_name: str) -> dict:
    """Move a slot's window out of sight. Idempotent and best-effort: it runs
    on the path of every reattach and must never break a tool call."""
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


# -- bringing it back --------------------------------------------------------

def primary_work_area() -> tuple[int, int, int, int]:
    """The primary monitor minus the taskbar - where a window you asked for
    should land, rather than whichever monitor happens to be leftmost."""
    class RECT(ctypes.Structure):
        _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long),
                    ("right", ctypes.c_long), ("bottom", ctypes.c_long)]
    r = RECT()
    if IS_WINDOWS and _user32().SystemParametersInfoW(SPI_GETWORKAREA, 0, ctypes.byref(r), 0):
        return (r.left, r.top, r.right, r.bottom)
    return (0, 0, 1920, 1080)


def _visible_on_desktop(rect: tuple[int, int, int, int]) -> bool:
    """Whether enough of the window is on some monitor to count as visible.
    Raw metrics, in the same coordinate space GetWindowRect reports in."""
    u = _user32()
    vl, vt = u.GetSystemMetrics(SM_XVIRTUALSCREEN), u.GetSystemMetrics(SM_YVIRTUALSCREEN)
    vr, vb = vl + u.GetSystemMetrics(SM_CXVIRTUALSCREEN), vt + u.GetSystemMetrics(SM_CYVIRTUALSCREEN)
    left, top, right, bottom = rect
    width = min(right, vr) - max(left, vl)
    height = min(bottom, vb) - max(top, vt)
    return width >= MIN_VISIBLE_PX and height >= MIN_VISIBLE_PX


def show_windows_for(target_dir: Path, product_name: str, activate: bool) -> dict:
    """Centre a slot's window on the primary monitor and put it back in the
    taskbar and Alt-Tab.

    `activate` is only for a person asking: it restores a minimized window and
    brings it to the front. The automatic path never activates - a `status`
    call from an agent must not pull a window in front of whatever you are
    typing into.
    """
    if not IS_WINDOWS:
        return {"shown": 0, "reason": "not Windows"}
    hwnds = find_instance_windows(target_dir, product_name)
    if not hwnds:
        return {"shown": 0, "reason": "no matching window found"}

    u = _user32()
    wl, wt, wr, wb = primary_work_area()
    shown = []
    for hwnd in hwnds:
        if activate and u.IsIconic(hwnd):
            u.ShowWindow(hwnd, SW_RESTORE)
        left, top, right, bottom = _rect(hwnd)
        width, height = right - left, bottom - top
        x = wl + max(0, ((wr - wl) - width) // 2)
        y = wt + max(0, ((wb - wt) - height) // 2)
        # Same hide/show dance as going out: the taskbar only notices the
        # style change across it.
        u.ShowWindow(hwnd, SW_HIDE)
        style = u.GetWindowLongW(hwnd, GWL_EXSTYLE)
        u.SetWindowLongW(hwnd, GWL_EXSTYLE, style & ~WS_EX_TOOLWINDOW)
        flags = SWP_NOSIZE | SWP_NOZORDER | (0 if activate else SWP_NOACTIVATE)
        u.SetWindowPos(hwnd, 0, x, y, 0, 0, flags)
        u.ShowWindow(hwnd, SW_SHOW if activate else SW_SHOWNA)
        if activate:
            u.SetForegroundWindow(hwnd)
        shown.append({"hwnd": int(hwnd), "from": (left, top), "to": (x, y)})
    log.info("brought %d window(s) on screen at %s", len(shown), shown[0]["to"])
    return {"shown": len(shown), "windows": shown}


def place_instance_windows(inst) -> dict:
    """Put the window where it is wanted: out of sight by default, on screen
    if someone asked to watch this slot.

    This is what the server calls on every attach and every `status`. A
    window that is already on screen is left exactly where it is, so one you
    dragged to your second monitor stays there; a minimized one is left alone
    too, since minimizing it was presumably the point.
    """
    import instance as _instance

    if not _instance.wants_visible(inst.slot):
        return hide_instance_windows(inst)
    if not IS_WINDOWS:
        return {"moved": 0, "visible": True, "reason": "not Windows"}
    hwnds = find_instance_windows(inst.target_dir, inst.product_name)
    if not hwnds:
        return {"moved": 0, "visible": True, "reason": "no matching window found"}
    u = _user32()
    if all(u.IsIconic(h) or _visible_on_desktop(_rect(h)) for h in hwnds):
        return {"moved": 0, "visible": True, "reason": "already on screen"}
    # A fresh window after a restart is born as a sliver in the corner.
    result = show_windows_for(inst.target_dir, inst.product_name, activate=False)
    result["visible"] = True
    return result


def _slot_window(slot: int) -> tuple[Path, str]:
    import instance as _instance

    name = _instance.load_registry()["slots"].get(str(slot), {}).get("name") or "main"
    return _instance.target_dir_for(slot), _instance.product_name_for(slot, name)


def show_slot(slot: int) -> dict:
    """For the tray app: remember that this slot should be watched, and bring
    its window up now if it is running. The preference is set either way, so
    a stopped slot comes up on screen when it next starts."""
    import instance as _instance

    _instance.set_wants_visible(slot, True)
    return show_windows_for(*_slot_window(slot), activate=True)


def hide_slot(slot: int) -> dict:
    """For the tray app: forget the preference and push the window back out."""
    import instance as _instance

    _instance.set_wants_visible(slot, False)
    return hide_windows_for(*_slot_window(slot))


def place_slot(slot: int) -> dict:
    """place_instance_windows for a slot known only by its number: the tray
    app's clock, for instances it started itself and no server is attached to.
    Without it such a window would stay wherever it was created."""
    from types import SimpleNamespace

    target_dir, product_name = _slot_window(slot)
    return place_instance_windows(
        SimpleNamespace(slot=slot, target_dir=target_dir, product_name=product_name)
    )


# -- border colour -------------------------------------------------------------

DWMWA_BORDER_COLOR = 34
DWMWA_COLOR_DEFAULT = 0xFFFFFFFF


def _colorref(colour: str) -> int:
    """'#rrggbb' -> COLORREF, which is 0x00BBGGRR."""
    value = colour.lstrip("#")
    r, g, b = int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)
    return r | (g << 8) | (b << 16)


_applied_border: dict[int, int] = {}


def set_border(target_dir: Path, colour: str | None) -> int:
    """Colour the one-pixel frame Windows 11 draws around the main window of
    an app running out of `target_dir`; None puts the system colour back.

    Done from outside, through DWM, so the app itself does not have to know it
    is a dev build. Windows it has already been applied to are skipped, which
    keeps a caller polling for recreated windows - `tauri dev` makes a new one
    on every Rust rebuild - down to one EnumWindows per call. Returns the
    number of windows changed. Older Windows ignores the attribute.
    """
    if not IS_WINDOWS:
        return 0
    value = DWMWA_COLOR_DEFAULT if not colour else _colorref(colour)
    dwmapi = ctypes.windll.dwmapi
    changed = 0
    for hwnd in (h for h in _owned_windows(target_dir) if _is_main_sized(h)):
        if _applied_border.get(int(hwnd)) == value:
            continue
        c = ctypes.c_uint(value)
        if dwmapi.DwmSetWindowAttribute(wintypes.HWND(hwnd), DWMWA_BORDER_COLOR,
                                        ctypes.byref(c), ctypes.sizeof(c)) == 0:
            _applied_border[int(hwnd)] = value
            changed += 1
    return changed
