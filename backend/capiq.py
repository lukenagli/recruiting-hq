"""Preview: S&P Capital IQ for a deal, through the student's own Capital IQ login.

Capital IQ only opens on the Yale network for a signed-in student, so the site never reaches it itself. The
student pastes the deal's CapIQ transaction link (or the reader finds it), confirms they are on Yale Wi-Fi and signed
in, and the Recruiting HQ Reader fetches the transaction summary and its "Transaction Quick Comps" page from their
Chrome and sends the pages here. This module then:
- saves the transaction summary as a PDF among the deal's documents, linked back to the CapIQ page;
- fills the pitch points CapIQ is the best source for (enterprise value, multiples, premiums, advisors, status,
  precedent transactions), replacing what the filings or a web search gave, since CapIQ's figures are standardised.
"""
import html as html_lib
import io
import re
import statistics
from datetime import datetime
from html.parser import HTMLParser

from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from . import deal_docs
from .db import connect, init_db

KIND = deal_docs.CAPIQ_KIND
LINK = re.compile(r"https://(www\.)?capitaliq\.com/CIQDotNet/Transactions/transactionDetail\.aspx\?[^\s\"']*transactionId=(\d+)", re.I)
SECTIONS = {"Deal Summary", "Sell-side Participants", "Buy-side Participants", "Deal Values", "Synopsis", "Advisors",
            "Transaction Details", "Consideration Summary", "Transaction Values", "Target Stock Information 1 Day Before Announcement",
            "Buyer Stock Information 1 Day Before Announcement", "Premium Analysis", "Spread Analysis", "Target Company Details",
            "Buyer Company Details", "Related Filings", "Comments", "Deal Resolution", "Features", "Deal Conditions"}
STACKED = {"Consideration Type", "Features", "Deal Conditions", "Response to Conditions", "Business Description"}


def ensure() -> None:
    init_db()
    with connect() as conn:
        have = {r[1] for r in conn.execute("PRAGMA table_info(deals)")}
        if "capiq_url" not in have:
            conn.execute("ALTER TABLE deals ADD COLUMN capiq_url TEXT DEFAULT ''")
        if "capiq_wanted" not in have:  # the student asked for a (re)fetch the reader hasn't done yet
            conn.execute("ALTER TABLE deals ADD COLUMN capiq_wanted INTEGER DEFAULT 0")
        if "capiq_at" not in have:
            conn.execute("ALTER TABLE deals ADD COLUMN capiq_at TEXT DEFAULT ''")


def clean_link(url: str) -> str:
    """The transaction summary in US dollars, from any CapIQ transaction link; '' if it isn't one."""
    m = LINK.search(url or "")
    if not m:
        return ""
    company = re.search(r"companyId=(\d+)", url, re.I)
    return (f"https://www.capitaliq.com/CIQDotNet/Transactions/transactionDetail.aspx?transactionId={m[2]}"
            + (f"&CompanyId={company[1]}" if company else "") + "&currencyId=160")


def set_link(uid: int, deal_id: int, url: str) -> dict:
    ensure()
    link = clean_link(url)
    if url and not link:
        return {"ok": False, "reason": "That isn't a Capital IQ transaction link. Open the deal in CapIQ and copy the address of its "
                                       "Transaction Details page (it contains transactionId=)."}
    with connect() as conn:
        n = conn.execute("UPDATE deals SET capiq_url = ?, capiq_wanted = ? WHERE id = ? AND user_id = ?",
                         (link, int(bool(link)), deal_id, uid)).rowcount
    return {"ok": bool(n), "capiq_url": link}


def want(uid: int, deal_id: int) -> dict:
    """Ask the reader to fetch (again) on the next Capital IQ run."""
    ensure()
    with connect() as conn:
        conn.execute("UPDATE deals SET capiq_wanted = 1 WHERE id = ? AND user_id = ? AND capiq_url != ''", (deal_id, uid))
    return {"ok": True}


def jobs(uid: int) -> list[dict]:
    """For the reader: the CapIQ pages to fetch."""
    ensure()
    with connect(read_only=True) as conn:
        return [{"deal_id": r["id"], "title": r["title"], "url": r["capiq_url"]} for r in conn.execute(
            "SELECT id, title, capiq_url FROM deals WHERE user_id = ? AND capiq_url != '' AND capiq_wanted = 1", (uid,))]


# ---- Reading a CapIQ page ----

class _Rows(HTMLParser):
    """The page as [("head", text) | ("row", [cells]) | ("text", text)], using only innermost table rows (CapIQ
    lays its pages out with tables inside tables)."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.items, self.stack, self.skip, self.loose = [], [], 0, []

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "head", "select"):
            self.skip += 1
        elif tag == "tr":
            self._loose()
            self.stack.append({"cells": [], "text": None, "nested": False})
        elif tag in ("td", "th") and self.stack:
            self.stack[-1]["text"] = []
        elif tag == "table" and self.stack:
            self.stack[-1]["nested"] = True
        elif tag in ("br", "p", "div") and self.stack and self.stack[-1]["text"] is not None:
            self.stack[-1]["text"].append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "head", "select"):
            self.skip = max(0, self.skip - 1)
        elif tag in ("td", "th") and self.stack and self.stack[-1]["text"] is not None:
            row = self.stack[-1]
            row["cells"].append(re.sub(r"[ \t\r\f\v]+", " ", "".join(row["text"])).strip())
            row["text"] = None
        elif tag == "tr" and self.stack:
            row = self.stack.pop()
            cells = [c for c in row["cells"]]
            if not row["nested"] and any(cells):
                while cells and not cells[-1]:
                    cells.pop()
                text = " ".join(" ".join(cells).split())
                if len([c for c in cells if c]) == 1 and text in SECTIONS:
                    self.items.append(("head", text))
                elif len([c for c in cells if c]) == 1:
                    self.items.append(("text", cells[0] if "\n" in cells[0] else text))
                else:
                    self.items.append(("row", [" ".join(c.split()) for c in cells]))

    def handle_data(self, data):
        if self.skip:
            return
        if self.stack and self.stack[-1]["text"] is not None:
            self.stack[-1]["text"].append(data)
        elif not self.stack:
            self.loose.append(data)

    def _loose(self):
        text = " ".join("".join(self.loose).split())
        self.loose = []
        if text in SECTIONS:
            self.items.append(("head", text))

    def parse(self, html: str) -> list:
        self.feed(html)
        self.close()
        return self.items


def items(html: str) -> list:
    return _Rows().parse(html)


def fields(rows: list) -> dict[str, str]:
    """Label -> value from the label/value pairs on the page; the first time a label appears wins (Deal Summary,
    Deal Values and the offered figures come before the current ones)."""
    out: dict[str, str] = {}
    for (kind, row), (next_kind, after) in zip(rows, rows[1:] + [("", "")]):
        # a label alone on its row with its value on the next ("Consideration Type", then "Cash")
        if kind in ("head", "text") and row in STACKED and next_kind == "text" and row not in out:
            out[row] = " ".join(str(after).split())
        if kind != "row" or len(row) < 2:
            continue
        for i in range(0, len(row) - 1, 2):
            label = re.sub(r"\s+", " ", row[i]).strip().rstrip(":")
            if label and label not in out and not re.fullmatch(r"[\d.,()%x$-]+", label):
                out[label] = row[i + 1].strip()
    return out


def advisors(rows: list) -> list[tuple[str, str, str]]:
    roles = ("Financial Advisor", "Legal Advisor", "Fairness Opinion", "Transfer Agent", "Accountant")
    return [(r[0], r[1], r[2]) for kind, r in rows if kind == "row" and len(r) >= 3 and r[2].startswith(roles)]


def premiums(rows: list) -> dict[str, str]:
    return {r[0]: r[2] for kind, r in rows if kind == "row" and len(r) >= 3 and r[0] in ("One Day Prior", "One Week Prior", "One Month Prior")}


def comps(html: str) -> list[dict]:
    """The comparable transactions table: the biggest block of rows with the same number of cells, under its header."""
    rows = [r for kind, r in items(html) if kind == "row" and len(r) >= 5]
    if not rows:
        return []
    width = statistics.mode(len(r) for r in rows)
    block = [r for r in rows if len(r) == width]
    head, body = block[0], block[1:]
    return [dict(zip(head, r)) for r in body if any(re.search(r"\d", c) for c in r)][:40]


def _num(text: str) -> float | None:
    m = re.search(r"-?[\d,]+\.?\d*", (text or "").replace("(", "-"))
    try:
        return float(m[0].replace(",", "")) if m else None
    except ValueError:
        return None


# ---- The PDF ----

def to_pdf(rows: list, title: str, url: str, comp_rows: list[dict]) -> bytes:
    styles = getSampleStyleSheet()
    base = ParagraphStyle("b", parent=styles["Normal"], fontSize=8, leading=10)
    bold = ParagraphStyle("bb", parent=base, fontName="Helvetica-Bold")
    head = ParagraphStyle("h", parent=base, fontName="Helvetica-Bold", fontSize=11, leading=14, spaceBefore=10, spaceAfter=4,
                          textColor=colors.HexColor("#1f3a68"))
    cover = ParagraphStyle("c", parent=base, fontName="Helvetica-Bold", fontSize=14, leading=18)
    note = ParagraphStyle("n", parent=base, textColor=colors.HexColor("#5d6880"), spaceAfter=8)
    story = [Paragraph(html_lib.escape(title), cover),
             Paragraph("S&amp;P Capital IQ transaction summary, US$. Saved " + datetime.now().strftime("%b %d, %Y") + ". Original: "
                       + html_lib.escape(url), note)]
    group: list[list] = []

    def flush():
        if not group:
            return
        width = max(len(r) for r in group)
        data = [[Paragraph(html_lib.escape(c), bold if (j % 2 == 0 and width == 4) or (j == 0 and width == 2) else base)
                 for j, c in enumerate(r + [""] * (width - len(r)))] for r in group]
        t = Table(data, colWidths=[7 * inch / width] * width, repeatRows=0)
        t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#d9dde6")), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                               ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
        story.append(t)
        group.clear()

    for kind, value in rows:
        if kind == "row":
            if group and len(value) != len(group[-1]):
                flush()
            group.append(value)
            continue
        flush()
        if kind == "head":
            story.append(Paragraph(html_lib.escape(value), head))
        else:
            for para in str(value).split("\n"):
                if para.strip():
                    story.append(Paragraph(html_lib.escape(para.strip()), base))
                    story.append(Spacer(1, 3))
    flush()
    if comp_rows:
        story.append(Paragraph("Transaction Quick Comps", head))
        keys = list(comp_rows[0])[:8]
        data = [[Paragraph(html_lib.escape(k), bold) for k in keys]] + [[Paragraph(html_lib.escape(r.get(k, "")), base) for k in keys] for r in comp_rows]
        t = Table(data, colWidths=[7 * inch / len(keys)] * len(keys), repeatRows=1)
        t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#d9dde6")), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
        story.append(t)
    buf = io.BytesIO()
    SimpleDocTemplate(buf, pagesize=LETTER, leftMargin=0.75 * inch, rightMargin=0.75 * inch, topMargin=0.6 * inch,
                      bottomMargin=0.6 * inch, title=title).build(story)
    return buf.getvalue()


# ---- Saving what the reader sent ----

def _points(f: dict, adv: list, prem: dict, comp_rows: list[dict]) -> dict[str, tuple[str, str]]:
    """Pitch point label -> (value, the CapIQ line it comes from)."""
    out: dict[str, tuple[str, str]] = {}
    get = lambda *labels: next((f[k] for k in labels if f.get(k) not in (None, "", "-")), "")  # noqa: E731
    ev, eq = get("Implied Enterprise Value ($ mm)"), get("Implied Equity Value ($ mm)", "Total Consideration to Shareholders ($ mm)")
    per_share = get("Offer Per Share ($ )", "Offer Per Share ($)")
    if eq or ev:
        value = ", ".join(x for x in [f"${eq}mm equity value" if eq else "", f"${per_share} per share" if per_share else "",
                                      f"${ev}mm enterprise value" if ev else ""] if x)
        out["Total consideration"] = (value, f"Implied Equity Value ($ mm) {eq}; Implied Enterprise Value ($ mm) {ev}")
    nal = get("Net Assumed Liabilities ($ mm)")
    if ev:
        out["Enterprise value and net debt"] = (f"EV ${ev}mm" + (f"; net assumed liabilities ${nal}mm" if nal else ""),
                                               f"Implied Enterprise Value ($ mm) {ev}")
    multiples = [(label, get(f"Implied Enterprise Value/{label}")) for label in ("LTM EBITDA", "NTM EBITDA", "LTM Revenue", "LTM EBIT")]
    multiples = [(label, v) for label, v in multiples if v]
    if multiples:
        out["Purchase multiple"] = ("; ".join(f"{v} EV/{label}" for label, v in multiples),
                                    "; ".join(f"Implied Enterprise Value/{label} {v}" for label, v in multiples))
    if prem:
        out["Premium paid"] = (", ".join(f"{v} {k.lower().replace(' prior', ' before')}" for k, v in prem.items()),
                               "; ".join(f"{k} {v}" for k, v in prem.items()))
    kind = get("Consideration Type") or ("Cash" if "Cash Merger" in get("Features") else "")
    if kind:
        out["Form of consideration"] = (kind, f"Consideration Type {kind}")
    status = get("Status")
    if status:
        dates = [f"announced {get('Announced Date')}" if get("Announced Date") else "",
                 f"definitive agreement {get('Definitive Agreement Date')}" if get("Definitive Agreement Date") else "",
                 f"closed {get('Closed Date')}" if get("Closed Date") else ""]
        out["Timeline and status"] = (", ".join([status] + [d for d in dates if d]), f"Status {status}")
    financial = [a for a in adv if a[2].startswith("Financial")]
    if financial:
        sides: dict[str, list[str]] = {}
        for name, client, _ in financial:
            sides.setdefault(client, []).append(name)
        out["Advisors"] = ("; ".join(f"{client}: {', '.join(names)}" for client, names in sides.items()) + " (financial advisors)",
                           "; ".join(f"{n} - {c} - Financial Advisor" for n, c, _ in financial))
    ebitda_col = next((k for k in (comp_rows[0] if comp_rows else {}) if "EBITDA" in k.upper()), "")
    vals = [v for v in (_num(r.get(ebitda_col, "")) for r in comp_rows) if v and 0 < v < 100] if ebitda_col else []
    if vals:
        this = get("Implied Enterprise Value/LTM EBITDA")
        name_col = next((k for k in comp_rows[0] if re.search(r"target|issuer", k, re.I)), list(comp_rows[0])[0])
        examples = ", ".join(r.get(name_col, "") for r in comp_rows[:4] if r.get(name_col))
        out["Versus precedent transactions"] = (
            f"Median {statistics.median(vals):.1f}x {ebitda_col} across {len(vals)} comparable deals on CapIQ"
            + (f" vs {this} for this deal" if this else "") + (f" (e.g. {examples})" if examples else ""),
            f"Transaction Quick Comps, {ebitda_col}, {len(vals)} deals")
    return out


def save(uid: int, deal_id: int, url: str, overview_html: str, comps_html: str = "") -> dict:
    """File what the reader fetched: the summary as a PDF document, and the pitch points it answers."""
    ensure()
    with connect(read_only=True) as conn:
        deal = conn.execute("SELECT title FROM deals WHERE id = ? AND user_id = ?", (deal_id, uid)).fetchone()
    if deal is None:
        return {"ok": False, "reason": "Deal not found."}
    if re.search(r"login|okta|sign in", overview_html[:20000], re.I) and "Deal Summary" not in overview_html:
        return {"ok": False, "reason": "Capital IQ showed its sign-in page. Be on Yale Wi-Fi and signed in to Capital IQ in Chrome, then try again."}
    rows = items(overview_html)
    f = fields(rows)
    if not any(k in f for k in ("Status", "Announced Date", "Implied Enterprise Value ($ mm)")):
        return {"ok": False, "reason": "That page didn't look like a Capital IQ transaction summary."}
    comp_rows = comps(comps_html) if comps_html else []
    title = f"Capital IQ transaction summary - {deal['title']}"
    pdf = to_pdf(rows, title, url, comp_rows)
    with connect(read_only=True) as conn:
        old = [r["id"] for r in conn.execute("SELECT id FROM deal_documents WHERE user_id = ? AND deal_id = ? AND kind = ?", (uid, deal_id, KIND))]
    for doc in old:  # the newest summary replaces the last one
        deal_docs.delete(uid, doc)
    out = deal_docs.upload(uid, deal_id, f"{title}.pdf", pdf, KIND)
    if not out.get("ok"):
        return out
    points = _points(f, advisors(rows), premiums(rows), comp_rows)
    now = datetime.now().isoformat(timespec="seconds")
    with connect() as conn:
        conn.execute("UPDATE deal_documents SET source_url = ?, source_page = ? WHERE id = ? AND user_id = ?", (url, url, out["id"], uid))
        for label, (value, quote) in points.items():
            conn.execute("""UPDATE deal_points SET value = ?, source = 'Capital IQ', source_kind = 'document', doc_id = ?, page = '1',
                            quote = ? WHERE deal_id = ? AND label = ?""", (value, str(out["id"]), quote[:600], deal_id, label))
        conn.execute("UPDATE deals SET capiq_wanted = 0, capiq_at = ? WHERE id = ? AND user_id = ?", (now, deal_id, uid))
    return {"ok": True, "points": len(points), "comps": len(comp_rows), "document": out["id"]}

