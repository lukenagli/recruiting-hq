"""Preview: a last pass after the reader's filing, without the model.

- The same person saved twice at one bank under two forms of their name ("Matt Rube" and "Matthew Rube", "Seb" and
  "Sebastian Carpanini") is merged into one, keeping the record with more history.
- A coffee chat with one person logged twice a few days apart can't be settled without the student (which day was
  it?), so it becomes a question on their home page.
- After an account's first scan, its home page asks the student to look over what was found (sync.review).

Recorded like an assistant run, so Undo puts it back.
"""
import json
import re
import types
from datetime import datetime

from . import assistant
from .db import connect

NICKNAMES = {
    "matt": "matthew", "mike": "michael", "mick": "michael", "seb": "sebastian", "ben": "benjamin", "nick": "nicholas",
    "alex": "alexander", "chris": "christopher", "dan": "daniel", "danny": "daniel", "will": "william", "bill": "william",
    "tom": "thomas", "jim": "james", "jimmy": "james", "bob": "robert", "rob": "robert", "bobby": "robert", "kate": "katherine",
    "katie": "katherine", "liz": "elizabeth", "beth": "elizabeth", "sam": "samuel", "tony": "anthony", "andy": "andrew",
    "drew": "andrew", "joe": "joseph", "joey": "joseph", "jon": "jonathan", "josh": "joshua", "zach": "zachary", "zack": "zachary",
    "ed": "edward", "eddie": "edward", "ted": "edward", "teddy": "theodore", "theo": "theodore", "jen": "jennifer", "jenny": "jennifer",
    "abby": "abigail", "steve": "stephen", "greg": "gregory", "jeff": "jeffrey", "pat": "patrick", "rick": "richard", "dick": "richard",
    "rich": "richard", "charlie": "charles", "chuck": "charles", "max": "maximilian", "nate": "nathaniel", "ken": "kenneth",
    "tim": "timothy", "vicky": "victoria", "becca": "rebecca", "becky": "rebecca", "meg": "margaret", "maggie": "margaret",
    "eben": "ebenezer", "avi": "avinash",
}


def _parts(name: str) -> list[str]:
    return re.sub(r"[^a-z ]", " ", (name or "").lower()).split()


def _first_forms(first: str) -> set[str]:
    return {first, NICKNAMES.get(first, first)}


def same_person(a: str, b: str) -> bool:
    """Two forms of one name: the same surname and a first name that is a nickname of the other."""
    pa, pb = _parts(a), _parts(b)
    if len(pa) < 2 or len(pb) < 2 or pa == pb or pa[-1] != pb[-1]:
        return False
    # only real nicknames: a shortening alone would join different people (Jon and Jonas, Chris and Christine)
    return bool(_first_forms(pa[0]) & _first_forms(pb[0]))


def _ctx(uid: int):
    return types.SimpleNamespace(deps=assistant.Deps(user_id=uid))


def _merge_people(conn, uid: int, ctx) -> list[str]:
    did = []
    people = [dict(r) for r in conn.execute(
        """SELECT p.id, p.name, p.bank, (SELECT COUNT(*) FROM interaction_people ip WHERE ip.person_id = p.id) AS entries
           FROM people p WHERE p.user_id = ? ORDER BY p.bank, p.id""", (uid,))]
    gone = set()
    for i, a in enumerate(people):
        for b in people[i + 1:]:
            if a["id"] in gone or b["id"] in gone or a["bank"] != b["bank"] or not same_person(a["name"], b["name"]):
                continue
            keep, dup = (a, b) if (a["entries"], len(a["name"])) >= (b["entries"], len(b["name"])) else (b, a)
            out = assistant.merge_people(ctx, keep["bank"], keep["id"], dup["id"])
            if not out.get("refused"):
                gone.add(dup["id"])
                did.append(f"Merged {dup['name']} into {keep['name']} ({keep['bank']})")
    return did


def _twin_chats(conn, uid: int) -> list[str]:
    """Coffee chats with one person logged twice within three days: asked about, not guessed."""
    asked = []
    rows = conn.execute(
        """SELECT a.id AS a_id, a.date AS a_date, b.id AS b_id, b.date AS b_date, a.bank, p.name
           FROM interactions a JOIN interaction_people ap ON ap.interaction_id = a.id
           JOIN interactions b ON b.user_id = a.user_id AND b.bank = a.bank AND b.id > a.id AND b.kind = 'coffee_chat'
           JOIN interaction_people bp ON bp.interaction_id = b.id AND bp.person_id = ap.person_id
           JOIN people p ON p.id = ap.person_id
           WHERE a.user_id = ? AND a.kind = 'coffee_chat' AND a.date != '' AND b.date != ''
             AND ABS(julianday(a.date) - julianday(b.date)) <= 3""", (uid,)).fetchall()
    for r in rows:
        days = sorted({r["a_date"], r["b_date"]})
        when = " and ".join(f"{datetime.strptime(d, '%Y-%m-%d'):%b} {int(d[8:])}" for d in days)
        q = (f"Your coffee chat with {r['name']} ({r['bank']}) is logged twice, on {when}. Which day was it? "
             "Tell me and I'll keep that one.")
        if not conn.execute("SELECT 1 FROM reader_questions WHERE user_id = ? AND question = ?", (uid, q)).fetchone():
            conn.execute("INSERT INTO reader_questions (user_id, asked_at, question) VALUES (?, ?, ?)",
                         (uid, datetime.now().isoformat(timespec="seconds"), q))
            asked.append(q)
    return asked


def mark_review(uid: int) -> None:
    with connect() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS reader_review (user_id INTEGER PRIMARY KEY, ready_at TEXT NOT NULL,
                        done_at TEXT NOT NULL DEFAULT '')""")
        conn.execute("INSERT OR IGNORE INTO reader_review (user_id, ready_at) VALUES (?, ?)", (uid, datetime.now().isoformat(timespec="seconds")))


async def run(user: dict, first_scan: bool = False) -> dict:
    uid = user["id"]
    ctx = _ctx(uid)
    with connect() as conn:
        merged = _merge_people(conn, uid, ctx)
        asked = _twin_chats(conn, uid)
    if merged and ctx.deps.snapshot is not None:
        with connect() as conn:
            conn.execute("""INSERT INTO agent_runs (user_id, started_at, agent, user_message, reply, steps, outcome, snapshot)
                            VALUES (?, ?, 'scan_cleanup', 'Tidy after the reader', ?, ?, 'ok', ?)""",
                         (uid, datetime.now().isoformat(timespec="seconds"), "; ".join(merged), json.dumps(ctx.deps.steps), ctx.deps.snapshot))
    if first_scan:
        mark_review(uid)
    return {"merged": merged, "asked": asked, "review": first_scan}



def review(uid: int) -> dict:
    """After a first scan: what it found, bank by bank, for the student to look over once (chats, events, interviews)."""
    mark = "CREATE TABLE IF NOT EXISTS reader_review (user_id INTEGER PRIMARY KEY, ready_at TEXT NOT NULL, done_at TEXT NOT NULL DEFAULT '')"
    with connect() as conn:
        conn.execute(mark)
        row = conn.execute("SELECT ready_at, done_at FROM reader_review WHERE user_id = ?", (uid,)).fetchone()
        if not row or row["done_at"]:
            return {"ready": False}
        banks: dict[str, dict] = {}
        for e in conn.execute(
                """SELECT i.id, i.bank, i.kind, i.title, i.date, i.status, i.thank_you,
                          (SELECT GROUP_CONCAT(p.name, ', ') FROM interaction_people ip JOIN people p ON p.id = ip.person_id
                           WHERE ip.interaction_id = i.id) AS people
                   FROM interactions i WHERE i.user_id = ? AND i.kind IN ('coffee_chat', 'event', 'interview')
                   ORDER BY i.bank, i.date""", (uid,)):
            banks.setdefault(e["bank"], {"bank": e["bank"], "entries": [], "people": 0})["entries"].append(dict(e))
        for r in conn.execute("SELECT bank, COUNT(*) AS n FROM people WHERE user_id = ? GROUP BY bank", (uid,)):
            if r["bank"] in banks:
                banks[r["bank"]]["people"] = r["n"]
    return {"ready": True, "since": row["ready_at"], "banks": list(banks.values())}


def review_done(uid: int) -> dict:
    with connect() as conn:
        conn.execute("UPDATE reader_review SET done_at = ? WHERE user_id = ?", (datetime.now().isoformat(timespec="seconds"), uid))
    return {"ok": True}
