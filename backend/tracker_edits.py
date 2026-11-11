"""Direct edits to a student's own tracker, without the AI (corrections when the day's allowance is used up,
and removals the assistant can't make: a cancelled chat, a scheduling step, a note that says nothing, a recruiter
listed on an event they only organised).

Each call snapshots the tracker first and is recorded like an assistant run, so the assistant's Undo puts it back.
"""
import json
import re
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
        # notes keep their lines and bullet indents
        changes = {k: (_keep_lines(v) if k in ("summary", "notes") else nz.clean(v)) for k, v in op.get("fields", {}).items()}
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
    if kind == "add_chat":
        return add_chat(conn, uid, op)
    if kind == "rename_person":  # {id, name}: the reader spelled a name wrong
        person, name = _person(conn, uid, int(op["id"])), nz.clean(op.get("name"))[:120]
        if not name:
            raise EditError("A name is needed.")
        twin = conn.execute("SELECT id FROM people WHERE user_id = ? AND bank = ? AND LOWER(name) = LOWER(?) AND id != ?",
                            (uid, person["bank"], name, person["id"])).fetchone()
        if twin:
            raise EditError(f"{name} is already in your tracker at {person['bank']}.")
        conn.execute("UPDATE people SET name = ? WHERE id = ? AND user_id = ?", (name, person["id"], uid))
        for e in conn.execute("SELECT i.id, i.title FROM interactions i JOIN interaction_people ip ON ip.interaction_id = i.id "
                              "WHERE ip.person_id = ? AND i.title LIKE ?", (person["id"], f"%{person['name']}%")).fetchall():
            conn.execute("UPDATE interactions SET title = ? WHERE id = ?", (e["title"].replace(person["name"], name), e["id"]))
        return f"Renamed {person['name']} to {name}"
    if kind == "move_person":  # {id, bank}: the reader put someone at the wrong bank; their own chats go with them
        return _move_person(conn, uid, int(op["id"]), nz.bank(op.get("bank")))
    if kind == "move_entry":  # {id, bank}: an entry with no one on it (an info session) filed under the wrong bank
        entry, bank = _entry(conn, uid, int(op["id"])), nz.bank(op.get("bank"))
        if not bank or bank == nz.UNKNOWN:
            raise EditError("A bank is needed.")
        _own_bank(conn, uid, bank)
        conn.execute("UPDATE interactions SET bank = ? WHERE id = ? AND user_id = ?", (bank, entry["id"], uid))
        conn.execute("UPDATE links SET bank = ? WHERE user_id = ? AND (src = ? OR dst = ?)", (bank, uid, f"interaction:{entry['id']}", f"interaction:{entry['id']}"))
        return f"Moved {entry['title']} to {bank}"
    if kind == "delete_person":  # someone the student never spoke with (a roster name): only if no entry or draft has them
        person = _person(conn, uid, int(op["id"]))
        if conn.execute("SELECT 1 FROM interaction_people WHERE person_id = ?", (person["id"],)).fetchone() or conn.execute(
                "SELECT 1 FROM thank_you_drafts WHERE person_id = ?", (person["id"],)).fetchone():
            raise EditError(f"{person['name']} is on an entry; take them off it first.")
        conn.execute("DELETE FROM links WHERE user_id = ? AND (src = ? OR dst = ?)", (uid, f"person:{person['id']}", f"person:{person['id']}"))
        conn.execute("DELETE FROM people WHERE id = ? AND user_id = ?", (person["id"], uid))
        return f"Removed {person['name']}"
    if kind == "add_entry":  # an event or step by hand: {bank, kind, title, date, status, summary, format, date_note, thank_you, people: [{name, title, grp, notes}]}
        return add_entry(conn, uid, op)
    if kind == "add_questions":  # what was asked in a chat: {entry_id, asked_me: [...], i_asked: [...]}
        entry = _entry(conn, uid, int(op["entry_id"]))
        n = 0
        for direction in ("asked_me", "i_asked"):
            for q in op.get(direction, []):
                q = nz.clean(q)
                if q and not conn.execute("SELECT 1 FROM interaction_questions WHERE interaction_id = ? AND direction = ? AND question = ?",
                                          (entry["id"], direction, q)).fetchone():
                    conn.execute("INSERT INTO interaction_questions (interaction_id, direction, question) VALUES (?, ?, ?)",
                                 (entry["id"], direction, q))
                    n += 1
        return f"Added {n} question{'s' if n != 1 else ''} to {entry['title']}"
    if kind == "set_facts":  # one topic of a bank's overview, rewritten: {bank, category, lines: [...]}
        from . import fact_tidy
        from .assistant import FACT_CATEGORIES

        bank, category = nz.bank(op["bank"]), op.get("category", "")
        if category not in FACT_CATEGORIES:
            raise EditError(f"category must be one of {FACT_CATEGORIES}.")
        n = fact_tidy.replace(conn, uid, bank, category, op.get("lines", []), nz.clean(op.get("source", "")))
        return f"Set the {bank} {category} to {n} line{'s' if n != 1 else ''}"
    raise EditError(f"Unknown edit {kind!r}.")


def _keep_lines(value) -> str:
    """Notes as written: each line's indent kept (bullet levels), other runs of spaces tidied, at most one blank line."""
    lines = []
    for line in str(value or "").replace("\r", "").split("\n"):
        indent = len(line) - len(line.lstrip(" "))
        lines.append(" " * min(indent, 8) + re.sub(r"[ \t\f\v]+", " ", line.strip()))
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip("\n")[:12000]


def add_chat(conn, uid: int, op: dict) -> str:
    """A coffee chat the student enters by hand: the date they spoke, who (name, role, bank, group, alum or not) and their notes.
    The person is found or added at that bank, and the bank joins their list if it isn't on it. A chat with that person
    still waiting as a request or upcoming becomes this chat rather than a second one."""
    name, bank, day = nz.clean(op.get("name")), nz.bank(op.get("bank")), nz.clean(op.get("date"))
    if not name or not bank:
        raise EditError("A coffee chat needs the person's name and bank.")
    try:
        datetime.strptime(day, "%Y-%m-%d")
    except ValueError:
        raise EditError("A coffee chat needs the date you spoke (YYYY-MM-DD).") from None
    alum = {"yes": "yes", "no": "no"}.get(nz.clean(op.get("alum")).lower(), "")
    group, notes = nz.clean(op.get("group")), _keep_lines(op.get("notes"))  # notes keep their bullets and indents
    title = nz.clean(op.get("title"))[:80]
    if title.lower().startswith("2y"):
        title = "2Y"  # a second-year student, as the tracker writes it
    conn.execute("INSERT OR IGNORE INTO my_banks (user_id, bank, applied, deadline, link, prefs, notes) VALUES (?, ?, '', '', '', '', '')", (uid, bank))
    found = conn.execute("SELECT id, name FROM people WHERE user_id = ? AND bank = ? AND LOWER(name) = LOWER(?)", (uid, bank, name)).fetchone()
    if found:
        pid, name = found["id"], found["name"]  # as the tracker already spells it
        for col, val in (("grp", group), ("alum", alum), ("title", title)):
            if val:
                conn.execute(f"UPDATE people SET {col} = ? WHERE id = ?", (val, pid))
    else:
        pid = conn.execute(
            "INSERT INTO people (user_id, name, title, bank, grp, subgroup, email, outreach, origin, notes, alum) VALUES (?, ?, ?, ?, ?, '', '', '', 'outreach', '', ?)",
            (uid, name, title, bank, group, alum)).lastrowid
    status = "done" if day <= datetime.now().strftime("%Y-%m-%d") else "upcoming"
    waiting = next((r for r in conn.execute(
        """SELECT i.id, i.kind, i.title FROM interactions i JOIN interaction_people ip ON ip.interaction_id = i.id
           WHERE i.user_id = ? AND ip.person_id = ? AND i.kind IN ('coffee_chat', 'step') AND i.status IN ('todo', 'upcoming')
           ORDER BY i.date""", (uid, pid)) if r["kind"] == "coffee_chat" or re.search(r"coffee|chat", r["title"] or "", re.I)), None)
    if waiting:
        conn.execute("UPDATE interactions SET kind = 'coffee_chat', title = ?, date = ?, status = ?, summary = ? WHERE id = ?",
                     (f"Coffee chat with {name}", day, status, notes, waiting["id"]))
    else:
        eid = conn.execute(
            """INSERT INTO interactions (user_id, bank, kind, title, date, date_note, format, status, summary, thank_you)
               VALUES (?, ?, 'coffee_chat', ?, ?, '', '', ?, ?, '')""", (uid, bank, f"Coffee chat with {name}", day, status, notes)).lastrowid
        conn.execute("INSERT OR IGNORE INTO interaction_people VALUES (?, ?, '')", (eid, pid))
    return f"Added a coffee chat with {name} ({bank}) on {day}"


def _own_bank(conn, uid: int, bank: str) -> None:
    conn.execute("INSERT OR IGNORE INTO my_banks (user_id, bank, applied, deadline, link, prefs, notes) VALUES (?, ?, '', '', '', '', '')", (uid, bank))


def _move_person(conn, uid: int, pid: int, bank: str) -> str:
    """Move someone to the bank they're really at. Their chats and anything only they are on go too; on an entry with
    other people (an event at the old bank) they're taken off it. Someone of the same name already at the new bank is
    the same person: the two become one."""
    person = _person(conn, uid, pid)
    if not bank or bank == nz.UNKNOWN:
        raise EditError("A bank is needed.")
    if bank == person["bank"]:
        return f"{person['name']} is already at {bank}"
    _own_bank(conn, uid, bank)
    for e in conn.execute("SELECT interaction_id AS id FROM interaction_people WHERE person_id = ?", (pid,)).fetchall():
        others = conn.execute("SELECT COUNT(*) FROM interaction_people WHERE interaction_id = ? AND person_id != ?", (e["id"], pid)).fetchone()[0]
        if others:
            conn.execute("DELETE FROM interaction_people WHERE interaction_id = ? AND person_id = ?", (e["id"], pid))
        else:
            conn.execute("UPDATE interactions SET bank = ? WHERE id = ? AND user_id = ?", (bank, e["id"], uid))
            conn.execute("UPDATE links SET bank = ? WHERE user_id = ? AND (src = ? OR dst = ?)", (bank, uid, f"interaction:{e['id']}", f"interaction:{e['id']}"))
    conn.execute("UPDATE links SET bank = ? WHERE user_id = ? AND (src = ? OR dst = ?)", (bank, uid, f"person:{pid}", f"person:{pid}"))
    twin = conn.execute("SELECT id FROM people WHERE user_id = ? AND bank = ? AND LOWER(name) = LOWER(?)", (uid, bank, person["name"])).fetchone()
    if twin:
        conn.execute("UPDATE OR IGNORE interaction_people SET person_id = ? WHERE person_id = ?", (twin["id"], pid))
        conn.execute("DELETE FROM interaction_people WHERE person_id = ?", (pid,))
        conn.execute("UPDATE thank_you_drafts SET person_id = ? WHERE user_id = ? AND person_id = ?", (twin["id"], uid, pid))
        for end in ("src", "dst"):
            conn.execute(f"UPDATE links SET {end} = ? WHERE user_id = ? AND {end} = ?", (f"person:{twin['id']}", uid, f"person:{pid}"))
        conn.execute("DELETE FROM people WHERE id = ? AND user_id = ?", (pid, uid))
        return f"Moved {person['name']} to {bank} (already there, so the two are one now)"
    conn.execute("UPDATE people SET bank = ? WHERE id = ? AND user_id = ?", (bank, pid, uid))
    return f"Moved {person['name']} to {bank}"


def add_entry(conn, uid: int, op: dict) -> str:
    """An event or step the student adds by hand, with the people met there (found or added at that bank)."""
    bank, kind, title, day = nz.bank(op.get("bank")), nz.clean(op.get("kind")), nz.clean(op.get("title")), nz.clean(op.get("date"))
    if not bank or not title or kind not in ("event", "step", "interview"):
        raise EditError("An entry needs a bank, a title and a kind (event, step or interview).")
    try:
        datetime.strptime(day, "%Y-%m-%d")
    except ValueError:
        raise EditError("An entry needs its date (YYYY-MM-DD).") from None
    status = nz.clean(op.get("status")) or ("done" if day <= datetime.now().strftime("%Y-%m-%d") else "upcoming")
    conn.execute("INSERT OR IGNORE INTO my_banks (user_id, bank, applied, deadline, link, prefs, notes) VALUES (?, ?, '', '', '', '', '')", (uid, bank))
    eid = conn.execute(
        """INSERT INTO interactions (user_id, bank, kind, title, date, date_note, format, status, summary, thank_you)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (uid, bank, kind, title, day, nz.clean(op.get("date_note")), nz.clean(op.get("format")), status,
         nz.clean_text(op.get("summary")), nz.clean(op.get("thank_you")))).lastrowid
    for p in op.get("people", []):
        name = nz.clean(p.get("name"))
        if not name:
            continue
        found = conn.execute("SELECT id FROM people WHERE user_id = ? AND bank = ? AND LOWER(name) = LOWER(?)", (uid, bank, name)).fetchone()
        if found:
            pid = found["id"]
            for col in ("title", "grp"):
                if nz.clean(p.get(col)):
                    conn.execute(f"UPDATE people SET {col} = ? WHERE id = ? AND (COALESCE({col}, '') = '')", (nz.clean(p.get(col)), pid))
        else:
            pid = conn.execute(
                "INSERT INTO people (user_id, name, title, bank, grp, subgroup, email, outreach, origin, notes) VALUES (?, ?, ?, ?, ?, '', '', '', ?, ?)",
                (uid, name, nz.clean(p.get("title")), bank, nz.clean(p.get("grp")), "event" if kind == "event" else "outreach",
                 nz.clean(p.get("person_notes")))).lastrowid
        conn.execute("INSERT OR IGNORE INTO interaction_people VALUES (?, ?, ?)", (eid, pid, nz.clean(p.get("notes"))))
    return f"Added {title} ({bank}) on {day}"


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
