"""Per-checkout instance resolution for the Emerald DevTools MCP.

One Claude Code session drives one Emerald app. Which one is decided here and
nowhere else: every port, path and identifier the rest of the server uses is
derived from a single small integer, the *slot*, which is in turn derived from
the git checkout the session runs in. A worktree therefore gets its own CDP
port, its own Vite port, its own Tauri identifier (and with it its own
app-data dir, vaults.json and database) and its own Cargo target dir, so two
worktrees can be driven in parallel without colliding on any of them.

Slot 0 is reserved for the main Emerald-App checkout and keeps the values the
MCP environment used before slots existed, so an existing setup is unaffected.

Environment overrides:
  EMERALD_APP_DIR              force the checkout (skips discovery)
  EMERALD_MCP_HOME             state root, default %LOCALAPPDATA%\\emerald-mcp
  EMERALD_MCP_SLOT             force the slot (skips the registry)
  EMERALD_MCP_MAX_SLOTS        default 4 - size of the worktree slot pool
  EMERALD_MCP_IDLE_HOURS       default 2 - unused this long, an instance is
                               stopped and its slot may be taken over
  EMERALD_MCP_TARGET_TTL_DAYS  default 14 - unused this long, the build dir goes
  EMERALD_MCP_IDENTIFIER_BASE  default com.emerald.magical-journal.mcp
  EMERALD_CDP_HOST             default 127.0.0.1
  EMERALD_CDP_PORT             override the slot-derived CDP port
"""

from __future__ import annotations

import contextlib
import functools
import json
import logging
import os
import re
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

# Slot 0 reproduces the pre-slot MCP environment exactly.
BASE_CDP_PORT = 9223
BASE_VITE_PORT = 1430
DEFAULT_IDENTIFIER_BASE = "com.emerald.magical-journal.mcp"
DEFAULT_MAX_SLOTS = 4          # each slot costs a Cargo build dir (~8 GB)
DEFAULT_IDLE_HOURS = 2.0       # unused this long -> stopped, slot reusable
REGISTRY_VERSION = 1

REPO_ROOT = Path(__file__).resolve().parent          # <checkout>/tools/mcp
APP_ROOT = REPO_ROOT.parent.parent                   # <checkout>

log = logging.getLogger("emerald-instance")

_LOCK_TIMEOUT = 10.0
_LOCK_STALE_AFTER = 60.0
_LAST_SEEN_REFRESH = 60.0
_VAULT_REMOVE_WAIT = 5.0


@dataclass(frozen=True)
class Instance:
    slot: int
    checkout: Path
    checkout_source: str
    name: str
    is_main: bool
    cdp_host: str
    cdp_port: int
    vite_port: int
    identifier: str
    product_name: str
    app_data_dir: Path
    seed_vault_dir: Path
    target_dir: Path
    seed_from: Path | None
    state_dir: Path
    config_path: Path
    log_dir: Path
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "slot": self.slot,
            "checkout": str(self.checkout),
            "checkout_source": self.checkout_source,
            "name": self.name,
            "is_main": self.is_main,
            "cdp_host": self.cdp_host,
            "cdp_port": self.cdp_port,
            "vite_port": self.vite_port,
            "identifier": self.identifier,
            "product_name": self.product_name,
            "app_data_dir": str(self.app_data_dir),
            "seed_vault_dir": str(self.seed_vault_dir),
            "target_dir": str(self.target_dir),
            "seed_from": str(self.seed_from) if self.seed_from else None,
            "state_dir": str(self.state_dir),
            "config_path": str(self.config_path),
            "log_dir": str(self.log_dir),
            "warnings": list(self.warnings),
        }


# -- paths -------------------------------------------------------------------

def home_is_explicit() -> bool:
    """Whether the state root was chosen deliberately.

    It decides where slot 0's build directory goes: on a default install it
    stays at the pre-slot path so an existing warm build is not orphaned, but
    someone who points EMERALD_MCP_HOME at another drive means all of it,
    including slot 0 - otherwise several GB stay behind on the drive they were
    trying to empty.
    """
    return bool(os.environ.get("EMERALD_MCP_HOME"))


def mcp_home() -> Path:
    override = os.environ.get("EMERALD_MCP_HOME")
    if override:
        return Path(override)
    local = os.environ.get("LOCALAPPDATA") or str(Path.home() / ".local" / "share")
    return Path(local) / "emerald-mcp"


def registry_path() -> Path:
    return mcp_home() / "registry.json"


@functools.lru_cache(maxsize=1)
def main_checkout() -> Path:
    """The default app checkout: the main worktree of the repository this file
    lives in. Every worktree carries its own tools/mcp, so the checkout around
    this file alone would make each worktree its own slot 0."""
    return _git_main_worktree(APP_ROOT) or APP_ROOT


def legacy_target_dir() -> Path:
    """Where slot 0 built before slots existed. Still the default, so a plain
    install keeps its warm build instead of rebuilding once for nothing."""
    local = os.environ.get("LOCALAPPDATA") or str(Path.home() / ".local" / "share")
    return Path(local) / "emerald-mcp-target"


def target_dir_for(slot: int) -> Path:
    """This slot's Cargo build directory. One per slot: Windows cannot relink
    an .exe another instance is running."""
    if slot == 0 and not home_is_explicit():
        return legacy_target_dir()
    return mcp_home() / "targets" / str(slot)


def state_dir_for(slot: int) -> Path:
    return mcp_home() / "slots" / str(slot)


def product_name_for(slot: int, name: str) -> str:
    """The app's product name for a slot - which is also its window title, and
    what the window handling matches on."""
    return "Emerald MCP" if slot == 0 else "Emerald MCP " + name


def _visibility_flag(slot: int) -> Path:
    return state_dir_for(slot) / "window-visible"


def wants_visible(slot: int) -> bool:
    """Whether someone asked to see this slot's window.

    A file rather than a setting in the running process, because the request
    comes from the tray app and has to be honoured by MCP servers in other
    processes - each of which re-places the window on every attach and every
    `status` call, and would otherwise push it straight back out.
    """
    return _visibility_flag(slot).exists()


def set_wants_visible(slot: int, visible: bool) -> None:
    flag = _visibility_flag(slot)
    if visible:
        flag.parent.mkdir(parents=True, exist_ok=True)
        flag.write_text(_now() + "\n", encoding="utf-8")
    else:
        with contextlib.suppress(FileNotFoundError):
            flag.unlink()


def app_data_root() -> Path:
    """Where Tauri puts app_data_dir on this platform (Windows: %APPDATA%)."""
    roaming = os.environ.get("APPDATA")
    if roaming:
        return Path(roaming)
    return Path.home() / ".local" / "share"


def normalise(p: Path) -> str:
    """Comparable form of a path: resolved, forward slashes, lowercased.

    Case folding is right on Windows and wrong on a case-sensitive filesystem,
    but this module only ever compares paths that came from the same machine,
    and a duplicate registry entry is a far cheaper failure than two checkouts
    silently sharing one slot and therefore one database.
    """
    try:
        resolved = p.resolve()
    except OSError:
        resolved = p.absolute()
    text = str(resolved).replace("\\\\?\\", "").replace("\\", "/")
    return text.rstrip("/").lower()


# -- checkout discovery ------------------------------------------------------

def looks_like_emerald(p: Path) -> bool:
    """True if `p` is an Emerald app checkout - not tools/mcp itself, and not
    an unrelated project that happens to carry a package.json."""
    pkg = p / "package.json"
    if not pkg.is_file() or not (p / "src-tauri" / "tauri.conf.json").is_file():
        return False
    try:
        return json.loads(pkg.read_text(encoding="utf-8")).get("name") == "emerald"
    except (OSError, ValueError):
        return False


def _git_toplevel(cwd: Path) -> Path | None:
    """git rev-parse --show-toplevel. Inside a worktree this returns the
    worktree root, which is exactly the discrimination we want."""
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


def _git_main_worktree(cwd: Path) -> Path | None:
    """The directory holding the repository's shared .git, which
    --git-common-dir names from any of its worktrees."""
    try:
        out = subprocess.run(
            ["git", "-C", str(cwd), "rev-parse", "--path-format=absolute", "--git-common-dir"],
            capture_output=True, text=True, timeout=5,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0:
        return None
    common = Path(out.stdout.strip())
    return common.parent if common.name == ".git" else None


def resolve_checkout(cwd: Path | None = None) -> tuple[Path, str]:
    """Find the Emerald app checkout this session belongs to.

    First hit wins: explicit override, git toplevel (the worktree case), a
    filesystem walk upward, then the main checkout as fallback.
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

    return main_checkout(), "main-fallback"


def is_main_checkout(p: Path) -> bool:
    return normalise(p) == normalise(main_checkout())


def checkout_name(p: Path, is_main: bool) -> str:
    if is_main:
        return "main"
    raw = p.name or "worktree"
    # Tauri identifiers accept only [A-Za-z0-9-.]; the same slug doubles as the
    # window title, so keep it readable rather than hashing it.
    slug = re.sub(r"[^A-Za-z0-9-]+", "-", raw).strip("-")
    return slug or "worktree"


# -- slot registry -----------------------------------------------------------

@contextlib.contextmanager
def _registry_lock(timeout: float = _LOCK_TIMEOUT):
    """Cross-process lock around the read-modify-write of registry.json.

    O_CREAT|O_EXCL is the portable "create only if absent" primitive. A holder
    that crashed would otherwise wedge every future session, so a lock file
    older than _LOCK_STALE_AFTER is treated as abandoned.
    """
    lock = mcp_home() / "registry.lock"
    lock.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + timeout
    fd = None
    while True:
        try:
            fd = os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            break
        except FileExistsError:
            try:
                age = time.time() - lock.stat().st_mtime
            except OSError:
                age = 0.0
            if age > _LOCK_STALE_AFTER:
                with contextlib.suppress(OSError):
                    lock.unlink()
                continue
            if time.monotonic() > deadline:
                raise RuntimeError("timed out waiting for " + str(lock))
            time.sleep(0.025)
    try:
        os.write(fd, str(os.getpid()).encode("ascii"))
        yield
    finally:
        with contextlib.suppress(OSError):
            os.close(fd)
        with contextlib.suppress(OSError):
            lock.unlink()


def _empty_registry() -> dict:
    return {"version": REGISTRY_VERSION, "slots": {}}


def load_registry() -> dict:
    try:
        data = json.loads(registry_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return _empty_registry()
    if not isinstance(data, dict) or not isinstance(data.get("slots"), dict):
        return _empty_registry()
    data.setdefault("version", REGISTRY_VERSION)
    return data


def _save_registry(data: dict) -> None:
    path = registry_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp." + str(os.getpid()))
    tmp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def _age_seconds(iso: str) -> float:
    try:
        when = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return float("inf")
    return (datetime.now(timezone.utc) - when).total_seconds()


def reclaim_stale(reg: dict) -> list[int]:
    """Free slots whose checkout directory is gone. Returns the freed slots.

    Reclamation triggers on "the directory no longer exists" only, never on
    "not seen recently": a checkout that idled for a week and then came back on
    a different slot would silently get a different identifier, and with it a
    different database.
    """
    freed: list[int] = []
    for key in list(reg["slots"].keys()):
        if key == "0":
            continue
        path = reg["slots"][key].get("checkout")
        if not path or not Path(path).is_dir():
            del reg["slots"][key]
            with contextlib.suppress(ValueError):
                freed.append(int(key))
    return freed


def max_slots() -> int:
    try:
        return max(1, int(os.environ.get("EMERALD_MCP_MAX_SLOTS", DEFAULT_MAX_SLOTS)))
    except ValueError:
        return DEFAULT_MAX_SLOTS


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def config_path() -> Path:
    return mcp_home() / "config.json"


def load_config() -> dict:
    """Settings shared by every MCP server and the tray app. A file rather
    than only an environment variable, because a setting changed in the tray
    has to reach servers that were started before it."""
    try:
        data = json.loads(config_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def save_config(values: dict) -> None:
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    merged = load_config()
    merged.update(values)
    tmp = path.with_name(path.name + ".tmp." + str(os.getpid()))
    tmp.write_text(json.dumps(merged, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def idle_hours() -> float:
    """Hours a slot may go unused. The environment wins, so a one-off run can
    still override what the tray app has stored; 0 disables reclaiming."""
    raw = os.environ.get("EMERALD_MCP_IDLE_HOURS")
    if raw is None:
        raw = load_config().get("idle_hours", DEFAULT_IDLE_HOURS)
    try:
        return max(0.0, float(raw))
    except (TypeError, ValueError):
        return DEFAULT_IDLE_HOURS


def idle_timeout_seconds() -> float:
    """How long a slot may go unused before its app is stopped and the slot
    becomes available to another worktree. 0 disables reclaiming."""
    return idle_hours() * 3600.0


def _idle_seconds(entry: dict) -> float:
    return _age_seconds(entry.get("last_used_at") or entry.get("last_seen_at", ""))


def identifier_for(slot: int) -> str:
    """The Tauri app identifier for a slot, which is what decides its
    app-data directory and therefore which database it opens."""
    base = identifier_base()
    return base if slot == 0 else base + "." + str(slot)


def reset_vault(slot: int, allow_main: bool = False) -> dict:
    """Throw a slot's database away so the next start seeds a fresh one.

    The app has to be stopped for it: sqlx keeps emerald.db open for its whole
    lifetime and Windows will not let the file go while it is. So this stops
    the instance, removes the app-data directory, and leaves the next tool call
    to relaunch and re-provision.

    Slot 0 needs `allow_main` on purpose. Worktree vaults are generated
    fixtures, but slot 0's is the long-lived one people accumulate real test
    data in, and losing that to a mistyped slot number would be miserable.
    """
    if slot == 0 and not allow_main:
        raise ValueError(
            "slot 0 holds the main checkout's long-lived database, not generated fixtures. "
            "Pass allow_main to wipe it anyway."
        )
    stopped = stop_slot(slot)
    app_data = app_data_root() / identifier_for(slot)
    existed = app_data.exists()
    # The app was only just told to stop, and Windows keeps emerald.db locked
    # until the process is really gone - so try for a moment before reporting
    # that the old data is still there.
    deadline = time.monotonic() + _VAULT_REMOVE_WAIT
    while app_data.exists():
        shutil.rmtree(app_data, ignore_errors=True)
        if not app_data.exists() or time.monotonic() >= deadline:
            break
        time.sleep(0.25)
    removed = existed and not app_data.exists()
    log.info("reset vault for slot %s (stopped=%s, existed=%s, removed=%s)", slot, stopped, existed, removed)
    result = {
        "slot": slot,
        "identifier": identifier_for(slot),
        "instance_stopped": stopped,
        "vault_removed": removed,
        "app_data_dir": str(app_data),
    }
    if existed and not removed:
        result["error"] = (
            "could not remove " + str(app_data) + " - something still has it open, "
            "so the next start would come up on the old data"
        )
    return result


def _wipe_slot_data(slot: int) -> bool:
    """Delete a slot's app data, and with it its vault.

    Called whenever a slot is handed to a checkout, not only when one is taken
    over: a slot can be free in the registry and still have a vault on disk -
    after the registry was reset, say, or after an orphan was reclaimed - and
    the next occupant would otherwise open another branch's test data without
    anything looking wrong. The vault is generated fixtures, so the cost is a
    few seconds of re-seeding.
    """
    if slot == 0:
        # Slot 0 is the long-lived instance and may hold work someone cares
        # about. Nothing should ever wipe it, so refuse rather than trust the
        # caller not to ask.
        raise ValueError("refusing to wipe slot 0's data")
    app_data = app_data_root() / identifier_for(slot)
    if not app_data.exists():
        return False
    shutil.rmtree(app_data, ignore_errors=True)
    log.info("wiped slot %s data at %s", slot, app_data)
    return True


def _release(slot: int, entry: dict) -> None:
    """Stop whatever is running in a slot so it can be handed on. The data is
    cleared separately, at assignment, so both paths into a slot get it."""
    import procs

    pid = entry.get("launcher_pid")
    if not (procs.stop_tree(int(pid)) if pid else False):
        procs.stop_by_target_dir(target_dir_for(slot))


def slot_for(checkout: Path, name: str) -> int:
    """The slot this checkout drives, claiming one if it has none.

    There is a fixed pool (EMERALD_MCP_MAX_SLOTS, default 4) rather than one
    slot per worktree ever seen, because each slot costs a Cargo build
    directory of several GB. A slot whose worktree is gone, or which has not
    been used for EMERALD_MCP_IDLE_HOURS, is taken over: its app is stopped and
    its vault wiped. Its build directory is deliberately kept - the new
    occupant reuses it, and Cargo only recompiles what actually differs.

    Slot 0 belongs to the main checkout and is never handed to anything else.
    """
    if is_main_checkout(checkout):
        return 0

    key_path = normalise(checkout)
    with _registry_lock():
        reg = load_registry()
        dirty = bool(reclaim_stale(reg))

        for key, entry in reg["slots"].items():
            if normalise(Path(entry.get("checkout", ""))) == key_path:
                if _age_seconds(entry.get("last_used_at", "")) > _LAST_SEEN_REFRESH:
                    entry["last_used_at"] = _now()
                    dirty = True
                if dirty:
                    _save_registry(reg)
                return int(key)

        limit = max_slots()
        taken = {int(k) for k in reg["slots"] if k.isdigit()}
        slot = next((n for n in range(1, limit + 1) if n not in taken), None)

        if slot is None:
            slot = _take_over_idle(reg, limit)

        # Every route into a slot lands here, so this is the one place that has
        # to guarantee the newcomer does not inherit someone else's vault.
        _wipe_slot_data(slot)
        # Whoever wanted to watch the previous occupant did not ask to watch
        # this one.
        set_wants_visible(slot, False)

        reg["slots"][str(slot)] = {
            "checkout": str(checkout).replace("\\", "/"),
            "name": name,
            "created_at": _now(),
            "last_used_at": _now(),
        }
        _save_registry(reg)
        return slot


def _take_over_idle(reg: dict, limit: int) -> int:
    """Pick the idlest slot past the timeout, free it, and return its number.

    Raises rather than evicting an active instance: taking a slot from a
    session someone is working in would be a far worse failure than a clear
    message saying which four are held.
    """
    timeout = idle_timeout_seconds()
    candidates = []
    for key, entry in reg["slots"].items():
        if not key.isdigit() or int(key) == 0:
            continue
        idle = _idle_seconds(entry)
        if timeout > 0 and idle >= timeout:
            candidates.append((idle, int(key), entry))

    if not candidates:
        held = "; ".join(
            "slot {} = {} (idle {:.1f}h)".format(k, e.get("name") or e.get("checkout"), _idle_seconds(e) / 3600.0)
            for k, e in sorted(reg["slots"].items(), key=lambda kv: int(kv[0]))
            if k.isdigit() and int(k) != 0
        )
        raise RuntimeError(
            "all {} worktree slots are in use and none has been idle for {:.1f}h. "
            "Held: {}. Close one of those sessions, wait for it to go idle, or raise "
            "EMERALD_MCP_MAX_SLOTS (each slot costs a Cargo build directory of several GB)."
            .format(limit, timeout / 3600.0, held or "(none)")
        )

    idle, slot, entry = max(candidates)
    log.info("taking over slot %s from %s (idle %.1fh)", slot, entry.get("name"), idle / 3600.0)
    _release(slot, entry)
    del reg["slots"][str(slot)]
    return slot


def touch(slot: int) -> None:
    """Mark a slot as in use. Called on tool activity so the idle timer
    measures actual use rather than how long the session has been open."""
    if slot == 0:
        return
    try:
        with _registry_lock(timeout=2.0):
            reg = load_registry()
            entry = reg["slots"].get(str(slot))
            if entry is None:
                return
            if _age_seconds(entry.get("last_used_at", "")) <= _LAST_SEEN_REFRESH:
                return
            entry["last_used_at"] = _now()
            _save_registry(reg)
    except Exception:  # bookkeeping must never break a tool call
        log.debug("could not refresh slot %s", slot, exc_info=True)


def record_launcher(slot: int, pid: int) -> None:
    """Remember which process tree to end when this slot is reclaimed."""
    try:
        with _registry_lock(timeout=2.0):
            reg = load_registry()
            entry = reg["slots"].get(str(slot))
            if entry is None:
                if slot != 0:
                    return
                # Slot 0 never goes through slot_for, so it has no entry until
                # something launches it. Without one its launcher could not be
                # found again, and stopping it would leave Vite running.
                entry = reg["slots"]["0"] = {
                    "checkout": main_checkout().as_posix(),
                    "name": "main",
                    "created_at": _now(),
                }
            entry["launcher_pid"] = int(pid)
            entry["last_used_at"] = _now()
            _save_registry(reg)
    except Exception:
        log.debug("could not record launcher pid for slot %s", slot, exc_info=True)


def running_launcher(slot: int) -> int | None:
    """The pid of this slot's launcher while it is still running - which
    includes the minutes of a build before the app's port opens. Lets anyone
    about to start a slot see that someone else already is."""
    import procs

    pid = load_registry()["slots"].get(str(slot), {}).get("launcher_pid")
    return int(pid) if pid and procs.pid_alive(int(pid)) else None


def list_checkouts() -> list[dict]:
    """Every checkout of the app that could be started: the main one and its
    git worktrees, each with its branch and the slot it already holds, if any.

    The branch is reported because it is what a worktree is known by: Claude
    reuses worktree folders, so a folder called mcp-worktree-session-2ed768
    can hold a branch named after something else entirely.
    """
    main = main_checkout()
    paths = [main]
    branches: dict[str, str | None] = {}
    try:
        out = subprocess.run(
            ["git", "-C", str(main), "worktree", "list", "--porcelain"],
            capture_output=True, text=True, timeout=10,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        current: Path | None = None
        for line in out.stdout.splitlines():
            if line.startswith("worktree "):
                current = Path(line[len("worktree "):].strip())
                branches[normalise(current)] = None
                if normalise(current) != normalise(main) and looks_like_emerald(current):
                    paths.append(current)
            elif line.startswith("branch ") and current is not None:
                branches[normalise(current)] = line[len("branch "):].strip().removeprefix("refs/heads/")
    except (OSError, subprocess.SubprocessError):
        pass  # the main checkout alone is still worth offering

    held = {
        normalise(Path(e.get("checkout", ""))): int(k)
        for k, e in load_registry()["slots"].items()
        if k.isdigit()
    }
    result = []
    for p in paths:
        is_main = normalise(p) == normalise(main)
        result.append({
            "checkout": str(p),
            "name": checkout_name(p, is_main),
            "is_main": is_main,
            "branch": branches.get(normalise(p)),
            "slot": 0 if is_main else held.get(normalise(p)),
        })
    return result


def release_slot(slot: int) -> dict:
    """Take a stopped slot away from its worktree, so the next checkout that
    asks gets it - the tray app's button, for a worktree you are done with
    but have not deleted.

    The vault goes with it (it is fixtures, and would otherwise be what the
    next occupant opens); the build directory stays, since the next occupant
    reuses it. A running slot is refused rather than stopped: stopping is a
    separate, deliberate step, and a slot in use is exactly what should not
    be handed on by accident. A session still open in that worktree notices
    on its next tool call and claims a slot afresh (see still_owns).
    """
    if slot == 0:
        raise ValueError("slot 0 belongs to the main checkout and cannot be released")
    with _registry_lock():
        reg = load_registry()
        entry = reg["slots"].get(str(slot))
        if entry is None:
            return {"slot": slot, "released": False, "reason": "not assigned"}
        if _port_in_use(BASE_CDP_PORT + slot) or running_launcher(slot):
            return {"slot": slot, "released": False, "reason": "running", "name": entry.get("name")}
        del reg["slots"][str(slot)]
        _save_registry(reg)
    _wipe_slot_data(slot)
    set_wants_visible(slot, False)
    log.info("released slot %s from %s", slot, entry.get("name"))
    return {"slot": slot, "released": True, "name": entry.get("name")}


def still_owns(inst: "Instance") -> bool:
    """Whether the registry still gives this instance's slot to its checkout.

    A server resolves its slot once, at start. If the slot is released in
    the meantime and another worktree picks it up, carrying on would mean
    two checkouts on one port and one database - so the server checks this
    on every tool call and claims a new slot when it fails.
    """
    if inst.slot == 0 or os.environ.get("EMERALD_MCP_SLOT"):
        return True
    entry = load_registry()["slots"].get(str(inst.slot))
    return bool(entry) and normalise(Path(entry.get("checkout", ""))) == normalise(inst.checkout)


def reap_idle() -> dict:
    """Stop instances nobody has used for a while, freeing their RAM and
    frontend ports. The slot keeps its build directory and its registry entry,
    so its own worktree comes straight back to it if it returns first."""
    timeout = idle_timeout_seconds()
    if timeout <= 0:
        return {"stopped": [], "idle_hours": 0}

    stopped = []
    with _registry_lock():
        reg = load_registry()
        for key, entry in sorted(reg["slots"].items(), key=lambda kv: int(kv[0])):
            slot = int(key)
            if slot == 0:
                continue
            idle = _idle_seconds(entry)
            if idle < timeout or not _port_in_use(BASE_CDP_PORT + slot):
                continue
            import procs
            pid = entry.get("launcher_pid")
            ok = procs.stop_tree(int(pid)) if pid else False
            if not ok:
                ok = bool(procs.stop_by_target_dir(target_dir_for(slot)))
            entry.pop("launcher_pid", None)
            stopped.append({
                "slot": slot,
                "name": entry.get("name"),
                "idle_hours": round(idle / 3600.0, 1),
                "stopped": ok,
            })
        if stopped:
            _save_registry(reg)
    return {"stopped": stopped, "idle_hours": round(timeout / 3600.0, 1)}


# -- the instance ------------------------------------------------------------

def identifier_base() -> str:
    return os.environ.get("EMERALD_MCP_IDENTIFIER_BASE", DEFAULT_IDENTIFIER_BASE)


def build_instance(cwd: Path | None = None) -> Instance:
    warnings: list[str] = []
    checkout, source = resolve_checkout(cwd)
    is_main = is_main_checkout(checkout)
    name = checkout_name(checkout, is_main)

    forced = os.environ.get("EMERALD_MCP_SLOT")
    if forced:
        try:
            slot = int(forced)
        except ValueError:
            raise RuntimeError("EMERALD_MCP_SLOT=" + repr(forced) + " is not an integer")
        warnings.append("slot forced to " + str(slot) + " via EMERALD_MCP_SLOT")
    else:
        slot = slot_for(checkout, name)

    identifier = identifier_for(slot)
    product_name = product_name_for(slot, name)

    cdp_host = os.environ.get("EMERALD_CDP_HOST", "127.0.0.1")
    cdp_port = BASE_CDP_PORT + slot
    port_override = os.environ.get("EMERALD_CDP_PORT")
    if port_override:
        try:
            forced_port = int(port_override)
        except ValueError:
            raise RuntimeError("EMERALD_CDP_PORT=" + repr(port_override) + " is not an integer")
        if forced_port != cdp_port:
            warnings.append(
                "EMERALD_CDP_PORT=" + str(forced_port) + " overrides this slot's port "
                + str(cdp_port) + ". Per-worktree instances need it unset - remove it "
                "from the MCP server registration."
            )
        cdp_port = forced_port

    state_dir = state_dir_for(slot)
    target_dir = target_dir_for(slot)
    app_data_dir = app_data_root() / identifier

    if not looks_like_emerald(checkout):
        warnings.append(str(checkout) + " does not look like an Emerald app checkout")

    return Instance(
        slot=slot,
        checkout=checkout,
        checkout_source=source,
        name=name,
        is_main=is_main,
        cdp_host=cdp_host,
        cdp_port=cdp_port,
        vite_port=BASE_VITE_PORT + slot,
        identifier=identifier,
        product_name=product_name,
        app_data_dir=app_data_dir,
        seed_vault_dir=app_data_dir / "vaults" / "seed",
        target_dir=target_dir,
        # A new slot is warm-started from slot 0's build rather than compiling
        # from scratch; slot 0 itself has nothing to copy from.
        seed_from=None if slot == 0 else target_dir_for(0),
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


def resolve_again(checkout: Path) -> Instance:
    """Drop the cached instance and resolve the checkout afresh - for a
    server whose slot was released under it."""
    global _cached
    _cached = None
    return resolve_instance(checkout)


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


# -- reclaiming disk ---------------------------------------------------------

DEFAULT_TARGET_TTL_DAYS = 14


def target_ttl_days() -> float:
    """Days a slot's build directory survives without being used. 0 disables
    the age rule, leaving only orphan cleanup."""
    try:
        return max(0.0, float(os.environ.get("EMERALD_MCP_TARGET_TTL_DAYS", DEFAULT_TARGET_TTL_DAYS)))
    except ValueError:
        return float(DEFAULT_TARGET_TTL_DAYS)


def _port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    """A slot whose debug port answers is running. Its build directory holds a
    loaded .exe and must not be touched."""
    import socket
    try:
        with socket.create_connection((host, port), timeout=0.3):
            return True
    except OSError:
        return False


def _free_bytes(path: Path) -> int:
    probe = path
    while not probe.exists() and probe.parent != probe:
        probe = probe.parent
    try:
        return shutil.disk_usage(probe).free
    except OSError:
        return 0


def prune(ttl_days: float | None = None, dry_run: bool = False) -> dict:
    """Reclaim build directories that are no longer earning their keep.

    Two kinds, and the difference matters:

    *Orphans* - the checkout is gone. The registry entry goes too, so the slot
    number returns to the pool.

    *Stale* - the checkout still exists but has not been used for `ttl_days`.
    Only the build directory goes; the registry entry stays, because a slot
    that moved would hand its worktree a different app identifier and with it
    a different database. It simply builds warm again from slot 0 next time.

    Slot 0 and any slot whose port answers are never touched.
    """
    ttl = target_ttl_days() if ttl_days is None else ttl_days
    home = mcp_home()
    before = _free_bytes(home)

    removed: list[dict] = []
    skipped: list[dict] = []
    doomed: list[Path] = []

    with _registry_lock():
        reg = load_registry()
        for key in sorted(reg["slots"], key=lambda k: int(k) if k.isdigit() else 0):
            slot = int(key)
            if slot == 0:
                continue
            entry = reg["slots"][key]
            checkout = Path(entry.get("checkout", ""))
            gone = not checkout.is_dir()
            idle = _idle_seconds(entry) / 86400.0
            stale = ttl > 0 and idle > ttl

            if not gone and not stale:
                continue
            if _port_in_use(BASE_CDP_PORT + slot):
                skipped.append({"slot": slot, "reason": "instance is running"})
                continue

            reason = "checkout gone" if gone else f"unused for {idle:.0f} days"
            targets, state = target_dir_for(slot), state_dir_for(slot)
            removed.append({
                "slot": slot,
                "reason": reason,
                "checkout": str(checkout),
                "target_dir": str(targets),
                "freed_registry_entry": gone,
            })
            if not dry_run:
                for path in (targets, state) if gone else (targets,):
                    if path.exists():
                        doomed.append(path)
                if gone:
                    del reg["slots"][key]
        if not dry_run and removed:
            # Renames happen under the lock; the slow delete does not.
            doomed = [p for p in doomed if _rename_aside(p)]
            _save_registry(reg)

    for path in doomed:
        shutil.rmtree(path, ignore_errors=True)

    freed = max(0, _free_bytes(home) - before) if not dry_run else 0
    return {
        "dry_run": dry_run,
        "ttl_days": ttl,
        "removed": removed,
        "skipped": skipped,
        "freed_bytes": freed,
        "freed_gb": round(freed / 1024 ** 3, 2),
    }


def _rename_aside(path: Path) -> Path | None:
    doomed = path.with_name(f"{path.name}.trash-{os.getpid()}-{int(time.time())}")
    try:
        os.replace(path, doomed)
        return doomed
    except OSError:
        # Still in use, or crossing a mount point. Leave it; the next prune
        # will try again rather than half-deleting a live build directory.
        return None


def _dir_size(path: Path) -> int:
    total = 0
    for root, _dirs, files in os.walk(path, onerror=lambda _e: None):
        for name in files:
            with contextlib.suppress(OSError):
                total += os.path.getsize(os.path.join(root, name))
    return total


RELOCATE_MAX_FILE = 4 * 1024 ** 2


def relocate_target(target: Path) -> dict:
    """Make a Cargo target dir that was copied or moved work where it is now.

    Cargo copes with a moved target dir on its own, but some build scripts do
    not: tauri and its plugins write absolute paths into their outputs - the
    permission file lists under out/, the DEP_* metadata in `output` - and
    cargo has no reason to re-run them, since nothing it tracks changed. The
    next build then reads permission files at the old location and fails the
    moment that location is gone, which is exactly what happens after a warm
    copy from another slot's build or a move to another drive.

    Every build script records where its OUT_DIR was in `root-output`, so the
    old roots can be read off rather than guessed. Their occurrences are
    rewritten to the current root, raw and JSON-escaped, with modification
    times preserved so cargo sees nothing new. Cheap when there is nothing to
    do: only the root-output files are read then.
    """
    target = Path(target)
    build = target / "debug" / "build"
    result = {"target": str(target), "old_roots": [], "rewritten": 0}
    if not build.is_dir():
        return result

    here = os.path.normpath(os.path.abspath(target))
    old_roots: set[str] = set()
    for marker in build.glob("*/root-output"):
        try:
            recorded = marker.read_text(encoding="utf-8", errors="replace").strip()
        except OSError:
            continue
        suffix = os.sep + os.path.join("debug", "build", marker.parent.name, "out")
        if not recorded.lower().endswith(suffix.lower()):
            continue
        root = recorded[: -len(suffix)]
        if root and os.path.normcase(os.path.normpath(root)) != os.path.normcase(here):
            old_roots.add(root)
    if not old_roots:
        return result

    pairs: list[tuple[bytes, bytes]] = []
    for old in sorted(old_roots, key=len, reverse=True):
        pairs.append((old.encode("utf-8"), here.encode("utf-8")))
        escaped_old, escaped_here = old.replace(os.sep, os.sep * 2), here.replace(os.sep, os.sep * 2)
        if escaped_old != old:
            pairs.append((escaped_old.encode("utf-8"), escaped_here.encode("utf-8")))

    rewritten = 0
    for root, _dirs, files in os.walk(build):
        for name in files:
            path = os.path.join(root, name)
            try:
                st = os.stat(path)
                if st.st_size > RELOCATE_MAX_FILE:
                    continue
                with open(path, "rb") as fh:
                    data = fh.read()
            except OSError:
                continue
            changed = data
            for old, new in pairs:
                changed = changed.replace(old, new)
            if changed is data or changed == data:
                continue
            try:
                with open(path, "wb") as fh:
                    fh.write(changed)
                os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns))
                rewritten += 1
            except OSError:
                log.warning("could not rewrite %s", path)
    result["old_roots"] = sorted(old_roots)
    result["rewritten"] = rewritten
    return result


def stop_slot(slot: int) -> bool:
    """Stop a slot's instance without giving the slot away. Unlike the
    automatic reaper this also accepts slot 0 - stopping it by hand is fine,
    it is only never stopped *for* you."""
    import procs

    entry = load_registry()["slots"].get(str(slot), {})
    pid = entry.get("launcher_pid")
    if pid and procs.stop_tree(int(pid)):
        return True
    return bool(procs.stop_by_target_dir(target_dir_for(slot)))


def overview(with_sizes: bool = True) -> dict:
    """What exists on disk right now, for `--list` and the tray app.

    `with_sizes` walks each build directory, which is ~100k stat calls per
    slot - fine for a command you typed, too slow for a window that refreshes.
    """
    import procs

    reg = load_registry()
    slots = []
    for key in sorted(set(reg["slots"]) | {"0"}, key=lambda k: int(k)):
        slot = int(key)
        entry = reg["slots"].get(key, {})
        targets = target_dir_for(slot)
        checkout = entry.get("checkout") or (str(main_checkout()) if slot == 0 else "?")
        running = _port_in_use(BASE_CDP_PORT + slot)
        pid = entry.get("launcher_pid")
        row = {
            "slot": slot,
            "name": entry.get("name") or ("main" if slot == 0 else "?"),
            "checkout": checkout,
            "checkout_exists": Path(checkout).is_dir(),
            "running": running,
            # Launcher up, app not yet: a build in progress.
            "starting": not running and bool(pid) and procs.pid_alive(int(pid)),
            "cdp_port": BASE_CDP_PORT + slot,
            "last_used_at": entry.get("last_used_at") if slot else "(always)",
            "idle_hours": round(_idle_seconds(entry) / 3600.0, 1) if slot else 0.0,
            "launcher_pid": entry.get("launcher_pid"),
            "visible": wants_visible(slot),
            "target_dir": str(targets),
        }
        if with_sizes:
            row["target_gb"] = round(_dir_size(targets) / 1024 ** 3, 2) if targets.exists() else 0.0
        slots.append(row)
    return {
        "home": str(mcp_home()),
        "idle_hours": idle_hours(),
        "max_slots": max_slots(),
        "ttl_days": target_ttl_days(),
        "slots": slots,
    }


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Emerald MCP instance registry")
    parser.add_argument("--list", action="store_true", help="show every slot and what it costs on disk")
    parser.add_argument("--prune", action="store_true", help="reclaim orphaned and unused build directories")
    parser.add_argument("--reap", action="store_true", help="stop instances nobody has used lately")
    parser.add_argument("--reset-vault", type=int, metavar="SLOT",
                        help="throw away a slot's database so the next start seeds a fresh one")
    parser.add_argument("--allow-main", action="store_true",
                        help="with --reset-vault 0: yes, really wipe the main checkout's data")
    parser.add_argument("--relocate-target", metavar="DIR",
                        help="rewrite paths a copied or moved Cargo target dir still has from its old location")
    parser.add_argument("--dry-run", action="store_true", help="with --prune: report without deleting")
    parser.add_argument("--ttl-days", type=float, default=None, help="override EMERALD_MCP_TARGET_TTL_DAYS")
    args = parser.parse_args()

    if args.list:
        print(json.dumps(overview(), indent=2))
    elif args.relocate_target:
        print(json.dumps(relocate_target(Path(args.relocate_target)), indent=2))
    elif args.reset_vault is not None:
        print(json.dumps(reset_vault(args.reset_vault, allow_main=args.allow_main), indent=2))
    elif args.reap:
        print(json.dumps(reap_idle(), indent=2))
    elif args.prune:
        print(json.dumps(prune(ttl_days=args.ttl_days, dry_run=args.dry_run), indent=2))
    else:
        print(json.dumps(resolve_instance().to_dict(), indent=2))
