"""Who the user is (school and program), and what that changes.

Every account picks a school and a program level in setup. That decides:
- the wording the app uses ("Summer Associate" for MBA students, "Summer Analyst" for undergrads; "2Y" for a
  second-year MBA classmate, "student" otherwise; "<School> alum");
- whether the school's own club material is shown. The Yale SOM Finance Club question banks, application
  tracker and calendar are the club's material, so they are only shown to Yale SOM accounts that signed up
  with a yale.edu email address (anyone can type "Yale SOM" as their school).
"""
from .db import connect, init_db

KNOWN = {
    "Yale SOM": {"full": "the Yale School of Management", "short": "Yale", "level": "mba", "club": True, "email_domain": "yale.edu"},
    "University of Arizona": {"full": "the University of Arizona", "short": "Arizona", "level": "undergrad", "club": False},
}
LEVELS = {"mba": "MBA", "undergrad": "Undergraduate"}

INDUSTRY_GROUPS = [
    "Consumer & Retail", "Technology", "Media & Telecom", "Healthcare", "Industrials", "Power & Utilities",
    "Energy / Natural Resources", "Financial Institutions (FIG)", "Real Estate, Gaming & Lodging", "Transportation",
    "Financial Sponsors",
]
PRODUCT_GROUPS = ["M&A", "Leveraged Finance", "Equity Capital Markets", "Debt Capital Markets", "Restructuring"]


def _email_matches(email: str, domain: str) -> bool:
    host = email.rsplit("@", 1)[-1].lower() if "@" in email else ""
    return host == domain or host.endswith("." + domain)


def describe(school: str, level: str, class_year: str = "", email: str = "") -> dict:
    known = KNOWN.get(school, {})
    level = level or known.get("level", "mba")
    short = known.get("short") or (school.split(" ")[-1] if school else "")
    mba = level == "mba"
    return {
        "school": school,
        "school_full": known.get("full") or school,
        "short": short,
        "level": level,
        "class_year": class_year,
        "role": "Summer Associate" if mba else "Summer Analyst",
        "peer": "2Y" if mba else "student",  # a current student who has already been through recruiting
        "peers": f"{short} 2Ys and classmates" if mba else f"{short} students and classmates",
        "alum": f"{short} alum" if short else "alum",
        # the school's own club material (question banks, deadlines, calendar), for verified school emails only
        "club": bool(known.get("club")) and _email_matches(email, known.get("email_domain", "")),
    }


def for_user(uid: int, conn=None) -> dict:
    if conn is None:
        init_db()
        with connect(read_only=True) as c:
            return for_user(uid, c)
    row = conn.execute("SELECT school, level, class_year FROM user_profiles WHERE user_id = ?", (uid,)).fetchone()
    email = (conn.execute("SELECT email FROM users WHERE id = ?", (uid,)).fetchone() or [""])[0] or ""
    return describe(*(row if row else ("", "", "")), email=email)


def default_school_line(ctx: dict) -> str:
    if not ctx["school"]:
        return ""
    if ctx["level"] == "mba":
        return f"a first-year MBA candidate at {ctx['school_full']}"
    return f"a student at {ctx['school_full']}"


def options() -> dict:
    return {"schools": list(KNOWN), "levels": LEVELS, "industry_groups": INDUSTRY_GROUPS, "product_groups": PRODUCT_GROUPS}
