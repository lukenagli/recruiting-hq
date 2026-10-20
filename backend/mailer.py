"""Sending email (verification and password-reset codes).

Two ways, tried in this order:
1. The Gmail API over HTTPS: set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN (an OAuth client
   and a refresh token for the sending Gmail account, with the gmail.send permission only). Use this on cloud
   hosts: Google refuses password (SMTP) logins from most cloud servers, but accepts the API.
2. SMTP with an app password: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD.
EMAIL_FROM sets the sender ("Recruiting HQ <you@gmail.com>"); with the Gmail API it must be that account.

Without either, the site cannot send email, so it skips email verification and turns password reset off,
rather than locking people out. For local testing only, EMAIL_DEV_LOG=1 writes messages to the server log.
"""
import base64
import json
import logging
import os
import smtplib
import ssl
import urllib.parse
import urllib.request
from email.message import EmailMessage

log = logging.getLogger("recruiting_hq.mailer")
SMTP_KEYS = ("SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM")
GMAIL_KEYS = ("GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN")


def _settings() -> dict:
    return {k: os.getenv(k, "").strip() for k in SMTP_KEYS + GMAIL_KEYS}


def dev_log() -> bool:
    return os.getenv("EMAIL_DEV_LOG", "").strip() == "1"


def _gmail_api(s: dict) -> bool:
    return all(s[k] for k in GMAIL_KEYS)


def _smtp(s: dict) -> bool:
    return bool(s["SMTP_HOST"] and s["SMTP_USER"] and s["SMTP_PASSWORD"])


def available() -> bool:
    s = _settings()
    return _gmail_api(s) or _smtp(s) or dev_log()


def send(to: str, subject: str, body: str) -> None:
    s = _settings()
    if not (_gmail_api(s) or _smtp(s)):
        if dev_log():
            print(f"[dev email] to {to}: {subject}\n{body}", flush=True)
            return
        raise RuntimeError("Email is not set up on this site.")
    msg = EmailMessage()
    msg["From"] = s["EMAIL_FROM"] or s["SMTP_USER"]
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    if _gmail_api(s):
        _send_gmail_api(s, msg)
        log.info("sent %s email", subject)
        return
    port = int(s["SMTP_PORT"] or 587)
    # Some hosts' networks cut one of the two standard secure ports, so if the chosen one drops the connection,
    # try the other (465 = TLS from the start, 587 = STARTTLS). A wrong password is not retried.
    other = 465 if port == 587 else 587 if port == 465 else None
    try:
        _deliver(s, port, msg)
    except (smtplib.SMTPServerDisconnected, smtplib.SMTPConnectError, OSError) as exc:
        if other is None or isinstance(exc, smtplib.SMTPAuthenticationError):
            raise
        print(f"[email] port {port} failed ({type(exc).__name__}), trying port {other}", flush=True)
        _deliver(s, other, msg)
    log.info("sent %s email", subject)


def _post(url: str, data: bytes, headers: dict) -> dict:
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        # Google's error text names the problem (e.g. invalid_grant) and never echoes the secrets back.
        raise RuntimeError(f"HTTP {e.code} from {urllib.parse.urlparse(url).hostname}: {e.read()[:200]!r}") from None


def _send_gmail_api(s: dict, msg: EmailMessage) -> None:
    token = _post("https://oauth2.googleapis.com/token", urllib.parse.urlencode({
        "client_id": s["GMAIL_CLIENT_ID"], "client_secret": s["GMAIL_CLIENT_SECRET"],
        "refresh_token": s["GMAIL_REFRESH_TOKEN"], "grant_type": "refresh_token",
    }).encode(), {"Content-Type": "application/x-www-form-urlencoded"})["access_token"]
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    _post("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", json.dumps({"raw": raw}).encode(),
          {"Authorization": f"Bearer {token}", "Content-Type": "application/json"})


def _deliver(s: dict, port: int, msg: EmailMessage) -> None:
    context = ssl.create_default_context()
    if port == 465:
        with smtplib.SMTP_SSL(s["SMTP_HOST"], port, context=context, timeout=20) as smtp:
            smtp.login(s["SMTP_USER"], s["SMTP_PASSWORD"])
            smtp.send_message(msg)
    else:
        with smtplib.SMTP(s["SMTP_HOST"], port, timeout=20) as smtp:
            smtp.starttls(context=context)
            smtp.login(s["SMTP_USER"], s["SMTP_PASSWORD"])
            smtp.send_message(msg)
