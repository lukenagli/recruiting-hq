"""One-time tidying run when the hosted site starts (deploy/run.sh). Safe to run every time: it only removes what
is still there.

- The graders' demo account (demo@recruiting-hq.demo) and everything in it: it was only for grading.
- The settings that went with the preview (the early-access list) and the demo's sample version.
"""
from .db import connect, init_db
from .test_scan import _wipe

DEMO_EMAIL = "demo@recruiting-hq.demo"


def main() -> None:
    init_db()
    with connect() as conn:
        row = conn.execute("SELECT id FROM users WHERE LOWER(email) = ?", (DEMO_EMAIL,)).fetchone()
        if row:
            _wipe(conn, row["id"])
            print(f"Removed the demo account (user {row['id']}) and its tracker.")
        conn.execute("DELETE FROM app_settings WHERE key IN ('early_access', 'demo_sample_version')")


if __name__ == "__main__":
    main()
