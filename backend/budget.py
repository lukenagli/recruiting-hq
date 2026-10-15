"""Per-user daily token budget, so no single account (or a bug looping on one) can drain the course key."""
from datetime import date

from fastapi import HTTPException

from . import config
from .db import connect, init_db


def used_today(user_id: int) -> int:
    init_db()
    with connect(read_only=True) as conn:
        row = conn.execute(
            "SELECT COALESCE(SUM(input_tokens + output_tokens), 0) FROM agent_runs WHERE user_id = ? AND started_at >= ?",
            (user_id, date.today().isoformat()),
        ).fetchone()
    return row[0]


def check(user_id: int) -> None:
    """Stop before calling the model if this account has used its tokens for today."""
    used = used_today(user_id)
    if used >= config.DAILY_TOKEN_BUDGET:
        raise HTTPException(
            status_code=429,
            detail=f"You have used today's AI allowance ({used:,} of {config.DAILY_TOKEN_BUDGET:,} tokens). It resets at midnight.",
        )
