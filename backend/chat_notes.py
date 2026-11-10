"""Tidying dictated coffee chat notes (preview).

Notes dictated into Add a coffee chat run on, repeat themselves and carry speech-to-text slips. Before they're saved,
one small model call turns them into short bullets under a few headings, keeping every fact and adding none. The
student sees the result in the notes box (with Undo) before saving, and the dictated text goes in the run log.
"""
from datetime import datetime

from pydantic_ai import Agent
from pydantic_ai.usage import UsageLimits

from . import deal_docs
from .db import connect
from .llm import Chosen, usage_dict

INSTRUCTIONS = """\
You tidy a student's dictated notes from an investment banking coffee chat into notes that are easy to read later. \
They were spoken, so they run on, repeat themselves and have speech-to-text mistakes.
- Keep every fact: names, numbers, dates, deals, groups, offices, advice, anything to follow up on. Never add \
anything that isn't there and never guess.
- Fix a mis-heard word only when the context makes it certain: the person, bank and group given, or a banking term \
("lever fin" is Leveraged Finance, "M and A" is M&A, "LBO", "TMT", "FIG").
- Drop filler (um, like, you know, so yeah), false starts and repeats.
- Group the points under these headings, in this order, leaving out any heading with nothing under it: Their path, \
The group and the work, Recruiting advice, Personal, Follow-ups. If the notes are only a sentence or two, write one \
or two bullets with no headings.
- Format: each heading on its own line ending with a colon; each point on its own line starting with "• "; a detail \
under a point on its own line starting with two spaces and "◦ ". A blank line before each heading after the first. \
Plain text only: no markdown, no bold, no numbering.
- Short points in plain words, written as notes about the conversation ("Moved from consulting to Industrials in \
2022", "Said to reach out to Sam in Leveraged Finance"), never as a letter.
- Return only the tidied notes.
"""

tidier = Agent(output_type=str, instructions=INSTRUCTIONS, name="chat_notes")
LIMITS = UsageLimits(request_limit=2, total_tokens_limit=20_000)


async def polish(uid: int, chosen: Chosen, notes: str, name: str = "", bank: str = "", group: str = "", title: str = "") -> str:
    """The dictated notes as tidy bullets. Raises if the model call fails (the caller keeps the notes as dictated)."""
    who = ", ".join(x for x in (name, title, group, bank) if x)
    prompt = f"Coffee chat with: {who or 'not given'}\n\nDictated notes:\n{notes.strip()[:12000]}"
    started = datetime.now().isoformat(timespec="seconds")
    result = await tidier.run(prompt, model=chosen.model, model_settings=chosen.settings, usage_limits=LIMITS)
    out = "\n".join(line.rstrip() for line in str(result.output).replace("\r", "").strip().split("\n"))
    with connect() as conn:  # the dictated text stays in the log
        deal_docs._log(conn, uid, started, "chat_notes", prompt, out[:2000], "ok", usage_dict(result.usage))
    return out
