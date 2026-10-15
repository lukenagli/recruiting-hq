"""Copy your tracker from this computer to your account on the hosted site.

Usage:  .venv\\Scripts\\python.exe scripts\\push_to_server.py https://your-app.onrender.com [--replace]

Sign up on the hosted site first. The script asks for the email and password of the LOCAL account that owns
the tracker here and of your account on the hosted site; passwords are only sent to log in and never saved.
"""
import getpass
import json
import sys
import urllib.error
import urllib.request

LOCAL = "http://localhost:8000"


def call(base: str, path: str, body: dict | None = None, token: str = "", method: str = "POST", timeout: int = 300):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as err:
        sys.exit(f"{base}{path} failed: HTTP {err.code} {err.read().decode()[:300]}")


def log_in(base: str, label: str) -> str:
    email = input(f"{label} email: ")
    password = getpass.getpass(f"{label} password: ")
    return call(base, "/api/login", {"email": email, "password": password})["token"]


if len(sys.argv) < 2:
    sys.exit(__doc__)
site = sys.argv[1].rstrip("/")
print("Make sure the app is running on this computer (start_app.cmd).")
local_token = log_in(LOCAL, "This computer's")
export = call(LOCAL, "/api/export", token=local_token, method="GET")
print(f"Exported {len(export.get('people', []))} people and {len(export.get('deals', []))} deals.")
print("Waking the hosted site; this can take a minute...")
site_token = log_in(site, "Hosted site")
print(call(site, "/api/import" + ("?replace=true" if "--replace" in sys.argv else ""), export, site_token))
