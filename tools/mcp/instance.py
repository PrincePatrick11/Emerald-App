"""Which Emerald this server drives, and every value that follows from it.

The server drives one instance: the app checkout the session runs in, built
and started apart from the regular dev build so the two can run side by side.
It has its own debug port, Vite port, app identifier - and with it its own
app data, which starts out with a vault of test data (see seed/) - and Cargo
target dir.

Environment (all optional):
  EMERALD_APP_DIR              force the checkout (skips discovery)
  EMERALD_CDP_HOST             default 127.0.0.1
  EMERALD_CDP_PORT             default 9223; on macOS and Linux the port of the
                               app's dev bridge, which stands in for a debug port
  EMERALD_MCP_VITE_PORT        default 1430
  EMERALD_MCP_IDENTIFIER       default com.emerald.mcp
  EMERALD_MCP_HOME             state root (generated config, logs,
                               screenshots), default %LOCALAPPDATA%\\emerald-mcp
                               on Windows, ~/.local/share/emerald-mcp elsewhere
  CARGO_TARGET_DIR             build directory, default
                               %LOCALAPPDATA%\\emerald-mcp-target on Windows,
                               ~/.local/share/emerald-mcp-target elsewhere

Two checkouts driven at the same time need different ports, identifiers and
target dirs; nothing here hands them out.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_CDP_PORT = 9223
DEFAULT_VITE_PORT = 1430
DEFAULT_IDENTIFIER = "com.emerald.mcp"
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
    seed_vault_dir: Path
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
            "seed_vault_dir": str(self.seed_vault_dir),
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


def _git_toplevel(cwd: Path) -> Path | None:
    """git rev-parse --show-toplevel. Inside a worktree this returns the
    worktree root, which is the checkout the session is working on."""
    try:
        out = subprocess.run(
            ["git", "-C", str(cwd), "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, timeout=5,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0:
        return None
    line = out.stdout.strip()
    return Path(line) if line else None


def resolve_checkout(cwd: Path | None = None) -> tuple[Path, str]:
    """Find the Emerald app checkout this session belongs to.

    First hit wins: explicit override, the worktree of the client that started
    this server, git toplevel (the worktree case), a filesystem walk upward,
    then the checkout this file lives in.
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


def _lsof(*args: str) -> list[str]:
    out = subprocess.run(["lsof", "-nP", *args], capture_output=True, text=True, timeout=5)
    return out.stdout.splitlines()


def _process_cwd(pid: int) -> Path | None:
    """A process's working directory. None where that cannot be told, which
    includes Windows, where it is not readable."""
    if sys.platform == "win32":
        return None
    try:
        lines = _lsof("-a", "-p", str(pid), "-d", "cwd", "-Fn")
    except (OSError, subprocess.SubprocessError):
        return None
    return next((Path(line[1:]) for line in lines if line.startswith("n")), None)


def _parent_pid(pid: int) -> int | None:
    try:
        out = subprocess.run(["ps", "-o", "ppid=", "-p", str(pid)], capture_output=True, text=True, timeout=5)
        return int(out.stdout.strip())
    except (OSError, subprocess.SubprocessError, ValueError):
        return None


def _git_common_dir(cwd: Path) -> Path | None:
    try:
        out = subprocess.run(
            ["git", "-C", str(cwd), "rev-parse", "--path-format=absolute", "--git-common-dir"],
            capture_output=True, text=True, timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    line = out.stdout.strip()
    return Path(line) if out.returncode == 0 and line else None


def _client_worktree(start: Path) -> Path | None:
    """The worktree of the session this server serves, when it was started
    elsewhere: an MCP client that found its config in the main checkout can
    start the server there while the session itself works in a worktree. The
    next few processes up are this server's launcher and that client. Another
    clone of the repository does not count."""
    if sys.platform == "win32":
        return None
    own = _git_toplevel(start)
    common = _git_common_dir(start)
    if own is None or common is None:
        return None
    pid = os.getppid()
    for _ in range(CLIENT_SEARCH_DEPTH):
        if pid is None or pid <= 1:
            return None
        cwd = _process_cwd(pid)
        top = _git_toplevel(cwd) if cwd else None
        if top is not None and top != own and looks_like_emerald(top) and _git_common_dir(cwd) == common:
            return top
        pid = _parent_pid(pid)
    return None


def running_checkout(port: int) -> Path | None:
    """The checkout of whatever process listens on `port`: `tauri dev` runs the
    app inside the checkout's src-tauri."""
    if sys.platform == "win32":
        return None
    try:
        pids = _lsof("-t", f"-iTCP:{port}", "-sTCP:LISTEN")
    except (OSError, subprocess.SubprocessError):
        return None
    cwd = _process_cwd(int(pids[0])) if pids else None
    return _git_toplevel(cwd) if cwd else None


# -- the instance ------------------------------------------------------------

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

    state_dir = mcp_home()
    identifier = os.environ.get("EMERALD_MCP_IDENTIFIER", DEFAULT_IDENTIFIER)
    app_data_dir = app_data_root() / identifier
    return Instance(
        checkout=checkout,
        checkout_source=source,
        cdp_host=os.environ.get("EMERALD_CDP_HOST", "127.0.0.1"),
        cdp_port=_int_env("EMERALD_CDP_PORT", DEFAULT_CDP_PORT),
        vite_port=_int_env("EMERALD_MCP_VITE_PORT", DEFAULT_VITE_PORT),
        identifier=identifier,
        product_name=PRODUCT_NAME,
        app_data_dir=app_data_dir,
        seed_vault_dir=app_data_dir / "vaults" / "seed",
        target_dir=target_dir(),
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
