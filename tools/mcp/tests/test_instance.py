"""Telling which checkout a running instance came from."""

import socket
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

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
