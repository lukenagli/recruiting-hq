"""What the admin sets for everyone on the site, and what everyone gets from the club's chats.

- Bank details for cover letters (recruiter, title, formal name, office address): the admin's version is the default
  for every account; a student who typed their own for a bank keeps theirs.
- The club chats: the main Finance Club Slack channels and WhatsApp group everyone is in. Only the admin's reader
  reads them, and what matters (events, deadlines, how a bank's process is running) goes into the club feed that
  every account sees, so no one else spends their time or AI allowance on the same chats.
- The directory of group-specific chats (a Consumer & Retail WhatsApp, a Healthcare Slack channel...), which setup
  offers each student by the groups they recruit for; each student's own reader reads the ones they are in.
- Who is signed up and using the site.
"""
import json
import re
from datetime import date, datetime

from . import banks as bank_info
from .db import connect, init_db

SCHEMA = """
CREATE TABLE IF NOT EXISTS club_updates (
    id          INTEGER PRIMARY KEY,
    created_at  TEXT NOT NULL,
    source      TEXT NOT NULL,      -- the chat it came from, e.g. "Slack #club-finance"
    posted_at   TEXT NOT NULL,      -- when the message was posted
    kind        TEXT NOT NULL,      -- event | deadline | process | announcement
    bank        TEXT NOT NULL DEFAULT '',
    happens_on  TEXT NOT NULL DEFAULT '',   -- YYYY-MM-DD of the event or deadline, if it has one
    title       TEXT NOT NULL,
    detail      TEXT NOT NULL DEFAULT '',
    hidden      INTEGER NOT NULL DEFAULT 0  -- the admin removed it from the feed
)"""

CLUB_CHATS = ["club-finance", "finance-recruitment-2026", "Unofficial Channel - Maximizing Shareholder's Value"]
BANK_FIELDS = ("recruiter_name", "recruiter_title", "letter_name", "address")


def ensure() -> None:
    init_db()
    with connect() as conn:
        conn.execute(SCHEMA)


def _get(key: str, default):
    init_db()
    with connect(read_only=True) as conn:
        row = conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
    try:
        return json.loads(row["value"]) if row else default
    except ValueError:
        return default


def _set(key: str, value) -> None:
    init_db()
    with connect() as conn:
        conn.execute("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                     (key, json.dumps(value)))


# ---- Bank details for cover letters ----

def bank_defaults() -> dict[str, dict]:
    """{bank: {recruiter_name, recruiter_title, letter_name, address}}: the admin's pushed version over the built-in one."""
    saved = _get("bank_defaults", {})
    out = {}
    for bank in sorted(set(bank_info.DOMAINS) | set(saved)):
        built_in = {"recruiter_name": "", "recruiter_title": "", "letter_name": bank_info.LETTER_NAMES.get(bank, ""),
                    "address": bank_info.ADDRESSES.get(bank, "")}
        out[bank] = {f: (saved.get(bank, {}).get(f) or built_in[f]) for f in BANK_FIELDS}
    return out


def push_bank_defaults(updates: dict[str, dict]) -> dict:
    saved = _get("bank_defaults", {})
    for bank, fields in updates.items():
        bank = " ".join(str(bank).split())[:60]
        if bank:
            saved[bank] = {f: str(fields.get(f, "")).strip()[:300] for f in BANK_FIELDS}
    _set("bank_defaults", saved)
    return bank_defaults()


def bank_detail(bank: str, mine: dict) -> dict:
    """The details a letter uses for one bank: the student's own where they typed one, else the admin's default."""
    base = bank_defaults().get(bank, {f: "" for f in BANK_FIELDS})
    return {f: (mine.get(f) or base[f] or "") for f in BANK_FIELDS}


# ---- Chats ----

def club_chats() -> list[str]:
    return _get("club_chats", CLUB_CHATS)


def set_club_chats(names: list[str]) -> list[str]:
    _set("club_chats", [" ".join(n.split())[:100] for n in names if n.strip()][:10])
    return club_chats()


def is_club_chat(conversation: str) -> bool:
    norm = lambda s: re.sub(r"[^a-z0-9]+", "", s.lower())  # noqa: E731
    return any(norm(conversation).endswith(norm(c)) or norm(c) == norm(conversation) for c in club_chats())


def chat_directory() -> list[dict]:
    """Group-specific chats students can pick in setup: [{name, app: slack|whatsapp, groups: [...]}]."""
    return _get("chat_directory", [])


def set_chat_directory(chats: list[dict]) -> list[dict]:
    clean = []
    for c in chats[:60]:
        name = " ".join(str(c.get("name", "")).split())[:100]
        app = c.get("app") if c.get("app") in ("slack", "whatsapp") else ""
        if name and app:
            clean.append({"name": name.lstrip("#"), "app": app, "groups": [str(g)[:60] for g in c.get("groups", [])][:12]})
    _set("chat_directory", clean)
    return clean


def slack_team() -> str:
    """The club's Slack workspace, so students' readers open the right one without setting it up."""
    return _get("club_slack_team", "")


def set_slack_team(team: str) -> str:
    _set("club_slack_team", team if re.fullmatch(r"[A-Z0-9]{6,15}", team) else "")
    return slack_team()


# ---- The club feed ----

def save_updates(source: str, updates: list[dict]) -> int:
    """Add what the club chats said, skipping anything already in the feed (same bank, title and date)."""
    ensure()
    now, added = datetime.now().isoformat(timespec="seconds"), 0
    with connect() as conn:
        for u in updates:
            title = " ".join(str(u.get("title", "")).split())[:200]
            if not title:
                continue
            dupe = conn.execute("SELECT 1 FROM club_updates WHERE lower(title) = lower(?) AND bank = ? AND happens_on = ?",
                                (title, u.get("bank", ""), u.get("happens_on", ""))).fetchone()
            if dupe:
                continue
            conn.execute("""INSERT INTO club_updates (created_at, source, posted_at, kind, bank, happens_on, title, detail)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                         (now, source[:100], str(u.get("posted_at", ""))[:25], u.get("kind", "announcement"), u.get("bank", "")[:60],
                          u.get("happens_on", "")[:10], title, str(u.get("detail", ""))[:1000]))
            added += 1
    return added


def feed(bank: str = "", limit: int = 40) -> list[dict]:
    """The club feed, newest first; upcoming events and deadlines are kept, past ones drop off after a week."""
    ensure()
    week_ago = date.fromordinal(date.today().toordinal() - 7).isoformat()
    with connect(read_only=True) as conn:
        rows = conn.execute(
            """SELECT id, source, posted_at, kind, bank, happens_on, title, detail FROM club_updates
               WHERE hidden = 0 AND (happens_on = '' OR happens_on >= ?) AND (? = '' OR bank = ?)
               ORDER BY posted_at DESC LIMIT ?""", (week_ago, bank, bank, limit)).fetchall()
    return [dict(r) for r in rows]


def hide_update(update_id: int) -> None:
    ensure()
    with connect() as conn:
        conn.execute("UPDATE club_updates SET hidden = 1 WHERE id = ?", (update_id,))


# ---- Who is using the site ----

def users() -> list[dict]:
    init_db()
    with connect(read_only=True) as conn:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        rows = [dict(r) for r in conn.execute(
            """SELECT u.id, u.name, u.email, u.is_admin, u.created_at, (u.api_key_enc != '') AS own_key,
                      (SELECT COUNT(*) FROM my_banks b WHERE b.user_id = u.id) AS banks,
                      (SELECT COUNT(*) FROM people p WHERE p.user_id = u.id) AS people,
                      (SELECT COUNT(*) FROM interactions i WHERE i.user_id = u.id) AS interactions,
                      (SELECT MAX(started_at) FROM agent_runs a WHERE a.user_id = u.id) AS last_ai,
                      (SELECT MAX(created_at) FROM sessions s WHERE s.user_id = u.id) AS last_login
               FROM users u WHERE u.password_hash != '' ORDER BY u.created_at""")]
        if "sync_log" in tables:
            last_sync = {r["user_id"]: r["at"] for r in conn.execute("SELECT user_id, MAX(at) AS at FROM sync_log GROUP BY user_id")}
            for r in rows:
                r["last_sync"] = last_sync.get(r["id"], "")
    for r in rows:
        r["last_active"] = max(filter(None, [r.get("last_ai"), r.get("last_login"), r.get("last_sync")]), default="")
    return rows
