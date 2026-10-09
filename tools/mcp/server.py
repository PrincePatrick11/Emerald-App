"""Emerald DevTools MCP server — gives an LLM the ability to drive a running
Tauri/Emerald app via the Chromium DevTools Protocol.

Architecture:
  - This server runs as an MCP stdio server.
  - It opens a single CDP session against one chosen target (one WebView).
  - Tools mirror the actions an LLM would want when validating code that
    runs in a Tauri WebView: read the page as an outline, click and type
    with real input events, wait, eval JS, capture console, screenshot.
  - Native dialogs are outside the WebView and are driven through the
    window system instead (see dialogs.py).

Which Emerald it drives is not configured — it is derived. The server resolves
the app checkout the session runs in (see instance.py) and builds and starts
it as an instance of its own, apart from the regular dev build: its own CDP
port, Vite port, app identifier, database and Cargo target dir. `status`
reports the instance.

The window is placed off-screen and kept out of the taskbar (see
tauri_config.py), so an agent driving the app does not put a window in the
user's face; screenshots keep working because the window is off-screen rather
than hidden.

Environment (all optional):
  EMERALD_APP_DIR            force the checkout instead of discovering it
  EMERALD_CDP_HOST           default 127.0.0.1
  EMERALD_CDP_PORT           default 9223
  EMERALD_AUTO_ATTACH        default 1 — auto-attach to the main page target
  EMERALD_AUTO_LAUNCH        default 1 — launch Emerald if no target is found
  EMERALD_LAUNCHER_PATH      default <repo>/start_emerald_mcp.bat
  EMERALD_LAUNCH_TIMEOUT     default 900 (seconds) — overall give-up budget
  EMERALD_LAUNCH_POLL_WAIT   default 25 (seconds) — bounded wait per tool call
  EMERALD_LAUNCH_POLL_INTERVAL default 1.5 (seconds) — port-check interval
  EMERALD_LAUNCH_LOG_DIR     default <state dir>/logs
  (instance.py and window.py document the EMERALD_MCP_* knobs)

If Emerald isn't running when a tool is called and EMERALD_AUTO_LAUNCH is on,
this server spawns start_emerald_mcp.bat itself (see launcher.py) and waits
(bounded) for the debug port to come up, so no manual launch step is needed.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import logging
import os
import struct
import sys
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import mcp.server.stdio
import mcp.types as types
from mcp.server import Server

import dialogs
import launcher
from cdp import CDPError, CDPTarget, ConsoleBuffer, browser_version, discover_targets
from instance import Instance, resolve_instance
from window import hide_instance_windows

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s", stream=sys.stderr)
log = logging.getLogger("emerald-mcp")

AUTO_ATTACH = os.environ.get("EMERALD_AUTO_ATTACH", "1") == "1"
AUTO_LAUNCH = os.environ.get("EMERALD_AUTO_LAUNCH", "1") == "1"
LAUNCH_POLL_WAIT = float(os.environ.get("EMERALD_LAUNCH_POLL_WAIT", "25"))

# Resolving the instance touches the filesystem and runs git, so it can fail.
# It must not fail at import: an exception here leaves the client
# showing a server with no tools and the traceback only on stderr. Every tool
# reports the problem instead.
try:
    INSTANCE: Instance | None = resolve_instance()
    INSTANCE_ERROR: str | None = None
except Exception as _e:  # noqa: BLE001 - reported through the tools
    INSTANCE, INSTANCE_ERROR = None, f"{type(_e).__name__}: {_e}"
    log.exception("could not resolve the Emerald instance for this session")

app = Server(
    "emerald-devtools",
    instructions=(
        "Drives a running Emerald instance. Read the UI with `snapshot` and act on the refs it "
        "gives (`@e7`); use `wait_for` instead of sleeping; reach for `eval` and `screenshot` "
        "only when the outline cannot answer the question. An error saying Emerald is still "
        "starting means: call again in a few seconds."
    ),
)


def _instance() -> Instance:
    if INSTANCE is None:
        raise RuntimeError(
            f"could not work out which Emerald checkout this session belongs to: {INSTANCE_ERROR}. "
            f"Set EMERALD_APP_DIR to the checkout."
        )
    return INSTANCE

# Single shared CDP target. Tauri 2 ships one main WebView window; if more
# are added (e.g. a PDF export window), users can attach to a specific one
# via the `attach` tool using the target's id.
_target: CDPTarget | None = None
_target_lock = asyncio.Lock()
# One buffer for the life of the server, handed to every target in turn.
_console = ConsoleBuffer()


async def _open(chosen: dict) -> CDPTarget:
    t = CDPTarget(
        ws_url=chosen["webSocketDebuggerUrl"],
        target_id=chosen["id"],
        title=chosen.get("title", ""),
        url=chosen.get("url", ""),
        console=_console,
    )
    await t.connect()
    return t


def _instance_brief(inst: Instance) -> dict:
    return {
        "checkout": str(inst.checkout),
        "identifier": inst.identifier,
        "cdp_port": inst.cdp_port,
        "vite_port": inst.vite_port,
    }


def _pick_main(page_targets: list[dict], vite_port: int) -> dict | None:
    """The app's main window, not whatever happens to be first - or None while
    there is nothing but blank pages.

    Emerald opens a second, hidden webview for PDF export
    (src-tauri/src/pdf_export/windows.rs); attaching to that one would look
    like the app is showing an empty page. And a window that has only just
    been created is still on about:blank: the debug port answers before the
    app has loaded, and attaching then would report an empty page as ready.
    """
    prefixes = (f"http://localhost:{vite_port}", "http://tauri.localhost")
    for t in page_targets:
        if str(t.get("url", "")).startswith(prefixes):
            return t
    loaded = [t for t in page_targets if not str(t.get("url", "")).startswith("about:")]
    return loaded[0] if loaded else None


MAIN_PAGE_WAIT_SEC = 10.0


async def _main_page(inst: Instance, page_targets: list[dict]) -> dict:
    """Wait a moment for the main window to have loaded the app."""
    deadline = time.monotonic() + MAIN_PAGE_WAIT_SEC
    while True:
        chosen = _pick_main(page_targets, inst.vite_port)
        if chosen is not None:
            return chosen
        if time.monotonic() >= deadline:
            raise RuntimeError("Emerald's window is up but has not loaded the app yet — retry shortly.")
        await asyncio.sleep(0.5)
        with contextlib.suppress(Exception):
            targets = await discover_targets(inst.cdp_host, inst.cdp_port)
            page_targets = [t for t in targets if t.get("type") == "page"]


async def _ensure_target() -> CDPTarget:
    """Return a live target, attaching on demand if AUTO_ATTACH is on.
    If no target is reachable and AUTO_LAUNCH is on, launch Emerald and
    wait (bounded) for it to come up, raising an actionable retry error
    if the wait expires before the cold build/start finishes."""
    global _target
    inst = _instance()
    host, port = inst.cdp_host, inst.cdp_port
    async with _target_lock:
        if _target is not None:
            if _target.is_open():
                return _target
            # The WebView went away under us. Without this the next call fails
            # with 'Cannot write to closing transport' until someone calls
            # `detach` by hand.
            log.warning("attached target is gone - dropping it and reattaching")
            with contextlib.suppress(Exception):
                await _target.close()
            _target = None
        if not AUTO_ATTACH:
            raise RuntimeError("no CDP target attached. Call `attach` first.")

        try:
            targets = await discover_targets(host, port)
        except Exception:
            targets = []
        page_targets = [t for t in targets if t.get("type") == "page"]

        if not page_targets:
            if not AUTO_LAUNCH:
                raise RuntimeError(
                    f"no page-type targets on {host}:{port} ({inst.checkout}) — "
                    f"is Emerald running with --remote-debugging-port? (EMERALD_AUTO_LAUNCH is "
                    f"disabled; start it manually with start_emerald_mcp.bat)"
                )

            # A previous launch that has since died would otherwise keep the
            # state on 'ready' forever and never restart.
            await launcher.invalidate_if_dead(host, port)
            state = await launcher.ensure_launching(inst)
            if state.status == "failed":
                raise RuntimeError(f"Emerald auto-launch failed: {state.error} (log: {state.log_path})")

            timeout = launcher.launch_timeout()
            elapsed_so_far = time.monotonic() - state.started_at if state.started_at else 0.0
            if elapsed_so_far > timeout:
                raise RuntimeError(
                    f"Emerald auto-launch exceeded {timeout:.0f}s and gave up. Check log: {state.log_path}"
                )

            ok = await launcher.poll_until_ready_or_timeout(host, port, bounded_wait=LAUNCH_POLL_WAIT)
            if not ok:
                snap = launcher.snapshot()
                if snap["status"] == "failed":
                    raise RuntimeError(f"Emerald auto-launch failed: {snap['error']} (log: {snap['log_path']})")
                remaining = max(0.0, timeout - (snap["elapsed_sec"] or 0.0))
                raise RuntimeError(
                    f"Emerald is still starting (elapsed {snap['elapsed_sec']:.0f}s of up to "
                    f"{timeout:.0f}s — first build can take 5-15 min, {remaining:.0f}s remaining "
                    f"in the overall budget). Retry this call in ~15-30s. (log: {snap['log_path']})"
                )

            targets = await discover_targets(host, port)
            page_targets = [t for t in targets if t.get("type") == "page"]
            if not page_targets:
                raise RuntimeError("Emerald port opened but no page targets yet — retry shortly.")

        chosen = await _main_page(inst, page_targets)
        log.info("auto-attaching to %s (%s)", chosen.get("title"), chosen.get("url"))
        # Runs on every attach, not just the first: `tauri dev` replaces the
        # window whenever the Rust source changes, and the new one comes back
        # on screen. Never allowed to break a tool call.
        try:
            hide_instance_windows(inst)
        except Exception:
            log.warning("could not move the window off-screen", exc_info=True)
        _target = await _open(chosen)
        return _target


def _text(payload: Any) -> list[types.TextContent]:
    """A tool result. Strings go out as they are; anything else as JSON
    without the indentation, which costs tokens and tells a model nothing."""
    if not isinstance(payload, str):
        payload = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return [types.TextContent(type="text", text=payload)]


def _clip(text: str, max_chars: int, hint: str) -> str:
    if len(text) <= max_chars:
        return text
    return f"{text[:max_chars]}\n… cut at {max_chars} of {len(text)} chars - {hint}"


SCREENSHOT_KEEP = 50


def _save_screenshot(inst: Instance, png: bytes) -> Path:
    """Write the PNG next to the instance's logs and return its path.

    Saved rather than only returned so a report can cite a file that still
    exists afterwards, and so nothing has to shell out to base64 -d first.
    """
    shots = inst.state_dir / "screenshots"
    shots.mkdir(parents=True, exist_ok=True)
    path = shots / f"{time.strftime('%Y%m%d-%H%M%S')}-{int(time.time() * 1000) % 1000:03d}.png"
    path.write_bytes(png)

    existing = sorted(shots.glob("*.png"))
    for stale in existing[:-SCREENSHOT_KEEP]:
        with contextlib.suppress(OSError):
            stale.unlink()
    return path


# ── Tool catalog ────────────────────────────────────────────────────────────
#
# Descriptions are sent to the model with every session, so they say what a
# caller cannot guess and nothing else.

SELECTOR = "CSS selector, `@e7` ref, or `text=Label`."
READ_ONLY = types.ToolAnnotations(readOnlyHint=True)


def _tool(name: str, description: str, properties: dict | None = None, required: list[str] | None = None,
          annotations: types.ToolAnnotations | None = None) -> types.Tool:
    schema: dict[str, Any] = {"type": "object", "properties": properties or {}, "additionalProperties": False}
    if required:
        schema["required"] = required
    return types.Tool(name=name, description=description, inputSchema=schema, annotations=annotations)


TOOLS = [
    _tool(
        "status",
        "Which Emerald instance this session drives (checkout, ports), whether it is running "
        "and attached, and how a launch in progress is doing.",
        annotations=READ_ONLY,
    ),
    _tool(
        "connect",
        "List the CDP targets (WebViews) of this instance. Only needed to pick one for `attach`; "
        "every other tool attaches to the main window on its own.",
        annotations=READ_ONLY,
    ),
    _tool(
        "attach",
        "Attach to a specific CDP target instead of the main window.",
        {"target_id": {"type": "string", "description": "Target id from `connect`."}},
        ["target_id"],
    ),
    _tool(
        "snapshot",
        "The page as a compact outline: one line per element that is structure or can be acted on, "
        "with its role, name, value and state. Actionable elements carry a ref (`@e7`) that the "
        "other tools accept as selector; refs stay valid until the element leaves the page. "
        "Start here rather than with a screenshot.",
        {
            "selector": {"type": "string", "description": "Only this subtree. " + SELECTOR},
            "interactive": {"type": "boolean", "description": "Only what can be acted on, as a flat list."},
            "classes": {"type": "boolean", "description": "Include CSS classes, for selectors that outlive the session."},
            "max_text": {"type": "integer", "description": "Chars per line (default 100)."},
            "max_chars": {"type": "integer", "description": "Size limit (default 12000)."},
        },
        annotations=READ_ONLY,
    ),
    _tool(
        "click",
        "Click an element with real mouse events. Fails if it is disabled, hidden or covered, "
        "and says by what.",
        {
            "selector": {"type": "string", "description": SELECTOR},
            "button": {"type": "string", "enum": ["left", "right", "middle"], "description": "Default left."},
            "clicks": {"type": "integer", "description": "2 = double click."},
            "force": {"type": "boolean", "description": "Click anyway, with synthetic events."},
        },
        ["selector"],
    ),
    _tool(
        "hover",
        "Move the mouse over an element, for tooltips and hover-only controls.",
        {"selector": {"type": "string", "description": SELECTOR}},
        ["selector"],
    ),
    _tool(
        "type_text",
        "Type into an input, textarea or rich-text editor (contenteditable, Tiptap) through the "
        "keyboard path, and report what the field reads afterwards.",
        {
            "selector": {"type": "string", "description": SELECTOR},
            "text": {"type": "string"},
            "clear": {"type": "boolean", "description": "Default true; false appends."},
        },
        ["selector", "text"],
    ),
    _tool(
        "press_key",
        "Press a key or shortcut: `Enter`, `Escape`, `Tab`, `ArrowDown`, `Control+K`, `Shift+Tab`, `a`.",
        {
            "key": {"type": "string"},
            "selector": {"type": "string", "description": "Focus this first. " + SELECTOR},
        },
        ["key"],
    ),
    _tool(
        "wait_for",
        "Wait until an element reaches a state, instead of sleeping. Reports a timeout as a result, not an error.",
        {
            "selector": {"type": "string", "description": SELECTOR},
            "state": {"type": "string", "enum": ["visible", "attached", "hidden", "detached"], "description": "Default visible."},
            "timeout_ms": {"type": "integer", "description": "Default 5000."},
        },
        ["selector"],
        READ_ONLY,
    ),
    _tool(
        "eval",
        "Run JavaScript in the page, as in a DevTools console: top-level `await` works. Returns the "
        "value of the last expression; DOM nodes come back as outerHTML. Prefer `snapshot` for reading the UI.",
        {
            "expression": {"type": "string"},
            "timeout": {"type": "number", "description": "Seconds (default 30)."},
            "max_chars": {"type": "integer", "description": "Size limit (default 10000)."},
        },
        ["expression"],
    ),
    _tool(
        "console_logs",
        "Console output and uncaught exceptions captured since the last clear, newest last.",
        {
            "level": {"type": "string", "enum": ["all", "info", "warning", "error"], "description": "Least severe level shown (default all)."},
            "limit": {"type": "integer", "description": "Newest N entries (default 50)."},
            "clear": {"type": "boolean", "description": "Empty the buffer afterwards."},
        },
        annotations=READ_ONLY,
    ),
    _tool(
        "screenshot",
        "Capture the window as a PNG you can look at; also saved to disk, so cite the path as evidence.",
        {
            "selector": {"type": "string", "description": "Only this element. " + SELECTOR},
            "scale": {"type": "number", "description": "Shrink or enlarge, e.g. 0.5 (default 1)."},
        },
        annotations=READ_ONLY,
    ),
    _tool(
        "navigate",
        "Load a URL, or reload the page when none is given, and wait until it has finished loading.",
        {"url": {"type": "string", "description": "Omit to reload."}},
    ),
    _tool(
        "dialog",
        "Native dialogs of the app - file pickers, message boxes. They are not part of the page: "
        "`snapshot` and `screenshot` do not show them, and the app waits until they are answered.",
        {
            "action": {
                "type": "string", "enum": ["list", "accept", "cancel", "click"],
                "description": "Default list. accept presses OK/Open/Save; click presses `button`.",
            },
            "path": {"type": "string", "description": "File path for a file picker."},
            "button": {"type": "string", "description": "Button label."},
            "index": {"type": "integer", "description": "Which dialog (default 0, the topmost)."},
        },
    ),
]


# ── Tool handlers ───────────────────────────────────────────────────────────

Result = list[types.TextContent | types.ImageContent]


def _target_summary(t: dict) -> dict:
    return {"id": t.get("id"), "title": t.get("title"), "type": t.get("type"), "url": t.get("url")}


async def _status(_args: dict) -> Result:
    inst = _instance()
    payload: dict[str, Any] = {
        "attached": _target is not None and _target.is_open(),
        "port_alive": await launcher.is_alive(inst.cdp_host, inst.cdp_port),
        "auto_attach": AUTO_ATTACH,
        "auto_launch": AUTO_LAUNCH,
        "instance": inst.to_dict(),
    }
    try:
        payload["window"] = hide_instance_windows(inst)
    except Exception as e:
        payload["window"] = {"error": f"{type(e).__name__}: {e}"}
    if _target is not None:
        payload["target"] = {"id": _target.target_id, "title": _target.title, "url": _target.url}
    else:
        payload["launch"] = launcher.snapshot()
    return _text(payload)


async def _connect(_args: dict) -> Result:
    inst = _instance()
    targets = await discover_targets(inst.cdp_host, inst.cdp_port)
    payload: dict[str, Any] = {"instance": _instance_brief(inst), "targets": [_target_summary(t) for t in targets]}
    # The port can be taken by something that is not a WebView at all. Say so
    # plainly.
    try:
        browser = (await browser_version(inst.cdp_host, inst.cdp_port)).get("Browser", "")
        payload["browser"] = browser
        if not browser.startswith(("Edg/", "Chrome/", "HeadlessChrome/")):
            payload["warning"] = (
                f"port {inst.cdp_port} answers, but does not look like a WebView "
                f"(Browser={browser!r}) - something else may be using it"
            )
    except Exception as e:
        payload["browser"] = f"unavailable ({type(e).__name__})"
    return _text(payload)


async def _attach(args: dict) -> Result:
    global _target
    async with _target_lock:
        inst = _instance()
        targets = await discover_targets(inst.cdp_host, inst.cdp_port)
        chosen = next((t for t in targets if t.get("id") == args["target_id"]), None)
        if not chosen:
            raise RuntimeError(f"target {args['target_id']} not found - `connect` lists the ones there are")
        if _target is not None:
            with contextlib.suppress(Exception):
                await _target.close()
            _target = None
        _target = await _open(chosen)
    return _text(f"attached to {chosen.get('title') or chosen.get('url')} ({chosen['id']})")


async def _snapshot(args: dict) -> Result:
    t = await _ensure_target()
    return _text(await t.snapshot(
        selector=args.get("selector"),
        interactive=bool(args.get("interactive")),
        classes=bool(args.get("classes")),
        max_text=int(args.get("max_text") or 100),
        max_chars=int(args.get("max_chars") or 12000),
    ))


def _ambiguity(report: dict) -> str:
    if "matches" not in report:
        return ""
    return f" - {report['matches']} elements matched, this is the first visible one"


async def _click(args: dict) -> Result:
    t = await _ensure_target()
    clicks = int(args.get("clicks") or 1)
    report = await t.click(
        args["selector"], button=args.get("button") or "left", clicks=clicks, force=bool(args.get("force"))
    )
    how = "" if report["method"] == "mouse" else " (with synthetic events)"
    return _text(f"clicked {report['target']}{how}{_ambiguity(report)}")


async def _hover(args: dict) -> Result:
    t = await _ensure_target()
    report = await t.hover(args["selector"])
    return _text(f"hovering {report['target']}{_ambiguity(report)}")


async def _type_text(args: dict) -> Result:
    t = await _ensure_target()
    report = await t.type_text(args["selector"], args["text"], clear=bool(args.get("clear", True)))
    text = f"typed into {report['target']}; it now reads {json.dumps(report['value'], ensure_ascii=False)}"
    if report["method"] != "keyboard":
        text += " (set through the value setter - the keyboard path did not take)"
    if "note" in report:
        text += f" - {report['note']}"
    return _text(text + _ambiguity(report))


async def _press_key(args: dict) -> Result:
    t = await _ensure_target()
    report = await t.press_key(args["key"], args.get("selector"))
    return _text(f"pressed {report['pressed']}" + (f" in {report['target']}" if "target" in report else ""))


async def _wait_for(args: dict) -> Result:
    t = await _ensure_target()
    state = args.get("state") or "visible"
    timeout_ms = int(args.get("timeout_ms") or 5000)
    if await t.wait_for(args["selector"], timeout_ms, state):
        return _text(f"{args['selector']} is {state}")
    return _text(f"timed out after {timeout_ms} ms: {args['selector']} did not become {state}")


async def _eval(args: dict) -> Result:
    t = await _ensure_target()
    value = await t.eval(args["expression"], timeout=float(args.get("timeout") or 30))
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return _text(_clip(text, int(args.get("max_chars") or 10000), "return less, or raise max_chars"))


_MIN_LEVEL = {"all": "debug", "info": "info", "warning": "warning", "error": "error"}


async def _console_logs(args: dict) -> Result:
    await _ensure_target()  # nothing is captured before the first attach
    level = args.get("level") or "all"
    entries = _console.read(_MIN_LEVEL[level])
    shown = entries[-int(args.get("limit") or 50):]
    if args.get("clear"):
        _console.clear()
    if not entries:
        return _text("no console output" + ("" if level == "all" else f" at level {level} or above"))
    lines = [f"[{e['level']}] {e['text']}" + (f" (x{e['count']})" if e["count"] > 1 else "") for e in shown]
    if len(shown) < len(entries):
        lines.insert(0, f"newest {len(shown)} of {len(entries)}:")
    return _text("\n".join(lines))


async def _screenshot(args: dict) -> Result:
    inst = _instance()
    t = await _ensure_target()
    png = await t.screenshot(selector=args.get("selector"), scale=float(args.get("scale") or 1))
    path = _save_screenshot(inst, png)
    width, height = struct.unpack(">II", png[16:24])
    # ImageContent, not base64 in a text block: as text the caller cannot
    # actually look at it, has to decode it out of band, and pays for ~300 KB
    # of it in the transcript either way.
    return [
        types.ImageContent(type="image", data=base64.b64encode(png).decode("ascii"), mimeType="image/png"),
        types.TextContent(type="text", text=f"{width}x{height}, saved to {path}"),
    ]


async def _navigate(args: dict) -> Result:
    t = await _ensure_target()
    return _text("loaded " + await t.navigate(args.get("url")))


async def _dialog(args: dict) -> Result:
    inst = _instance()
    if not dialogs.IS_WINDOWS:
        raise RuntimeError("native dialogs can only be driven on Windows")
    action = args.get("action") or "list"
    found = await asyncio.to_thread(dialogs.wait_for_dialogs, inst.target_dir)
    if action == "list":
        return _text({"dialogs": [d.to_dict(i) for i, d in enumerate(found)]})
    if not found:
        raise RuntimeError("no native dialog is open for this instance")
    index = int(args.get("index") or 0)
    if not 0 <= index < len(found):
        raise RuntimeError(f"no dialog {index} - {len(found)} open")
    result = await asyncio.to_thread(dialogs.respond, found[index], action, args.get("button"), args.get("path"))
    # A picker that rejected the name, or a follow-up question ("replace the
    # existing file?"), is what is open now.
    remaining = await asyncio.to_thread(dialogs.find_dialogs, inst.target_dir)
    result["dialogs"] = [d.to_dict(i) for i, d in enumerate(remaining)]
    return _text(result)


HANDLERS: dict[str, Callable[[dict], Awaitable[Result]]] = {
    "status": _status,
    "connect": _connect,
    "attach": _attach,
    "snapshot": _snapshot,
    "click": _click,
    "hover": _hover,
    "type_text": _type_text,
    "press_key": _press_key,
    "wait_for": _wait_for,
    "eval": _eval,
    "console_logs": _console_logs,
    "screenshot": _screenshot,
    "navigate": _navigate,
    "dialog": _dialog,
}

@app.list_tools()
async def list_tools() -> list[types.Tool]:
    return TOOLS


@app.call_tool()
async def call_tool(name: str, arguments: dict) -> Result:
    handler = HANDLERS.get(name)
    if handler is None:
        raise ValueError(f"unknown tool: {name}")
    try:
        return await handler(arguments or {})
    except Exception as e:
        # Raised, not returned as text: the SDK turns it into a result with
        # isError set, which is how a client tells a failure from an answer.
        log.warning("%s failed: %s: %s", name, type(e).__name__, e)
        if isinstance(e, (CDPError, RuntimeError, ValueError)):
            raise
        raise RuntimeError(f"{type(e).__name__}: {e}") from e


async def main() -> None:
    if INSTANCE is None:
        log.error("starting emerald-devtools MCP with no resolved instance: %s", INSTANCE_ERROR)
    else:
        log.info(
            "starting emerald-devtools MCP (port=%s vite=%s checkout=%s via %s)",
            INSTANCE.cdp_port, INSTANCE.vite_port,
            INSTANCE.checkout, INSTANCE.checkout_source,
        )
        for warning in INSTANCE.warnings:
            log.warning("%s", warning)
    async with mcp.server.stdio.stdio_server() as (r, w):
        await app.run(r, w, app.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
