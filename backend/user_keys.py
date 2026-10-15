"""Each person's own AI provider key (Claude or OpenAI), so their usage is billed to them, not the site owner.

- Keys are checked with a free call (listing models) before they are saved.
- Keys are encrypted at rest (Fernet, with APP_SECRET) and are never sent back to the browser, logged, or
  written to the audit trail; the page only ever sees the provider and the last four characters.
"""
import base64
import hashlib
import secrets

import anthropic
import openai
from cryptography.fernet import Fernet, InvalidToken

from . import config
from .db import connect, init_db

PROVIDERS = {"anthropic": "Claude (Anthropic)", "openai": "OpenAI"}


class KeyError_(Exception):
    """A message that is safe to show the person saving a key."""


def _fernet() -> Fernet:
    secret = config.APP_SECRET
    if not secret:
        path = config.APP_SECRET_FILE
        if not path.is_file():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(secrets.token_urlsafe(48), encoding="utf-8")
        secret = path.read_text(encoding="utf-8").strip()
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest()))


def validate(provider: str, key: str) -> None:
    """Raise KeyError_ unless the key works. Listing models costs nothing."""
    try:
        if provider == "anthropic":
            anthropic.Anthropic(api_key=key, max_retries=1, timeout=20).models.list(limit=1)
        elif provider == "openai":
            available = {m.id for m in openai.OpenAI(api_key=key, max_retries=1, timeout=20).models.list()}
            if config.USER_OPENAI_MODEL not in available:
                raise KeyError_(f"That key works, but it cannot use the model this app runs on ({config.USER_OPENAI_MODEL}). Try a Claude key instead.")
        else:
            raise KeyError_("Choose Claude or OpenAI.")
    except (anthropic.AuthenticationError, openai.AuthenticationError):
        raise KeyError_("That key was rejected. Check you copied the whole key.")
    except (anthropic.PermissionDeniedError, openai.PermissionDeniedError):
        raise KeyError_("That key does not have permission to use the API.")
    except (anthropic.APIConnectionError, openai.APIConnectionError):
        raise KeyError_("Could not reach the provider to check the key. Try again in a minute.")


def save(uid: int, provider: str, key: str) -> dict:
    key = key.strip()
    if provider not in PROVIDERS:
        raise KeyError_("Choose Claude or OpenAI.")
    if len(key) < 20 or any(c.isspace() for c in key):
        raise KeyError_("That does not look like an API key.")
    validate(provider, key)
    init_db()
    with connect() as conn:
        conn.execute("UPDATE users SET api_provider = ?, api_key_enc = ?, api_key_hint = ? WHERE id = ?",
                     (provider, _fernet().encrypt(key.encode()).decode(), key[-4:], uid))
    return status(uid)


def remove(uid: int) -> dict:
    init_db()
    with connect() as conn:
        conn.execute("UPDATE users SET api_provider = '', api_key_enc = '', api_key_hint = '' WHERE id = ?", (uid,))
    return status(uid)


def stored(uid: int) -> tuple[str, str] | None:
    """(provider, key) for this user, or None. Only the model-building code calls this."""
    init_db()
    with connect(read_only=True) as conn:
        row = conn.execute("SELECT api_provider, api_key_enc FROM users WHERE id = ?", (uid,)).fetchone()
    if not row or not row["api_key_enc"]:
        return None
    try:
        return row["api_provider"], _fernet().decrypt(row["api_key_enc"].encode()).decode()
    except InvalidToken:  # the site's secret changed; the person has to enter the key again
        return None


def status(uid: int) -> dict:
    """What the settings page shows. Never includes the key itself."""
    init_db()
    with connect(read_only=True) as conn:
        row = conn.execute("SELECT api_provider, api_key_hint, is_admin FROM users WHERE id = ?", (uid,)).fetchone()
    own = bool(row and row["api_provider"] and stored(uid))
    course = bool(row and row["is_admin"] and config.PORTKEY_API_KEY_SET)
    return {
        "provider": row["api_provider"] if own else "",
        "provider_label": PROVIDERS.get(row["api_provider"], "") if own else "",
        "hint": row["api_key_hint"] if own else "",
        "ready": own or course,
        "using_site_key": course and not own,
        "model": (config.CLAUDE_MODEL if row["api_provider"] == "anthropic" else config.USER_OPENAI_MODEL) if own
                 else (config.MODEL_NAME if course else ""),
    }
