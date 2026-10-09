"""cdp.py and pagelib.js against the fixture page."""

import struct

import pytest

from cdp import CDPError, ConsoleBuffer, parse_key
from conftest import page_log


# -- snapshot -----------------------------------------------------------------

async def test_snapshot_is_an_outline_without_wrappers(target):
    snap = await target.snapshot()
    lines = snap.splitlines()
    assert lines[0].endswith("| emcp fixture")
    assert '- nav "Sections"' in lines
    # Two anonymous divs sit between the nav and this row.
    assert '  - span#row1 "First row" @e' in snap
    assert '  - h1 "Entries"' in lines
    assert '  - p "Some plain text that is not interactive."' in lines
    assert "Ghost" not in snap, "hidden elements are left out"


async def test_snapshot_names_values_and_states(target):
    snap = await target.snapshot()
    assert 'button "Journal" icon=book-open @e' in snap, "an icon button is named by its title and icon"
    assert 'textbox#title "Title" = "old" @e' in snap, "a field is named by its label"
    assert 'button#off "Off" [disabled] @e' in snap
    assert 'combobox#lang = "DE" @e' in snap
    assert 'textbox#editor = "hello" @e' in snap, "a contenteditable is a textbox"
    assert "secret" not in snap, "a password is never echoed"


async def test_snapshot_options(target):
    flat = await target.snapshot(interactive=True)
    assert all(line.startswith("- ") and " @e" in line for line in flat.splitlines()[1:])
    assert "Entries" not in flat

    scoped = await target.snapshot(selector="nav")
    assert "row1" in scoped and "Entries" not in scoped

    assert "button#save.btn-primary" in await target.snapshot(classes=True)

    cut = await target.snapshot(max_chars=200)
    assert "more lines cut at 200 chars" in cut.splitlines()[-1]


async def test_refs_are_stable_and_usable(target):
    def ref_of(snap: str, needle: str) -> str:
        line = next(line for line in snap.splitlines() if needle in line)
        return "@" + line.rsplit("@", 1)[1].split()[0]

    first = ref_of(await target.snapshot(), "button#save")
    assert ref_of(await target.snapshot(), "button#save") == first, "the same element keeps its ref"

    await target.click(first)
    assert "save:click" in await page_log(target)

    await target.eval("document.getElementById('save').remove()")
    with pytest.raises(CDPError, match="take a new snapshot"):
        await target.click(first)


# -- click --------------------------------------------------------------------

async def test_click_is_a_real_press(target):
    report = await target.click("#save")
    assert report == {"target": report["target"], "method": "mouse"}
    assert report["target"].startswith('button#save "Save"')
    # isTrusted is what separates a user's press from el.click().
    assert "save:enter;save:down:true;save:click;" in await page_log(target)


async def test_click_variants(target):
    await target.click("text=First row", button="right")
    assert "row1:menu" in await page_log(target)

    report = await target.click(".row", clicks=2)
    assert report["matches"] == 2, "an ambiguous selector says so"
    assert "row1:dbl" in await page_log(target)

    await target.click("#far")
    assert "far:click" in await page_log(target), "an element below the fold is scrolled to first"


async def test_click_by_text_spread_over_nodes(target):
    await target.click("text=Second row")
    assert "row2:click" in await page_log(target)


async def test_click_refuses_what_a_user_could_not_click(target):
    with pytest.raises(CDPError, match="is disabled"):
        await target.click("#off")
    with pytest.raises(CDPError, match="is not visible"):
        await target.click("#ghost")
    with pytest.raises(CDPError, match='nothing matches "#nope"'):
        await target.click("#nope")
    with pytest.raises(CDPError, match="not a valid selector"):
        await target.click("div[")

    await target.eval("document.getElementById('cover').style.display = 'block'")
    with pytest.raises(CDPError, match="is covered by div#cover"):
        await target.click("#save")
    assert "save:click" not in await page_log(target)

    report = await target.click("#save", force=True)
    assert report["method"] == "synthetic"
    assert "save:click" in await page_log(target)


async def test_hover(target):
    await target.hover("#del")
    assert "del:enter" in await page_log(target)


# -- typing -------------------------------------------------------------------

async def test_type_into_input_replaces_and_appends(target):
    report = await target.type_text("#title", "Hallo Welt")
    assert report["value"] == "Hallo Welt" and report["method"] == "keyboard"
    assert "title:input:Hallo Welt;" in await page_log(target), "the app's own input handler ran"

    report = await target.type_text("#title", " more", clear=False)
    assert report["value"] == "Hallo Welt more"

    report = await target.type_text("#title", "")
    assert await target.eval("document.getElementById('title').value") == ""


async def test_type_into_textarea_and_editor(target):
    await target.type_text("#notes", "line1\nline2")
    assert await target.eval("document.getElementById('notes').value") == "line1\nline2"

    report = await target.type_text("#editor", "typed in editor")
    assert report["value"] == "typed in editor"


async def test_type_refuses_what_is_not_a_field(target):
    with pytest.raises(CDPError, match="not something text can be typed into"):
        await target.type_text("h1", "x")


async def test_press_key(target):
    await target.press_key("Enter", "#title")
    await target.press_key("Control+Shift+K")
    assert "key:Enter;key:C-S-K;" in await page_log(target)

    await target.press_key("Control+a", "#title")
    assert await target.eval("getSelection().toString()") == "old", "Ctrl+A really selects"


def test_parse_key():
    assert parse_key("Esc")["key"] == "Escape"
    assert parse_key("a")["text"] == "a"
    assert parse_key("Shift+a")["key"] == "A"
    assert "text" not in parse_key("Control+k"), "a shortcut types nothing"
    assert parse_key("Control++")["key"] == "+"
    with pytest.raises(CDPError, match="unknown key"):
        parse_key("Bogus")
    with pytest.raises(CDPError, match="unknown modifier"):
        parse_key("Hyper+a")


# -- eval ---------------------------------------------------------------------

@pytest.mark.parametrize("expression, expected", [
    ("await Promise.resolve(41 + 1)", 42),
    ("({ a: [1, 2] })", {"a": [1, 2]}),
    ("undefined", "undefined"),
    ("null", None),
    ("1 / 0", "Infinity"),
    ("document.querySelector('#save')", '<button id="save" class="btn-primary">Save</button>'),
    ("[...document.querySelectorAll('li')].length", 2),
    ("new Map([['a', 1]])", {"a": 1}),
])
async def test_eval_values(target, expression, expected):
    assert await target.eval(expression) == expected


async def test_eval_behaves_like_a_console(target):
    assert await target.eval("const x = 1; x") == 1
    assert await target.eval("const x = 2; x") == 2, "redeclaring a const is allowed, as in DevTools"
    with pytest.raises(CDPError, match="ReferenceError: nope is not defined"):
        await target.eval("nope()")
    assert await target.eval("window") == "Window", "what JSON cannot carry comes back as a description"


# -- waiting ------------------------------------------------------------------

async def test_wait_for_states(target):
    assert await target.wait_for("#save", 300)
    assert not await target.wait_for("#ghost", 300), "hidden is not visible"
    assert await target.wait_for("#ghost", 300, "attached")
    assert await target.wait_for("#ghost", 300, "hidden")
    assert await target.wait_for("#nope", 300, "detached")
    assert await target.wait_for("text=Entries", 300)
    with pytest.raises(CDPError, match="unknown state"):
        await target.wait_for("#save", 300, "present")


async def test_wait_for_sees_a_later_change(target):
    await target.eval("setTimeout(() => document.getElementById('ghost').classList.remove('hidden'), 200)")
    assert await target.wait_for("#ghost", 3000)


# -- console ------------------------------------------------------------------

async def test_console_capture(target):
    await target.eval(
        "console.log('hi', { a: 1 }, 3); console.error('bad'); console.error('bad');"
        "setTimeout(() => { throw new Error('boom'); }, 0)"
    )
    await target.wait_for("#save", 300)  # a round trip, so the events have arrived
    entries = list(target.console.entries)
    assert {"level": "info", "text": "hi {a: 1} 3", "count": 1} in entries
    assert {"level": "error", "text": "bad", "count": 2} in entries, "repeats are counted, not repeated"
    assert any(e["text"].startswith("Uncaught Error: boom") for e in entries)
    assert all(e["level"] == "error" for e in target.console.read("error"))


def test_console_buffer_is_bounded():
    buffer = ConsoleBuffer(keep=3)
    for n in range(10):
        buffer.add("info", f"line {n}")
    assert [e["text"] for e in buffer.entries] == ["line 7", "line 8", "line 9"]
    buffer.add("info", "x" * 5000)
    assert len(buffer.entries[-1]["text"]) < 2100


# -- screenshot and navigation ------------------------------------------------

def _size(png: bytes) -> tuple[int, int]:
    return struct.unpack(">II", png[16:24])


async def test_screenshot(target):
    full = _size(await target.screenshot())
    assert full[0] > 500
    half = _size(await target.screenshot(scale=0.5))
    assert abs(half[0] * 2 - full[0]) <= 20  # the clip leaves the scrollbar out
    button = _size(await target.screenshot(selector="#save"))
    assert button[0] < 100 and button[1] < 60


async def test_reload_resets_the_page(target):
    await target.type_text("#title", "changed")
    href = await target.navigate()
    assert href.endswith("page.html")
    assert await target.eval("document.getElementById('title').value") == "old"


async def test_a_dropped_connection_fails_at_once(target):
    await target._ws.close()
    with pytest.raises(CDPError, match="not connected"):
        await target.eval("1")
