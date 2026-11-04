"""Map the different labels used across the question banks onto one vocabulary."""
import re

UNKNOWN = "Unknown"

_BANKS = {
    "ms": "Morgan Stanley",
    "gs": "Goldman Sachs",
    "goldman": "Goldman Sachs",
    "jpm": "J.P. Morgan",
    "jp morgan": "J.P. Morgan",
    "jpmorgan": "J.P. Morgan",
    "j.p. morgan": "J.P. Morgan",
    "bofa": "Bank of America",
    "boa": "Bank of America",
    "baml": "Bank of America",
    "baml london": "Bank of America",
    "bank of america": "Bank of America",
    "cs": "Credit Suisse",
    "wellsfargo": "Wells Fargo",
    "citi": "Citi",
    "hl": "Houlihan Lokey",
    "hw": "Harris Williams",
    # the firms' longer names, as emails and signatures write them
    "guggenheim securities": "Guggenheim",
    "guggenheim partners": "Guggenheim",
    "perella weinberg": "PWP",
    "perella weinberg partners": "PWP",
    "perella": "PWP",
    "pjt partners": "PJT",
    "centerview partners": "Centerview",
    "rothschild & co": "Rothschild",
    "rothschild and co": "Rothschild",
    "evercore partners": "Evercore",
    "evercore isi": "Evercore",
    "lazard freres": "Lazard",
    "barclays capital": "Barclays",
    "wells fargo securities": "Wells Fargo",
    "citigroup": "Citi",
    "citigroup global markets": "Citi",
    "bank of america merrill lynch": "Bank of America",
    "bofa securities": "Bank of America",
    "jpmorgan chase": "J.P. Morgan",
    "j.p. morgan chase": "J.P. Morgan",
    "jp morgan chase": "J.P. Morgan",
}
# words that only make a firm's name longer ("Guggenheim Securities, LLC", "PJT Partners")
_FIRM_SUFFIX = re.compile(r"[,\s]+(securities|partners|& co\.?|and co\.?|llc|l\.l\.c\.|inc\.?|lp|l\.p\.|capital|group|"
                          r"investment banking|investment bank)$", re.I)
_ROUNDS = {
    "cc": "Coffee Chat",
    "cc.": "Coffee Chat",
    "cc 1": "Coffee Chat",
    "1": "Round 1",
    "r1": "Round 1",
    "2": "Round 2",
    "r2": "Round 2",
    "sd": "Superday",
    "superday": "Superday",
    "hirevue": "HireVue",
}
_TYPES = {
    "t": "Technical",
    "technical": "Technical",
    "b": "Behavioral",
    "behavioral": "Behavioral",
    "behavoral": "Behavioral",
    "bt": "Brain Teaser",
    "brain teaser": "Brain Teaser",
    "d": "Deal",
    "deal": "Deal",
    "trend": "Trend",
    "trends": "Trend",
}
_OFFICES = {"nyc": "New York", "sf": "San Francisco", "la": "Los Angeles", "charlotte, nc": "Charlotte"}
_BLANKS = {"", "unknown", "u/k", "n/a", "na", "none", "-"}


def clean(value) -> str:
    return re.sub(r"\s+", " ", str(value)).strip() if value is not None else ""


def clean_text(value) -> str:
    """Notes and summaries: spaces tidied like clean, but paragraphs (blank lines) and line breaks kept."""
    if value is None:
        return ""
    lines = [re.sub(r"[ \t\f\v]+", " ", line).strip() for line in str(value).replace("\r", "").split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def _lookup(value, table: dict, default_unknown: bool = True) -> str:
    text = clean(value)
    if text.lower() in _BLANKS:
        return UNKNOWN if default_unknown else ""
    return table.get(text.lower(), text)


def bank(value) -> str:
    """A bank's usual short name. Longer forms ("Guggenheim Securities, LLC", "PWP (Perella Weinberg)") become the
    known bank they name, so one firm is never filed as two banks."""
    name = _lookup(value, _BANKS)
    if name == UNKNOWN:
        return name
    from . import banks as bank_info

    known = {b.lower(): b for b in bank_info.DOMAINS}
    candidates = [name, *re.findall(r"\(([^)]+)\)", name), re.sub(r"\s*\([^)]*\)", "", name)]
    for candidate in candidates:
        text = candidate.strip()
        for _ in range(3):  # "Rothschild & Co, LLC": peel the extra words one at a time
            hit = _BANKS.get(text.lower()) or known.get(text.lower())
            if hit:
                return hit
            shorter = _FIRM_SUFFIX.sub("", text).strip()
            if shorter == text:
                break
            text = shorter
    return name


def round_(value) -> str:
    return _lookup(value, _ROUNDS)


def qtype(value) -> str:
    return _lookup(value, _TYPES)


def office(value) -> str:
    return _lookup(value, _OFFICES, default_unknown=False)


def optional(value) -> str:
    return _lookup(value, {}, default_unknown=False)
