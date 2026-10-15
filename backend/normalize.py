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
}
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


def _lookup(value, table: dict, default_unknown: bool = True) -> str:
    text = clean(value)
    if text.lower() in _BLANKS:
        return UNKNOWN if default_unknown else ""
    return table.get(text.lower(), text)


def bank(value) -> str:
    return _lookup(value, _BANKS)


def round_(value) -> str:
    return _lookup(value, _ROUNDS)


def qtype(value) -> str:
    return _lookup(value, _TYPES)


def office(value) -> str:
    return _lookup(value, _OFFICES, default_unknown=False)


def optional(value) -> str:
    return _lookup(value, {}, default_unknown=False)
