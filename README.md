# Recruiting HQ

**Live app: https://recruiting-hq.onrender.com**

Recruiting HQ is an AI agent app for MBA students recruiting for investment banking summer internships. You tell it
what happened in plain words ("had a coffee chat with Hannah Park at Moelis today, she said..."), or paste an email,
drop in a team roster, or record the chat. The assistant files it in your tracker, maps who led to whom at each
bank, and drafts the thank-you note in your club's template. The same tracker feeds interview practice (graded
answers and technical problems with new numbers each time), a 90-second deal pitch checklist, and cover letters
written only from what you actually logged.

It is built for the Yale SOM Finance Club. I use it for my own banking recruiting this fall.

- Report: [`docs/report.html`](docs/report.html) · Slides: [`docs/slides.html`](docs/slides.html) (both open by double-clicking)
- MGT 409 final project, Luke Nagli

## Using it

1. Open https://recruiting-hq.onrender.com and create an account with your school email.
2. A two-minute tour shows what it does, then setup asks one thing per screen: your AI key (the Yale class
   Portkey key works), your resume, your banks and groups, and, on a laptop in Chrome, connecting the
   Recruiting HQ Reader so your Outlook email and calendar fill the tracker when you press Refresh.
3. From then on, tell the box on your homepage anything that isn't in your email, in plain words.

The Finance Club's own question bank, tracker and calendar are shown only to verified @yale.edu accounts.

## Running it locally

You need Python 3.12 or newer, Node.js 20 or newer, and a `PORTKEY_API_KEY`.

```bash
git clone https://github.com/lukenagli/recruiting-hq.git
cd recruiting-hq
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt        # Mac/Linux: .venv/bin/pip install -r requirements.txt
cd frontend
npm ci
npm run build
cd ..
.venv\Scripts\python -m uvicorn backend.main:app --port 8000
```

Then open http://localhost:8000 and create an account.

**Keys.** The app reads `.env` from the repo folder first, then from the folder above it, so the teaching staff's
shared `.env` one level up works as is. The only key it needs is `PORTKEY_API_KEY` (see [`.env.example`](.env.example)).
Without email settings, local accounts skip the email confirmation step.

**Data.** The real Finance Club question banks and Luke's own tracker are private and are not in this repo. A fresh
clone starts with an empty database (`data/app.db`, created on first run).

## How it is built

| Part | Where |
| --- | --- |
| API (FastAPI), auth, per-user data access | `backend/main.py`, `backend/auth.py`, `backend/accounts.py` |
| Tracker assistant agent and its 11 tools | `backend/assistant.py` |
| Thank-you writer, cover letter writer, interview grader, background researcher, deal fact finder | `backend/thank_you.py`, `backend/cover_letters.py`, `backend/practice.py`, `backend/research.py`, `backend/deal_docs.py` |
| Model selection (course key or the user's own key), token logging | `backend/llm.py`, `backend/budget.py` |
| SQLite schema and audit log (`agent_runs`) | `backend/db.py` |
| Website (React + Vite) | `frontend/src/` |
| Hosting (Docker on Render, Litestream backups) | `Dockerfile`, `deploy/`, `render.yaml` |

Every AI run is logged to the `agent_runs` table with its tool calls, input, cached input and output tokens. The
report's cost figures come from that table.
