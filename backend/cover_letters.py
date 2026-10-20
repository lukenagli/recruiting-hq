"""Cover letters, one per bank, written from the user's own profile and tracker in the shape of their own template.

The user's template (a letter they have written, or their school's sample) sets the number of paragraphs, the
length and the voice. Without one, the default is the Yale SOM Finance Club format (Cover Letter Guidance deck):
addressed to the firm's recruiter, and
  1. Introduction: who you are, the role and bank you are applying to, why, and the people you have spoken with
  2-3. Body: relevant experience with specific achievements, and how you would add value
  4. Closing: how you are prepared to succeed (experience, studies, clubs), then thanks and intent to follow up
"Misstating" a name, group or bank can hurt the whole application, so code checks every draft for other banks'
names, contacts from other banks, people never spoken with, leftover placeholders and length, and asks the model
to fix anything it finds once. Whatever is still wrong is shown to the user as a warning next to the letter.
"""
import io
import json
import re
from datetime import date, datetime

from pydantic import BaseModel, Field
from pydantic_ai import Agent, NativeOutput
from pydantic_ai.usage import UsageLimits

from . import banks as bank_info
from . import profile as profiles
from . import schools
from .db import connect, init_db
from .llm import Chosen, usage_dict

LIMITS = UsageLimits(request_limit=2, total_tokens_limit=60_000)
WORDS = (300, 440)
OTHER_BANK_ALIASES = {
    "J.P. Morgan": ["JPMorgan", "JP Morgan", "J.P. Morgan", "JPM"], "Goldman Sachs": ["Goldman"], "Morgan Stanley": ["Morgan Stanley"],
    "Bank of America": ["Bank of America", "BofA", "Merrill"], "Citi": ["Citi", "Citigroup"], "Barclays": ["Barclays"],
    "Evercore": ["Evercore"], "Lazard": ["Lazard"], "Centerview": ["Centerview"], "Guggenheim": ["Guggenheim"],
    "Jefferies": ["Jefferies"], "PJT": ["PJT"], "PWP": ["PWP", "Perella"], "Wells Fargo": ["Wells Fargo"], "RBC": ["RBC"],
    "Harris Williams": ["Harris Williams"], "Rothschild": ["Rothschild"], "Moelis": ["Moelis"], "Houlihan Lokey": ["Houlihan"],
    "Greenhill": ["Greenhill"], "Piper Sandler": ["Piper Sandler"],
}

INSTRUCTIONS = """\
You write investment banking internship cover letters for students, following the shape of the student's \
own template exactly, built from what the student actually learned in their own conversations.

Paragraph 1, introduction: start "My name is <name>, and I am <school line> writing to express my interest in \
the <role>" (the role is given below) and name the group, bank and office when given. Then say why this \
bank, drawn from the student's conversations: name the people they have spoken with (only names from the lists \
provided, spelled exactly as given, bankers first, at most five) and the specific things those conversations \
showed them about the bank and what it values. Use the talking points and process facts too.
Paragraphs 2 and 3, body: the student's most relevant experience, with specific achievements taken only from \
their resume and notes, connected to what this bank and group care about (from the conversations).

Tailoring: if the bank runs a generalist program, tailor the letter to the generalist program (building an \
investment banking skill set across a variety of industries) rather than to one group. Otherwise tailor it to \
the group the student is recruiting for: why that group, and why their experience fits it.
Paragraph 4, closing: in two or three sentences, thank the team members met so far, state excitement about \
beginning an investment banking career at this bank, and say they look forward to discussing their candidacy.

Use exactly the number of paragraphs given under "Shape" below. With four: (1) introduction, the people \
spoken with and why this bank, (2) the student's main role and its relevant work, (3) other relevant work and \
earlier experience, ending with how it prepares them for the role, (4) the short closing. With another number, \
mirror the template's paragraph-by-paragraph structure.

Rules:
- Never make anything up. Every fact, number, name, takeaway, course and club must come from the material given.
- When a strong letter needs something the material does not have (for example a takeaway from a conversation \
with no notes, why this group, a deal or a detail about the bank), do not fill it in. Write a short marker in \
double square brackets saying what is needed, e.g. [[NEED: one thing you took away from talking with Jordan Lee]]. \
Use as many markers as there are real gaps, and no other brackets.
- Mention no bank other than the one applied to, and no people from other banks. Do not describe the people \
you name (their background, past employers, why they chose their group): say what they showed you about this bank.
- Leave out recruiting logistics (screeners, how many chats, deadlines, who runs recruiting). A cover letter \
is about why this bank and why the student fits.
- Investment banking is the goal. Never suggest it is a step toward private equity, business school or anything else.
- Follow any rules in the student's own notes (for example words or punctuation to avoid).
- Plain text paragraphs only: no greeting, no sign-off, no headings.
- Stay within the word range given under "Shape", so the letter fits on one page.
- If an example letter is given, match its voice and level of detail, but write fresh text for this bank.
"""


class Letter(BaseModel):
    paragraphs: list[str] = Field(description="The letter's body paragraphs in order, exactly as many as the Shape asks for.")


agent = Agent(output_type=Letter, instructions=INSTRUCTIONS, name="cover_letter_writer")


def shape(template: str) -> tuple[int, int, int]:
    """(paragraphs, min words, max words) for the letter, read from the user's template when it has one."""
    blocks = [b for b in re.split(r"\n\s*\n|\n", template or "") if b.strip()]
    body = [b for b in blocks if len(b.split()) >= 25]  # skips the date, address, greeting and sign-off lines
    if 2 <= len(body) <= 6:
        words = sum(len(b.split()) for b in body)
        return len(body), max(180, int(words * 0.85)), min(650, int(words * 1.12) + 10)
    return 4, WORDS[0] + 30, WORDS[1] - 20


def _salutation(recruiter: str) -> str:
    recruiter = " ".join(recruiter.split())
    if not recruiter:
        return "Dear Hiring Manager:"
    parts = recruiter.split()
    if parts[0].rstrip(".").lower() in ("mr", "ms", "mrs", "mx", "dr") and len(parts) > 1:
        return f"Dear {parts[0].rstrip('.')}. {parts[-1]}:"
    return f"Dear {recruiter}:"


def _context(conn, uid: int, bank: str) -> dict:
    mine = conn.execute("SELECT * FROM my_banks WHERE user_id = ? AND bank = ?", (uid, bank)).fetchone()
    mine = dict(mine) if mine else {}
    people = [dict(r) for r in conn.execute(
        "SELECT id, name, title, grp, origin, notes FROM people WHERE user_id = ? AND bank = ? ORDER BY name", (uid, bank))]
    spoken = []
    for p in people:
        done = conn.execute(
            """SELECT i.kind, i.summary, ip.notes FROM interaction_people ip JOIN interactions i ON i.id = ip.interaction_id
               WHERE ip.person_id = ? AND i.status = 'done'""", (p["id"],)).fetchall()
        if done and p["origin"] != "listed":
            notes = [d["summary"] or "" for d in done if d["kind"] == "coffee_chat"] + [d["notes"] or "" for d in done if d["kind"] != "coffee_chat"]
            spoken.append({**p, "said": " ".join(n for n in notes if n)[:700]})
    facts = [f"{r['category']}: {r['fact']}" for r in conn.execute(
        """SELECT category, fact FROM bank_facts WHERE user_id = ? AND bank = ?
           AND category NOT IN ('Recruiting process', 'Spots for SOM', 'Team size', 'Offices') ORDER BY category""", (uid, bank))]
    others = [dict(r) for r in conn.execute("SELECT name, bank FROM people WHERE user_id = ? AND bank != ?", (uid, bank))]
    user = conn.execute("SELECT name FROM users WHERE id = ?", (uid,)).fetchone()
    group = (mine.get("prefs") or "").split(">")[0].strip()
    program = " ".join(r["fact"] for r in conn.execute(
        "SELECT fact FROM bank_facts WHERE user_id = ? AND bank = ? AND category = 'Program'", (uid, bank))).lower()
    generalist = "generalist" in program and not re.search(r"\b(cut|no longer|not a generalist|not generalist)\b", program)
    return {"mine": mine, "people": people, "spoken": spoken, "facts": facts, "others": others,
            "name": user["name"] if user else "", "group": group, "office": mine.get("office") or "", "generalist": generalist,
            "school": schools.for_user(uid, conn)}


def _prompt(ctx: dict, prof: dict, bank: str) -> str:
    def lines(people):
        return "\n".join(f"- {p['name']} ({', '.join(x for x in (p['title'], p['grp']) if x) or 'role not recorded'}): "
                         f"{p['said'] or 'no notes recorded'}" for people_ in [people] for p in people_) or "- (none)"
    sc = ctx["school"]
    is_student = lambda p: p["title"] in ("2Y", "Student", "student") or p.get("alum") == "student"
    bankers = [p for p in ctx["spoken"] if not is_student(p)]
    students = [p for p in ctx["spoken"] if is_student(p)]
    spoken = f"Bankers:\n{lines(bankers)}\n{sc['peers']} going to this bank (name them only if there are few bankers):\n{lines(students)}"
    n, lo, hi = shape(prof["example_letter"])
    parts = [
        f"Student: {ctx['name']}",
        f"School line: {prof['school_line'] or schools.default_school_line(sc) or '[[NEED: your school and year]]'}",
        f"Shape: exactly {n} paragraphs, {lo} to {hi} words in total.",
        f"Applying to: Investment Banking {sc['role']} role at {bank}"
        + (f", {ctx['office']} office" if ctx["office"] else ""),
        ("Program: generalist. Tailor the letter to the generalist program; do not name a group in the opening sentence."
         if ctx["generalist"] else
         f"Program: group-specific or not known. Tailor the letter to the {ctx['group'] or '[[NEED: group]]'} group and name it in the opening sentence."),
        f"People the student has spoken with at {bank} (the only names you may use):\n{spoken}",
        "What the student has learned about the bank (topic: fact):\n" + ("\n".join(f"- {f}" for f in ctx["facts"]) or "- (nothing recorded)"),
        f"Student's notes (why banking, why this industry, stories, rules):\n{prof['story'] or '(none)'}",
        f"Resume:\n{prof['resume_text'] or '(not provided)'}",
    ]
    if prof["example_letter"]:
        parts.append("The student's template, for structure, voice and level of detail (it may have been written for another "
                     f"bank, so do not copy bank-specific content):\n{prof['example_letter']}")
    return "\n\n".join(parts)


def problems(paragraphs: list[str], bank: str, ctx: dict, template: str = "") -> list[str]:
    text = "\n".join(paragraphs)
    found = []
    words = len(text.split())
    n, lo, hi = shape(template)
    lo, hi = lo - 30, hi + 20  # a little slack around the asked-for range before it counts as a problem
    if not lo <= words <= hi:
        found.append(f"the letter is {words} words; keep it between {lo} and {hi} so it fits on one page")
    if len(paragraphs) != n:
        found.append(f"it has {len(paragraphs)} paragraphs; use exactly {n}")
    if paragraphs and bank.split()[0].lower() not in paragraphs[0].lower():
        found.append(f"the first paragraph does not name {bank}")
    for other, aliases in OTHER_BANK_ALIASES.items():
        if other != bank and any(re.search(rf"\b{re.escape(a)}\b", text) for a in aliases):
            found.append(f"it mentions {other}, which is a different bank")
    for p in ctx["others"]:
        if len(p["name"].split()) > 1 and p["name"] in text:
            found.append(f"it names {p['name']}, who is at {p['bank']}, not {bank}")
    spoken = {p["name"] for p in ctx["spoken"]}
    for p in ctx["people"]:
        if len(p["name"].split()) > 1 and p["name"] in text and p["name"] not in spoken:
            found.append(f"it names {p['name']}, whom the student has not spoken with yet")
    for p in ctx["people"]:  # a contact's first name followed by a different surname is a misspelling
        first, *rest = p["name"].split()
        if rest:
            for surname in re.findall(rf"\b{re.escape(first)}\s+([A-Z][\w'-]+)", text):
                if surname != rest[-1] and surname not in rest:
                    found.append(f"it spells {first} {surname}, but the tracker has {p['name']}")
    if re.search(r"(?<!\[)\[(?!\[)[^\]]*\](?!\])", text):
        found.append("it has a bracket that is not a [[NEED: ...]] marker")
    if re.search(r"(return|go back|move|transition|pivot|path)\w*\s+(back\s+)?(in)?to\s+private equity|private equity\s+(career|goal|in the long)", text, re.I):
        found.append("it suggests private equity as a goal")
    return found


async def write(uid: int, chosen: Chosen, bank: str) -> dict:
    init_db()
    prof = profiles.get(uid)
    if not prof["resume_text"].strip():
        return {"ok": False, "reason": "Add your resume in Settings first, so the letter can use your real experience."}
    with connect(read_only=True) as conn:
        ctx = _context(conn, uid, bank)
    base = _prompt(ctx, prof, bank)
    started = datetime.now().isoformat(timespec="seconds")
    total = {"input_tokens": 0, "cached_input_tokens": 0, "output_tokens": 0, "requests": 0}
    prompt, issues, paragraphs = base, [], []
    output = NativeOutput(Letter) if chosen.provider == "anthropic" else None  # Claude rejects forced tool calls
    for _ in range(2):
        result = await agent.run(prompt, model=chosen.model, model_settings=chosen.settings, usage_limits=LIMITS, output_type=output)
        for k, v in usage_dict(result.usage).items():
            total[k] += v
        paragraphs = [" ".join(p.split()) for p in result.output.paragraphs if p.strip()]
        issues = problems(paragraphs, bank, ctx, prof["example_letter"])
        if not issues:
            break
        prompt = f"{base}\n\nYour last draft broke these rules, fix them and return the whole letter again:\n- " + "\n- ".join(issues) \
                 + "\n\nLast draft:\n" + "\n\n".join(paragraphs)
    for need in re.findall(r"\[\[NEED:\s*([^\]]+)\]\]", "\n".join(paragraphs)):
        issues.append(f"needs your input: {need.strip()}")
    if not ctx["spoken"]:
        issues.append(f"you have not logged anyone you spoke with at {bank}, so the letter names no one; the guidance says to list the people you have spoken to")
    if not ctx["mine"].get("recruiter_name"):
        issues.append("no recruiter name yet, so it is addressed to Hiring Manager; the guidance says to address it to the firm's recruiter")
    now = datetime.now().isoformat(timespec="seconds")
    with connect() as conn:
        conn.execute(
            """INSERT INTO cover_letters (user_id, bank, paragraphs, warnings, edited, created_at, updated_at)
               VALUES (?, ?, ?, ?, 0, ?, ?)
               ON CONFLICT(user_id, bank) DO UPDATE SET paragraphs = excluded.paragraphs, warnings = excluded.warnings,
                 edited = 0, updated_at = excluded.updated_at""",
            (uid, bank, json.dumps(paragraphs), json.dumps(issues), now, now))
        conn.execute(
            """INSERT INTO agent_runs (user_id, started_at, agent, user_message, reply, steps, outcome, requests,
                                       input_tokens, cached_input_tokens, output_tokens)
               VALUES (?, ?, 'cover_letter_writer', ?, ?, '[]', ?, ?, ?, ?, ?)""",
            (uid, started, f"Cover letter for {bank}", "\n\n".join(paragraphs), "ok" if not issues else "rule_warnings",
             total["requests"], total["input_tokens"], total["cached_input_tokens"], total["output_tokens"]))
    return {"ok": True, **get(uid, bank), "usage": total}


def _recipient(uid: int, bank: str, mine: dict) -> list[str]:
    lines = [mine.get("recruiter_name") or "Hiring Manager"]
    if mine.get("recruiter_title"):
        lines.append(mine["recruiter_title"])
    lines.append(bank_info.LETTER_NAMES.get(bank, bank))
    lines += (mine.get("address") or bank_info.ADDRESSES.get(bank, "")).splitlines() or ["[Office address]"]
    return lines


def get(uid: int, bank: str) -> dict:
    init_db()
    with connect(read_only=True) as conn:
        row = conn.execute("SELECT * FROM cover_letters WHERE user_id = ? AND bank = ?", (uid, bank)).fetchone()
        mine = conn.execute("SELECT * FROM my_banks WHERE user_id = ? AND bank = ?", (uid, bank)).fetchone()
        user = conn.execute("SELECT name FROM users WHERE id = ?", (uid,)).fetchone()
    mine = dict(mine) if mine else {}
    return {
        "bank": bank,
        "exists": row is not None,
        "paragraphs": json.loads(row["paragraphs"]) if row else [],
        "warnings": json.loads(row["warnings"]) if row else [],
        "edited": bool(row["edited"]) if row else False,
        "updated_at": row["updated_at"] if row else "",
        "date": f"{date.today():%B} {date.today().day}, {date.today().year}",
        "recipient": _recipient(uid, bank, mine),
        "salutation": _salutation(mine.get("recruiter_name", "")),
        "signature": user["name"] if user else "",
        "recruiter_name": mine.get("recruiter_name", ""),
        "recruiter_title": mine.get("recruiter_title", ""),
        "address": mine.get("address") or bank_info.ADDRESSES.get(bank, ""),
        "office": mine.get("office", ""),
    }


def save_edits(uid: int, bank: str, paragraphs: list[str] | None, details: dict) -> dict:
    """Save the user's own edits to the letter text and/or who it is addressed to."""
    init_db()
    with connect() as conn:
        conn.execute("INSERT OR IGNORE INTO my_banks (user_id, bank, applied, deadline, link, prefs, notes) VALUES (?, ?, '', '', '', '', '')", (uid, bank))
        for field in ("recruiter_name", "recruiter_title", "address", "office"):
            if field in details:
                conn.execute(f"UPDATE my_banks SET {field} = ? WHERE user_id = ? AND bank = ?", (str(details[field]).strip()[:300], uid, bank))
        if paragraphs is not None:
            clean = [" ".join(p.split()) for p in paragraphs if p.strip()]
            conn.execute("UPDATE cover_letters SET paragraphs = ?, edited = 1, updated_at = ? WHERE user_id = ? AND bank = ?",
                         (json.dumps(clean), datetime.now().isoformat(timespec="seconds"), uid, bank))
    return get(uid, bank)


def overview(uid: int) -> list[dict]:
    """Every bank the user is still in, with whether a letter exists yet."""
    init_db()
    with connect(read_only=True) as conn:
        banks = [r["bank"] for r in conn.execute(
            "SELECT bank FROM my_banks WHERE user_id = ? AND COALESCE(status, '') != 'out' ORDER BY bank", (uid,))]
        letters = {r["bank"]: r for r in conn.execute("SELECT bank, warnings, updated_at, edited FROM cover_letters WHERE user_id = ?", (uid,))}
        recruiters = {r["bank"]: r["recruiter_name"] for r in conn.execute("SELECT bank, recruiter_name FROM my_banks WHERE user_id = ?", (uid,))}
    return [{"bank": b, "domain": bank_info.domain(b), "exists": b in letters,
             "warnings": len(json.loads(letters[b]["warnings"])) if b in letters else 0,
             "updated_at": letters[b]["updated_at"] if b in letters else "", "edited": bool(letters[b]["edited"]) if b in letters else False,
             "recruiter": recruiters.get(b) or ""} for b in banks]


def docx_bytes(uid: int, bank: str) -> bytes:
    """The letter as a Word file: the school's letterhead for Yale SOM accounts, the student's name otherwise."""
    import docx
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Inches, Pt, RGBColor

    letter, prof = get(uid, bank), profiles.get(uid)
    doc = docx.Document()
    for section in doc.sections:
        section.left_margin = section.right_margin = section.top_margin = section.bottom_margin = Inches(1)
        footer = section.footer.paragraphs[0]
        footer.text = prof["contact_line"]
        footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
        for run in footer.runs:
            run.font.size = Pt(9)
    style = doc.styles["Normal"]
    style.font.name = "Times New Roman"
    style.font.size = Pt(11)
    style.paragraph_format.space_after = Pt(0)

    head = doc.add_paragraph()
    if schools.for_user(uid)["school"] == "Yale SOM":
        for text, size, caps in (("Yale ", 16, False), ("SCHOOL OF MANAGEMENT", 12, True)):
            run = head.add_run(text)
            run.font.size, run.font.color.rgb, run.font.small_caps = Pt(size), RGBColor(0x0F, 0x2A, 0x5F), caps
    else:
        head.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = head.add_run(letter["signature"])
        run.bold, run.font.size = True, Pt(14)
    border = OxmlElement("w:pBdr")  # the blue rule under the school name
    bottom = OxmlElement("w:bottom")
    for key, value in (("w:val", "single"), ("w:sz", "12"), ("w:space", "4"), ("w:color", "2E5C9A")):
        bottom.set(qn(key), value)
    border.append(bottom)
    head._p.get_or_add_pPr().append(border)

    def line(text: str = "", space_after: int = 0, justify: bool = False):
        p = doc.add_paragraph(text)
        p.paragraph_format.space_after = Pt(space_after)
        if justify:
            p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        return p

    line()
    line(letter["date"], 11)
    for i, text in enumerate(letter["recipient"]):
        line(text, 11 if i == len(letter["recipient"]) - 1 else 0)
    line(letter["salutation"], 11)
    from docx.enum.text import WD_COLOR_INDEX

    for paragraph in letter["paragraphs"]:
        p = line("", 11, justify=True)
        for piece in re.split(r"(\[\[NEED:[^\]]*\]\])", paragraph):
            if piece:
                run = p.add_run(piece)
                if piece.startswith("[[NEED:"):
                    run.font.highlight_color = WD_COLOR_INDEX.YELLOW
    line("Sincerely,", 22)
    line(letter["signature"])
    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()
