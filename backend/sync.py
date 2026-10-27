"""Preview: keeping the tracker up to date from the student's own email, Slack and WhatsApp.

The Recruiting HQ Reader (a Chrome extension in reader-extension/) reads the pages the student has open and
sends the messages it finds here. It cannot send anything anywhere else, and neither can this module or the
assistant it hands messages to: no email, chat or messaging tool exists in this app.

- Checkpoints: for each source and conversation the newest message already filed is remembered, so each sync
  only files what came after it. Messages from before this recruiting season are dropped.
- Cost: nothing is sent to the model unless there is something new; busy group chats are first narrowed to
  messages about banks and the process; syncing may use at most SYNC_BUDGET tokens a day.
"""
import hashlib
import json
import re
from datetime import date, datetime

from pydantic import BaseModel, Field

from . import accounts, assistant, schools
from .db import connect, init_db
from .llm import Chosen

SEASON_START = "2026-08-01"  # this recruiting season; anything older belongs to an earlier class
SYNC_BUDGET = 200_000         # tokens a day for syncing, about half the daily allowance
MAX_CHARS = 40_000            # per filing run

SCHEMA = """
CREATE TABLE IF NOT EXISTS sync_state (
    user_id       INTEGER NOT NULL,
    source        TEXT NOT NULL,
    conversation  TEXT NOT NULL,
    last_at       TEXT NOT NULL DEFAULT '',
    last_keys     TEXT NOT NULL DEFAULT '',
    updated_at    TEXT NOT NULL,
    PRIMARY KEY (user_id, source, conversation)
);
CREATE TABLE IF NOT EXISTS reader_keys (
    user_id     INTEGER NOT NULL,
    token_hash  TEXT NOT NULL PRIMARY KEY,
    created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reader_config (
    user_id  INTEGER PRIMARY KEY,
    config   TEXT NOT NULL   -- JSON: slack_team, slack_channels [{id, name, group}], whatsapp_chats [name]
);
CREATE TABLE IF NOT EXISTS sync_log (
    id            INTEGER PRIMARY KEY,
    user_id       INTEGER NOT NULL,
    at            TEXT NOT NULL,
    source        TEXT NOT NULL,
    conversation  TEXT NOT NULL,
    received      INTEGER NOT NULL,
    new           INTEGER NOT NULL,
    filed         INTEGER NOT NULL,
    note          TEXT
);
"""

# Group chats are mostly chatter; only messages that touch the process go to the model.
RELEVANT = re.compile(
    r"goldman|\bgs\b|morgan stanley|\bms\b|jpm|j\.?p\.? ?morgan|citi|barclays|evercore|guggenheim|gugg|lazard|rothschild|bofa|"
    r"bank of america|wells|\bwf\b|jefferies|pjt|pwp|perella|rbc|centerview|harris williams|\bhw\b|moelis|houlihan|greenhill|"
    r"santander|dinner|invite|superday|super day|super week|round|interview|hirevue|screen|deadline|apply|application|cover letter|"
    r"offer|cut\b|next step|allocation|booya|cocktail|drinks|coffee chat|thank.you|recruit", re.I)


class Item(BaseModel):
    key: str = Field(description="Stable id of the message in its app.")
    at: str = Field(description="When it was sent, ISO date-time (local time is fine).")
    author: str = ""
    text: str


class Batch(BaseModel):
    source: str           # outlook | slack | whatsapp
    conversation: str     # folder, channel, DM or group name
    group_chat: bool = False
    baseline: str = ""    # the reader's starting line, local ISO time; used for a conversation with no checkpoint yet
    items: list[Item]


def ensure() -> None:
    init_db()
    with connect() as conn:
        conn.executescript(SCHEMA)


def new_key(user: dict) -> str:
    """A long-lived sign-in key for the reader, shown once. Earlier reader keys stop working."""
    ensure()
    with connect() as conn:
        revoke(user["id"], conn)
        token = accounts._new_session(conn, user["id"])
        now = datetime.now().isoformat(timespec="seconds")
        conn.execute("INSERT INTO reader_keys (user_id, token_hash, created_at) VALUES (?, ?, ?)", (user["id"], accounts._token_hash(token), now))
    return token


def revoke(uid: int, conn=None) -> None:
    if conn is None:
        ensure()
        with connect() as c:
            return revoke(uid, c)
    conn.execute("DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM reader_keys WHERE user_id = ?)", (uid,))
    conn.execute("DELETE FROM reader_keys WHERE user_id = ?", (uid,))


def state(uid: int) -> dict:
    """{source: {conversation: newest filed time}} so the reader only collects what is newer, plus recent syncs."""
    ensure()
    with connect(read_only=True) as conn:
        rows = conn.execute("SELECT source, conversation, last_at FROM sync_state WHERE user_id = ?", (uid,)).fetchall()
        log = [dict(r) for r in conn.execute(
            "SELECT at, source, conversation, received, new, filed, note FROM sync_log WHERE user_id = ? ORDER BY id DESC LIMIT 20", (uid,))]
        has_key = conn.execute("SELECT 1 FROM reader_keys WHERE user_id = ?", (uid,)).fetchone() is not None
        row = conn.execute("SELECT config FROM reader_config WHERE user_id = ?", (uid,)).fetchone()
    out: dict[str, dict[str, str]] = {}
    for r in rows:
        out.setdefault(r["source"], {})[r["conversation"]] = r["last_at"]
    return {"checkpoints": out, "season_start": SEASON_START, "log": log, "has_key": has_key,
            "config": json.loads(row["config"]) if row else {}}


class ReaderConfig(BaseModel):
    """What the reader reads. Kept in the account, not in the extension's (public) code."""
    slack_team: str = ""
    slack_channels: list[dict] = Field(default_factory=list)  # {id, name, group}
    whatsapp_chats: list[str] = Field(default_factory=list)


def set_config(uid: int, config: ReaderConfig) -> dict:
    ensure()
    channels = [{"id": str(c.get("id", ""))[:20], "name": str(c.get("name", ""))[:80], "group": bool(c.get("group"))}
                for c in config.slack_channels if re.fullmatch(r"[CDG][A-Z0-9]{6,15}", str(c.get("id", "")))]
    clean = {"slack_team": config.slack_team if re.fullmatch(r"[A-Z0-9]{6,15}", config.slack_team) else "",
             "slack_channels": channels[:30], "whatsapp_chats": [c[:100] for c in config.whatsapp_chats][:10]}
    with connect() as conn:
        conn.execute("INSERT INTO reader_config (user_id, config) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET config = excluded.config",
                     (uid, json.dumps(clean)))
    return clean


def _key(item: Item) -> str:
    return item.key or hashlib.sha1(f"{item.at}|{item.author}|{item.text[:200]}".encode()).hexdigest()


def _sync_used_today(uid: int) -> int:
    with connect(read_only=True) as conn:
        return conn.execute(
            "SELECT COALESCE(SUM(input_tokens + output_tokens), 0) FROM agent_runs WHERE user_id = ? AND started_at >= ? "
            "AND user_message LIKE 'New messages from %'", (uid, date.today().isoformat())).fetchone()[0]


def _message(batch: Batch, items: list[Item], school: str) -> str:
    where = {"outlook": "my Outlook email", "slack": "Slack", "whatsapp": "WhatsApp"}.get(batch.source, batch.source)
    head = (f"New messages from {where}, {batch.conversation!r}, read by the Recruiting HQ Reader (it only reads; nothing is ever "
            f"sent). This recruiting season began {SEASON_START}: anything about an earlier season, or a file from an earlier "
            "year, is background only, never a current deadline, step or contact.\n"
            "File only what concerns my own recruiting: my chats, invitations, interviews, dinners, applications, deadlines, "
            "decisions and next steps, the people involved, and facts about how a bank's process works. ")
    if batch.group_chat:
        head += (f"This is a group chat of {school} students: do not save other students' personal results (who was invited, cut "
                 "or got an offer); keep only what tells me something about a bank's process or timing, or what mentions me. ")
    head += "Do not draft emails. If nothing is worth saving, save nothing and say so.\n\n"
    lines = [f"[{i.at}] {i.author}: {i.text.strip()}" for i in items]
    return head + "\n".join(lines)


async def ingest(user: dict, chosen: Chosen, batch: Batch) -> dict:
    """File the messages in `batch` that are newer than this conversation's checkpoint."""
    ensure()
    uid, now = user["id"], datetime.now().isoformat(timespec="seconds")
    with connect(read_only=True) as conn:
        row = conn.execute("SELECT last_at, last_keys FROM sync_state WHERE user_id = ? AND source = ? AND conversation = ?",
                           (uid, batch.source, batch.conversation)).fetchone()
    # A conversation read for the first time starts at the reader's starting line (the student's local time when
    # they set the reader up: everything before it was already filed by hand).
    last_at, last_keys = (row["last_at"], set(row["last_keys"].split("|"))) if row else (batch.baseline, set())
    fresh = [i for i in batch.items if i.at[:10] >= SEASON_START and (i.at > last_at or (i.at == last_at and _key(i) not in last_keys))]
    fresh.sort(key=lambda i: i.at)
    relevant = [i for i in fresh if not batch.group_chat or RELEVANT.search(i.text)]
    filed, note = 0, ""
    if relevant:
        if _sync_used_today(uid) >= SYNC_BUDGET:
            return _log(uid, now, batch, len(batch.items), len(fresh), 0, "Daily sync allowance used; will continue tomorrow.")
        sc = schools.for_user(uid)
        chunk, size = [], 0
        for i in relevant:  # one model run per ~40k characters
            if size + len(i.text) > MAX_CHARS and chunk:
                await assistant.run(user, chosen, _message(batch, chunk, sc["short"] or "my school"), [], transcript=True)
                filed += len(chunk)
                chunk, size = [], 0
            chunk.append(i)
            size += len(i.text) + 60
        if chunk:
            out = await assistant.run(user, chosen, _message(batch, chunk, sc["short"] or "my school"), [], transcript=True)
            filed += len(chunk)
            note = out["reply"][:400]
    if fresh:
        top = max(i.at for i in fresh)
        keys = "|".join(_key(i) for i in fresh if i.at == top)
        with connect() as conn:
            conn.execute("""INSERT INTO sync_state (user_id, source, conversation, last_at, last_keys, updated_at) VALUES (?, ?, ?, ?, ?, ?)
                            ON CONFLICT(user_id, source, conversation) DO UPDATE SET last_at = excluded.last_at,
                            last_keys = excluded.last_keys, updated_at = excluded.updated_at""",
                         (uid, batch.source, batch.conversation, top, keys, now))
    return _log(uid, now, batch, len(batch.items), len(fresh), filed, note or ("Nothing new." if not fresh else "Nothing relevant."))


def _log(uid, now, batch, received, new, filed, note) -> dict:
    with connect() as conn:
        conn.execute("INSERT INTO sync_log (user_id, at, source, conversation, received, new, filed, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                     (uid, now, batch.source, batch.conversation, received, new, filed, note))
    return {"ok": True, "received": received, "new": new, "filed": filed, "note": note}
