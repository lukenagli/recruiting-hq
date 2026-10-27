"""An SEC filing (HTML) as a clean, readable PDF, for filings the companies don't publish as PDFs themselves.

A real browser would copy the filing's layout exactly, but needs more memory than the site's server has, so this
lays the text out again with ReportLab: headings, paragraphs and lists as text, and each table row as one line
with its cells separated, which keeps every number readable and in order. The link to the original stays with
the document for anyone who needs the exact layout.
"""
import html as html_lib
import io
import re
from html.parser import HTMLParser

from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate

BLOCKS = {"p", "div", "br", "li", "h1", "h2", "h3", "h4", "h5", "h6", "table", "center", "hr"}
SKIP = {"script", "style", "head", "title"}


class _Blocks(HTMLParser):
    """[(kind, text)] where kind is "h" (heading), "row" (a table row) or "p"."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.text, self.cells, self.skip, self.bold, self.in_row = [], [], [], 0, 0, False

    def _flush(self):
        text = " ".join("".join(self.text).split())
        if text:
            self.out.append(("h" if self.bold and len(text) < 120 else "p", text))
        self.text = []

    def handle_starttag(self, tag, attrs):
        style = (dict(attrs).get("style") or "").lower().replace(" ", "")
        if tag in SKIP:
            self.skip += 1
        elif tag == "tr":
            self._flush()
            self.in_row, self.cells = True, []
        elif tag in ("td", "th"):
            self.text = []
        elif tag in BLOCKS and not self.in_row:
            self._flush()
        if tag in ("b", "strong") or "font-weight:bold" in style or "font-weight:700" in style:
            self.bold += 1

    def handle_endtag(self, tag):
        if tag in SKIP:
            self.skip = max(0, self.skip - 1)
        elif tag in ("td", "th") and self.in_row:
            cell = " ".join("".join(self.text).split())
            if cell in ("%", ")") and self.cells:
                self.cells[-1] += cell  # "12.5" and "%" sit in separate cells in most filings
            elif cell and cell != "$":
                self.cells.append(cell)
            self.text = []
        elif tag == "tr":
            if self.cells:
                self.out.append(("row", "   |   ".join(self.cells)))
            self.in_row, self.cells = False, []
        elif tag in BLOCKS and not self.in_row:
            self._flush()
        if tag in ("b", "strong") and self.bold:
            self.bold -= 1

    def handle_data(self, data):
        if not self.skip:
            self.text.append(data)

    def blocks(self):
        self.close()
        self._flush()
        return self.out


def to_pdf(html: bytes, title: str, source: str = "") -> bytes:
    """A letter-size PDF of the filing's text and tables."""
    parser = _Blocks()
    parser.feed(html.decode("utf-8", errors="replace"))
    styles = getSampleStyleSheet()
    body = ParagraphStyle("body", parent=styles["Normal"], fontSize=9.5, leading=12.5, spaceAfter=5)
    head = ParagraphStyle("head", parent=body, fontName="Helvetica-Bold", fontSize=10.5, spaceBefore=6)
    row = ParagraphStyle("row", parent=body, fontSize=8, leading=10, spaceAfter=1, leftIndent=8)
    cover = ParagraphStyle("cover", parent=body, fontName="Helvetica-Bold", fontSize=13, alignment=TA_CENTER, spaceAfter=4)
    note = ParagraphStyle("note", parent=body, fontSize=8, textColor="#5d6880", alignment=TA_CENTER, spaceAfter=14)
    story = [Paragraph(html_lib.escape(title), cover)]
    if source:
        story.append(Paragraph("Text of the SEC filing, laid out for reading. Original: " + html_lib.escape(source), note))
    for kind, text in parser.blocks():
        text = html_lib.escape(re.sub(r"\s+", " ", text))
        story.append(Paragraph(text, head if kind == "h" else row if kind == "row" else body))
    buf = io.BytesIO()
    SimpleDocTemplate(buf, pagesize=LETTER, leftMargin=0.8 * inch, rightMargin=0.8 * inch, topMargin=0.7 * inch,
                      bottomMargin=0.7 * inch, title=title).build(story)
    return buf.getvalue()
