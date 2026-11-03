"""Which Emerald this server drives, and every value that follows from it.

The server drives one instance per checkout: the app checkout the session runs
in, built and started apart from the regular dev build so the two can run side by side.
It has its own debug port, Vite port, app identifier - and with it its own
app data, which starts out with a vault of test data (see seed/) - and Cargo
target dir.

Environment (all optional):
  EMERALD_APP_DIR              force the checkout (skips discovery); the caller
                               then arranges everything below itself
  EMERALD_CDP_HOST             default 127.0.0.1
  EMERALD_CDP_PORT             default 9223, in a linked worktree from 9300; on macOS and Linux the port of the
                               app's dev bridge, which stands in for a debug port
  EMERALD_MCP_VITE_PORT        default 1430, in a linked worktree from 1500
  EMERALD_MCP_IDENTIFIER       default com.emerald.mcp, in a linked worktree
                               com.emerald.mcp.w<key>
  EMERALD_MCP_HOME             state root (generated config, logs,
                               screenshots), default %LOCALAPPDATA%\\emerald-mcp
                               on Windows, ~/.local/share/emerald-mcp elsewhere
  CARGO_TARGET_DIR             build directory, default
                               %LOCALAPPDATA%\\emerald-mcp-target on Windows,
                               ~/.local/share/emerald-mcp-target elsewhere; in a
                               linked worktree emerald-mcp-worktree-<key> there

Every linked git worktree gets all of these from a key derived from its path
(see build_instance), so checkouts run side by side with nothing recorded.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import socket
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_CDP_PORT = 9223
DEFAULT_VITE_PORT = 1430
DEFAULT_IDENTIFIER = "com.emerald.mcp"
# A linked worktree gets a pair of ports from these ranges: same offset in both.
WORKTREE_CDP_BASE = 9300
WORKTREE_VITE_BASE = 1500
WORKTREE_PORTS = 1000
# Also the window title, and what the window handling matches on.
PRODUCT_NAME = "Emerald MCP"

REPO_ROOT = Path(__file__).resolve().parent          # <checkout>/tools/mcp
APP_ROOT = REPO_ROOT.parent.parent                   # <checkout>


@dataclass(frozen=True)
class Instance:
    checkout: Path
    checkout_source: str
    cdp_host: str
    cdp_port: int
    vite_port: int
    identifier: str
    product_name: str
    app_data_dir: Path
    target_dir: Path
    state_dir: Path
    config_path: Path
    log_dir: Path
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "checkout": str(self.checkout),
            "checkout_source": self.checkout_source,
            "cdp_host": self.cdp_host,
            "cdp_port": self.cdp_port,
            "vite_port": self.vite_port,
            "identifier": self.identifier,
            "product_name": self.product_name,
            "app_data_dir": str(self.app_data_dir),
            "target_dir": str(self.target_dir),
            "state_dir": str(self.state_dir),
            "config_path": str(self.config_path),
            "log_dir": str(self.log_dir),
            "warnings": list(self.warnings),
        }


# -- paths -------------------------------------------------------------------

def _local_data() -> Path:
    return Path(os.environ.get("LOCALAPPDATA") or str(Path.home() / ".local" / "share"))


def mcp_home() -> Path:
    override = os.environ.get("EMERALD_MCP_HOME")
    return Path(override) if override else _local_data() / "emerald-mcp"


def app_data_root() -> Path:
    """Where Tauri puts app_data_dir on this platform."""
    if sys.platform == "win32":
        return Path(os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming"))
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support"
    return Path(os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share"))


def target_dir() -> Path:
    """The Cargo build directory. Not the checkout's own src-tauri/target:
    Windows cannot relink an .exe the regular dev build is running, and a
    directory inside src-tauri would look like a source change to `tauri dev`."""
    override = os.environ.get("CARGO_TARGET_DIR")
    return Path(override) if override else _local_data() / "emerald-mcp-target"


# -- checkout discovery ------------------------------------------------------

# How many processes up to look for the client: launcher, client, one spare.
CLIENT_SEARCH_DEPTH = 3


def looks_like_emerald(p: Path) -> bool:
    """True if `p` is an Emerald app checkout - not tools/mcp itself, and not
    some other project that happens to have a package.json."""
    pkg = p / "package.json"
    if not pkg.is_file() or not (p / "src-tauri" / "tauri.conf.json").is_file():
        return False
    try:
        return json.loads(pkg.read_text(encoding="utf-8")).get("name") == "emerald"
    except (OSError, ValueError):
        return False


def _git_rev_parse(cwd: Path, *args: str) -> str | None:
    try:
        out = subprocess.run(
            ["git", "-C", str(cwd), "rev-parse", *args],
            capture_output=True, encoding="utf-8", errors="surrogateescape", timeout=5,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.SubprocessError):
        return None
    line = out.stdout.strip()
    return line if out.returncode == 0 and line and "\n" not in line else None


def _git_toplevel(cwd: Path) -> Path | None:
    """git rev-parse --show-toplevel. Inside a worktree this returns the
    worktree root, which is the checkout the session is working on."""
    line = _git_rev_parse(cwd, "--show-toplevel")
    return Path(line) if line else None


def _git_path(cwd: Path, flag: str) -> Path | None:
    """A directory git names, which it may do relative to `cwd`."""
    line = _git_rev_parse(cwd, flag)
    return (cwd / line).resolve() if line else None


def _is_linked_worktree(cwd: Path) -> bool:
    """A linked worktree is the one case where the two differ: not a submodule,
    a separate git dir, or a directory inside another repository."""
    git_dir, common = _git_path(cwd, "--git-dir"), _git_path(cwd, "--git-common-dir")
    return git_dir is not None and common is not None and git_dir != common


def resolve_checkout(cwd: Path | None = None) -> tuple[Path, str]:
    """Find the Emerald app checkout this session belongs to.

    First hit wins: explicit override, the worktree of the client that started
    this server, git toplevel (the worktree case), a filesystem walk upward,
    then the checkout this file lives in. A `cwd` passed in names the session's
    directory outright, so no client is looked for.
    """
    override = os.environ.get("EMERALD_APP_DIR")
    if override:
        p = Path(override)
        if not looks_like_emerald(p):
            raise RuntimeError(
                "EMERALD_APP_DIR=" + repr(override) + " is not an Emerald app checkout "
                "(needs package.json with name 'emerald' and src-tauri/tauri.conf.json)"
            )
        return p, "env"

    start = (cwd or Path.cwd()).absolute()

    if cwd is None:
        client = _client_worktree(start)
        if client is not None:
            return client, "client-cwd"

    top = _git_toplevel(start)
    if top is not None and looks_like_emerald(top):
        return top, "git-toplevel"

    probe = start
    for _ in range(8):
        if looks_like_emerald(probe):
            return probe, "fs-walk"
        if probe.parent == probe:
            break
        probe = probe.parent

    return APP_ROOT, "own-checkout"


def _lsof(*args: str) -> list[str] | None:
    """lsof's output, with the bytes it escapes outside a UTF-8 locale restored.
    None without lsof: a client's PATH may not reach /usr/sbin, and a minimal
    Linux does not have it."""
    exe = shutil.which("lsof") or ("/usr/sbin/lsof" if Path("/usr/sbin/lsof").exists() else None)
    if exe is None or sys.platform == "win32":
        return None
    try:
        out = subprocess.run([exe, "-nP", *args], capture_output=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return None
    raw = re.sub(rb"\\x([0-9a-f]{2})", lambda m: bytes([int(m.group(1), 16)]), out.stdout)
    return raw.decode("utf-8", "surrogateescape").splitlines()


def _process_cwd(pid: int) -> Path | None:
    """A process's working directory. None where that cannot be told, which
    includes Windows, where it is not readable."""
    if sys.platform.startswith("linux"):
        try:
            return Path(os.readlink(f"/proc/{pid}/cwd"))
        except OSError:
            return None
    lines = _lsof("-a", "-p", str(pid), "-d", "cwd", "-Fn") or []
    return next((Path(line[1:]) for line in lines if line.startswith("n")), None)


def _ps(pid: int, column: str) -> str:
    try:
        out = subprocess.run(["ps", "-o", column + "=", "-p", str(pid)], capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return ""
    return out.stdout.strip()


def _parent_pid(pid: int) -> int | None:
    parent = _ps(pid, "ppid")
    return int(parent) if parent.isdigit() else None


def _process_name(pid: int) -> str:
    return Path(_ps(pid, "comm")).name


def _is_launcher(name: str) -> bool:
    """What can stand between an MCP client and this server."""
    return name in ("uv", "uvx") or name.startswith("python")


def _client_worktree(start: Path) -> Path | None:
    """The worktree of the session this server serves, when it was started in
    the main checkout: an MCP client that found its config there can start the
    server there while the session itself works in a worktree. Only the client
    counts, the first process above any launcher: what started the client says
    nothing about its session. Another clone of the repository does not count."""
    if sys.platform == "win32" or _is_linked_worktree(start):
        return None
    common = _git_path(start, "--git-common-dir")
    pid: int | None = os.getppid()
    for _ in range(CLIENT_SEARCH_DEPTH):
        if common is None or pid is None or pid <= 1:
            return None
        if not _is_launcher(_process_name(pid)):
            cwd = _process_cwd(pid)
            if cwd is None or not _is_linked_worktree(cwd) or _git_path(cwd, "--git-common-dir") != common:
                return None
            top = _git_toplevel(cwd)
            return top if top is not None and looks_like_emerald(top) else None
        pid = _parent_pid(pid)
    return None


def _listeners() -> dict[int, int] | None:
    """Port to pid of every TCP listener this user can see, on either address
    family: Vite may listen on ::1 alone. None where that cannot be told."""
    lines = _lsof("-iTCP", "-sTCP:LISTEN", "-Fpn")
    if lines is None:
        return None
    found: dict[int, int] = {}
    pid = 0
    for line in lines:
        if line.startswith("p"):
            pid = int(line[1:])
        elif line.startswith("n") and line.rpartition(":")[2].isdigit():
            found[int(line.rpartition(":")[2])] = pid
    return found


def _checkout_of(pid: int | None) -> Path | None:
    """`tauri dev` runs the app inside the checkout's src-tauri, Vite in the
    checkout itself."""
    cwd = _process_cwd(pid) if pid else None
    return _git_toplevel(cwd) if cwd else None


def running_checkout(port: int) -> Path | None:
    """The checkout of whatever process listens on `port`."""
    return _checkout_of((_listeners() or {}).get(port))


# -- the instance ------------------------------------------------------------

def _worktree_key(checkout: Path) -> str | None:
    """A short name for a linked git worktree, derived from its path, so it
    stays the same across restarts without anything being recorded. None for
    anything else."""
    if not _is_linked_worktree(checkout):
        return None
    return hashlib.sha1(str(checkout.resolve()).encode()).hexdigest()[:8]


def _answers(port: int) -> bool:
    """Whether anything listens, which also finds what lsof cannot see: a
    process of another user."""
    for family, host in ((socket.AF_INET, "127.0.0.1"), (socket.AF_INET6, "::1")):
        try:
            with socket.socket(family) as s:
                s.settimeout(0.2)
                if s.connect_ex((host, port)) == 0:
                    return True
        except OSError:
            continue
    return False


def _worktree_offset(key: str, checkout: Path) -> int:
    """The worktree's place in the port ranges: where its instance runs now,
    else its own place or the next free one. Where the owner of a port cannot
    be told, its own place is taken as it is."""
    start = int(key, 16) % WORKTREE_PORTS
    listeners = _listeners()
    if listeners is None:
        return start
    own = checkout.resolve()
    for offset in range(WORKTREE_PORTS):
        for port in (WORKTREE_CDP_BASE + offset, WORKTREE_VITE_BASE + offset):
            running = _checkout_of(listeners.get(port))
            if running is not None and running.resolve() == own:
                return offset
    for step in range(WORKTREE_PORTS):
        offset = (start + step) % WORKTREE_PORTS
        ports = (WORKTREE_CDP_BASE + offset, WORKTREE_VITE_BASE + offset)
        if not any(p in listeners or _answers(p) for p in ports):
            return offset
    return start


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        raise RuntimeError(name + "=" + repr(raw) + " is not an integer")


def build_instance(cwd: Path | None = None) -> Instance:
    warnings: list[str] = []
    checkout, source = resolve_checkout(cwd)
    if not looks_like_emerald(checkout):
        warnings.append(str(checkout) + " does not look like an Emerald app checkout")

    # Every linked worktree is an instance of its own, so sessions in different
    # worktrees run side by side. EMERALD_APP_DIR means a caller that arranges
    # the instance itself; each setting below can still be forced one by one.
    key = None if source == "env" else _worktree_key(checkout)
    cdp_port, vite_port = DEFAULT_CDP_PORT, DEFAULT_VITE_PORT
    identifier, state_dir, build_dir = DEFAULT_IDENTIFIER, mcp_home(), target_dir()
    if key is not None:
        offset = _worktree_offset(key, checkout)
        cdp_port, vite_port = WORKTREE_CDP_BASE + offset, WORKTREE_VITE_BASE + offset
        identifier = f"{DEFAULT_IDENTIFIER}.w{key}"
        state_dir = mcp_home() / "worktrees" / key
        # Not "emerald-mcp-target-<key>": on Windows, windows and dialogs are
        # told apart by whether their exe's path starts with the build directory.
        if os.environ.get("CARGO_TARGET_DIR"):
            warnings.append("CARGO_TARGET_DIR is set, so this worktree shares its build directory with other checkouts")
        else:
            build_dir = _local_data() / f"emerald-mcp-worktree-{key}"

    identifier = os.environ.get("EMERALD_MCP_IDENTIFIER", identifier)
    app_data_dir = app_data_root() / identifier
    return Instance(
        checkout=checkout,
        checkout_source=source,
        cdp_host=os.environ.get("EMERALD_CDP_HOST", "127.0.0.1"),
        cdp_port=_int_env("EMERALD_CDP_PORT", cdp_port),
        vite_port=_int_env("EMERALD_MCP_VITE_PORT", vite_port),
        identifier=identifier,
        product_name=PRODUCT_NAME,
        app_data_dir=app_data_dir,
        target_dir=build_dir,
        state_dir=state_dir,
        config_path=state_dir / "tauri.mcp.generated.conf.json",
        log_dir=state_dir / "logs",
        warnings=warnings,
    )


_cached: Instance | None = None


def resolve_instance(cwd: Path | None = None) -> Instance:
    """Cached per process - the checkout cannot change under a running server."""
    global _cached
    if _cached is None:
        _cached = build_instance(cwd)
    return _cached


def browser_args(inst: Instance) -> str:
    """WebView2 command line for this instance.

    Two non-obvious pieces:
      - CalculateNativeWinOcclusion must be off, or Windows classifies the
        off-screen window as occluded, the compositor stops producing frames,
        and Page.captureScreenshot hands back a stale one.
      - wry itself passes --disable-features=msWebOOUI,msPdfOOUI,
        msSmartScreenProtection. Chromium keeps the last --disable-features
        rather than merging them, so ours has to repeat those three or they
        are silently lost.
    """
    return " ".join([
        # No --remote-allow-origins: the MCP server connects without an Origin
        # header, which Chromium lets through, and a web page - which always
        # sends one - stays out.
        "--remote-debugging-port=" + str(inst.cdp_port),
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-background-timer-throttling",
        "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion",
    ])


if __name__ == "__main__":
    print(json.dumps(resolve_instance().to_dict(), indent=2))
