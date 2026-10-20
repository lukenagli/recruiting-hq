"""The site's privacy policy and terms of use, served as plain pages at /privacy and /terms."""

CONTACT = "recruitinghq.app@gmail.com"
UPDATED = "October 20, 2026"

_PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>{title} · Recruiting HQ</title>
<style>
:root {{ --bg:#f5f6fa; --card:#fff; --ink:#101a2e; --muted:#5d6880; --line:#e1e5ee; --blue:#2563eb; }}
@media (prefers-color-scheme: dark) {{ :root {{ --bg:#0f1420; --card:#171d2b; --ink:#e8ecf4; --muted:#9aa4b8; --line:#2a3245; --blue:#7aa2ff; }} }}
body {{ margin:0; background:var(--bg); color:var(--ink); font:16px/1.55 'Segoe UI',system-ui,-apple-system,Roboto,sans-serif; }}
main {{ max-width:720px; margin:0 auto; padding:32px 16px 64px; }}
article {{ background:var(--card); border:1px solid var(--line); border-radius:14px; padding:28px; }}
h1 {{ margin:0 0 4px; font-size:28px; }} h2 {{ font-size:18px; margin:26px 0 6px; }}
p, li {{ color:var(--ink); }} small, .muted {{ color:var(--muted); }} a {{ color:var(--blue); }}
</style></head><body><main><p><a href="/">← Recruiting HQ</a></p><article>
<h1>{title}</h1><p class="muted">Last updated {updated}</p>{body}
<h2>Contact</h2><p>Questions, or to delete your account and data: <a href="mailto:{contact}">{contact}</a>.</p>
</article></main></body></html>"""

PRIVACY = """
<p>Recruiting HQ is a free tool that helps students organize investment banking recruiting. This page explains what it
stores and how it is used.</p>
<h2>What we store</h2>
<ul>
<li><strong>Your account:</strong> name, email address, and a scrambled (hashed) version of your password. We cannot see your password.</li>
<li><strong>What you enter:</strong> your school and program, resume, target banks and groups, writing templates, notes on
people you meet and conversations you have, deals you prepare, cover letters, and practice answers.</li>
<li><strong>Your AI key, if you add one:</strong> stored encrypted, used only to run AI features you ask for, and never shown again.</li>
<li><strong>Documents you upload</strong> for deals (for example SEC filings).</li>
</ul>
<h2>How it is used</h2>
<ul>
<li>Only to run the app for you. Your tracker is private to your account; other users cannot see it.</li>
<li>When you use an AI feature, the text needed for that request is sent to the AI provider whose key you added
(Anthropic or OpenAI) and handled under that provider's terms.</li>
<li>Your email address is used to send sign-in codes (confirming your address, resetting your password). We do not send marketing email.</li>
<li>We do not sell or share your information, and we do not use it for advertising.</li>
</ul>
<h2>Where it is kept</h2>
<p>The app runs on Render (United States) and its database is backed up, encrypted, to Backblaze B2. Sign-in codes are
sent through Gmail.</p>
<h2>Your choices</h2>
<p>You can edit or remove most information inside the app at any time, and remove your AI key in Settings. To delete your
whole account and everything in it, email us from the address on your account.</p>
<h2>Please be careful with others' information</h2>
<p>Notes about people you meet are visible only to you. Keep them professional and factual, and do not enter anyone's
sensitive personal information.</p>
"""

TERMS = """
<p>By using Recruiting HQ you agree to these terms.</p>
<h2>What it is</h2>
<p>A free study and organization tool for recruiting. It is not affiliated with any bank, school or club, and it is not
investment, career or legal advice.</p>
<h2>AI output</h2>
<p>Practice grading, cover letters, emails and deal research are produced with AI and can be wrong. Check everything
before you rely on it or send it. Numbers marked as found online by AI must be verified against the original source.</p>
<h2>Your responsibilities</h2>
<ul>
<li>Keep your password and AI key safe. You are responsible for AI usage billed to your own key.</li>
<li>Only upload material you are allowed to use, and do not use the app to harass anyone or to misuse other people's information.</li>
<li>Material shared with you by a school club (for example question banks) is for your own preparation only.</li>
</ul>
<h2>The service</h2>
<p>The app is provided as is, without warranties. It may change, have downtime or lose data despite backups, so keep
copies of anything important. We may suspend accounts that misuse it. These terms may be updated; continued use means
you accept the current version.</p>
"""


def page(kind: str) -> str:
    title, body = ("Privacy Policy", PRIVACY) if kind == "privacy" else ("Terms of Use", TERMS)
    return _PAGE.format(title=title, body=body, updated=UPDATED, contact=CONTACT)
