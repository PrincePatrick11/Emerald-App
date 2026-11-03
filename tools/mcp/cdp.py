"""CDP (Chrome DevTools Protocol) client for Tauri WebView2 / Wry.

Talks to a Chromium-based WebView via the Chrome DevTools Protocol over
WebSocket: run JS, read the page as a compact outline, press and type with
real input events, capture console output and screenshots.

Everything that has to look at the DOM lives in pagelib.js and is sent along
with each call (see `CDPTarget.page`). The only thing kept in the page between
calls is the table of element refs a snapshot hands out.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import logging
from collections import deque
from pathlib import Path
from typing import Any

import aiohttp

log = logging.getLogger("emerald-cdp")

PAGE_LIB = Path(__file__).with_name("pagelib.js").read_text(encoding="utf-8")

CONSOLE_KEEP = 500
CONSOLE_ENTRY_MAX = 2000

# Chromium's own names for the levels, most to least severe.
LEVELS = ("error", "warning", "info", "debug")
_CONSOLE_LEVEL = {"error": "error", "assert": "error", "warning": "warning", "debug": "debug"}
_LOG_LEVEL = {"error": "error", "warning": "warning", "verbose": "debug"}

_MOUSE_BUTTONS = {"left": 1, "right": 2, "middle": 4}

# key name -> (DOM key, DOM code, Windows virtual key, text it types)
_KEYS: dict[str, tuple[str, str, int, str]] = {
    "enter": ("Enter", "Enter", 13, "\r"),
    "tab": ("Tab", "Tab", 9, ""),
    "escape": ("Escape", "Escape", 27, ""),
    "backspace": ("Backspace", "Backspace", 8, ""),
    "delete": ("Delete", "Delete", 46, ""),
    "space": (" ", "Space", 32, " "),
    "arrowleft": ("ArrowLeft", "ArrowLeft", 37, ""),
    "arrowup": ("ArrowUp", "ArrowUp", 38, ""),
    "arrowright": ("ArrowRight", "ArrowRight", 39, ""),
    "arrowdown": ("ArrowDown", "ArrowDown", 40, ""),
    "home": ("Home", "Home", 36, ""),
    "end": ("End", "End", 35, ""),
    "pageup": ("PageUp", "PageUp", 33, ""),
    "pagedown": ("PageDown", "PageDown", 34, ""),
    **{f"f{n}": (f"F{n}", f"F{n}", 111 + n, "") for n in range(1, 13)},
}
_KEY_ALIASES = {
    "esc": "escape", "return": "enter", "del": "delete", "left": "arrowleft", "up": "arrowup",
    "right": "arrowright", "down": "arrowdown", " ": "space",
}
_MODIFIERS = {"alt": 1, "ctrl": 2, "control": 2, "meta": 4, "cmd": 4, "shift": 8}
# Chromium does not run an editing shortcut just because the key event says
# Ctrl+A - the command has to be named.
_EDIT_COMMANDS = {"a": "selectAll", "c": "copy", "v": "paste", "x": "cut", "z": "undo", "y": "redo"}


class CDPError(RuntimeError):
    pass


class ConsoleBuffer:
    """Console output, kept apart from the target so it outlives a reattach -
    the errors from just before the WebView was replaced are usually the ones
    that matter."""

    def __init__(self, keep: int = CONSOLE_KEEP):
        self.entries: deque[dict[str, Any]] = deque(maxlen=keep)

    def add(self, level: str, text: str) -> None:
        if len(text) > CONSOLE_ENTRY_MAX:
            text = text[:CONSOLE_ENTRY_MAX] + f"… (+{len(text) - CONSOLE_ENTRY_MAX} chars)"
        last = self.entries[-1] if self.entries else None
        if last and last["level"] == level and last["text"] == text:
            last["count"] += 1
            return
        self.entries.append({"level": level, "text": text, "count": 1})

    def read(self, min_level: str = "debug") -> list[dict[str, Any]]:
        wanted = LEVELS[: LEVELS.index(min_level) + 1]
        return [e for e in self.entries if e["level"] in wanted]

    def clear(self) -> None:
        self.entries.clear()


def _console_arg(arg: dict) -> str:
    """One console.log argument as text. Objects arrive as a preview rather
    than a value; without it they would all read 'Object'."""
    if arg.get("type") == "string":
        return str(arg.get("value"))
    if "value" in arg:
        return json.dumps(arg["value"], ensure_ascii=False)
    preview = arg.get("preview")
    if preview and preview.get("properties") is not None:
        parts = [
            p["value"] if preview.get("subtype") == "array" else f"{p['name']}: {p.get('value', '')}"
            for p in preview["properties"]
        ]
        if preview.get("overflow"):
            parts.append("…")
        open_, close = ("[", "]") if preview.get("subtype") == "array" else ("{", "}")
        return open_ + ", ".join(parts) + close
    return str(arg.get("description") or arg.get("unserializableValue") or arg.get("type"))


def _exception_text(details: dict) -> str:
    exception = details.get("exception", {})
    described = exception.get("description")
    if described:
        return described.splitlines()[0]
    if "value" in exception:
        return f"{details.get('text', 'Uncaught')} {exception['value']}"
    return details.get("text") or "unknown exception"


def parse_key(combo: str) -> dict:
    """'Enter', 'Control+Shift+K', 'a' -> the fields Input.dispatchKeyEvent wants."""
    parts = [p for p in combo.split("+") if p] if combo != "+" else ["+"]
    if combo.endswith("++"):
        parts.append("+")
    if not parts:
        raise CDPError("no key given")
    modifiers = 0
    for name in parts[:-1]:
        try:
            modifiers |= _MODIFIERS[name.lower()]
        except KeyError:
            raise CDPError(f"unknown modifier {name!r} - use Control, Shift, Alt or Meta") from None

    raw = parts[-1]
    name = _KEY_ALIASES.get(raw.lower(), raw.lower())
    if name in _KEYS:
        key, code, vk, text = _KEYS[name]
    elif len(raw) == 1:
        key = raw.upper() if modifiers & _MODIFIERS["shift"] else raw
        text = key
        if raw.isalpha() and raw.isascii():
            code, vk = "Key" + raw.upper(), ord(raw.upper())
        elif raw.isdigit():
            code, vk = "Digit" + raw, ord(raw)
        else:
            code, vk = "", 0
    else:
        raise CDPError(f"unknown key {raw!r} - a single character, or one of: " + ", ".join(sorted(_KEYS)))

    # A key held with Ctrl, Alt or Meta is a shortcut, not a character.
    shortcut = bool(modifiers & ~_MODIFIERS["shift"])
    fields: dict[str, Any] = {
        "key": key, "code": code, "modifiers": modifiers,
        "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk,
    }
    if text and not shortcut:
        fields["text"] = text
    if modifiers == _MODIFIERS["ctrl"] and raw.lower() in _EDIT_COMMANDS:
        fields["commands"] = [_EDIT_COMMANDS[raw.lower()]]
    return fields


class CDPTarget:
    """A single CDP-attached target (one WebView page)."""

    def __init__(self, ws_url: str, target_id: str, title: str, url: str, console: ConsoleBuffer | None = None):
        self.ws_url = ws_url
        self.target_id = target_id
        self.title = title
        self.url = url
        self.console = console if console is not None else ConsoleBuffer()
        self._ws: aiohttp.ClientWebSocketResponse | None = None
        self._session: aiohttp.ClientSession | None = None
        self._id = 0
        self._inflight: dict[int, asyncio.Future] = {}
        self._reader_task: asyncio.Task | None = None

    async def connect(self) -> None:
        self._session = aiohttp.ClientSession()
        self._ws = await self._session.ws_connect(self.ws_url, autoclose=False, max_msg_size=64 * 1024 * 1024)
        self._reader_task = asyncio.create_task(self._reader())
        # Only the domains something here listens to: Network alone would send
        # an event for every request the app makes, to be parsed and dropped.
        # A target that rejects one (an internal about:blank page) is fine.
        for method, params in [
            ("Runtime.enable", {}),
            ("Page.enable", {}),
            ("Log.enable", {}),
            # The window is out of sight (off-screen on Windows) and never has
            # the OS focus; without this the page behaves as a background tab
            # and typed text goes nowhere.
            ("Emulation.setFocusEmulationEnabled", {"enabled": True}),
        ]:
            with contextlib.suppress(CDPError):
                await self.send(method, params)

    def is_open(self) -> bool:
        """Whether the socket is still usable. A WebView that went away leaves
        the target object behind with a closed socket; without this check the
        next call fails with 'Cannot write to closing transport' instead of
        reattaching."""
        return self._ws is not None and not self._ws.closed

    async def close(self) -> None:
        if self._reader_task:
            self._reader_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._reader_task
        if self._ws:
            with contextlib.suppress(Exception):
                await self._ws.close()
        if self._session:
            await self._session.close()

    async def _reader(self) -> None:
        assert self._ws is not None
        try:
            async for msg in self._ws:
                if msg.type != aiohttp.WSMsgType.TEXT:
                    continue
                try:
                    data = json.loads(msg.data)
                except json.JSONDecodeError:
                    continue
                if "id" in data:
                    fut = self._inflight.pop(data["id"], None)
                    if fut and not fut.done():
                        if "error" in data:
                            err = data["error"]
                            fut.set_exception(CDPError(f"{err.get('code')}: {err.get('message')}"))
                        else:
                            fut.set_result(data.get("result", {}))
                elif "method" in data:
                    self._on_event(data)
        except Exception as e:
            log.warning("CDP reader ended: %s", e)
        finally:
            # Whoever is still waiting would otherwise sit out the full
            # timeout for an answer that cannot come any more.
            for fut in self._inflight.values():
                if not fut.done():
                    fut.set_exception(CDPError("the WebView closed the connection"))
            self._inflight.clear()

    def _on_event(self, data: dict) -> None:
        method = data.get("method", "")
        params = data.get("params", {})
        if method == "Runtime.consoleAPICalled":
            kind = params.get("type", "log")
            text = " ".join(_console_arg(a) for a in params.get("args", []))
            self.console.add(_CONSOLE_LEVEL.get(kind, "info"), text)
        elif method == "Runtime.exceptionThrown":
            details = params.get("exceptionDetails", {})
            where = f" ({details['url']}:{details.get('lineNumber', 0) + 1})" if details.get("url") else ""
            self.console.add("error", "Uncaught " + _exception_text(details) + where)
        elif method == "Log.entryAdded":
            entry = params.get("entry", {})
            where = f" ({entry['url']})" if entry.get("url") else ""
            self.console.add(_LOG_LEVEL.get(entry.get("level"), "info"), str(entry.get("text")) + where)

    async def send(self, method: str, params: dict | None = None, timeout: float = 30) -> dict:
        if not self.is_open():
            raise CDPError("not connected to the WebView")
        self._id += 1
        msg_id = self._id
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self._inflight[msg_id] = fut
        try:
            await self._ws.send_json({"id": msg_id, "method": method, "params": params or {}})
            return await asyncio.wait_for(fut, timeout=timeout)
        except asyncio.TimeoutError:
            raise CDPError(f"timeout after {timeout:g}s waiting for {method}") from None
        finally:
            self._inflight.pop(msg_id, None)

    # ── Running JS ────────────────────────────────────────────────────────

    async def _evaluate(self, expr: str, timeout: float, **params: Any) -> dict:
        result = await self.send(
            "Runtime.evaluate",
            {"expression": expr, "awaitPromise": True, "userGesture": True, **params},
            timeout=timeout,
        )
        if "exceptionDetails" in result:
            raise CDPError("JS: " + _exception_text(result["exceptionDetails"]))
        return result.get("result", {})

    async def page(self, function: str, *args: Any, timeout: float = 30) -> Any:
        """Call one of pagelib.js's functions in the page and return its value."""
        call = f"api.{function}({', '.join(json.dumps(a) for a in args)})"
        try:
            remote = await self._evaluate(
                "(() => {\n" + PAGE_LIB + "\nreturn " + call + ";\n})()", timeout, returnByValue=True
            )
        except CDPError as e:
            # pagelib's own errors are already sentences; the prefix that
            # marks a caller's JS as having thrown would only obscure them.
            raise CDPError(str(e).removeprefix("JS: ").removeprefix("Error: ")) from None
        return remote.get("value")

    async def eval(self, expr: str, timeout: float = 30) -> Any:
        """Evaluate JS the way a DevTools console would: top-level `await`
        works, and a `const` can be declared again on the next call. Returns
        the value as JSON-compatible data; `undefined` comes back as the
        string 'undefined', DOM nodes as their outerHTML."""
        remote = await self._evaluate(expr, timeout, replMode=True, objectGroup="emcp-eval")
        try:
            if "objectId" not in remote:
                if remote.get("type") == "undefined":
                    return STATEMENTS_NO_VALUE if remote.get("statements") else "undefined"
                return remote.get("value", remote.get("unserializableValue"))
            try:
                converted = await self.send(
                    "Runtime.callFunctionOn",
                    {
                        "objectId": remote["objectId"],
                        "functionDeclaration": "function() {\n" + PAGE_LIB + "\nreturn api.plain(this);\n}",
                        "returnByValue": True,
                    },
                    timeout=timeout,
                )
            except CDPError:
                converted = {}
            if "result" in converted and "exceptionDetails" not in converted:
                return converted["result"].get("value")
            # Cyclic, or otherwise not something JSON can carry.
            return remote.get("description", remote.get("type"))
        finally:
            with contextlib.suppress(CDPError):
                await self.send("Runtime.releaseObjectGroup", {"objectGroup": "emcp-eval"})

    # ── Reading the page ──────────────────────────────────────────────────

    async def snapshot(
        self,
        selector: str | None = None,
        interactive: bool = False,
        classes: bool = False,
        max_depth: int = 30,
        max_text: int = 100,
        max_chars: int = 12000,
    ) -> str:
        """The page as an indented outline: one line per element that is
        structure or can be acted on, the wrappers in between left out. What
        can be acted on carries a ref (`@e7`) that every selector argument
        accepts."""
        return await self.page("snapshot", {
            "selector": selector, "interactive": interactive, "classes": classes,
            "maxDepth": max_depth, "maxText": max_text, "maxChars": max_chars,
        })

    async def wait_for(self, selector: str, timeout_ms: int = 5000, state: str = "visible") -> bool:
        """Wait until `selector` is visible / attached / hidden / detached.

        Polled from here rather than waited on inside the page: a timer in a
        window Chromium considers in the background can be throttled to once
        a second, and this must not be."""
        if state not in ("visible", "attached", "hidden", "detached"):
            raise CDPError(f"unknown state {state!r} - visible, attached, hidden or detached")
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout_ms / 1000
        while True:
            try:
                now = await self.page("stateOf", selector)
            except CDPError as e:
                # Mid-navigation there is no page to ask; an invalid selector
                # will not get better by waiting.
                if "selector" in str(e) or "text=" in str(e):
                    raise
                now = "detached"
            if (
                now == state
                or (state == "attached" and now != "detached")
                or (state == "hidden" and now == "detached")
            ):
                return True
            if loop.time() >= deadline:
                return False
            await asyncio.sleep(0.1)

    async def screenshot(self, selector: str | None = None, scale: float = 1.0) -> bytes:
        params: dict[str, Any] = {"format": "png", "captureBeyondViewport": False}
        if selector:
            rect = await self.page("rectOf", selector)
            params["clip"] = {k: rect[k] for k in ("x", "y", "width", "height")} | {"scale": scale}
            params["captureBeyondViewport"] = True
        elif scale != 1.0:
            metrics = await self.send("Page.getLayoutMetrics")
            view = metrics.get("cssVisualViewport") or metrics["visualViewport"]
            params["clip"] = {
                "x": view.get("pageX", 0), "y": view.get("pageY", 0),
                "width": view["clientWidth"], "height": view["clientHeight"], "scale": scale,
            }
        result = await self.send("Page.captureScreenshot", params)
        data = result.get("data")
        if not data:
            raise CDPError("no screenshot data returned")
        return base64.b64decode(data)

    # ── Acting on the page ────────────────────────────────────────────────

    async def _mouse(self, kind: str, x: float, y: float, button: str = "none", clicks: int = 0,
                     viewport_height: float | None = None) -> None:
        params = {
            "type": kind, "x": x, "y": y, "button": button,
            "buttons": _MOUSE_BUTTONS.get(button, 0) if kind == "mousePressed" else 0,
            "clickCount": clicks,
        }
        # Read by the macOS dev bridge only (see devbridge.rs, send_mouse);
        # WebView2's DevTools ignores parameters it doesn't know.
        if viewport_height:
            params["viewportHeight"] = viewport_height
        await self.send("Input.dispatchMouseEvent", params)

    async def click(self, selector: str, button: str = "left", clicks: int = 1, force: bool = False) -> dict:
        """Press the mouse on an element, as a user would: moved there, pressed
        and released, so hover states, mousedown handlers and context menus
        all see it. Refuses an element that is disabled or covered rather
        than clicking through to whatever is on top.

        Falls back to events dispatched at the element when a real press has
        no way to reach it, or when the page never saw it arrive."""
        if button not in _MOUSE_BUTTONS:
            raise CDPError(f"unknown button {button!r} - left, right or middle")
        probe = "contextmenu" if button == "right" else "mousedown"
        aim = await self.page("aim", selector, force, probe)
        arrived = False
        if aim["real"]:
            vh = aim.get("vh")
            await self._mouse("mouseMoved", aim["x"], aim["y"], viewport_height=vh)
            for n in range(1, clicks + 1):
                await self._mouse("mousePressed", aim["x"], aim["y"], button, n, vh)
                await self._mouse("mouseReleased", aim["x"], aim["y"], button, n, vh)
            arrived = await self.page("landed")
        if not arrived:
            await self.page("synthetic", button, clicks)
        return _report(aim, method="mouse" if arrived else "synthetic")

    async def hover(self, selector: str) -> dict:
        aim = await self.page("aim", selector, True, None)
        await self._mouse("mouseMoved", aim["x"], aim["y"], viewport_height=aim.get("vh"))
        report = _report(aim)
        # A real move can take a moment to reach the styles. Only a clear "no"
        # is worth saying: the move itself is done.
        for pause in (0.0, 0.1):
            await asyncio.sleep(pause)
            try:
                state = await self.page("hovered", selector)
            except CDPError:
                return report
            if state is not False:
                return report
        report["note"] = "CSS :hover is not active on the element, so hover styles do not show"
        return report

    async def type_text(self, selector: str, text: str, clear: bool = True) -> dict:
        """Type into an input, a textarea or a contenteditable editor through
        the keyboard path, so the app's own input handling runs - which is
        what makes it work for Tiptap as well as for React-controlled fields.
        The result is read back, and a plain field that did not take the text
        is written through the value setter instead."""
        field = await self.page("focusForTyping", selector, clear)
        if text:
            await self.send("Input.insertText", {"text": text})
        typed = await self.page("confirmTyped", text, field["before"])
        if not typed["ok"] and typed["field"]:
            raise CDPError(f"typed into {field['target']}, but it now reads {typed['value']!r}")
        report = _report(field, method=typed["method"])
        report["value"] = typed["value"]
        if not typed["ok"]:
            # An editor may legitimately rewrite what it is given ("# " turns
            # into a heading), so this is reported rather than raised.
            report["note"] = "the editor's text differs from what was typed - check the value"
        return report

    async def press_key(self, key: str, selector: str | None = None) -> dict:
        fields = parse_key(key)
        report = {"pressed": key}
        if selector:
            report["target"] = await self.page("focus", selector)
        await self.send("Input.dispatchKeyEvent", {"type": "keyDown" if "text" in fields else "rawKeyDown", **fields})
        await self.send("Input.dispatchKeyEvent", {"type": "keyUp", **{k: v for k, v in fields.items() if k not in ("text", "commands")}})
        return report

    async def navigate(self, url: str | None = None, timeout: float = 15) -> str:
        """Load `url`, or reload the current page, and wait for it to finish."""
        if url:
            result = await self.send("Page.navigate", {"url": url})
            if result.get("errorText"):
                raise CDPError(f"could not load {url}: {result['errorText']}")
        else:
            await self.send("Page.reload")
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        while loop.time() < deadline:
            # The old document's context is torn down mid-load; asking it
            # fails until the new one is there.
            with contextlib.suppress(CDPError):
                state = await self._evaluate("document.readyState + ' ' + location.href", 5, returnByValue=True)
                ready, _, href = str(state.get("value", "")).partition(" ")
                if ready == "complete":
                    self.url = href
                    return href
            await asyncio.sleep(0.1)
        raise CDPError(f"the page did not finish loading within {timeout:g}s")


# Only the dev bridge marks this: a DevTools console gives a statement list the
# value of its last expression.
STATEMENTS_NO_VALUE = (
    "undefined - the statements ran, but through the dev bridge only a single expression "
    "has a value. To get one, wrap them: (async () => { ...; return value; })()"
)


def _report(found: dict, **extra: Any) -> dict:
    """What an action hit. `matches` only appears when the selector was
    ambiguous, which is the case worth a second look."""
    report = {"target": found["target"], **extra}
    if found.get("count", 1) > 1:
        report["matches"] = found["count"]
    return report


async def discover_targets(host: str = "127.0.0.1", port: int = 9222, timeout_sec: float = 5.0) -> list[dict]:
    """Hit /json and return the list of available CDP targets.

    `timeout_sec` is short for liveness polling, where this runs on every tool
    call and a dead port should be reported at once rather than waited on.
    """
    timeout = aiohttp.ClientTimeout(total=timeout_sec)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(f"http://{host}:{port}/json") as resp:
            resp.raise_for_status()
            data = await resp.json()
    # Each entry: { id, title, type, url, webSocketDebuggerUrl, ... }
    return data


async def browser_version(host: str = "127.0.0.1", port: int = 9222, timeout_sec: float = 2.0) -> dict:
    """/json/version. Worth asking before trusting a port: it can be occupied
    by something else entirely, and 'Browser' says at a glance whether this
    is really a WebView."""
    timeout = aiohttp.ClientTimeout(total=timeout_sec)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(f"http://{host}:{port}/json/version") as resp:
            resp.raise_for_status()
            return await resp.json()
