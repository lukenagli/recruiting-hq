"""Making an Outlook thread cheaper to file without taking out anything the filing needs.

The reader sends each conversation as the text Outlook's reading pane shows: every email in the thread, newest
unfolded, each one starting with its date stamp ("Tue 10/27/2026 10:45 AM"). About half of that text was the same
emails again, quoted under each reply, and a thread that sits in two folders (Inbox and Sent Items) came in twice.

- An email already filed (from this folder or another) is left out, with a one-line marker in its place.
- A quoted earlier email is cut only when that email itself is still in what goes to the model; otherwise the
  start of it is kept (it may be the only copy of what a reply answers).
- Bank legal disclaimers ("intended only for the named recipient...") are cut.
"""
import hashlib
import re

# The date stamp Outlook puts on each email in the reading pane, on a line of its own.
STAMP = re.compile(r"^[ \t]*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2}/\d{1,2}/\d{4} \d{1,2}:\d{2} [AP]M[ \t]*$", re.M)
# Where a quoted earlier email starts inside a reply: Outlook's header block (English, French, German, Italian,
# Spanish), Gmail's "On ... wrote:", or a forward.
QUOTE = re.compile(
    r"^[ \t]*(?:From|De|Von|Da)[ \t]*:.*\n(?:.*\n){0,3}?[ \t]*(?:Sent|Date|Envoy[ée]|Gesendet|Inviato|Enviado|Fecha)[ \t]*:"
    r"|^[ \t]*On [^\n]{5,200}wrote:[ \t]*$"
    r"|^[ \t]*-{2,}[ \t]*(?:Original Message|Forwarded message)", re.M | re.I)
FORWARD = re.compile(r"^[ \t]*-{2,}[ \t]*Forwarded message", re.M | re.I)
HEADER_LINE = re.compile(r"^[ \t]*(?:From|Sent|To|Cc|Bcc|Subject|Date|De|Envoy[ée]|À|A|Objet|Von|Gesendet|An|Betreff|Da|Inviato|"
                         r"Oggetto|Enviado|Para|Asunto|Fecha)[ \t]*:|^[ \t]*On [^\n]{5,200}wrote:|^[ \t]*-{2,}", re.I)
DISCLAIMER = re.compile(r"intended (?:solely |only )?for (?:the )?(?:use of )?(?:the )?(?:individual|person|entity|named|intended|addressee|"
                        r"recipient)|if you (?:are not|have received this)[^.]{0,80}(?:intended recipient|in error)", re.I)
QUOTE_KEEP = 1500      # of a quoted email that isn't in the thread otherwise
FORWARD_KEEP = 6000    # a forward is often the whole point of the email


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def split(text: str) -> list[str]:
    """The thread's head (subject and the like) and then one piece per email, each starting at its sender line."""
    cuts = []
    for m in STAMP.finditer(text):
        # the sender's name (and address) sit on the line or two above the stamp: they belong to this email
        start = m.start()
        for _ in range(2):
            prev = text.rfind("\n", 0, max(0, start - 1))
            line = text[prev + 1:start].strip()
            if not line or len(line) > 120 or (cuts and prev + 1 <= cuts[-1]) or STAMP.match(line):
                break
            start = prev + 1
        cuts.append(start)
    if not cuts:
        return [text]
    return [text[:cuts[0]]] + [text[a:b] for a, b in zip(cuts, cuts[1:] + [len(text)])]


def stamp_of(piece: str) -> str:
    m = STAMP.search(piece)
    return m.group().strip() if m else ""


def _own(piece: str) -> tuple[str, str]:
    """An email's own words and what it quotes."""
    m = QUOTE.search(piece)
    return (piece[:m.start()], piece[m.start():]) if m else (piece, "")


def fingerprint(piece: str) -> str:
    """The same email shows the same stamp and words in every folder it sits in."""
    own, _ = _own(piece)
    return hashlib.sha1(f"{stamp_of(piece)}|{_norm(own)[:400]}".encode()).hexdigest()[:20]


def _quoted_body(quoted: str) -> str:
    lines = quoted.split("\n")
    k = 0
    while k < min(len(lines), 10) and (HEADER_LINE.match(lines[k]) or not lines[k].strip()):
        k += 1
    return "\n".join(lines[k:])


def _no_disclaimers(text: str) -> str:
    parts = re.split(r"(\n[ \t]*\n)", text)
    return "".join("[legal disclaimer trimmed]" if len(p) > 200 and DISCLAIMER.search(p) else p for p in parts)


def check(messages: list[str]) -> dict:
    """How trimming would have changed past filing runs (their user messages, oldest first): counts only."""
    seen: set[str] = set()
    out = {"runs": len(messages), "threads": 0, "emails": 0, "no_stamps": 0, "before": 0, "after": 0, "dropped_threads": 0,
           "already_filed": 0, "quotes_cut": 0, "quotes_kept": 0, "disclaimers": 0}
    for m in messages:
        body = m.split("\nThe messages:\n", 1)[1] if "\nThe messages:\n" in m else m.split("\n\n", 1)[-1]
        for raw in re.split(r"\n(?=\[\d{4}-\d\d-\d\d)", body):
            text = re.sub(r"^\[[^\]]*\] (?:\([^)]*\) )?[^:\n]{0,80}: ?", "", raw, count=1)
            out["threads"] += 1
            n = len(STAMP.findall(text))
            out["emails"] += n
            out["no_stamps"] += not n
            trimmed, prints = trim(text, seen)
            seen |= set(prints)
            out["before"] += len(text)
            out["after"] += len(trimmed)
            out["dropped_threads"] += not trimmed
            out["already_filed"] += trimmed.count("[this email was already filed]")
            out["quotes_cut"] += trimmed.count("[quoted earlier email trimmed")
            out["quotes_kept"] += len(QUOTE.findall(trimmed)) - trimmed.count("[quoted earlier email trimmed")
            out["disclaimers"] += trimmed.count("[legal disclaimer trimmed]")
    return out


def trim(text: str, filed: set[str] | None = None) -> tuple[str, list[str]]:
    """The thread as it should go to the model ('' when every email in it was already filed), and the fingerprints
    of the emails it still carries."""
    filed = filed or set()
    pieces = split(text)
    if len(pieces) == 1:  # no date stamps to go by: one email, its quote shortened
        own, quoted = _own(text)
        cap = FORWARD_KEEP if FORWARD.match(quoted) else QUOTE_KEEP
        if len(quoted) > cap:
            quoted = quoted[:cap] + "\n[rest of the quoted thread trimmed]\n"
        return (_no_disclaimers(own) + quoted).strip(), []
    head, emails = pieces[0], pieces[1:]
    keep, prints, dropped = [], [], 0
    for piece in emails:
        fp = fingerprint(piece)
        if fp in filed:
            dropped += 1
            keep.append(f"{stamp_of(piece)}\n[this email was already filed]\n")
        else:
            keep.append(piece)
            prints.append(fp)
    if emails and not prints:
        return "", []
    # A quoted email is cut when it is still in the thread as an email of its own.
    originals = " ".join(_norm(_own(p)[0]) for p in ([head] + keep))
    out = [head]
    for piece in keep:
        own, quoted = _own(piece)
        if quoted:
            probe = _norm(_quoted_body(quoted))[:80]
            if len(probe) >= 30 and probe in originals:
                quoted = "[quoted earlier email trimmed: it is in this thread]\n"
            else:
                cap = FORWARD_KEEP if FORWARD.match(quoted) else QUOTE_KEEP
                if len(quoted) > cap:
                    quoted = quoted[:cap] + "\n[rest of the quoted thread trimmed]\n"
        out.append(_no_disclaimers(own) + quoted)
    return "".join(out).strip(), prints
