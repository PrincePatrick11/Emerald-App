"""Auto-launch logic for the Emerald app (Windows).

Spawns start_emerald_mcp.bat detached so it survives past the MCP server's own
lifetime, tracks launch progress so concurrent _ensure_target() calls don't
double-launch, and polls the CDP port until it comes up (or the launcher script
exits early with a failure).

Everything that distinguishes one instance from another - port, app identifier,
Cargo target dir, checkout, seed vault - is handed to the script through the
environment (see instance.py); the script itself has no per-instance knowledge
and falls back to slot 0's values when run by hand. Set EMERALD_LAUNCHER_PATH to
start_emerald_dev.bat if you want auto-launch to use the regular dev
environment instead.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import tauri_config
from cdp import discover_targets
import procs
from instance import Instance, _port_in_use, browser_args, record_launcher, running_launcher

log = logging.getLogger("emerald-launcher")

REPO_ROOT = Path(__file__).resolve().parent

# The password a dev build encrypts and unlocks the seed vault with (Emerald
# checkouts with vault encryption; older ones ignore the variables). Not a
# secret: the seed holds fixture data only, and only debug builds read it.
SEED_PASSWORD = "emerald-seed"


@dataclass
class LaunchState:
    status: str = "idle"  # idle | launching | ready | failed
    proc: subprocess.Popen | None = None
    started_at: float | None = None
    log_path: Path | None = None
    error: str | None = None
    attempt: int = 0
    # Set instead of `proc` when the launch was started by someone else - the
    # tray app, or another session in the same checkout - and we only wait.
    adopted_pid: int | None = None


_state = LaunchState()
_state_lock = asyncio.Lock()


def _default_batch_path() -> Path:
    return Path(os.environ.get("EMERALD_LAUNCHER_PATH", str(REPO_ROOT / "start_emerald_mcp.bat")))


def launch_timeout() -> float:
    return float(os.environ.get("EMERALD_LAUNCH_TIMEOUT", "900"))


def _poll_interval() -> float:
    return float(os.environ.get("EMERALD_LAUNCH_POLL_INTERVAL", "1.5"))


def _tail_log(path: Path | None, n_lines: int = 40) -> str:
    if not path or not path.exists():
        return "(no launch log captured)"
    try:
        return "\n".join(path.read_text(errors="replace").splitlines()[-n_lines:])
    except OSError:
        return "(log unreadable)"


def _child_env(inst: Instance) -> dict[str, str]:
    """Everything the launcher script needs to build this instance and nothing
    else. The generated Tauri config is written here rather than in the script
    because it is derived from the checkout's own platform config."""
    tauri_config.write_config(inst)
    env = os.environ.copy()
    env["EMERALD_MCP_SLOT"] = str(inst.slot)
    env["EMERALD_APP_DIR"] = str(inst.checkout)
    env["EMERALD_TAURI_CONFIG"] = str(inst.config_path)
    env["EMERALD_MCP_APP_DATA"] = str(inst.app_data_dir)
    env["EMERALD_WEBVIEW2_ARGS"] = browser_args(inst)
    env["CARGO_TARGET_DIR"] = str(inst.target_dir)
    # A dev build encrypts the plain seed with this password the first time it
    # sees it, and unlocks it with it after that — no password dialog in an
    # unattended slot. Only this folder; every other vault asks as usual.
    env["EMERALD_DEV_SEED_VAULT"] = str(inst.seed_vault_dir)
    env["EMERALD_DEV_SEED_PASSWORD"] = SEED_PASSWORD
    # So the launcher script can run the prune step. It is done there rather
    # than here because deleting several GB takes long enough to break the
    # "still starting, retry" contract if it happened on a tool call.
    python = Path(sys.executable)
    if python.name.lower() == "pythonw.exe" and python.with_name("python.exe").exists():
        # Started from the tray app. pythonw has no stdout, so the prune
        # step's report would never reach the launch log.
        python = python.with_name("python.exe")
    env["EMERALD_MCP_PYTHON"] = str(python)
    env["EMERALD_MCP_DIR"] = str(REPO_ROOT)
    if inst.seed_from and _can_afford_target_copy(inst):
        env["EMERALD_SEED_TARGET_FROM"] = str(inst.seed_from)
    return env


def _target_copy_min_free() -> int:
    """Free bytes required before copying a warm target dir into a new slot.

    A fixed figure rather than the source's measured size: walking a warm
    target tree is ~100k stat calls, and this runs on the launch path. A build
    directory is ~5 GB, so the default leaves room for it plus headroom.
    """
    try:
        return int(os.environ.get("EMERALD_MCP_MIN_FREE_BYTES", 12 * 1024 ** 3))
    except ValueError:
        return 12 * 1024 ** 3


def _can_afford_target_copy(inst: Instance) -> bool:
    probe = inst.target_dir
    while not probe.exists() and probe.parent != probe:
        probe = probe.parent
    try:
        free = shutil.disk_usage(probe).free
    except OSError:
        return True  # unknown is not a reason to force a cold build
    needed = _target_copy_min_free()
    if free >= needed:
        return True
    log.warning(
        "only %.1f GB free on %s - skipping the warm target copy, this slot will build cold",
        free / 1024 ** 3, probe,
    )
    return False


def _creationflags(breakaway: bool) -> int:
    # CREATE_NO_WINDOW: a console that is never displayed. Deliberately
    # *not* DETACHED_PROCESS, which was the earlier choice and is the
    # subtly wrong one here: it leaves the child with no console at all,
    # so the first console program under it - cmd, then npm, cargo,
    # node - makes Windows allocate a fresh console, and on Windows 11
    # that opens as a visible Windows Terminal window that stays for the
    # life of the dev server. With CREATE_NO_WINDOW the whole tree
    # inherits one hidden console instead. Process lifetime does not
    # depend on this flag, so nothing is lost by the swap.
    # CREATE_NEW_PROCESS_GROUP: isolate from our Ctrl+C/Ctrl+Break.
    # CREATE_BREAKAWAY_FROM_JOB: escape any Job Object the host placed
    # us in, so Emerald keeps running after the MCP server exits.
    flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
    if breakaway:
        flags |= getattr(subprocess, "CREATE_BREAKAWAY_FROM_JOB", 0x01000000)
    return flags


def spawn_script(script: Path, env: dict[str, str], log_dir: Path, prefix: str) -> tuple[subprocess.Popen, Path]:
    """Run a batch script with no console anywhere on screen, its output going
    to a fresh log file instead. Shared by MCP instances and the dev session."""
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"{prefix}-{int(time.time())}.log"
    logf = open(log_path, "wb")
    kwargs = dict(
        cwd=str(script.parent),
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=logf,
        stderr=subprocess.STDOUT,
        close_fds=True,
    )
    try:
        try:
            proc = subprocess.Popen(["cmd", "/c", str(script)], creationflags=_creationflags(True), **kwargs)
        except OSError:
            # A job that does not allow breakaway refuses the whole
            # CreateProcess rather than ignoring the flag. Staying in it only
            # means the app ends with its parent, which beats not starting.
            proc = subprocess.Popen(["cmd", "/c", str(script)], creationflags=_creationflags(False), **kwargs)
    finally:
        logf.close()
    return proc, log_path


def _spawn(batch_path: Path, inst: Instance) -> subprocess.Popen:
    log_dir = Path(os.environ.get("EMERALD_LAUNCH_LOG_DIR", str(inst.log_dir)))
    proc, log_path = spawn_script(batch_path, _child_env(inst), log_dir, "emerald-launch")
    _state.log_path = log_path
    # Another session reclaiming this slot needs to know which tree to end;
    # killing emerald.exe alone would leave Vite holding the frontend port.
    record_launcher(inst.slot, proc.pid)
    return proc


def latest_log(inst: Instance) -> Path | None:
    try:
        logs = sorted(inst.log_dir.glob("emerald-launch-*.log"), key=lambda p: p.stat().st_mtime)
    except OSError:
        return None
    return logs[-1] if logs else None


def start_detached(inst: Instance) -> dict:
    """Start an instance from outside an MCP server - the tray app's button.

    Refuses when the instance is up or already building: a second launcher
    for the same slot would fight the first over the Vite port and the Cargo
    lock, and lose. A server that later wants this slot finds the launcher in
    the registry and waits for it rather than starting its own.
    """
    if _port_in_use(inst.cdp_port, inst.cdp_host):
        return {"started": False, "reason": "running"}
    if running_launcher(inst.slot):
        log_path = latest_log(inst)
        return {"started": False, "reason": "starting", "log_path": str(log_path) if log_path else None}
    batch_path = _default_batch_path()
    if not batch_path.exists():
        raise FileNotFoundError(f"launcher script not found: {batch_path}")
    proc = _spawn(batch_path, inst)
    log.info("started slot %s (%s) detached, pid %s", inst.slot, inst.name, proc.pid)
    return {"started": True, "pid": proc.pid, "log_path": str(_state.log_path)}


def _launch_exited() -> bool:
    if _state.proc is not None:
        return _state.proc.poll() is not None
    if _state.adopted_pid:
        return not procs.pid_alive(_state.adopted_pid)
    return False


async def is_alive(host: str, port: int) -> bool:
    """Cheap liveness probe: does the debug port still serve a page target?"""
    try:
        targets = await discover_targets(host, port, timeout_sec=2.0)
    except Exception:
        return False
    return any(t.get("type") == "page" for t in targets)


async def invalidate_if_dead(host: str, port: int) -> bool:
    """Drop a cached 'ready'/'launching' state whose instance is gone, so the
    next ensure_launching() actually launches instead of reporting that it gave
    up after the full timeout. Returns True if the state was reset.

    The guard on 'launching' matters: a cold build takes 5-15 minutes, and
    without it every 25s poll would tear the build down and start it again.
    """
    async with _state_lock:
        if _state.status not in ("launching", "ready"):
            return False
        if _state.status == "launching":
            exited = _launch_exited()
            elapsed = (time.monotonic() - _state.started_at) if _state.started_at else 0.0
            if not exited and elapsed <= launch_timeout():
                return False
        if await is_alive(host, port):
            return False
        log.info("instance on %s:%s is gone (was %s) - allowing a relaunch", host, port, _state.status)
        if _state.adopted_pid and procs.pid_alive(_state.adopted_pid):
            # Someone else's launcher, still running past the whole budget
            # without ever opening the port. Adopting it again would only wait
            # out another full timeout.
            procs.stop_tree(_state.adopted_pid)
        _state.adopted_pid = None
        _state.status = "idle"
        _state.proc = None
        _state.started_at = None
        _state.error = None
        return True


def reset() -> None:
    """Forget any launch in progress - the instance it was for is no longer
    ours, so its state says nothing about the one we will launch next."""
    global _state
    _state = LaunchState()


async def ensure_launching(inst: Instance) -> LaunchState:
    """Start Emerald if it isn't already launching/ready. Idempotent —
    safe to call from multiple concurrent _ensure_target() callers."""
    async with _state_lock:
        if _state.status in ("launching", "ready"):
            return _state
        batch_path = _default_batch_path()
        if not batch_path.exists():
            _state.status = "failed"
            _state.error = f"launcher script not found: {batch_path}"
            return _state
        # Started elsewhere and still building: wait for that one instead of
        # launching a second, which would lose to it on the Vite port.
        pid = running_launcher(inst.slot)
        if pid:
            _state.proc = None
            _state.adopted_pid = pid
            _state.status = "launching"
            _state.error = None
            _state.started_at = time.monotonic()
            _state.log_path = latest_log(inst)
            _state.attempt += 1
            log.info("slot %s is already being launched (pid %s) - waiting for it", inst.slot, pid)
            return _state
        try:
            proc = _spawn(batch_path, inst)
        except Exception as e:
            # Not just OSError any more: _spawn also generates the Tauri config,
            # which reads the checkout and writes the state dir.
            _state.status = "failed"
            _state.error = f"failed to spawn launcher: {type(e).__name__}: {e}"
            return _state
        _state.proc = proc
        _state.adopted_pid = None
        _state.status = "launching"
        _state.error = None
        _state.started_at = time.monotonic()
        _state.attempt += 1
        log.info(
            "launching Emerald dev (attempt %d) via %s, log=%s",
            _state.attempt, batch_path, _state.log_path,
        )
        return _state


async def poll_until_ready_or_timeout(host: str, port: int, bounded_wait: float, poll_interval: float | None = None) -> bool:
    """Poll the CDP port for up to `bounded_wait` seconds. Returns True once
    a page target is reachable. Detects early process exit (launcher script
    failed) and marks the state failed instead of waiting out the timeout."""
    interval = poll_interval if poll_interval is not None else _poll_interval()
    deadline = time.monotonic() + bounded_wait
    while time.monotonic() < deadline:
        if _state.status == "launching" and _launch_exited():
            _state.status = "failed"
            _state.error = _tail_log(_state.log_path)
            return False
        try:
            targets = await discover_targets(host, port)
            if any(t.get("type") == "page" for t in targets):
                _state.status = "ready"
                return True
        except Exception:
            pass
        await asyncio.sleep(interval)
    return False


def snapshot() -> dict:
    """Non-blocking status snapshot for the `status` tool."""
    elapsed = (time.monotonic() - _state.started_at) if _state.started_at else None
    return {
        "status": _state.status,
        "elapsed_sec": round(elapsed, 1) if elapsed is not None else None,
        "timeout_sec": launch_timeout(),
        "log_path": str(_state.log_path) if _state.log_path else None,
        "error": _state.error,
        "attempt": _state.attempt,
    }
