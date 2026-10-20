"""Copy your tracker from this computer's database to your account on the hosted site.

Usage:  .venv\\Scripts\\python.exe scripts\\push_to_server.py https://your-app.onrender.com [--replace] [--user-id 1]

Sign up on the hosted site first. The script reads this computer's database directly (data/app.db, account
--user-id, default 1), then asks for the email and password of your account on the hosted site. The password is
only sent to log in there and is never saved. --replace overwrites a tracker that already exists on the site.
"""
import getpass
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend import transfer  # noqa: E402


def call(base: str, path: str, body: dict | None = None, token: str = "", timeout: int = 600):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None,
                                     headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as err:
        sys.exit(f"{base}{path} failed: HTTP {err.code} {err.read().decode()[:300]}")


if len(sys.argv) < 2 or not sys.argv[1].startswith("http"):
    sys.exit(__doc__)
site = sys.argv[1].rstrip("/")
uid = int(sys.argv[sys.argv.index("--user-id") + 1]) if "--user-id" in sys.argv else 1

export = transfer.export_all(uid, include_shared=True)
print(f"Read from this computer: {len(export['people'])} people, {len(export['interactions'])} chats and events, "
      f"{len(export['deals'])} deals, {len(export['cover_letters'])} cover letters, {len(export['questions'])} bank questions.")
email = input("Your email on the hosted site: ").strip()
password = getpass.getpass("Your password on the hosted site (typing is hidden): ")
token = call(site, "/api/login", {"email": email, "password": password})["token"]
print("Copying (this can take a minute)...")
result = call(site, "/api/import" + ("?replace=true" if "--replace" in sys.argv else ""), export, token)
if not result.get("ok"):
    sys.exit(f"Not copied: {result.get('reason')}")
print("Done. Copied:", ", ".join(f"{v} {k.replace('_', ' ')}" for k, v in result["imported"].items()))
if result.get("shared_totals"):
    print("Shared on the site now:", ", ".join(f"{v} {k.replace('_', ' ')}" for k, v in result["shared_totals"].items()))
print("Refresh the site to see it. If you used your own AI key here, add it again in Settings (keys are not copied).")
