"""Catching up a student who has already been recruiting: one bank at a time, filled in as a short form.

The form is turned into a plain-language note and filed by the tracker assistant, so it follows the same rules
as anything typed into the update box (matching people already in the tracker, alums, thank-you notes, steps).
"""
import csv
import io
import re
from datetime import date, datetime

from pydantic import BaseModel, Field

from . import banks as bank_info
from . import normalize


class PastPerson(BaseModel):
    name: str
    title: str = ""
    group: str = ""
    yale: str = ""          # yes | no | student | "" (not sure)
    where: str = ""         # Coffee chat (Zoom / Phone / In person) or the name of an event
    date: str = ""          # YYYY-MM-DD, or "" when not remembered
    talked_about: str = ""
    thank_you_sent: bool = True


class BankCatchUp(BaseModel):
    bank: str
    people: list[PastPerson] = Field(default_factory=list)
    emails: str = ""        # pasted emails with this bank, if any
    applied: str = ""       # yes | no | ""
    notes: str = ""
    sheet_rows: str = ""    # this bank's rows from the student's own networking spreadsheet, header first


def message(req: BankCatchUp, school: str = "Yale", peer: str = "2Y") -> str:
    """The note the assistant files. Only what the student entered; blank fields are left out."""
    lines = [f"I'm catching up my tracker on {req.bank}: these already happened before I started using it. "
             "Log each person and each conversation below. Do not draft any emails."]
    for p in req.people:
        if not p.name.strip():
            continue
        who = p.name.strip()
        about = [x for x in (p.title.strip(), p.group.strip() and f"{p.group.strip()} group") if x]
        if about:
            who += f" ({', '.join(about)})"
        # The form's answers are exact, so name the field each one goes in.
        yale = {"yes": f' They are a {school} alum (save_person yale="yes").', "no": f' They are not a {school} alum (yale="no").',
                "student": f' They are a current {school} {peer} (yale="student").'}.get(p.yale, "")
        where = p.where.strip() or "Coffee chat"
        when = f" on {p.date}" if p.date else " (date not remembered: leave the date blank)"
        if where.lower().startswith("coffee chat"):
            line = f"- {where}{when} with {who}.{yale}"
        else:
            line = f"- Met {who} at {where}{when}.{yale}"
        if p.talked_about.strip():
            line += f" What we talked about: {p.talked_about.strip().rstrip('.')}."
        line += ' Thank-you note already sent (thank_you="sent").' if p.thank_you_sent else " I still owe them a thank-you note (leave thank_you blank)."
        lines.append(line)
    if req.applied == "yes":
        lines.append(f"I have already applied to {req.bank}.")
    elif req.applied == "no":
        lines.append(f"I have not applied to {req.bank} yet.")
    if req.notes.strip():
        lines.append(f"Other notes: {req.notes.strip()}")
    if req.sheet_rows.strip():
        lines.append(f"Rows for {req.bank} from my networking spreadsheet (the header row first). Each row is someone I reached "
                     "out to or spoke with. Log each person, and a coffee chat for each row with a chat date (done if the date has "
                     "passed). A thank-you date or 'yes' in a thank-you column means it was sent; when the sheet has no thank-you "
                     f"column, treat thank-yous as sent. Do not log a chat for a row with no chat date.\n{req.sheet_rows.strip()}")
    if req.emails.strip():
        lines.append(f"Emails with {req.bank} (file what they tell you):\n{req.emails.strip()}")
    return "\n".join(lines)


class SheetError(Exception):
    """A message that is safe to show the person who uploaded the spreadsheet."""


BANK_COLUMN = re.compile(r"\b(bank|company|firm|employer)\b", re.I)


def _cell(v) -> str:
    if isinstance(v, (datetime, date)):
        return v.strftime("%Y-%m-%d")
    return " ".join(str(v).split()) if v is not None else ""


def _bank_name(value: str) -> str:
    """The app's own spelling of a bank ("bofa" and "Bank of America" are one bank)."""
    name = normalize.bank(value)
    if name == normalize.UNKNOWN:
        return ""
    return next((b for b in bank_info.DOMAINS if b.lower() == name.lower()), name)


def _rows(filename: str, data: bytes) -> list[list[str]]:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext == "csv":
        return [[_cell(c) for c in r] for r in csv.reader(io.StringIO(data.decode("utf-8-sig", errors="replace")))]
    if ext in ("xlsx", "xlsm"):
        import openpyxl

        book = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        out = []
        for sheet in book.worksheets:  # every tab, in order (some students keep one tab per bank)
            rows = [[_cell(c) for c in r] for r in sheet.iter_rows(values_only=True)]
            out.extend(r for r in rows if any(r))
        return out
    raise SheetError("Upload the spreadsheet as .xlsx or .csv.")


def split_sheet(filename: str, data: bytes) -> list[dict]:
    """A networking spreadsheet split into one block of rows per bank: [{bank, count, rows}]."""
    if len(data) > 5_000_000:
        raise SheetError("That spreadsheet is over 5 MB.")
    try:
        rows = _rows(filename, data)
    except SheetError:
        raise
    except Exception:
        raise SheetError("Couldn't read that spreadsheet. Save it again as .xlsx or .csv.")
    header_at = next((i for i, r in enumerate(rows) if sum(bool(c) for c in r) >= 3 and any(BANK_COLUMN.search(c) for c in r)), None)
    if header_at is None:
        raise SheetError("Couldn't find a Bank or Company column. Add one, then upload it again.")
    header = rows[header_at]
    col = next(i for i, c in enumerate(header) if BANK_COLUMN.search(c))
    groups: dict[str, list[list[str]]] = {}
    for r in rows[header_at + 1:]:
        if r == header:  # the same header repeated on another tab
            continue
        bank = _bank_name(r[col]) if col < len(r) else ""
        if bank and any(c for i, c in enumerate(r) if i != col):
            groups.setdefault(bank, []).append(r)
    keep = [i for i in range(len(header)) if header[i] or any(i < len(r) and r[i] for g in groups.values() for r in g)]
    line = lambda r: " | ".join(r[i] if i < len(r) else "" for i in keep)
    return [{"bank": bank, "count": len(g), "rows": "\n".join([line(header)] + [line(r) for r in g])[:20_000]}
            for bank, g in sorted(groups.items(), key=lambda kv: -len(kv[1]))]
