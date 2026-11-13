"""Move one user's tracker between databases as JSON (used to put an existing tracker on the hosted site).

Rows get new ids on import and every reference (chat attendees, questions, map arrows, deal points and the
documents they cite, thank-you drafts) is remapped, so an import can never collide with or overwrite another
account's data. The profile, writing templates, cover letters, practice history and deal documents come too;
the saved AI key does not (each site encrypts keys with its own secret, so it is re-entered in Settings).
The shared tables (question banks, application tracker, calendar) are only exported and imported by an admin.
"""
import base64
import json
import os
import tempfile

from . import stars, stories
from .db import connect, init_db

SHARED = ("questions", "applications", "calendar_items")
OWN_TABLES = ("people", "interactions", "links", "my_banks", "bank_facts", "deals", "transcripts", "thank_you_drafts",
              "agent_runs", "cover_letters", "prep_attempts", "deal_documents", "star_stories", "stories")


# Not exported: the copy of the whole tracker each assistant run keeps so it can be undone. It grows with every
# refresh (it was most of a busy account's export, enough to run the hosted server out of memory), and an import
# drops it anyway, because its ids belong to the old database.
LEFT_OUT = {"agent_runs": {"snapshot"}}


def _queries(uid: int, include_shared: bool) -> dict:
    mine = "SELECT id FROM interactions WHERE user_id = ?"
    queries = {
        "people": ("SELECT * FROM people WHERE user_id = ?", (uid,)),
        "interactions": ("SELECT * FROM interactions WHERE user_id = ?", (uid,)),
        "interaction_people": (f"SELECT * FROM interaction_people WHERE interaction_id IN ({mine})", (uid,)),
        "interaction_questions": (f"SELECT * FROM interaction_questions WHERE interaction_id IN ({mine})", (uid,)),
        "links": ("SELECT * FROM links WHERE user_id = ?", (uid,)),
        "my_banks": ("SELECT * FROM my_banks WHERE user_id = ?", (uid,)),
        "bank_facts": ("SELECT * FROM bank_facts WHERE user_id = ?", (uid,)),
        "deals": ("SELECT * FROM deals WHERE user_id = ?", (uid,)),
        "deal_points": ("SELECT * FROM deal_points WHERE deal_id IN (SELECT id FROM deals WHERE user_id = ?)", (uid,)),
        "transcripts": ("SELECT * FROM transcripts WHERE user_id = ?", (uid,)),
        "thank_you_drafts": ("SELECT * FROM thank_you_drafts WHERE user_id = ?", (uid,)),
        "agent_runs": ("SELECT * FROM agent_runs WHERE user_id = ?", (uid,)),
        "user_profiles": ("SELECT * FROM user_profiles WHERE user_id = ?", (uid,)),
        "cover_letters": ("SELECT * FROM cover_letters WHERE user_id = ?", (uid,)),
        "prep_attempts": ("SELECT * FROM prep_attempts WHERE user_id = ?", (uid,)),
        "deal_documents": ("SELECT * FROM deal_documents WHERE user_id = ?", (uid,)),
        "star_stories": ("SELECT * FROM star_stories WHERE user_id = ?", (uid,)),
        "stories": ("SELECT * FROM stories WHERE user_id = ?", (uid,)),
    }
    if include_shared:
        queries.update({t: (f"SELECT * FROM {t}", ()) for t in SHARED})
    return queries


def _rows(conn, table: str, sql: str, params: tuple):
    """One table's rows, one at a time, ready for JSON (files as base64 text)."""
    skip = LEFT_OUT.get(table, set())
    if skip:
        keep = [r[1] for r in conn.execute(f"PRAGMA table_info({table})") if r[1] not in skip]
        sql = sql.replace("SELECT *", f"SELECT {', '.join(keep)}", 1)
    for r in conn.execute(sql, params):
        row = dict(r)
        if table == "deal_documents":  # the original files travel as text inside the JSON
            row["data"] = base64.b64encode(row["data"]).decode()
        elif table == "user_profiles" and isinstance(row.get("cover_template"), (bytes, bytearray)):
            row["cover_template"] = "b64:" + base64.b64encode(row["cover_template"]).decode()
        yield row


def export_all(uid: int, include_shared: bool) -> dict:
    init_db()
    stars.ensure()
    stories.ensure()
    with connect(read_only=True) as conn:
        return {t: list(_rows(conn, t, sql, params)) for t, (sql, params) in _queries(uid, include_shared).items()}


def export_to_file(uid: int, include_shared: bool) -> str:
    """The same export written to a temporary file a row at a time, so a big account never has to fit in the
    server's memory (the whole JSON at once took the hosted site down). The caller deletes the file."""
    init_db()
    stars.ensure()
    stories.ensure()
    fd, path = tempfile.mkstemp(prefix="rhq-export-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as out, connect(read_only=True) as conn:
            out.write("{")
            for n, (table, (sql, params)) in enumerate(_queries(uid, include_shared).items()):
                out.write(f'{", " if n else ""}{json.dumps(table)}: [')
                for i, row in enumerate(_rows(conn, table, sql, params)):
                    out.write((", " if i else "") + json.dumps(row))
                out.write("]")
            out.write("}")
    except BaseException:
        os.unlink(path)
        raise
    return path


def _insert(conn, table: str, row: dict, columns: set[str], drop_id: bool = True) -> int:
    row = {k: v for k, v in row.items() if k in columns and not (drop_id and k == "id")}
    return conn.execute(f"INSERT INTO {table} ({', '.join(row)}) VALUES ({', '.join('?' * len(row))})", list(row.values())).lastrowid


def import_all(uid: int, data: dict, is_admin: bool, replace: bool = False) -> dict:
    """Load an export into this user's account. Refuses if the account already has a tracker, unless replace."""
    init_db()
    stars.ensure()
    stories.ensure()
    conn = connect()
    try:
        with conn:
            if conn.execute("SELECT 1 FROM people WHERE user_id = ?", (uid,)).fetchone() and not replace:
                return {"ok": False, "reason": "This account already has a tracker. Pass replace=true to overwrite it."}
            cols = {t: {r[1] for r in conn.execute(f"PRAGMA table_info({t})")} for t in (
                *OWN_TABLES, "interaction_people", "interaction_questions", "deal_points", "user_profiles", *SHARED)}
            mine = "SELECT id FROM interactions WHERE user_id = ?"
            for sql in (f"DELETE FROM interaction_people WHERE interaction_id IN ({mine})",
                        f"DELETE FROM interaction_questions WHERE interaction_id IN ({mine})",
                        "DELETE FROM deal_points WHERE deal_id IN (SELECT id FROM deals WHERE user_id = ?)",
                        *(f"DELETE FROM {t} WHERE user_id = ?" for t in OWN_TABLES)):
                conn.execute(sql, (uid,))

            own = lambda row: {**row, "user_id": uid}
            people = {r["id"]: _insert(conn, "people", own(r), cols["people"]) for r in data.get("people", [])}
            chats = {r["id"]: _insert(conn, "interactions", own(r), cols["interactions"]) for r in data.get("interactions", [])}
            deals = {r["id"]: _insert(conn, "deals", own(r), cols["deals"]) for r in data.get("deals", [])}
            docs = {}
            for r in data.get("deal_documents", []):
                if r["deal_id"] in deals:
                    row = {**own(r), "deal_id": deals[r["deal_id"]], "data": base64.b64decode(r["data"])}
                    docs[str(r["id"])] = str(_insert(conn, "deal_documents", row, cols["deal_documents"]))
            for r in data.get("interaction_people", []):
                if r["interaction_id"] in chats and r["person_id"] in people:
                    _insert(conn, "interaction_people", {**r, "interaction_id": chats[r["interaction_id"]], "person_id": people[r["person_id"]]},
                            cols["interaction_people"], drop_id=False)
            for r in data.get("interaction_questions", []):
                if r["interaction_id"] in chats:
                    _insert(conn, "interaction_questions", {**r, "interaction_id": chats[r["interaction_id"]]}, cols["interaction_questions"])
            for r in data.get("deal_points", []):
                if r["deal_id"] in deals:
                    doc = str(r.get("doc_id") or "")
                    _insert(conn, "deal_points", {**r, "deal_id": deals[r["deal_id"]], "doc_id": docs.get(doc, "")}, cols["deal_points"])
            remap = {"person": people, "interaction": chats}
            for r in data.get("links", []):
                ends = []
                for end in (r["src"], r["dst"]):
                    kind, _, old = end.partition(":")
                    new = remap.get(kind, {}).get(int(old)) if old.isdigit() else None
                    ends.append(f"{kind}:{new}" if new else None)
                if all(ends):
                    _insert(conn, "links", {**own(r), "src": ends[0], "dst": ends[1]}, cols["links"])
            for r in data.get("thank_you_drafts", []):
                if r["interaction_id"] in chats and r["person_id"] in people:
                    _insert(conn, "thank_you_drafts", {**own(r), "interaction_id": chats[r["interaction_id"]], "person_id": people[r["person_id"]]},
                            cols["thank_you_drafts"])
            for table in ("my_banks", "bank_facts", "transcripts", "cover_letters", "prep_attempts", "star_stories", "stories"):
                for r in data.get(table, []):
                    _insert(conn, table, own(r), cols[table], drop_id=table != "my_banks")
            for r in data.get("agent_runs", []):
                _insert(conn, "agent_runs", {**own(r), "snapshot": None}, cols["agent_runs"])  # old snapshots use the old ids
            for r in data.get("user_profiles", [])[:1]:
                conn.execute("DELETE FROM user_profiles WHERE user_id = ?", (uid,))
                if str(r.get("cover_template") or "").startswith("b64:"):
                    r = {**r, "cover_template": base64.b64decode(r["cover_template"][4:])}
                _insert(conn, "user_profiles", own(r), cols["user_profiles"], drop_id=False)

            shared = {}
            if is_admin:
                for r in data.get("questions", []):
                    conn.execute(f"INSERT OR IGNORE INTO questions ({', '.join(k for k in r if k != 'id')}) VALUES ({', '.join('?' * (len(r) - 1))})",
                                 [v for k, v in r.items() if k != "id"])
                for r in data.get("applications", []):
                    conn.execute(f"INSERT OR IGNORE INTO applications ({', '.join(r)}) VALUES ({', '.join('?' * len(r))})", list(r.values()))
                if not conn.execute("SELECT 1 FROM calendar_items").fetchone():
                    for r in data.get("calendar_items", []):
                        _insert(conn, "calendar_items", r, cols["calendar_items"])
                shared = {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in SHARED}
        counts = {t: len(data.get(t, [])) for t in ("people", "interactions", "deals", "bank_facts", "cover_letters", "prep_attempts",
                                                    "deal_documents", "user_profiles")}
        return {"ok": True, "imported": counts, "shared_totals": shared}
    finally:
        conn.close()


def dumps(data: dict) -> str:
    return json.dumps(data)
