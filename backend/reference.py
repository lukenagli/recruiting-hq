"""The answer library: passages from study guides and decks, searched when explaining a practice question.

Sources:
- shared with every account: the Finance Club technical session decks, and the question bank's own answer notes;
- private to one account: material only that person may use (for example their own paid Breaking Into Wall
  Street guides). A private passage is only ever shown to its owner.

Passages are stored in a SQLite full-text index (FTS5, with stemming) and found by keyword relevance (BM25).
They are loaded with scripts/push_reference.py, which reads the files on the owner's computer and sends the text
to the admin-only upload route; the files themselves never leave that computer.
"""
import re

from .db import connect, init_db

SCHEMA = """
CREATE VIRTUAL TABLE IF NOT EXISTS reference USING fts5(
    text, source UNINDEXED, location UNINDEXED, owner UNINDEXED, tokenize = 'porter unicode61'
);
"""
STOP = set("""a an and are as at be but by can could did do does for from had has have how i if in into is it its
me my of on or our should so than that the their them then there these they this to was we were what when where
which while who why will with would you your walk through tell explain describe question company companies
does use used using get make one two way ways also more most some any all other""".split())
BOILERPLATE = re.compile(
    r"Access the (Rest of the |Full )?(IB |Financial Modeling )?(Interview Guide|Course)|\d+ of \d+|https?://\S+|\.{4,}", re.I)


def clean(text: str) -> str:
    """Passage text without page furniture (repeated headers, page counters, links, dot leaders)."""
    return " ".join(BOILERPLATE.sub(" ", text).split())


def ensure() -> None:
    init_db()
    with connect() as conn:
        conn.executescript(SCHEMA)


def _terms(text: str) -> list[str]:
    """Quoted search terms, longest (most specific) first."""
    words = [w.strip("-/&") for w in re.findall(r"[a-z][a-z0-9&/-]{2,}", text.lower())]
    words = [w for w in dict.fromkeys(words) if w and w not in STOP]
    return [f'"{w}"' for w in sorted(words, key=len, reverse=True)[:12]]


def search(uid: int, text: str, limit: int = 4) -> list[dict]:
    """The passages most relevant to a question that this account may see: passages with every key term first,
    then the best partial matches."""
    terms = _terms(text)
    if not terms:
        return []
    ensure()
    found, seen = [], set()
    queries = [" AND ".join(terms[:6]), " AND ".join(terms[:3]), " OR ".join(terms)] if len(terms) > 1 else [terms[0]]
    with connect(read_only=True) as conn:
        for q in queries:
            for r in conn.execute(
                    """SELECT rowid, text, source, location, owner, bm25(reference) AS score FROM reference
                       WHERE reference MATCH ? AND (owner = '' OR owner = ?) ORDER BY score LIMIT ?""",
                    (q, str(uid), limit)):
                if r["rowid"] not in seen and len(found) < limit:
                    seen.add(r["rowid"])
                    found.append({"text": r["text"], "source": r["source"], "location": r["location"], "private": r["owner"] != ""})
            if len(found) >= limit:
                break
    return found


def load(owner_uid: int | None, source: str, passages: list[dict]) -> dict:
    """Replace one source's passages. owner_uid None makes them shared; otherwise only that account sees them."""
    ensure()
    owner = "" if owner_uid is None else str(owner_uid)
    with connect() as conn:
        conn.execute("DELETE FROM reference WHERE source = ? AND owner = ?", (source, owner))
        for p in passages:
            raw = str(p.get("text", ""))
            if raw.count("....") > 15:  # a table of contents page
                continue
            text = clean(raw)
            if len(text) >= 80:
                conn.execute("INSERT INTO reference (text, source, location, owner) VALUES (?, ?, ?, ?)",
                             (text[:4000], source[:120], str(p.get("location", ""))[:60], owner))
    return {"ok": True, "source": source, "passages": len(passages), "shared": owner == ""}


def load_question_bank_notes() -> dict:
    """Index the question bank's own answer notes as one shared source (re-run after each question bank import)."""
    ensure()
    with connect(read_only=True) as conn:
        rows = conn.execute("""SELECT question, answer_notes, bank, round FROM questions
                               WHERE COALESCE(answer_notes, '') != ''""").fetchall()
    passages = [{"text": f"Q: {r['question']} A: {r['answer_notes']}",
                 "location": " · ".join(x for x in (r["bank"] if r["bank"] != "Unknown" else "", r["round"] if r["round"] != "Unknown" else "") if x)}
                for r in rows]
    return load(None, "Finance Club question bank answers", passages)


def sources(uid: int) -> list[dict]:
    ensure()
    with connect(read_only=True) as conn:
        return [dict(r) for r in conn.execute(
            """SELECT source, owner != '' AS private, COUNT(*) AS passages FROM reference
               WHERE owner = '' OR owner = ? GROUP BY source, owner ORDER BY source""", (str(uid),))]


def chunk_pages(pages: list[str], size: int = 1800) -> list[dict]:
    """Split page texts into passages of about `size` characters, remembering the page they came from."""
    out = []
    for n, page in enumerate(pages, 1):
        text = " ".join((page or "").split())
        for i in range(0, len(text), size):
            piece = text[i:i + size + 200]  # a little overlap so an answer split across the cut is still found
            if len(piece) >= 80:
                out.append({"text": piece, "location": f"p. {n}"})
    return out


# ---------------- Guides a user uploads themselves ----------------
# Each person uploads their own copy of a guide (e.g. the Breaking Into Wall Street PDFs they bought). Its text
# becomes passages only they can search, and its numbered questions become practice questions only they see,
# graded against their own guide's answer. The file itself is not kept.

GUIDE_SCHEMA = """
CREATE TABLE IF NOT EXISTS guide_questions (
    id        INTEGER PRIMARY KEY,
    user_id   INTEGER NOT NULL,
    source    TEXT NOT NULL,
    location  TEXT DEFAULT '',
    category  TEXT NOT NULL,      -- Technical | Behavioral
    question  TEXT NOT NULL,
    answer    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_guide_q_user ON guide_questions (user_id, source);
"""
# A follow-up builds on the question before it: practice asks it only right after that one (same chain, next step).
GUIDE_COLUMNS = {"chain": "INTEGER DEFAULT 0", "step": "INTEGER DEFAULT 0"}  # step 0: loaded before chains existed
MAX_GUIDE_PAGES = 800
QUESTION_START = re.compile(r"(?:^|\n)\s*(\d{1,3})\.\s+(?=[A-Z“\"(])")
ASKING = re.compile(r"^(walk|how|what|why|when|where|which|who|would|could|should|can|do|does|is|are|if|explain|tell|"
                    r"describe|let'?s|say|suppose|assume|give|pitch|imagine|in|a |an |the )", re.I)
IMPERATIVE = re.compile(r"^(walk|explain|tell|describe|pitch|give|let'?s|say|suppose|assume|imagine|if|a |an )", re.I)
# A sentence that actually asks for something: a question, or an instruction ("Walk me through...", "Calculate...").
ASKS = re.compile(r"\?|\b(walk (me|us) through|explain|calculate|compute|describe|tell me|show me|what (is|are|would|will|happens)|"
                  r"how (do|does|would|will|much|many)|which|estimate|value the|find the)\b", re.I)


# Wording that only makes sense after the question before it.
FOLLOW_UP = re.compile(
    r"\b(these|those|the same|that|this) (figures|numbers|results|deal|company|companies|scenario|transaction|"
    r"change|changes|answer|calculation|example|situation|case|step|steps)\b|\binstead\s*\?\s*$|\babove\b|previous (question|example|answer)|"
    r"^(and |also |now,? |next,? )|^(how|what) (does|do|would|will) (this|that|these|it) |^what if\b|^how (does|would) (that|this) change", re.I)


def follows_previous(question: str) -> bool:
    return bool(FOLLOW_UP.search(question or ""))


# A question that changes the one before it ("Suppose that Company A now decides to use 100% Cash ... to do this deal"):
# a "now" or "instead" together with a reference back. Narrower than follows_previous on purpose: plenty of
# self-contained questions say "this deal", and they must not be tied to whatever came before them.
CHANGES_PREVIOUS = re.compile(r"\b(now|instead)\b", re.I)
REFERS_BACK = re.compile(r"\bCompany [A-Z]\b|\b(this|that|the same) (acquirer|buyer|target|seller|deal|transaction|scenario)\b", re.I)


def changes_previous(question: str) -> bool:
    q = question or ""
    return bool(CHANGES_PREVIOUS.search(q) and (FOLLOW_UP.search(q) or REFERS_BACK.search(q)))


NAMED = re.compile(r"\bCompany [A-Z]\b")
LOOK_BACK = 8  # how far back in the guide a follow-up's setup can be


def _setup_for(question: str, earlier: list[dict]) -> dict | None:
    """The question a follow-up changes: the nearest earlier one in the guide that gives numbers and, when the follow-up
    names companies ("Company A"), names one of them too. None when there's no such question nearby."""
    names = set(NAMED.findall(question))
    for e in reversed(earlier[-LOOK_BACK:]):
        if re.search(r"\d", e["question"]) and (not names or names & set(NAMED.findall(e["question"]))):
            return e
    return None


def relink(uid: int | None = None) -> int:
    """Tie each guide question that changes an earlier one ("Suppose that Company A now decides to use 100% Cash ... to
    do this deal") to the question it changes: the end of that question's chain, so practice asks it right after its
    setup. The setup is the nearest earlier question that gives numbers and names the same company; the question just
    before it is often something else (the upload may also have split the two at a page break). A follow-up with no
    setup nearby is never asked on its own (step -1), and the parts after it go with it. Returns how many were tied."""
    ensure_guides()
    tied = 0
    with connect() as conn:
        where, params = ("WHERE user_id = ?", (uid,)) if uid is not None else ("", ())
        rows = [dict(r) for r in conn.execute(
            f"SELECT id, user_id, source, chain, step, question FROM guide_questions {where} ORDER BY user_id, source, id", params)]
        new: dict[int, tuple[int, int]] = {}  # id -> (chain, step) after relinking
        guide, earlier, last_step, spare = None, [], {}, 0
        for r in rows:
            if (r["user_id"], r["source"]) != guide:
                guide, earlier, last_step = (r["user_id"], r["source"]), [], {}
                spare = max((x["chain"] for x in rows if (x["user_id"], x["source"]) == guide), default=0)
            prev = earlier[-1] if earlier else None
            chain, step = r["chain"], r["step"]
            if changes_previous(r["question"]):
                setup = _setup_for(r["question"], earlier)
                if setup is not None and new[setup["id"]][1] >= 1:
                    chain = new[setup["id"]][0]
                    step = last_step.get(chain, new[setup["id"]][1]) + 1
                    tied += 1
                elif r["step"] != -1:  # nothing to ask it after: never on its own (kept as it is once set)
                    spare += 1
                    chain, step = spare, -1
            elif prev is not None and r["step"] > 1 and r["chain"] == prev["chain"]:  # the next part of the question before it
                p_chain, p_step = new[prev["id"]]
                chain, step = p_chain, (p_step + 1 if p_step >= 1 else -1)
            new[r["id"]] = (chain, step)
            if step >= 1:
                last_step[chain] = max(last_step.get(chain, 0), step)
            earlier.append(r)
        old = {r["id"]: (r["chain"], r["step"]) for r in rows}
        conn.executemany("UPDATE guide_questions SET chain = ?, step = ? WHERE id = ?",
                         [(c, s, i) for i, (c, s) in new.items() if (c, s) != old[i]])
    return tied


def asks(question: str) -> bool:
    """True when the text asks for something, rather than only setting up a scenario."""
    return bool(ASKS.search(question or ""))


BEHAVIORAL = re.compile(r"tell me about (yourself|a time)|walk me through your (resume|story|background)|why (investment )?banking|"
                        r"why (our|this) (bank|firm|group)|strength|weakness|leadership|teamwork|hire you|failure|"
                        r"where do you see yourself|why should we", re.I)


def ensure_guides() -> None:
    ensure()
    with connect() as conn:
        conn.executescript(GUIDE_SCHEMA)
        have = {r[1] for r in conn.execute("PRAGMA table_info(guide_questions)")}
        for col, kind in GUIDE_COLUMNS.items():
            if col not in have:
                conn.execute(f"ALTER TABLE guide_questions ADD COLUMN {col} {kind}")


def extract_questions(pages: list[str]) -> list[dict]:
    """Numbered question-and-answer pairs ("12. Walk me through ...? answer ...") from a guide's pages."""
    text, starts = "", []
    for n, page in enumerate(pages, 1):
        starts.append((len(text), n))
        text += "\n" + BOILERPLATE.sub(" ", page or "")
    page_at = lambda pos: max((n for s, n in starts if s <= pos), default=1)
    marks = list(QUESTION_START.finditer(text))
    out = []
    context, last = "", 0
    for i, m in enumerate(marks):
        number = int(m.group(1))
        if i == 0 or number <= last:  # a new numbered list: its section intro says what to do with its questions
            context = " ".join(text[max(0, m.start() - 1700):m.start()].split())[-1400:]
        last = number
        block = text[m.end():marks[i + 1].start() if i + 1 < len(marks) else len(text)]
        block = re.sub(r"[ \t]+", " ", block).strip()
        q_end = block.find("?")
        if 10 < q_end < 700:  # the question runs to its question mark
            question, answer = block[:q_end + 1], block[q_end + 1:]
        else:
            # An instruction ("Walk me through ...") or a scenario followed by one ("A company issues 500 shares... Then it
            # pays a dividend... Walk me through both steps."): read sentence by sentence until one asks for something.
            question, answer, at = "", "", 0
            for cut in re.finditer(r"[.:]\s", block[:700]):
                sentence = block[at:cut.end()]
                at = cut.end()
                if asks(sentence):
                    question, answer = block[:at], block[at:]
                    break
            if not question:
                continue  # it never says what to do: not a usable question
        question, answer = " ".join(question.split()), " ".join(answer.split())
        if not ASKING.match(question) or len(answer) < 80 or len(question) < 15:
            continue
        if not question.endswith("?") and not IMPERATIVE.match(question):
            continue  # a heading or intro sentence, not a question
        if not asks(question):
            continue
        out.append({"question": question, "answer": answer[:3500], "location": f"p. {page_at(m.start())}",
                    "category": "Behavioral" if BEHAVIORAL.search(question) else "Technical", "context": context})
    return out


async def add_guide(uid: int, filename: str, data: bytes, name: str = "", chosen=None) -> dict:
    """Load one of the user's own guides: private passages plus its numbered questions. `name` labels it (for the
    per-guide upload boxes); otherwise the file name is used. With an AI model (`chosen`), each question is made to
    say what to answer, from its section's intro (guide_clarify)."""
    from . import guide_clarify
    import io

    name = (name.strip() or filename.rsplit(".", 1)[0].strip())[:100] or "My guide"
    name = _slot(name) or name
    low = filename.lower()
    try:
        if low.endswith(".pdf"):
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(data))
            if len(reader.pages) > MAX_GUIDE_PAGES:
                return {"ok": False, "reason": f"That file has {len(reader.pages)} pages; the limit is {MAX_GUIDE_PAGES}."}
            pages = [(p.extract_text() or "") for p in reader.pages]
        elif low.endswith(".docx"):
            import docx

            body = "\n".join(p.text for p in docx.Document(io.BytesIO(data)).paragraphs)
            pages = [body[i:i + 3000] for i in range(0, len(body), 3000)] or [""]
        else:
            return {"ok": False, "reason": "Upload a PDF or Word (.docx) file."}
    except Exception:
        return {"ok": False, "reason": "Couldn't read that file. If it is a scanned PDF, it has no text to read."}
    if sum(len(p.strip()) for p in pages) < 500:
        return {"ok": False, "reason": "Couldn't find text in that file (it may be scanned images)."}
    passages = chunk_pages(pages)
    load(uid, name, passages)
    questions = await guide_clarify.clarify(chosen, extract_questions(pages))
    chain, step = 0, 0
    for i, q in enumerate(questions):
        q["category"] = "Behavioral" if BEHAVIORAL.search(q["question"]) else "Technical"  # from the finished wording
        same_section = i > 0 and questions[i - 1].get("context") == q.get("context")
        # the AI's call when it ran (it reads the section), else the wording
        follows = q["follows"] if "follows" in q else follows_previous(q["question"])
        if same_section and follows:
            step += 1  # a follow-up: asked right after the one before it
        else:
            chain, step = chain + 1, 1
        q["chain"], q["step"] = chain, step
    ensure_guides()
    with connect() as conn:
        conn.execute("DELETE FROM guide_questions WHERE user_id = ? AND source = ?", (uid, name))
        conn.executemany(
            "INSERT INTO guide_questions (user_id, source, location, category, question, answer, chain, step) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [(uid, name, q["location"], q["category"], q["question"], q["answer"], q["chain"], q["step"]) for q in questions])
    relink(uid)
    return {"ok": True, "source": name, "passages": len(passages), "questions": len(questions)}


def remove_source(uid: int, source: str) -> dict:
    """Remove one of this user's own private sources (shared club material cannot be removed here)."""
    ensure_guides()
    with connect() as conn:
        n = conn.execute("DELETE FROM reference WHERE owner = ? AND source = ?", (str(uid), source)).rowcount
        conn.execute("DELETE FROM guide_questions WHERE user_id = ? AND source = ?", (uid, source))
    return {"ok": bool(n)}


# The Breaking Into Wall Street guides each have their own upload box in Settings, stored under these names.
GUIDE_SLOTS = ["400 Questions", "Accounting", "Enterprise & Equity Value", "DCF", "Merger Models", "LBO", "Modeling",
               "IB Associate Complete Guide"]


def _slot(source: str) -> str | None:
    """The guide box a source belongs to, also for older names like "BIWS 400 Questions guide"."""
    bare = lambda s: re.sub(r"[^a-z0-9&]+", " ", re.sub(r"breaking into wall street|\bbiws\b|\bguide\b", " ", s.lower())).split()
    return next((s for s in GUIDE_SLOTS if bare(s) == bare(source) or s.lower() == source.lower()), None)


def _tidy_guides(uid: int) -> None:
    """File guides uploaded under older names into their box; drop them if the box already has its own upload."""
    owner = str(uid)
    with connect() as conn:
        mine = [r["source"] for r in conn.execute("SELECT DISTINCT source FROM reference WHERE owner = ?", (owner,))]
        for source in mine:
            slot = _slot(source)
            if not slot or slot == source:
                continue
            if slot in mine:
                conn.execute("DELETE FROM reference WHERE owner = ? AND source = ?", (owner, source))
                conn.execute("DELETE FROM guide_questions WHERE user_id = ? AND source = ?", (uid, source))
            else:
                conn.execute("UPDATE reference SET source = ? WHERE owner = ? AND source = ?", (slot, owner, source))
                conn.execute("UPDATE guide_questions SET source = ? WHERE user_id = ? AND source = ?", (slot, uid, source))
                mine.append(slot)


def library(uid: int) -> list[dict]:
    """Every source this account can use, with passage and question counts."""
    ensure_guides()
    _tidy_guides(uid)
    with connect(read_only=True) as conn:
        counts = {r["source"]: r["n"] for r in conn.execute(
            "SELECT source, COUNT(*) AS n FROM guide_questions WHERE user_id = ? GROUP BY source", (uid,))}
    return [{**s, "private": bool(s["private"]), "questions": counts.get(s["source"], 0)} for s in sources(uid)]


def guide_question(uid: int, qid: int) -> dict | None:
    ensure_guides()
    with connect(read_only=True) as conn:
        row = conn.execute("SELECT * FROM guide_questions WHERE id = ? AND user_id = ?", (qid, uid)).fetchone()
    return dict(row) if row else None


def guide_questions(uid: int) -> list[dict]:
    ensure_guides()
    with connect(read_only=True) as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM guide_questions WHERE user_id = ?", (uid,))]


def next_in_chain(uid: int, qid: int) -> dict | None:
    """The follow-up that comes right after this guide question, if it has one."""
    ensure_guides()
    with connect(read_only=True) as conn:
        row = conn.execute("SELECT source, chain, step FROM guide_questions WHERE id = ? AND user_id = ?", (qid, uid)).fetchone()
        if not row or not row["step"]:
            return None
        nxt = conn.execute("SELECT * FROM guide_questions WHERE user_id = ? AND source = ? AND chain = ? AND step = ?",
                           (uid, row["source"], row["chain"], row["step"] + 1)).fetchone()
    return dict(nxt) if nxt else None
