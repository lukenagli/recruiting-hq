"""Preview: S&P Capital IQ for a deal, through the student's own Capital IQ login.

Capital IQ only opens on the Yale network for a signed-in student, so the site never reaches it itself. After the
student confirms they are on Yale Wi-Fi and signed in, the Recruiting HQ Reader fetches Capital IQ pages from their
Chrome in the background (plain GET requests, no tabs) and sends them here, a few at a time. This module decides
what to fetch next (`step`):
1. no link yet: Capital IQ's search for the deal, and the transaction whose row best matches the buyer and target;
2. the transaction's Deal Overview page;
3. its Consideration Details, Deal Timeline and Transaction Quick Comps tabs.
Then it saves each page as a PDF among the deal's documents, linked back to its Capital IQ page, and fills the pitch
points Capital IQ is the best source for (enterprise value, multiples, premiums, advisors, consideration, timeline,
precedent transactions), replacing what the filings or a web search gave, since its figures are standardised.
Keeping these steps here, not in the extension, means they can change without students reinstalling it.
"""
import html as html_lib
import io
import re
import statistics
from datetime import datetime
from html.parser import HTMLParser
from urllib.parse import quote, urljoin

from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from . import deal_docs, deal_sources
from .db import connect, init_db

KIND = deal_docs.CAPIQ_KIND
# The deal's pages besides the overview: the tab's name on the page -> the document it becomes.
TABS = {"Consideration Details": "Capital IQ consideration details", "Deal Timeline": "Capital IQ deal timeline",
        "Transaction Quick Comps": "Capital IQ quick comps"}
BASE = "https://www.capitaliq.com"
# Capital IQ's search, where the reader looks a deal up by the target's name (checked against the live site on campus).
SEARCH = [BASE + "/CIQDotNet/Search/Search.aspx?searchString={q}&searchType=Transactions"]
LINK =re.compile(r"https://(www\.)?capitaliq\.com/CIQDotNet/Transactions/transactionDetail\.aspx\?[^\s\"']*transactionId=(\d+)", re.I)
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
        if n and link:  # a CapIQ PDF uploaded before the link was known now links to it
            conn.execute("""UPDATE deal_documents SET source_url = ?, source_page = ? WHERE user_id = ? AND deal_id = ? AND kind = ?
                            AND COALESCE(source_url, '') = ''""", (link, link, uid, deal_id, KIND))
    return {"ok": bool(n), "capiq_url": link}


def want(uid: int, deal_id: int) -> dict:
    """Ask the reader to fetch (again) on the next Capital IQ run."""
    ensure()
    with connect() as conn:
        conn.execute("UPDATE deals SET capiq_wanted = 1 WHERE id = ? AND user_id = ?", (deal_id, uid))
    return {"ok": True}


def attach_upload(uid: int, deal_id: int, doc_id: int) -> None:
    """A CapIQ page the student saved as a PDF themselves (on campus): it replaces any earlier summary and links to the
    deal's CapIQ page. "Fill from my documents" reads it like any scanned page."""
    ensure()
    with connect(read_only=True) as conn:
        deal = conn.execute("SELECT capiq_url FROM deals WHERE id = ? AND user_id = ?", (deal_id, uid)).fetchone()
        old = [r["id"] for r in conn.execute(
            "SELECT id FROM deal_documents WHERE user_id = ? AND deal_id = ? AND kind = ? AND id != ?", (uid, deal_id, KIND, doc_id))]
    for doc in old:
        deal_docs.delete(uid, doc)
    if deal and deal["capiq_url"]:
        with connect() as conn:
            conn.execute("UPDATE deal_documents SET source_url = ?, source_page = ? WHERE id = ? AND user_id = ?",
                         (deal["capiq_url"], deal["capiq_url"], doc_id, uid))


def jobs(uid: int) -> list[dict]:
    """For the reader: the CapIQ pages to fetch."""
    ensure()
    with connect(read_only=True) as conn:
        rows = conn.execute("SELECT id, title, capiq_url FROM deals WHERE user_id = ? AND capiq_wanted = 1", (uid,)).fetchall()
    return [{"deal_id": r["id"], "title": r["title"], "fetch": [r["capiq_url"]] if r["capiq_url"] else _search_urls(r["title"])}
            for r in rows]


def _search_urls(title: str) -> list[str]:
    buyer, target = deal_sources.parties(title)
    return [u.format(q=quote(target or buyer or title)) for u in SEARCH]


def _anchors(html: str, base: str) -> list[tuple[str, str, str]]:
    """(absolute url, link text, the text around it) for every Capital IQ link on a page."""
    out = []
    for m in re.finditer(r'<a\b[^>]*href="([^"]+)"[^>]*>(.*?)</a>', html, re.I | re.S):
        href = html_lib.unescape(m[1])
        if href.lower().startswith(("javascript:", "#", "mailto:")):
            continue
        url = urljoin(base, href)
        if not url.startswith(BASE + "/"):
            continue
        # the link's own table row (a results list puts one deal per row), else the text close to it
        start, end = html.rfind("<tr", 0, m.start()), html.find("</tr>", m.end())
        if start < 0 or end < 0 or end - start > 6000:
            start, end = max(0, m.start() - 300), m.end() + 300
        around = re.sub(r"<[^>]+>", " ", html[start:end])
        out.append((url, " ".join(re.sub(r"<[^>]+>", " ", m[2]).split()), " ".join(html_lib.unescape(around).split())))
    return out


def _pick(pages: list[dict], title: str) -> str:
    """The transaction in the search results whose row best matches this deal's buyer and target."""
    buyer, target = deal_sources.parties(title)
    words = lambda name: {w for w in re.findall(r"[a-z]{3,}", name.lower()) if w not in ("inc", "plc", "the", "corp", "group", "and")}  # noqa: E731
    best, score = "", 0.0
    for page in pages:
        for url, text, around in _anchors(page["html"], page["final_url"]):
            if not LINK.search(url):
                continue
            seen = set(re.findall(r"[a-z]{3,}", around.lower()))
            s = 2 * len(words(target) & seen) + len(words(buyer) & seen) + ("merger" in around.lower() or "acquisition" in around.lower())
            if s > score:
                best, score = url, s
    return clean_link(best) if score >= 2 else ""


def _tab_links(html: str, base: str) -> dict[str, str]:
    """The overview page's tabs that are plain links (a tab that only posts the page back can't be fetched)."""
    return {text: url for url, text, _ in _anchors(html, base) if text in TABS}


def _signed_out(page: dict) -> bool:
    return bool(re.search(r"login|okta", page["final_url"], re.I)) or ("Login-okta" in page["html"] and "Deal Summary" not in page["html"])


def step(uid: int, deal_id: int, pages: list[dict]) -> dict:
    """What the reader fetched so far for one deal -> the next pages to fetch, or the finished result."""
    ensure()
    with connect(read_only=True) as conn:
        deal = conn.execute("SELECT title, capiq_url FROM deals WHERE id = ? AND user_id = ?", (deal_id, uid)).fetchone()
    if deal is None:
        return {"done": True, "ok": False, "message": "Deal not found."}
    if any(_signed_out(p) for p in pages):
        return {"done": True, "ok": False, "message": "Capital IQ showed its sign-in page. Be on Yale Wi-Fi and signed in to Capital IQ "
                                                      "in Chrome, then try again."}
    link = deal["capiq_url"]
    if not link:
        link = _pick(pages, deal["title"])
        if not link:
            return {"done": True, "ok": False, "message": "Couldn't find this deal in Capital IQ's search. Paste the deal's Capital IQ "
                                                          "link in the box, then pull again."}
        set_link(uid, deal_id, link)
    overview = next((p for p in pages if clean_link(p["url"]) == link and "Deal Summary" in p["html"]), None)
    if overview is None:
        return {"done": False, "fetch": [link]}
    tabs = _tab_links(overview["html"], overview["final_url"])
    missing = [u for u in tabs.values() if u not in {p["url"] for p in pages}]
    if missing:
        return {"done": False, "fetch": missing}
    got = {name: next(p for p in pages if p["url"] == url) for name, url in tabs.items()}
    out = save(uid, deal_id, link, overview["html"], {name: (page["url"], page["html"]) for name, page in got.items()})
    if not out["ok"]:
        return {"done": True, **out, "message": out.get("reason", "")}
    names = ["the transaction summary"] + [n.lower() for n in got]
    skipped = [n for n in TABS if n not in got]
    message = (f"Saved {', '.join(names)} as PDFs and filled {out['points']} points"
               + (f", with {out['comps']} comparable deals" if out["comps"] else "") + "."
               + (f" Couldn't open {', '.join(skipped)} (not a plain link on the page)." if skipped else ""))
    return {"done": True, "ok": True, "message": message}


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

def to_pdf(rows: list, title: str, url: str, comp_rows: list[dict], what: str = "transaction summary") -> bytes:
    styles = getSampleStyleSheet()
    base = ParagraphStyle("b", parent=styles["Normal"], fontSize=8, leading=10)
    bold = ParagraphStyle("bb", parent=base, fontName="Helvetica-Bold")
    head = ParagraphStyle("h", parent=base, fontName="Helvetica-Bold", fontSize=11, leading=14, spaceBefore=10, spaceAfter=4,
                          textColor=colors.HexColor("#1f3a68"))
    cover = ParagraphStyle("c", parent=base, fontName="Helvetica-Bold", fontSize=14, leading=18)
    note = ParagraphStyle("n", parent=base, textColor=colors.HexColor("#5d6880"), spaceAfter=8)
    story = [Paragraph(html_lib.escape(title), cover),
             Paragraph(f"S&amp;P Capital IQ {html_lib.escape(what)}, US$. Saved " + datetime.now().strftime("%b %d, %Y") + ". Original: "
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


def _timeline(html: str) -> list[str]:
    """"date: event" lines from the Deal Timeline page, oldest first."""
    date = re.compile(r"[A-Z][a-z]{2}-\d{2}-\d{4}")
    out = []
    for kind, row in items(html):
        if kind == "row" and len(row) >= 2 and date.fullmatch(row[0].strip()) and row[1].strip():
            out.append(f"{row[0].strip()}: {' '.join(row[1:3]).strip()}")
    return sorted(set(out), key=lambda line: datetime.strptime(line[:11], "%b-%d-%Y"))


def _store(uid: int, deal_id: int, kind: str, title: str, pdf: bytes, url: str) -> int | None:
    """One CapIQ page as a document that replaces the last one of its kind, linked to the page it came from."""
    with connect(read_only=True) as conn:
        old = [r["id"] for r in conn.execute("SELECT id FROM deal_documents WHERE user_id = ? AND deal_id = ? AND kind = ?", (uid, deal_id, kind))]
    for doc in old:
        deal_docs.delete(uid, doc)
    out = deal_docs.upload(uid, deal_id, f"{title}.pdf", pdf, kind)
    if not out.get("ok"):
        return None
    with connect() as conn:
        conn.execute("UPDATE deal_documents SET source_url = ?, source_page = ? WHERE id = ? AND user_id = ?", (url, url, out["id"], uid))
    return out["id"]


def save(uid: int, deal_id: int, url: str, overview_html: str, tabs: dict[str, tuple[str, str]] | None = None) -> dict:
    """File what the reader fetched: the overview and each tab as a PDF document, and the pitch points they answer.
    `tabs` is {tab name: (its url, its html)}."""
    ensure()
    tabs = tabs or {}
    with connect(read_only=True) as conn:
        deal = conn.execute("SELECT title FROM deals WHERE id = ? AND user_id = ?", (deal_id, uid)).fetchone()
    if deal is None:
        return {"ok": False, "reason": "Deal not found."}
    rows = items(overview_html)
    f = fields(rows)
    if not any(k in f for k in ("Status", "Announced Date", "Implied Enterprise Value ($ mm)")):
        return {"ok": False, "reason": "That page didn't look like a Capital IQ transaction summary."}
    docs = {"summary": _store(uid, deal_id, KIND, f"Capital IQ transaction summary - {deal['title']}",
                              to_pdf(rows, f"Capital IQ transaction summary - {deal['title']}", url, []), url)}
    if docs["summary"] is None:
        return {"ok": False, "reason": "Couldn't save the transaction summary."}
    for name, (tab_url, html) in tabs.items():
        what = name[0].lower() + name[1:] if name != "Transaction Quick Comps" else "transaction quick comps"
        title = f"Capital IQ {what} - {deal['title']}"
        docs[name] = _store(uid, deal_id, TABS[name], title, to_pdf(items(html), title, tab_url, [], what), tab_url)
        f = {**fields(items(html)), **f}  # the overview's figures win; the consideration page adds its own
    comp_rows = comps(tabs["Transaction Quick Comps"][1]) if "Transaction Quick Comps" in tabs else []
    points = {label: (value, quote, docs["summary"]) for label, (value, quote) in _points(f, advisors(rows), premiums(rows), []).items()}
    if comp_rows and docs.get("Transaction Quick Comps"):
        precedent = _points({**f}, [], {}, comp_rows).get("Versus precedent transactions")
        if precedent:
            points["Versus precedent transactions"] = (*precedent, docs["Transaction Quick Comps"])
    events = _timeline(tabs["Deal Timeline"][1]) if "Deal Timeline" in tabs else []
    if events and docs.get("Deal Timeline"):
        points["Timeline and status"] = (f"{f.get('Status', '')}. " + "; ".join(events[:8]), events[0], docs["Deal Timeline"])
    now = datetime.now().isoformat(timespec="seconds")
    with connect() as conn:
        for label, (value, quote_text, doc_id) in points.items():
            conn.execute("""UPDATE deal_points SET value = ?, source = 'Capital IQ', source_kind = 'document', doc_id = ?, page = '1',
                            quote = ? WHERE deal_id = ? AND label = ?""", (value.strip(" ."), str(doc_id), quote_text[:600], deal_id, label))
        conn.execute("UPDATE deals SET capiq_wanted = 0, capiq_at = ? WHERE id = ? AND user_id = ?", (now, deal_id, uid))
    return {"ok": True, "points": len(points), "comps": len(comp_rows), "document": docs["summary"]}

