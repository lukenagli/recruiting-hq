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
