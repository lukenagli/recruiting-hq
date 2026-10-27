"""Preview: bring in thank-you emails a student already sent, so each shows on the person's page.

The Recruiting HQ Reader reads the student's Sent Items (and their other mail folders, where some students file sent
mail) back to the start of the season and hands over each email that looks like a thank-you. No AI: a thank-you opens
with the person's name and a line like "I just want to thank you again for meeting with me...", so the person is found
by that name together with the recipient shown in the list, and the chat or event is the latest one with that person
on or before the day it was sent (a coffee chat for a chat thank-you, an event for "speaking with me at...").
"""
import re
from datetime import date

from pydantic import BaseModel

from . import thank_you
from .db import connect, init_db

GREETING = re.compile(r"\n\s*([A-Z][A-Za-z'.-]+(?: [A-Z][A-Za-z'.-]+)?),\s*\n+\s*((?:I (?:just )?want(?:ed)? to thank|Thank you (?:again|so much|for)"
                      r"|I wanted to)[\s\S]*)")
STOP = r"\n\s*(Best|Thanks|Sincerely|Regards|Warm regards|All the best)\s*,?\s*\n|\nFrom:|\nSent:|\n\s*[A-Z]{2}\s*\n"  # or the student's name
SENT_ON = re.compile(r"(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\d{1,2})/(\d{1,2})/(\d{4})")
AT_EVENT = re.compile(r"speaking with me at|at the .{0,60}(presentation|event|happy hour|reception|dinner|kickoff|hiresom|days on wall street)", re.I)
STATUS = re.compile(r"^((Collapsed|Expanded|Selected|Unread|Replied|Forwarded|Has attachments|Meeting|Flagged|Pinned) )+")


class Email(BaseModel):
    label: str   # the row in the mail list: recipient (or sender), subject, preview
    text: str    # the conversation as shown in the reading pane


def extract(email: Email, own_name: str) -> dict | None:
    """{greeting, body, sent, at_event, recipient} for the student's own thank-you in a conversation, or None."""
    text = email.text.replace("\r", "")
    m = GREETING.search(text)
    own = own_name.split() or [""]
    if not m or m[1].split()[0].lower() == own[0].lower():  # "<student>, thanks for..." is a reply to the student
        return None
    body = f"{m[1]},\n\n{m[2]}"
    signed = rf"|\n\s*{re.escape(own[0])}( {re.escape(own[-1])})?\s*\n" if own[0] else ""
    stop = re.search(STOP + signed, body)
    body = re.sub(r"\n{3,}", "\n\n", body[:stop.start()] if stop and stop.start() > 0 else body).strip()[:4000]
    dates = list(SENT_ON.finditer(text[:m.start()]))
    sent = date(int(dates[-1][3]), int(dates[-1][1]), int(dates[-1][2])).isoformat() if dates else ""
    label = STATUS.sub("", email.label)
    recipient = ""
    if r := re.search(r"/ ([A-Z][\w'.-]+(?: [A-Z][\w'.-]+)+) -", label):  # "<student> / <banker> - Coffee Chat"
        recipient = r[1]
    elif r := re.match(r"([A-Z][\w'-]+), ([A-Z][\w'-]+)", label):
        recipient = f"{r[2]} {r[1]}"
    elif r := re.match(r"([a-z]+)\.([a-z]+)\d*@", label, re.I):
        recipient = f"{r[1].title()} {r[2].title()}"
    if recipient.lower() == own_name.lower():  # sent mail filed in another folder lists the student as the sender
        recipient = ""
    return {"greeting": m[1], "body": body, "sent": sent, "at_event": bool(AT_EVENT.search(body)), "recipient": recipient}


def _norm(s: str) -> str:
    return re.sub(r"[^a-z]", "", s.lower())


def _match(conn, uid: int, found: dict) -> tuple[int, int] | None:
    """(interaction id, person id): the person the email greets, at the chat or event it thanks them for."""
    rows = conn.execute(
        """SELECT i.id AS iid, i.kind, i.date, p.id AS pid, p.name FROM interactions i
           JOIN interaction_people ip ON ip.interaction_id = i.id JOIN people p ON p.id = ip.person_id
           WHERE i.user_id = ? AND i.kind IN ('coffee_chat', 'event') AND i.date != ''""", (uid,)).fetchall()
    first = _norm(found["greeting"].split()[0])
    last = _norm(found["recipient"].split()[-1]) if found["recipient"] else ""

    def same(name: str) -> bool:
        parts = name.split()
        nf, nl = _norm(parts[0]), _norm(parts[-1])
        first_ok = nf.startswith(first) or first.startswith(nf)
        return first_ok and (not last or nl == last or nl.startswith(last) or last.startswith(nl))

    people = [r for r in rows if same(r["name"])]
    if not people or (not last and len({r["pid"] for r in people}) > 1):  # a first name alone must point to one person
        return None
    kind = "event" if found["at_event"] else "coffee_chat"
    sent = found["sent"] or date.today().isoformat()
    for wanted in (kind, None):
        fit = sorted((r for r in people if r["date"] <= sent and (wanted is None or r["kind"] == wanted)), key=lambda r: r["date"])
        if fit:
            return fit[-1]["iid"], fit[-1]["pid"]
    return None


def save(uid: int, emails: list[Email], own_name: str) -> dict:
    """File each thank-you on its person; one already on file for that chat or event and person is left as it is."""
    init_db()
    saved, skipped, unmatched = 0, 0, []
    for email in emails:
        found = extract(email, own_name)
        if not found:
            skipped += 1
            continue
        with connect(read_only=True) as conn:
            hit = _match(conn, uid, found)
            dupe = hit and conn.execute("SELECT 1 FROM thank_you_drafts WHERE user_id = ? AND interaction_id = ? AND person_id = ? "
                                        "AND COALESCE(sent_at, '') != ''", (uid, *hit)).fetchone()
        if not hit:
            unmatched.append(found["recipient"] or found["greeting"])
            continue
        if dupe:
            skipped += 1
            continue
        if thank_you.record_sent(uid, hit[0], hit[1], found["body"]).get("ok"):
            saved += 1
    return {"saved": saved, "already": skipped, "unmatched": unmatched}
