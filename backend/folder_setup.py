"""Preview: before an account's first scan, the student says which Outlook folders hold recruiting email.

The reader takes a quick look at the folder list (no email is opened), then the site suggests, for each folder, read
every email (Inbox, Sent Items, folders named after a bank or recruiting), check each email (only ones that look like
recruiting are opened) or skip (folders that look like classes or personal mail). The student clicks to change any of
them and can add a note in their own words; the first scan then follows their choices instead of learning them over
weeks.
"""
import re
from datetime import datetime

from . import sync
from .db import connect

SCHEMA = """
CREATE TABLE IF NOT EXISTS reader_setup (
    user_id       INTEGER PRIMARY KEY,
    confirmed_at  TEXT NOT NULL DEFAULT '',
    note          TEXT NOT NULL DEFAULT ''
);
"""
NOTE_CHARS = 600

# Folder names that are almost never about banking recruiting: classes, school admin, personal life.
PERSONAL = re.compile(
    r"^mgt\b|\bclass(es)?\b|course|homework|assignment|syllab|semester|\bterm\b|completed|registrar|grades?\b|"
    r"housing|apartment|lease|rent\b|loans?\b|financial aid|tuition|bursar|health|medical|doctor|insurance|"
    r"personal|private|family|friends|federal|\btax(es)?\b|irs\b|bills?\b|receipts?|shopping|orders?\b|amazon|"
    r"travel|flights?|trips?\b|military|\bva\b|veteran|church|sports?\b|gym|fitness|newsletters?|promotions?|"
    r"spam|social\b|clubs?\b(?!.*finance)", re.I)


def ensure() -> None:
    sync.ensure()
    with connect() as conn:
        conn.executescript(SCHEMA)


def note(uid: int) -> str:
    ensure()
    with connect(read_only=True) as conn:
        row = conn.execute("SELECT note FROM reader_setup WHERE user_id = ?", (uid,)).fetchone()
    return row["note"] if row else ""


def confirmed(uid: int) -> bool:
    ensure()
    with connect(read_only=True) as conn:
        row = conn.execute("SELECT confirmed_at FROM reader_setup WHERE user_id = ?", (uid,)).fetchone()
    return bool(row and row["confirmed_at"])


def suggest(uid: int) -> dict:
    """Each folder the reader saw, with what the site suggests and why, grouped for the screen."""
    ensure()
    plan = sync.folder_plan(uid)
    try:
        named = re.compile(sync._screen(uid), re.I)
    except re.error:
        named = None
    folders = []
    for f in plan:
        name = f["name"]
        if name in sync.ALWAYS_READ:
            pick, why = "always", "Always read: your replies and new contacts land here"
        elif f["mode"] in ("always", "skip"):
            pick, why = f["mode"], "As you set it"
        elif named and any(sync._word_start(name, m) for m in named.finditer(name)):
            pick, why = "always", "Named after a bank or recruiting"
        elif PERSONAL.search(name):
            pick, why = "skip", "Looks like classes or personal mail"
        else:
            pick, why = "auto", "Not sure: each email is checked, and only ones that look like recruiting are opened"
        folders.append({"name": name, "pick": pick, "why": why, "fixed": name in sync.ALWAYS_READ})
    folders.sort(key=lambda f: (not f["fixed"], f["name"].lower()))  # Inbox and Sent Items first
    return {"confirmed": confirmed(uid), "note": note(uid), "folders": folders}


def confirm(uid: int, choices: dict[str, str], text: str) -> dict:
    """The student's answers: a mode for each folder (always, auto or skip) and an optional note."""
    ensure()
    known = {f["name"] for f in sync.folder_plan(uid)}
    for name, mode in choices.items():
        if name in known and name not in sync.ALWAYS_READ and mode in ("always", "auto", "skip"):
            sync.set_folder_mode(uid, name, mode)
    clean = " ".join((text or "").split())[:NOTE_CHARS]
    with connect() as conn:
        conn.execute("""INSERT INTO reader_setup (user_id, confirmed_at, note) VALUES (?, ?, ?)
                        ON CONFLICT(user_id) DO UPDATE SET confirmed_at = excluded.confirmed_at, note = excluded.note""",
                     (uid, datetime.now().isoformat(timespec="seconds"), clean))
    return {"ok": True}
