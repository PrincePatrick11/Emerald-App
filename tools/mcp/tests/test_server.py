"""server.py as a client sees it: started as a stdio MCP server and pointed at
the headless browser instead of an Emerald instance. The slot is forced and
every state directory lives under tmp_path, so no registry is read or written
and nothing is launched."""

import json
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from conftest import PAGE

SERVER = Path(__file__).resolve().parent.parent / "server.py"


@asynccontextmanager
async def session(port: int, home: Path):
    env = {
        **os.environ,
        "EMERALD_CDP_PORT": str(port),
        "EMERALD_MCP_SLOT": "7",
        "EMERALD_MCP_HOME": str(home / "home"),
        "APPDATA": str(home / "appdata"),
        "EMERALD_AUTO_LAUNCH": "0",
    }
    params = StdioServerParameters(command=sys.executable, args=[str(SERVER)], env=env)
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as client:
            await client.initialize()
            yield client


def text_of(result) -> str:
    return "\n".join(c.text for c in result.content if c.type == "text")


async def test_tools_are_listed_with_annotations(browser_port, tmp_path):
    async with session(browser_port, tmp_path) as client:
        tools = {t.name: t for t in (await client.list_tools()).tools}
    assert set(tools) == {
        "status", "connect", "attach", "snapshot", "click", "hover", "type_text", "press_key",
        "wait_for", "eval", "console_logs", "screenshot", "navigate", "dialog", "reset_database",
    }
    assert tools["snapshot"].annotations.readOnlyHint
    assert tools["reset_database"].annotations.destructiveHint
    catalog = json.dumps([t.model_dump(exclude_none=True) for t in tools.values()])
    assert len(catalog) < 9000, "the catalog is sent with every session - keep it lean"


async def test_a_session_through_the_protocol(browser_port, tmp_path):
    async with session(browser_port, tmp_path) as client:
        async def call(name, **arguments):
            return await client.call_tool(name, arguments)

        assert text_of(await call("navigate", url=PAGE.as_uri())).startswith("loaded file:///")

        snap = text_of(await call("snapshot", interactive=True))
        assert 'button#save "Save" @e' in snap

        assert text_of(await call("click", selector="#save")).startswith('clicked button#save "Save"')
        typed = text_of(await call("type_text", selector="#title", text="Neu"))
        assert typed.endswith('it now reads "Neu"')
        assert text_of(await call("press_key", key="Enter")) == "pressed Enter"
        assert text_of(await call("wait_for", selector="#save")) == "#save is visible"
        assert "timed out after 200 ms" in text_of(await call("wait_for", selector="#nope", timeout_ms=200))

        assert text_of(await call("eval", expression="document.title")) == "emcp fixture"
        assert text_of(await call("eval", expression="({ a: 1 })")) == '{"a":1}'
        long = text_of(await call("eval", expression="'x'.repeat(500)", max_chars=100))
        assert long.startswith("x" * 100 + "\n… cut at 100 of 500 chars")

        await call("eval", expression="console.warn('careful'); console.error('broken')")
        logs = text_of(await call("console_logs", level="warning"))
        assert logs.splitlines() == ["[warning] careful", "[error] broken"]
        await call("console_logs", clear=True)
        assert text_of(await call("console_logs")) == "no console output"

        shot = await call("screenshot", selector="#save")
        assert shot.content[0].type == "image"
        saved = Path(text_of(shot).split("saved to ", 1)[1])
        assert saved.is_file() and tmp_path in saved.parents


async def test_failures_are_flagged_as_errors(browser_port, tmp_path):
    async with session(browser_port, tmp_path) as client:
        await client.call_tool("navigate", {"url": PAGE.as_uri()})

        missing = await client.call_tool("click", {"selector": "#nope"})
        assert missing.isError and text_of(missing) == 'nothing matches "#nope"'

        thrown = await client.call_tool("eval", {"expression": "nope()"})
        assert thrown.isError and "ReferenceError" in text_of(thrown)

        invalid = await client.call_tool("click", {})
        assert invalid.isError and "selector" in text_of(invalid)

        fine = await client.call_tool("eval", {"expression": "1 + 1"})
        assert not fine.isError and text_of(fine) == "2"


async def test_status_reports_the_instance(browser_port, tmp_path):
    async with session(browser_port, tmp_path) as client:
        status = json.loads(text_of(await client.call_tool("status", {})))
    assert status["port_alive"] is True
    assert status["instance"]["slot"] == 7 and status["instance"]["cdp_port"] == browser_port
