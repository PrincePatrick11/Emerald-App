"""dialogs.py against real Windows dialogs, opened by throwaway child
processes. They appear on screen for a moment, so these only run when asked
for: EMCP_TEST_DIALOGS=1."""

import os
import subprocess
import sys
import time

import pytest

import dialogs

pytestmark = pytest.mark.skipif(
    not dialogs.IS_WINDOWS or os.environ.get("EMCP_TEST_DIALOGS") != "1",
    reason="opens real dialogs on screen - set EMCP_TEST_DIALOGS=1",
)

# A venv's python.exe is a launcher that starts the real interpreter as a
# child, and the dialog would belong to that child rather than to the pid
# Popen reports.
PYTHON = getattr(sys, "_base_executable", None) or sys.executable

MESSAGE_BOX = (
    "import ctypes, sys; "
    "sys.exit(ctypes.windll.user32.MessageBoxW(0, 'Really overwrite?', 'emcp-test', 1))"
)
OPEN_FILE = (
    "Add-Type -AssemblyName System.Windows.Forms; "
    "$d = New-Object System.Windows.Forms.OpenFileDialog; "
    "if ($d.ShowDialog() -eq 'OK') { Write-Output $d.FileName }"
)


SAVE_FILE = (
    "Add-Type -AssemblyName System.Windows.Forms; "
    "$d = New-Object System.Windows.Forms.SaveFileDialog; $d.FileName = 'Untitled.md'; "
    "if ($d.ShowDialog() -eq 'OK') { Write-Output $d.FileName }"
)
def _wait_for_dialog(pid: int, timeout: float = 15.0) -> dialogs.Dialog:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        found = dialogs.find_dialogs(pids={pid})
        if found:
            return found[0]
        time.sleep(0.1)
    pytest.fail("the dialog never appeared")


def test_message_box_is_read_and_cancelled():
    proc = subprocess.Popen([PYTHON, "-c", MESSAGE_BOX])
    try:
        dialog = _wait_for_dialog(proc.pid)
        assert dialog.title == "emcp-test"
        assert dialog.text == "Really overwrite?"
        assert len(dialog.buttons) == 2 and dialog.file_field is None

        result = dialogs.respond(dialog, "cancel")
        assert result["closed"]
        assert proc.wait(timeout=5) == dialogs.IDCANCEL
    finally:
        proc.kill()


def test_message_box_button_by_label():
    proc = subprocess.Popen([PYTHON, "-c", MESSAGE_BOX])
    try:
        dialog = _wait_for_dialog(proc.pid)
        with pytest.raises(ValueError, match="this dialog has"):
            dialogs.respond(dialog, "click", button="no such button")
        dialogs.respond(dialog, "click", button=dialog.buttons[0].label)
        assert proc.wait(timeout=5) == dialogs.IDOK
    finally:
        proc.kill()


def test_file_dialog_takes_a_path(tmp_path):
    wanted = tmp_path / "picked.txt"
    wanted.write_text("x", encoding="utf-8")
    proc = subprocess.Popen(
        ["powershell", "-NoProfile", "-Command", OPEN_FILE],
        stdout=subprocess.PIPE, text=True,
    )
    try:
        dialog = _wait_for_dialog(proc.pid)
        assert dialog.file_field, "no file name field found"
        result = dialogs.respond(dialog, "accept", path=str(wanted))
        assert result["closed"]
        out, _ = proc.communicate(timeout=10)
        assert out.strip().lower() == str(wanted).lower()
    finally:
        proc.kill()


def test_save_dialog_saves_under_the_given_name(tmp_path):
    # The case WM_SETTEXT gets wrong: the field shows the new name and the
    # dialog still returns the one it opened with.
    wanted = tmp_path / "sub dir" / "out.md"
    wanted.parent.mkdir()
    proc = subprocess.Popen(
        ["powershell", "-NoProfile", "-Command", SAVE_FILE],
        stdout=subprocess.PIPE, text=True,
    )
    try:
        dialog = _wait_for_dialog(proc.pid)
        result = dialogs.respond(dialog, "accept", path=wanted.as_posix())
        assert result["closed"]
        out, _ = proc.communicate(timeout=10)
        assert out.strip().lower() == str(wanted).lower()
    finally:
        proc.kill()
