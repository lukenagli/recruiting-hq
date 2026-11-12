"""Superday prep for one bank: what it asks at Superdays, the student's weakest technical areas, and their story.

- The questions are the school club's bank (round "Superday", this bank), newest sources first.
- The weak areas come from the student's own practice (practice.progress), weakest first.
- The story ("why this bank", "why this group") is written by the model from the student's own material only: their
  resume and notes about themselves, the bank's overview and talking points, and their chats there. It is saved per
  bank so it can be read again, and rewritten on request. Nothing is ever made up; thin spots are listed as gaps.
"""
import re
from datetime import datetime

from pydantic import BaseModel, Field
from pydantic_ai import Agent, NativeOutput
from pydantic_ai.usage import UsageLimits

from . import cover_letters, practice, question_clean
from . import profile as user_profile
from .db import connect, init_db
from .llm import Chosen, usage_dict

SCHEMA = """
CREATE TABLE IF NOT EXISTS superday_stories (
    user_id     INTEGER NOT NULL,
    bank        TEXT NOT NULL,
    why_bank    TEXT NOT NULL,
    why_group   TEXT NOT NULL,
    people      TEXT NOT NULL DEFAULT '[]',
    gaps        TEXT NOT NULL DEFAULT '[]',
    group_name  TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    PRIMARY KEY (user_id, bank)
);
"""
# Notes about how an interview went rather than a question asked ("No questions, just gave me the offer...").
NOT_A_QUESTION = re.compile(r"^(no questions|very brief|was writing|nothing technical)|pleasantries|gave me the offer", re.I)
SOURCE_ORDER = {"live_1y": 0, "live_2y": 1, "ib_2025": 2, "master": 3, "technical": 4}
LIMITS = UsageLimits(request_limit=2, total_tokens_limit=40_000)

INSTRUCTIONS = """\
You help an MBA student prepare the "why" answers for an investment banking Superday at one bank. Write what the \
student would say out loud, in the first person, in plain spoken sentences.

- why_bank: their answer to "Why [bank]?", about 120 to 170 words (a minute of speaking). Lead with the strongest \
reason, back it with specifics: what people at the bank told them in their chats (name the person, e.g. "When I \
spoke with Jane Smith..."), and what they know about the bank and its program.
- why_group: their answer to "Why [group]?" (or "Why the generalist program?" when the program is generalist), \
about 120 to 170 words, tying their own background (resume, what they wrote about themselves) to the group's work.
- people: the people at this bank worth mentioning by name in the room, each with a few words on what to bring up \
from that chat. Only people in the chats you were given.
- gaps: up to three things the answers would be stronger with that the material doesn't have (for example "no \
notes on deals the group has done"), so the student knows what to find out. Empty if there are none.

Rules:
- Use only the material given. Never invent a person, deal, number, office, team detail or experience. If the \
material is thin, keep the answer shorter rather than padding it, and say what is missing in gaps.
- No em dashes, semicolons or markdown. Write "investment banking" in lowercase.
"""


class Story(BaseModel):
    why_bank: str
    why_group: str
    people: list[str] = Field(default_factory=list, description="'Name: what to bring up from that chat'")
    gaps: list[str] = Field(default_factory=list)


agent = Agent(output_type=Story, instructions=INSTRUCTIONS, name="superday_story_writer")


def ensure() -> None:
    init_db()
    with connect() as conn:
        conn.executescript(SCHEMA)


def _story(conn, uid: int, bank: str) -> dict | None:
    import json

    row = conn.execute("SELECT * FROM superday_stories WHERE user_id = ? AND bank = ?", (uid, bank)).fetchone()
    if not row:
        return None
    return {"why_bank": row["why_bank"], "why_group": row["why_group"], "people": json.loads(row["people"]),
            "gaps": json.loads(row["gaps"]), "group": row["group_name"], "at": row["created_at"]}


def brief(uid: int, bank: str) -> dict:
    """Everything on the Superday prep page for one bank."""
    ensure()
    with connect(read_only=True) as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT id, question, qtype, grp, interviewer, source, answer_notes FROM questions WHERE bank = ? AND round = 'Superday'",
            (bank,))]
        story = _story(conn, uid, bank)
        ctx = cover_letters._context(conn, uid, bank)
    done = question_clean.splits()
    for r in rows:  # the answer some students typed into the question goes with the notes
        r["question"], r["answer_notes"], r["skip"] = question_clean.apply(r["id"], r["question"] or "", r["answer_notes"] or "", done)
    rows = [r for r in rows if not r.pop("skip") and len(r["question"].strip()) > 3 and not NOT_A_QUESTION.search(r["question"].strip())]
    rows.sort(key=lambda r: (SOURCE_ORDER.get(r["source"], 9), -r["id"]))
    by_type: dict[str, int] = {}
    for r in rows:
        by_type[r["qtype"]] = by_type.get(r["qtype"], 0) + 1
    for r in rows:
        r["source"] = practice.SOURCE_LABEL.get(r["source"], "")
    areas = practice.progress(uid)["areas"]
    practiced = sorted((a for a in areas if a["graded"]), key=lambda a: (a["score"] if a["score"] is not None else 1, -a["graded"]))
    weak = [a for a in practiced if (a["score"] or 0) < 0.85][:3]
    untried = [a["topic"] for a in areas if not a["graded"] and a["topic"] != "Other"]
    return {"bank": bank, "questions": rows[:80], "total": len(rows), "by_type": by_type,
            "weak": weak, "untried": untried, "story": story,
            "group": "generalist program" if ctx["generalist"] else ctx["group"], "spoken": len(ctx["spoken"])}


async def write_story(uid: int, chosen: Chosen, bank: str) -> dict:
    """Write (or rewrite) the student's "why this bank" and "why this group" answers for this bank, and save them."""
    import json

    ensure()
    with connect(read_only=True) as conn:
        ctx = cover_letters._context(conn, uid, bank)
    prof = user_profile.get(uid)
    group = "the generalist program" if ctx["generalist"] else (ctx["group"] or "")
    if not group:
        return {"ok": False, "reason": f"Pick the group you're recruiting for at {bank} first (on the bank's page or in Settings → About you)."}
    chats = "\n".join(f"- {p['name']} ({', '.join(x for x in (p['title'], p['grp']) if x) or 'role not recorded'}): {p['said'] or '(no notes)'}"
                      for p in ctx["spoken"]) or "- (no chats with notes yet)"
    prompt = "\n\n".join([
        f"Bank: {bank}", f"Group: {group}",
        f"The student's notes about themselves:\n{user_profile.background(prof) or '(none)'}",
        f"Resume:\n{prof['resume_text'][:6000] or '(not provided)'}",
        f"What they know about {bank} (its overview and talking points):\n" + ("\n".join(f"- {f}" for f in ctx["facts"]) or "- (nothing yet)"),
        f"Their chats at {bank} (who, and what was said):\n{chats}",
    ])
    started = datetime.now().isoformat(timespec="seconds")
    output = NativeOutput(Story) if chosen.provider == "anthropic" else None  # Claude rejects forced tool calls
    result = await agent.run(prompt, model=chosen.model, model_settings=chosen.settings, usage_limits=LIMITS, output_type=output)
    s, usage = result.output, usage_dict(result.usage)
    clean = lambda t: " ".join(t.replace("—", ", ").replace(";", ",").split())  # noqa: E731
    with connect() as conn:
        conn.execute(
            """INSERT INTO superday_stories (user_id, bank, why_bank, why_group, people, gaps, group_name, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, bank) DO UPDATE SET why_bank = excluded.why_bank,
               why_group = excluded.why_group, people = excluded.people, gaps = excluded.gaps, group_name = excluded.group_name,
               created_at = excluded.created_at""",
            (uid, bank, clean(s.why_bank), clean(s.why_group), json.dumps([clean(p) for p in s.people][:8]),
             json.dumps([clean(g) for g in s.gaps][:3]), group, started))
        conn.execute(
            """INSERT INTO agent_runs (user_id, started_at, agent, user_message, reply, steps, outcome, requests,
                                       input_tokens, cached_input_tokens, output_tokens)
               VALUES (?, ?, 'superday_story_writer', ?, ?, '[]', 'ok', ?, ?, ?, ?)""",
            (uid, started, f"Superday story for {bank}", s.why_bank[:2000], usage["requests"], usage["input_tokens"],
             usage["cached_input_tokens"], usage["output_tokens"]))
        story = _story(conn, uid, bank)
    return {"ok": True, "story": story, "usage": usage}
