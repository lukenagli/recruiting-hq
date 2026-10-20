"""Load the answer library on the hosted site from study material on this computer.

Usage:  .venv\\Scripts\\python.exe scripts\\push_reference.py https://your-app.onrender.com

- Shared with every account: the Finance Club decks (Recruiting Files/Finance Club Meetings) and the question
  bank's own answer notes.
- Private to your account only: your Breaking Into Wall Street guides (a paid personal license, so never shared)
  and your own interview answers.
Only the extracted text is sent; the files stay on this computer. Run it again any time a file changes.
Needs an admin account on the site. Asks for your email and password there (never saved).
"""
import getpass
import io
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from backend.reference import chunk_pages  # noqa: E402

# Your own Recruiting folder in OneDrive is the source of truth (numbered folders like "3. Finance Club Meetings");
# the project's "Recruiting Files" copy is only used if that folder is not on this computer.
ONEDRIVE = Path.home() / "OneDrive - Yale University" / "Recruiting"
FILES = ONEDRIVE if ONEDRIVE.is_dir() else ROOT / "Recruiting Files"


def folder(name: str) -> Path | None:
    """The subfolder whose name ends with `name`, with or without a number in front."""
    return next((d for d in sorted(FILES.iterdir()) if d.is_dir() and d.name.endswith(name)), None)


def pdf_pages(path: Path) -> list[str]:
    from pypdf import PdfReader

    return [(p.extract_text() or "") for p in PdfReader(str(path)).pages]


def docx_pages(path: Path) -> list[str]:
    import docx

    text = "\n".join(p.text for p in docx.Document(str(path)).paragraphs)
    return [text[i:i + 3000] for i in range(0, len(text), 3000)] or [""]


def read(path: Path) -> list[str] | None:
    """The file's page texts, or None (with a note) if it cannot be read, e.g. still syncing or damaged."""
    try:
        return pdf_pages(path) if path.suffix.lower() == ".pdf" else docx_pages(path)
    except Exception as exc:
        print(f"  skipped {path.name}: could not read it ({type(exc).__name__}). Open it once in Word or Acrobat to check it.")
        return None


def sources() -> list[tuple[str, bool, list[dict]]]:
    out = []
    club, biws, banks = folder("Finance Club Meetings"), folder("Breaking into Wall Street Guides"), folder("Interview Question Banks")
    for f in sorted(club.glob("*.pdf")) if club else []:
        name = re.sub(r"\s*-\s*\d{2}\.\d{2}", "", f.stem)
        if (pages := read(f)) is not None:
            out.append((f"Finance Club: {name}", False, chunk_pages(pages)))
    for f in sorted(biws.glob("*.pdf")) if biws else []:
        if (pages := read(f)) is not None:
            out.append((f"BIWS {f.stem} guide", True, chunk_pages(pages)))
    # Your interview answers: the OneDrive copy first, then the project's copy if that one cannot be read.
    for answers in [banks / "Interview Answers.docx" if banks else None, ROOT / "Recruiting Files" / "Interview Question Banks" / "Interview Answers.docx"]:
        if answers and answers.exists() and (pages := read(answers)) is not None:
            out.append(("My interview answers", True, chunk_pages(pages)))
            break
    return out


def call(base: str, path: str, body: dict | None, token: str = ""):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(base + path, data=json.dumps(body or {}).encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            return json.load(r)
    except urllib.error.HTTPError as err:
        sys.exit(f"{path} failed: HTTP {err.code} {err.read().decode()[:300]}")


if len(sys.argv) < 2 or not sys.argv[1].startswith("http"):
    sys.exit(__doc__)
site = sys.argv[1].rstrip("/")
print(f"Reading study material in {FILES} ...")
found = sources()
for name, private, passages in found:
    print(f"  {name}: {len(passages)} passages ({'private to you' if private else 'shared with the club'})")
email = input("Your email on the site: ").strip()
password = getpass.getpass("Your password on the site (typing is hidden): ")
token = call(site, "/api/login", {"email": email, "password": password})["token"]
for name, private, passages in found:
    out = call(site, "/api/admin/reference", {"source": name, "passages": passages, "private": private}, token)
    print(f"  loaded {name}: {out['passages']} passages")
out = call(site, "/api/admin/reference/question-bank", {}, token)
print(f"  indexed the question bank's answers: {out['passages']} answers")
print("Done. The practice page now explains answers from this library.")
