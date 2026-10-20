"""Accounts and login sessions.

- Passwords are stored as salted scrypt hashes; session tokens are random and only their SHA-256 is stored.
- Anyone with the link can create an account. AI features run on each person's own Claude or OpenAI key
  (see user_keys.py), so new accounts never spend the site owner's course key.
- Repeated wrong passwords for one email are slowed down (10 tries per 15 minutes).
- New accounts confirm their email with a 6-digit code, and a forgotten password is reset the same way
  (mailer.py). Codes are stored only as hashes, expire after 15 minutes and allow 5 tries.
- A brand-new account starts empty; the first-run setup asks for the school, banks and templates.
"""
import hashlib
import hmac
import re
import secrets
import time
from collections import defaultdict
from datetime import datetime, timedelta

from . import config, mailer
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
    # Without email set up on the site nobody can be asked to confirm, so everyone counts as confirmed.
    verified = bool(user["email_verified_at"]) or not mailer.available()
    return {"id": user["id"], "email": user["email"], "name": user["name"], "is_admin": bool(user["is_admin"]),
            "email_verified": verified}


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
            token = _new_session(conn, user_id)
            user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if email_on():
            try:
                send_code(email, "verify")
            except AccountError:
                pass  # the confirm screen offers "send a new code"
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


# ---------------- Email codes: confirming an address, resetting a password ----------------

CODE_MINUTES = 15
CODE_TRIES = 5


def _code_hash(email: str, purpose: str, code: str) -> str:
    return hashlib.sha256(f"{purpose}:{email.lower()}:{code}".encode()).hexdigest()


def email_on() -> bool:
    return mailer.available()


def send_code(email: str, purpose: str) -> None:
    """Email a fresh 6-digit code. At most one a minute and six an hour per address."""
    email = email.strip().lower()
    now = datetime.now()
    init_db()
    with connect() as conn:
        recent = [r["created_at"] for r in conn.execute(
            "SELECT created_at FROM email_codes WHERE email = ? AND purpose = ? AND created_at > ?",
            (email, purpose, (now - timedelta(hours=1)).isoformat(timespec="seconds")))]
        if len(recent) >= 6:
            raise AccountError("Too many codes requested. Wait an hour and try again.")
        if any(r > (now - timedelta(seconds=60)).isoformat(timespec="seconds") for r in recent):
            raise AccountError("A code was just sent. Check your inbox (and spam), or wait a minute to ask for another.")
        code = f"{secrets.randbelow(1_000_000):06d}"
        conn.execute("UPDATE email_codes SET used = 1 WHERE email = ? AND purpose = ? AND used = 0", (email, purpose))
        conn.execute("INSERT INTO email_codes (email, purpose, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
                     (email, purpose, _code_hash(email, purpose, code), now.isoformat(timespec="seconds"),
                      (now + timedelta(minutes=CODE_MINUTES)).isoformat(timespec="seconds")))
    what = "confirm your email address" if purpose == "verify" else "reset your password"
    try:
        mailer.send(email, f"Your Recruiting HQ code: {code}",
                    f"Your code to {what} is:\n\n    {code}\n\nIt expires in {CODE_MINUTES} minutes.\n\n"
                    "If you did not ask for this, you can ignore this email.\n\nRecruiting HQ")
    except Exception as exc:
        # Show why in the server log (error type and the mail server's reply), never the code or a password.
        print(f"[email] sending the {purpose} code failed: {type(exc).__name__}: {str(exc)[:200]}", flush=True)
        with connect() as conn:  # a code that never went out should not count toward the resend limits
            conn.execute("DELETE FROM email_codes WHERE email = ? AND purpose = ? AND created_at = ?",
                         (email, purpose, now.isoformat(timespec="seconds")))
        raise AccountError("The email could not be sent. Try again in a few minutes.")


def _use_code(conn, email: str, purpose: str, code: str) -> bool:
    row = conn.execute(
        """SELECT id, code_hash, attempts FROM email_codes WHERE email = ? AND purpose = ? AND used = 0 AND expires_at > ?
           ORDER BY id DESC LIMIT 1""", (email, purpose, datetime.now().isoformat(timespec="seconds"))).fetchone()
    if row is None or row["attempts"] >= CODE_TRIES:
        return False
    if hmac.compare_digest(row["code_hash"], _code_hash(email, purpose, re.sub(r"\D", "", code))):
        conn.execute("UPDATE email_codes SET used = 1 WHERE id = ?", (row["id"],))
        return True
    conn.execute("UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?", (row["id"],))
    return False


def verify_email(user_id: int, code: str) -> dict:
    init_db()
    conn = connect()
    try:
        with conn:
            user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            ok = _use_code(conn, user["email"].lower(), "verify", code)
            if ok:
                conn.execute("UPDATE users SET email_verified_at = ? WHERE id = ?", (datetime.now().isoformat(timespec="seconds"), user_id))
        if not ok:  # outside the transaction, so the failed try still counts
            raise AccountError("That code is wrong or has expired. Check the latest email, or send a new code.")
        return public(conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())
    finally:
        conn.close()


def request_reset(email: str) -> None:
    """Send a reset code if the account exists. The answer never says whether it does."""
    email = email.strip().lower()
    if not email_on():
        raise AccountError("Password reset is not set up on this site yet. Ask the site's admin for help.")
    init_db()
    with connect(read_only=True) as conn:
        exists = conn.execute("SELECT 1 FROM users WHERE email = ? AND password_hash != ''", (email,)).fetchone()
    if exists:
        send_code(email, "reset")


def reset_password(email: str, code: str, password: str) -> tuple[dict, str]:
    email = email.strip().lower()
    if len(password) < 8:
        raise AccountError("Use a password of at least 8 characters.")
    init_db()
    conn = connect()
    try:
        with conn:
            user = conn.execute("SELECT * FROM users WHERE email = ? AND password_hash != ''", (email,)).fetchone()
            ok = user is not None and _use_code(conn, email, "reset", code)
            if ok:
                now = datetime.now().isoformat(timespec="seconds")
                conn.execute("UPDATE users SET password_hash = ?, email_verified_at = COALESCE(NULLIF(email_verified_at, ''), ?) WHERE id = ?",
                             (_hash_password(password), now, user["id"]))
                conn.execute("DELETE FROM sessions WHERE user_id = ?", (user["id"],))  # sign out everywhere else
                token = _new_session(conn, user["id"])
        if not ok:
            raise AccountError("That code is wrong or has expired. Check the latest email, or send a new code.")
        _failures.pop(email, None)
        return public(conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()), token
    finally:
        conn.close()
