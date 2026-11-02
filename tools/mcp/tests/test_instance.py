"""Which checkout a session gets, and what follows for its instance."""

import socket
import subprocess
import sys
from pathlib import Path

import pytest

import instance
from instance import _git_toplevel, running_checkout

unix_only = pytest.mark.skipif(sys.platform == "win32", reason="process directories are not readable on Windows")

SETTINGS = (
    "EMERALD_APP_DIR", "EMERALD_CDP_PORT", "EMERALD_MCP_VITE_PORT", "EMERALD_MCP_IDENTIFIER",
    "EMERALD_MCP_HOME", "CARGO_TARGET_DIR",
)


@pytest.fixture(autouse=True)
def clean_settings(monkeypatch):
    for name in SETTINGS:
        monkeypatch.delenv(name, raising=False)


def _repo(where: Path):
    main = where / "main"
    main.mkdir(parents=True)
    (main / "package.json").write_text('{"name": "emerald"}')
    (main / "src-tauri").mkdir()
    (main / "src-tauri" / "tauri.conf.json").write_text("{}")
    git = ["git", "-C", str(main), "-c", "user.name=t", "-c", "user.email=t@t"]
    subprocess.run([*git, "init", "-q"], check=True)
    subprocess.run([*git, "add", "."], check=True)
    subprocess.run([*git, "commit", "-qm", "x"], check=True)
    wt = where / "wt"
    subprocess.run([*git, "worktree", "add", "-q", str(wt), "-b", "wt"], check=True)
    return main.resolve(), wt.resolve()


def _started_from(monkeypatch, cwd, chain):
    """The server runs in `cwd`; `chain` is what is above it, nearest first, as
    (process name, working directory)."""
    monkeypatch.chdir(cwd)
    monkeypatch.setattr(instance.os, "getppid", lambda: 100)
    monkeypatch.setattr(instance, "_process_name", lambda pid: chain[pid - 100][0] if pid - 100 < len(chain) else "launchd")
    monkeypatch.setattr(instance, "_process_cwd", lambda pid: chain[pid - 100][1] if pid - 100 < len(chain) else None)
    monkeypatch.setattr(instance, "_parent_pid", lambda pid: pid + 1)


# -- the session's checkout ---------------------------------------------------

@unix_only
def test_server_in_main_checkout_follows_a_client_in_a_worktree(tmp_path, monkeypatch):
    main, wt = _repo(tmp_path)
    _started_from(monkeypatch, main, [("uv", main), ("claude", wt)])
    assert instance.resolve_checkout() == (wt, "client-cwd")


@unix_only
def test_client_in_the_same_checkout_changes_nothing(tmp_path, monkeypatch):
    main, _ = _repo(tmp_path)
    _started_from(monkeypatch, main, [("uv", main), ("claude", main)])
    assert instance.resolve_checkout() == (main, "git-toplevel")


@unix_only
def test_what_started_the_client_says_nothing(tmp_path, monkeypatch):
    main, wt = _repo(tmp_path)
    _started_from(monkeypatch, main, [("uv", main), ("claude", main), ("zsh", wt)])
    assert instance.resolve_checkout() == (main, "git-toplevel")


@unix_only
def test_a_server_in_a_worktree_stays_there(tmp_path, monkeypatch):
    main, wt = _repo(tmp_path)
    _started_from(monkeypatch, wt, [("claude", wt), ("zsh", main)])
    assert instance.resolve_checkout() == (wt, "git-toplevel")


@unix_only
def test_another_clone_is_not_the_clients_worktree(tmp_path, monkeypatch):
    main, _ = _repo(tmp_path / "a")
    _, other = _repo(tmp_path / "b")
    _started_from(monkeypatch, main, [("claude", other)])
    assert instance.resolve_checkout() == (main, "git-toplevel")


def test_the_override_wins(tmp_path, monkeypatch):
    main, wt = _repo(tmp_path)
    monkeypatch.setenv("EMERALD_APP_DIR", str(main))
    monkeypatch.chdir(wt)
    assert instance.resolve_checkout() == (main, "env")


# -- what counts as a worktree ------------------------------------------------

def test_a_checkout_inside_another_repository_is_no_worktree(tmp_path):
    outer, _ = _repo(tmp_path)
    inner = outer / "nested"
    inner.mkdir()
    assert instance._worktree_key(inner) is None


def test_a_separate_git_dir_is_no_worktree(tmp_path):
    main = tmp_path / "main"
    main.mkdir()
    subprocess.run(["git", "-C", str(main), "init", "-q", f"--separate-git-dir={tmp_path / 'store'}"], check=True)
    assert instance._worktree_key(main) is None


def test_the_worktree_build_dir_is_not_named_after_the_main_one(tmp_path):
    main, wt = _repo(tmp_path)
    home, other = instance.build_instance(main), instance.build_instance(wt)
    assert not str(other.target_dir).lower().startswith(str(home.target_dir).lower())


# -- the instance -------------------------------------------------------------

def test_main_checkout_keeps_the_defaults(tmp_path):
    main, _ = _repo(tmp_path)
    inst = instance.build_instance(main)
    assert (inst.cdp_port, inst.vite_port) == (instance.DEFAULT_CDP_PORT, instance.DEFAULT_VITE_PORT)
    assert inst.identifier == instance.DEFAULT_IDENTIFIER


def test_each_worktree_is_an_instance_of_its_own(tmp_path):
    main, wt = _repo(tmp_path)
    home, other = instance.build_instance(main), instance.build_instance(wt)
    assert other.cdp_port != home.cdp_port and other.vite_port != home.vite_port
    assert other.cdp_port - instance.WORKTREE_CDP_BASE == other.vite_port - instance.WORKTREE_VITE_BASE
    for field in ("identifier", "app_data_dir", "seed_vault_dir", "target_dir", "state_dir", "config_path"):
        assert getattr(other, field) != getattr(home, field), field
    assert instance.build_instance(wt) == other, "stable across restarts"


def _listening(monkeypatch, owners):
    """`owners` maps a port to the directory of the process listening on it."""
    pids = {port: 1000 + i for i, port in enumerate(owners)}
    cwds = {pids[port]: owners[port] for port in owners}
    monkeypatch.setattr(instance, "_listeners", lambda: pids)
    monkeypatch.setattr(instance, "_process_cwd", lambda pid: cwds.get(pid))
    monkeypatch.setattr(instance, "_answers", lambda port: False)


def _home_place(wt):
    return int(instance._worktree_key(wt), 16) % instance.WORKTREE_PORTS


def test_a_port_held_elsewhere_moves_the_worktree_on(tmp_path, monkeypatch):
    main, wt = _repo(tmp_path)
    place = _home_place(wt)
    _listening(monkeypatch, {instance.WORKTREE_CDP_BASE + place: main})
    assert instance._worktree_offset(instance._worktree_key(wt), wt) == (place + 1) % instance.WORKTREE_PORTS


def test_a_vite_port_alone_also_moves_it_on(tmp_path, monkeypatch):
    main, wt = _repo(tmp_path)
    place = _home_place(wt)
    _listening(monkeypatch, {instance.WORKTREE_VITE_BASE + place: main})
    assert instance._worktree_offset(instance._worktree_key(wt), wt) == (place + 1) % instance.WORKTREE_PORTS


def test_a_running_instance_is_found_where_it_moved_to(tmp_path, monkeypatch):
    _, wt = _repo(tmp_path)
    place = (_home_place(wt) + 7) % instance.WORKTREE_PORTS
    _listening(monkeypatch, {instance.WORKTREE_CDP_BASE + place: wt / "src-tauri"})
    assert instance._worktree_offset(instance._worktree_key(wt), wt) == place


def test_without_a_way_to_tell_it_keeps_its_place(tmp_path, monkeypatch):
    _, wt = _repo(tmp_path)
    monkeypatch.setattr(instance, "_listeners", lambda: None)
    assert instance._worktree_offset(instance._worktree_key(wt), wt) == _home_place(wt)


def test_settings_can_be_forced_in_a_worktree(tmp_path, monkeypatch):
    _, wt = _repo(tmp_path)
    monkeypatch.setenv("EMERALD_CDP_PORT", "9999")
    monkeypatch.setenv("EMERALD_MCP_IDENTIFIER", "com.emerald.forced")
    inst = instance.build_instance(wt)
    assert (inst.cdp_port, inst.identifier) == (9999, "com.emerald.forced")


def test_a_shared_build_dir_is_warned_about(tmp_path, monkeypatch):
    _, wt = _repo(tmp_path)
    monkeypatch.setenv("CARGO_TARGET_DIR", str(tmp_path / "shared"))
    assert any("CARGO_TARGET_DIR" in w for w in instance.build_instance(wt).warnings)


def test_an_arranged_instance_is_left_alone(tmp_path, monkeypatch):
    _, wt = _repo(tmp_path)
    monkeypatch.setenv("EMERALD_APP_DIR", str(wt))
    inst = instance.build_instance()
    assert (inst.cdp_port, inst.identifier) == (instance.DEFAULT_CDP_PORT, instance.DEFAULT_IDENTIFIER)


# -- the real lookups ---------------------------------------------------------

@unix_only
def test_names_the_checkout_of_the_process_on_the_port(monkeypatch):
    here = Path(__file__).resolve().parent
    monkeypatch.chdir(here)
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        s.listen()
        assert running_checkout(s.getsockname()[1]) == _git_toplevel(here)


@unix_only
def test_a_non_ascii_directory_is_read_back(tmp_path, monkeypatch):
    place = tmp_path / "Büro"
    place.mkdir()
    monkeypatch.chdir(place)
    assert instance._process_cwd(instance.os.getpid()).resolve() == place.resolve()


def test_nothing_on_the_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    assert running_checkout(port) is None
