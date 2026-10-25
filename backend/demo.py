"""The demo account for the teaching staff: a made-up first-year with a tracker already in progress.

    .venv\\Scripts\\python.exe -m backend.demo            create it if it is missing (the hosted site does this on start)
    .venv\\Scripts\\python.exe -m backend.demo --reset    put its tracker back to the starting sample

Everyone in it is invented (names, emails, notes); the banks are real firms so the map shows their logos. Dates are
set relative to today, so there is always a thank-you owed, a chat coming up and a deadline close. The account runs on
the course key (config.on_course_key) under the normal daily token budget, and its address is not a Yale one, so the
Finance Club's question bank, tracker and calendar are never shown to it.
"""
import sys
from datetime import date, datetime, timedelta

from . import accounts, config, deals, profile, stars
from .db import connect, init_db

NAME = "Jordan Rivera"

RESUME = """JORDAN RIVERA
Yale School of Management, MBA Candidate, Class of 2028

EXPERIENCE
Brightline Consumer Brands, Senior Financial Analyst, Chicago (2022 to 2026)
- Built the three-statement model behind a $40M bolt-on acquisition of a regional snack brand; presented returns to the CFO
- Ran the annual budget for a $300M division; cut forecast error from 9% to 3% by rebuilding the driver model
- Led a five-person team that moved monthly reporting from spreadsheets to a BI dashboard, saving 30 hours a month

Midwest Regional Bank, Credit Analyst, Columbus (2020 to 2022)
- Underwrote 25 middle-market loans ($5M to $30M); wrote credit memos for the loan committee

EDUCATION
Ohio State University, B.S. Finance, 2020

OTHER
Yale SOM Finance Club; CFA Level II candidate; ran the Chicago Marathon (2024)
"""

BANKS = {  # bank: (applied, deadline in days from today or None, stage, groups in order)
    "Evercore": ("Yes", None, "bank", "Technology > M&A"),
    "Morgan Stanley": ("", 12, "yale", "Technology > Consumer & Retail"),
    "Lazard": ("", 9, "yale", "M&A"),
    "Moelis": ("", 4, "", "Consumer & Retail"),
    "Goldman Sachs": ("", 20, "", "Technology"),
}

# name, title, bank, group, alum (yes | no | student), origin, outreach days ago, notes
PEOPLE = [
    ("Priya Raman", "Vice President", "Evercore", "Technology", "yes", "outreach", 14,
     "Yale SOM '19. Covers software. Very open about the summer program; said to mention our chat in the application."),
    ("Marcus Bell", "2Y", "Evercore", "M&A", "student", "classmate", None, "Summered at Evercore in M&A; returning full time."),
    ("Dana Whitfield", "Managing Director", "Evercore", "Technology", "no", "listed", None, "Spoke on the TMT dinner panel. Have not met."),
    ("Alex Chen", "2Y", "Morgan Stanley", "Healthcare", "student", "classmate", None, "Summered in Healthcare. Offered to introduce me to Sofia."),
    ("Sofia Marino", "Associate", "Morgan Stanley", "Technology", "yes", "outreach", 6, "Yale SOM '23. Introduced by Alex Chen."),
    ("Ben Okafor", "Associate", "Lazard", "M&A", "yes", "outreach", 8, "Yale SOM '24. Replied the same day."),
    ("Hannah Park", "Vice President", "Moelis", "Consumer & Retail", "no", "outreach", 10, "No reply yet; follow up after the weekend."),
]

# key, bank, kind, title, days from today, date note, format, status, thank-you, invite only, people, summary
CHATS = [
    ("priya", "Evercore", "coffee_chat", "Coffee chat with Priya Raman", -9, "", "Zoom", "done", "sent", "", ["Priya Raman"],
     "Talked through the Evercore summer: generalist for the first weeks, then staffed by group. She liked my bolt-on "
     "acquisition model story and said to tie it to why advisory over corporate development."),
    ("dinner", "Evercore", "event", "Evercore TMT dinner", -5, "6:30 PM", "In person", "done", "n/a", "yes",
     ["Marcus Bell", "Priya Raman", "Dana Whitfield"], "Small dinner, about 12 students. Sat with Marcus and Priya; Dana spoke on the panel."),
    ("applied", "Evercore", "step", "Submitted the Evercore application", -3, "", "", "done", "n/a", "", [], "Applied to the NY TMT group."),
    ("alex", "Morgan Stanley", "coffee_chat", "Coffee chat with Alex Chen", -12, "", "In person", "done", "sent", "", ["Alex Chen"],
     "Alex walked me through how MS staffs summers and offered to connect me with Sofia in Tech."),
    ("sofia", "Morgan Stanley", "coffee_chat", "Coffee chat with Sofia Marino", -1, "", "Zoom", "done", "", "", ["Sofia Marino"],
     "Sofia covers internet and software. We talked about the Activision deal and how her team thinks about AI capex. "
     "She asked why tech over consumer; suggested I reach out to her VP before the application."),
    ("ben", "Lazard", "coffee_chat", "Coffee chat with Ben Okafor", 3, "2:00 PM ET", "Zoom", "upcoming", "", "", ["Ben Okafor"], ""),
]

QUESTIONS = {
    "priya": [("asked_me", "Walk me through your background."), ("asked_me", "Why advisory and not corporate development?"),
              ("i_asked", "How are summer associates staffed in the first weeks?")],
    "sofia": [("asked_me", "Why technology over consumer?"), ("asked_me", "Pitch me a deal you have followed."),
              ("i_asked", "How is the team thinking about AI infrastructure spend?")],
}

LINKS = [  # bank, from, to, label
    ("Evercore", "chat:priya", "chat:dinner", "invited me to the dinner"),
    ("Morgan Stanley", "chat:alex", "person:Sofia Marino", "introduced me"),
]

FACTS = [  # bank, category, fact
    ("Evercore", "Program", "Summer associates start as generalists, then are staffed by group (from Priya Raman)."),
    ("Evercore", "Talking points", "Independent advisor: no lending conflicts, which Priya said shapes how clients use them."),
    ("Morgan Stanley", "Staffing", "Summers are placed in one group from day one (from Alex Chen)."),
]

DEAL = "Microsoft / Activision Blizzard"
DEAL_POINTS = [  # section, label, value, source
    ("3. The deal itself", "Total consideration", "$68.7 billion, including Activision's net cash", "Microsoft press release, January 18, 2022"),
    ("3. The deal itself", "Form of consideration", "All cash, $95.00 per share", "Microsoft press release, January 18, 2022"),
    ("Back pocket", "Timeline and status", "Announced January 18, 2022; closed October 13, 2023 after UK CMA review", "Microsoft announcement, October 13, 2023"),
]

STORIES = {
    "teamwork": {"situation": "Monthly reporting at Brightline took the FP&A team four days in spreadsheets.",
                 "task": "I was asked to cut the close time without adding headcount.",
                 "action": "Pulled five analysts together, mapped every manual step, and built a BI dashboard on the ERP data.",
                 "result": "Close went from four days to one; about 30 hours a month saved.",
                 "reflection": "Getting the team to own the design mattered more than the tool."},
    "pressure": {"situation": "A bolt-on acquisition needed a model for the CFO in five days.",
                 "task": "Build the three-statement model and returns case.",
                 "action": "Split the work into revenue build, cost synergies and financing; checked each with the deal lead daily.",
                 "result": "Delivered on time; the board approved the $40M deal.",
                 "reflection": "Agreeing the outputs on day one kept the last night calm."},
}


def _day(offset: int | None) -> str:
    return (date.today() + timedelta(days=offset)).isoformat() if offset is not None else ""


def _account(conn) -> int:
    row = conn.execute("SELECT id FROM users WHERE email = ?", (config.DEMO_EMAIL,)).fetchone()
    if row:
        return row["id"]
    now = datetime.now().isoformat(timespec="seconds")
    return conn.execute(
        "INSERT INTO users (email, name, password_hash, is_admin, created_at, email_verified_at) VALUES (?, ?, ?, 0, ?, ?)",
        (config.DEMO_EMAIL, NAME, accounts._hash_password(config.DEMO_PASSWORD), now, now)).lastrowid


def _fill(conn, uid: int) -> None:
    """Replace the demo tracker with the starting sample."""
    mine = "SELECT id FROM interactions WHERE user_id = ?"
    for sql in (f"DELETE FROM interaction_people WHERE interaction_id IN ({mine})",
                f"DELETE FROM interaction_questions WHERE interaction_id IN ({mine})",
                "DELETE FROM deal_points WHERE deal_id IN (SELECT id FROM deals WHERE user_id = ?)",
                *(f"DELETE FROM {t} WHERE user_id = ?" for t in (
                    "people", "interactions", "links", "my_banks", "bank_facts", "deals", "transcripts", "thank_you_drafts",
                    "cover_letters", "prep_attempts", "deal_documents", "star_stories"))):
        conn.execute(sql, (uid,))

    for bank, (applied, deadline, stage, prefs) in BANKS.items():
        conn.execute("INSERT INTO my_banks (user_id, bank, applied, deadline, link, prefs, notes, stage) VALUES (?, ?, ?, ?, '', ?, '', ?)",
                     (uid, bank, applied, _day(deadline), prefs, stage))
    person = {}
    for name, title, bank, grp, alum, origin, outreach, notes in PEOPLE:
        email = f"{name.lower().replace(' ', '.')}@example.com" if origin == "outreach" else ""
        person[name] = conn.execute(
            "INSERT INTO people (user_id, name, title, bank, grp, email, outreach, origin, notes, alum) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (uid, name, title, bank, grp, email, _day(-outreach) if outreach else "", origin, notes, alum)).lastrowid
    chat = {}
    for key, bank, kind, title, offset, note, fmt, status, thanks, invite, who, summary in CHATS:
        chat[key] = conn.execute(
            """INSERT INTO interactions (user_id, bank, kind, title, date, date_note, format, status, summary, thank_you, invite_only)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (uid, bank, kind, title, _day(offset), note, fmt, status, summary, _day(offset) if thanks == "sent" else thanks, invite)).lastrowid
        for name in who:
            conn.execute("INSERT INTO interaction_people (interaction_id, person_id, notes) VALUES (?, ?, '')", (chat[key], person[name]))
    for key, rows in QUESTIONS.items():
        for direction, text in rows:
            conn.execute("INSERT INTO interaction_questions (interaction_id, direction, question) VALUES (?, ?, ?)", (chat[key], direction, text))
    ref = lambda end: f"interaction:{chat[end[5:]]}" if end.startswith("chat:") else f"person:{person[end[7:]]}"
    for bank, src, dst, label in LINKS:
        conn.execute("INSERT INTO links (user_id, bank, src, dst, label) VALUES (?, ?, ?, ?, ?)", (uid, bank, ref(src), ref(dst), label))
    now = datetime.now().isoformat(timespec="seconds")
    for bank, category, fact in FACTS:
        conn.execute("INSERT INTO bank_facts (user_id, bank, category, fact, source, added_at) VALUES (?, ?, ?, ?, 'coffee chat', ?)",
                     (uid, bank, category, fact, now))
    deal_id = deals.ensure_deal(conn, uid, DEAL, "Morgan Stanley, Evercore")
    for section, label, value, source in DEAL_POINTS:
        deals.set_point(conn, deal_id, section, label, value, source)


def ensure(reset: bool = False) -> dict:
    """Create the demo account with its sample tracker if it is missing; with reset, refill the sample."""
    init_db()
    stars.ensure()
    conn = connect()
    try:
        with conn:
            existed = bool(conn.execute("SELECT 1 FROM users WHERE email = ?", (config.DEMO_EMAIL,)).fetchone())
            uid = _account(conn)
            if reset or not existed:
                _fill(conn, uid)
    finally:
        conn.close()
    if reset or not existed:
        profile.save(uid, {"resume_text": RESUME, "school": "Yale SOM", "level": "mba", "class_year": "2028",
                           "school_line": "a first-year MBA candidate at the Yale School of Management",
                           "contact_line": f"New Haven, CT | {config.DEMO_EMAIL}", "target_groups": "Technology, M&A",
                           "why_group": "Four years modelling consumer and software acquisitions from the corporate side; I want to "
                                        "be the advisor on the other side of the table.",
                           "highlights": "The $40M bolt-on model; cutting forecast error from 9% to 3%; leading the reporting rebuild.",
                           "projects": "Brightline bolt-on acquisition model; FP&A dashboard rebuild; middle-market credit memos."})
        profile.finish_setup(uid)
        for key, parts in STORIES.items():
            stars.save(uid, key, parts)
    return {"user_id": uid, "created": not existed, "filled": reset or not existed}


if __name__ == "__main__":
    out = ensure(reset="--reset" in sys.argv)
    state = "created" if out["created"] else ("reset to the sample" if out["filled"] else "already there, left as is")
    print(f"Demo account {config.DEMO_EMAIL} (user {out['user_id']}): {state}.")
