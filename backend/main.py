"""HTTP API. Every route below the account routes runs for the signed-in user only (see auth.py)."""
import tempfile
from datetime import datetime
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from pydantic_ai import Agent

from . import accounts, assistant, auth, budget, config, deals, importer, llm, network, research, thank_you, transfer, user_keys
from .auth import admin_user, current_user
from .db import connect, init_db
from .llm import get_model, usage_dict

app = FastAPI(title="Recruiting HQ")
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.FRONTEND_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.middleware("http")(auth.guard)


# ---- Accounts ----

class SignUpRequest(BaseModel):
    email: str
    name: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


@app.get("/api/session")
def session(request: Request):
    user = accounts.user_for_token(auth.token_from(request))
    return {"user": user}


@app.post("/api/signup")
def sign_up(req: SignUpRequest, request: Request):
    try:
        user, token = accounts.sign_up(req.email, req.name, req.password)
    except accounts.AccountError as err:
        raise HTTPException(status_code=400, detail=str(err))
    return auth.session_response(request, user, token)


@app.post("/api/login")
def log_in(req: LoginRequest, request: Request):
    try:
        user, token = accounts.log_in(req.email, req.password)
    except accounts.AccountError as err:
        raise HTTPException(status_code=401, detail=str(err))
    return auth.session_response(request, user, token)


@app.post("/api/logout")
def log_out(request: Request):
    accounts.log_out(auth.token_from(request))
    response = JSONResponse({"ok": True})
    response.delete_cookie(auth.COOKIE)
    return response


@app.get("/api/health")
def health():
    return {"ok": True, "model": config.MODEL_NAME}


# ---- Reading the tracker ----

@app.get("/api/home")
def home(user: dict = Depends(current_user)):
    return {**network.home(user["id"]), "ai_used_today": budget.used_today(user["id"]), "ai_budget": config.DAILY_TOKEN_BUDGET}


@app.get("/api/banks")
def banks(user: dict = Depends(current_user)):
    return network.bank_list(user["id"])


@app.get("/api/banks/{bank}")
def bank(bank: str, user: dict = Depends(current_user)):
    detail = network.bank_detail(user["id"], bank)
    if detail is None:
        raise HTTPException(status_code=404, detail=f"No bank named {bank!r} in your tracker")
    return detail


@app.get("/api/prep/options")
def prep_options(user: dict = Depends(current_user)):
    return network.prep_options(user["id"])


@app.get("/api/prep/questions")
def prep_questions(bank: str = "Any", round: str = "Any", user: dict = Depends(current_user)):
    return network.prep_questions(bank, round)


@app.get("/api/deals")
def my_deals(user: dict = Depends(current_user)):
    return deals.all_deals(user["id"])


class NewDeal(BaseModel):
    title: str
    banks: list[str] = []


@app.post("/api/deals")
def add_deal(req: NewDeal, user: dict = Depends(current_user)):
    return deals.add_deal(user["id"], req.title, req.banks)


@app.get("/api/calendar")
def recruiting_calendar(user: dict = Depends(current_user)):
    return network.calendar()


# ---- Each person's own AI key ----

class KeyRequest(BaseModel):
    provider: str
    key: str


@app.get("/api/settings/ai")
def ai_settings(user: dict = Depends(current_user)):
    return user_keys.status(user["id"])


@app.post("/api/settings/ai")
def save_ai_key(req: KeyRequest, user: dict = Depends(current_user)):
    try:
        return user_keys.save(user["id"], req.provider, req.key)
    except user_keys.KeyError_ as err:
        raise HTTPException(status_code=400, detail=str(err))


@app.post("/api/settings/ai/remove")
def remove_ai_key(user: dict = Depends(current_user)):
    return user_keys.remove(user["id"])


# ---- The AI features (each checks the account's daily budget, then uses that account's own key) ----

def ai_for(user: dict) -> llm.Chosen:
    budget.check(user["id"])
    try:
        return llm.model_for(user)
    except llm.NoModelError as err:
        raise HTTPException(status_code=428, detail=str(err))

class AssistantRequest(BaseModel):
    message: str
    history: list[dict] = []


class UndoRequest(BaseModel):
    run_id: int


async def with_thank_you_drafts(user: dict, chosen: llm.Chosen, out: dict) -> dict:
    """After a run, draft thank-you notes for coffee chats it marked done that still need one (at most two)."""
    touched = [s["result"].get("entry_id") for s in out["steps"] if s["tool"] == "save_entry" and s["result"].get("ok")]
    out["drafts"] = []
    for chat_id in thank_you.owed_chats(user["id"], [t for t in touched if t])[:2]:
        try:
            out["drafts"].append(await thank_you.draft(user["id"], chosen, chat_id))
        except Exception as exc:  # a failed draft must not lose the filing that already happened
            out["drafts"].append({"ok": False, "reason": f"Could not draft the thank-you ({type(exc).__name__})."})
    return out


@app.post("/api/assistant")
async def assistant_message(req: AssistantRequest, user: dict = Depends(current_user)):
    chosen = ai_for(user)
    return await with_thank_you_drafts(user, chosen, await assistant.run(user, chosen, req.message, req.history))


@app.post("/api/assistant/undo")
def assistant_undo(req: UndoRequest, user: dict = Depends(current_user)):
    return assistant.undo(user["id"], req.run_id)


class RecordingRequest(BaseModel):
    label: str  # who the chat was with, as the user typed it
    mode: str  # conversation | recap
    text: str


@app.post("/api/recordings")
async def file_recording(req: RecordingRequest, user: dict = Depends(current_user)):
    """Keep the transcript, then hand it to the tracker assistant to file."""
    chosen = ai_for(user)
    text, label = req.text.strip(), req.label.strip()[:200] or "Unlabelled chat"
    mode = "recap" if req.mode == "recap" else "conversation"
    if len(text) < 40:
        raise HTTPException(status_code=400, detail="The transcript is empty or too short to file.")
    init_db()
    with connect() as conn:
        conn.execute("INSERT INTO transcripts (user_id, started_at, label, mode, text) VALUES (?, ?, ?, ?, ?)",
                     (user["id"], datetime.now().isoformat(timespec="seconds"), label, mode, text))
    kind = ("my spoken recap of a conversation" if mode == "recap"
            else "a live recording of a conversation, so both of us are in it with no speaker labels")
    message = (
        f"This is a speech-to-text transcript of {kind}. It was with: {label}. Speech-to-text makes mistakes, "
        "especially with names, banks and numbers, so match names against the tracker with lookup and do not "
        "save a name, deal or figure you are not sure of.\n\n"
        "File it: update or log the conversation with a first-person summary, the questions they asked me, "
        "the questions I asked, anything I learned about the bank itself as fact-sheet facts, and any referral "
        "or next step. Then tell me what you could not make out.\n\n"
        f"--- transcript start ---\n{text}\n--- transcript end ---"
    )
    return await with_thank_you_drafts(user, chosen, await assistant.run(user, chosen, message, [], transcript=True))


class DraftRequest(BaseModel):
    interaction_id: int
    person_id: int | None = None


@app.post("/api/thank-you")
async def draft_thank_you(req: DraftRequest, user: dict = Depends(current_user)):
    return await thank_you.draft(user["id"], ai_for(user), req.interaction_id, req.person_id)


@app.post("/api/thank-you/{draft_id}/sent")
def thank_you_sent(draft_id: int, user: dict = Depends(current_user)):
    return thank_you.mark_sent(user["id"], draft_id)


@app.post("/api/people/{person_id}/background")
async def look_up_background(person_id: int, user: dict = Depends(current_user)):
    result = await research.look_up(user["id"], ai_for(user), person_id)
    if result is None:
        raise HTTPException(status_code=404, detail="No such person in your tracker")
    return result


@app.post("/api/people/{person_id}/background/clear")
def clear_background(person_id: int, user: dict = Depends(current_user)):
    return research.clear(user["id"], person_id)


# ---- Moving data and admin tasks ----

@app.get("/api/export")
def export_my_tracker(user: dict = Depends(current_user)):
    """Download your whole tracker as JSON (a backup you keep)."""
    return transfer.export_all(user["id"], include_shared=user["is_admin"])


@app.post("/api/import")
def import_my_tracker(data: dict, replace: bool = False, user: dict = Depends(current_user)):
    """Load an export into your own account (used to move an existing tracker onto the hosted site)."""
    return transfer.import_all(user["id"], data, user["is_admin"], replace)


@app.post("/api/admin/question-bank")
async def upload_question_bank(file: UploadFile, user: dict = Depends(admin_user)):
    """Take a fresh download of the live Finance Club workbook and import any new rows (shared by everyone)."""
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / importer.LIVE_FILE
        path.write_bytes(await file.read())
        return importer.import_live_file(path)


@app.post("/api/admin/import-local-files")
def import_local_question_banks(user: dict = Depends(admin_user)):
    """Re-read the question bank workbooks in this server's data folder."""
    return importer.run_import()


@app.get("/api/admin/model-check")
async def model_check(user: dict = Depends(admin_user)):
    """One tiny real model call, so setup problems show up immediately."""
    try:
        agent = Agent(get_model(), instructions="Reply with the single word: ready")
        result = await agent.run("Are you there?")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"{type(exc).__name__}: {exc}")
    return {"reply": result.output, "usage": usage_dict(result.usage)}


# The built website, served by this same server on the hosted site. Mounted last so /api routes win.
if config.FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=config.FRONTEND_DIST, html=True), name="site")
