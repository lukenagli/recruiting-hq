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
from . import letter_layout, schools, shared, templates
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

# Every letter is the student's own letter (or one they already submitted for the same group), changed as
# little as possible. Cover letters are a box to check: their own tone, wording and flow, the right names, and the
# group folded into their sentences the way second-years' sample letters do, never details from the conversations.
TAILOR = """\
You tailor a student's own investment banking cover letter to one bank. Banks read cover letters as a box to check: \
what matters is a polished, professional "why this firm", the right names, and no mistakes. The student wrote the \
starting letter themselves, in their own tone, wording and flow, and that is what they want kept. So change as few \
words as you can: keep every sentence, in order, with its wording, and edit only what has to change for this bank \
and this role. Never add a sentence and never drop one.

What changes:
- Anything that belongs to the bank the starting letter was written for: its name, the people it names (use the \
people given below instead, bankers first, at most five, spelled exactly as given), the office, and any detail \
specific to that bank.
- The group, when the role is in one named group (a group placement). Bankers want to see why this group and why \
this student for it, said the way second-years' sample letters say it: a few words folded into the student's own \
sentences, never a sentence of personal reasons. When the starting letter already has the right group, leave its \
group wording exactly as it is.
  - Opening: name the group with the role in the first sentence ("...the Investment Banking Summer Associate role in \
the <group> group at <bank> in <office>", leaving the office out when none is given). In the sentence about what the conversations showed, add the group as the \
last item ("...the breadth of its global platform, and the growth of its <group> group"). In the sentence giving the \
reason for the firm, make the reason advising the group's companies ("...in combination with the opportunity to \
advise leading <the group's kind of companies> on their most important transactions, has cemented my interest in \
<bank>").
  - Experience paragraphs: where a phrase points the student's experience at a different industry or group, replace \
that phrase (don't add to it) with one aimed at this group, using only facts already in the letter or the resume, \
so the sentence stays about as long. For example, for a consumer group, "evaluate new investments across industries \
including aviation, aerospace and defense, and energy, while also supporting the firm's portfolio companies" becomes \
"evaluate new investments while also supporting the firm's portfolio airlines, where consumer demand and pricing \
strategy drive performance". The paragraph's last line can name the group ("...required to succeed as a Summer Associate in \
the <group> group"). At most one such change per paragraph; leave everything else as written.
  - Closing: name the group with the bank ("...beginning my career in investment banking with the <group> group at \
<bank>").
  - Name the group at most once in any sentence, and don't pile up "and"s in a sentence.
- For a generalist program, name no group: the reason for the firm is the breadth of the generalist program.

Never put specifics from the conversations or about how recruiting works into the letter: no homework, case studies or \
final projects, training, staffing or mentor assignments, whether the program is group-specific or generalist as a \
fact someone told you, team sizes, offices or headcounts, deals, anecdotes, or what any one person said or did. Keep \
it general and gracious, the way every sample letter is.

Rules:
- Never make anything up: no new claims, figures or responsibilities. Names must come from the list given; no facts \
about the bank beyond general qualities like its culture or the breadth of its platform.
- No colons, statistics, anecdotes or inner reflection ("what held my interest").
- Mention no bank other than the one applied to, and no people from other banks.
- Investment banking is the goal. Never suggest it is a step toward private equity, business school or anything else.
- Follow any rules in the student's own notes (for example words or punctuation to avoid).
- Plain text paragraphs only: no greeting, no sign-off, no headings. Use exactly the starting letter's number of paragraphs.
- Keep the letter's length: it has to fit on one page.
- Use a [[NEED: ...]] marker only for something the letter truly cannot do without (for example the group, when none is given).
"""

class Letter(BaseModel):
    paragraphs: list[str] = Field(description="The letter's body paragraphs in order, exactly as many as the Shape asks for.")


tailor_agent = Agent(output_type=Letter, instructions=TAILOR, name="cover_letter_writer")


def _body(template: str) -> list[str]:
    """The body paragraphs of the user's letter, without the date, address, greeting and sign-off lines."""
    return [b for b in re.split(r"\n\s*\n|\n", template or "") if len(b.split()) >= 25]


def _sentences(text: str) -> list[str]:
    return [s for s in re.split(r"(?<=[.!?])\s+(?=[A-Z])", text.strip()) if s]


def _added(tailored: str, original: str) -> list[str]:
    """Sentences a tailored paragraph has beyond the student's own: as many as it has extra, the ones least like
    any of the student's sentences (a sentence of theirs may have half its words changed, as when its reason
    becomes the group)."""
    words = lambda s: set(re.findall(r"[a-z']+", s.lower()))  # noqa: E731
    mine, theirs = [words(s) for s in _sentences(original)], _sentences(tailored)
    extra = len(theirs) - len(mine)
    if extra <= 0:
        return []
    likeness = lambda s: max((len(words(s) & m) / max(1, len(words(s))) for m in mine), default=0)  # noqa: E731
    return sorted(theirs, key=likeness)[:extra]


def _grown(tailored: str, original: str) -> list[tuple[str, int]]:
    """Each tailored sentence with how many words longer it is than the student's sentence it is most like (a
    bank's name counts as one word, so "Morgan Stanley" in place of "Guggenheim" doesn't count as growth)."""
    words = lambda s: set(re.findall(r"[a-z']+", s.lower()))  # noqa: E731
    names = [a for aliases in OTHER_BANK_ALIASES.values() for a in sorted(aliases, key=len, reverse=True)]
    length = lambda s: len(re.sub("|".join(re.escape(n) for n in names), "Bank", s).split())  # noqa: E731
    mine = _sentences(original)
    out = []
    for s in _sentences(tailored):
        twin = max(mine, key=lambda m: len(words(s) & words(m)), default="")
        out.append((s, length(s) - length(twin)))
    return out


def shape(template: str) -> tuple[int, int, int]:
    """(paragraphs, min words, max words) for the letter, read from the user's template when it has one."""
    body = _body(template)
    if 2 <= len(body) <= 6:
        words = sum(len(b.split()) for b in body)
        return len(body), max(180, int(words * 0.85)), min(650, int(words * 1.12) + 10)
    return 4, WORDS[0] + 30, WORDS[1] - 20


def _salutation(recruiter: str) -> str:
    recruiter = " ".join(recruiter.split())
    if not recruiter:
        return "Dear Hiring Manager,"
    parts = recruiter.split()
    if parts[0].rstrip(".").lower() in ("mr", "ms", "mrs", "mx", "dr") and len(parts) > 1:
        return f"Dear {parts[0].rstrip('.')}. {parts[-1]},"
    return f"Dear {recruiter},"


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
    # "the generalist pool was discontinued this year" means group-specific
    generalist = "generalist" in program and not re.search(
        r"\b(cut|no longer|not a generalist|not generalist|no generalist|discontinu\w*|eliminat\w*|scrapp\w*|ended|removed|replaced"
        r"|got rid of)\b", program)
    return {"mine": mine, "people": people, "spoken": spoken, "facts": facts, "others": others,
            "name": user["name"] if user else "", "group": group, "office": mine.get("office") or "", "generalist": generalist,
            "school": schools.for_user(uid, conn)}


def _prompt(ctx: dict, prof: dict, bank: str, ref: dict | None = None) -> str:
    sc = ctx["school"]
    is_student = lambda p: p["title"] in ("2Y", "Student", "student") or p.get("alum") == "student"
    bankers = [p for p in ctx["spoken"] if not is_student(p)]
    students = [p for p in ctx["spoken"] if is_student(p)]
    n, _lo, _hi = shape(_starting(prof, ref))
    # names and roles only: what was said in the chats stays out of the letter
    names = lambda ps: "\n".join(f"- {p['name']} ({', '.join(x for x in (p['title'], p['grp']) if x) or 'role not recorded'})" for p in ps) or "- (none)"  # noqa: E731
    return "\n\n".join([
        f"Student writing the letter (\"My name is\" uses exactly this name): {ctx['name']}",
        f"School line: {prof['school_line'] or schools.default_school_line(sc) or '[[NEED: your school and year]]'}",
        f"Shape: exactly {n} paragraphs, as in the starting letter.",
        f"Applying to: Investment Banking {sc['role']} role at {bank}" + (f", {ctx['office']} office" if ctx["office"] else ""),
        ("Program: generalist, so name no group." if ctx["generalist"] else
         f"Group placement: the {ctx['group'] or '[[NEED: group]]'} group."),
        f"People the student has spoken with at {bank} (the only names you may use):\nBankers:\n{names(bankers)}\n"
        f"{sc['peers']} going to this bank (name them after the bankers, only if there are few bankers):\n{names(students)}",
        *([] if ctx["generalist"] else [
            f"The student's notes (their target groups and why, what to highlight):\n{profiles.background(prof) or '(none)'}",
            f"Resume (facts the bridging sentences may use):\n{prof['resume_text'] or '(not provided)'}"]),
        f"Rules from the student's own notes:\n{prof['email_rules'] or '(none)'}",
        (f"Starting letter: the one the student wrote for {ref['bank'] or 'another bank'} for the same "
         f"{'generalist program' if ctx['generalist'] else ctx['group'] + ' role'}. Its group wording is already right: change "
         f"only what belongs to {ref['bank']} (its name, the people it names: {', '.join(ref['people']) or 'none'}, its office "
         f"and anything else specific to it) and keep every other word.\n{_starting(prof, ref)}" if ref and ref["same_group"] else
         f"Starting letter: the student's letter to {ref['bank'] or 'another bank'}, their most similar one "
         f"({', '.join(ref['reasons']) or 'their closest letter'}). Change what belongs to {ref['bank'] or 'that bank'} (its name, "
         f"the people it names: {', '.join(ref['people']) or 'none'}, its office and anything else specific to it) and the "
         f"group wording as described, and keep every other word.\n{_starting(prof, ref)}" if ref else
         f"Starting letter: the student's own letter (written for another bank or role), to tailor:\n{prof['example_letter']}"),
        *(["The student's other letters, for their wording only: where a phrase in the starting letter has to change (how "
           "they describe a group, or why a kind of firm), prefer how the student already said it in one of these. Never "
           "take their bank names, people or offices.\n\n" + "\n\n".join(f"--- Letter to {o['bank']} ---\n" + "\n\n".join(o["paragraphs"])
                                                                        for o in ref["others"])] if ref and ref["others"] else []),
    ])


# Details from the chats or about how recruiting works, which the 2Y sample letters never include.
TOO_SPECIFIC = re.compile(r"homework|case study|final project|super ?day|group[- ]specific|generalist (pool|internship)|staff(ed|ing)|"
                          r"junior and (a )?senior mentor|\b\d+ (analysts|associates|interns|people)\b|team size|I learned that", re.I)


def _group_key(ctx: dict) -> str:
    """Which letters are interchangeable: the same group (however it is written), or the generalist program."""
    if ctx["generalist"]:
        return "generalist"
    return re.sub(r"\b(group|team|ib|investment banking)\b|[^a-z]", "", ctx["group"].lower().replace("&", "and"))


def _letter_bank(prof: dict, filename: str) -> str:
    """The bank the student's uploaded letter was written for: named in its file name, else in its text."""
    for text in (filename, prof["example_letter"]):
        for bank, aliases in OTHER_BANK_ALIASES.items():
            if any(re.search(rf"\b{re.escape(a)}\b", text or "") for a in aliases):
                return bank
    return ""


def _letters(conn, uid: int, bank: str, prof: dict) -> list[dict]:
    """Every letter of the student's a draft could start from, newest first: each one submitted to another bank, and
    the letter they uploaded (their first one, written for some bank)."""
    rows = conn.execute(
        """SELECT c.bank, c.paragraphs FROM cover_letters c
           LEFT JOIN my_banks m ON m.user_id = c.user_id AND m.bank = c.bank
           WHERE c.user_id = ? AND c.bank != ?
             AND (COALESCE(c.submitted_at, '') NOT IN ('', 'no') OR (COALESCE(c.submitted_at, '') = '' AND m.applied = 'Yes'))
           ORDER BY COALESCE(NULLIF(c.submitted_at, ''), c.updated_at) DESC""", (uid, bank)).fetchall()
    out = []
    for r in rows:
        other = _context(conn, uid, r["bank"])
        out.append({"bank": r["bank"], "paragraphs": json.loads(r["paragraphs"]), "people": [p["name"] for p in other["spoken"]],
                    "ctx": other, "uploaded": False})
    if prof["example_letter"].strip():
        first = _letter_bank(prof, templates.cover_template_info(uid)["filename"])
        if first != bank and first not in {o["bank"] for o in out}:
            other = _context(conn, uid, first) if first else None
            out.append({"bank": first, "paragraphs": [p.strip() for p in prof["example_letter"].split("\n\n") if p.strip()],
                        "people": [p["name"] for p in other["spoken"]] if other else [], "ctx": other, "uploaded": True})
    return out


def _likeness(ctx: dict, bank: str, letter: dict) -> tuple[int, list[str]]:
    """How alike two applications are, for which letter to start from: the same group (its wording is already right),
    the same kind of program (generalist or one group), the same kind of bank (bulge bracket, boutique, middle market)."""
    # the kind of program and the kind of bank shape a letter most (a bulge bracket's group-specific letter reads like
    # another's); the same group on top of that means its group wording is already right
    other, score, why = letter["ctx"], 0, []
    if other:
        key, theirs = _group_key(ctx), _group_key(other)
        if ctx["generalist"] == other["generalist"]:
            score += 3
            why.append("also a generalist program" if ctx["generalist"] else "also a group-specific program")
        if key and key == theirs and key != "generalist":
            score += 2
            why.append(f"same group ({ctx['group']})")
    if letter["bank"] and bank_info.kind(letter["bank"]) == bank_info.kind(bank):
        score += 3
        k = bank_info.kind(bank)
        why.append(f"also {'an' if k[0] in 'aeiou' else 'a'} {k}")
    return score, why


def _reference(conn, uid: int, bank: str, ctx: dict, prof: dict | None = None) -> dict | None:
    """The letter a draft starts from: of every letter the student submitted (and the one they uploaded), the one for
    the application most like this one, newest first among equals; with the next two most alike, whose wording the
    writer may borrow when a phrase has to change. Submitted means marked submitted on its page, or the application
    to that bank is marked as sent."""
    prof = prof or profiles.get(uid)
    letters = _letters(conn, uid, bank, prof)
    if not letters:
        return None
    scored = [(*_likeness(ctx, bank, letter), -i, letter) for i, letter in enumerate(letters)]
    scored.sort(key=lambda s: (s[0], s[2]), reverse=True)  # most alike, then newest
    score, why, _, best = scored[0]
    others = [{"bank": s[3]["bank"], "paragraphs": s[3]["paragraphs"]} for s in scored[1:3] if s[0] > 0 and s[3]["bank"]]
    same = bool(best["ctx"]) and bool(_group_key(ctx)) and _group_key(ctx) == _group_key(best["ctx"])
    return {"bank": best["bank"], "paragraphs": best["paragraphs"], "people": best["people"], "uploaded": best["uploaded"],
            "same_group": same, "reasons": why, "others": others}


def basis(uid: int, bank: str) -> dict | None:
    """What the next draft for this bank starts from, said plainly for the letter page."""
    init_db()
    prof = profiles.get(uid)
    with connect(read_only=True) as conn:
        ctx = _context(conn, uid, bank)
        ref = _reference(conn, uid, bank, ctx, prof)
    if not ref:
        return None
    return {"bank": ref["bank"] or "your first letter", "uploaded": ref["uploaded"], "reasons": ref["reasons"],
            "others": [o["bank"] for o in ref["others"]]}


def _starting(prof: dict, ref: dict | None) -> str:
    """The letter a draft starts from: a submitted one for the same group, else the student's uploaded letter."""
    return "\n\n".join(ref["paragraphs"]) if ref else prof["example_letter"]


def problems(paragraphs: list[str], bank: str, ctx: dict, template: str = "") -> list[str]:
    text = "\n".join(paragraphs)
    found = []
    # the writer's own name, exactly: a contact who shares a first name has been swapped in before
    said = re.match(r"\s*My name is ([^,]+),", paragraphs[0]) if paragraphs else None
    if ctx["name"] and paragraphs and (ctx["name"] not in paragraphs[0] or (said and said[1].strip() != ctx["name"])):
        found.append(f"the opening must say \"My name is {ctx['name']}\": that is the student writing the letter, not anyone they met")
    found += [f"it mentions \"{m}\": keep the opening to general reasons for the firm, as the sample letters do"
              for m in dict.fromkeys(m.group(0) for m in TOO_SPECIFIC.finditer(paragraphs[0] if paragraphs else ""))]
    # every paragraph is the student's own: words change inside their sentences, sentences are never added or dropped
    for k, (tailored, original) in enumerate(zip(paragraphs, _body(template)), start=1):
        found += [f'paragraph {k} adds the sentence "{s}": drop it, and if the group needs a mention there, put a few words '
                  "into one of the student's existing sentences instead" for s in _added(tailored, original)]
        if len(_sentences(tailored)) < len(_sentences(original)):
            found.append(f"paragraph {k} drops one of the student's sentences: keep every sentence, changing only the words that must")
        if k > 1:  # experience and closing: a phrase aimed at the group replaces one, it isn't tacked on
            found += [f'the sentence "{s}" is {grew} words longer than the student\'s: replace the words that point elsewhere '
                      "instead of adding to them" for s, grew in _grown(tailored, original) if grew > 6]
    group = ctx["group"].strip()
    if group and not ctx["generalist"]:
        found += [f'the sentence "{s}" names the {group} group more than once: name it once' for p in paragraphs
                  for s in _sentences(p) if s.lower().count(group.lower()) > 1]
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
    if not prof["example_letter"].strip():
        return {"ok": False, "reason": "Upload a cover letter you wrote yourself first (top of this page). Each bank's letter is "
                                       "your letter, tailored to that bank."}
    with connect(read_only=True) as conn:
        ctx = _context(conn, uid, bank)
        ref = _reference(conn, uid, bank, ctx, prof)  # the student's letter most like this application
    base = _prompt(ctx, prof, bank, ref)
    writer = tailor_agent
    started = datetime.now().isoformat(timespec="seconds")
    total = {"input_tokens": 0, "cached_input_tokens": 0, "output_tokens": 0, "requests": 0}
    prompt, issues, paragraphs = base, [], []
    output = NativeOutput(Letter) if chosen.provider == "anthropic" else None  # Claude rejects forced tool calls
    for _ in range(3):
        result = await writer.run(prompt, model=chosen.model, model_settings=chosen.settings, usage_limits=LIMITS, output_type=output)
        for k, v in usage_dict(result.usage).items():
            total[k] += v
        paragraphs = [" ".join(p.split()) for p in result.output.paragraphs if p.strip()]
        issues = problems(paragraphs, bank, ctx, _starting(prof, ref))
        # it must fit on one page in the student's own template, margins barely touched
        over = letter_layout.fit_one_page(_document(uid, bank, paragraphs))
        if over:
            lines = max(1, round(over + 0.49))
            issues.append(f"it runs about {lines} line{'s' if lines > 1 else ''} past one page: cut about {lines * 14 + 5} "
                          "words, from the opening first, then by tightening wording in the other paragraphs (keep every "
                          "fact, name and sentence)")
        if not issues:
            break
        prompt = f"{base}\n\nYour last draft broke these rules, fix them and return the whole letter again:\n- " + "\n- ".join(issues) \
                 + "\n\nLast draft:\n" + "\n\n".join(paragraphs)
    if ctx["name"] and paragraphs:  # last resort: the writer's own name is never left wrong
        paragraphs[0] = re.sub(r"^(\s*My name is )[^,]+,", lambda m: f"{m[1]}{ctx['name']},", paragraphs[0])
        if ctx["name"] in paragraphs[0]:
            issues = [i for i in issues if not i.startswith('the opening must say "My name is')]
    for need in re.findall(r"\[\[NEED:\s*([^\]]+)\]\]", "\n".join(paragraphs)):
        issues.append(f"needs your input: {need.strip()}")
    if not ctx["spoken"]:
        issues.append(f"you have not logged anyone you spoke with at {bank}, so the letter names no one; the guidance says to list the people you have spoken to")
    if ref and ref["bank"]:
        issues.append(f"started from your {ref['bank']} letter: check nothing specific to {ref['bank']} is left")
    if not shared.bank_detail(bank, ctx["mine"])["recruiter_name"]:
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
    info = shared.bank_detail(bank, mine)
    lines = [info["recruiter_name"] or "Hiring Manager"]
    if info["recruiter_title"]:
        lines.append(info["recruiter_title"])
    lines.append(info["letter_name"] or bank)
    lines += info["address"].splitlines() or ["[Office address]"]
    return lines


def get(uid: int, bank: str) -> dict:
    init_db()
    with connect(read_only=True) as conn:
        row = conn.execute("SELECT * FROM cover_letters WHERE user_id = ? AND bank = ?", (uid, bank)).fetchone()
        mine = conn.execute("SELECT * FROM my_banks WHERE user_id = ? AND bank = ?", (uid, bank)).fetchone()
        user = conn.execute("SELECT name FROM users WHERE id = ?", (uid,)).fetchone()
    mine = dict(mine) if mine else {}
    info = shared.bank_detail(bank, mine)  # the student's own, else what the admin pushed
    return {
        "bank": bank,
        "exists": row is not None,
        "paragraphs": json.loads(row["paragraphs"]) if row else [],
        "warnings": json.loads(row["warnings"]) if row else [],
        "edited": bool(row["edited"]) if row else False,
        "submitted": _submitted(row["submitted_at"] if row else None, mine.get("applied")),
        "updated_at": row["updated_at"] if row else "",
        "date": f"{date.today():%B} {date.today().day}, {date.today().year}",
        "recipient": _recipient(uid, bank, mine),
        "salutation": _salutation(info["recruiter_name"]),
        "signature": user["name"] if user else "",
        "recruiter_name": info["recruiter_name"],
        "recruiter_title": info["recruiter_title"],
        "address": info["address"],
        "office": mine.get("office", ""),
        "basis": basis(uid, bank),
    }


def save_edits(uid: int, bank: str, paragraphs: list[str] | None, details: dict) -> dict:
    """Save the user's own edits to the letter text and/or who it is addressed to."""
    init_db()
    with connect() as conn:
        conn.execute("INSERT OR IGNORE INTO my_banks (user_id, bank, applied, deadline, link, prefs, notes) VALUES (?, ?, '', '', '', '', '')", (uid, bank))
        mine = conn.execute("SELECT * FROM my_banks WHERE user_id = ? AND bank = ?", (uid, bank)).fetchone()
        shown = shared.bank_detail(bank, dict(mine) if mine else {})
        for field in ("recruiter_name", "recruiter_title", "address", "office"):
            if field in details:
                value = str(details[field]).strip()[:300]
                # a filled-in field emptied on purpose stays empty (no default), on this save and later ones
                if not value and (shown.get(field) or (mine and mine[field] == shared.CLEARED)):
                    value = shared.CLEARED
                conn.execute(f"UPDATE my_banks SET {field} = ? WHERE user_id = ? AND bank = ?", (value, uid, bank))
        if paragraphs is not None:
            clean = [" ".join(p.split()) for p in paragraphs if p.strip()]
            row = conn.execute("SELECT warnings FROM cover_letters WHERE user_id = ? AND bank = ?", (uid, bank)).fetchone()
            needs = set(re.findall(r"\[\[NEED:\s*([^\]]+)\]\]", "\n".join(clean)))
            # a "needs your input" warning goes once its [[NEED: ...]] marker has been filled in
            warnings = [w for w in json.loads(row["warnings"]) if not w.startswith("needs your input: ") or
                        w.removeprefix("needs your input: ").strip() in {n.strip() for n in needs}] if row else []
            conn.execute("UPDATE cover_letters SET paragraphs = ?, warnings = ?, edited = 1, updated_at = ? WHERE user_id = ? AND bank = ?",
                         (json.dumps(clean), json.dumps(warnings), datetime.now().isoformat(timespec="seconds"), uid, bank))
    return get(uid, bank)


def _submitted(submitted_at: str | None, applied: str | None) -> bool:
    """A letter counts as sent when the student marked it so, or (unless they said it wasn't) its application is sent."""
    if submitted_at is None:
        return False
    return submitted_at not in ("", "no") or (submitted_at == "" and applied == "Yes")


def mark_submitted(uid: int, bank: str, submitted: bool) -> dict:
    """The student says this letter went out, or that it didn't ("no", which outranks an application marked
    as sent). Letters sent are where drafts for other banks in the same group start."""
    init_db()
    now = datetime.now().isoformat(timespec="seconds")
    with connect() as conn:
        conn.execute("UPDATE cover_letters SET submitted_at = ? WHERE user_id = ? AND bank = ?", (now if submitted else "no", uid, bank))
        if submitted:  # the to-do to write or submit it is done
            conn.execute("UPDATE interactions SET status = 'done', date = COALESCE(NULLIF(date, ''), ?) WHERE user_id = ? AND bank = ? "
                         "AND kind = 'step' AND status = 'todo' AND LOWER(title) LIKE '%cover letter%'", (now[:10], uid, bank))
    return get(uid, bank)


def overview(uid: int) -> list[dict]:
    """Every bank the user is still in, with whether a letter exists yet."""
    init_db()
    with connect(read_only=True) as conn:
        banks = [r["bank"] for r in conn.execute(
            "SELECT bank FROM my_banks WHERE user_id = ? AND COALESCE(status, '') != 'out' ORDER BY bank", (uid,))]
        letters = {r["bank"]: r for r in conn.execute("SELECT bank, warnings, updated_at, edited, submitted_at FROM cover_letters WHERE user_id = ?", (uid,))}
        recruiters = {r["bank"]: r["recruiter_name"] for r in conn.execute("SELECT bank, recruiter_name FROM my_banks WHERE user_id = ?", (uid,))}
        applied = {r["bank"] for r in conn.execute("SELECT bank FROM my_banks WHERE user_id = ? AND applied = 'Yes'", (uid,))}
    return [{"bank": b, "domain": bank_info.domain(b), "exists": b in letters,
             "warnings": len(json.loads(letters[b]["warnings"])) if b in letters else 0,
             "updated_at": letters[b]["updated_at"] if b in letters else "", "edited": bool(letters[b]["edited"]) if b in letters else False,
             "submitted": b in letters and _submitted(letters[b]["submitted_at"], "Yes" if b in applied else ""),
             "recruiter": shared.bank_detail(b, {"recruiter_name": recruiters.get(b) or ""})["recruiter_name"]} for b in banks]


def _set_text(paragraph, text: str, keep_shapes: bool = True) -> None:
    """Replace a paragraph's text, keeping the formatting of its first run; [[NEED: ...]] markers are highlighted.
    keep_shapes: a picture or text box anchored to the paragraph (the Yale template's contact footer sits
    in a text box on the signature line) is kept rather than removed with the text."""
    from copy import deepcopy

    from docx.enum.text import WD_COLOR_INDEX

    shape = './/*[local-name()="drawing" or local-name()="pict" or local-name()="AlternateContent"]'
    runs = [r for r in paragraph.runs if not (keep_shapes and r._r.xpath(shape))]
    rpr = deepcopy(runs[0]._r.rPr) if runs and runs[0]._r.rPr is not None else None
    for r in runs:
        r._r.getparent().remove(r._r)
    for piece in re.split(r"(\[\[NEED:[^\]]*\]\])", text):
        if not piece:
            continue
        run = paragraph.add_run(piece)
        if rpr is not None:
            run._r.insert(0, deepcopy(rpr))
        if piece.startswith("[[NEED:"):
            run.font.highlight_color = WD_COLOR_INDEX.YELLOW


def docx_bytes(uid: int, bank: str) -> bytes:
    """The letter as a Word file (tightened to fit on one page)."""
    doc = _document(uid, bank)
    letter_layout.fit_one_page(doc)
    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()


def page_warning(uid: int, bank: str) -> list[str]:
    """A letter too long for one page even with the bottom margin as low as the contact footer allows."""
    try:
        over = letter_layout.fit_one_page(_document(uid, bank))
    except Exception:  # a template this can't measure: the Word file is still offered as it is
        return []
    if not over:
        return []
    lines = max(1, round(over + 0.49))
    return [f"it runs about {lines} line{'s' if lines > 1 else ''} past one page, even with the bottom margin as low as your "
            f"contact footer allows; cut about {lines * 14} words to keep it on one page"]


def _document(uid: int, bank: str, paragraphs: list[str] | None = None):
    """The letter (or a draft of it: `paragraphs`) written into a copy of the user's own cover letter (or the Yale SOM template), so the fonts,
    margins and spacing are exactly theirs: date, recipient block, salutation, body and signature are replaced,
    everything else in the file is kept."""
    from copy import deepcopy

    import docx
    from docx.text.paragraph import Paragraph

    letter = get(uid, bank)
    if paragraphs is not None:
        letter["paragraphs"] = paragraphs
    keep = True  # keep the text boxes (the contact footer) the template anchors to lines
    doc = docx.Document(io.BytesIO(templates.cover_template_bytes(uid)))
    spots = templates.layout(doc)
    if spots is None:  # an unusable upload slipped through: fall back to the Yale SOM template
        doc = docx.Document(str(templates.DEFAULT_COVER))
        spots = templates.layout(doc)
    paras = list(doc.paragraphs)

    if spots["date"] is not None:
        date_p = paras[spots["date"]]
        _set_text(date_p, templates.DATE.sub(letter["date"], date_p.text, count=1), keep)

    # One blank line between the date and the recipient block, and between the block and the salutation (the Yale
    # template has two empty lines under the date, which reads as a double space in Word).
    first = spots["recipient"][0] if spots["recipient"] else spots["salutation"]
    for start, stop in ((spots["date"], first), (spots["recipient"][-1] if spots["recipient"] else None, spots["salutation"])):
        if start is None:
            continue
        blanks = [paras[i] for i in range(start + 1, stop) if not paras[i].text.strip()]
        for extra in blanks[1:]:
            extra._p.getparent().remove(extra._p)

    # Recipient block: reuse the template's lines, adding or dropping lines to match.
    slots = [paras[i] for i in spots["recipient"]]
    lines = letter["recipient"]
    if slots:
        for slot, text in zip(slots, lines):
            _set_text(slot, text, keep)
        last = slots[min(len(slots), len(lines)) - 1]
        for text in lines[len(slots):]:
            el = deepcopy(last._p)
            last._p.addnext(el)
            last = Paragraph(el, last._parent)
            _set_text(last, text, keep)
        for extra in slots[len(lines):]:
            extra._p.getparent().remove(extra._p)

    _set_text(paras[spots["salutation"]], letter["salutation"], keep)

    # Body: rebuild everything between the salutation and the closing in the template's own paragraph style,
    # keeping its blank-line spacing between paragraphs.
    sal, close = spots["salutation"], spots["close"]
    between = paras[sal + 1:close]
    model = deepcopy(paras[spots["body"][0]]._p)
    blank_model = next((deepcopy(p._p) for p in between if not p.text.strip()), None)
    blank_after_sal = bool(between) and not between[0].text.strip()
    blank_before_close = bool(between) and not between[-1].text.strip()
    blank_between = blank_model is not None and any(not p.text.strip() for p in paras[spots["body"][0]:spots["body"][-1]])
    for p in between:
        p._p.getparent().remove(p._p)
    close_p = paras[close]

    def add(el, text=None):
        close_p._p.addprevious(el)
        if text is not None:
            _set_text(Paragraph(el, close_p._parent), text, keep)

    if blank_after_sal:
        add(deepcopy(blank_model))
    for n, text in enumerate(letter["paragraphs"]):
        add(deepcopy(model), text)
        if blank_between and n < len(letter["paragraphs"]) - 1:
            add(deepcopy(blank_model))
    if blank_before_close and blank_model is not None:
        add(deepcopy(blank_model))

    if spots["signature"] is not None and letter["signature"]:
        _set_text(paras[spots["signature"]], letter["signature"], keep)
    if keep:  # the Yale template's sample contact footer ("jane.student@yale.edu") becomes the student's own
        from docx.oxml.ns import qn

        contact = profiles.get(uid)["contact_line"]
        for box in doc.element.body.iter(qn("w:txbxContent")):
            for p in box.iter(qn("w:p")):
                runs = list(p.iter(qn("w:t")))
                if contact and "jane.student" in "".join(t.text or "" for t in runs):
                    runs[0].text = contact
                    for t in runs[1:]:
                        t.text = ""
    return doc
