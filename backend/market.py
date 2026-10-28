"""Preview: how each company's shares reacted to a deal, from Yahoo Finance's daily price history.

For the buyer and the target: the move on the day the deal was announced (its close against the close the day
before), and where the shares stood one month later, six months later (once that has passed) and today, each against
that same close the day before the announcement. No AI: the tickers come from Yahoo's search and the numbers from its
chart data, and each point links to the Yahoo Finance history page it came from.
"""
import re
from datetime import date, datetime, timedelta

import httpx2 as httpx  # installed with the openai package

from . import deal_sources
from .db import connect, init_db

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Recruiting HQ"}
CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
SEARCH = "https://query2.finance.yahoo.com/v1/finance/search"
MONTHS = {m: i for i, m in enumerate(("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"), 1)}


def ticker(name: str) -> str:
    """The company's main listed share on Yahoo Finance, or '' for a private company."""
    if not name:
        return ""
    r = httpx.get(SEARCH, params={"q": name, "quotesCount": 5, "newsCount": 0}, headers=HEADERS, timeout=20)
    r.raise_for_status()
    quotes = [q for q in r.json().get("quotes", []) if q.get("quoteType") == "EQUITY" and q.get("symbol")]
    return quotes[0]["symbol"] if quotes else ""


def history(symbol: str, start: date) -> tuple[list[tuple[date, float]], str]:
    """[(day, close)] from a week before `start` to today, and the currency."""
    period1 = int(datetime.combine(start - timedelta(days=10), datetime.min.time()).timestamp())
    r = httpx.get(CHART.format(symbol=symbol), params={"period1": period1, "period2": int(datetime.now().timestamp()), "interval": "1d"},
                  headers=HEADERS, timeout=20)
    r.raise_for_status()
    res = r.json()["chart"]["result"][0]
    closes = res["indicators"]["quote"][0]["close"]
    days = [(datetime.fromtimestamp(t).date(), c) for t, c in zip(res["timestamp"], closes) if c is not None]
    return days, res["meta"].get("currency", "")


def announced_on(deal_id: int, uid: int) -> date | None:
    """The announcement date written in the deal's timeline point ("announced May-14-2026", "2026-06-09")."""
    with connect(read_only=True) as conn:
        row = conn.execute("""SELECT p.value FROM deal_points p JOIN deals d ON d.id = p.deal_id
                              WHERE p.deal_id = ? AND d.user_id = ? AND p.label = 'Timeline and status'""", (deal_id, uid)).fetchone()
    text = (row["value"] if row else "") or ""
    # "announced May-14-2026", "announced July 10, 2026", or "announced July 10" (the year from elsewhere in the note)
    m = re.search(r"announced\D{0,12}?([A-Za-z]{3})[a-z]*\.?[- ](\d{1,2})(?:,?[- ](\d{4}))?", text, re.I)
    if m and m[1].lower() in MONTHS:
        year = m[3] or (re.search(r"\b(20\d{2})\b", text) or [None, str(date.today().year)])[1]
        return date(int(year), MONTHS[m[1].lower()], int(m[2]))
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", text)
    return date(int(m[1]), int(m[2]), int(m[3])) if m else None


def _money(value: float, currency: str) -> str:
    return f"{value:,.0f}p" if currency == "GBp" else f"{'$' if currency == 'USD' else currency + ' '}{value:,.2f}"


def reaction(days: list[tuple[date, float]], currency: str, announced: date) -> str:
    before = [(d, c) for d, c in days if d < announced]
    after = [(d, c) for d, c in days if d >= announced]
    if not before or not after:
        return ""
    base_day, base = before[-1]
    first_day, first = after[0]
    move = lambda c: f"{(c / base - 1) * 100:+.1f}%"  # noqa: E731
    parts = [f"Announcement day ({first_day:%b} {first_day.day}): {move(first)} to {_money(first, currency)}"]
    for label, months in (("1 month later", 1), ("6 months later", 6)):
        target = announced + timedelta(days=round(30.4 * months))
        later = [(d, c) for d, c in after if d >= target]
        if later:
            parts.append(f"{label} ({later[0][0]:%b} {later[0][0].day}): {move(later[0][1])}")
        else:
            parts.append(f"{label}: not yet ({target:%b} {target.day}, {target.year})")
    parts.append(f"today: {move(after[-1][1])} at {_money(after[-1][1], currency)}")
    return "; ".join(parts) + f" (all against {_money(base, currency)} on {base_day:%b} {base_day.day}, the day before)"


def fill(uid: int, deal_id: int, announced: str = "") -> dict:
    """Fill the buyer's and target's share price reaction for one deal."""
    init_db()
    with connect(read_only=True) as conn:
        deal = conn.execute("SELECT title FROM deals WHERE id = ? AND user_id = ?", (deal_id, uid)).fetchone()
    if deal is None:
        return {"ok": False, "reason": "Deal not found."}
    try:
        when = date.fromisoformat(announced) if announced else announced_on(deal_id, uid)
    except ValueError:
        when = None
    if when is None:
        return {"ok": False, "reason": "Enter the date the deal was announced."}
    buyer, target = deal_sources.parties(deal["title"])
    filled, notes = 0, []
    for side, name in (("Buyer", buyer), ("Target", target)):
        try:
            symbol = ticker(name)
            if not symbol:
                notes.append(f"{name}: no listed shares on Yahoo Finance.")
                continue
            days, currency = history(symbol, when)
            value = reaction(days, currency, when)
        except (httpx.HTTPError, KeyError, IndexError, TypeError) as exc:
            notes.append(f"{name}: Yahoo Finance didn't answer ({type(exc).__name__}).")
            continue
        if not value:
            notes.append(f"{name} ({symbol}): no prices around {when:%b %d, %Y}.")
            continue
        source = f"Yahoo Finance {symbol} price history https://finance.yahoo.com/quote/{symbol}/history"
        with connect() as conn:
            conn.execute("""UPDATE deal_points SET value = ?, source = ?, source_kind = '', doc_id = '', page = '', quote = ''
                            WHERE deal_id = ? AND label = ?""", (f"{symbol}: {value}", source, deal_id, f"{side} share price reaction"))
        filled += 1
    message = f"Filled {filled} share price reaction{'s' if filled != 1 else ''} from Yahoo Finance (announced {when:%b %d, %Y})."
    return {"ok": filled > 0, "message": " ".join([message, *notes]), "announced": when.isoformat()}
