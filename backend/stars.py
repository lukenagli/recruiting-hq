"""The user's STAR stories: how they want to answer the common "Tell me about a time..." questions.

Each story has Situation, Task, Action, Result and Reflection, written however the user likes (full sentences or
bullet notes). Practice uses them to grade behavioral answers and to build model answers from the user's own
experience.
"""
from datetime import datetime

from .db import connect, init_db

PROMPTS = [
    ("teamwork", "Tell me about a time you worked on a team."),
    ("leadership", "Tell me about a time you led a group or took charge."),
    ("conflict", "Tell me about a time you disagreed with a teammate or manager."),
    ("failure", "Tell me about a time you failed or made a mistake."),
    ("pressure", "Tell me about a time you worked under a tight deadline or pressure."),
    ("proud", "What accomplishment are you most proud of?"),
    ("initiative", "Tell me about a time you took initiative beyond your role."),
    ("difficult", "Tell me about a time you dealt with a difficult client or colleague."),
    ("analytical", "Tell me about a time you solved a hard analytical problem."),
    ("persuade", "Tell me about a time you persuaded someone to change their mind."),
]
PARTS = ("situation", "task", "action", "result", "reflection")
SCHEMA = """
CREATE TABLE IF NOT EXISTS star_stories (
    user_id     INTEGER NOT NULL,
    prompt      TEXT NOT NULL,
    situation   TEXT DEFAULT '',
    task        TEXT DEFAULT '',
    action      TEXT DEFAULT '',
    result      TEXT DEFAULT '',
    reflection  TEXT DEFAULT '',
    updated_at  TEXT DEFAULT '',
    PRIMARY KEY (user_id, prompt)
);
"""


def ensure() -> None:
    init_db()
    with connect() as conn:
        conn.executescript(SCHEMA)


def all_stories(uid: int) -> list[dict]:
    ensure()
    with connect(read_only=True) as conn:
        saved = {r["prompt"]: dict(r) for r in conn.execute("SELECT * FROM star_stories WHERE user_id = ?", (uid,))}
    return [{"key": k, "prompt": text, **{p: (saved.get(k) or {}).get(p) or "" for p in PARTS},
             "updated_at": (saved.get(k) or {}).get("updated_at") or ""} for k, text in PROMPTS]


def save(uid: int, key: str, fields: dict) -> dict | None:
    if key not in dict(PROMPTS):
        return None
    clean = {p: str(fields.get(p, "")).strip()[:3000] for p in PARTS}
    ensure()
    with connect() as conn:
        conn.execute(
            f"""INSERT INTO star_stories (user_id, prompt, {', '.join(PARTS)}, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, prompt) DO UPDATE SET {', '.join(f'{p} = excluded.{p}' for p in PARTS)}, updated_at = excluded.updated_at""",
            (uid, key, *(clean[p] for p in PARTS), datetime.now().isoformat(timespec="seconds")))
    return next(s for s in all_stories(uid) if s["key"] == key)


def as_text(uid: int) -> str:
    """The stories the user has written, for the interview coach."""
    out = []
    for s in all_stories(uid):
        filled = [(p, s[p]) for p in PARTS if s[p]]
        if filled:
            out.append(f"{s['prompt']}\n" + "\n".join(f"  {p.title()}: {t}" for p, t in filled))
    return "\n\n".join(out)[:6000]
