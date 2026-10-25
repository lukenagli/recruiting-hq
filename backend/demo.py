"""The demo account for the teaching staff: a made-up first-year with a tracker already in progress.

    .venv\\Scripts\\python.exe -m backend.demo            create it if it is missing (the hosted site does this on start)
    .venv\\Scripts\\python.exe -m backend.demo --reset    put its tracker back to the starting sample

Everyone in it is invented (names, emails, notes); the banks are real firms so the map shows their logos. Dates are
set relative to today, so there is always a thank-you owed, a chat coming up and a deadline close. The account runs on
the course key (config.on_course_key) under the normal daily token budget, and its address is not a Yale one, so the
Finance Club's question bank, tracker and calendar are never shown to it.
"""
import json
import sys
from datetime import date, datetime, timedelta

from . import accounts, config, deals, profile, stars
from .db import connect, init_db

NAME = "Jane Doe"
# Bump when the sample below changes: the hosted site refills the demo account once on its next start.
SAMPLE_VERSION = "2"

RESUME = """JANE DOE
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
    ("Nina Alvarez", "2Y", "Lazard", "M&A", "student", "classmate", None, "Summered at Lazard in M&A. Put me in touch with Ben Okafor."),
    ("Sam Ortiz", "2Y", "Moelis", "Consumer & Retail", "student", "classmate", None, "Summered at Moelis in Consumer & Retail."),
    ("Rachel Kim", "Vice President", "Goldman Sachs", "Technology", "no", "event", None, "Met at the Goldman Sachs Technology info session."),
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
    ("nina", "Lazard", "coffee_chat", "Coffee chat with Nina Alvarez", -7, "", "In person", "done", "sent", "", ["Nina Alvarez"],
     "Nina said Lazard's M&A deal teams are small, so summer associates get early client exposure. She said bankers there "
     "like candidates who can speak with conviction about a sector they know, and suggested I connect my consumer and "
     "software modeling to that. She offered to introduce me to Ben Okafor."),
    ("sam", "Moelis", "coffee_chat", "Coffee chat with Sam Ortiz", -6, "", "In person", "done", "sent", "", ["Sam Ortiz"],
     "Sam said Moelis teams are lean, so summers build models from scratch and sit in on client calls. He liked that I "
     "had built a three-statement model for a real acquisition and said to lead with it. Suggested I follow up with Hannah Park."),
    ("rachel", "Goldman Sachs", "coffee_chat", "Coffee chat with Rachel Kim", -4, "", "Zoom", "done", "sent", "", ["Rachel Kim"],
     "Met Rachel at the Technology info session and followed up for a chat. She covers enterprise software and talked "
     "about how her team staffs summers on live deals early. She asked how my FP&A work would translate to diligence."),
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
    ("Lazard", "chat:nina", "person:Ben Okafor", "introduced me"),
    ("Moelis", "chat:sam", "person:Hannah Park", "suggested I reach out"),
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


# Cover letter drafts, written by the app's own cover letter writer (gpt-6-luna) from this tracker on 2026-10-25,
# with three small hand fixes. [[NEED: ...]] markers are gaps the writer left rather than invent something.
LETTERS = {  # bank: (paragraphs, warnings shown above the letter)
    'Evercore': (
        [
            "My name is Jane Doe, and I am a first-year MBA candidate at the Yale School of Management writing to express"
            " my interest in the Investment Banking Summer Associate role at Evercore. I am drawn to Evercore’s "
            "generalist summer program because it offers the opportunity to build an investment banking skill set across "
            "industries before joining a group. In speaking with Priya Raman, I learned that summer associates begin as "
            "generalists and are later staffed by group. She also explained that Evercore’s role as an independent "
            "advisor, without lending conflicts, shapes how clients use the firm. That independence and the chance to "
            "develop a broad advisory foundation resonate with my goal of moving from corporate-side acquisition analysis"
            " to advising companies on the other side of the table.",
            "At Brightline Consumer Brands, where I worked as a Senior Financial Analyst for four years, I built the "
            "three-statement model behind a $40 million bolt-on acquisition of a regional snack brand and presented the "
            "returns to the CFO. Modeling consumer and software acquisitions from the corporate side has given me a "
            "practical understanding of how companies assess strategic transactions; I now want to apply that perspective"
            " in an advisory role. Priya Raman’s feedback on my bolt-on model reinforced the relevance of that experience"
            " and prompted me to sharpen how I articulate my motivation for advisory. Evercore’s generalist program "
            "particularly appeals to me as a way to broaden my transaction skills across industries before specializing "
            "by group.",
            "My other work at Brightline strengthened the analytical and execution skills I would bring to investment "
            "banking. I ran the annual budget for a $300 million division and reduced forecast error from 9% to 3% by "
            "rebuilding the driver model. I also led a five-person team that replaced spreadsheet-based monthly reporting"
            " with a BI dashboard, saving 30 hours each month. Earlier, as a Credit Analyst at Midwest Regional Bank, I "
            "underwrote 25 middle-market loans ranging from $5 million to $30 million and wrote credit memos for the loan"
            " committee. Together, these experiences prepared me to analyze businesses carefully, communicate financial "
            "conclusions, and contribute across a range of transactions and industries in Evercore’s generalist program.",
            "Thank you to Priya Raman for sharing her perspective on Evercore and the summer associate experience. I am "
            "excited about beginning my investment banking career at Evercore and look forward to discussing my "
            "candidacy.",
        ],
        ["no recruiter name yet, so it is addressed to Hiring Manager; the guidance says to address it to the firm's recruiter"],
    ),
    'Morgan Stanley': (
        [
            "My name is Jane Doe, and I am a first-year MBA candidate at the Yale School of Management writing to express"
            " my interest in the Investment Banking Summer Associate role in Morgan Stanley’s Technology group. I am "
            "drawn to Technology because I have spent four years modeling consumer and software acquisitions from the "
            "corporate side and want to advise companies from the other side of the table. In speaking with Sofia Marino,"
            " I discussed the Activision deal and how her team thinks about AI capex; [[NEED: what those conversations "
            "showed you about Morgan Stanley or its Technology group]]. Alex Chen explained that summer associates are "
            "placed in one group from day one. That focused staffing model appeals to me as I seek to build deep "
            "experience in technology investment banking.",
            "At Brightline Consumer Brands, I built the three-statement model behind a $40 million bolt-on acquisition of"
            " a regional snack brand and presented the returns to the CFO. That work gave me direct experience evaluating"
            " an acquisition from the company’s perspective, and it strengthened my interest in helping clients assess "
            "strategic transactions as an advisor. I would bring that transaction modeling experience to the group while "
            "developing the advisory perspective I am pursuing at Yale.",
            "I also ran the annual budget for a $300 million division and cut forecast error from 9% to 3% by rebuilding "
            "the driver model. Separately, I led a five-person team in moving monthly reporting from spreadsheets to a BI"
            " dashboard, saving 30 hours each month. These projects required me to improve financial analysis and "
            "reporting processes while taking responsibility for delivering work with a team. Earlier, as a credit "
            "analyst at Midwest Regional Bank, I underwrote 25 middle-market loans ranging from $5 million to $30 million"
            " and wrote credit memos for the loan committee. Together, these experiences have prepared me to contribute "
            "analytical rigor, modeling experience, and a collaborative approach to Morgan Stanley’s Technology group.",
            "Thank you to Sofia Marino and Alex Chen for sharing their perspectives. I am excited about beginning my "
            "investment banking career at Morgan Stanley and look forward to discussing my candidacy.",
        ],
        ["needs your input: what those conversations showed you about Morgan Stanley or its Technology group", "no recruiter name yet, so it is addressed to Hiring Manager; the guidance says to address it to the firm's recruiter"],
    ),
    'Lazard': (
        [
            "My name is Jane Doe, and I am a first-year MBA candidate at the Yale School of Management writing to express"
            " my interest in the Investment Banking Summer Associate role in Lazard’s M&A group. I am drawn to Lazard by "
            "what Nina Alvarez shared about its M&A deal teams: their small size gives summer associates early client "
            "exposure, and bankers value candidates who can speak with conviction about a sector they know. That "
            "perspective resonated with my four years modeling consumer and software acquisitions from the corporate side"
            " and my desire to become the advisor on the other side of the table. I would be excited to bring that sector"
            " and transaction experience to Lazard while developing as an M&A advisor and contributing in client-facing "
            "settings.",
            "At Brightline Consumer Brands, I built the three-statement model behind a $40 million bolt-on acquisition of"
            " a regional snack brand and presented the returns to the CFO. Working through the transaction gave me direct"
            " experience translating operating assumptions into an acquisition model and communicating its outcomes to "
            "senior leadership. I also ran the annual budget for a $300 million division and cut forecast error from 9% "
            "to 3% by rebuilding the driver model. These projects strengthened the analytical discipline I would bring to"
            " evaluating transactions and supporting M&A clients.",
            "I also led a five-person team that moved Brightline’s monthly reporting from spreadsheets to a BI dashboard,"
            " saving 30 hours each month. Leading that rebuild required coordinating a team around a more effective "
            "reporting process, while deepening my ability to turn financial information into usable analysis. Earlier, "
            "as a credit analyst at Midwest Regional Bank, I underwrote 25 middle-market loans ranging from $5 million to"
            " $30 million and wrote credit memos for the loan committee. Together, my acquisition modeling, forecasting, "
            "reporting, and underwriting experience has prepared me to contribute a rigorous financial perspective and a "
            "strong foundation for Lazard’s M&A work.",
            "Thank you to Nina Alvarez for sharing her perspective on Lazard’s M&A team and what it values. I am excited "
            "about beginning my investment banking career at Lazard and look forward to discussing my candidacy.",
        ],
        ["no recruiter name yet, so it is addressed to Hiring Manager; the guidance says to address it to the firm's recruiter"],
    ),
    'Moelis': (
        [
            "My name is Jane Doe, and I am a first-year MBA candidate at the Yale School of Management writing to express"
            " my interest in the Investment Banking Summer Associate role in Moelis’s Consumer & Retail group. I am drawn"
            " to Moelis by what Sam Ortiz shared about its lean teams: summer associates build models from scratch and "
            "sit in on client calls, gaining direct responsibility and client exposure. Sam also said he liked that I had"
            " built a three-statement model for a real acquisition and encouraged me to lead with that experience. "
            "Consumer & Retail is a strong fit for my four years modeling consumer and software acquisitions from the "
            "corporate side; I am eager to bring that perspective to the advisor’s side of the table.",
            "As a Senior Financial Analyst at Brightline Consumer Brands, I built the three-statement model behind a $40 "
            "million bolt-on acquisition of a regional snack brand and presented the returns to the CFO. Developing the "
            "model for a real transaction gave me experience connecting operating assumptions to acquisition economics "
            "and clearly communicating the resulting analysis. That work is directly relevant to advising consumer "
            "businesses through important strategic decisions, and it is the experience Sam encouraged me to emphasize. I"
            " also ran the annual budget for a $300 million division and rebuilt its driver model, reducing forecast "
            "error from 9% to 3%. This strengthened my ability to identify the assumptions that drive performance and to "
            "produce rigorous, decision-useful analysis.",
            "I also led a five-person team in moving monthly reporting from spreadsheets to a BI dashboard, saving 30 "
            "hours each month. The project required organizing a team around a practical analytical improvement and "
            "delivering a more efficient reporting process. Earlier, as a Credit Analyst at Midwest Regional Bank, I "
            "underwrote 25 middle-market loans ranging from $5 million to $30 million and wrote credit memos for the loan"
            " committee. That experience developed my ability to assess financial information and present conclusions "
            "clearly. Together, these roles have built the analytical foundation, transaction perspective, and "
            "communication skills I hope to bring to Moelis’s Consumer & Retail group.",
            "Thank you to Sam Ortiz for sharing his perspective on Moelis and its summer associate experience. I am "
            "excited about beginning my investment banking career at Moelis and look forward to discussing my candidacy.",
        ],
        ["no recruiter name yet, so it is addressed to Hiring Manager; the guidance says to address it to the firm's recruiter"],
    ),
    'Goldman Sachs': (
        [
            "My name is Jane Doe, and I am a first-year MBA candidate at the Yale School of Management writing to express"
            " my interest in the Investment Banking Summer Associate role in Goldman Sachs’ Technology group. In speaking"
            " with Rachel Kim, I learned that the team staffs summer associates on live deals early, an approach that "
            "would allow me to build transaction judgment through active deal work. Her question about how my FP&A "
            "experience would translate to diligence sharpened my interest in bringing an operating-side perspective to "
            "technology transactions. [[NEED: one additional reason Goldman Sachs appeals to you]]",
            "At Brightline Consumer Brands, I spent four years in finance roles that brought me close to the decisions "
            "behind acquisitions and business performance. I built the three-statement model for a $40 million bolt-on "
            "acquisition of a regional snack brand and presented the returns to the CFO. That work, alongside modeling "
            "consumer and software acquisitions from the corporate side, made me want to become the advisor on the other "
            "side of the table. It also taught me to connect a transaction’s assumptions to operating "
            "realities—experience I would bring to diligence and analysis in the Technology group.",
            "I also ran the annual budget for a $300 million division and rebuilt its driver model, reducing forecast "
            "error from 9% to 3%. Leading a five-person team to move monthly reporting from spreadsheets to a BI "
            "dashboard further strengthened my ability to organize financial information and improve how teams use it; "
            "the rebuild saves 30 hours each month. Earlier, as a credit analyst at Midwest Regional Bank, I underwrote "
            "25 middle-market loans ranging from $5 million to $30 million and prepared credit memos for the loan "
            "committee. Together, these experiences have developed my modeling, analytical and communication skills and "
            "prepared me to contribute to Technology deal teams while continuing to grow as an investment banker.",
            "Thank you to Rachel Kim and the Goldman Sachs team for their time and insight. I am excited about beginning "
            "my investment banking career at Goldman Sachs and look forward to discussing my candidacy.",
        ],
        ["needs your input: one additional reason Goldman Sachs appeals to you", "no recruiter name yet, so it is addressed to Hiring Manager; the guidance says to address it to the firm's recruiter"],
    ),
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
    for bank, (paragraphs, warnings) in LETTERS.items():
        conn.execute("""INSERT INTO cover_letters (user_id, bank, paragraphs, warnings, edited, created_at, updated_at)
                        VALUES (?, ?, ?, ?, 0, ?, ?)""", (uid, bank, json.dumps(paragraphs), json.dumps(warnings), now, now))


def ensure(reset: bool = False) -> dict:
    """Create the demo account with its sample tracker if it is missing; with reset, refill the sample."""
    init_db()
    stars.ensure()
    conn = connect()
    try:
        with conn:
            row = conn.execute("SELECT name FROM users WHERE email = ?", (config.DEMO_EMAIL,)).fetchone()
            existed = bool(row)
            uid = _account(conn)
            if row and row["name"] != NAME:  # the sample student was renamed: refill so every page uses the new name
                conn.execute("UPDATE users SET name = ? WHERE id = ?", (NAME, uid))
                reset = True
            stored = conn.execute("SELECT value FROM app_settings WHERE key = 'demo_sample_version'").fetchone()
            if existed and (stored["value"] if stored else "") != SAMPLE_VERSION:
                reset = True
            conn.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('demo_sample_version', ?)", (SAMPLE_VERSION,))
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
