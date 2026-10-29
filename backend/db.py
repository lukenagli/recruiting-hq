import json
import sqlite3
from datetime import datetime

from . import config

# Tables shared by everyone: the Finance Club question banks, the shared application tracker and the
# club calendar. Every other table belongs to one user and carries a user_id.
SHARED_SCHEMA = """
CREATE TABLE IF NOT EXISTS questions (
    id            INTEGER PRIMARY KEY,
    source        TEXT NOT NULL,   -- live_1y | live_2y | master | ib_2025 | technical
    year          TEXT,
    qtype         TEXT NOT NULL,   -- Technical | Behavioral | Brain Teaser | Trend | Deal
    bank          TEXT NOT NULL,
    office        TEXT,
    grp           TEXT,
    round         TEXT NOT NULL,   -- Coffee Chat | Round 1 | Round 2 | Superday | HireVue | Unknown
    interviewer   TEXT,
    topic         TEXT,
    question      TEXT NOT NULL,
    answer_notes  TEXT,
    dedupe_key    TEXT NOT NULL UNIQUE,
    first_seen    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_questions_bank_round ON questions (bank, round);

CREATE TABLE IF NOT EXISTS applications (
    bank               TEXT PRIMARY KEY,
    official_deadline  TEXT,
    recommended_date   TEXT,
    link               TEXT,
    cover_letter       TEXT,
    other_info         TEXT,
    updated_at         TEXT NOT NULL
);

-- Key recruiting dates (from the Finance Club decks).
CREATE TABLE IF NOT EXISTS calendar_items (
    id      INTEGER PRIMARY KEY,
    date    TEXT NOT NULL,
    end     TEXT,
    title   TEXT NOT NULL,
    detail  TEXT,
    source  TEXT
);

-- Site-wide settings, such as the club's standard email templates (key -> JSON value).
CREATE TABLE IF NOT EXISTS app_settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS imports (
    id          INTEGER PRIMARY KEY,
    source      TEXT NOT NULL,
    file        TEXT NOT NULL,
    file_mtime  TEXT,
    rows_read   INTEGER NOT NULL,
    rows_new    INTEGER NOT NULL,
    ran_at      TEXT NOT NULL
);

-- Accounts. Passwords are stored only as salted scrypt hashes.
CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY,
    email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name           TEXT NOT NULL,
    password_hash  TEXT NOT NULL,     -- blank for the placeholder that owns data from before accounts existed
    api_provider   TEXT DEFAULT '',   -- anthropic | openai | blank: whose AI key this account uses
    api_key_enc    TEXT DEFAULT '',   -- the account's own key, encrypted (user_keys.py); never sent to the browser
    api_key_hint   TEXT DEFAULT '',   -- last four characters, for display
    is_admin       INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL
);

-- One-time 6-digit codes emailed to confirm an address or reset a password. Only a hash is stored.
CREATE TABLE IF NOT EXISTS email_codes (
    id          INTEGER PRIMARY KEY,
    email       TEXT NOT NULL COLLATE NOCASE,
    purpose     TEXT NOT NULL,      -- verify | reset
    code_hash   TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    attempts    INTEGER NOT NULL DEFAULT 0,
    used        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_codes_email ON email_codes (email, purpose, created_at);

-- Login sessions. Only a hash of each session token is stored.
CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users (id),
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL
);
"""

# Per-user tables, kept separately so an older database can be rebuilt with these exact definitions.
USER_TABLES = {
    # The user's own network: who they have met, what happened, and how each step led to the next.
    "people": """
CREATE TABLE IF NOT EXISTS people (
    id                  INTEGER PRIMARY KEY,
    user_id             INTEGER NOT NULL,
    name                TEXT NOT NULL,
    title               TEXT,
    bank                TEXT NOT NULL,
    grp                 TEXT,
    subgroup            TEXT,
    email               TEXT,
    outreach            TEXT,            -- outreach date(s) as text, e.g. "2026-09-24, 2026-10-05"
    origin              TEXT NOT NULL,   -- outreach | event | classmate | listed (known of, not spoken with)
    notes               TEXT,
    alum                TEXT DEFAULT '', -- yes | no | student (current Yale 2Y) | blank when not known
    linkedin_url        TEXT DEFAULT '',
    background          TEXT DEFAULT '', -- public-web summary, kept apart from the user's own notes
    background_sources  TEXT DEFAULT '',
    background_at       TEXT DEFAULT '',
    UNIQUE (user_id, name, bank)
)""",
    "interactions": """
CREATE TABLE IF NOT EXISTS interactions (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL,
    bank         TEXT NOT NULL,
    kind         TEXT NOT NULL,   -- coffee_chat | event | interview | step
    title        TEXT NOT NULL,
    date         TEXT,            -- ISO date, blank when not known
    date_note    TEXT,            -- e.g. "Friday evening", "around Oct 11 to 12"
    format       TEXT,            -- In person | Phone | Zoom | blank when not recorded
    status       TEXT NOT NULL,   -- done | upcoming | todo
    summary      TEXT,
    thank_you    TEXT,            -- ISO date sent, "sent", "n/a", or blank when still owed
    invite_only  TEXT DEFAULT ''  -- events: "yes" if only some candidates were invited
)""",
    # An arrow on a bank's journey map. Each end is "person:<id>" or "interaction:<id>".
    "links": """
CREATE TABLE IF NOT EXISTS links (
    id       INTEGER PRIMARY KEY,
    user_id  INTEGER NOT NULL,
    bank     TEXT NOT NULL,
    src      TEXT NOT NULL,
    dst      TEXT NOT NULL,
    label    TEXT
)""",
    "my_banks": """
CREATE TABLE IF NOT EXISTS my_banks (
    user_id   INTEGER NOT NULL,
    bank      TEXT NOT NULL,
    applied   TEXT,    -- Yes | No | blank
    deadline  TEXT,
    link      TEXT,
    prefs     TEXT,    -- group preferences in order, " > " separated
    notes     TEXT,
    status    TEXT DEFAULT '',   -- blank while live, "out" once cut or dropped (reason in notes)
    stage     TEXT DEFAULT '',   -- "" not started, then yale | bank | dinner | superday | offer
    recruiter_name   TEXT DEFAULT '',  -- who the cover letter is addressed to
    recruiter_title  TEXT DEFAULT '',
    address          TEXT DEFAULT '',  -- office address for the cover letter (overrides the built-in one)
    office           TEXT DEFAULT '',  -- office applied to, e.g. New York
    PRIMARY KEY (user_id, bank)
)""",
    # What the user has learned about each bank itself (program, staffing, headcount, process).
    "bank_facts": """
CREATE TABLE IF NOT EXISTS bank_facts (
    id        INTEGER PRIMARY KEY,
    user_id   INTEGER NOT NULL,
    bank      TEXT NOT NULL,
    category  TEXT NOT NULL,
    fact      TEXT NOT NULL,
    source    TEXT,
    added_at  TEXT NOT NULL
)""",
    # Deals the user pitches in interviews, laid out as the Finance Club's 90-second pitch checklist.
    "deals": """
CREATE TABLE IF NOT EXISTS deals (
    id       INTEGER PRIMARY KEY,
    user_id  INTEGER NOT NULL,
    title    TEXT NOT NULL,
    banks    TEXT NOT NULL,   -- banks it is used for, comma separated
    status   TEXT,
    notes    TEXT,
    UNIQUE (user_id, title)
)""",
    # Speech-to-text from a recorded chat or a dictated recap. Text only; no audio is kept.
    "transcripts": """
CREATE TABLE IF NOT EXISTS transcripts (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    started_at  TEXT NOT NULL,
    label       TEXT NOT NULL,
    mode        TEXT NOT NULL,   -- conversation | recap
    text        TEXT NOT NULL
)""",
    # Thank-you notes drafted for the user to copy and send. The app never sends anything.
    "thank_you_drafts": """
CREATE TABLE IF NOT EXISTS thank_you_drafts (
    id              INTEGER PRIMARY KEY,
    user_id         INTEGER NOT NULL,
    interaction_id  INTEGER NOT NULL REFERENCES interactions (id),
    person_id       INTEGER NOT NULL REFERENCES people (id),
    body            TEXT NOT NULL,
    check_line      TEXT NOT NULL,
    send_line       TEXT NOT NULL,
    warnings        TEXT NOT NULL DEFAULT '[]',
    created_at      TEXT NOT NULL,
    sent_at         TEXT
)""",
    # Audit trail: one row per agent run, with every tool call, token counts, and a snapshot of the
    # user's tracker taken before the run so it can be undone.
    "agent_runs": """
CREATE TABLE IF NOT EXISTS agent_runs (
    id                   INTEGER PRIMARY KEY,
    user_id              INTEGER NOT NULL,
    started_at           TEXT NOT NULL,
    agent                TEXT NOT NULL,
    user_message         TEXT NOT NULL,
    reply                TEXT,
    steps                TEXT NOT NULL,   -- JSON list of {tool, args, result}
    outcome              TEXT NOT NULL,   -- ok | limit | error | budget | rule_warnings
    requests             INTEGER NOT NULL DEFAULT 0,
    input_tokens         INTEGER NOT NULL DEFAULT 0,
    cached_input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens        INTEGER NOT NULL DEFAULT 0,
    snapshot             TEXT,            -- JSON of the user's tracker before the run; NULL if nothing changed
    undone               INTEGER NOT NULL DEFAULT 0
)""",
}

# Columns added to existing tables after they first shipped: (table, column).
LATER_COLUMNS = [
    ("users", "api_provider"), ("users", "api_key_enc"), ("users", "api_key_hint"), ("users", "email_verified_at"),
    ("interactions", "invite_only"),
    ("my_banks", "recruiter_name"), ("my_banks", "recruiter_title"), ("my_banks", "address"), ("my_banks", "office"),
    # Who the user is, set in the first-run setup (schools.py turns these into wording and features).
    ("user_profiles", "school"), ("user_profiles", "level"), ("user_profiles", "class_year"), ("user_profiles", "target_groups"),
    ("user_profiles", "email_template"), ("user_profiles", "email_rules"), ("user_profiles", "onboarded_at"),
    # The user's cover letter Word file (letters are written into a copy of it) and their email templates (JSON).
    ("user_profiles", "cover_template"), ("user_profiles", "cover_template_name"), ("user_profiles", "email_templates"),
    # What the user wants their letters and interview answers to draw on (replacing one free-text "story" box).
    ("user_profiles", "why_group"), ("user_profiles", "highlights"), ("user_profiles", "projects"),
    # Where each deal number came from: document | official | web | user, plus the document page and exact quote.
    ("deal_points", "source_kind"), ("deal_points", "doc_id"), ("deal_points", "page"), ("deal_points", "quote"),
    # A scanned or screenshot PDF has no text layer: "yes" until the AI has transcribed it, then "read".
    ("deal_documents", "scanned"),
    # When the student sent the letter (preview): drafts for other banks in the same group start from it.
    ("cover_letters", "submitted_at"),
]

# What each user tells the app about themselves, used to write their cover letters.
PROFILE_SCHEMA = """
CREATE TABLE IF NOT EXISTS user_profiles (
    user_id         INTEGER PRIMARY KEY,
    resume_text     TEXT DEFAULT '',   -- extracted from an uploaded resume, or pasted
    story           TEXT DEFAULT '',   -- why banking, why this industry, stories to use, things never to say
    example_letter  TEXT DEFAULT '',   -- a letter the user already likes, used as a style reference
    contact_line    TEXT DEFAULT '',   -- footer: address | phone | email
    school_line     TEXT DEFAULT '',   -- e.g. first-year MBA candidate at the Yale School of Management
    updated_at      TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS cover_letters (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL,
    bank         TEXT NOT NULL,
    paragraphs   TEXT NOT NULL,       -- JSON list of the body paragraphs
    warnings     TEXT NOT NULL DEFAULT '[]',
    edited       INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    UNIQUE (user_id, bank)
);

-- Interview practice: one row per answered question, for the progress view. Users can delete rows.
CREATE TABLE IF NOT EXISTS prep_attempts (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL,
    at           TEXT NOT NULL,
    qkey         TEXT NOT NULL,        -- q:<question id> or tpl:<template>:<seed>
    category     TEXT NOT NULL,        -- Behavioral | Technical | Deal | Markets
    topic        TEXT DEFAULT '',      -- technical area, e.g. DCF
    difficulty   TEXT DEFAULT '',
    bank         TEXT DEFAULT '',
    question     TEXT NOT NULL,
    answer       TEXT DEFAULT '',
    verdict      TEXT,                 -- correct | partial | incorrect | NULL (not graded yet)
    score        REAL,
    feedback     TEXT DEFAULT '',
    explanation  TEXT DEFAULT '',
    graded_by    TEXT DEFAULT ''       -- ai | check | self
);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON prep_attempts (user_id, at);

-- Documents a user uploads for a deal (SEC filings, press releases, investor decks), kept so every number
-- taken from them can link back to the page it came from.
CREATE TABLE IF NOT EXISTS deal_documents (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL,
    deal_id      INTEGER NOT NULL,
    filename     TEXT NOT NULL,
    kind         TEXT DEFAULT '',     -- what the user said it is (merger agreement, 10-K, press release, ...)
    pages        TEXT NOT NULL,       -- JSON list of each page's extracted text
    data         BLOB NOT NULL,       -- the original file
    size         INTEGER NOT NULL,
    uploaded_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_docs_deal ON deal_documents (user_id, deal_id);
"""

# Child tables: they belong to a user through their parent row, so they need no user_id of their own.
CHILD_SCHEMA = """
CREATE TABLE IF NOT EXISTS interaction_people (
    interaction_id INTEGER NOT NULL REFERENCES interactions (id),
    person_id      INTEGER NOT NULL REFERENCES people (id),
    notes          TEXT,
    PRIMARY KEY (interaction_id, person_id)
);

CREATE TABLE IF NOT EXISTS interaction_questions (
    id             INTEGER PRIMARY KEY,
    interaction_id INTEGER NOT NULL REFERENCES interactions (id),
    direction      TEXT NOT NULL,   -- asked_me | i_asked
    question       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deal_points (
    id       INTEGER PRIMARY KEY,
    deal_id  INTEGER NOT NULL REFERENCES deals (id),
    section  TEXT NOT NULL,   -- one of DEAL_SECTIONS in deals.py
    label    TEXT NOT NULL,
    value    TEXT NOT NULL DEFAULT '',   -- blank means "still need to find this"
    source   TEXT,
    UNIQUE (deal_id, section, label)
);

CREATE INDEX IF NOT EXISTS idx_people_user ON people (user_id, bank);
CREATE INDEX IF NOT EXISTS idx_interactions_user ON interactions (user_id, bank);
CREATE INDEX IF NOT EXISTS idx_runs_user ON agent_runs (user_id, started_at);
"""

# Columns added to per-user tables before accounts existed (only needed when upgrading an old database).
_OLD_ADDED_COLUMNS = {
    "people": ("alum", "linkedin_url", "background", "background_sources", "background_at"),
    "my_banks": ("status", "stage"),
}
_initialised_for = None  # the database path init_db last set up, so repeat calls are cheap


def connect(read_only: bool = False) -> sqlite3.Connection:
    if read_only:
        conn = sqlite3.connect(f"{config.DB_PATH.as_uri()}?mode=ro", uri=True)
    else:
        config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(config.DB_PATH, timeout=15)
        # WAL lets reads continue during a write, and is what the hosted site's backup (Litestream) copies from.
        conn.execute("PRAGMA journal_mode=WAL")
    conn.row_factory = sqlite3.Row
    return conn


def _columns(conn, table: str) -> set[str]:
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


def _upgrade_to_accounts(conn) -> None:
    """Older databases had one implicit owner. Give every row to a placeholder account (id 1); the first
    person to sign up on that database claims it (see accounts.sign_up)."""
    for table, columns in _OLD_ADDED_COLUMNS.items():
        for column in columns:
            if column not in _columns(conn, table):
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} TEXT DEFAULT ''")
    if conn.execute("SELECT 1 FROM people LIMIT 1").fetchone() and not conn.execute("SELECT 1 FROM users WHERE id = 1").fetchone():
        conn.execute("INSERT INTO users (id, email, name, password_hash, is_admin, created_at) VALUES (1, '', '', '', 1, ?)",
                     (datetime.now().isoformat(timespec="seconds"),))
    for table, ddl in USER_TABLES.items():
        old = _columns(conn, table)
        if "user_id" in old:
            continue
        conn.execute(f"ALTER TABLE {table} RENAME TO {table}_old")
        conn.execute(ddl)
        keep = [c for c in _columns(conn, table) if c in old]
        conn.execute(f"INSERT INTO {table} (user_id, {', '.join(keep)}) SELECT 1, {', '.join(keep)} FROM {table}_old")
        conn.execute(f"DROP TABLE {table}_old")


def init_db() -> None:
    global _initialised_for
    if _initialised_for == config.DB_PATH and config.DB_PATH.exists():
        return
    conn = connect()
    try:
        with conn:
            conn.executescript(SHARED_SCHEMA)
            if "user_id" not in _columns(conn, "people") and _columns(conn, "people"):
                _upgrade_to_accounts(conn)
            for ddl in USER_TABLES.values():
                conn.execute(ddl)
            conn.executescript(CHILD_SCHEMA)
            conn.executescript(PROFILE_SCHEMA)
            for table, column in LATER_COLUMNS:
                if column not in _columns(conn, table):
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} TEXT DEFAULT ''")
                    if (table, column) == ("users", "email_verified_at"):
                        # accounts made before email checks existed count as confirmed
                        conn.execute("UPDATE users SET email_verified_at = created_at WHERE password_hash != ''")
            # The calendar used to live in a private JSON file; copy it in the first time.
            if config.RECRUITING_CALENDAR.is_file() and not conn.execute("SELECT 1 FROM calendar_items").fetchone():
                for item in json.loads(config.RECRUITING_CALENDAR.read_text(encoding="utf-8")):
                    conn.execute("INSERT INTO calendar_items (date, end, title, detail, source) VALUES (?, ?, ?, ?, ?)",
                                 (item["date"], item.get("end", ""), item["title"], item.get("detail", ""), item.get("source", "")))
    finally:
        conn.close()
    _initialised_for = config.DB_PATH
