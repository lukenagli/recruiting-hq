"""Per-user daily token budget, so no single account (or a bug looping on one) can drain the course key.

The reader filing email is counted apart: it has no daily allowance, only FILING_TOKEN_GUARD against a bug,
and what it uses doesn't count against the rest of the site's allowance.
"""
from datetime import date

from fastapi import HTTPException

from . import config
from .db import connect, init_db

FILING = "(user_message LIKE 'New messages from %' OR agent = 'fact_tidier')"


def used_today(user_id: int, filing: bool | None = None) -> int:
    """Tokens used today: everything (None), only the reader's filing (True), or everything else (False)."""
    init_db()
    which = "" if filing is None else f" AND {FILING}" if filing else f" AND NOT {FILING}"
    with connect(read_only=True) as conn:
        row = conn.execute(
            f"SELECT COALESCE(SUM(input_tokens + output_tokens), 0) FROM agent_runs WHERE user_id = ? AND started_at >= ?{which}",
            (user_id, date.today().isoformat()),
        ).fetchone()
    return row[0]


def allowance(user_id: int) -> int:
    return config.DAILY_TOKEN_BUDGET


def used_for_allowance(user_id: int) -> int:
    """What counts against the daily allowance: everything but the reader's filing."""
    return used_today(user_id, filing=False)


def check(user_id: int) -> None:
    """Stop before calling the model if this account has used its tokens for today."""
    used, cap = used_for_allowance(user_id), allowance(user_id)
    if used >= cap:
        raise HTTPException(
            status_code=429,
            detail=f"You have used today's AI allowance ({used:,} of {cap:,} tokens). It resets at midnight.",
        )


def filing_stuck(user_id: int) -> bool:
    """The reader's guard: only true if filing today has gone far past anything a real scan needs (a bug looping)."""
    return used_today(user_id, filing=True) >= config.FILING_TOKEN_GUARD


def check_filing(user_id: int) -> None:
    if filing_stuck(user_id):
        raise HTTPException(status_code=429, detail="Filing stopped for today: far more email than any scan needs was filed, "
                                                    "which looks like a fault. It carries on tomorrow.")
