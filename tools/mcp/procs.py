"""Stopping an instance (Windows).

Freeing a slot means ending the whole launcher tree, not just the app: `cmd`
runs the batch, which runs `npx tauri dev`, which runs cargo and the Vite dev
server as well as emerald.exe. Killing emerald.exe alone leaves Vite holding
the slot's frontend port and the watcher ready to rebuild - the slot would look
free and behave otherwise.

So the launcher's own pid is recorded when it is spawned and the tree is taken
down from there. A pid on its own is not enough to act on: pids are reused, and
killing a tree by a stale number is the kind of mistake that takes out
something unrelated. Every kill therefore verifies the process really is one of
our launchers first.
"""

from __future__ import annotations

import logging
import subprocess
import sys

log = logging.getLogger("emerald-procs")

IS_WINDOWS = sys.platform == "win32"
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
LAUNCHER_MARKER = "start_emerald"


def _run(args: list[str], timeout: float = 15.0) -> subprocess.CompletedProcess:
    return subprocess.run(
        args, capture_output=True, text=True, timeout=timeout, creationflags=_NO_WINDOW
    )


def command_line(pid: int) -> str | None:
    """The process's command line, or None if it is gone."""
    if not IS_WINDOWS:
        return None
    try:
        out = _run([
            "powershell", "-NoProfile", "-NonInteractive", "-Command",
            f"(Get-CimInstance Win32_Process -Filter 'ProcessId={int(pid)}').CommandLine",
        ])
    except (OSError, subprocess.SubprocessError):
        return None
    line = out.stdout.strip()
    return line or None


def is_our_launcher(pid: int) -> bool:
    """Guards every kill: the pid must still be a launcher of ours, not
    whatever the OS handed the number to next."""
    cmd = command_line(pid)
    return bool(cmd and LAUNCHER_MARKER in cmd)


def stop_tree(pid: int) -> bool:
    """Kill the launcher and everything under it. Returns True if it went."""
    if not IS_WINDOWS or not pid:
        return False
    if not is_our_launcher(pid):
        log.info("pid %s is not one of our launchers any more - not killing it", pid)
        return False
    try:
        out = _run(["taskkill", "/PID", str(int(pid)), "/T", "/F"])
    except (OSError, subprocess.SubprocessError) as e:
        log.warning("taskkill on %s failed: %s", pid, e)
        return False
    if out.returncode != 0:
        log.warning("taskkill on %s: %s", pid, (out.stderr or out.stdout).strip()[:200])
    return out.returncode == 0


def stop_by_target_dir(target_dir) -> int:
    """Fallback when no launcher pid was recorded: kill every emerald.exe
    running out of this slot's build directory. Leaves the dev build and other
    slots alone, because each slot builds into its own directory."""
    if not IS_WINDOWS:
        return 0
    escaped = str(target_dir).replace("'", "''")
    script = (
        "$p = Get-Process emerald -ErrorAction SilentlyContinue | "
        f"Where-Object {{ $_.Path -like '{escaped}*' }}; "
        "if ($p) { $p | Stop-Process -Force; $p.Count } else { 0 }"
    )
    try:
        out = _run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script])
    except (OSError, subprocess.SubprocessError):
        return 0
    try:
        return int(out.stdout.strip() or 0)
    except ValueError:
        return 0


_STILL_ACTIVE = 259
_PROCESS_QUERY_LIMITED_INFORMATION = 0x1000


def pid_alive(pid: int, image_name: str = "cmd.exe") -> bool:
    """Whether a pid is still running and is the kind of process we started.

    Cheap enough for a window that refreshes every few seconds, unlike
    command_line(), which starts PowerShell. The image name is the guard
    against a reused pid: every launcher is a cmd.exe.
    """
    if not IS_WINDOWS or not pid:
        return False
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION, False, int(pid))
    if not handle:
        return False
    try:
        code = wintypes.DWORD()
        if not kernel32.GetExitCodeProcess(handle, ctypes.byref(code)) or code.value != _STILL_ACTIVE:
            return False
        size = wintypes.DWORD(32768)
        buf = ctypes.create_unicode_buffer(size.value)
        if not kernel32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)):
            return False
        return buf.value.lower().endswith(image_name.lower())
    finally:
        kernel32.CloseHandle(handle)


def stop_port_owner(port: int, names: tuple[str, ...] = ("node",)) -> int:
    """Kill whatever listens on `port`, provided it is one of `names`.

    For a dev server someone started by hand, whose launcher was never
    recorded: without it, stopping the app would leave Vite holding the port
    and the next start would fail on strictPort.
    """
    if not IS_WINDOWS:
        return 0
    allowed = ",".join(f"'{n}'" for n in names)
    script = (
        f"$n = 0; foreach ($c in Get-NetTCPConnection -LocalPort {int(port)} -State Listen "
        "-ErrorAction SilentlyContinue) { "
        "$p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue; "
        f"if ($p -and @({allowed}) -contains $p.ProcessName) {{ Stop-Process -Id $p.Id -Force; $n++ }} }}; $n"
    )
    try:
        out = _run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script])
    except (OSError, subprocess.SubprocessError):
        return 0
    try:
        return int(out.stdout.strip() or 0)
    except ValueError:
        return 0


def exe_running_under(directory) -> bool:
    """Whether any process runs an executable from inside `directory`.

    Enumerates processes directly rather than through PowerShell, which takes
    the better part of a second - too slow for a window refreshing every few
    seconds.
    """
    if not IS_WINDOWS:
        return False
    import ctypes
    from ctypes import wintypes

    prefix = str(directory).rstrip("\\/").lower() + "\\"
    psapi = ctypes.windll.psapi
    kernel32 = ctypes.windll.kernel32
    count = 4096
    pids = (wintypes.DWORD * count)()
    needed = wintypes.DWORD()
    if not psapi.EnumProcesses(ctypes.byref(pids), ctypes.sizeof(pids), ctypes.byref(needed)):
        return False
    buf = ctypes.create_unicode_buffer(32768)
    for pid in pids[: needed.value // ctypes.sizeof(wintypes.DWORD)]:
        if not pid:
            continue
        handle = kernel32.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not handle:
            continue
        try:
            size = wintypes.DWORD(len(buf))
            if kernel32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)):
                if buf.value.lower().startswith(prefix):
                    return True
        finally:
            kernel32.CloseHandle(handle)
    return False
