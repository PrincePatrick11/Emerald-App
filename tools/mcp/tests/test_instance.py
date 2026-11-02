"""Telling which checkout a running instance came from."""

import socket
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import instance  # noqa: E402
from instance import _git_toplevel, running_checkout  # noqa: E402

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="not readable on Windows")


def test_names_the_checkout_of_the_process_on_the_port(monkeypatch):
    here = Path(__file__).resolve().parent
    monkeypatch.chdir(here)
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        s.listen()
        assert running_checkout(s.getsockname()[1]) == _git_toplevel(here)


def test_nothing_on_the_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    assert running_checkout(port) is None


def _repo(tmp_path):
    main = tmp_path / "main"
    main.mkdir()
    (main / "package.json").write_text('{"name": "emerald"}')
    (main / "src-tauri").mkdir()
    (main / "src-tauri" / "tauri.conf.json").write_text("{}")
    git = ["git", "-C", str(main), "-c", "user.name=t", "-c", "user.email=t@t"]
    subprocess.run([*git, "init", "-q"], check=True)
    subprocess.run([*git, "add", "."], check=True)
    subprocess.run([*git, "commit", "-qm", "x"], check=True)
    wt = tmp_path / "wt"
    subprocess.run([*git, "worktree", "add", "-q", str(wt), "-b", "wt"], check=True)
    return main.resolve(), wt.resolve()


def _started_from(monkeypatch, chain):
    """A process tree of working directories: this server's parent first."""
    monkeypatch.setattr(instance.os, "getppid", lambda: 100)
    monkeypatch.setattr(instance, "_process_cwd", lambda pid: chain[pid - 100] if pid - 100 < len(chain) else None)
    monkeypatch.setattr(instance, "_parent_pid", lambda pid: pid + 1)


def test_server_in_main_checkout_follows_a_client_in_a_worktree(tmp_path, monkeypatch):
    main, wt = _repo(tmp_path)
    monkeypatch.delenv("EMERALD_APP_DIR", raising=False)
    monkeypatch.chdir(main)
    _started_from(monkeypatch, [main, wt])
    assert instance.resolve_checkout() == (wt, "client-cwd")


def test_client_in_the_same_checkout_changes_nothing(tmp_path, monkeypatch):
    main, _ = _repo(tmp_path)
    monkeypatch.delenv("EMERALD_APP_DIR", raising=False)
    monkeypatch.chdir(main)
    _started_from(monkeypatch, [main, main, Path("/")])
    assert instance.resolve_checkout() == (main, "git-toplevel")


def test_another_clone_is_not_the_clients_worktree(tmp_path, monkeypatch):
    main, _ = _repo(tmp_path / "a" if (tmp_path / "a").mkdir() is None else tmp_path)
    other, _ = _repo(tmp_path / "b" if (tmp_path / "b").mkdir() is None else tmp_path)
    monkeypatch.delenv("EMERALD_APP_DIR", raising=False)
    monkeypatch.chdir(main)
    _started_from(monkeypatch, [other])
    assert instance.resolve_checkout() == (main, "git-toplevel")


def test_the_override_wins(tmp_path, monkeypatch):
    main, wt = _repo(tmp_path)
    monkeypatch.setenv("EMERALD_APP_DIR", str(main))
    monkeypatch.chdir(main)
    _started_from(monkeypatch, [wt])
    assert instance.resolve_checkout() == (main, "env")


def test_main_checkout_keeps_the_defaults(tmp_path, monkeypatch):
    main, _ = _repo(tmp_path)
    for name in ("EMERALD_APP_DIR", "EMERALD_CDP_PORT", "EMERALD_MCP_VITE_PORT", "EMERALD_MCP_IDENTIFIER"):
        monkeypatch.delenv(name, raising=False)
    inst = instance.build_instance(main)
    assert (inst.cdp_port, inst.vite_port) == (instance.DEFAULT_CDP_PORT, instance.DEFAULT_VITE_PORT)
    assert inst.identifier == instance.DEFAULT_IDENTIFIER


def test_each_worktree_is_an_instance_of_its_own(tmp_path, monkeypatch):
    main, wt = _repo(tmp_path)
    for name in ("EMERALD_APP_DIR", "EMERALD_CDP_PORT", "EMERALD_MCP_VITE_PORT", "EMERALD_MCP_IDENTIFIER", "CARGO_TARGET_DIR"):
        monkeypatch.delenv(name, raising=False)
    home, other = instance.build_instance(main), instance.build_instance(wt)
    assert other.cdp_port != home.cdp_port and other.vite_port != home.vite_port
    assert other.cdp_port - instance.WORKTREE_CDP_BASE == other.vite_port - instance.WORKTREE_VITE_BASE
    for field in ("identifier", "app_data_dir", "seed_vault_dir", "target_dir", "state_dir", "config_path"):
        assert getattr(other, field) != getattr(home, field), field
    assert instance.build_instance(wt) == other, "stable across restarts"


def test_a_port_taken_by_another_checkout_moves_the_worktree_on(tmp_path, monkeypatch):
    _, wt = _repo(tmp_path)
    for name in ("EMERALD_APP_DIR", "EMERALD_CDP_PORT", "EMERALD_MCP_VITE_PORT"):
        monkeypatch.delenv(name, raising=False)
    free = instance.build_instance(wt).cdp_port
    monkeypatch.setattr(instance, "_port_is_ours", lambda port, checkout: port != free)
    moved = instance.build_instance(wt)
    assert moved.cdp_port != free and moved.cdp_port - instance.WORKTREE_CDP_BASE == moved.vite_port - instance.WORKTREE_VITE_BASE


def test_settings_can_be_forced_in_a_worktree(tmp_path, monkeypatch):
    _, wt = _repo(tmp_path)
    monkeypatch.delenv("EMERALD_APP_DIR", raising=False)
    monkeypatch.setenv("EMERALD_CDP_PORT", "9999")
    monkeypatch.setenv("EMERALD_MCP_IDENTIFIER", "com.emerald.forced")
    inst = instance.build_instance(wt)
    assert (inst.cdp_port, inst.identifier) == (9999, "com.emerald.forced")


def test_an_arranged_instance_is_left_alone(tmp_path, monkeypatch):
    _, wt = _repo(tmp_path)
    monkeypatch.setenv("EMERALD_APP_DIR", str(wt))
    for name in ("EMERALD_CDP_PORT", "EMERALD_MCP_IDENTIFIER"):
        monkeypatch.delenv(name, raising=False)
    inst = instance.build_instance()
    assert (inst.cdp_port, inst.identifier) == (instance.DEFAULT_CDP_PORT, instance.DEFAULT_IDENTIFIER)
