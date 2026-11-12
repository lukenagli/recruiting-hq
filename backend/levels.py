"""How hard each technical question is, on the Finance Club's own scale.

The club's Technicals Session decks rate every practice question:
  Level 1 = basic (a warm-up in a coffee chat), Level 2 = medium (a standard coffee chat question),
  Level 3 = hard (rare in coffee chats), Level 4 = very hard (not expected in coffee chats, good practice).
Practice has three levels, so 1 is easy, 2 medium, and 3 and 4 hard.

Those rated questions are the reference: every other technical question (the club's question banks and each
student's uploaded guides) is rated by a small model call shown the club's key and a spread of the club's own rated
questions, so "hard" means the same thing everywhere. Ratings are stored by question key ("q:<id>" for the club
bank, "gq:<id>" for a guide question) with how they were set ("club" or "ai"); a question not rated yet falls back
to the old word-based guess (practice.difficulty_of).
"""
import asyncio
import logging
import random
from datetime import datetime

from pydantic import BaseModel, Field
from pydantic_ai import Agent, NativeOutput
from pydantic_ai.usage import UsageLimits

from .db import connect, init_db
from .llm import Chosen

log = logging.getLogger(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS question_levels (
    qkey   TEXT PRIMARY KEY,
    level  INTEGER NOT NULL,      -- the club's 1 to 4
    how    TEXT NOT NULL,         -- club (rated on the club's slide) | ai (rated against the club's examples)
    at     TEXT NOT NULL
);
"""
PRACTICE = {1: "easy", 2: "medium", 3: "hard", 4: "hard"}
KEY = ("Level 1 = basic question (a warm-up in a coffee chat); Level 2 = medium difficulty (a standard coffee chat "
       "question); Level 3 = hard (rare in coffee chats); Level 4 = very hard (not expected in coffee chats, but good "
       "practice to solidify understanding)")
BATCH = 50
LIMITS = UsageLimits(request_limit=2, total_tokens_limit=60_000)
TECHNICAL = ("Technical", "Brain Teaser")

INSTRUCTIONS = f"""\
You rate investment banking technical interview questions on the Yale SOM Finance Club's difficulty scale:
{KEY}

You are given questions the club itself rated, as the reference for what each level means, then numbered questions \
to rate. Rate each one the way the club would: by how much it asks (one concept or several, a quick recall or a \
multi-step calculation, a standard walkthrough or an unusual twist), not by how long it is.
"""


class Rated(BaseModel):
    n: int
    level: int = Field(ge=1, le=4)


class Ratings(BaseModel):
    items: list[Rated]


agent = Agent(output_type=Ratings, instructions=INSTRUCTIONS, name="question_rater")


def ensure() -> None:
    init_db()
    with connect() as conn:
        conn.executescript(SCHEMA)


def practice_levels() -> dict[str, str]:
    """Every stored rating as practice's easy / medium / hard, by question key."""
    ensure()
    with connect(read_only=True) as conn:
        return {r["qkey"]: PRACTICE[r["level"]] for r in conn.execute("SELECT qkey, level FROM question_levels")}


def save(rows: list[tuple[str, int]], how: str, keep_club: bool = True) -> int:
    """Store ratings (key, club level 1-4). A club rating is never replaced by a model's."""
    ensure()
    now = datetime.now().isoformat(timespec="seconds")
    with connect() as conn:
        for key, level in rows:
            if keep_club and how != "club" and conn.execute("SELECT 1 FROM question_levels WHERE qkey = ? AND how = 'club'", (key,)).fetchone():
                continue
            conn.execute("INSERT OR REPLACE INTO question_levels (qkey, level, how, at) VALUES (?, ?, ?, ?)", (key, int(level), how, now))
    return len(rows)


def _examples(conn, n: int = 36) -> list[tuple[str, int]]:
    """A spread of the club's own rated questions: every level, several areas."""
    rows = [(r["question"], r["level"], r["topic"]) for r in conn.execute(
        """SELECT q.question, l.level, q.topic FROM question_levels l JOIN questions q ON 'q:' || q.id = l.qkey
           WHERE l.how = 'club' ORDER BY q.id""")]
    by_level: dict[int, list] = {}
    for r in rows:
        by_level.setdefault(r[1], []).append(r)
    rng, out = random.Random(7), []
    for lvl in sorted(by_level):
        pick = by_level[lvl]
        rng.shuffle(pick)
        out += pick[: max(4, n // max(1, len(by_level)))]
    return [(" ".join(q.split())[:500], lvl) for q, lvl, _ in out]


def pending(owner: int | None) -> list[tuple[str, str]]:
    """Technical questions with no rating yet: the club bank's, and the guide questions of `owner` (if given)."""
    ensure()
    with connect(read_only=True) as conn:
        rated = {r[0] for r in conn.execute("SELECT qkey FROM question_levels")}
        bank = [(f"q:{r['id']}", r["question"]) for r in conn.execute(
            f"SELECT id, question FROM questions WHERE qtype IN ({','.join('?' * len(TECHNICAL))})", TECHNICAL)]
        guides = []
        if owner is not None:
            have = conn.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'guide_questions'").fetchone()
            if have:
                guides = [(f"gq:{r['id']}", r["question"]) for r in conn.execute(
                    "SELECT id, question FROM guide_questions WHERE user_id = ? AND category = 'Technical'", (owner,))]
    return [(k, q) for k, q in bank + guides if k not in rated and len((q or "").strip()) > 8]


async def _rate(chosen: Chosen, examples: list[tuple[str, int]], items: list[tuple[str, str]]) -> int:
    ref = "\n".join(f"- [Level {lvl}] {q}" for q, lvl in examples)
    ask = "\n".join(f"{i}. {' '.join((q or '').split())[:700]}" for i, (_, q) in enumerate(items, 1))
    output = NativeOutput(Ratings) if chosen.provider == "anthropic" else None  # Claude rejects forced tool calls
    result = await agent.run(f"Rated by the club:\n{ref}\n\nRate these:\n{ask}", model=chosen.model, model_settings=chosen.settings,
                             usage_limits=LIMITS, output_type=output)
    got = [(items[it.n - 1][0], it.level) for it in result.output.items if 1 <= it.n <= len(items)]
    return save(got, "ai")


async def rate_pending(chosen: Chosen, owner: int | None, keys: list[tuple[str, str]] | None = None) -> int:
    """Rate every unrated technical question (or the ones given) against the club's examples. Returns how many."""
    ensure()
    with connect(read_only=True) as conn:
        examples = _examples(conn)
    if len(examples) < 8:  # the club's decks aren't loaded yet: nothing to calibrate against
        return 0
    items = keys if keys is not None else pending(owner)
    sem, done = asyncio.Semaphore(4), 0

    async def one(batch: list[tuple[str, str]]) -> None:
        nonlocal done
        async with sem:
            try:
                n = await _rate(chosen, examples, batch)
                done += n
            except Exception:  # noqa: BLE001 - this batch is rated next time
                log.exception("question rating batch failed")

    await asyncio.gather(*(one(items[i:i + BATCH]) for i in range(0, len(items), BATCH)))
    return done


async def on_start() -> None:
    """At start-up: rate anything new, on the site owner's AI key (the club bank and the owner's own guides)."""
    from . import llm
    from .db import owner_id

    try:
        oid = owner_id()
        if oid is None or not pending(oid):
            return
        with connect(read_only=True) as conn:
            owner = dict(conn.execute("SELECT * FROM users WHERE id = ?", (oid,)).fetchone())
        n = await rate_pending(llm.model_for(owner), oid)
        log.info("question levels: rated %s", n)
    except Exception:  # noqa: BLE001 - practice falls back to the word-based guess
        log.exception("rating questions at start-up failed")


def status(owner: int | None) -> dict:
    ensure()
    with connect(read_only=True) as conn:
        counts = {r["how"]: r["n"] for r in conn.execute("SELECT how, COUNT(*) AS n FROM question_levels GROUP BY how")}
        spread = {PRACTICE[r["level"]] + f" (L{r['level']})": r["n"] for r in conn.execute(
            "SELECT level, COUNT(*) AS n FROM question_levels GROUP BY level ORDER BY level")}
    return {"club": counts.get("club", 0), "ai": counts.get("ai", 0), "pending": len(pending(owner)), "spread": spread}
