"""Read-side queries for the home page, the recruiting map and interview prep."""
import json
import re
from datetime import date, datetime, timedelta

from . import banks as bank_info
from . import schools
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
    club = schools.for_user(uid, conn)["club"]
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
        # The shared application tracker and question bank are the Yale SOM Finance Club's, so only club accounts get them.
        "shared_apps": {r["bank"]: r for r in _all(conn, "SELECT * FROM applications")} if club else {},
        "question_counts": {
            r["bank"]: r["n"] for r in _all(conn, "SELECT bank, COUNT(*) AS n FROM questions GROUP BY bank")
        } if club else {},
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


# How far along a bank is, laid out like the Finance Club's season (kickoff deck): chats with 2Ys and
# alumni in September, chats with bankers in your group in October, closed-list dinners in mid to late November,
# then Super Week (first rounds and superdays within days of each other, Nov 30 to Dec 8). Each step's share of the bar
# is its share of the season's days, so the short interview steps at the end take little room, and a line marks
# today. Each step fills by what has happened at that bank, not by how many contacts: one dinner invite (a low-touch
# bank) fills the steps before it, as the bank has decided you're through them.
SEASON = [
    ("yale", "Yale network", "2026-09-01", "2026-09-30"),
    ("group", "Group-specific chats", "2026-10-01", "2026-11-09"),
    ("dinner", "Dinner", "2026-11-10", "2026-11-29"),
    ("interviews", "Interviews", "2026-11-30", "2026-12-02"),
    ("superday", "Superday", "2026-12-03", "2026-12-08"),
]
# The bank dates on the Finance Club's calendar (Meeting #10 deck, Nov 10): before an invite or interview is logged, a
# bank's Dinner, Interviews and Superday steps show the club's date with a "?", so it's clear what's still ahead.
CLUB_DINNERS = {"Evercore": "2026-11-10", "Goldman Sachs": "2026-11-16", "Citi": "2026-11-17", "Bank of America": "2026-11-19",
                "Barclays": "2026-11-23"}
CLUB_FIRST_ROUNDS = {"Morgan Stanley": "2026-11-30", "Goldman Sachs": "2026-12-01", "J.P. Morgan": "2026-12-01", "PJT": "2026-12-01",
                     "Citi": "2026-12-02", "MTS": "2026-12-07"}
CLUB_SUPERDAYS = {"Guggenheim": "2026-11-12", "PJT": "2026-12-02", "RBC": "2026-12-03", "Bank of America": "2026-12-03",
                  "Barclays": "2026-12-07"}
MANUAL_STAGE = {"yale": 0, "bank": 1, "dinner": 2, "superday": 4, "offer": 4}  # a stage the student set by hand
SCREEN = re.compile(r"hire ?vue|online (?:test|assessment)|assessment|screener|pymetrics|codility|video interview", re.I)
FINAL = re.compile(r"superday|super day|final round", re.I)
CLOSED = re.compile(r"dinner|reception|closed[- ]list|cocktail", re.I)
SENIOR = re.compile(r"\b(?:vp|vice president|director|md|managing director|partner|principal|head)\b", re.I)


# Group names are written many ways ("Consumer & Retail", "Consumer (San Francisco)", "Food & Bev (MN)"): compare by
# sector, not by spelling.
SECTOR_WORDS = {
    "consumer": "consumer", "retail": "consumer", "food": "consumer", "bev": "consumer", "beverage": "consumer", "restaurants": "consumer",
    "transportation": "transport", "logistics": "transport", "health": "health", "healthcare": "health", "tech": "tech",
    "technology": "tech", "software": "tech", "industrial": "industrials", "industrials": "industrials", "fig": "fig",
    "financial": "fig", "power": "power", "utility": "power", "utilities": "power", "energy": "power", "media": "media",
    "telecom": "media", "real": "realestate", "lodging": "realestate", "gaming": "realestate", "sponsors": "sponsors",
    "leveraged": "levfin", "restructuring": "rx", "m&a": "ma", "ecm": "ecm", "dcm": "dcm",
}


def _sectors(name: str) -> set[str]:
    words = re.findall(r"[a-z&]+", re.sub(r"\(.*?\)", " ", (name or "").lower()))
    return {SECTOR_WORDS[w] for w in words if w in SECTOR_WORDS} or {w for w in words[:1] if len(w) > 2}


def _day(iso: str) -> str:
    try:
        d = date.fromisoformat(iso[:10])
    except ValueError:
        return ""
    return f"{d:%b} {d.day}"


def _club(dates: dict[str, str], bank: str, today: str) -> str:
    """The club calendar's date for this bank, still ahead, as "Dec 2?" (not logged yet)."""
    day = dates.get(bank, "")
    return f"{_day(day)}?" if day and day >= today else ""


def _invite_label(title: str) -> str:
    for key, label in (("dinner", "Dinner"), ("happy hour", "Happy hour"), ("day on wall street", "Day on Wall Street"),
                       ("days on wall street", "Day on Wall Street"), ("lunch", "Lunch"), ("breakfast", "Breakfast"),
                       ("reception", "Reception"), ("round", "Next round")):
        if key in title.lower():
            return label
    return "Invited"


def _progress(data: dict, bank: str, app: dict) -> dict:
    today = date.today().isoformat()
    people = {p["id"]: p for p in data["people"] if p["bank"] == bank}
    entries = [i for i in data["interactions"] if i["bank"] == bank]
    spoken = [p for p in people.values() if p["status"] in ("spoke", "met")]
    yale = lambda p: p["alum"] in ("yes", "student") or p["origin"] == "classmate"  # noqa: E731
    targets = [g.strip() for g in re.split(r"[>,;/]", app["prefs"] or "") if len(g.strip()) > 2]
    wanted = set().union(*(_sectors(g) for g in targets)) if targets else set()
    in_group = lambda p: bool(p["grp"]) and bool(_sectors(p["grp"]) & wanted)  # noqa: E731

    # 1. Chats with 2Ys and alumni: two is a full step.
    yale_n = sum(1 for p in spoken if yale(p))
    # 2. Chats with the bankers themselves, in your group above all: two in your group is a full step (anyone outside
    # it, or anyone when you haven't picked a group, counts half); an invite-only event before the dinners (a closed
    # Day on Wall Street) counts as one, as does being introduced on or asked back.
    bankers = [p for p in spoken if not (p["alum"] == "student" or p["origin"] == "classmate")]
    group_n = sum(1 for p in bankers if in_group(p))
    other_n = len(bankers) - group_n
    early = [i for i in entries if i["kind"] == "event" and i.get("invite_only") == "yes" and not CLOSED.search(i["title"])
             and (i["date"] or "9") < SEASON[2][2]]
    back = any(sum(c["status"] == "done" for c in p["chats"]) > 1 for p in people.values()) or any(l["bank"] == bank for l in data["links"])
    group_score = group_n + other_n / 2 + (1 if early else 0) + (0.5 if back else 0)
    # 3. The closed-list dinner (or reception): invited is half, been is full.
    dinners = sorted((i for i in entries if i["kind"] == "event" and (CLOSED.search(i["title"]) or (
        i.get("invite_only") == "yes" and (i["date"] or "") >= SEASON[2][2]))), key=lambda i: i["date"] or "9")
    # 4 and 5. Interviews, then the superday: scheduled is half, done is full. A HireVue or online test is applying.
    interviews = [i for i in entries if i["kind"] == "interview" and not (SCREEN.search(i["title"]) and not FINAL.search(i["title"]))]
    finals = sorted((i for i in interviews if FINAL.search(i["title"])), key=lambda i: i["date"] or "9")
    rounds = sorted((i for i in interviews if i not in finals), key=lambda i: i["date"] or "9")
    stage_fill = lambda items: 0 if not items else 1 if any(i["status"] == "done" for i in items) else 0.5  # noqa: E731
    fill = [min(1, yale_n / 2), min(1, group_score / 2), stage_fill(dinners), stage_fill(rounds), stage_fill(finals)]
    if app["status"] == "offer":
        fill = [1, 1, 1, 1, 1]
    # A later step under way means the bank has passed you through the ones before it (a low-touch bank skips ahead).
    manual = MANUAL_STAGE.get(app["stage"], -1)
    for k in range(len(fill)):
        if any(fill[j] > 0 for j in range(k + 1, len(fill))) and k >= 1 or (k < manual):
            fill[k] = 1
    if fill[2] > 0 or fill[3] > 0 or fill[4] > 0:
        fill[0] = 1  # past the group chats, the 2Y round is behind you too
    notes = [
        f"{yale_n} chat{'s' if yale_n != 1 else ''}" if yale_n else "",
        (f"{group_n} in your group" if targets and group_n else f"{len(bankers)} banker{'s' if len(bankers) != 1 else ''}") if bankers or early else "",
        (_day(dinners[-1]["date"]) or "Invited") if dinners else
        _club(CLUB_DINNERS, bank, today),
        _day(rounds[0]["date"]) if rounds else _club(CLUB_FIRST_ROUNDS, bank, today),
        _day(finals[0]["date"]) if finals else _club(CLUB_SUPERDAYS, bank, today),
    ]
    total = sum((date.fromisoformat(e) - date.fromisoformat(s)).days + 1 for _, _, s, e in SEASON)
    steps = []
    for (key, label, s, e), f, note in zip(SEASON, fill, notes):
        days = (date.fromisoformat(e) - date.fromisoformat(s)).days + 1
        steps.append({"key": key, "label": label, "share": days / total, "fill": f, "note": note, "start": s, "end": e})
    first = date.fromisoformat(SEASON[0][2])
    when = min(1.0, max(0.0, ((date.fromisoformat(today) - first).days + 0.5) / total))
    furthest = max((k for k, f in enumerate(fill) if f > 0), default=-1)
    at = steps[furthest] if furthest >= 0 else None
    if app["status"] == "offer":
        where = "Offer"
    elif at is None:
        where = "Not started"
    elif at["key"] == "dinner":
        kind = _invite_label(dinners[-1]["title"]).lower() if dinners else "dinner"
        kind = kind if kind in ("dinner", "reception", "happy hour", "lunch", "breakfast") else "dinner"
        where = (f"Invited to {kind}" if fill[2] < 1 else f"{kind.capitalize()} done") + (f" · {at['note']}" if at["note"] and at["note"] != "Invited" else "")
    elif at["key"] in ("interviews", "superday"):
        where = f"{at['label']}{' done' if at['fill'] == 1 else ''}" + (f" · {at['note']}" if at["note"] else "")
    else:
        where = f"{at['label']}" + (f" · {at['note']}" if at["note"] else "")
    return {"steps": steps, "today": when, "where": where, "offer": app["status"] == "offer",
            "score": sum(st["share"] * st["fill"] for st in steps),
            "screens": [i["title"] for i in entries if i["kind"] == "interview" and SCREEN.search(i["title"])
                        and not FINAL.search(i["title"]) and i["status"] == "done"]}


def _bank_summary(data: dict, bank: str, today: str) -> dict:
    people = [p for p in data["people"] if p["bank"] == bank and p["origin"] != "listed"]
    interactions = [i for i in data["interactions"] if i["bank"] == bank]
    app = _application(data, bank)
    upcoming = [i for i in interactions if i["status"] == "upcoming" and i["date"] >= today]
    dated = [i["date"] for i in interactions if i["status"] == "done" and i["date"]]
    yale = [p for p in people if p["alum"] in ("yes", "student")]
    return {
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
        "questions_on_file": data["question_counts"].get(bank, 0),
        "progress": _progress(data, bank, app),
    }


def _bank_names(data: dict) -> list[str]:
    names = {p["bank"] for p in data["people"]} | {i["bank"] for i in data["interactions"]} | set(data["my_banks"])
    return sorted(names)


def bank_list(uid: int) -> list[dict]:
    init_db()
    today = date.today().isoformat()
    with connect(read_only=True) as conn:
        data = _load(conn, uid)
        data["school"] = schools.for_user(uid)["short"]
    rows = [_bank_summary(data, b, today) for b in _bank_names(data)]
    # furthest along first, by what the bank has done back
    return sorted(rows, key=lambda r: (r["application"]["status"] == "out", -r["progress"]["score"], -r["people"], r["bank"]))


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
    data["school"] = schools.for_user(uid)["short"]
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
            "status": app["status"],
            "interviews": [{"title": m["title"], "date": m["date"], "status": m["status"]} for m in marks if m["kind"] == "interview"],
            "invites": [m["title"] for m in marks if m.get("invite_only")],
            "chat_dates": sorted(m["date"] for m in marks if m["kind"] == "chat" and m["status"] == "done" and m["date"]),
            "progress": _progress(data, bank, app),
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


def _start_minutes(note: str) -> int | None:
    """Minutes after midnight for a time note like "11:00 AM", "6 PM ET" or "noon"; None without a time."""
    if re.search(r"\bnoon\b", note or "", re.I):
        return 12 * 60
    m = re.search(r"(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m", note or "", re.I)
    if not m:
        return None
    return (int(m[1]) % 12 + (12 if m[3].lower() == "p" else 0)) * 60 + int(m[2] or 0)


def _thanks_due(uid: int, data: dict, names: dict) -> list[dict]:
    """Coffee chats and networking events from the last two weeks that have happened (marked done, or their time has
    passed) with people still to thank. A person counts as thanked once a thank-you to them was sent or scheduled
    (recorded by the reader from Outlook, or sent from the app); the whole entry once its thank-you date is set."""
    now = datetime.now()
    today, since = now.date().isoformat(), (now.date() - timedelta(days=14)).isoformat()
    with connect(read_only=True) as conn:
        thanked = {(r["interaction_id"], r["person_id"]) for r in conn.execute(
            "SELECT interaction_id, person_id FROM thank_you_drafts WHERE user_id = ? AND COALESCE(sent_at, '') != ''", (uid,))}
    out = []
    for i in data["interactions"]:
        if i["kind"] not in ("coffee_chat", "event") or (i["thank_you"] or "") not in ("",) or not i["date"] or not since <= i["date"] <= today:
            continue
        start = _start_minutes(i["date_note"] or "")
        length = 30 if i["kind"] == "coffee_chat" else 60  # coffee chats run half an hour
        happened = i["status"] == "done" or (i["status"] == "upcoming" and (
            i["date"] < today or (start is not None and start + length <= now.hour * 60 + now.minute)))
        ids = [j["person_id"] for j in i["people"] if (i["id"], j["person_id"]) not in thanked and j["person_id"] in names]
        left = [names[p] for p in ids]
        if happened and left:
            # ids: to open that person (or the event, for several) on the bank's map from the home page
            out.append({"bank": i["bank"], "title": i["title"], "kind": i["kind"], "date": i["date"], "who": left,
                        "who_ids": ids, "entry_id": i["id"]})
    return sorted(out, key=lambda t: t["date"])


def home(uid: int) -> dict:
    init_db()
    today = date.today().isoformat()
    with connect(read_only=True) as conn:
        data = _load(conn, uid)
        # the club's question bank is only counted for accounts that can see it
        total_q = conn.execute("SELECT COUNT(*) FROM questions").fetchone()[0] if schools.for_user(uid, conn)["club"] else 0
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
            {"id": i["id"], "bank": i["bank"], "title": i["title"], "date": i["date"], "kind": i["kind"], "date_note": i["date_note"] or ""}
            for i in data["interactions"] if i["status"] == "upcoming" and i["date"] >= today
        ],
        # open to-dos (steps still to be done), soonest first, undated last
        "todos": sorted(
            ({"id": i["id"], "bank": i["bank"], "title": i["title"], "date": i["date"] or ""} for i in data["interactions"] if i["status"] == "todo"),
            key=lambda t: t["date"] or "9999"),
        "deadlines": sorted(deadlines, key=lambda d: d["date"]),
        "thanks_due": _thanks_due(uid, data, names),
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
    # the answer some students typed into the question goes with the notes here too, as it does in practice
    from . import question_clean

    done = question_clean.splits()
    out = []
    for r in rows:
        r["question"], r["answer_notes"], skip = question_clean.apply(r["id"], r["question"] or "", r["answer_notes"] or "", done)
        if not skip:
            out.append(r)
    return {"total": total, "questions": out}
