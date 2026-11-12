"""Keeping the answer out of the question.

The school club's question bank was typed into a shared sheet by students after their interviews, and some typed the
answer, a hint or how it went into the same cell ("... Expected answers: precedent transactions ...", "(Answer:
change beta ...)", "(I said around 20-30%)", "Rev up $10 --> tax 40% --> NI up $6"). Practice must ask only what
the interviewer asked, so each entry with more than a plain question goes once to a small model call that splits it:
- question: what was asked, keeping any facts or numbers needed to answer it (even ones given later in the interview);
- revealed: the answer, hint or commentary that came out, shown with the notes after the student answers;
- skip: the entry isn't a question at all (notes about the interview with nothing to ask).
The split is stored by question id (question_clean), so it happens once; new entries are split when the app starts.
Until an entry is split, a plain rule cuts at an explicit "Answer:" or "Expected answer".
"""
import asyncio
import logging
import re
from datetime import datetime

from pydantic import BaseModel, Field
from pydantic_ai import Agent, NativeOutput
from pydantic_ai.usage import UsageLimits

from .db import connect, init_db
from .llm import Chosen

log = logging.getLogger(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS question_clean (
    question_id INTEGER PRIMARY KEY,
    question    TEXT NOT NULL,
    revealed    TEXT NOT NULL DEFAULT '',
    skip        INTEGER NOT NULL DEFAULT 0,
    at          TEXT NOT NULL
);
"""
# More than a plain question: text after the question mark, a parenthesis, an arrow, or answer-like words.
SUSPECT = re.compile(r"\?\s*\S|\(|->|→|=>|\banswers?\b|\bexpected\b|\b(i|she|he|they|interviewer)\s+(said|answered|asked|wanted|told)\b"
                     r"|\bkey (to|was)\b|\bresponse\b", re.I)
# Until the model has split an entry: an explicit answer marker ends the question.
MARKER = re.compile(r"\s*[\(\[]?\s*\b(expected answers?|answers? (?:was|is|were)|answers?|ans)\s*[:\-–=]\s*|\s*\((?=answer was\b)", re.I)
BATCH = 40
LIMITS = UsageLimits(request_limit=2, total_tokens_limit=60_000)

INSTRUCTIONS = """\
Each numbered item is an interview question an MBA student logged in a shared sheet after an investment banking \
interview. Some students typed the answer, a hint, or comments about the interview into the same cell. The \
questions will be asked to other students for practice, so the question must not give anything away.

For each item return:
- question: only what the interviewer asked, in the student's wording. Keep every fact, number and assumption \
needed to answer it, including ones the interviewer gave later (for example "debt is $300M and cash is $180M"). \
Keep context that changes what a good answer is ("for a biotech company"). Remove the answer, any hint toward it \
("think about dividends vs. buybacks", "the key was..."), what the student said, and comments about the interview \
itself (timing, how it went, who asked). If the item is a worked answer with no question ("Rev up $10 --> tax 40% \
--> NI up $6 --> FCF up $6"), write the question it answers ("Revenue goes up by $10 with a 40% tax rate. How do \
net income and free cash flow change?"). If nothing needs removing, return the item exactly as it is.
- revealed: what you removed (the answer, hints, comments), in the student's words. Empty if nothing was removed.
- skip: true only if there is no question to ask at all (just notes about how the interview went).
"""


class Item(BaseModel):
    n: int
    question: str
    revealed: str = ""
    skip: bool = False


class Split(BaseModel):
    items: list[Item] = Field(description="One per numbered item, same n.")


agent = Agent(output_type=Split, instructions=INSTRUCTIONS, name="question_cleaner")


def ensure() -> None:
    init_db()
    with connect() as conn:
        conn.executescript(SCHEMA)


def splits() -> dict[int, dict]:
    """Every stored split: {question id: {question, revealed, skip}}."""
    ensure()
    with connect(read_only=True) as conn:
        return {r["question_id"]: dict(r) for r in conn.execute("SELECT * FROM question_clean")}


def apply(qid: int, question: str, notes: str, done: dict[int, dict]) -> tuple[str, str, bool]:
    """(question to ask, notes to show after answering, skip) for one bank entry."""
    s = done.get(qid)
    if s:
        revealed = s["revealed"].strip()
        return s["question"], "\n\n".join(x for x in (revealed, notes or "") if x), bool(s["skip"])
    m = MARKER.search(question or "")
    if m and m.start() > 12:
        cut = question[m.start():].strip().strip("()[] ")
        return question[:m.start()].rstrip(" ,;-–("), "\n\n".join(x for x in (cut, notes or "") if x), False
    return question, notes, False


def pending(limit: int = 2000) -> list[dict]:
    ensure()
    with connect(read_only=True) as conn:
        rows = conn.execute("""SELECT q.id, q.question FROM questions q LEFT JOIN question_clean c ON c.question_id = q.id
                               WHERE c.question_id IS NULL AND q.source != 'tech_session'""").fetchall()  # the club's decks ask cleanly
    return [dict(r) for r in rows if SUSPECT.search(r["question"] or "")][:limit]


async def _batch(chosen: Chosen, rows: list[dict]) -> int:
    listing = "\n".join(f"{i}. {' '.join((r['question'] or '').split())[:1500]}" for i, r in enumerate(rows, 1))
    output = NativeOutput(Split) if chosen.provider == "anthropic" else None  # Claude rejects forced tool calls
    result = await agent.run(listing, model=chosen.model, model_settings=chosen.settings, usage_limits=LIMITS, output_type=output)
    now = datetime.now().isoformat(timespec="seconds")
    got = {it.n: it for it in result.output.items if 1 <= it.n <= len(rows)}
    with connect() as conn:
        for i, r in enumerate(rows, 1):
            it = got.get(i)
            if it is None or (not it.question.strip() and not it.skip):
                continue  # left for the next run
            conn.execute("INSERT OR REPLACE INTO question_clean (question_id, question, revealed, skip, at) VALUES (?, ?, ?, ?, ?)",
                         (r["id"], " ".join(it.question.split()) or r["question"], it.revealed.strip(), int(it.skip), now))
    return len(got)


async def clean_pending(chosen: Chosen) -> int:
    """Split every entry not split yet, a few batches at a time. Returns how many were split."""
    rows = pending()
    sem, done = asyncio.Semaphore(4), 0

    async def one(batch: list[dict]) -> None:
        nonlocal done
        async with sem:
            try:
                n = await _batch(chosen, batch)
                done += n
            except Exception:  # noqa: BLE001 - one failed batch is tried again next time
                log.exception("question cleaning batch failed")

    await asyncio.gather(*(one(rows[i:i + BATCH]) for i in range(0, len(rows), BATCH)))
    return done


async def on_start() -> None:
    """At start-up: split any new entries, on the site owner's AI key. Quietly does nothing without one."""
    from . import llm
    from .db import owner_id

    try:
        if not pending(1):
            return
        oid = owner_id()
        if oid is None:
            return
        with connect(read_only=True) as conn:
            owner = dict(conn.execute("SELECT * FROM users WHERE id = ?", (oid,)).fetchone())
        n = await clean_pending(llm.model_for(owner))
        log.info("question bank: split %s entries", n)
    except Exception:  # noqa: BLE001 - practice works without it (the plain rule applies)
        log.exception("question cleaning at start-up failed")
