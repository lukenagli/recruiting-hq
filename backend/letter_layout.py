"""Keeps a cover letter's Word file on one page, and draws the same letter as a PDF.

Word lays the letter out on the student's computer, so the server measures it the way Word will: the template's
font (Times New Roman is measured with Liberation Serif, which has exactly its letter widths), size, margins and
spacing, breaking each paragraph into lines word by word. When the letter would not fit on one page with room to
spare, it is tightened a step at a time (the bottom margin, as far as the contact footer allows, then the blank
lines between paragraphs, then the text size) until it does. The PDF is drawn from the same measurements, on the
template's letterhead, so it matches the Word file.
"""
import hashlib
import io
from pathlib import Path

from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Emu, Inches, Pt

ASSETS = Path(__file__).parent / "assets"
# The Yale SOM letterhead is a Windows picture (EMF) PDF tools can't draw: a copy of its top strip as a PNG.
YALE_LETTERHEAD = {"dbafa504341b8566": (ASSETS / "yale_som_letterhead.png", 1.3)}  # EMF hash -> (strip, inches tall)
FONTS = {  # family -> regular font files to measure and draw with, first found wins; then a built-in PDF font
    "serif": ["/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf", "C:/Windows/Fonts/times.ttf"],
    "sans": ["/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", "C:/Windows/Fonts/arial.ttf"],
}
BUILT_IN = {"serif": "Times-Roman", "sans": "Helvetica"}
LINE = {"serif": 1.15, "sans": 1.15}  # Word's single line height per point of text (ascent, descent and line gap)
ASCENT = {"serif": 0.93, "sans": 0.94}  # from the top of a line to its baseline, per point
ROOM = Pt(13)  # the letter must end at least a line above the bottom margin, in case Word wraps a line differently
EMU_PT = 12700


def _font(family: str) -> str:
    """The PDF font name for a family, registered on first use."""
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    name = f"Letter-{family}"
    if name in pdfmetrics.getRegisteredFontNames():
        return name
    for path in FONTS[family]:
        if Path(path).exists():
            pdfmetrics.registerFont(TTFont(name, path))
            return name
    return BUILT_IN[family]


def _width(text: str, family: str, size: float) -> float:
    from reportlab.pdfbase.pdfmetrics import stringWidth

    return stringWidth(text, _font(family), size)


# ---- Reading the template's formatting (paragraph, then its style chain, then the document defaults) ----

def _defaults(doc):
    el = doc.styles.element.find(qn("w:docDefaults"))
    rpr = el.find(qn("w:rPrDefault")) if el is not None else None
    ppr = el.find(qn("w:pPrDefault")) if el is not None else None
    sz = rpr.find(f"{qn('w:rPr')}/{qn('w:sz')}") if rpr is not None else None
    spacing = ppr.find(f"{qn('w:pPr')}/{qn('w:spacing')}") if ppr is not None else None
    return {
        "size": int(sz.get(qn("w:val"))) / 2 if sz is not None else 11.0,
        "after": int(spacing.get(qn("w:after"), 0)) / 20 if spacing is not None else 0.0,
        "before": int(spacing.get(qn("w:before"), 0)) / 20 if spacing is not None else 0.0,
        "line": int(spacing.get(qn("w:line"), 240)) / 240 if spacing is not None else 1.0,
    }


def _styles(p):
    style = p.style
    while style is not None:
        yield style
        style = style.base_style


def _size(p, defaults) -> float:
    for r in p.runs:
        if r.text.strip() and r.font.size:
            return r.font.size.pt
    ppr = p._p.pPr
    sz = ppr.find(f"{qn('w:rPr')}/{qn('w:sz')}") if ppr is not None else None
    if sz is not None:
        return int(sz.get(qn("w:val"))) / 2
    for s in _styles(p):
        if s.font.size:
            return s.font.size.pt
    return defaults["size"]


def _family(p) -> str:
    names = [r.font.name for r in p.runs if r.font.name] + [s.font.name for s in _styles(p) if s.font.name]
    name = (names[0] if names else "").lower()
    return "sans" if any(k in name for k in ("arial", "helvetica", "calibri", "aptos", "verdana")) else "serif"


def _format(p, attr: str):
    value = getattr(p.paragraph_format, attr)
    for s in _styles(p):
        if value is not None:
            break
        value = getattr(s.paragraph_format, attr)
    return value


def blocks(doc) -> list[dict]:
    """Each body paragraph as Word lays it out: its lines, their height and the space around it, in points."""
    sec, d = doc.sections[0], _defaults(doc)
    full = (sec.page_width - sec.left_margin - sec.right_margin) / EMU_PT
    out = []
    for p in doc.paragraphs:
        size, family = _size(p, d), _family(p)
        line = _format(p, "line_spacing")
        rule = _format(p, "line_spacing_rule")
        if isinstance(line, float):
            height = size * LINE[family] * line
        elif line is not None and rule is not None and "EXACTLY" in str(rule):
            height = line.pt
        elif line is not None:
            height = max(line.pt, size * LINE[family])
        else:
            height = size * LINE[family] * d["line"]
        before, after = _format(p, "space_before"), _format(p, "space_after")
        left = (_format(p, "left_indent") or 0) / EMU_PT
        right = (_format(p, "right_indent") or 0) / EMU_PT
        width = full - left - right
        lines, cur = [], ""
        for word in p.text.split():
            trial = f"{cur} {word}" if cur else word
            if cur and _width(trial, family, size) > width:
                lines.append(cur)
                cur = word
            else:
                cur = trial
        lines.append(cur)
        align = _format(p, "alignment")
        out.append({"lines": lines, "height": height, "size": size, "family": family, "left": left, "width": width,
                    "before": before.pt if before is not None else d["before"],
                    "after": after.pt if after is not None else d["after"],
                    "align": str(align).split(".")[-1].split(" ")[0] if align is not None else "LEFT"})
    return out


def _used(doc) -> float:
    return sum(b["before"] + len(b["lines"]) * b["height"] + b["after"] for b in blocks(doc))


def _room(doc) -> float:
    sec = doc.sections[0]
    return (sec.page_height - sec.top_margin - sec.bottom_margin) / EMU_PT


def _footer_top(doc) -> int | None:
    """How far down the page (EMU) the highest footer shape starts: a line or text box placed low on the page."""
    sec = doc.sections[0]
    tops = []
    for anchor in doc.element.body.iter(qn("wp:anchor")):
        v = anchor.find(qn("wp:positionV"))
        off = v.find(qn("wp:posOffset")) if v is not None else None
        if v is not None and v.get("relativeFrom") == "page" and off is not None and int(off.text) > sec.page_height / 2:
            tops.append(int(off.text))
    return min(tops) if tops else None


def _set_mark_size(p, half_points: int) -> None:
    ppr = p._p.get_or_add_pPr()
    rpr = ppr.find(qn("w:rPr"))
    if rpr is None:
        rpr = OxmlElement("w:rPr")
        ppr.append(rpr)
    for tag in ("w:sz", "w:szCs"):
        el = rpr.find(qn(tag))
        if el is None:
            el = OxmlElement(tag)
            rpr.append(el)
        el.set(qn("w:val"), str(half_points))


def fits(doc) -> bool:
    return _used(doc) <= _room(doc) - ROOM.pt


def fit_one_page(doc) -> list[str]:
    """Tighten the letter until it fits on one page with room to spare. Returns what was changed."""
    sec, changed = doc.sections[0], []
    footer = _footer_top(doc)
    floor = max(Inches(0.5), sec.page_height - footer + Inches(0.1)) if footer else Inches(0.6)
    first = next((i for i, p in enumerate(doc.paragraphs) if p.text.strip()), 0)
    last = max((i for i, p in enumerate(doc.paragraphs) if p.text.strip()), default=0)
    blanks = [p for p in doc.paragraphs[first:last] if not p.text.strip()]

    def margin(inches):
        target = max(floor, Inches(inches))
        if sec.bottom_margin > target:
            sec.bottom_margin = Emu(target)
            changed.append(f"bottom margin {target / 914400:.2f} in")

    def blank_lines(points):
        for p in blanks:
            _set_mark_size(p, points * 2)
        if blanks:
            changed.append(f"blank lines {points} pt")

    def text_size(points):
        for p in doc.paragraphs:
            for r in p.runs:
                if r.text.strip() and r.font.size and r.font.size.pt > points:
                    r.font.size = Pt(points)
        changed.append(f"text {points} pt")

    for step in (lambda: margin(0.8), lambda: margin(0.6), lambda: blank_lines(9), lambda: blank_lines(7),
                 lambda: text_size(10.5), lambda: text_size(10)):
        if fits(doc):
            break
        step()
    return changed


# ---- The PDF ----

def _letterhead(doc):
    """The template's letterhead, if it is one this file can draw: (PNG path, inches tall from the page top)."""
    for header in {id(s.header): s.header for s in doc.sections}.values():
        for rel in header.part.rels.values():
            if "image" in rel.reltype:
                digest = hashlib.sha256(rel.target_part.blob).hexdigest()[:16]
                if digest in YALE_LETTERHEAD:
                    return YALE_LETTERHEAD[digest]
    return None


def _shapes(doc):
    """Lines and text boxes anchored in the letter (the Yale template's contact footer), in page points from the top."""
    sec = doc.sections[0]
    left_margin = sec.left_margin / EMU_PT
    for anchor in doc.element.body.iter(qn("wp:anchor")):
        h, v, ext = anchor.find(qn("wp:positionH")), anchor.find(qn("wp:positionV")), anchor.find(qn("wp:extent"))
        voff = v.find(qn("wp:posOffset")) if v is not None else None
        if voff is None or v.get("relativeFrom") != "page" or ext is None:
            continue
        hoff = h.find(qn("wp:posOffset")) if h is not None else None
        x = (int(hoff.text) / EMU_PT if hoff is not None else 0) + (0 if h is not None and h.get("relativeFrom") == "page" else left_margin)
        y, w = int(voff.text) / EMU_PT, int(ext.get("cx")) / EMU_PT
        if anchor.xpath('.//*[local-name()="prstGeom"][@prst="line"]'):
            yield {"kind": "line", "x": x, "y": y, "w": w}
        for box in anchor.iter(qn("w:txbxContent")):
            for p in box.iter(qn("w:p")):
                text = "".join(t.text or "" for t in p.iter(qn("w:t")))
                sz = p.find(f".//{qn('w:sz')}")
                jc = p.find(f".//{qn('w:jc')}")
                if text.strip():
                    yield {"kind": "text", "x": x, "y": y, "w": w, "text": text,
                           "size": int(sz.get(qn("w:val"))) / 2 if sz is not None else 10.0,
                           "align": jc.get(qn("w:val")) if jc is not None else "left"}
                    y += (int(sz.get(qn("w:val"))) / 2 if sz is not None else 10.0) * LINE["serif"]


def pdf_bytes(doc) -> bytes:
    """The letter as a one-page PDF, laid out exactly as measured for the Word file."""
    from reportlab.pdfgen import canvas

    sec = doc.sections[0]
    page_w, page_h = sec.page_width / EMU_PT, sec.page_height / EMU_PT
    out = io.BytesIO()
    c = canvas.Canvas(out, pagesize=(page_w, page_h))
    head = _letterhead(doc)
    if head:
        path, tall = head
        c.drawImage(str(path), 0, page_h - tall * 72, width=page_w, height=tall * 72, mask="auto")
    x0, y = sec.left_margin / EMU_PT, page_h - sec.top_margin / EMU_PT
    for b in blocks(doc):
        y -= b["before"]
        font = _font(b["family"])
        for n, line in enumerate(b["lines"]):
            base = y - b["size"] * ASCENT[b["family"]]
            left, words = x0 + b["left"], line.split()
            spare = b["width"] - _width(line, b["family"], b["size"])
            c.setFont(font, b["size"])
            if b["align"] == "JUSTIFY" and n < len(b["lines"]) - 1 and len(words) > 1:
                gap = _width(" ", b["family"], b["size"]) + spare / (len(words) - 1)
                for word in words:
                    c.drawString(left, base, word)
                    left += _width(word, b["family"], b["size"]) + gap
            elif b["align"] == "CENTER":
                c.drawString(left + spare / 2, base, line)
            elif b["align"] == "RIGHT":
                c.drawString(left + spare, base, line)
            elif line:
                c.drawString(left, base, line)
            y -= b["height"]
        y -= b["after"]
    for s in _shapes(doc):
        if s["kind"] == "line":
            c.setLineWidth(0.75)
            c.line(s["x"], page_h - s["y"], s["x"] + s["w"], page_h - s["y"])
        else:
            c.setFont(_font("serif"), s["size"])
            base = page_h - s["y"] - s["size"] * ASCENT["serif"]
            spare = s["w"] - _width(s["text"], "serif", s["size"])
            c.drawString(s["x"] + (spare / 2 if s["align"] == "center" else spare if s["align"] == "right" else 0), base, s["text"])
    c.showPage()
    c.save()
    return out.getvalue()
