"""Which Emerald this server drives, and every value that follows from it.

The server drives one instance: the app checkout the session runs in, built
and started apart from the regular dev build so the two can run side by side.
It has its own debug port, Vite port, app identifier - and with it its own
app data, which starts out with a vault of test data (see seed/) - and Cargo
target dir.

Environment (all optional):
  EMERALD_APP_DIR              force the checkout (skips discovery)
  EMERALD_CDP_HOST             default 127.0.0.1
  EMERALD_CDP_PORT             default 9223
  EMERALD_MCP_VITE_PORT        default 1430
  EMERALD_MCP_IDENTIFIER       default com.emerald.magical-journal.mcp
  EMERALD_MCP_HOME             state root (generated config, logs,
                               screenshots), default %LOCALAPPDATA%\\emerald-mcp
  CARGO_TARGET_DIR             build directory, default
                               %LOCALAPPDATA%\\emerald-mcp-target

Two checkouts driven at the same time need different ports, identifiers and
target dirs; nothing here hands them out.
"""

from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_CDP_PORT = 9223
DEFAULT_VITE_PORT = 1430
DEFAULT_IDENTIFIER = "com.emerald.magical-journal.mcp"
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
    """Where Tauri puts app_data_dir on this platform (Windows: %APPDATA%)."""
    roaming = os.environ.get("APPDATA")
    return Path(roaming) if roaming else Path.home() / ".local" / "share"


def target_dir() -> Path:
    """The Cargo build directory. Not the checkout's own src-tauri/target:
    Windows cannot relink an .exe the regular dev build is running, and a
    directory inside src-tauri would look like a source change to `tauri dev`."""
    override = os.environ.get("CARGO_TARGET_DIR")
    return Path(override) if override else _local_data() / "emerald-mcp-target"


# -- checkout discovery ------------------------------------------------------

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

    First hit wins: explicit override, git toplevel (the worktree case), a
    filesystem walk upward, then the checkout this file lives in.
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
        "--remote-debugging-port=" + str(inst.cdp_port),
        "--remote-allow-origins=*",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-background-timer-throttling",
        "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion",
    ])


if __name__ == "__main__":
    print(json.dumps(resolve_instance().to_dict(), indent=2))
