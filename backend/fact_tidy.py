"""Keeping each bank's overview short.

Facts are saved one at a time, from every email and chat that mentions them, so a busy bank's "Recruiting process"
box filled up with the same stage in five wordings. After a refresh, a bank whose overview has grown is rewritten
once by a small model call: each point once, the stages in order with their dates, nothing added. The lines it
replaces are kept in the run log, so nothing is lost for good. Talking points (they feed cover letters) are left as
they are.
"""
from datetime import date, datetime

from pydantic import BaseModel
from pydantic_ai import Agent
from pydantic_ai.usage import UsageLimits

from . import deal_docs
from .db import connect, init_db
from .llm import Chosen, usage_dict

SCHEMA = """
CREATE TABLE IF NOT EXISTS fact_tidy (
    user_id  INTEGER NOT NULL,
    bank     TEXT NOT NULL,
    upto_id  INTEGER NOT NULL,   -- the newest fact id when this bank's overview was last tidied
    PRIMARY KEY (user_id, bank)
);
"""
LEAVE = {"Talking points"}
MAX_LINES = 4

INSTRUCTIONS = """\
You tidy one bank's overview in a student's investment banking recruiting tracker. Its facts were saved one at a \
time from emails and chats, so the same point is often there several times in different words. Rewrite each topic \
you are given as a few short lines.
- Say each point once. Merge lines that say the same thing, keeping every detail any of them had (dates, numbers, \
format, place, office).
- Recruiting process: the bank's stages in order with their dates and format (virtual or in person), how many rounds \
of coffee chats, deadlines, and when decisions come. Put the stages on one line when they fit, for example \
"Stages: coffee chats (2 rounds) > dinner Oct 27 > Round 3 virtual informationals Oct 30 to Nov 6 > Superday".
- Write about the bank and its process, never about the student ("Round 3 informationals follow the dinner", not \
"I was invited to Round 3").
- Use only what the lines say. Never add a fact, date, number or name.
- At most 4 lines per topic, each under 200 characters. One line is best when it says everything.
- Return every topic you were given, with its name exactly as written.
"""


class Topic(BaseModel):
    category: str
    lines: list[str]


class Tidied(BaseModel):
    topics: list[Topic]


tidier = Agent(output_type=Tidied, instructions=INSTRUCTIONS, name="fact_tidier")
LIMITS = UsageLimits(request_limit=2, total_tokens_limit=30_000)


def ensure() -> None:
    init_db()
    with connect() as conn:
        conn.executescript(SCHEMA)


def untidy(uid: int) -> list[str]:
    """Banks with a topic holding two or more facts that has grown since it was last tidied, busiest first."""
    ensure()
    with connect(read_only=True) as conn:
        rows = conn.execute(
            """SELECT f.bank, MAX(f.id) AS top, MAX(n) AS most FROM bank_facts f
               JOIN (SELECT bank, category, COUNT(*) AS n FROM bank_facts WHERE user_id = ? GROUP BY bank, category) c
                 ON c.bank = f.bank AND c.category = f.category
               WHERE f.user_id = ? AND f.category NOT IN ('Talking points') GROUP BY f.bank""", (uid, uid)).fetchall()
        done = {r["bank"]: r["upto_id"] for r in conn.execute("SELECT bank, upto_id FROM fact_tidy WHERE user_id = ?", (uid,))}
    return [r["bank"] for r in sorted(rows, key=lambda r: -r["most"]) if r["most"] >= 2 and r["top"] > done.get(r["bank"], 0)]


def _mark(conn, uid: int, bank: str) -> None:
    top = conn.execute("SELECT COALESCE(MAX(id), 0) FROM bank_facts WHERE user_id = ? AND bank = ?", (uid, bank)).fetchone()[0]
    conn.execute("INSERT INTO fact_tidy (user_id, bank, upto_id) VALUES (?, ?, ?) ON CONFLICT(user_id, bank) DO UPDATE SET upto_id = excluded.upto_id",
                 (uid, bank, top))


def due(conn, uid: int, bank: str) -> bool:
    """Whether the bank has facts newer than its last tidy (the next refresh would tidy it)."""
    top = conn.execute("SELECT COALESCE(MAX(id), 0) FROM bank_facts WHERE user_id = ? AND bank = ?", (uid, bank)).fetchone()[0]
    row = conn.execute("SELECT upto_id FROM fact_tidy WHERE user_id = ? AND bank = ?", (uid, bank)).fetchone()
    return top > (row["upto_id"] if row else 0)


def replace(conn, uid: int, bank: str, category: str, lines: list[str], source: str = "", added_at: str = "",
            limit: int = MAX_LINES * 2) -> int:
    """Put `lines` in place of everything a bank's topic holds. Returns how many lines it now has."""
    clean = [" ".join(str(x).split())[:400] for x in lines if str(x).strip()][:limit]
    conn.execute("DELETE FROM bank_facts WHERE user_id = ? AND bank = ? AND category = ?", (uid, bank, category))
    for line in clean:
        conn.execute("INSERT INTO bank_facts (user_id, bank, category, fact, source, added_at) VALUES (?, ?, ?, ?, ?, ?)",
                     (uid, bank, category, line, source[:200], added_at or date.today().isoformat()))
    return len(clean)


async def tidy(uid: int, chosen: Chosen, bank: str) -> dict:
    ensure()
    with connect(read_only=True) as conn:
        facts = [dict(r) for r in conn.execute(
            "SELECT id, category, fact, source, added_at FROM bank_facts WHERE user_id = ? AND bank = ? ORDER BY category, id", (uid, bank))]
    by_topic: dict[str, list[dict]] = {}
    for f in facts:
        if f["category"] not in LEAVE:
            by_topic.setdefault(f["category"], []).append(f)
    crowded = {c: fs for c, fs in by_topic.items() if len(fs) >= 2}
    if not crowded:
        with connect() as conn:
            _mark(conn, uid, bank)
        return {"ok": True, "tidied": 0}
    prompt = f"Bank: {bank}\n\n" + "\n\n".join(f"Topic: {c}\n" + "\n".join(f"- {f['fact']}" for f in fs) for c, fs in crowded.items())
    started = datetime.now().isoformat(timespec="seconds")
    result = await tidier.run(prompt, model=chosen.model, model_settings=chosen.settings, usage_limits=LIMITS)
    tidied = 0
    with connect() as conn:
        for t in result.output.topics:
            fs = crowded.get(t.category)
            lines = [x for x in t.lines if x.strip()][:MAX_LINES]
            if not fs or not lines:
                continue
            sources = "; ".join(dict.fromkeys(f["source"] for f in fs if f["source"]))
            replace(conn, uid, bank, t.category, lines, sources, max(f["added_at"] or "" for f in fs))
            tidied += 1
        _mark(conn, uid, bank)
        # the lines replaced stay in the log
        deal_docs._log(conn, uid, started, "fact_tidier", prompt, f"Tidied {tidied} topic(s) of the {bank} overview.", "ok",
                       usage_dict(result.usage))
    return {"ok": True, "tidied": tidied}


async def tidy_some(uid: int, chosen: Chosen, limit: int = 3) -> int:
    """Tidy up to `limit` banks that need it; a failure leaves the overview as it was."""
    n = 0
    for bank in untidy(uid)[:limit]:
        try:
            n += (await tidy(uid, chosen, bank))["tidied"]
        except Exception:  # noqa: BLE001 - tidying is a nicety; filing already happened
            with connect() as conn:  # not tried again until the bank gets a new fact
                _mark(conn, uid, bank)
    return n
