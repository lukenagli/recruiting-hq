"""The student's story bank: six to eight stories from their own experience that bend to any behavioral question.

The Finance Club's Superday deck ("Curveballs at Superday") says to prepare a bank of stories rather than an answer
per question: a handful of real stories that show who you are, each mapped to the buckets interviewers test
(ownership, judgment, rigor, pressure, backbone, client focus, leadership, learning), a positive and a negative per
bucket where you can, each told as Situation and task (two or three sentences), Action (most of the time: what you
personally did) and Result (quantified, then the lesson).

The stories are built in a conversation: the coach reads the resume, asks about each role and digs for the specifics
interviewers probe for, then writes each story up in the student's own words and saves it with its buckets. Interview
practice reads the bank to say which story fits a behavioral question and how to bend it.
"""
import json
from dataclasses import dataclass, field
from datetime import datetime

from pydantic_ai import Agent, RunContext
from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.usage import UsageLimits

from . import profile as user_profile
from .db import connect, init_db
from .llm import Chosen, usage_dict

SCHEMA = """
CREATE TABLE IF NOT EXISTS stories (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    title       TEXT NOT NULL,
    situation   TEXT NOT NULL DEFAULT '',
    action      TEXT NOT NULL DEFAULT '',
    result      TEXT NOT NULL DEFAULT '',
    buckets     TEXT NOT NULL DEFAULT '[]',
    polarity    TEXT NOT NULL DEFAULT 'went well',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stories_user ON stories (user_id);
"""
# What interviewers test, from the club's deck: key, name, the question behind it.
BUCKETS = [
    ("ownership", "Ownership & accountability", "Do you own outcomes beyond your box, including the bad ones?"),
    ("judgment", "Judgment & decisions", "Can you make a sound call with incomplete information?"),
    ("rigor", "Rigor & high standards", "Will you catch the error before it reaches the client?"),
    ("pressure", "Delivering under pressure", "Do you deliver on time, with quality, and flag risk early?"),
    ("backbone", "Backbone & influence", "Will you respectfully push back, then commit fully?"),
    ("client", "Client focus", "Do you work backwards from what the client really needs?"),
    ("leadership", "Team & people leadership", "Can you run a team: develop people and address issues?"),
    ("learning", "Learning, initiative & resourcefulness", "Do you learn fast and do more with less?"),
]
BUCKET_KEYS = [b[0] for b in BUCKETS]
POLARITIES = ("went well", "went wrong")
LIMITS = UsageLimits(request_limit=8, tool_calls_limit=12, total_tokens_limit=60_000)
MAX_STORIES = 12

INSTRUCTIONS = """\
You are a warm, sharp interview coach helping an MBA student build their story bank for investment banking \
behavioral interviews, in a conversation. Interviewers ask hundreds of different "tell me about a time..." questions \
and nobody can prepare an answer for each. The way to prepare is six to eight real stories from the student's own \
experience, each covering several of the eight buckets interviewers test (below), told so they bend to any question. \
You have the student's resume and the stories saved so far.

The eight buckets: ownership (owning outcomes beyond your box, including the bad ones); judgment (a sound call with \
incomplete information); rigor (catching the error before it reaches the client, high standards); pressure \
(delivering on time with quality, flagging risk early, juggling priorities); backbone (pushing back respectfully, \
influencing, then committing); client (working back from what the client really needs, difficult clients); \
leadership (running a team, developing people, addressing low performance); learning (learning fast, initiative, \
doing more with less, taking feedback).

How to run the conversation:
- Talk like a person: short messages, one question at a time (two at most), plain words, no headings, no bullet \
lists in what you say, no markdown. Sound curious about them. Use their first name now and then.
- If the bank is empty, start by getting the lay of the land: their main roles from the resume, what they actually \
did day to day in the most recent one, what they're proudest of. Then go role by role looking for stories: a win they \
drove, a time something went wrong (a real stumble with medium stakes and a clear lesson, never ethics or a big \
loss), a disagreement, a hard deadline, a difficult person or client, something they learned fast or built from nothing.
- Dig for what interviewers probe: what the goal was and why it mattered, what the student personally did versus the \
team, the hardest obstacle, what they pushed back on, the numbers ($, %, time, people), what happened after, and the \
lesson. Ask one follow-up at a time until you have those. Three or four exchanges per story is about right.
- When a story has enough, save it with save_story, written in the student's own first-person spoken voice and \
concise: situation and task in two or three sentences; action as the longest part (what they did, how, who else was \
involved); result quantified, then the lesson in one sentence. Tag every bucket it can honestly answer, and whether \
it went well or went wrong. Then tell the student in one or two sentences that it's saved and which kinds of \
questions it answers, and move to the next story. Don't read the whole story back unless they ask.
- Aim for coverage: six to eight stories, a positive and a negative per bucket where you can. Keep track of which \
buckets are covered and steer the next question toward a gap. Different stories should come from different \
situations; the same job is fine.
- Never invent or embellish: every detail comes from what the student said or their resume. If they're vague, ask \
for the specific instance. If they say they don't have a story for something, move on.
- If the student talks about why they want their target groups (why consumer & retail, why M&A), save that with \
save_why_groups in their words; it feeds their cover letters.
- To change a saved story, call save_story with its story_id. remove_story takes one out.
- When the bank has six or more stories, or the student wants to stop, give a short wrap-up: which buckets are \
covered, and which gap, if any, is worth one more story. Say they can come back any time.
- The message "[start]" means the student has just opened the conversation: greet them by first name, say in two \
sentences what you'll do together, and ask your first question.
"""


@dataclass
class Deps:
    user_id: int
    steps: list = field(default_factory=list)


coach = Agent(deps_type=Deps, instructions=INSTRUCTIONS, name="story_coach")


def ensure() -> None:
    init_db()
    with connect() as conn:
        conn.executescript(SCHEMA)


def _row(r) -> dict:
    d = dict(r)
    d["buckets"] = json.loads(d["buckets"] or "[]")
    return d


def all_stories(uid: int) -> list[dict]:
    ensure()
    with connect(read_only=True) as conn:
        return [_row(r) for r in conn.execute("SELECT * FROM stories WHERE user_id = ? ORDER BY id", (uid,))]


def coverage(uid: int) -> dict:
    """{bucket: {"went well": [titles], "went wrong": [titles]}}."""
    out = {k: {p: [] for p in POLARITIES} for k in BUCKET_KEYS}
    for s in all_stories(uid):
        for b in s["buckets"]:
            if b in out:
                out[b][s["polarity"] if s["polarity"] in POLARITIES else "went well"].append(s["title"])
    return out


def overview(uid: int) -> dict:
    return {"stories": all_stories(uid), "buckets": [{"key": k, "name": n, "asks": q} for k, n, q in BUCKETS], "coverage": coverage(uid)}


def _clean(text: str, limit: int) -> str:
    return " ".join((text or "").split())[:limit]


def save(uid: int, title: str, situation: str, action: str, result: str, buckets: list[str], polarity: str, story_id: int | None = None) -> dict:
    """Add a story, or replace one (story_id). Returns {ok, id} or {ok: False, reason}."""
    ensure()
    title, situation, action, result = _clean(title, 120), _clean(situation, 1500), _clean(action, 2500), _clean(result, 1500)
    tags = [b for b in dict.fromkeys(buckets) if b in BUCKET_KEYS]
    if not title or not (situation or action or result):
        return {"ok": False, "reason": "A story needs a title and some substance."}
    polarity = polarity if polarity in POLARITIES else "went well"
    now = datetime.now().isoformat(timespec="seconds")
    with connect() as conn:
        if story_id is not None:
            n = conn.execute("""UPDATE stories SET title = ?, situation = ?, action = ?, result = ?, buckets = ?, polarity = ?, updated_at = ?
                                WHERE id = ? AND user_id = ?""", (title, situation, action, result, json.dumps(tags), polarity, now, story_id, uid)).rowcount
            if not n:
                return {"ok": False, "reason": f"No story with id {story_id}."}
            return {"ok": True, "id": story_id}
        count = conn.execute("SELECT COUNT(*) FROM stories WHERE user_id = ?", (uid,)).fetchone()[0]
        if count >= MAX_STORIES:
            return {"ok": False, "reason": f"The bank holds {MAX_STORIES} stories; remove or replace one first."}
        sid = conn.execute("""INSERT INTO stories (user_id, title, situation, action, result, buckets, polarity, created_at, updated_at)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""", (uid, title, situation, action, result, json.dumps(tags), polarity, now, now)).lastrowid
    return {"ok": True, "id": sid}


def remove(uid: int, story_id: int) -> dict:
    ensure()
    with connect() as conn:
        n = conn.execute("DELETE FROM stories WHERE id = ? AND user_id = ?", (story_id, uid)).rowcount
    return {"ok": bool(n)}


def as_text(uid: int, limit: int = 6000) -> str:
    """The bank, for the interview coach: each story with its buckets, in the student's words."""
    names = dict((k, n) for k, n, _ in BUCKETS)
    out = []
    for i, s in enumerate(all_stories(uid), 1):
        tags = ", ".join(names[b] for b in s["buckets"] if b in names)
        out.append(f"{i}. {s['title']} ({s['polarity']}{'; ' + tags if tags else ''})\n"
                   f"   Situation and task: {s['situation']}\n   Action: {s['action']}\n   Result and lesson: {s['result']}")
    return "\n\n".join(out)[:limit]


# ---------------- The coach's tools ----------------

def _done(ctx: RunContext[Deps], tool: str, result: dict) -> dict:
    ctx.deps.steps.append({"tool": tool, "result": result})
    return result


@coach.tool
def list_stories(ctx: RunContext[Deps]) -> dict:
    """The stories saved so far, with their ids, buckets and whether each went well or went wrong."""
    rows = all_stories(ctx.deps.user_id)
    return _done(ctx, "list_stories", {"stories": [{k: s[k] for k in ("id", "title", "situation", "action", "result", "buckets", "polarity")} for s in rows],
                                        "coverage": coverage(ctx.deps.user_id)})


@coach.tool
def save_story(ctx: RunContext[Deps], title: str, situation: str, action: str, result: str, buckets: list[str], polarity: str,
               story_id: int | None = None) -> dict:
    """Save a story the student told you, in their own first-person spoken voice, or replace one (story_id).

    Args:
        title: A short name they'll recognise it by, e.g. "The Indigo pricing model" (at most 8 words).
        situation: Situation and task: where, when, the goal and why it mattered. Two or three sentences.
        action: What they personally did, how, and who else was involved. The longest part.
        result: The outcome with numbers ($, %, time, people), then the lesson in one sentence.
        buckets: Every bucket it can honestly answer, from: ownership, judgment, rigor, pressure, backbone, client, leadership, learning.
        polarity: "went well" or "went wrong" (a stumble with a lesson).
        story_id: The id of a saved story to replace; leave empty to add a new one.
    """
    out = save(ctx.deps.user_id, title, situation, action, result, buckets, polarity, story_id)
    if out.get("ok"):
        out["did"] = f"{'Updated' if story_id else 'Saved'} the story \"{_clean(title, 120)}\""
    return _done(ctx, "save_story", out)


@coach.tool
def remove_story(ctx: RunContext[Deps], story_id: int) -> dict:
    """Take a story out of the bank (the student asked for it to go)."""
    out = remove(ctx.deps.user_id, story_id)
    return _done(ctx, "remove_story", out | ({"did": "Removed the story"} if out["ok"] else {"reason": "No such story."}))


@coach.tool
def save_why_groups(ctx: RunContext[Deps], text: str) -> dict:
    """Save why the student wants their target groups, in their words (one short paragraph). It feeds their cover letters."""
    text = _clean(text, 1500)
    if not text:
        return _done(ctx, "save_why_groups", {"ok": False, "reason": "Nothing to save."})
    user_profile.save(ctx.deps.user_id, {"why_group": text})
    return _done(ctx, "save_why_groups", {"ok": True, "did": "Saved why they want their groups"})


# ---------------- The conversation ----------------

async def chat(user: dict, chosen: Chosen, message: str, history: list[dict]) -> dict:
    """One turn of the story-building conversation. The student's earlier turns come from the page (history)."""
    ensure()
    uid = user["id"]
    message = message.strip()[:12_000] or "[start]"
    prof = user_profile.get(uid)
    first = (user.get("name") or "").split()[0] if user.get("name") else ""
    have = all_stories(uid)
    earlier = "\n".join(f"{'Student' if h.get('role') == 'user' else 'You'}: {str(h.get('text', ''))[:2000]}" for h in history[-14:])
    prompt = "\n\n".join(x for x in (
        f"The student's first name: {first or 'not known'}.",
        f"Their resume:\n{(prof.get('resume_text') or '').strip()[:6000] or '(no resume uploaded)'}",
        f"Their target groups: {prof.get('target_groups') or 'not set'}." + (f" Why, in their words: {prof['why_group']}" if prof.get("why_group") else ""),
        f"Stories saved so far: {len(have)} ({', '.join(s['title'] for s in have) or 'none yet'}). Call list_stories for the text.",
        f"Earlier in this conversation:\n{earlier}" if earlier else "",
        f"The student's new message:\n{message}",
    ) if x)
    deps, started = Deps(user_id=uid), datetime.now().isoformat(timespec="seconds")
    usage, outcome = None, "ok"
    try:
        result = await coach.run(prompt, model=chosen.model, model_settings=chosen.settings, deps=deps, usage_limits=LIMITS)
        reply, usage = result.output, usage_dict(result.usage)
    except UsageLimitExceeded as exc:
        outcome, reply = "limit", f"Let's pause there for a moment (this turn hit its safety cap: {exc}). Anything I said was saved is saved; send your next message to carry on."
    except Exception as exc:
        outcome, reply = "error", f"Something went wrong talking to the model ({type(exc).__name__}). Try sending that again."
    saved = [s["result"]["did"] for s in deps.steps if s["result"].get("ok") and s["result"].get("did")]
    u = usage or {}
    with connect() as conn:
        conn.execute(
            """INSERT INTO agent_runs (user_id, started_at, agent, user_message, reply, steps, outcome, requests,
                                       input_tokens, cached_input_tokens, output_tokens)
               VALUES (?, ?, 'story_coach', ?, ?, ?, ?, ?, ?, ?, ?)""",
            (uid, started, message[:4000], reply[:4000], json.dumps(deps.steps, default=str)[:20000], outcome, u.get("requests", 0),
             u.get("input_tokens", 0), u.get("cached_input_tokens", 0), u.get("output_tokens", 0)))
    return {"reply": reply, "saved": saved, "changed": bool(saved), "usage": usage, "stories": all_stories(uid), "coverage": coverage(uid)}
