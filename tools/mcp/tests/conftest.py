"""The CDP layer is tested against a headless Edge showing tests/page.html -
the same engine as WebView2, without needing an Emerald build. Nothing here
touches the real app."""

import asyncio
import shutil
import socket
import subprocess
import sys
from pathlib import Path

import pytest
import pytest_asyncio

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from cdp import CDPTarget, discover_targets  # noqa: E402

PAGE = Path(__file__).with_name("page.html")
EDGE_CANDIDATES = [
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
]


def _browser() -> str | None:
    for path in EDGE_CANDIDATES:
        if path.exists():
            return str(path)
    return shutil.which("msedge") or shutil.which("chromium") or shutil.which("google-chrome")


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def browser_port(tmp_path_factory):
    exe = _browser()
    if not exe:
        pytest.skip("no Chromium-based browser found")
    port = _free_port()
    proc = subprocess.Popen(
        [
            exe, "--headless=new", f"--remote-debugging-port={port}",
            f"--user-data-dir={tmp_path_factory.mktemp('browser-profile')}",
            "--no-first-run", "--disable-gpu", "--window-size=1000,700", PAGE.as_uri(),
        ],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    yield port
    proc.terminate()
    proc.wait(timeout=10)


@pytest_asyncio.fixture
async def target(browser_port):
    for _ in range(100):
        try:
            pages = [t for t in await discover_targets("127.0.0.1", browser_port, 1.0) if t.get("type") == "page"]
        except Exception:
            pages = []
        if pages:
            break
        await asyncio.sleep(0.1)
    else:
        pytest.fail("the browser never offered a page target")
    t = CDPTarget(pages[0]["webSocketDebuggerUrl"], pages[0]["id"], pages[0].get("title", ""), pages[0].get("url", ""))
    await t.connect()
    # Every test starts from the fixture page as it was written.
    await t.navigate(PAGE.as_uri())
    yield t
    await t.close()


async def page_log(t: CDPTarget) -> str:
    """What the fixture page's own event listeners recorded."""
    return await t.eval("document.getElementById('log').textContent")
