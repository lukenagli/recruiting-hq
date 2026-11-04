"""Per-user daily token budget, so no single account (or a bug looping on one) can drain the course key."""
import sqlite3
from datetime import date, timedelta

from fastapi import HTTPException

from . import config
from .db import connect, init_db

CATCH_UP_DAYS = 2


def used_today(user_id: int) -> int:
    init_db()
    with connect(read_only=True) as conn:
        row = conn.execute(
            "SELECT COALESCE(SUM(input_tokens + output_tokens), 0) FROM agent_runs WHERE user_id = ? AND started_at >= ?",
            (user_id, date.today().isoformat()),
        ).fetchone()
    return row[0]


def allowance(user_id: int) -> int:
    """Today's allowance: DAILY_TOKEN_BUDGET, or (preview) CATCH_UP_TOKEN_BUDGET on the first two days an account's
    reader refreshes, when its first scan reads everything since September in one go."""
    from . import accounts

    init_db()
    with connect(read_only=True) as conn:
        try:
            first = conn.execute("SELECT MIN(at) FROM sync_log WHERE user_id = ?", (user_id,)).fetchone()[0]
        except sqlite3.OperationalError:  # no refresh has run on this site yet
            first = None
    if first and first[:10] >= (date.today() - timedelta(days=CATCH_UP_DAYS - 1)).isoformat() and accounts.in_preview_uid(user_id):
        return max(config.DAILY_TOKEN_BUDGET, config.CATCH_UP_TOKEN_BUDGET)
    return config.DAILY_TOKEN_BUDGET


def check(user_id: int) -> None:
    """Stop before calling the model if this account has used its tokens for today."""
    used, cap = used_today(user_id), allowance(user_id)
    if used >= cap:
        raise HTTPException(
            status_code=429,
            detail=f"You have used today's AI allowance ({used:,} of {cap:,} tokens). It resets at midnight.",
        )
