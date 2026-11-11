"""Making a guide's questions stand on their own.

Guides number their questions under section intros that say what to do with them ("Accounting – Calculations ...
explain how the Income Statement, Cash Flow Statement and Balance Sheet change"), so a question on its own often
leaves the ask unsaid ("A company with 1,000 shares issues 500 new shares..."). When a guide is uploaded, each
section's questions go to a small model call with the section's intro, and come back saying exactly what to answer,
in the guide's own words with only the missing instruction added. Items that aren't questions (the guide's own
answering steps, formulas) are dropped. Without an AI key the questions are kept as extracted.
"""
import asyncio

from pydantic import BaseModel, Field
from pydantic_ai import Agent
from pydantic_ai.usage import UsageLimits

from .llm import Chosen

INSTRUCTIONS = """\
You prepare interview questions taken from a study guide so a student can practice each one on its own. The \
guide numbers its questions under a section intro, and the intro often carries the instruction (for example "walk \
through the three financial statements", "how do Equity Value and Enterprise Value change?", "solve for the \
IRR"), so a question copied out alone may not say what to answer.

For each numbered item:
- Return the question so that it states exactly what the student should answer. Keep the guide's wording, numbers \
and assumptions; add only the instruction the section implies, as a short final sentence ("Walk me through the \
changes on the three financial statements." or "How do Equity Value and Enterprise Value change?"). If the item \
already says what to answer, return it unchanged.
- If the item builds on the one before it ("How do these figures change if...", "Now assume..."), set \
follows_previous to true and leave its wording as it is: it will be asked right after that item, with it on screen.
- If the item is not a question to practice (a step in how to answer, a formula, a rule, a heading), return an \
empty string for it.
- Never add facts, numbers or assumptions that aren't in the item or the section intro.
- Return one entry per item, with its number, in the same order.
"""


class Item(BaseModel):
    n: int
    question: str = Field(description="The self-contained question, or an empty string if the item isn't a question.")
    follows_previous: bool = Field(default=False, description="True if it builds on the item before it.")


class Clarified(BaseModel):
    items: list[Item]


agent = Agent(output_type=Clarified, instructions=INSTRUCTIONS, name="guide_clarifier")
LIMITS = UsageLimits(request_limit=2, total_tokens_limit=40_000)
BATCH = 25


async def _one(chosen: Chosen, context: str, batch: list[dict]) -> dict[int, tuple[str, bool]]:
    listed = "\n".join(f"{i}. {q['question']}" for i, q in enumerate(batch, 1))
    prompt = f"Section intro from the guide:\n{context.strip() or '(none)'}\n\nItems:\n{listed}"
    try:
        result = await agent.run(prompt, model=chosen.model, model_settings=chosen.settings, usage_limits=LIMITS)
    except Exception:  # noqa: BLE001 - keep the questions as extracted
        return {}
    return {it.n: (" ".join(it.question.split()), it.follows_previous) for it in result.output.items if 1 <= it.n <= len(batch)}


async def clarify(chosen: Chosen | None, questions: list[dict]) -> list[dict]:
    """The questions, each saying what to answer (in place); items that aren't questions are left out."""
    if chosen is None or not questions:
        return questions
    groups: dict[str, list[dict]] = {}
    for q in questions:
        groups.setdefault(q.get("context", ""), []).append(q)
    jobs = [(ctx, qs[i:i + BATCH]) for ctx, qs in groups.items() for i in range(0, len(qs), BATCH)]
    limit = asyncio.Semaphore(6)

    async def run(ctx: str, batch: list[dict]) -> None:
        async with limit:
            out = await _one(chosen, ctx, batch)
        for i, q in enumerate(batch, 1):
            if i in out:
                q["question"], q["follows"] = out[i]  # "" marks an item that isn't a question

    await asyncio.gather(*(run(ctx, b) for ctx, b in jobs))
    return [q for q in questions if q["question"]]
