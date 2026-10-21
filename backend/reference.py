"""The answer library: passages from study guides and decks, searched when explaining a practice question.

Sources:
- shared with every account: the Finance Club technical session decks, and the question bank's own answer notes;
- private to one account: material only that person may use (for example their own paid Breaking Into Wall
  Street guides, or their own interview answers). A private passage is only ever shown to its owner.

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
MAX_GUIDE_PAGES = 800
QUESTION_START = re.compile(r"(?:^|\n)\s*(\d{1,3})\.\s+(?=[A-Z“\"(])")
ASKING = re.compile(r"^(walk|how|what|why|when|where|which|who|would|could|should|can|do|does|is|are|if|explain|tell|"
                    r"describe|let'?s|say|suppose|assume|give|pitch|imagine|in|a |an |the )", re.I)
IMPERATIVE = re.compile(r"^(walk|explain|tell|describe|pitch|give|let'?s|say|suppose|assume|imagine|if|a |an )", re.I)
BEHAVIORAL = re.compile(r"tell me about (yourself|a time)|walk me through your (resume|story|background)|why (investment )?banking|"
                        r"why (our|this) (bank|firm|group)|strength|weakness|leadership|teamwork|hire you|failure|"
                        r"where do you see yourself|why should we", re.I)


def ensure_guides() -> None:
    ensure()
    with connect() as conn:
        conn.executescript(GUIDE_SCHEMA)


def extract_questions(pages: list[str]) -> list[dict]:
    """Numbered question-and-answer pairs ("12. Walk me through ...? answer ...") from a guide's pages."""
    text, starts = "", []
    for n, page in enumerate(pages, 1):
        starts.append((len(text), n))
        text += "\n" + BOILERPLATE.sub(" ", page or "")
    page_at = lambda pos: max((n for s, n in starts if s <= pos), default=1)
    marks = list(QUESTION_START.finditer(text))
    out = []
    for i, m in enumerate(marks):
        block = text[m.end():marks[i + 1].start() if i + 1 < len(marks) else len(text)]
        block = re.sub(r"[ \t]+", " ", block).strip()
        q_end = block.find("?")
        if 10 < q_end < 450:  # the question runs to its question mark
            question, answer = block[:q_end + 1], block[q_end + 1:]
        else:  # some are instructions ("Walk me through ..."): the first sentence
            cut = re.search(r"[.:]\s", block[:450])
            if not cut:
                continue
            question, answer = block[:cut.end()], block[cut.end():]
        question, answer = " ".join(question.split()), " ".join(answer.split())
        if not ASKING.match(question) or len(answer) < 80 or len(question) < 15:
            continue
        if not question.endswith("?") and not IMPERATIVE.match(question):
            continue  # a heading or intro sentence, not a question
        out.append({"question": question, "answer": answer[:3500], "location": f"p. {page_at(m.start())}",
                    "category": "Behavioral" if BEHAVIORAL.search(question) else "Technical"})
    return out


def add_guide(uid: int, filename: str, data: bytes) -> dict:
    """Load one of the user's own guides: private passages plus its numbered questions."""
    import io

    name = filename.rsplit(".", 1)[0].strip()[:100] or "My guide"
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
    questions = extract_questions(pages)
    ensure_guides()
    with connect() as conn:
        conn.execute("DELETE FROM guide_questions WHERE user_id = ? AND source = ?", (uid, name))
        conn.executemany(
            "INSERT INTO guide_questions (user_id, source, location, category, question, answer) VALUES (?, ?, ?, ?, ?, ?)",
            [(uid, name, q["location"], q["category"], q["question"], q["answer"]) for q in questions])
    return {"ok": True, "source": name, "passages": len(passages), "questions": len(questions)}


def remove_source(uid: int, source: str) -> dict:
    """Remove one of this user's own private sources (shared club material cannot be removed here)."""
    ensure_guides()
    with connect() as conn:
        n = conn.execute("DELETE FROM reference WHERE owner = ? AND source = ?", (str(uid), source)).rowcount
        conn.execute("DELETE FROM guide_questions WHERE user_id = ? AND source = ?", (uid, source))
    return {"ok": bool(n)}


def library(uid: int) -> list[dict]:
    """Every source this account can use, with passage and question counts."""
    ensure_guides()
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
