"""Sending email (verification and password-reset codes) through any SMTP account.

Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD and EMAIL_FROM on the host. A Gmail account with an app
password works (smtp.gmail.com, port 587). Without them the site cannot send email, so it skips email
verification and turns password reset off, rather than locking people out.

For local testing only, EMAIL_DEV_LOG=1 writes the message to the server log instead of sending it.
"""
import logging
import os
import smtplib
import ssl
from email.message import EmailMessage

log = logging.getLogger("recruiting_hq.mailer")


def _settings() -> dict:
    return {k: os.getenv(k, "").strip() for k in ("SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM")}


def dev_log() -> bool:
    return os.getenv("EMAIL_DEV_LOG", "").strip() == "1"


def available() -> bool:
    s = _settings()
    return bool(s["SMTP_HOST"] and s["SMTP_USER"] and s["SMTP_PASSWORD"]) or dev_log()


def send(to: str, subject: str, body: str) -> None:
    s = _settings()
    if not (s["SMTP_HOST"] and s["SMTP_USER"] and s["SMTP_PASSWORD"]):
        if dev_log():
            print(f"[dev email] to {to}: {subject}\n{body}", flush=True)
            return
        raise RuntimeError("Email is not set up on this site.")
    msg = EmailMessage()
    msg["From"] = s["EMAIL_FROM"] or s["SMTP_USER"]
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    port = int(s["SMTP_PORT"] or 587)
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
    log.info("sent %s email", subject)
