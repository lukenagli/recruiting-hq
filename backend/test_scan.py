"""Admin: try a new student's first scan on your own Outlook, into a test tracker, and compare it with your own.

While a test scan is on, the admin's reader files into a test tracker instead of the admin's: it starts empty (only
the setup a new student does: school and banks), reads everything since September the way a first refresh does, and
runs under its own daily allowance, as a new student's account would. The test tracker can't be signed in to (no
password, an address that can't receive mail) and only its owner sees it, here. Stopping the test puts the reader
back on the admin's own tracker, which the test never touches.
"""
import json
import re
from datetime import datetime

from . import normalize as nz
from .db import connect, init_db

DOMAIN = "test-scan.invalid"
SCHEMA = """
CREATE TABLE IF NOT EXISTS test_scans (
    owner_id    INTEGER PRIMARY KEY,
    sandbox_id  INTEGER NOT NULL,
    started_at  TEXT NOT NULL,
    active      INTEGER NOT NULL DEFAULT 1
);
"""


def ensure() -> None:
    init_db()
    with connect() as conn:
        conn.executescript(SCHEMA)


def is_test(email: str) -> bool:
    return (email or "").lower().endswith("@" + DOMAIN)


def _row(owner_id: int):
    ensure()
    with connect(read_only=True) as conn:
        return conn.execute("SELECT * FROM test_scans WHERE owner_id = ?", (owner_id,)).fetchone()


def target(user: dict) -> dict:
    """The account the reader files into: the test tracker while its owner's test scan is on, else the user."""
    row = _row(user["id"])
    if not row or not row["active"]:
        return user
    with connect(read_only=True) as conn:
        sb = conn.execute("SELECT id, email, name FROM users WHERE id = ?", (row["sandbox_id"],)).fetchone()
    if sb is None:
        return user
    return {**user, "id": sb["id"], "email": sb["email"], "test_of": user}


def _wipe(conn, uid: int) -> None:
    """Every row of one (test) account."""
    tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")]
    cols = {t: {r[1] for r in conn.execute(f"PRAGMA table_info({t})")} for t in tables}
    mine = "SELECT id FROM interactions WHERE user_id = ?"
    for t in ("interaction_people", "interaction_questions"):
        if t in cols:
            conn.execute(f"DELETE FROM {t} WHERE interaction_id IN ({mine})", (uid,))
    if "deal_points" in cols:
        conn.execute("DELETE FROM deal_points WHERE deal_id IN (SELECT id FROM deals WHERE user_id = ?)", (uid,))
    for t in tables:
        if "user_id" in cols[t]:
            conn.execute(f"DELETE FROM {t} WHERE user_id = ?", (uid,))
    conn.execute("DELETE FROM users WHERE id = ?", (uid,))


def start(owner: dict) -> dict:
    """A fresh test tracker (an earlier one is cleared), with the owner's setup copied: school and their banks with
    group preferences, nothing else."""
    ensure()
    now = datetime.now().isoformat(timespec="seconds")
    with connect() as conn:
        old = conn.execute("SELECT sandbox_id FROM test_scans WHERE owner_id = ?", (owner["id"],)).fetchone()
        if old:
            _wipe(conn, old["sandbox_id"])
        email = f"scan-{owner['id']}@{DOMAIN}"
        conn.execute("DELETE FROM users WHERE LOWER(email) = ?", (email,))
        cols = {r[1] for r in conn.execute("PRAGMA table_info(users)")}
        row = {"email": email, "name": owner["name"], "password_hash": "", "is_admin": 0, "created_at": now}
        if "email_verified_at" in cols:
            row["email_verified_at"] = now
        sid = conn.execute(f"INSERT INTO users ({', '.join(row)}) VALUES ({', '.join('?' * len(row))})", list(row.values())).lastrowid
        prof = conn.execute("SELECT * FROM user_profiles WHERE user_id = ?", (owner["id"],)).fetchone()
        if prof:
            keep = {k: prof[k] for k in prof.keys() if k in ("school", "level", "class_year", "target_groups", "school_line", "onboarded_at")}
            keep["user_id"] = sid
            conn.execute(f"INSERT INTO user_profiles ({', '.join(keep)}) VALUES ({', '.join('?' * len(keep))})", list(keep.values()))
        for b in conn.execute("SELECT bank, prefs FROM my_banks WHERE user_id = ?", (owner["id"],)).fetchall():
            conn.execute("INSERT INTO my_banks (user_id, bank, applied, deadline, link, prefs, notes) VALUES (?, ?, '', '', '', ?, '')",
                         (sid, b["bank"], b["prefs"] or ""))
        conn.execute("""INSERT INTO test_scans (owner_id, sandbox_id, started_at, active) VALUES (?, ?, ?, 1)
                        ON CONFLICT(owner_id) DO UPDATE SET sandbox_id = excluded.sandbox_id, started_at = excluded.started_at, active = 1""",
                     (owner["id"], sid, now))
    return status(owner)


def stop(owner: dict) -> dict:
    """The reader goes back to the owner's own tracker; the test tracker is kept for comparing."""
    ensure()
    with connect() as conn:
        conn.execute("UPDATE test_scans SET active = 0 WHERE owner_id = ?", (owner["id"],))
    return status(owner)


def delete(owner: dict) -> dict:
    ensure()
    with connect() as conn:
        row = conn.execute("SELECT sandbox_id FROM test_scans WHERE owner_id = ?", (owner["id"],)).fetchone()
        if row:
            _wipe(conn, row["sandbox_id"])
            conn.execute("DELETE FROM test_scans WHERE owner_id = ?", (owner["id"],))
    return status(owner)


def status(owner: dict) -> dict:
    row = _row(owner["id"])
    if not row:
        return {"exists": False}
    sid = row["sandbox_id"]
    with connect(read_only=True) as conn:
        count = lambda sql: conn.execute(sql, (sid,)).fetchone()[0]  # noqa: E731
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        runs = conn.execute("""SELECT COUNT(*) AS n, COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens,
                                      COALESCE(SUM(cached_input_tokens), 0) AS cached, MIN(started_at) AS first, MAX(started_at) AS last
                               FROM agent_runs WHERE user_id = ?""", (sid,)).fetchone()
        days = [dict(r) for r in conn.execute("""SELECT SUBSTR(started_at, 1, 10) AS day, COUNT(*) AS runs, SUM(input_tokens + output_tokens) AS tokens
                                                 FROM agent_runs WHERE user_id = ? GROUP BY day ORDER BY day""", (sid,))]
        log = [dict(r) for r in conn.execute("SELECT at, conversation, received, new, filed, note FROM sync_log WHERE user_id = ? ORDER BY id",
                                             (sid,))] if "sync_log" in tables else []
        out = {"exists": True, "active": bool(row["active"]), "started_at": row["started_at"],
               "people": count("SELECT COUNT(*) FROM people WHERE user_id = ?"),
               "entries": count("SELECT COUNT(*) FROM interactions WHERE user_id = ?"),
               "banks": count("SELECT COUNT(DISTINCT bank) FROM interactions WHERE user_id = ?"),
               "runs": runs["n"], "tokens": runs["tokens"], "cached_tokens": runs["cached"], "first_run": runs["first"],
               "last_run": runs["last"], "by_day": days,
               "refreshes": len({entry["at"][:16] for entry in log}),
               "folders": len({entry["conversation"] for entry in log}),
               "emails_new": sum(entry["new"] for entry in log), "emails_filed": sum(entry["filed"] for entry in log),
               "allowance_stops": sum(1 for entry in log if "allowance" in (entry["note"] or ""))}
    return out


# ---- comparing the test tracker with the owner's own ----

def _name(n: str) -> str:
    return " ".join(re.sub(r"[^a-z ]", " ", (n or "").lower()).split())


def _tracker(conn, uid: int) -> dict:
    people = {r["id"]: dict(r) for r in conn.execute("SELECT id, name, bank, title, grp, alum, email, origin FROM people WHERE user_id = ?", (uid,))}
    entries = []
    for r in conn.execute("SELECT id, bank, kind, title, date, status, format, thank_you, date_note FROM interactions WHERE user_id = ?", (uid,)):
        e = dict(r)
        e["people"] = sorted(people[p[0]]["name"] for p in conn.execute("SELECT person_id FROM interaction_people WHERE interaction_id = ?", (e["id"],))
                             if p[0] in people)
        entries.append(e)
    banks = {r["bank"]: dict(r) for r in conn.execute("SELECT bank, applied, status, notes FROM my_banks WHERE user_id = ?", (uid,))}
    return {"people": people, "entries": entries, "banks": banks}


def _origins(conn, uid: int) -> tuple[dict, dict]:
    """Where each of the owner's people and entries first came from: 'email' (the reader), or 'typed' (anything else:
    the update box, a recording, a catch-up form, an edit by hand, a roster), or '' when the logs don't say."""
    people, entries = {}, {}
    for r in conn.execute("SELECT user_message, steps FROM agent_runs WHERE user_id = ? ORDER BY id", (uid,)):
        how = "email" if (r["user_message"] or "").startswith("New messages from") else "typed"
        try:
            steps = json.loads(r["steps"] or "[]")
        except ValueError:
            continue
        for s in steps if isinstance(steps, list) else []:
            res = s.get("result") or {}
            if not isinstance(res, dict):
                continue
            if res.get("entry_id"):
                entries.setdefault(res["entry_id"], how)
            if res.get("person_id"):
                people.setdefault(res["person_id"], how)
    return people, entries


def _days(a: str, b: str) -> int:
    try:
        return abs((datetime.fromisoformat(a) - datetime.fromisoformat(b)).days)
    except (TypeError, ValueError):
        return 99


def _same_entry(a: dict, b: dict) -> bool:
    if nz.bank(a["bank"]) != nz.bank(b["bank"]):
        return False
    shared = {_name(x) for x in a["people"]} & {_name(x) for x in b["people"]}
    near = _days(a["date"], b["date"]) <= 3 if a["date"] and b["date"] else False
    title = _name(a["title"]) == _name(b["title"])
    kinds = a["kind"] == b["kind"] or {a["kind"], b["kind"]} <= {"step", "event"}
    return kinds and (title or (shared and (near or not (a["date"] and b["date"]))) or (near and a["kind"] in ("event", "interview")
                                                                                    and not a["people"] and not b["people"]))


def compare(owner: dict) -> dict:
    row = _row(owner["id"])
    if not row:
        return {"exists": False}
    with connect(read_only=True) as conn:
        mine, test = _tracker(conn, owner["id"]), _tracker(conn, row["sandbox_id"])
        p_origin, e_origin = _origins(conn, owner["id"])
    key = lambda p: (nz.bank(p["bank"]), _name(p["name"]))  # noqa: E731
    test_people = {key(p): p for p in test["people"].values()}
    surname = {(nz.bank(p["bank"]), _name(p["name"]).split()[-1]): p for p in test["people"].values() if _name(p["name"])}
    people_missing, people_found = [], 0
    for p in mine["people"].values():
        k = key(p)
        hit = test_people.get(k) or (surname.get((k[0], k[1].split()[-1])) if k[1] else None)
        if hit:
            people_found += 1
        else:
            people_missing.append({"name": p["name"], "bank": p["bank"], "title": p["title"], "origin": p["origin"],
                                   "came_from": p_origin.get(p["id"], "")})
    mine_keys = {key(p) for p in mine["people"].values()}
    mine_surnames = {(k[0], k[1].split()[-1]) for k in mine_keys if k[1]}
    people_extra = [{"name": p["name"], "bank": p["bank"], "title": p["title"]} for p in test["people"].values()
                    if key(p) not in mine_keys and (key(p)[0], key(p)[1].split()[-1] if key(p)[1] else "") not in mine_surnames]
    used, entries_missing, entries_found, differences = set(), [], 0, []
    for e in mine["entries"]:
        hit = next((t for t in test["entries"] if t["id"] not in used and _same_entry(e, t)), None)
        if hit:
            used.add(hit["id"])
            entries_found += 1
            diff = {f: [e[f], hit[f]] for f in ("date", "status", "kind") if (e[f] or "") != (hit[f] or "")}
            if bool(e["thank_you"]) != bool(hit["thank_you"]):
                diff["thank_you"] = [e["thank_you"], hit["thank_you"]]
            if diff:
                differences.append({"bank": e["bank"], "title": e["title"], "differs": diff})
        else:
            entries_missing.append({"bank": e["bank"], "kind": e["kind"], "title": e["title"], "date": e["date"], "status": e["status"],
                                    "people": e["people"], "came_from": e_origin.get(e["id"], "")})
    entries_extra = [{"bank": t["bank"], "kind": t["kind"], "title": t["title"], "date": t["date"], "status": t["status"], "people": t["people"]}
                     for t in test["entries"] if t["id"] not in used]
    out_mine = {b for b, a in mine["banks"].items() if a["status"] == "out"}
    out_test = {b for b, a in test["banks"].items() if a["status"] == "out"}
    return {"exists": True, "status": status(owner),
            "people": {"mine": len(mine["people"]), "test": len(test["people"]), "found": people_found,
                       "missing": sorted(people_missing, key=lambda p: (p["bank"], p["name"])),
                       "extra": sorted(people_extra, key=lambda p: (p["bank"], p["name"]))},
            "entries": {"mine": len(mine["entries"]), "test": len(test["entries"]), "found": entries_found,
                        "missing": sorted(entries_missing, key=lambda e: (e["bank"], e["date"] or "")),
                        "extra": sorted(entries_extra, key=lambda e: (e["bank"], e["date"] or "")), "differences": differences},
            "out_of_process": {"mine": sorted(out_mine), "test": sorted(out_test)},
            "banks_with_entries": {"mine": sorted({e["bank"] for e in mine["entries"]}), "test": sorted({e["bank"] for e in test["entries"]})}}

