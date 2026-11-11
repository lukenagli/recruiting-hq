"""The voice interviewer's small talk.

A voice interview in Interview Prep opens the way a real one does: the interviewer says hello and asks how the student
is doing. Whatever the student says back gets one short, natural reply from a small model call, before the interviewer
asks how they'd like their feedback. The questions, the grading and the feedback are the practice ones
(practice.next_question and practice.grade); nothing here is saved to the tracker.
"""
import re
from datetime import datetime

from pydantic_ai import Agent
from pydantic_ai.usage import UsageLimits

from . import deal_docs
from .db import connect
from .llm import Chosen, usage_dict

INSTRUCTIONS = """\
You are a friendly, professional investment banking interviewer at the start of a mock interview with an MBA \
student. You asked how they are doing; they answered (their words came through speech-to-text, so allow for slips). \
Reply in one or two short spoken sentences, the way a person would: acknowledge what they said warmly and briefly \
(if they asked how you are, answer in a few words). Plain spoken English: no lists, no emojis, no stage directions. \
Do not ask a question and do not start the interview: the next line, about feedback, is added after yours.
"""

talker = Agent(output_type=str, instructions=INSTRUCTIONS, name="voice_interviewer")
LIMITS = UsageLimits(request_limit=1, total_tokens_limit=2_000)
FALLBACK = "Good to hear."


async def small_talk(uid: int, chosen: Chosen | None, said: str, bank: str = "") -> str:
    """The interviewer's reply to the student's answer to "how are you doing?". Never fails: a set line without AI."""
    said = " ".join((said or "").split())[:500]
    if chosen is None or not said:  # a set line, answering "and you?" if they asked
        asked = re.search(r"\bhow (are|about|is it going with) you\b|\band you\b|\byourself\b", said, re.I)
        return "I'm doing well, thanks for asking." if asked else FALLBACK
    prompt = (f"The interview is for {bank}. " if bank and bank != "Any" else "") + f"The student said: {said}"
    started = datetime.now().isoformat(timespec="seconds")
    try:
        result = await talker.run(prompt, model=chosen.model, model_settings=chosen.settings, usage_limits=LIMITS)
    except Exception:  # noqa: BLE001 - small talk is a nicety: the interview goes on
        return FALLBACK
    reply = " ".join(str(result.output).split())[:300] or FALLBACK
    with connect() as conn:
        deal_docs._log(conn, uid, started, "voice_interviewer", prompt, reply, "ok", usage_dict(result.usage))
    return reply
