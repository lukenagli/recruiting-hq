"""Keeps a cover letter's Word file on one page.

Word lays the letter out on the student's computer, so the server measures it the way Word will: the template's
font (Times New Roman is measured with Liberation Serif, which has exactly its letter widths), size, margins and
spacing, breaking each paragraph into lines word by word. When the letter would not fit on one page, only its
margins come in, by the least that makes it fit (the bottom one to just above the contact footer, then the top
one by up to a quarter inch): the template's fonts, sizes and spacing are kept exactly. A letter still too long
needs shorter text: the writer shortens its drafts, and the page says how much to cut. (A PDF is made in Word itself,
with Save As: only Word draws the letter exactly as Word does.)
"""
import re
from pathlib import Path

from docx.oxml.ns import qn
from docx.shared import Emu, Inches, Pt

FONTS = {  # family -> regular font files to measure with, first found wins; then a built-in font
    "serif": ["/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf", "C:/Windows/Fonts/times.ttf"],
    "sans": ["/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", "C:/Windows/Fonts/arial.ttf"],
}
BUILT_IN = {"serif": "Times-Roman", "sans": "Helvetica"}
# Word's single line height per point of text (the font's ascent, descent and line gap). Checked in Word on Luke's
# 48-line letters at 11 pt: two pages with a 0.9 in bottom margin, one page with 0.8 in.
LINE = {"serif": 1.15, "sans": 1.15}
ROOM = Pt(1)  # a little room at the bottom, so the margins change as little as possible
TOP_GIVE = Inches(0.25)  # how far the top margin may come up (1.75 in to 1.5 in on the Yale template)
EMU_PT = 12700


def _font(family: str) -> str:
    """The font name to measure a family with, registered on first use."""
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
        for word in p.text.split():  # Word breaks a line at a space, or after a hyphen ("ultra-low-|cost")
            for n, piece in enumerate(re.findall(r"[^-]+-|[^-]+$|-", word)):
                trial = cur + (" " if cur and n == 0 else "") + piece
                if cur and _width(trial, family, size) > width:
                    lines.append(cur)
                    cur = piece
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


def fits(doc) -> bool:
    return _used(doc) <= _room(doc) - ROOM.pt


def fit_one_page(doc) -> float:
    """Keep the letter on one page by bringing in the margins only as far as it needs, so they still look like the
    template's: the bottom one down to just above the contact footer, then the top one by at most TOP_GIVE. The
    template's fonts, sizes and spacing are never changed. Returns how many lines it is still over (0 when it fits);
    a letter that is over needs shorter text."""
    sec, step = doc.sections[0], Inches(0.05)
    footer = _footer_top(doc)
    floor = max(Inches(0.5), sec.page_height - footer + Inches(0.1)) if footer else Inches(0.6)
    short = lambda: Pt(_used(doc)) + ROOM - (sec.page_height - sec.top_margin - sec.bottom_margin)  # noqa: E731
    up = lambda length: -(-length // step) * step  # rounded up to a twentieth of an inch, as a person would set  # noqa: E731
    if short() > 0 and sec.bottom_margin > floor:
        sec.bottom_margin = Emu(max(floor, sec.bottom_margin - up(short())))
    if short() > 0:
        sec.top_margin = Emu(sec.top_margin - min(TOP_GIVE, up(short())))
    # With both margins as far as they go, a letter that fits without the little extra room is still accepted.
    line = max((b["height"] for b in blocks(doc)), default=Pt(13).pt)
    return max(0.0, (_used(doc) - _room(doc)) / line)
