"""Preview: the reader hands what it read to Recruiting HQ, which files it in the background.

Reading Outlook needs a Chrome window on screen; filing it needs only the model. So the reader reads every folder, hands
each batch over here at once and closes its window, and the student can close the laptop while the site files it.

Each account's jobs run one at a time, oldest first (two filings never change one tracker at once), so the calendar,
queued after the email, is filed after it, and the folders record after both. Several accounts are filed side by side.
Jobs are kept in the database: a deploy or restart picks up where it stopped (emails already filed are never sent to
the model twice, see sync.ingest_many).
"""
import asyncio
import json
import logging
from datetime import datetime

from . import budget, llm, sync
from .db import connect, init_db

log = logging.getLogger(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS filing_jobs (
    id        INTEGER PRIMARY KEY,
    user_id   INTEGER NOT NULL,
    refresh   TEXT NOT NULL,
    kind      TEXT NOT NULL,            -- mail | calendar | folders | finish
    payload   TEXT NOT NULL,
    state     TEXT NOT NULL DEFAULT 'waiting',  -- waiting | running | done | failed
    added_at  TEXT NOT NULL,
    done_at   TEXT NOT NULL DEFAULT '',
    result    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS filing_jobs_user ON filing_jobs (user_id, state, id);
"""
KINDS = ("mail", "calendar", "folders", "finish")
SIDE_BY_SIDE = 4  # accounts filed at once


def ensure() -> None:
    init_db()
    with connect() as conn:
        conn.executescript(SCHEMA)


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def add(user: dict, refresh: str, kind: str, payload: dict) -> dict:
    """Queue one job for the reader's target account (the test tracker during a test scan)."""
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {KINDS}")
    ensure()
    owner = user.get("test_of")
    body = {**payload, "model_uid": owner["id"] if owner else user["id"]}
    with connect() as conn:
        jid = conn.execute("INSERT INTO filing_jobs (user_id, refresh, kind, payload, added_at) VALUES (?, ?, ?, ?, ?)",
                           (user["id"], refresh[:40], kind, json.dumps(body), _now())).lastrowid
    _poke()
    return {"ok": True, "job": jid}


def status(uid: int) -> dict:
    """How far the latest refresh's filing has got."""
    ensure()
    with connect(read_only=True) as conn:
        last = conn.execute("SELECT refresh FROM filing_jobs WHERE user_id = ? ORDER BY id DESC LIMIT 1", (uid,)).fetchone()
        if not last:
            return {"refresh": "", "waiting": 0, "running": 0, "done": 0, "failed": 0, "busy": False}
        counts = {r["state"]: r["n"] for r in conn.execute(
            "SELECT state, COUNT(*) AS n FROM filing_jobs WHERE user_id = ? AND refresh = ? AND kind != 'folders' GROUP BY state",
            (uid, last["refresh"]))}
        pending = conn.execute("SELECT COUNT(*) FROM filing_jobs WHERE user_id = ? AND state IN ('waiting', 'running')", (uid,)).fetchone()[0]
    return {"refresh": last["refresh"], **{s: counts.get(s, 0) for s in ("waiting", "running", "done", "failed")}, "busy": pending > 0}


def _user(conn, uid: int) -> dict | None:
    row = conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    return dict(row) if row else None


def _claim(uid: int):
    """The account's oldest waiting job, marked running (or None)."""
    with connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM filing_jobs WHERE user_id = ? AND state = 'waiting' ORDER BY id LIMIT 1", (uid,)).fetchone()
        if row:
            conn.execute("UPDATE filing_jobs SET state = 'running' WHERE id = ?", (row["id"],))
        conn.commit()
    return dict(row) if row else None


def _finish(jid: int, state: str, result: dict) -> None:
    with connect() as conn:
        conn.execute("UPDATE filing_jobs SET state = ?, done_at = ?, result = ? WHERE id = ?", (state, _now(), json.dumps(result)[:20000], jid))


def _unfiled(uid: int, refresh: str) -> set[str]:
    """Folders of this refresh whose mail didn't all get filed: they don't count as looked through."""
    out = set()
    with connect(read_only=True) as conn:
        for r in conn.execute("SELECT payload, state, result FROM filing_jobs WHERE user_id = ? AND refresh = ? AND kind = 'mail'", (uid, refresh)):
            names = [b["conversation"] for b in json.loads(r["payload"]).get("batches", [])]
            if r["state"] != "done":
                out |= set(names)
                continue
            results = json.loads(r["result"] or "{}").get("results") or []
            for name, res in zip(names, results):
                if res and "read again on the next refresh" in (res.get("note") or ""):
                    out.add(name)
    return out


async def _run(job: dict) -> dict:
    uid, body = job["user_id"], json.loads(job["payload"])
    with connect(read_only=True) as conn:
        user = _user(conn, uid)
        owner = _user(conn, body["model_uid"]) if body["model_uid"] != uid else None
    if user is None:
        return {"skipped": "no such account"}
    if owner:
        user["test_of"] = owner
    if job["kind"] == "folders":
        read = [r for r in body.get("read", []) if r.get("name") not in _unfiled(uid, job["refresh"])]
        return sync.record_folders(uid, body.get("listed", []), read, body.get("skipped", []))
    if job["kind"] == "finish":
        from . import scan_cleanup

        return await scan_cleanup.run(user, bool(body.get("first_scan")))
    if budget.filing_stuck(uid):
        return {"stopped": "filing guard"}
    chosen = llm.model_for(owner or user)
    if job["kind"] == "mail":
        return await sync.ingest_many(user, chosen, [sync.Batch(**b) for b in body["batches"]])
    return await sync.ingest(user, chosen, sync.Batch(**body["batch"]))


async def _drain(uid: int) -> None:
    try:
        while True:
            job = await asyncio.to_thread(_claim, uid)
            if not job:
                return
            try:
                result = await _run(job)
                await asyncio.to_thread(_finish, job["id"], "done", result if isinstance(result, dict) else {"result": result})
            except Exception as err:  # noqa: BLE001 - one failed job must not stop the queue
                log.exception("filing job %s failed", job["id"])
                await asyncio.to_thread(_finish, job["id"], "failed", {"error": str(err)[:500]})
    finally:
        _busy.discard(uid)


_wake = asyncio.Event()
_busy: set[int] = set()
_loop: asyncio.AbstractEventLoop | None = None


def _poke() -> None:
    """Wake the worker now (routes run in other threads; the worker also looks every few seconds)."""
    if _loop is not None:
        _loop.call_soon_threadsafe(_wake.set)


async def worker() -> None:
    """Runs for the life of the app: files each account's queue, several accounts side by side."""
    global _loop
    _loop = asyncio.get_running_loop()
    ensure()
    with connect() as conn:  # jobs cut off by a restart are picked up again
        conn.execute("UPDATE filing_jobs SET state = 'waiting' WHERE state = 'running'")
    while True:
        try:
            with connect(read_only=True) as conn:
                waiting = [r[0] for r in conn.execute("SELECT user_id FROM filing_jobs WHERE state = 'waiting' GROUP BY user_id ORDER BY MIN(id)")]
            for uid in waiting:
                if uid not in _busy and len(_busy) < SIDE_BY_SIDE:
                    _busy.add(uid)
                    asyncio.create_task(_drain(uid))
        except Exception:  # noqa: BLE001 - keep the worker alive
            log.exception("filing worker")
        _wake.clear()
        try:
            await asyncio.wait_for(_wake.wait(), timeout=5)
        except TimeoutError:
            pass
