"""Accounts and login sessions.

- Passwords are stored as salted scrypt hashes; session tokens are random and only their SHA-256 is stored.
- Anyone with the link can create an account. AI features run on each person's own Claude or OpenAI key
  (see user_keys.py), so new accounts never spend the site owner's course key.
- Repeated wrong passwords for one email are slowed down (10 tries per 15 minutes).
- A brand-new account starts with an empty tracker plus the banks from the shared application tracker.
"""
import hashlib
import hmac
import re
import secrets
import time
from collections import defaultdict
from datetime import datetime, timedelta

from . import config
from .db import connect, init_db

SESSION_DAYS = 365
_failures: dict[str, list[float]] = defaultdict(list)


class AccountError(Exception):
    """A message that is safe to show the person signing up or logging in."""


def _hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${digest.hex()}"


def _password_matches(password: str, stored: str) -> bool:
    try:
        _, salt, _ = stored.split("$")
    except ValueError:
        return False
    return hmac.compare_digest(_hash_password(password, bytes.fromhex(salt)), stored)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _new_session(conn, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    now = datetime.now()
    conn.execute("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                 (_token_hash(token), user_id, now.isoformat(timespec="seconds"),
                  (now + timedelta(days=SESSION_DAYS)).isoformat(timespec="seconds")))
    return token


def public(user) -> dict:
    return {"id": user["id"], "email": user["email"], "name": user["name"], "is_admin": bool(user["is_admin"])}


def sign_up(email: str, name: str, password: str) -> tuple[dict, str]:
    email, name = email.strip().lower(), " ".join(name.split())
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise AccountError("Enter a valid email address.")
    if not name:
        raise AccountError("Enter your name.")
    if len(password) < 8:
        raise AccountError("Use a password of at least 8 characters.")
    init_db()
    conn = connect()
    try:
        with conn:
            if conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
                raise AccountError("An account with that email already exists. Log in instead.")
            real_users = conn.execute("SELECT COUNT(*) FROM users WHERE password_hash != ''").fetchone()[0]
            placeholder = conn.execute("SELECT id FROM users WHERE password_hash = ''").fetchone()
            now = datetime.now().isoformat(timespec="seconds")
            if placeholder and real_users == 0:
                # The first account on a database from before accounts existed takes over its data.
                user_id = placeholder["id"]
                conn.execute("UPDATE users SET email = ?, name = ?, password_hash = ?, is_admin = 1 WHERE id = ?",
                             (email, name, _hash_password(password), user_id))
            else:
                user_id = conn.execute(
                    "INSERT INTO users (email, name, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?)",
                    (email, name, _hash_password(password), int(real_users == 0), now)).lastrowid
                for row in conn.execute("SELECT bank FROM applications ORDER BY bank").fetchall():
                    conn.execute("INSERT OR IGNORE INTO my_banks (user_id, bank, applied, deadline, link, prefs, notes) VALUES (?, ?, '', '', '', '', '')",
                                 (user_id, row["bank"]))
            token = _new_session(conn, user_id)
            user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return public(user), token
    finally:
        conn.close()


def log_in(email: str, password: str) -> tuple[dict, str]:
    email = email.strip().lower()
    recent = [t for t in _failures[email] if t > time.time() - 900]
    _failures[email] = recent
    if len(recent) >= 10:
        raise AccountError("Too many wrong passwords. Wait 15 minutes and try again.")
    init_db()
    conn = connect()
    try:
        with conn:
            user = conn.execute("SELECT * FROM users WHERE email = ? AND password_hash != ''", (email,)).fetchone()
            if user is None or not _password_matches(password, user["password_hash"]):
                _failures[email].append(time.time())
                raise AccountError("Wrong email or password.")
            _failures.pop(email, None)
            return public(user), _new_session(conn, user["id"])
    finally:
        conn.close()


def user_for_token(token: str) -> dict | None:
    if not token:
        return None
    init_db()
    with connect(read_only=True) as conn:
        row = conn.execute(
            """SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
               WHERE s.token_hash = ? AND s.expires_at > ?""",
            (_token_hash(token), datetime.now().isoformat(timespec="seconds"))).fetchone()
    return public(row) if row else None


def log_out(token: str) -> None:
    if token:
        with connect() as conn:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))
