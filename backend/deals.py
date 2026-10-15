"""Deals a user pitches, organised as the Finance Club's "pitch your deal in 5 steps and 90 seconds" checklist."""
from .db import connect, init_db

# Section -> the points the Finance Club deck says to have ready (Meeting #6, "The Deal").
CHECKLIST = {
    "2. Background on both companies": [
        "Buyer: business", "Buyer: market cap", "Buyer: revenue", "Buyer: EBITDA", "Buyer: number of divisions",
        "Target: business", "Target: market cap", "Target: revenue", "Target: EBITDA", "Target: number of divisions",
    ],
    "3. The deal itself": [
        "Total consideration", "Form of consideration", "Premium paid", "Purchase multiple", "Synergies", "Accretion / dilution",
    ],
    "4. Market reaction": [
        "Buyer share price reaction", "Target share price reaction", "What the market thinks",
    ],
    "5. My take": [
        "Versus public trading comps", "Versus precedent transactions", "Strategic rationale and whether it makes sense",
    ],
    "Back pocket": [
        "Timeline and status", "Financing", "Advisors", "% acquired and offer price", "Enterprise value and net debt",
        "Other options the buyer or seller explored", "Key risks for the buyer", "Termination fee",
        "Competitive landscape", "Fit with the buyer's portfolio", "Industry trend it ties to",
    ],
}
DEAL_SECTIONS = list(CHECKLIST)
INTRO = ("If it's okay, I'll start by giving some background on the companies, then talk about the deal itself, "
         "how the market reacted, and then share my take.")
TIMING = {"2. Background on both companies": "20 seconds", "3. The deal itself": "25 seconds",
          "4. Market reaction": "20 seconds", "5. My take": "20 seconds", "Back pocket": "for follow-up questions"}
FOLLOW_UPS = [
    "What are the synergies in this case? How reasonable are they?",
    "What are the trading and transaction comps used? Why are those relevant?",
    "What premium was paid? Do you think that premium is justified?",
    "What other options did the buyer or seller explore? Who were other potential targets or acquirers?",
    "Why did the buyer use cash or debt to finance this deal?",
    "What were the key risks for the buyer in making this acquisition?",
    "How did the markets react? What was the impact on share price?",
    "What is the termination fee?",
]


def ensure_deal(conn, uid: int, title: str, banks: str, status: str = "", notes: str = "") -> int:
    """Create the user's deal if needed and make sure it has every checklist point (blank until filled in)."""
    conn.execute("INSERT OR IGNORE INTO deals (user_id, title, banks, status, notes) VALUES (?, ?, ?, ?, ?)", (uid, title, banks, status, notes))
    deal_id = conn.execute("SELECT id FROM deals WHERE user_id = ? AND title = ?", (uid, title)).fetchone()[0]
    for section, labels in CHECKLIST.items():
        for label in labels:
            conn.execute("INSERT OR IGNORE INTO deal_points (deal_id, section, label) VALUES (?, ?, ?)", (deal_id, section, label))
    return deal_id


def set_point(conn, deal_id: int, section: str, label: str, value: str, source: str = "") -> None:
    conn.execute(
        """INSERT INTO deal_points (deal_id, section, label, value, source) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(deal_id, section, label) DO UPDATE SET value = excluded.value, source = excluded.source""",
        (deal_id, section, label, value, source),
    )


def add_deal(uid: int, title: str, banks: list[str]) -> dict:
    title = " ".join(title.split())
    if not title:
        return {"ok": False, "reason": "Give the deal a name, for example \"Buyer acquiring Target\"."}
    init_db()
    conn = connect()
    try:
        with conn:
            if conn.execute("SELECT 1 FROM deals WHERE user_id = ? AND title = ? COLLATE NOCASE", (uid, title)).fetchone():
                return {"ok": False, "reason": "You already have a deal with that name."}
            ensure_deal(conn, uid, title, ", ".join(b.strip() for b in banks if b.strip()))
    finally:
        conn.close()
    return {"ok": True}


def all_deals(uid: int) -> dict:
    init_db()
    with connect(read_only=True) as conn:
        deals = [dict(r) for r in conn.execute("SELECT * FROM deals WHERE user_id = ? ORDER BY id", (uid,))]
        points = [dict(r) for r in conn.execute(
            "SELECT * FROM deal_points WHERE deal_id IN (SELECT id FROM deals WHERE user_id = ?) ORDER BY id", (uid,))]
    for d in deals:
        mine = [p for p in points if p["deal_id"] == d["id"]]
        d["banks"] = [b.strip() for b in d["banks"].split(",") if b.strip()]
        d["sections"] = [
            {"name": s, "timing": TIMING[s], "points": [p for p in mine if p["section"] == s]} for s in DEAL_SECTIONS
        ]
        d["filled"] = sum(bool(p["value"]) for p in mine)
        d["total"] = len(mine)
    return {"deals": deals, "intro": INTRO, "follow_ups": FOLLOW_UPS}
