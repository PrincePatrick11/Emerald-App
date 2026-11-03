"""Native dialogs of an instance (Windows): the file pickers and message boxes
Emerald opens through tauri-plugin-dialog.

Those are windows of the app's own process, not part of the WebView, so CDP
cannot see them - a snapshot shows the page behind as if nothing were open,
and a screenshot does not include them. They are reached here the way any
other program's dialog is: found by owner, read through their child controls,
and answered by setting the file name field and pressing a button with window
messages. That needs neither focus nor the window to be on screen, which is
what an instance parked off-screen has to offer.

The message of a task dialog (the modern message box tauri uses) is drawn
rather than made of controls, so there is no window to ask for it. For those
the text is read through UI Automation instead, by way of PowerShell - slower
by about a second, and only done when a dialog shows no text otherwise.
"""

from __future__ import annotations

import ctypes
import os
import subprocess
import sys
import time
from ctypes import wintypes
from dataclasses import dataclass, field
from pathlib import Path

IS_WINDOWS = sys.platform == "win32"

DIALOG_CLASS = "#32770"
WM_CLOSE, WM_GETTEXT, WM_GETTEXTLENGTH, WM_COMMAND = 0x0010, 0x000D, 0x000E, 0x0111
EM_SETSEL, EM_REPLACESEL = 0x00B1, 0x00C2
SMTO_ABORTIFHUNG = 0x0002
GW_OWNER = 4
GWL_STYLE = -16
BS_TYPEMASK = 0x0F
BS_DEFPUSHBUTTON, BS_DEFSPLITBUTTON, BS_DEFCOMMANDLINK = 0x1, 0xD, 0xF
# Push buttons, split buttons and command links; the rest of the BS_ types are
# checkboxes, radio buttons and group boxes, which do not answer a dialog.
PUSH_TYPES = {0x0, 0x1, 0xC, 0xD, 0xE, 0xF}
IDOK, IDCANCEL, IDYES = 1, 2, 6
# The file name field: 1148 in an Open dialog, 1001 in a Save dialog, 1152 in
# a folder picker.
FILE_NAME_IDS = (1148, 1001, 1152)
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
MESSAGE_TIMEOUT_MS = 1000
CLOSE_WAIT_SEC = 3.0


@dataclass
class Button:
    label: str
    hwnd: int
    control_id: int
    default: bool


@dataclass
class Dialog:
    hwnd: int
    title: str
    text: str
    buttons: list[Button] = field(default_factory=list)
    file_field: int | None = None

    def to_dict(self, index: int) -> dict:
        out: dict = {"index": index, "title": self.title}
        if self.text:
            out["text"] = self.text
        out["buttons"] = [b.label for b in self.buttons]
        if self.file_field:
            out["file_field"] = True
        return out


def _api():
    """user32 and kernel32 with their signatures declared. Private instances,
    so the declarations stay out of ctypes.windll, which window.py shares."""
    u = ctypes.WinDLL("user32", use_last_error=True)
    k = ctypes.WinDLL("kernel32", use_last_error=True)
    lresult = ctypes.c_ssize_t
    u.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    u.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    u.IsWindowVisible.argtypes = [wintypes.HWND]
    u.IsWindow.argtypes = [wintypes.HWND]
    u.GetWindow.argtypes = [wintypes.HWND, wintypes.UINT]
    u.GetWindow.restype = wintypes.HWND
    u.GetParent.argtypes = [wintypes.HWND]
    u.GetParent.restype = wintypes.HWND
    u.GetDlgCtrlID.argtypes = [wintypes.HWND]
    u.GetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int]
    u.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    u.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    u.SendMessageTimeoutW.argtypes = [
        wintypes.HWND, wintypes.UINT, wintypes.WPARAM, ctypes.c_void_p,
        wintypes.UINT, wintypes.UINT, ctypes.POINTER(lresult),
    ]
    u.SendMessageTimeoutW.restype = lresult
    k.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    k.OpenProcess.restype = wintypes.HANDLE
    k.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    k.CloseHandle.argtypes = [wintypes.HANDLE]
    return u, k


def _send(u, hwnd: int, message: int, wparam: int = 0, lparam=None) -> int:
    """SendMessage that gives up on a hung window instead of hanging with it."""
    result = ctypes.c_ssize_t(0)
    u.SendMessageTimeoutW(hwnd, message, wparam, lparam, SMTO_ABORTIFHUNG, MESSAGE_TIMEOUT_MS, ctypes.byref(result))
    return result.value


def _class_name(u, hwnd: int) -> str:
    buf = ctypes.create_unicode_buffer(256)
    u.GetClassNameW(hwnd, buf, 256)
    return buf.value


def _control_text(u, hwnd: int) -> str:
    """A control's text. WM_GETTEXT rather than GetWindowText, which does not
    ask a control that belongs to another process."""
    length = _send(u, hwnd, WM_GETTEXTLENGTH)
    if length <= 0:
        return ""
    buf = ctypes.create_unicode_buffer(length + 1)
    _send(u, hwnd, WM_GETTEXT, length + 1, ctypes.cast(buf, ctypes.c_void_p))
    return buf.value


def _pid(u, hwnd: int) -> int:
    pid = wintypes.DWORD()
    u.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    return pid.value


def _image_path(k, pid: int) -> str:
    handle = k.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return ""
    try:
        size = wintypes.DWORD(32768)
        buf = ctypes.create_unicode_buffer(size.value)
        return buf.value if k.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)) else ""
    finally:
        k.CloseHandle(handle)


def _children(u, hwnd: int) -> list[int]:
    found: list[int] = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def visit(child, _lparam):
        if u.IsWindowVisible(child):
            found.append(child)
        return True

    u.EnumChildWindows(wintypes.HWND(hwnd), visit, 0)
    return found


def _label(text: str) -> str:
    """A button's caption without the accelerator marker: '&Open' -> 'Open'."""
    return text.replace("&&", "\0").replace("&", "").replace("\0", "&").strip()


def _read(u, hwnd: int) -> Dialog:
    title = ctypes.create_unicode_buffer(512)
    u.GetWindowTextW(hwnd, title, 512)
    dialog = Dialog(hwnd=hwnd, title=title.value, text="")
    texts: list[str] = []
    edits: list[int] = []
    for child in _children(u, hwnd):
        cls = _class_name(u, child)
        if cls == "Button":
            kind = u.GetWindowLongW(child, GWL_STYLE) & BS_TYPEMASK
            label = _label(_control_text(u, child))
            if kind in PUSH_TYPES and label:
                default = kind in (BS_DEFPUSHBUTTON, BS_DEFSPLITBUTTON, BS_DEFCOMMANDLINK)
                dialog.buttons.append(Button(label, child, u.GetDlgCtrlID(child), default))
        elif cls == "Static":
            text = _control_text(u, child).strip()
            if text:
                texts.append(text)
        elif cls == "Edit" and (
            u.GetDlgCtrlID(child) in FILE_NAME_IDS
            or _class_name(u, u.GetParent(child) or 0) in ("ComboBox", "ComboBoxEx32")
        ):
            edits.append(child)
    dialog.text = "\n".join(texts) or _drawn_text(hwnd, {b.label for b in dialog.buttons} | {dialog.title})
    by_id = [e for e in edits if u.GetDlgCtrlID(e) in FILE_NAME_IDS]
    dialog.file_field = (by_id or edits or [None])[0]
    return dialog


_UIA_TEXT = (
    "Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes;"
    "$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]{hwnd});"
    "$isText = New-Object System.Windows.Automation.PropertyCondition("
    "[System.Windows.Automation.AutomationElement]::ControlTypeProperty,"
    "[System.Windows.Automation.ControlType]::Text);"
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;"
    "$root.FindAll('Descendants', $isText) | ForEach-Object {{ $_.Current.Name }}"
)


def _drawn_text(hwnd: int, skip: set[str]) -> str:
    """The text of a dialog that has no Static controls, via UI Automation.
    Best effort: an empty string is a perfectly good answer."""
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", _UIA_TEXT.format(hwnd=int(hwnd))],
            capture_output=True, timeout=8, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    lines = [line.strip() for line in out.stdout.decode("utf-8", errors="replace").splitlines()]
    return "\n".join(line for line in lines if line and line not in skip)


def wait_for_dialogs(target_dir: Path, timeout: float = 1.5) -> list[Dialog]:
    """find_dialogs, giving one a moment to appear: the click that opens a
    dialog returns before the window exists."""
    deadline = time.monotonic() + timeout
    while True:
        found = find_dialogs(target_dir)
        if found or time.monotonic() >= deadline:
            return found
        time.sleep(0.1)


def find_dialogs(target_dir: Path | None = None, pids: set[int] | None = None) -> list[Dialog]:
    """Open dialogs that belong to an instance: the dialog's own process, or
    the process of the window that owns it, runs out of `target_dir` (or is
    one of `pids`). Ownership by executable path is the same rule window.py
    uses, and keeps this off every other program's dialogs."""
    return [read_dialog(h) for h in dialog_handles(target_dir, pids)]


def read_dialog(hwnd: int) -> Dialog:
    return _read(_api()[0], hwnd)


def dialog_handles(target_dir: Path | None = None, pids: set[int] | None = None) -> list[int]:
    """The windows find_dialogs would read, topmost first, without reading
    them - cheap enough to ask again and again while waiting for one."""
    if not IS_WINDOWS:
        return []
    u, k = _api()
    wanted = str(target_dir).lower() if target_dir else None
    belongs: dict[int, bool] = {}

    def ours(pid: int) -> bool:
        if pid not in belongs:
            belongs[pid] = bool(pids and pid in pids) or bool(wanted and _image_path(k, pid).lower().startswith(wanted))
        return belongs[pid]

    handles: list[int] = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def visit(hwnd, _lparam):
        if u.IsWindowVisible(hwnd) and _class_name(u, hwnd) == DIALOG_CLASS:
            owner = u.GetWindow(hwnd, GW_OWNER)
            if ours(_pid(u, hwnd)) or (owner and ours(_pid(u, owner))):
                handles.append(hwnd)
        return True

    u.EnumWindows(visit, 0)
    return handles


def _choose(dialog: Dialog, action: str, button: str | None) -> Button | None:
    by_id = {b.control_id: b for b in dialog.buttons}
    if action == "click":
        if not button:
            raise ValueError("action 'click' needs the button's label")
        wanted = button.strip().lower()
        for match in (lambda b: b.label.lower() == wanted, lambda b: b.label.lower().startswith(wanted)):
            hit = next((b for b in dialog.buttons if match(b)), None)
            if hit:
                return hit
        raise ValueError(f"no button {button!r} - this dialog has: " + ", ".join(b.label for b in dialog.buttons))
    if action == "accept":
        hit = by_id.get(IDOK) or next((b for b in dialog.buttons if b.default), None) or by_id.get(IDYES)
        if hit is None:
            raise ValueError("cannot tell which button accepts - use action 'click' with one of: "
                             + ", ".join(b.label for b in dialog.buttons))
        return hit
    if action == "cancel":
        return by_id.get(IDCANCEL)  # None: closed like the title bar's X instead
    raise ValueError(f"unknown action {action!r} - list, accept, cancel or click")


def respond(dialog: Dialog, action: str, button: str | None = None, path: str | None = None) -> dict:
    """Answer a dialog and wait for it to go away.

    `path` fills in the file name field first. A dialog that stays open
    afterwards is not necessarily a failure: a file picker that rejected the
    name, or one asking whether to overwrite, shows up as another dialog."""
    u, _k = _api()
    if path is not None:
        if not dialog.file_field:
            raise ValueError("this dialog has no file name field to put a path into")
        # The shell's pickers reject forward slashes outright.
        text = ctypes.create_unicode_buffer(os.path.normpath(str(path)))
        # Replacing the selection, as typing over it would - not WM_SETTEXT:
        # a Save dialog shows text set that way and then saves under the
        # name it had before.
        _send(u, dialog.file_field, EM_SETSEL, 0, ctypes.c_void_p(-1))
        _send(u, dialog.file_field, EM_REPLACESEL, 1, ctypes.cast(text, ctypes.c_void_p))
    chosen = _choose(dialog, action, button)
    if chosen is None:
        u.PostMessageW(dialog.hwnd, WM_CLOSE, 0, 0)
    else:
        # The notification a click would send, to whoever the button reports
        # to. BM_CLICK is not used: it needs the dialog to be the active
        # window, which an off-screen instance's never is.
        u.PostMessageW(u.GetParent(chosen.hwnd), WM_COMMAND, chosen.control_id & 0xFFFF, chosen.hwnd)

    closed = _wait_closed(u, dialog.hwnd, CLOSE_WAIT_SEC)
    if not closed and path is not None and chosen is not None and not _control_text(u, dialog.file_field):
        # A folder picker given a path only goes there, and empties the
        # field; pressing again is what selects the folder it is now in.
        u.PostMessageW(u.GetParent(chosen.hwnd), WM_COMMAND, chosen.control_id & 0xFFFF, chosen.hwnd)
        closed = _wait_closed(u, dialog.hwnd, CLOSE_WAIT_SEC)
    return {"pressed": chosen.label if chosen else "(closed)", "closed": closed}


def _wait_closed(u, hwnd: int, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not u.IsWindow(hwnd) or not u.IsWindowVisible(hwnd):
            return True
        time.sleep(0.05)
    return False
