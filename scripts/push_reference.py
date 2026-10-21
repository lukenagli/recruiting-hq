"""Load the answer library on the hosted site from study material on this computer.

Usage:  .venv\\Scripts\\python.exe scripts\\push_reference.py https://your-app.onrender.com

- Shared with every account: the Finance Club decks (Recruiting Files/Finance Club Meetings) and the question
  bank's own answer notes.
- Private to your account only: your Breaking Into Wall Street guides (a paid personal license, so never shared)
  and your own interview answers, uploaded the same way as Settings > Study guides, so their numbered questions
  join your practice. (Anyone else adds their own guides in Settings.)
Shared decks are sent as extracted text; your private guides are sent to your account and only their text is
kept. Run it again any time a file changes.
Needs an admin account on the site. Asks for your email and password there (never saved).
"""
import getpass
import io
import json
import re
import sys
import urllib.error
import urllib.parse
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


def club_sources() -> list[tuple[str, list[dict]]]:
    out = []
    club = folder("Finance Club Meetings")
    for f in sorted(club.glob("*.pdf")) if club else []:
        name = re.sub(r"\s*-\s*\d{2}\.\d{2}", "", f.stem)
        if (pages := read(f)) is not None:
            out.append((f"Finance Club: {name}", chunk_pages(pages)))
    return out


def private_files() -> list[Path]:
    """Your own guides: the BIWS PDFs and your interview answers (OneDrive copy, else the project's copy)."""
    biws, banks = folder("Breaking into Wall Street Guides"), folder("Interview Question Banks")
    files = sorted(biws.glob("*.pdf")) if biws else []
    for answers in [banks / "Interview Answers.docx" if banks else None, ROOT / "Recruiting Files" / "Interview Question Banks" / "Interview Answers.docx"]:
        if answers and answers.exists() and read(answers) is not None:
            files.append(answers)
            break
    return files


def call(base: str, path: str, body: dict | None, token: str = "", method: str = "POST", raw: bytes | None = None, ctype: str = ""):
    headers = {"Content-Type": ctype or "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = raw if raw is not None else (json.dumps(body or {}).encode() if method == "POST" else None)
    req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            return json.load(r)
    except urllib.error.HTTPError as err:
        sys.exit(f"{path} failed: HTTP {err.code} {err.read().decode()[:300]}")


def upload_file(site: str, token: str, path: Path) -> dict:
    import uuid

    boundary = uuid.uuid4().hex
    crlf = chr(13) + chr(10)
    head = (f"--{boundary}{crlf}Content-Disposition: form-data; name=\"file\"; filename=\"{path.name}\"{crlf}"
            f"Content-Type: application/octet-stream{crlf}{crlf}")
    body = head.encode() + path.read_bytes() + f"{crlf}--{boundary}--{crlf}".encode()
    return call(site, "/api/library/guides", None, token, raw=body, ctype=f"multipart/form-data; boundary={boundary}")


if len(sys.argv) < 2 or not sys.argv[1].startswith("http"):
    sys.exit(__doc__)
site = sys.argv[1].rstrip("/")
print(f"Reading study material in {FILES} ...")
club = club_sources()
mine = private_files()
for name, passages in club:
    print(f"  {name}: {len(passages)} passages (shared with the club)")
for f in mine:
    print(f"  {f.name} (private to you)")
email = input("Your email on the site: ").strip()
password = getpass.getpass("Your password on the site (typing is hidden): ")
token = call(site, "/api/login", {"email": email, "password": password})["token"]
for name, passages in club:
    out = call(site, "/api/admin/reference", {"source": name, "passages": passages, "private": False}, token)
    print(f"  loaded {name}: {out['passages']} passages")
# earlier versions of this script loaded your guides as passages only, under these names; replace them
for legacy in [f"BIWS {f.stem} guide" for f in mine] + ["My interview answers"]:
    call(site, "/api/library/guides?source=" + urllib.parse.quote(legacy), None, token, method="DELETE")
for f in mine:
    out = upload_file(site, token, f)
    print(f"  added {out['source']}: {out['questions']} practice questions, {out['passages']} passages (private)")
out = call(site, "/api/admin/reference/question-bank", {}, token)
print(f"  indexed the question bank's answers: {out['passages']} answers")
print("Done. See Settings > Study guides on the site.")
