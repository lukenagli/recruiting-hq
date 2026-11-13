"""Open every page's data as each kind of account and fail if anything errors.

Run:  .venv\\Scripts\\python.exe scripts/smoke_test.py

Works on a fresh database in a temporary folder (never data/app.db), with the AI key unset and the network blocked, so
it costs nothing and reads nothing private. The accounts: a new student with an empty tracker, a student with the
sample tracker (backend/sample_tracker.py), and the admin. Every GET route without a
path parameter is opened as each of them, then each bank's page and cover letter, and the Word download. A route
answering 500, or trying to reach the network, fails the run.
"""
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
folder = tempfile.mkdtemp(prefix="rhq-smoke-")
os.environ["APP_DB_PATH"] = str(Path(folder) / "app.db")
os.environ["PORTKEY_API_KEY"] = ""  # no AI
for name in ("RESEND_API_KEY", "SMTP_HOST", "MAIL_FROM"):  # no email
    os.environ.pop(name, None)

import socket  # noqa: E402

import httpx2  # noqa: E402  (the backend's HTTP client)


class NoNetwork(RuntimeError):
    pass


def _blocked(*_args, **_kwargs):
    raise NoNetwork("tried to reach the network")


# The real network, blocked where connections are made (the test client talks to the app in-process, not over it).
httpx2.HTTPTransport.handle_request = _blocked
httpx2.AsyncHTTPTransport.handle_async_request = _blocked
socket.create_connection = _blocked

from fastapi.testclient import TestClient  # noqa: E402

from backend import accounts, sample_tracker  # noqa: E402
from backend.db import connect, init_db  # noqa: E402
from backend.main import app  # noqa: E402

# Routes that call the AI or another site even when only opened, or only make sense with a running reader.
SKIP = {"/api/admin/model-check", "/api/deals/{deal_id}/announced", "/api/capiq/jobs"}


def account(email: str, name: str, *, admin: bool = False, sample: bool = False) -> tuple[int, str]:
    with connect() as conn:
        uid = conn.execute("INSERT INTO users (email, name, password_hash, is_admin, created_at, email_verified_at) "
                           "VALUES (?, ?, 'x', ?, '2026-09-01T00:00:00', '2026-09-01T00:00:00')", (email, name, int(admin))).lastrowid
        conn.execute("INSERT OR IGNORE INTO user_profiles (user_id, school, level, onboarded_at) VALUES (?, 'Yale SOM', 'mba', '2026-09-01')", (uid,))
        if sample:
            sample_tracker._fill(conn, uid)
        return uid, accounts._new_session(conn, uid)


def main() -> int:
    init_db()
    sample_tracker.stars.ensure()
    users = {
        "student": account("student@yale.edu", "Sam Student"),
        "sample": account("jane.doe@yale.edu", "Jane Doe", sample=True),
        "admin": account("admin@yale.edu", "Ada Admin", admin=True, sample=True),
    }
    sample_tracker.fill_profile(users["sample"][0])
    gets = sorted({r.path for r in app.routes if "GET" in getattr(r, "methods", set()) and r.path.startswith("/api")} - SKIP)
    client = TestClient(app, raise_server_exceptions=False)
    problems, opened = [], 0

    def check(who: str, token: str, path: str, allowed=(200, 204, 302, 303, 400, 403, 404, 409)) -> None:
        nonlocal opened
        opened += 1
        try:
            r = client.get(path, headers={"Authorization": f"Bearer {token}"})
        except NoNetwork:
            problems.append(f"{who} {path}: tried to reach the network")
            return
        if r.status_code not in allowed:
            problems.append(f"{who} {path}: {r.status_code} {r.text[:200]}")

    for who, (uid, token) in users.items():
        for path in gets:
            if "{" in path:
                continue
            if path.startswith("/api/admin") and who != "admin":
                check(who, token, path, allowed=(403,))  # admin pages stay closed to everyone else
                continue
            check(who, token, path)
        with connect(read_only=True) as conn:
            banks = [r["bank"] for r in conn.execute("SELECT bank FROM my_banks WHERE user_id = ?", (uid,))]
        for bank in banks:
            for path in (f"/api/banks/{bank}", f"/api/cover-letters/{bank}", f"/api/cover-letters/{bank}/docx"):
                check(who, token, path)
        # Interview Prep's next question (no AI): every round, and every difficulty
        for stage, level in (("", "adaptive"), ("", "hard"), ("", "easy,hard"), ("Coffee Chat", "easy"), ("Superday", "adaptive")):
            opened += 1
            r = client.post("/api/practice/next", headers={"Authorization": f"Bearer {token}"},
                            json={"categories": ["Technical", "Behavioral"], "stage": stage, "difficulty": level, "bank": "Any", "guides": []})
            if r.status_code != 200:
                problems.append(f"{who} POST /api/practice/next ({stage or 'any round'}, {level}): {r.status_code} {r.text[:200]}")
    # Signed out: the data routes refuse, the public ones answer.
    for path in ("/api/home", "/api/banks", "/api/profile"):
        r = client.get(path)
        if r.status_code != 401:
            problems.append(f"signed out {path}: {r.status_code} (expected 401)")
    for path in ("/api/health", "/api/session", "/privacy", "/terms"):
        if client.get(path).status_code != 200:
            problems.append(f"signed out {path}: not 200")
    if problems:
        print(f"Smoke test FAILED ({len(problems)} of {opened} requests):\n  " + "\n  ".join(problems))
        return 1
    print(f"Smoke test passed: {opened} requests across {len(users)} accounts ({', '.join(users)}), "
          f"{len(gets)} GET routes, no errors and no network.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
