"""Thank-you note drafts.

Two kinds of template:
- the user's own: the email they send, with the parts that change in [square brackets]. Code keeps every word
  outside the brackets exactly as written, fills the brackets it knows (first name, bank, when), and the model
  writes only the remaining bracketed parts, checked against the user's own rules;
- otherwise the standard template (the Yale SOM Finance Club format) below.

In the standard template the fixed text is assembled here in code. The model only writes the two short details that
fill the middle paragraph, and code checks them against the club's rules (and a few house rules), retrying once with
the problems spelled out. Drafts are saved for the user to copy and send; nothing is ever sent.
"""
import json
import re
from datetime import date, datetime, timedelta

from pydantic import BaseModel, Field
from pydantic_ai import Agent
from pydantic_ai.usage import UsageLimits

from . import profile as user_profile
from . import templates
from .db import connect, init_db
from pydantic_ai import NativeOutput

from .llm import Chosen, usage_dict

TEMPLATE = (
    "{first},\n\n"
    "I just want to thank you again for meeting with me {when}.\n\n"
    "I enjoyed hearing more about what led you to {bank} and {detail1}. I also liked learning about {detail2}.\n\n"
    "Thank you again for your time and insight. I really enjoyed our conversation and hope we can stay in touch throughout the process."
)
LIMITS = UsageLimits(request_limit=2, total_tokens_limit=20_000)
PART_HOURS = {"morning": 10, "afternoon": 14, "evening": 18}
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

INSTRUCTIONS = """\
You write the two personal details for an MBA student's thank-you note after a coffee chat with a banker or \
second-year student. The fixed text around them is already written:

  "I enjoyed hearing more about what led you to [Bank] and [detail1]. I also liked learning about [detail2]."

Rules:
- detail1 continues the first sentence about what led them to the bank and their path or work there. \
detail2 is a second, different topic from the conversation.
- Use only details in the notes you are given. Never invent a name, deal, number, group or fact.
- Each finished sentence must be 20 to 30 words in total, so detail1 is about 10 to 18 words and detail2 \
about 15 to 25 words.
- detail1 must not contain the word "and" (the sentence already has one). detail2 may use "and" at most once.
- No em dashes, semicolons, exclamation points, parentheses or emojis. No "really". Write "investment \
banking" in lowercase.
- Start each detail in lowercase, end without a period, and write it so it reads naturally after the fixed words.
"""


class Details(BaseModel):
    detail1: str = Field(description="Ends the sentence 'I enjoyed hearing more about what led you to <Bank> and ...'")
    detail2: str = Field(description="Ends the sentence 'I also liked learning about ...'")


agent = Agent(output_type=Details, instructions=INSTRUCTIONS, name="thank_you_writer")


def _part(note: str) -> str:
    note = (note or "").lower()
    return next((p for p in PART_HOURS if p in note), "")


def _next_working_morning(day: date) -> datetime:
    day += timedelta(days=1)
    while day.weekday() >= 5:
        day += timedelta(days=1)
    return datetime(day.year, day.month, day.day, 9, 0)


def send_plan(chat_day: date, part: str, now: datetime | None = None) -> tuple[datetime, str, str]:
    """When to send (Finance Club rules) and the matching "time phrase" for the note.

    Rules: no earlier than 4 hours and no later than 24 hours after the chat, weekdays 9:00 AM to 6:00 PM only,
    and a Friday afternoon chat is answered at 9:00 AM Monday.
    """
    chat = datetime(chat_day.year, chat_day.month, chat_day.day, PART_HOURS.get(part, 12))
    send = chat + timedelta(hours=4)
    if chat_day.weekday() == 4 and part in ("afternoon", "evening"):
        send = _next_working_morning(chat_day)
    elif send.weekday() >= 5 or send.hour >= 18:
        send = _next_working_morning(send.date())
    elif send.hour < 9:
        send = send.replace(hour=9, minute=0)
    note = "4 to 24 hours after the chat, on a weekday between 9:00 AM and 6:00 PM"
    if now and send < now:  # the planned time is behind us: the next working moment from now
        send = now if now.weekday() < 5 and 9 <= now.hour < 18 else _next_working_morning(now.date())
        if send > chat + timedelta(hours=24) and not (chat_day.weekday() == 4 and part in ("afternoon", "evening")):
            note = "This is past the 24-hour window, so send it as soon as you can during working hours"
    gap = (send.date() - chat_day).days
    when = "today" if gap == 0 else "yesterday" if gap == 1 else f"on {DAYS[chat_day.weekday()]}"
    if part:
        when = f"this {part}" if gap == 0 else f"{when} {part}"
    return send, when, note


def problems(detail1: str, detail2: str, bank: str) -> list[str]:
    found = []
    for name, text in (("detail1", detail1), ("detail2", detail2)):
        if re.search(r"[—–;!()]", text) or "--" in text:
            found.append(f"{name} has an em dash, semicolon, exclamation point or parenthesis")
        if re.search(r"\breally\b", text, re.I):
            found.append(f"{name} uses 'really'")
        if re.search(r"Investment Banking", text):
            found.append(f"{name} capitalizes 'investment banking'")
    s1 = f"I enjoyed hearing more about what led you to {bank} and {detail1}."
    s2 = f"I also liked learning about {detail2}."
    for label, sentence in (("first sentence", s1), ("second sentence", s2)):
        words = len(sentence.split())
        if not 20 <= words <= 30:
            found.append(f"the {label} is {words} words; it must be 20 to 30")
        if len(re.findall(r"\band\b", sentence, re.I)) > 1:
            found.append(f"the {label} uses 'and' more than once")
    return found


async def draft(uid: int, chosen: Chosen, interaction_id: int, person_id: int | None = None) -> dict:
    """Write and save a thank-you draft for one of the user's finished coffee chats."""
    init_db()
    with connect(read_only=True) as conn:
        chat = conn.execute("SELECT * FROM interactions WHERE id = ? AND user_id = ?", (interaction_id, uid)).fetchone()
        if chat is None or chat["kind"] != "coffee_chat":
            return {"ok": False, "reason": "Thank-you drafts are for coffee chats."}
        people = [dict(r) for r in conn.execute(
            "SELECT p.* FROM people p JOIN interaction_people ip ON ip.person_id = p.id WHERE ip.interaction_id = ?", (interaction_id,))]
        questions = [dict(r) for r in conn.execute("SELECT direction, question FROM interaction_questions WHERE interaction_id = ?", (interaction_id,))]
    person = next((p for p in people if p["id"] == person_id), people[0] if people else None)
    if person is None:
        return {"ok": False, "reason": "No person is linked to this chat."}
    if not chat["date"]:
        return {"ok": False, "reason": "The chat has no date yet, so the send time and wording cannot be worked out."}

    part = _part(chat["date_note"])
    send_at, when, send_note = send_plan(date.fromisoformat(chat["date"]), part, datetime.now())
    first, bank = person["name"].split()[0], chat["bank"]
    notes = "\n".join(filter(None, [
        f"Who: {person['name']}, {person['title'] or 'title not recorded'}, {bank}, {person['grp'] or 'group not recorded'}",
        f"What we talked about: {chat['summary'] or 'no notes'}",
        f"About them: {person['notes']}" if person["notes"] else "",
        "Questions I asked them: " + "; ".join(q["question"] for q in questions if q["direction"] == "i_asked") if questions else "",
    ]))

    started = datetime.now().isoformat(timespec="seconds")
    prof = user_profile.get(uid)
    template = templates.email_templates(uid)["post_chat"]
    # The club's standard thank-you uses the rule-checked writer below; an edited template is filled as written.
    if template.strip() and not templates.is_default("post_chat", template):
        with connect(read_only=True) as conn:
            me = conn.execute("SELECT name FROM users WHERE id = ?", (uid,)).fetchone()["name"]
        body, issues, total = await draft_custom(uid, chosen, template, prof["email_rules"], dict(chat), person, notes, when, me)
        return _save(uid, interaction_id, person, bank, first, send_at, send_note, body, issues, total, started)

    total = {"input_tokens": 0, "cached_input_tokens": 0, "output_tokens": 0, "requests": 0}
    prompt, issues, details = notes, [], None
    for _ in range(2):
        # Claude Opus 5.5 rejects forced tool calls, so ask it for the typed result as native structured output.
        output = NativeOutput(Details) if chosen.provider == "anthropic" else None
        result = await agent.run(prompt, model=chosen.model, model_settings=chosen.settings, usage_limits=LIMITS, output_type=output)
        for k, v in usage_dict(result.usage).items():
            total[k] += v
        details = result.output
        d1, d2 = details.detail1.strip().rstrip("."), details.detail2.strip().rstrip(".")
        issues = problems(d1, d2, bank)
        if not issues:
            break
        prompt = f"{notes}\n\nYour last attempt broke these rules, fix them:\n- " + "\n- ".join(issues) + f"\nLast attempt: detail1={d1!r} detail2={d2!r}"

    body = TEMPLATE.format(first=first, when=when, bank=bank, detail1=d1, detail2=d2)
    return _save(uid, interaction_id, person, bank, first, send_at, send_note, body, issues, total, started)


def _save(uid, interaction_id, person, bank, first, send_at, send_note, body, issues, total, started) -> dict:
    check = f"Check: {person['name']} (first name {first}), {bank}, {person['grp'] or 'group not recorded'}"
    send =f"Send: {send_at.strftime('%A, %b')} {send_at.day} at {send_at.strftime('%I:%M %p').lstrip('0')}. {send_note}."
    with connect() as conn:
        draft_id = conn.execute(
            """INSERT INTO thank_you_drafts (user_id, interaction_id, person_id, body, check_line, send_line, warnings, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (uid, interaction_id, person["id"], body, check, send, json.dumps(issues), started),
        ).lastrowid
        conn.execute(
            """INSERT INTO agent_runs (user_id, started_at, agent, user_message, reply, steps, outcome, requests,
                                       input_tokens, cached_input_tokens, output_tokens)
               VALUES (?, ?, 'thank_you_writer', ?, ?, '[]', ?, ?, ?, ?, ?)""",
            (uid, started, f"Thank-you draft for {person['name']} ({bank})", body, "ok" if not issues else "rule_warnings",
             total["requests"], total["input_tokens"], total["cached_input_tokens"], total["output_tokens"]),
        )
    return {"ok": True, "id": draft_id, "who": person["name"], "bank": bank, "body": body, "check": check,
            "send": send, "warnings": issues, "usage": total}


# ---------------- The user's own template ----------------

STANDARD_TEMPLATE = (
    "[First name],\n\nI just want to thank you again for meeting with me [when].\n\n"
    "I enjoyed hearing more about what led you to [Bank] and [something specific about their path or work there]. "
    "I also liked learning about [a second topic from the conversation].\n\n"
    "Thank you again for your time and insight. I really enjoyed our conversation and hope we can stay in touch throughout the process."
)
SLOT = re.compile(r"\[([^\[\]\n]{1,120})\]")
KNOWN_SLOTS = {
    "first": ("first name", "their first name", "name", "contact first name", "contact name", "recipient", "banker name",
              "banker first name", "banker or 2y", "banker or 2y name", "banker or 2y's name", "banker or 2y’s name", "2y name"),
    "full": ("full name", "their full name", "contact full name", "banker first & last name", "banker or 2y first & last name",
             "banker full name"),
    "bank": ("bank", "firm", "company", "bank name", "firm name"),
    "group": ("group", "team", "their group", "their team"),
    "when": ("when", "day", "date", "time", "today/yesterday", "day of the week", "when we met"),
    "me": ("my name", "your name", "my first name", "sign-off", "signature"),
    "me_full": ("my full name", "your full name", "student name", "student first & last name", "student full name"),
}

FILL_INSTRUCTIONS = """\
You fill in the bracketed parts of a student's own thank-you email template after a networking conversation \
with a banker. Everything outside the brackets is fixed and will be kept exactly as written; you only write the \
text that replaces each bracket, in order, so that each finished sentence reads naturally.

Rules:
- Each bracket's text says what belongs there. Write only that, matching the length and tone of the template.
- Use only details in the notes you are given. Never invent a name, deal, number, group or fact.
- Follow the student's own rules exactly when given.
- Each fill is plain text on one line: no brackets, no line breaks, no quotation marks around it.
- If the notes do not contain what a bracket asks for (a phone number, a class year, a detail never discussed), \
return an empty string for it. It will be left in brackets for the student to fill; never guess.
- Start a fill in lowercase unless it begins a sentence or starts with a proper noun.
"""


class Fills(BaseModel):
    fills: list[str] = Field(description="The text for each bracket, in the order they appear.")


filler = Agent(output_type=Fills, instructions=FILL_INSTRUCTIONS, name="thank_you_writer")


def template_problem(text: str) -> str | None:
    """Why a pasted template cannot be used, or None. An empty template means 'use the standard one'."""
    text = text.strip()
    if not text:
        return None
    slots = SLOT.findall(text)
    if not slots:
        return ("Put the parts that change in [square brackets], for example [First name], [Bank] or "
                "[something we talked about], so the rest of your email is kept word for word.")
    if text.count("[") != text.count("]") or "[[" in text:
        return "A bracket is not closed. Each changing part should look like [this]."
    if len(slots) > 25:
        return "That template has more than 25 bracketed parts. Keep the brackets to the parts that really change."
    return None


def _known(hint: str) -> str | None:
    h = hint.strip().lower().rstrip(":.")
    return next((k for k, names in KNOWN_SLOTS.items() if h in names), None)


def fill_problems(fills: list[str], expected: int) -> list[str]:
    found = []
    if len(fills) != expected:
        found.append(f"there are {expected} brackets to fill but you gave {len(fills)} fills")
    for i, f in enumerate(fills, 1):
        if re.search(r"[\[\]\n]", f):
            found.append(f"fill {i} has a bracket or line break")
        if len(f.split()) > 45:
            found.append(f"fill {i} is {len(f.split())} words; keep each fill short")
    return found


async def draft_custom(uid: int, chosen: Chosen, template: str, rules: str, chat: dict, person: dict,
                       notes: str, when: str, me: str) -> tuple[str, list[str], dict]:
    """Fill the user's template. Returns (body, warnings, usage)."""
    known = {"first": person["name"].split()[0], "full": person["name"], "bank": chat["bank"],
             "group": person["grp"] or "", "when": when, "me": me.split()[0] if me else "", "me_full": me}
    slots = [(m.start(), m.end(), m.group(1)) for m in SLOT.finditer(template)]
    ai_slots = [h for _, _, h in slots if not (_known(h) and known[_known(h)])]
    total = {"input_tokens": 0, "cached_input_tokens": 0, "output_tokens": 0, "requests": 0}
    fills, issues = [], []
    if ai_slots:
        ask = "\n".join(f"{i}. [{h}]" for i, h in enumerate(ai_slots, 1))
        base = (f"Template:\n{template}\n\nBrackets you must fill, in order:\n{ask}\n\n"
                f"Student's rules:\n{rules or '(none)'}\n\nNotes from the conversation:\n{notes}")
        prompt = base
        for _ in range(2):
            output = NativeOutput(Fills) if chosen.provider == "anthropic" else None
            result = await filler.run(prompt, model=chosen.model, model_settings=chosen.settings, usage_limits=LIMITS, output_type=output)
            for k, v in usage_dict(result.usage).items():
                total[k] += v
            fills = [f.strip().strip('"').rstrip() for f in result.output.fills]
            issues = fill_problems(fills, len(ai_slots))
            if not issues:
                break
            prompt = f"{base}\n\nYour last attempt broke these rules, fix them:\n- " + "\n- ".join(issues) + f"\nLast attempt: {fills!r}"
    out, pos, ai_i = [], 0, 0
    for start, end, hint in slots:
        out.append(template[pos:start])
        key = _known(hint)
        if key and known[key]:
            out.append(known[key])
        elif ai_i < len(fills) and fills[ai_i]:
            out.append(fills[ai_i])
            ai_i += 1
        elif ai_i < len(fills):  # the notes did not have it: leave the bracket for the student
            out.append(f"[{hint}]")
            issues.append(f"[{hint}] still needs filling in")
            ai_i += 1
        else:
            out.append(f"[{hint}]")  # left for the user to fill
            issues.append(f"[{hint}] still needs filling in")
        pos = end
    out.append(template[pos:])
    return "".join(out), issues, total


def mark_sent(uid: int, draft_id: int) -> dict:
    init_db()
    with connect() as conn:
        row = conn.execute("SELECT interaction_id FROM thank_you_drafts WHERE id = ? AND user_id = ?", (draft_id, uid)).fetchone()
        if row is None:
            return {"ok": False}
        conn.execute("UPDATE interactions SET thank_you = ? WHERE id = ?", (date.today().isoformat(), row[0]))
        conn.execute("UPDATE thank_you_drafts SET sent_at = ? WHERE id = ?", (datetime.now().isoformat(timespec="seconds"), draft_id))
    return {"ok": True}


def record_sent(uid: int, interaction_id: int, person_id: int, body: str) -> dict:
    """Save a thank-you that was written and sent outside the app, as a sent draft of that chat."""
    body = body.strip()[:6000]
    if not body:
        return {"ok": False, "reason": "Paste the email first."}
    init_db()
    with connect() as conn:
        chat = conn.execute("SELECT thank_you FROM interactions WHERE id = ? AND user_id = ? AND kind = 'coffee_chat'",
                            (interaction_id, uid)).fetchone()
        linked = conn.execute("SELECT 1 FROM interaction_people ip JOIN people p ON p.id = ip.person_id WHERE ip.interaction_id = ? "
                              "AND ip.person_id = ? AND p.user_id = ?", (interaction_id, person_id, uid)).fetchone()
        if chat is None or linked is None:
            return {"ok": False, "reason": "That chat isn't in your tracker."}
        now = datetime.now().isoformat(timespec="seconds")
        conn.execute("""INSERT INTO thank_you_drafts (user_id, interaction_id, person_id, body, check_line, send_line, warnings, created_at, sent_at)
                        VALUES (?, ?, ?, ?, '', '', '[]', ?, ?)""", (uid, interaction_id, person_id, body, now, now))
        if chat["thank_you"] in ("", "n/a", None):
            conn.execute("UPDATE interactions SET thank_you = ? WHERE id = ?", (date.today().isoformat(), interaction_id))
    return {"ok": True}


def owed_chats(uid: int, entry_ids: list[int]) -> list[int]:
    """Of the entries a run touched, the finished coffee chats that still need a thank-you and have no draft yet."""
    if not entry_ids:
        return []
    with connect(read_only=True) as conn:
        marks = ",".join("?" * len(entry_ids))
        return [r[0] for r in conn.execute(
            f"""SELECT id FROM interactions WHERE user_id = ? AND id IN ({marks}) AND kind = 'coffee_chat' AND status = 'done'
                AND COALESCE(thank_you, '') = '' AND date != ''
                AND id NOT IN (SELECT interaction_id FROM thank_you_drafts)""", (uid, *entry_ids))]
