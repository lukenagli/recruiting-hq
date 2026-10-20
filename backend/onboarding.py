"""First-run setup: AI key, resume, target banks and groups, writing templates (everyone is Yale SOM for now).

Each step saves on its own, so a person can stop halfway and pick up later, and every step can be redone
from Settings. Nothing here is required.
"""
from . import banks as bank_info
from . import profile as user_profile
from . import schools, templates, user_keys
from .db import connect, init_db


def state(uid: int) -> dict:
    """Everything the setup screens show, with which steps are already done."""
    init_db()
    prof = user_profile.get(uid)
    with connect(read_only=True) as conn:
        chosen = [r["bank"] for r in conn.execute("SELECT bank FROM my_banks WHERE user_id = ? ORDER BY bank", (uid,))]
    ctx = schools.for_user(uid)
    key = user_keys.status(uid)
    return {
        "profile": {k: prof[k] for k in ("school", "level", "class_year", "school_line", "contact_line", "target_groups",
                                         "email_template", "email_rules", "onboarded_at")}
                   | {"has_resume": bool(prof["resume_text"].strip()), "resume_chars": len(prof["resume_text"]),
                      "has_cover_template": bool(prof["example_letter"].strip()), "story": prof["story"]},
        "context": ctx,
        "school_line_suggestion": schools.default_school_line(ctx),
        "banks": chosen,
        "bank_choices": [{"bank": b, "domain": d} for b, d in sorted(bank_info.DOMAINS.items())],
        "ai": key,
        "options": schools.options(),
        "email_templates": templates.email_templates(uid),
        "email_kinds": templates.email_options(),
        "cover_template": templates.cover_template_info(uid),
        "done": {
            "ai": bool(key.get("ready")),
            "resume": bool(prof["resume_text"].strip()),
            "banks": bool(chosen),
            "templates": templates.cover_template_info(uid)["has_template"],
        },
    }


def save_banks(uid: int, banks: list[str], groups: list[str]) -> dict:
    """Set the banks the user is recruiting with. A bank they drop is removed only if nothing is logged there."""
    clean = []
    for b in banks:
        b = " ".join(str(b).split())[:60]
        if b and b.lower() not in {c.lower() for c in clean}:
            clean.append(b)
    groups = [" ".join(str(g).split())[:60] for g in groups if str(g).strip()][:8]
    pref = " > ".join(groups)
    init_db()
    kept, removed = [], []
    with connect() as conn:
        have = {r["bank"]: r for r in conn.execute("SELECT bank, prefs FROM my_banks WHERE user_id = ?", (uid,))}
        for b in clean:
            if b not in have:
                conn.execute("INSERT INTO my_banks (user_id, bank, applied, deadline, link, prefs, notes) VALUES (?, ?, '', '', '', ?, '')",
                             (uid, b, pref))
            elif not (have[b]["prefs"] or "").strip() and pref:
                conn.execute("UPDATE my_banks SET prefs = ? WHERE user_id = ? AND bank = ?", (pref, uid, b))
        for b in set(have) - set(clean):
            used = conn.execute(
                "SELECT 1 FROM people WHERE user_id = ? AND bank = ? UNION SELECT 1 FROM interactions WHERE user_id = ? AND bank = ? LIMIT 1",
                (uid, b, uid, b)).fetchone()
            if used:
                kept.append(b)
            else:
                conn.execute("DELETE FROM my_banks WHERE user_id = ? AND bank = ?", (uid, b))
                removed.append(b)
    user_profile.save(uid, {"target_groups": ", ".join(groups)})
    return {"ok": True, "kept": kept, "removed": removed}
