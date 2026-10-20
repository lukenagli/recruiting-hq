"""Read-side queries for the home page, the recruiting map and interview prep."""
import json
import re
from datetime import date

from . import banks as bank_info
from .db import connect, init_db

ROUND_ORDER = ["Coffee Chat", "HireVue", "Round 1", "Round 2", "Superday", "Unknown"]


def _all(conn, sql, params=()):
    return [dict(r) for r in conn.execute(sql, params)]


def _person_status(person: dict, chats: list[dict]) -> str:
    if person["origin"] == "listed":  # a known contact the user has not spoken with
        return "not_spoken"
    if any(c["status"] == "done" for c in chats):
        return "spoke"
    if any(c["status"] == "upcoming" for c in chats):
        return "scheduled"
    if any(c["status"] == "todo" for c in chats):  # a chat being rescheduled
        return "awaiting"
    if person["origin"] == "event" or person.get("events"):
        return "met"
    if person["origin"] == "classmate":
        return "known"
    if "No reply" in (person["notes"] or ""):
        return "no_reply"
    return "awaiting" if person["outreach"] else "not_contacted"


MINE = "SELECT id FROM interactions WHERE user_id = ?"


def _load(conn, uid: int) -> dict:
    """Everything in one user's tracker. Every query is filtered to that user."""
    people = _all(conn, "SELECT * FROM people WHERE user_id = ? ORDER BY name", (uid,))
    interactions = _all(conn, "SELECT * FROM interactions WHERE user_id = ? ORDER BY date = '', date, id", (uid,))
    joins = _all(conn, f"SELECT * FROM interaction_people WHERE interaction_id IN ({MINE})", (uid,))
    questions = _all(conn, f"SELECT * FROM interaction_questions WHERE interaction_id IN ({MINE}) ORDER BY id", (uid,))
    by_id = {i["id"]: i for i in interactions}
    drafts = {r["interaction_id"]: r for r in _all(
        conn, "SELECT id, interaction_id, body, check_line, send_line, sent_at FROM thank_you_drafts WHERE user_id = ? ORDER BY id", (uid,))}
    for i in interactions:
        i["draft"] = drafts.get(i["id"])
        i["people"] = [j for j in joins if j["interaction_id"] == i["id"]]
        i["asked_me"] = [q["question"] for q in questions if q["interaction_id"] == i["id"] and q["direction"] == "asked_me"]
        i["i_asked"] = [q["question"] for q in questions if q["interaction_id"] == i["id"] and q["direction"] == "i_asked"]
    for p in people:
        mine = [by_id[j["interaction_id"]] for j in joins if j["person_id"] == p["id"]]
        p["chats"] = [i for i in mine if i["kind"] == "coffee_chat"]
        p["events"] = [
            {"id": i["id"], "title": i["title"], "date": i["date"], "date_note": i["date_note"],
             "notes": next(j["notes"] for j in i["people"] if j["person_id"] == p["id"])}
            for i in mine if i["kind"] != "coffee_chat"
        ]
        p["status"] = _person_status(p, p["chats"])
        p["background_sources"] = json.loads(p.get("background_sources") or "[]")
    return {
        "people": people,
        "interactions": interactions,
        "links": _all(conn, "SELECT * FROM links WHERE user_id = ?", (uid,)),
        "my_banks": {r["bank"]: r for r in _all(conn, "SELECT * FROM my_banks WHERE user_id = ?", (uid,))},
        "shared_apps": {r["bank"]: r for r in _all(conn, "SELECT * FROM applications")},
        "question_counts": {
            r["bank"]: r["n"] for r in _all(conn, "SELECT bank, COUNT(*) AS n FROM questions GROUP BY bank")
        },
    }


def _application(data: dict, bank: str) -> dict:
    mine, shared = data["my_banks"].get(bank) or {}, data["shared_apps"].get(bank) or {}
    return {
        "applied": mine.get("applied") or "",
        "deadline": mine.get("deadline") or shared.get("official_deadline") or "",
        "recommended_date": shared.get("recommended_date") or "",
        "link": mine.get("link") or shared.get("link") or "",
        "cover_letter": shared.get("cover_letter") or "",
        "other_info": shared.get("other_info") or "",
        "prefs": mine.get("prefs") or "",
        "status": mine.get("status") or "",
        "stage": mine.get("stage") or "",
        "notes": mine.get("notes") or "",
    }


# How MBA banking recruiting runs at Yale SOM: an unofficial round with Yale alumni and 2Ys, who decide
# who to push; then the bank and group itself; then invite-only dinners; then Super Week; then offers.
STAGES = [("yale", "Yale network"), ("bank", "Bank and group"), ("dinner", "Invite-only dinners"),
          ("superday", "Superday"), ("offer", "Offer")]
STAGE_KEYS = [k for k, _ in STAGES]


def _stage(people: list[dict], app: dict) -> tuple[str, list[dict]]:
    """The user's stage at a bank: whatever they have set, otherwise "yale" once they have any contact there."""
    current = app["stage"] if app["stage"] in STAGE_KEYS else ("yale" if people else "")
    reached = STAGE_KEYS.index(current) if current else -1
    return current, [{"key": k, "label": label, "done": i <= reached} for i, (k, label) in enumerate(STAGES)]


def _bank_summary(data: dict, bank: str, today: str) -> dict:
    people = [p for p in data["people"] if p["bank"] == bank and p["origin"] != "listed"]
    interactions = [i for i in data["interactions"] if i["bank"] == bank]
    app = _application(data, bank)
    upcoming = [i for i in interactions if i["status"] == "upcoming" and i["date"] >= today]
    dated = [i["date"] for i in interactions if i["status"] == "done" and i["date"]]
    current, stage = _stage(people, app)
    yale = [p for p in people if p["alum"] in ("yes", "student")]
    return {
        "current_stage": current,
        "yale_contacts": len(yale),
        "yale_spoken": sum(p["status"] in ("spoke", "met") for p in yale),
        "bank": bank,
        "domain": bank_info.domain(bank),
        "people": len(people),
        "spoke": sum(p["status"] in ("spoke", "met") for p in people),
        "scheduled": sum(p["status"] == "scheduled" for p in people),
        "awaiting": sum(p["status"] in ("awaiting", "no_reply") for p in people),
        "last_touch": max(dated) if dated else "",
        "next_up": {"title": upcoming[0]["title"], "date": upcoming[0]["date"]} if upcoming else None,
        "application": app,
        "stage": stage,
        "questions_on_file": data["question_counts"].get(bank, 0),
    }


def _bank_names(data: dict) -> list[str]:
    names = {p["bank"] for p in data["people"]} | {i["bank"] for i in data["interactions"]} | set(data["my_banks"])
    return sorted(names)


def bank_list(uid: int) -> list[dict]:
    init_db()
    today = date.today().isoformat()
    with connect(read_only=True) as conn:
        data = _load(conn, uid)
    rows = [_bank_summary(data, b, today) for b in _bank_names(data)]
    furthest = lambda r: STAGE_KEYS.index(r["current_stage"]) if r["current_stage"] else -1
    return sorted(rows, key=lambda r: (r["application"]["status"] == "out", -furthest(r), -r["people"], r["bank"]))


def _initials(name: str) -> str:
    parts = [p for p in name.replace(".", " ").split() if p[:1].isalpha()]
    return (parts[0][0] + (parts[-1][0] if len(parts) > 1 else "")).upper() if parts else "?"


def _short(title: str) -> str:
    t = title.lower()
    for key, label in (("day on wall street", "DOWS"), ("presentation", "Pres"), ("happy hour", "HH"), ("dinner", "Dinner"),
                       ("superday", "SD"), ("hiresom", "HireSOM"), ("interview", "Int"), ("screener", "Screen")):
        if key in t:
            return label
    return _initials(title)


def timeline(uid: int) -> dict:
    """Every bank as a row of touchpoints on one shared calendar: one-on-one chats (with bankers or with Yale 2Ys),
    events where the user met several people at once, interviews, next steps, and people reached out to but not met.
    Only real referrals or invitations are returned as links."""
    init_db()
    today = date.today().isoformat()
    with connect(read_only=True) as conn:
        data = _load(conn, uid)
    people = {p["id"]: p for p in data["people"]}
    yale = lambda p: p["alum"] == "student" or p["origin"] == "classmate"
    rows = []
    for bank in _bank_names(data):
        app = _application(data, bank)
        marks, where = [], {}
        for i in (x for x in data["interactions"] if x["bank"] == bank):
            members = [people[j["person_id"]] for j in i["people"] if j["person_id"] in people]
            if i["kind"] == "coffee_chat":
                mid = f"person:{members[0]['id']}" if len(members) == 1 else f"interaction:{i['id']}"
                marks.append({"id": mid, "kind": "chat", "who": "yale" if members and all(yale(p) for p in members) else "banker",
                              "date": i["date"], "status": i["status"], "title": i["title"],
                              "people": [p["name"] for p in members], "label": "".join(_initials(p["name"]) for p in members[:1]) + ("+" if len(members) > 1 else ""),
                              "detail": ", ".join(x for x in (members[0]["title"], members[0]["grp"]) if x) if len(members) == 1 else ""})
            else:
                met = [p for p in members if p["origin"] != "listed"]
                mid = f"interaction:{i['id']}"
                marks.append({"id": mid, "kind": i["kind"], "who": "", "date": i["date"], "status": i["status"], "title": i["title"],
                              "people": [p["name"] for p in met], "label": _short(i["title"]), "detail": i["date_note"] or "",
                              "invite_only": i.get("invite_only") == "yes"})
            for p in members:
                where.setdefault(p["id"], mid)
            where[f"i{i['id']}"] = mid
        for p in (x for x in data["people"] if x["bank"] == bank and x["id"] not in where and x["origin"] == "outreach"):
            mid = f"person:{p['id']}"
            where[p["id"]] = mid
            marks.append({"id": mid, "kind": "outreach", "who": "yale" if yale(p) else "banker",
                          "date": next(iter(re.findall(r"\d{4}-\d{2}-\d{2}", p["outreach"] or "")), ""),
                          "status": p["status"], "title": f"Reached out to {p['name']}", "people": [p["name"]],
                          "label": _initials(p["name"]), "detail": ", ".join(x for x in (p["title"], p["grp"]) if x)})
        links = []
        for l in (x for x in data["links"] if x["bank"] == bank):
            ends = []
            for ref in (l["src"], l["dst"]):
                kind, _, raw = ref.partition(":")
                ends.append(where.get(int(raw)) if kind == "person" else where.get(f"i{raw}"))
            if all(ends) and ends[0] != ends[1]:
                links.append({"from": ends[0], "to": ends[1], "label": l["label"] or "led to"})
        upcoming = sorted((m for m in marks if m["status"] in ("upcoming", "scheduled") and (m["date"] or "9") >= today),
                          key=lambda m: m["date"] or "9")
        waiting = sum(1 for m in marks if m["kind"] == "outreach" and m["status"] in ("awaiting", "no_reply"))
        done = [m["date"] for m in marks if m["date"] and m["status"] in ("done", "spoke", "met")]
        rows.append({
            "bank": bank, "domain": bank_info.domain(bank), "out": app["status"] == "out", "out_reason": app["notes"] if app["status"] == "out" else "",
            "group": (app["prefs"] or "").split(">")[0].strip(), "applied": app["applied"], "deadline": app["deadline"],
            "marks": marks, "links": links, "last": max(done) if done else "",
            "next": {"title": upcoming[0]["title"], "date": upcoming[0]["date"]} if upcoming else None, "waiting": waiting,
            "chats": sum(1 for m in marks if m["kind"] == "chat" and m["status"] == "done"),
            "events": sum(1 for m in marks if m["kind"] == "event" and m["status"] == "done"),
        })
    rows.sort(key=lambda r: (r["out"], not r["marks"], -int((r["next"] or {}).get("date", "0000-00-00").replace("-", "") or 0) * 0, r["last"] == "", ""))
    rows.sort(key=lambda r: (r["out"], not r["marks"], -(int(r["last"].replace("-", "")) if r["last"] else 0)))
    dated = [m["date"] for r in rows for m in r["marks"] if m["date"]]
    return {"today": today, "start": min(dated) if dated else today, "end": max(dated + [today]) if dated else today, "rows": rows}


def calendar() -> list[dict]:
    """Key recruiting dates from the Finance Club decks."""
    init_db()
    with connect(read_only=True) as conn:
        return _all(conn, "SELECT date, end, title, detail, source FROM calendar_items ORDER BY date")


def bank_detail(uid: int, bank: str) -> dict | None:
    init_db()
    today = date.today().isoformat()
    with connect(read_only=True) as conn:
        data = _load(conn, uid)
        if bank not in _bank_names(data):
            return None
        rounds = _all(conn, "SELECT round, COUNT(*) AS n FROM questions WHERE bank = ? GROUP BY round", (bank,))
        facts = _all(conn, "SELECT id, category, fact, source FROM bank_facts WHERE user_id = ? AND bank = ? ORDER BY category, id", (uid, bank))
    people = [p for p in data["people"] if p["bank"] == bank]
    interactions = [i for i in data["interactions"] if i["bank"] == bank]
    rounds.sort(key=lambda r: ROUND_ORDER.index(r["round"]) if r["round"] in ROUND_ORDER else 99)
    return {
        **_bank_summary(data, bank, today),
        "contacts": people,
        "interactions": interactions,
        "links": [l for l in data["links"] if l["bank"] == bank],
        "question_rounds": rounds,
        "facts": facts,
    }


def home(uid: int) -> dict:
    init_db()
    today = date.today().isoformat()
    with connect(read_only=True) as conn:
        data = _load(conn, uid)
        total_q = conn.execute("SELECT COUNT(*) FROM questions").fetchone()[0]
        last_import = conn.execute("SELECT MAX(ran_at) FROM imports WHERE source = 'live_1y'").fetchone()[0]
    names = {p["id"]: p["name"] for p in data["people"]}
    chats = [i for i in data["interactions"] if i["kind"] == "coffee_chat"]
    who = lambda i: ", ".join(names[j["person_id"]] for j in i["people"])
    deadlines = []
    for bank in _bank_names(data):
        app = _application(data, bank)
        if app["deadline"] and app["deadline"] >= today and app["applied"].lower() != "yes":
            deadlines.append({"bank": bank, "date": app["deadline"], "link": app["link"]})
    return {
        "today": today,
        "thank_yous_due": [
            {"bank": i["bank"], "who": who(i), "date": i["date"]}
            for i in chats if i["status"] == "done" and not i["thank_you"]
        ],
        "upcoming": [
            {"bank": i["bank"], "title": i["title"], "date": i["date"], "kind": i["kind"]}
            for i in data["interactions"] if i["status"] == "upcoming" and i["date"] >= today
        ],
        "deadlines": sorted(deadlines, key=lambda d: d["date"]),
        "totals": {
            "banks": len(_bank_names(data)),
            "people": len(data["people"]),
            "conversations": sum(i["status"] == "done" for i in chats),
            "questions": total_q,
            "question_bank_updated": last_import or "",
        },
    }


def prep_options(uid: int) -> dict:
    """What the interview prep picker can offer: rounds, banks with question counts, and contacts per bank."""
    init_db()
    with connect(read_only=True) as conn:
        counts = _all(conn, "SELECT bank, round, COUNT(*) AS n FROM questions GROUP BY bank, round")
        people = _all(conn, "SELECT name, title, bank, grp FROM people WHERE user_id = ? ORDER BY name", (uid,))
    rounds = [r for r in ROUND_ORDER if r not in ("HireVue", "Unknown")]  # HireVue screens are left out of prep
    return {"rounds": rounds, "counts": counts, "people": people, "domains": bank_info.DOMAINS}


def prep_questions(bank: str, round_: str, limit: int = 400) -> dict:
    """Questions for one bank and round. Bank "Any" or round "Any" drops that filter."""
    init_db()
    where, params = [], []
    if bank and bank != "Any":
        where.append("bank = ?")
        params.append(bank)
    if round_ and round_ != "Any":
        where.append("round = ?")
        params.append(round_)
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    with connect(read_only=True) as conn:
        rows = _all(
            conn,
            f"""SELECT id, source, year, qtype, bank, office, grp, round, interviewer, topic, question, answer_notes
                FROM questions {clause}
                ORDER BY source LIKE 'live%' DESC, year DESC, id LIMIT ?""",
            (*params, limit),
        )
        total = conn.execute(f"SELECT COUNT(*) FROM questions {clause}", params).fetchone()[0]
    return {"total": total, "questions": rows}
