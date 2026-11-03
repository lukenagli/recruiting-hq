"""Preview: direct edits to a student's own tracker, without the AI (corrections when the day's allowance is used up,
and removals the assistant can't make: a cancelled chat, a scheduling step, a note that says nothing, a recruiter
listed on an event they only organised).

Each call snapshots the tracker first and is recorded like an assistant run, so the assistant's Undo puts it back.
"""
import json
from datetime import datetime

from . import normalize as nz
from .assistant import _snapshot
from .db import connect, init_db

ENTRY_FIELDS = {"title", "kind", "date", "date_note", "format", "status", "summary", "thank_you"}
PERSON_FIELDS = {"title", "grp", "subgroup", "alum", "outreach", "notes", "email", "origin"}
APPLICATION_FIELDS = {"applied", "deadline", "notes", "office"}


class EditError(ValueError):
    pass


def delete_entry(conn, uid: int, entry_id: int) -> str:
    """Remove one entry and everything hung on it (its people, questions, thank-you draft and the notes linking it)."""
    row = conn.execute("SELECT title FROM interactions WHERE id = ? AND user_id = ?", (entry_id, uid)).fetchone()
    if row is None:
        raise EditError(f"No entry {entry_id}.")
    for sql in ("DELETE FROM interaction_people WHERE interaction_id = ?", "DELETE FROM interaction_questions WHERE interaction_id = ?",
                "DELETE FROM thank_you_drafts WHERE interaction_id = ?"):
        conn.execute(sql, (entry_id,))
    conn.execute("DELETE FROM links WHERE user_id = ? AND (src = ? OR dst = ?)", (uid, f"interaction:{entry_id}", f"interaction:{entry_id}"))
    conn.execute("DELETE FROM interactions WHERE id = ? AND user_id = ?", (entry_id, uid))
    return f"Removed {row['title']}"


def _person(conn, uid: int, pid: int):
    row = conn.execute("SELECT * FROM people WHERE id = ? AND user_id = ?", (pid, uid)).fetchone()
    if row is None:
        raise EditError(f"No person {pid}.")
    return row


def _entry(conn, uid: int, eid: int):
    row = conn.execute("SELECT * FROM interactions WHERE id = ? AND user_id = ?", (eid, uid)).fetchone()
    if row is None:
        raise EditError(f"No entry {eid}.")
    return row


def _op(conn, uid: int, op: dict) -> str:
    kind = op.get("op")
    if kind == "delete_entry":
        return delete_entry(conn, uid, int(op["id"]))
    if kind == "delete_link":
        row = conn.execute("SELECT label FROM links WHERE id = ? AND user_id = ?", (int(op["id"]), uid)).fetchone()
        if row is None:
            raise EditError(f"No note {op['id']}.")
        conn.execute("DELETE FROM links WHERE id = ? AND user_id = ?", (int(op["id"]), uid))
        return f"Removed the note {row['label']!r}"
    if kind == "relabel_link":
        if not conn.execute("SELECT 1 FROM links WHERE id = ? AND user_id = ?", (int(op["id"]), uid)).fetchone():
            raise EditError(f"No note {op['id']}.")
        conn.execute("UPDATE links SET label = ? WHERE id = ? AND user_id = ?", (nz.clean(op["label"]), int(op["id"]), uid))
        return f"Relabelled a note: {op['label']}"
    if kind == "unlink_person":
        entry, person = _entry(conn, uid, int(op["entry_id"])), _person(conn, uid, int(op["person_id"]))
        conn.execute("DELETE FROM interaction_people WHERE interaction_id = ? AND person_id = ?", (entry["id"], person["id"]))
        return f"Took {person['name']} off {entry['title']}"
    if kind == "link_people":
        entry = _entry(conn, uid, int(op["entry_id"]))
        for name in op.get("names", []):
            name = nz.clean(name)
            found = conn.execute("SELECT id FROM people WHERE user_id = ? AND bank = ? AND LOWER(name) = LOWER(?)", (uid, entry["bank"], name)).fetchone()
            pid = found["id"] if found else conn.execute(
                "INSERT INTO people (user_id, name, title, bank, grp, subgroup, email, outreach, origin, notes) VALUES (?, ?, '', ?, '', '', '', '', ?, '')",
                (uid, name, entry["bank"], "event" if entry["kind"] == "event" else "outreach")).lastrowid
            conn.execute("INSERT OR IGNORE INTO interaction_people VALUES (?, ?, '')", (entry["id"], pid))
        return f"Added {', '.join(op.get('names', []))} to {entry['title']}"
    if kind in ("update_entry", "update_person"):
        fields, table = (ENTRY_FIELDS, "interactions") if kind == "update_entry" else (PERSON_FIELDS, "people")
        row = _entry(conn, uid, int(op["id"])) if kind == "update_entry" else _person(conn, uid, int(op["id"]))
        changes = {k: nz.clean(v) for k, v in op.get("fields", {}).items()}
        bad = set(changes) - fields
        if bad:
            raise EditError(f"Can't change {sorted(bad)} on {table}.")
        for col, val in changes.items():
            conn.execute(f"UPDATE {table} SET {col} = ? WHERE id = ? AND user_id = ?", (val, row["id"], uid))
        return f"Updated {row['title'] if kind == 'update_entry' else row['name']}: {', '.join(changes)}"
    if kind == "update_application":
        changes = {k: nz.clean(v) for k, v in op.get("fields", {}).items()}
        bad = set(changes) - APPLICATION_FIELDS
        if bad:
            raise EditError(f"Can't change {sorted(bad)} on an application.")
        bank = nz.bank(op["bank"])
        if not conn.execute("SELECT 1 FROM my_banks WHERE user_id = ? AND bank = ?", (uid, bank)).fetchone():
            raise EditError(f"No application at {bank}.")
        for col, val in changes.items():
            conn.execute(f"UPDATE my_banks SET {col} = ? WHERE user_id = ? AND bank = ?", (val, uid, bank))
        return f"Updated the {bank} application: {', '.join(changes)}"
    raise EditError(f"Unknown edit {kind!r}.")


def apply(uid: int, ops: list[dict], note: str = "") -> dict:
    """Make every edit or none. Recorded with a snapshot, so the assistant's Undo reverses it."""
    init_db()
    conn = connect()
    try:
        with conn:
            snapshot = _snapshot(conn, uid)
            did = [_op(conn, uid, op) for op in ops]
            run_id = conn.execute(
                """INSERT INTO agent_runs (user_id, started_at, agent, user_message, reply, steps, outcome, snapshot)
                   VALUES (?, ?, 'tracker_edits', ?, ?, ?, 'ok', ?)""",
                (uid, datetime.now().isoformat(timespec="seconds"), note or "Tracker edits", "; ".join(did), json.dumps(ops), snapshot)).lastrowid
        return {"ok": True, "did": did, "run_id": run_id}
    except (EditError, KeyError, ValueError) as err:
        return {"ok": False, "reason": str(err)}
    finally:
        conn.close()
