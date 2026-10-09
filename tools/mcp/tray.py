"""System tray app for the Emerald MCP slots.

It exists for one reason beyond convenience: without something running all the
time, the idle timeout is not enforced. The reaper otherwise only runs inside
the launcher script, so an instance nobody uses stays up until the next time
some *other* instance happens to start. This app is the missing clock.

It also shows what the registry only records: which worktree holds which slot,
how long each has been idle, and which are actually running. Slots can be
stopped by hand from here, and the timeout is edited here rather than through
an environment variable, so a change reaches servers that started earlier.

And it starts things, none of them with a console on screen: an MCP instance
for the main checkout or any of its worktrees, without a Claude session having
to ask for it first, and the regular dev session (`npm run tauri:dev`), whose
output goes to a log file instead of a terminal window.

  pythonw tray.py       (no console window)
  python  tray.py       (with a console, for watching the log)
"""

from __future__ import annotations

import logging
import os
import sys
import threading
import time
import tkinter as tk
from pathlib import Path
from tkinter import colorchooser, messagebox, ttk

import pystray
from PIL import Image, ImageDraw

import devsession
import instance
import launcher
import window as winctl

def _configure_logging() -> None:
    """Log to a file as well as stderr.

    Under pythonw there is no stderr at all, so a reaper that started failing
    would do so in complete silence - which for a background app is the same
    as not noticing for weeks.
    """
    handlers: list[logging.Handler] = []
    try:
        from logging.handlers import RotatingFileHandler

        path = instance.mcp_home() / "tray.log"
        path.parent.mkdir(parents=True, exist_ok=True)
        handlers.append(RotatingFileHandler(path, maxBytes=512_000, backupCount=2, encoding="utf-8"))
    except OSError:
        pass  # a missing log file must not stop the app from running
    if sys.stderr is not None:
        handlers.append(logging.StreamHandler(sys.stderr))
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
        handlers=handlers,
    )


_configure_logging()
log = logging.getLogger("emerald-tray")

# Not "Emerald MCP": that is also slot 0's app window title, and a second
# launch surfacing "the existing window" would then find the app instead.
TRAY_TITLE = "Emerald MCP Slots"

_ERROR_ALREADY_EXISTS = 183
_single_instance_handle = None  # module-level: the mutex lives as long as we do


def _instance_tag() -> str:
    """Identifies this state directory in the names of kernel objects, so two
    separate setups never share a mutex or an event."""
    import hashlib

    return hashlib.sha1(str(instance.mcp_home()).lower().encode("utf-8")).hexdigest()[:16]


def claim_single_instance() -> bool:
    """True if we are the only tray app for this state directory.

    A named mutex rather than a lock file: Windows drops it the moment the
    process ends, however it ends, so there is no stale lock to reason about
    after a crash. The name includes the state directory, so two genuinely
    separate setups can each have their own tray - it is the accidental second
    copy of the *same* one that causes confusion, with two clocks reaping the
    same slots and two windows disagreeing about what is running.
    """
    global _single_instance_handle
    if sys.platform != "win32":
        return True
    import ctypes

    tag = _instance_tag()
    handle = ctypes.windll.kernel32.CreateMutexW(None, False, f"Local\\EmeraldMcpTray-{tag}")
    if not handle:
        return True  # cannot tell; better to run than to refuse for no reason
    if ctypes.windll.kernel32.GetLastError() == _ERROR_ALREADY_EXISTS:
        return False
    _single_instance_handle = handle
    return True


_EVENT_MODIFY_STATE = 0x0002
_WAIT_OBJECT_0 = 0


def _show_event_name() -> str:
    return f"Local\\EmeraldMcpTray-show-{_instance_tag()}"


def signal_existing_instance() -> bool:
    """Ask the tray app that is already running to open its window.

    A second launch with --show should do what was asked for, and only the
    running instance can do it properly: its window is withdrawn, and if
    another process forced it visible, Tk would not know it had been shown
    and would never refresh it. A named event carries the request instead.
    """
    if sys.platform != "win32":
        return False
    import ctypes

    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenEventW(_EVENT_MODIFY_STATE, False, _show_event_name())
    if not handle:
        return False
    try:
        return bool(kernel32.SetEvent(handle))
    finally:
        kernel32.CloseHandle(handle)


def listen_for_show_requests(on_request, stopping: threading.Event) -> None:
    """Runs in a thread of the instance that owns the tray, waiting for a
    later launch to ask for the window. Wakes once a second to notice shutdown."""
    if sys.platform != "win32":
        return
    import ctypes

    kernel32 = ctypes.windll.kernel32
    handle = kernel32.CreateEventW(None, False, False, _show_event_name())
    if not handle:
        return
    try:
        while not stopping.is_set():
            if kernel32.WaitForSingleObject(handle, 1000) == _WAIT_OBJECT_0:
                on_request()
    finally:
        kernel32.CloseHandle(handle)


REAP_EVERY = 60.0            # the idle check is cheap; run it often
PRUNE_EVERY = 3600.0         # deleting build dirs is not, so run it rarely
REFRESH_EVERY = 5_000        # ms, while the window is open
BORDER_EVERY = 2.0           # s; a Rust rebuild replaces the dev window

ACCENT = (46, 160, 106)      # Emerald green
IDLE_COLOUR = (120, 120, 128)


def _icon_image(active: int) -> Image.Image:
    """A dot per possible slot, filled for the ones that are running, so the
    tray icon alone says how many instances are up."""
    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([2, 2, size - 3, size - 3], radius=14, fill=(24, 28, 26, 255))
    total = max(1, instance.max_slots())
    cols = 2
    for i in range(min(total, 4)):
        cx = 20 + (i % cols) * 24
        cy = 20 + (i // cols) * 24
        colour = ACCENT if i < active else IDLE_COLOUR
        d.ellipse([cx - 7, cy - 7, cx + 7, cy + 7], fill=colour + (255,))
    return img


class TrayApp:
    def __init__(self) -> None:
        self.root = tk.Tk()
        self.root.withdraw()
        self.root.title(TRAY_TITLE)
        self.root.protocol("WM_DELETE_WINDOW", self.hide_window)
        self._build_window()

        self.stopping = threading.Event()
        self.icon = pystray.Icon(
            "emerald-mcp",
            _icon_image(0),
            "Emerald MCP",
            menu=pystray.Menu(
                pystray.MenuItem("Slots anzeigen", self.show_window, default=True),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Dev-Sitzung starten", self.on_dev_start),
                pystray.MenuItem("Dev-Sitzung beenden", self.on_dev_stop),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Untätige jetzt beenden", self.on_reap),
                pystray.MenuItem("Build-Verzeichnisse aufräumen", self.on_prune),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Beenden", self.on_quit),
            ),
        )
        self._refresh_job = None
        self._rows: dict[int, dict] = {}
        self._checkouts: dict[str, dict] = {}
        self._branches: dict[str, str | None] = {}

    # -- window ------------------------------------------------------------

    def _build_window(self) -> None:
        frame = ttk.Frame(self.root, padding=12)
        frame.pack(fill="both", expand=True)

        dev = ttk.LabelFrame(frame, text="Dev-Sitzung  (Emerald-App, normales Fenster, keine Konsole)", padding=8)
        dev.pack(fill="x")
        self.dev_label = ttk.Label(dev, text="…", width=44)
        self.dev_label.pack(side="left")
        ttk.Button(dev, text="Starten", command=self.on_dev_start).pack(side="left")
        ttk.Button(dev, text="Beenden", command=self.on_dev_stop).pack(side="left", padx=6)
        ttk.Button(dev, text="Log öffnen", command=self.on_dev_log).pack(side="left")

        border_row = ttk.Frame(dev)
        border_row.pack(side="bottom", fill="x", pady=(6, 0), before=self.dev_label)
        colour = devsession.border_colour()
        self._border_colour = colour or devsession.DEFAULT_BORDER
        self.border_var = tk.BooleanVar(value=colour is not None)
        ttk.Checkbutton(border_row, text="Farbiger Rahmen ums Dev-Fenster",
                        variable=self.border_var, command=self.on_border_toggle).pack(side="left")
        self.border_swatch = tk.Label(border_row, width=2, background=self._border_colour,
                                      relief="solid", borderwidth=1, cursor="hand2")
        self.border_swatch.pack(side="left", padx=(8, 4))
        self.border_swatch.bind("<Button-1>", lambda _e: self.on_border_pick())
        ttk.Button(border_row, text="Farbe …", command=self.on_border_pick).pack(side="left")

        mcp = ttk.LabelFrame(frame, text="MCP-Instanzen", padding=8)
        mcp.pack(fill="both", expand=True, pady=(10, 0))

        start_row = ttk.Frame(mcp)
        start_row.pack(fill="x", pady=(0, 8))
        ttk.Label(start_row, text="Checkout:").pack(side="left")
        self.checkout_var = tk.StringVar()
        self.checkout_box = ttk.Combobox(start_row, textvariable=self.checkout_var, state="readonly",
                                         width=72, postcommand=self._reload_checkouts)
        self.checkout_box.pack(side="left", padx=6)
        ttk.Button(start_row, text="MCP-Instanz starten", command=self.on_start_instance).pack(side="left")

        self.tree = ttk.Treeview(
            mcp,
            columns=("slot", "worktree", "state", "idle", "port", "size"),
            show="headings",
            height=6,
            selectmode="browse",
        )
        for col, title, width, anchor in (
            ("slot", "Slot", 45, "center"),
            ("worktree", "Worktree / Branch", 330, "w"),
            ("state", "Zustand", 130, "center"),
            ("idle", "Untätig", 80, "e"),
            ("port", "Port", 60, "center"),
            ("size", "Build", 80, "e"),
        ):
            self.tree.heading(col, text=title)
            self.tree.column(col, width=width, anchor=anchor)
        self.tree.pack(fill="both", expand=True)
        self.tree.bind("<Double-1>", lambda _e: self.on_show_selected())
        self.tree.bind("<<TreeviewSelect>>", self._on_tree_select)
        self.tree.tag_configure("running", foreground="#2ea06a")
        self.tree.tag_configure("starting", foreground="#c08a1e")
        self.tree.tag_configure("stopped", foreground="#888888")

        buttons = ttk.Frame(mcp)
        buttons.pack(fill="x", pady=(10, 0))
        ttk.Button(buttons, text="Ausgewählten beenden", command=self.on_stop_selected).pack(side="left")
        ttk.Button(buttons, text="Zuweisung aufheben", command=self.on_release_selected).pack(side="left", padx=(6, 0))
        ttk.Button(buttons, text="Datenbank zurücksetzen", command=self.on_reset_selected).pack(side="left", padx=6)
        ttk.Button(buttons, text="Untätige beenden", command=self.on_reap).pack(side="left")
        ttk.Button(buttons, text="Größen berechnen", command=self.on_sizes).pack(side="left", padx=6)

        window_row = ttk.Frame(mcp)
        window_row.pack(fill="x", pady=(6, 0))
        ttk.Label(window_row, text="Fenster:").pack(side="left")
        ttk.Button(window_row, text="Auf Hauptbildschirm holen",
                   command=self.on_show_selected).pack(side="left", padx=6)
        ttk.Button(window_row, text="Wieder ausblenden",
                   command=self.on_hide_selected).pack(side="left")
        ttk.Button(window_row, text="Log öffnen",
                   command=self.on_open_log).pack(side="left", padx=6)

        settings = ttk.Frame(frame)
        settings.pack(fill="x", pady=(12, 0))
        ttk.Label(settings, text="Beenden nach").pack(side="left")
        self.idle_var = tk.StringVar(value=str(instance.idle_hours()))
        spin = ttk.Spinbox(settings, from_=0, to=168, increment=0.5, width=6,
                           textvariable=self.idle_var, command=self.on_save_idle)
        spin.pack(side="left", padx=6)
        spin.bind("<Return>", lambda _e: self.on_save_idle())
        ttk.Label(settings, text="Stunden ohne Nutzung  (0 = nie)").pack(side="left")

        self.status = ttk.Label(frame, text="", foreground="#666666", wraplength=620)
        self.status.pack(fill="x", pady=(10, 0))

    def show_window(self, *_a) -> None:
        self.root.after(0, self._show)

    def _show(self) -> None:
        self._reload_checkouts()
        self.refresh(with_sizes=False)
        self.root.deiconify()
        self.root.lift()
        self.root.focus_force()
        self._schedule_refresh()

    def hide_window(self) -> None:
        if self._refresh_job:
            self.root.after_cancel(self._refresh_job)
            self._refresh_job = None
        self.root.withdraw()

    def _schedule_refresh(self) -> None:
        if self.root.state() == "withdrawn":
            return
        self.refresh(with_sizes=False)
        self._refresh_job = self.root.after(REFRESH_EVERY, self._schedule_refresh)

    def refresh(self, with_sizes: bool = False) -> None:
        try:
            data = instance.overview(with_sizes=with_sizes)
        except Exception as e:
            self.set_status(f"Registry nicht lesbar: {e}")
            return

        selected = self.tree.selection()
        keep = self.tree.item(selected[0])["values"][0] if selected else None
        self.tree.delete(*self.tree.get_children())

        running = 0
        self._rows = {row["slot"]: row for row in data["slots"]}
        for row in data["slots"]:
            if row["running"]:
                running += 1
            if row["slot"] == 0:
                worktree, idle = "main (Haupt-Checkout)", "—"
            else:
                key = instance.normalise(Path(row["checkout"]))
                worktree = (self._display_name(row["name"], self._branches[key]) if key in self._branches
                            else row["name"])
                if not row["checkout_exists"]:
                    worktree = f"{row['name']}  (Worktree weg)"
                idle = f"{row['idle_hours']:.1f} h"
            size = f"{row['target_gb']:.1f} GB" if with_sizes and "target_gb" in row else "…"
            if row["running"]:
                state, tag = "läuft", "running"
            elif row.get("starting"):
                state, tag = "startet …", "starting"
            else:
                state, tag = "gestoppt", "stopped"
            if row.get("visible"):
                state += " · sichtbar"
            item = self.tree.insert(
                "", "end",
                values=(row["slot"], worktree, state, idle, row["cdp_port"], size),
                tags=(tag,),
            )
            if keep is not None and row["slot"] == keep:
                self.tree.selection_set(item)

        self.icon.icon = _icon_image(running)
        self.icon.title = f"Emerald MCP — {running} von {data['max_slots'] + 1} aktiv"
        self._refresh_dev()
        hours = data["idle_hours"]
        self.set_status(
            f"{data['home']}   ·   Timeout {hours:g} h"
            + ("  (deaktiviert)" if hours == 0 else "")
        )

    def _refresh_dev(self) -> None:
        try:
            dev = devsession.status()
        except Exception as e:
            self.dev_label.configure(text=f"Zustand unbekannt: {e}", foreground="#888888")
            return
        text, colour = {
            "running": ("läuft", "#2ea06a"),
            "starting": ("baut … Fenster kommt nach dem Build", "#c08a1e"),
            "stopped": ("gestoppt", "#888888"),
        }[dev["state"]]
        if dev["external"]:
            text += "  (nicht hier gestartet)"
        self.dev_label.configure(text=f"Zustand: {text}", foreground=colour)

    # -- checkouts -----------------------------------------------------------

    def _reload_checkouts(self) -> None:
        """Main checkout plus every git worktree, so one that no session has
        claimed yet can be started too. Reloaded when the list opens rather
        than on the 5-second refresh, since it runs git."""
        current = self._checkouts.get(self.checkout_var.get(), {}).get("checkout")
        try:
            rows = instance.list_checkouts()
        except Exception:
            log.exception("could not list checkouts")
            return
        self._checkouts = {}
        self._branches = {instance.normalise(Path(c["checkout"])): c.get("branch") for c in rows}
        for c in rows:
            label = "main (Haupt-Checkout)" if c["is_main"] else self._display_name(c["name"], c.get("branch"))
            label += f"   ·   Slot {c['slot']}" if c["slot"] is not None else "   ·   noch kein Slot"
            self._checkouts[label] = c
        self.checkout_box["values"] = list(self._checkouts)
        if not current or not self._select_checkout(current):
            self.checkout_var.set(next(iter(self._checkouts), ""))

    @staticmethod
    def _display_name(folder: str, branch: str | None) -> str:
        """Branch first, since that is what a worktree is known by; the folder
        only when it says something the branch does not."""
        if not branch:
            return f"{folder}  (detached)"
        short = branch.removeprefix("claude/")
        return short if short == folder else f"{short}   ·   Ordner {folder}"

    def _select_checkout(self, checkout: str) -> bool:
        key = instance.normalise(Path(checkout))
        for label, c in self._checkouts.items():
            if instance.normalise(Path(c["checkout"])) == key:
                self.checkout_var.set(label)
                return True
        return False

    def _on_tree_select(self, _event=None) -> None:
        sel = self.tree.selection()
        if not sel:
            return
        row = self._rows.get(int(self.tree.item(sel[0])["values"][0]))
        if row and row.get("checkout") and row["checkout"] != "?":
            self._select_checkout(row["checkout"])

    def set_status(self, text: str) -> None:
        self.status.configure(text=text)

    # -- actions -----------------------------------------------------------

    def _selected_slot(self) -> int | None:
        sel = self.tree.selection()
        if not sel:
            self.set_status("Erst einen Slot in der Liste auswählen.")
            return None
        return int(self.tree.item(sel[0])["values"][0])

    def on_show_selected(self) -> None:
        """Runs on the UI thread on purpose: Windows only lets a process pull
        another window to the front while it is itself in front, which the
        tray is at the moment of the click."""
        slot = self._selected_slot()
        if slot is None:
            return
        try:
            res = winctl.show_slot(slot)
        except Exception as e:
            log.exception("show failed")
            self.set_status(f"Fehlgeschlagen: {type(e).__name__}: {e}")
            return
        if res.get("shown"):
            self.set_status(f"Slot {slot} ist auf dem Hauptbildschirm und bleibt dort, bis du ihn ausblendest")
        else:
            self.set_status(f"Slot {slot} läuft gerade nicht - beim nächsten Start erscheint er auf dem Bildschirm")
        self.refresh()

    def on_hide_selected(self) -> None:
        slot = self._selected_slot()
        if slot is None:
            return
        try:
            res = winctl.hide_slot(slot)
        except Exception as e:
            log.exception("hide failed")
            self.set_status(f"Fehlgeschlagen: {type(e).__name__}: {e}")
            return
        moved = res.get("moved", 0)
        self.set_status(f"Slot {slot} ausgeblendet" if moved or res.get("position")
                        else f"Slot {slot} läuft nicht - bleibt beim nächsten Start unsichtbar")
        self.refresh()

    def on_start_instance(self) -> None:
        chosen = self._checkouts.get(self.checkout_var.get())
        if not chosen:
            self.set_status("Erst einen Checkout auswählen.")
            return
        label = "main" if chosen["is_main"] else chosen["name"]
        self.set_status(f"Starte {label} …")

        def work():
            # The same route a server takes, so a worktree gets its slot -
            # and a freshly seeded database - exactly as it would from Claude.
            inst = instance.build_instance(cwd=Path(chosen["checkout"]))
            return inst, launcher.start_detached(inst)

        def describe(result):
            inst, res = result
            self.root.after(0, self._reload_checkouts)
            if res["started"]:
                threading.Thread(target=self._place_when_up, args=(inst,), daemon=True).start()
                return (f"Slot {inst.slot} ({label}) startet — der Build kann ein paar Minuten "
                        "dauern, der Fortschritt steht im Log")
            if res["reason"] == "running":
                return f"Slot {inst.slot} ({label}) läuft bereits"
            return f"Slot {inst.slot} ({label}) wird gerade schon gestartet"

        self._in_background(work, describe)

    def _place_when_up(self, inst) -> None:
        """Nobody is attached to an instance started from here, so nobody
        would move its window out of sight. Waits for the build, then does."""
        deadline = time.monotonic() + launcher.launch_timeout()
        while not instance._port_in_use(inst.cdp_port, inst.cdp_host):
            if self.stopping.is_set() or time.monotonic() > deadline:
                return
            if not instance.running_launcher(inst.slot):
                self.root.after(0, lambda: self.set_status(
                    f"Slot {inst.slot}: Start fehlgeschlagen — Details über „Log öffnen“"))
                self.root.after(0, self.refresh)
                return
            time.sleep(3)
        for _ in range(20):
            try:
                res = winctl.place_instance_windows(inst)
            except Exception:
                log.warning("could not place slot %s's window", inst.slot, exc_info=True)
                break
            if res.get("reason") != "no matching window found":
                break
            time.sleep(0.5)
        self.root.after(0, lambda: self.set_status(f"Slot {inst.slot} ({inst.name}) läuft"))
        self.root.after(0, self.refresh)

    def on_open_log(self) -> None:
        slot = self._selected_slot()
        if slot is None:
            return
        logs = sorted((instance.state_dir_for(slot) / "logs").glob("emerald-launch-*.log"),
                      key=lambda p: p.stat().st_mtime)
        if not logs:
            self.set_status(f"Slot {slot} hat noch kein Start-Log")
            return
        self._open_file(logs[-1])

    def _open_file(self, path: Path) -> None:
        try:
            os.startfile(str(path))
        except OSError as e:
            self.set_status(f"Konnte {path} nicht öffnen: {e}")

    # -- dev session ---------------------------------------------------------

    def on_dev_start(self, *_a) -> None:
        self.set_status("Starte Dev-Sitzung …")

        def describe(res):
            if res["started"]:
                return "Dev-Sitzung startet — das Fenster erscheint, sobald der Build fertig ist"
            return "Dev-Sitzung läuft bereits" if res["reason"] == "running" else "Dev-Sitzung baut gerade schon"

        self._in_background(devsession.start, describe)

    def on_dev_stop(self, *_a) -> None:
        self.set_status("Beende Dev-Sitzung …")
        self._in_background(devsession.stop,
                            lambda ok: "Dev-Sitzung beendet" if ok else "Dev-Sitzung lief nicht")

    def on_border_toggle(self) -> None:
        on = self.border_var.get()
        devsession.set_border_colour(self._border_colour if on else None)
        self._apply_border_now()
        self.set_status("Rahmen ums Dev-Fenster " + ("an" if on else "aus"))

    def on_border_pick(self) -> None:
        _rgb, chosen = colorchooser.askcolor(color=self._border_colour, parent=self.root,
                                             title="Rahmenfarbe fürs Dev-Fenster")
        if not chosen:
            return
        self._border_colour = chosen.lower()
        self.border_swatch.configure(background=self._border_colour)
        self.border_var.set(True)
        self.on_border_toggle()

    def _apply_border_now(self) -> None:
        try:
            devsession.apply_border()
        except Exception:
            log.warning("could not colour the dev window", exc_info=True)

    def _border_loop(self) -> None:
        """Keeps the frame on the dev window across rebuilds, which replace
        the window. Cheap: one EnumWindows, and windows already done are
        skipped."""
        while not self.stopping.wait(BORDER_EVERY):
            self._apply_border_now()

    def on_dev_log(self) -> None:
        path = devsession.status().get("log_path")
        if not path or not Path(path).exists():
            self.set_status("Die Dev-Sitzung wurde noch nie von hier gestartet — kein Log")
            return
        self._open_file(Path(path))

    def on_stop_selected(self) -> None:
        slot = self._selected_slot()
        if slot is None:
            return
        self.set_status(f"Beende Slot {slot} …")
        self._in_background(lambda: instance.stop_slot(slot),
                            lambda ok: f"Slot {slot} {'beendet' if ok else 'lief nicht'}")

    def on_release_selected(self) -> None:
        slot = self._selected_slot()
        if slot is None:
            return
        if slot == 0:
            self.set_status("Slot 0 gehört fest zum Haupt-Checkout.")
            return
        row = self._rows.get(slot, {})
        if row.get("running") or row.get("starting"):
            self.set_status(f"Slot {slot} läuft noch — erst „Ausgewählten beenden“, dann freigeben.")
            return
        question = (
            f"Slot {slot} von „{row.get('name', '?')}“ lösen?\n\n"
            "Die Test-Datenbank des Slots wird gelöscht, das Build-Verzeichnis bleibt für "
            "den nächsten Worktree. Ist in diesem Worktree noch eine Claude-Sitzung offen, "
            "holt sie sich beim nächsten Tool-Aufruf von selbst wieder einen Slot."
        )
        if not messagebox.askyesno("Zuweisung aufheben", question, parent=self.root):
            self.set_status("Abgebrochen")
            return

        def describe(res):
            self.root.after(0, self._reload_checkouts)
            if res["released"]:
                return f"Slot {slot} ist wieder frei"
            if res["reason"] == "running":
                return f"Slot {slot} läuft inzwischen wieder — nicht freigegeben"
            return f"Slot {slot} war keinem Worktree zugewiesen"

        self._in_background(lambda: instance.release_slot(slot), describe)

    def on_reset_selected(self) -> None:
        slot = self._selected_slot()
        if slot is None:
            return
        if slot == 0:
            question = (
                "Slot 0 ist der Haupt-Checkout. Seine Datenbank sind keine generierten "
                "Testdaten, sondern das, was sich dort angesammelt hat.\n\n"
                "Wirklich löschen und mit frischen Fixtures neu anfangen?"
            )
        else:
            question = (
                f"Slot {slot}: Datenbank löschen und beim nächsten Start frisch seeden?\n\n"
                "Die Daten dort sind generierte Fixtures."
            )
        if not messagebox.askyesno("Datenbank zurücksetzen", question, icon="warning", parent=self.root):
            self.set_status("Abgebrochen")
            return
        self.set_status(f"Setze Slot {slot} zurück …")
        self._in_background(
            lambda: instance.reset_vault(slot, allow_main=(slot == 0)),
            lambda r: (f"Slot {r['slot']} zurückgesetzt — startet beim nächsten Tool-Aufruf neu"
                       if r["vault_removed"] else f"Slot {r['slot']} hatte keine Datenbank"),
        )

    def on_reap(self, *_a) -> None:
        def done(res):
            n = len(res["stopped"])
            return f"{n} untätige Instanz(en) beendet" if n else "Nichts war untätig genug"
        self._in_background(instance.reap_idle, done)

    def on_prune(self, *_a) -> None:
        def done(res):
            if not res["removed"]:
                return "Nichts aufzuräumen"
            return f"{len(res['removed'])} Build-Verzeichnis(se) gelöscht, {res['freed_gb']:.1f} GB frei"
        self.set_status("Räume auf … das kann dauern")
        self._in_background(instance.prune, done)

    def on_sizes(self) -> None:
        self.set_status("Berechne Größen … das dauert ein paar Sekunden")
        self._in_background(lambda: instance.overview(with_sizes=True),
                            lambda _r: "Größen aktualisiert",
                            then_refresh_with_sizes=True)

    def on_save_idle(self) -> None:
        try:
            hours = max(0.0, float(self.idle_var.get().replace(",", ".")))
        except ValueError:
            self.set_status("Bitte eine Zahl eingeben.")
            return
        try:
            instance.save_config({"idle_hours": hours})
        except OSError as e:
            self.set_status(f"Konnte nicht speichern: {e}")
            return
        if "EMERALD_MCP_IDLE_HOURS" in __import__("os").environ:
            self.set_status(
                f"Gespeichert ({hours:g} h) — aber EMERALD_MCP_IDLE_HOURS ist gesetzt und gewinnt."
            )
        else:
            self.set_status(f"Timeout auf {hours:g} h gesetzt" + (" (deaktiviert)" if hours == 0 else ""))
        self.refresh()

    def _in_background(self, work, describe, then_refresh_with_sizes: bool = False) -> None:
        """Anything touching processes or 8 GB of files must stay off the UI
        thread, or the window freezes mid-click."""
        def run():
            try:
                result = work()
                message = describe(result)
            except Exception as e:  # surfaced in the status line, never a crash
                log.exception("background action failed")
                message = f"Fehlgeschlagen: {type(e).__name__}: {e}"
            self.root.after(0, lambda: (self.set_status(message),
                                        self.refresh(with_sizes=then_refresh_with_sizes)))
        threading.Thread(target=run, daemon=True).start()

    def on_quit(self, *_a) -> None:
        self.stopping.set()
        self.icon.stop()
        self.root.after(0, self.root.destroy)

    # -- the clock ---------------------------------------------------------

    def _timer_loop(self) -> None:
        last_prune = time.monotonic()
        while not self.stopping.wait(REAP_EVERY):
            try:
                res = instance.reap_idle()
                for row in res["stopped"]:
                    log.info("stopped slot %s (%s), idle %.1fh",
                             row["slot"], row["name"], row["idle_hours"])
                if res["stopped"]:
                    self.root.after(0, self.refresh)
            except Exception:
                log.exception("reap failed")
            # `tauri dev` replaces the window whenever the Rust side rebuilds.
            # With a server attached it moves the new one on its next call;
            # for an instance started from here, this is the only thing that
            # will.
            try:
                for row in instance.overview(with_sizes=False)["slots"]:
                    if row["running"]:
                        winctl.place_slot(row["slot"])
            except Exception:
                log.exception("placing windows failed")
            if time.monotonic() - last_prune >= PRUNE_EVERY:
                last_prune = time.monotonic()
                try:
                    instance.prune()
                except Exception:
                    log.exception("prune failed")

    def run(self, show: bool = False) -> None:
        # Always leave a trace of a start: without it an empty log is
        # ambiguous between "nothing to do" and "never ran".
        log.info(
            "tray started - home=%s idle=%.1fh pool=%d reap every %.0fs",
            instance.mcp_home(), instance.idle_hours(), instance.max_slots(), REAP_EVERY,
        )
        threading.Thread(target=self._timer_loop, daemon=True).start()
        threading.Thread(target=self._border_loop, daemon=True).start()
        threading.Thread(target=listen_for_show_requests,
                         args=(self.show_window, self.stopping), daemon=True).start()
        # pystray owns its own loop; Tk insists on the main thread, so the
        # icon is the one that moves aside.
        threading.Thread(target=self.icon.run, daemon=True).start()
        self.root.after(500, self._show if show else self.refresh)
        self.root.mainloop()


def _startup_entry() -> "Path":
    from pathlib import Path
    import os
    return (Path(os.environ["APPDATA"]) / "Microsoft" / "Windows" / "Start Menu"
            / "Programs" / "Startup" / "Emerald-MCP-Tray.vbs")


def install_autostart() -> None:
    """Write a launcher into the Startup folder.

    A .vbs rather than a .bat or a shortcut because WScript.Shell can start a
    process with the window hidden outright - a .bat flashes a console every
    logon.

    The state directory is written into the script itself, and also stored as
    a user environment variable. Both, deliberately: the variable is what
    manual runs and MCP servers pick up, but it only reaches processes started
    after it was set, so relying on it alone would leave the app reading the
    default directory - reporting confidently on the wrong set of slots -
    until the next logon.
    """
    from pathlib import Path
    import os
    import subprocess

    pythonw = Path(sys.executable).with_name("pythonw.exe")
    if not pythonw.exists():
        pythonw = Path(sys.executable)
    script = Path(__file__).resolve()

    home = os.environ.get("EMERALD_MCP_HOME")
    if home:
        subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command",
             f"[Environment]::SetEnvironmentVariable('EMERALD_MCP_HOME', '{home}', 'User')"],
            check=False, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )

    lines = [
        "' Starts the Emerald MCP tray app at logon, without a console window.",
        "' Written by tray.py --install-autostart; delete this file to undo.",
        'Set sh = CreateObject("WScript.Shell")',
    ]
    if home:
        lines.append('Set env = sh.Environment("PROCESS")')
        lines.append(f'env("EMERALD_MCP_HOME") = "{home}"')
    lines.append(f'sh.Run """{pythonw}"" ""{script}""", 0, False')

    entry = _startup_entry()
    entry.parent.mkdir(parents=True, exist_ok=True)
    entry.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"autostart installed: {entry}")
    if home:
        print(f"EMERALD_MCP_HOME={home} stored for your user account")


def remove_autostart() -> None:
    entry = _startup_entry()
    if entry.exists():
        entry.unlink()
        print(f"autostart removed: {entry}")
    else:
        print("no autostart entry to remove")


if __name__ == "__main__":
    args = sys.argv[1:]
    if "--install-autostart" in args:
        install_autostart()
    elif "--remove-autostart" in args:
        remove_autostart()
    elif not claim_single_instance():
        # Two of these would mean two clocks reaping the same slots and two
        # windows disagreeing about what is running.
        log.info("another tray app is already running for %s - exiting", instance.mcp_home())
        if "--show" in args:
            # Started deliberately, so do the thing that was asked for rather
            # than exiting silently.
            signal_existing_instance()
        sys.exit(0)
    else:
        # --show opens the window straight away; without it the app starts
        # quietly in the tray, which is what the autostart entry wants.
        TrayApp().run(show="--show" in args)
