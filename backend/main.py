"""HTTP API. Every route below the account routes runs for the signed-in user only (see auth.py)."""
import json
import re
import tempfile
from datetime import datetime
from pathlib import Path

from fastapi import Depends, FastAPI, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from pydantic_ai import Agent

from . import banks as banks_info
from . import accounts, assistant, attachments, auth, budget, capiq, catch_up, config, cover_letters, deal_docs, deal_recs, deal_sources, deals, importer, legal, llm, network, onboarding, practice, profile, schools, reference, research, shared, stars, sync, templates, thank_you, transfer, user_keys
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
    if user is None:
        return {"user": None}
    prof = profile.get(user["id"])
    return {"user": user, "context": schools.for_user(user["id"]), "needs_setup": not prof["onboarded_at"]}


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


class CodeRequest(BaseModel):
    code: str


class ForgotRequest(BaseModel):
    email: str


class ResetRequest(BaseModel):
    email: str
    code: str
    password: str


@app.post("/api/verify-email")
def verify_email(req: CodeRequest, user: dict = Depends(current_user)):
    try:
        return {"ok": True, "user": accounts.verify_email(user["id"], req.code)}
    except accounts.AccountError as err:
        raise HTTPException(status_code=400, detail=str(err))


@app.post("/api/verify-email/resend")
def resend_verification(user: dict = Depends(current_user)):
    try:
        accounts.send_code(user["email"], "verify")
    except accounts.AccountError as err:
        raise HTTPException(status_code=400, detail=str(err))
    return {"ok": True}


@app.post("/api/password/forgot")
def forgot_password(req: ForgotRequest):
    try:
        accounts.request_reset(req.email)
    except accounts.AccountError as err:
        raise HTTPException(status_code=400, detail=str(err))
    return {"ok": True}


@app.post("/api/password/reset")
def reset_password(req: ResetRequest, request: Request):
    try:
        user, token = accounts.reset_password(req.email, req.code, req.password)
    except accounts.AccountError as err:
        raise HTTPException(status_code=400, detail=str(err))
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


@app.get("/api/reader.zip")
def reader_download():
    """The Recruiting HQ Reader extension as a zip, for "Load unpacked" in Chrome (its code is the same for everyone)."""
    import io
    import zipfile
    folder = config.ROOT / "reader-extension"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(folder.iterdir()):
            if f.is_file() and f.suffix in (".js", ".json", ".html", ".png"):
                z.write(f, f"Recruiting HQ Reader/{f.name}")
    return Response(buf.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": 'attachment; filename="Recruiting HQ Reader.zip"'})


# ---- Reading the tracker ----

@app.get("/api/home")
def home(user: dict = Depends(current_user)):
    return {**network.home(user["id"]), "ai_used_today": budget.used_today(user["id"]), "ai_budget": config.DAILY_TOKEN_BUDGET}


@app.get("/api/banks")
def banks(user: dict = Depends(current_user)):
    return network.bank_list(user["id"])


@app.get("/api/timeline")
def recruiting_timeline(user: dict = Depends(current_user)):
    return network.timeline(user["id"])


@app.get("/api/banks/{bank}")
def bank(bank: str, user: dict = Depends(current_user)):
    detail = network.bank_detail(user["id"], bank)
    if detail is None:
        raise HTTPException(status_code=404, detail=f"No bank named {bank!r} in your tracker")
    return detail


@app.get("/api/prep/options")
def prep_options(user: dict = Depends(current_user)):
    out = network.prep_options(user["id"])
    if not schools.for_user(user["id"])["club"]:  # the club question bank is Yale SOM's material
        out = {**out, "counts": [], "rounds": out["rounds"]}
    return out


@app.get("/api/prep/questions")
def prep_questions(bank: str = "Any", round: str = "Any", user: dict = Depends(current_user)):
    if not schools.for_user(user["id"])["club"]:
        return {"total": 0, "questions": []}
    return network.prep_questions(bank, round)


class PracticeRequest(BaseModel):
    categories: list[str] = []
    topics: list[str] = []
    stage: str = ""
    difficulty: str = "adaptive"
    bank: str = "Any"
    seen: list[str] = []
    like: str = ""  # key of a question to find a similar one to


class AnswerRequest(BaseModel):
    key: str
    answer: str = ""


class MarkRequest(BaseModel):
    verdict: str


@app.get("/api/practice/options")
def practice_options(user: dict = Depends(current_user)):
    return practice.options()


@app.post("/api/practice/next")
def practice_next(req: PracticeRequest, user: dict = Depends(current_user)):
    built = practice.rebuild(req.like, user["id"]) if req.like else None
    like = built[0] if built else None
    q = practice.next_question(user["id"], req.categories, req.topics, req.stage, req.difficulty, req.bank, req.seen[-300:], like,
                               club=schools.for_user(user["id"])["club"])
    return {"question": q}


@app.post("/api/practice/answer")
async def practice_answer(req: AnswerRequest, user: dict = Depends(current_user)):
    try:  # grading works without a model too (worked solutions, self-marking), so a missing key is not an error here
        chosen = ai_for(user)
    except HTTPException:
        chosen = None
    out = await practice.grade(user["id"], chosen, req.key, req.answer[:4000])
    if out is None:
        raise HTTPException(status_code=404, detail="Question not found")
    return out


class FollowUpRequest(BaseModel):
    question: str
    history: list[dict] = []


@app.post("/api/practice/attempts/{attempt_id}/ask")
async def practice_ask(attempt_id: int, req: FollowUpRequest, user: dict = Depends(current_user)):
    """A follow-up question about a practice question and its explanation."""
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Type a question first.")
    out = await practice.ask(user["id"], ai_for(user), attempt_id, req.question, req.history)
    if out is None:
        raise HTTPException(status_code=404, detail="Practice question not found")
    return out


@app.post("/api/practice/attempts/{attempt_id}/mark")
def practice_mark(attempt_id: int, req: MarkRequest, user: dict = Depends(current_user)):
    return practice.mark(user["id"], attempt_id, req.verdict)


@app.delete("/api/practice/attempts/{attempt_id}")
def practice_delete(attempt_id: int, user: dict = Depends(current_user)):
    return practice.delete(user["id"], attempt_id)


@app.get("/api/practice/history")
def practice_history(user: dict = Depends(current_user)):
    return practice.history(user["id"])


@app.get("/api/practice/progress")
def practice_progress(user: dict = Depends(current_user)):
    return practice.progress(user["id"])


@app.get("/api/deals")
def my_deals(user: dict = Depends(current_user)):
    if accounts.in_preview(user):
        capiq.ensure()  # each deal's Capital IQ link
    out = deals.all_deals(user["id"])
    if accounts.in_preview(user):  # preview: each deal's reading list, and where each gathered document came from
        reading, urls = deal_sources.reading(user["id"]), deal_sources.source_urls(user["id"])
        for d in out["deals"]:
            d["reading"] = reading.get(d["id"], [])
            for doc in d["documents"]:
                found = urls.get(doc["id"], {})
                doc["source_url"], doc["source_page"] = found.get("url", ""), found.get("page", "")
    return out


@app.post("/api/deals/{deal_id}/gather")
async def gather_deal_documents(deal_id: int, user: dict = Depends(current_user)):
    """Preview: download the deal's filings from SEC EDGAR and the companies' own sites."""
    if not accounts.in_preview(user):
        raise HTTPException(status_code=404, detail="Not found")
    return await deal_sources.gather(user["id"], ai_for(user), deal_id)


@app.post("/api/deals/{deal_id}/to-pdf")
async def deal_documents_to_pdf(deal_id: int, user: dict = Depends(current_user)):
    """Turn the deal's SEC web-page copies into PDFs (no AI, so it works when the day's allowance is used)."""
    return await deal_sources.convert(user["id"], deal_id)


@app.post("/api/deals/{deal_id}/reading")
async def find_deal_reading(deal_id: int, user: dict = Depends(current_user)):
    """Preview: analysis pieces about the deal, each with a different angle."""
    if not accounts.in_preview(user):
        raise HTTPException(status_code=404, detail="Not found")
    return await deal_sources.find_reading(user["id"], ai_for(user), deal_id)


@app.delete("/api/deals/reading/{item_id}")
def remove_deal_reading(item_id: int, user: dict = Depends(current_user)):
    if not accounts.in_preview(user):
        raise HTTPException(status_code=404, detail="Not found")
    return deal_sources.remove_reading(user["id"], item_id)


# Preview routes 404 for everyone else.
def preview_user(user: dict = Depends(current_user)) -> dict:
    if not accounts.in_preview(user):
        raise HTTPException(status_code=404, detail="Not found")
    return user


@app.get("/api/deals/recommended")
def recommended_deals(bank: str = "", user: dict = Depends(current_user)):
    """Preview: the last deals recommended for the student (or for one bank), by the Finance Club's criteria."""
    if not accounts.in_preview(user):
        raise HTTPException(status_code=404, detail="Not found")
    return deal_recs.saved(user["id"], bank)


@app.post("/api/deals/recommended")
async def find_recommended_deals(bank: str = "", user: dict = Depends(current_user)):
    if not accounts.in_preview(user):
        raise HTTPException(status_code=404, detail="Not found")
    return await deal_recs.recommend(user["id"], ai_for(user), bank)


@app.get("/api/deals/capiq-queue")
def capiq_queue(user: dict = Depends(current_user)):
    """For the Reader: recommended deals still to look up on Capital IQ in the student's own Chrome."""
    return deal_recs.capiq_queue(user["id"])


@app.post("/api/deals/capiq")
def capiq_result(got: deal_recs.CapIQDeal, user: dict = Depends(current_user)):
    return deal_recs.capiq_save(user["id"], got)


class CapIQLink(BaseModel):
    url: str


@app.post("/api/deals/{deal_id}/capiq-link")
def set_capiq_link(deal_id: int, req: CapIQLink, user: dict = Depends(preview_user)):
    """Preview: the deal's Capital IQ transaction page, which the reader reads from the student's Chrome."""
    return capiq.set_link(user["id"], deal_id, req.url)


@app.post("/api/deals/{deal_id}/capiq-want")
def want_capiq(deal_id: int, user: dict = Depends(preview_user)):
    return capiq.want(user["id"], deal_id)


@app.get("/api/capiq/jobs")
def capiq_jobs(user: dict = Depends(preview_user)):
    """For the reader: the deals whose Capital IQ pages to fetch."""
    return capiq.jobs(user["id"])


class CapIQPages(BaseModel):
    deal_id: int
    url: str
    overview_html: str
    comps_html: str = ""


@app.post("/api/capiq/pages")
def capiq_pages(req: CapIQPages, user: dict = Depends(preview_user)):
    """For the reader: the transaction summary (and comps) pages it fetched, saved as a PDF and read into the pitch."""
    if len(req.overview_html) + len(req.comps_html) > 6_000_000 or not capiq.clean_link(req.url):
        raise HTTPException(status_code=400, detail="Not a Capital IQ transaction page.")
    return capiq.save(user["id"], req.deal_id, capiq.clean_link(req.url), req.overview_html, req.comps_html)


class NewDeal(BaseModel):
    title: str
    banks: list[str] = []


@app.post("/api/deals")
def add_deal(req: NewDeal, user: dict = Depends(current_user)):
    return deals.add_deal(user["id"], req.title, req.banks)


@app.get("/api/calendar")
def recruiting_calendar(user: dict = Depends(current_user)):
    return network.calendar() if schools.for_user(user["id"])["club"] else []  # the club's own calendar


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


# ---- Deal documents ----

@app.post("/api/deals/{deal_id}/documents")
async def upload_deal_document(deal_id: int, file: UploadFile, kind: str = Form("Other"), user: dict = Depends(current_user)):
    data = await file.read()
    out = deal_docs.upload(user["id"], deal_id, file.filename or "document.pdf", data, kind)
    if not out["ok"]:
        raise HTTPException(status_code=400, detail=out["reason"])
    return out


@app.get("/api/deals/documents/{doc_id}/file")
def deal_document_file(doc_id: int, download: bool = False, user: dict = Depends(current_user)):
    found = deal_docs.file(user["id"], doc_id)
    if found is None:
        raise HTTPException(status_code=404, detail="Document not found")
    name, data = found
    if download:  # saved to the user's computer as the original file, never shown as a page on this site
        safe = re.sub(r"[^\w.\-() &,']", "_", name)[:150]
        return Response(content=data, media_type="application/octet-stream",
                        headers={"Content-Disposition": f'attachment; filename="{safe}"', "X-Content-Type-Options": "nosniff"})
    kind = "application/pdf" if name.lower().endswith(".pdf") else "text/html" if name.lower().endswith((".htm", ".html")) else "text/plain"
    if kind == "text/html":
        kind = "text/plain"  # show a saved filing's source as text rather than running it as a page on this site
    safe = re.sub(r"[^\w.\- ]", "_", name)[:120]
    return Response(content=data, media_type=kind, headers={"Content-Disposition": f'inline; filename="{safe}"', "X-Content-Type-Options": "nosniff"})


@app.delete("/api/deals/documents/{doc_id}")
def delete_deal_document(doc_id: int, user: dict = Depends(current_user)):
    return deal_docs.delete(user["id"], doc_id)


@app.post("/api/deals/{deal_id}/fill-from-documents")
async def fill_deal_from_documents(deal_id: int, user: dict = Depends(current_user)):
    return await deal_docs.fill_from_documents(user["id"], ai_for(user), deal_id)


@app.post("/api/deals/{deal_id}/find-online")
async def find_deal_online(deal_id: int, user: dict = Depends(current_user)):
    return await deal_docs.find_online(user["id"], ai_for(user), deal_id)


@app.post("/api/deals/points/{point_id}/clear")
def clear_deal_point(point_id: int, user: dict = Depends(current_user)):
    return deal_docs.clear_point(user["id"], point_id)


# ---- First-run setup ----

class SchoolRequest(BaseModel):
    school: str
    level: str
    class_year: str = ""
    school_line: str = ""
    contact_line: str = ""


class BanksRequest(BaseModel):
    banks: list[str]
    groups: list[str] = []
    story: str | None = None


class TemplatesRequest(BaseModel):
    email_templates: dict[str, str] = {}
    email_rules: str | None = None


@app.get("/api/setup")
def setup_state(user: dict = Depends(current_user)):
    return onboarding.state(user["id"])


@app.post("/api/setup/school")
def setup_school(req: SchoolRequest, user: dict = Depends(current_user)):
    school = " ".join(req.school.split())
    if not school:
        raise HTTPException(status_code=400, detail="Pick or type your school.")
    level = req.level if req.level in schools.LEVELS else "mba"
    ctx = schools.describe(school, level, req.class_year.strip())
    profile.save(user["id"], {"school": school, "level": level, "class_year": req.class_year,
                              "school_line": req.school_line.strip() or schools.default_school_line(ctx),
                              "contact_line": req.contact_line})
    return onboarding.state(user["id"])


@app.post("/api/setup/banks")
def setup_banks(req: BanksRequest, user: dict = Depends(current_user)):
    out = onboarding.save_banks(user["id"], req.banks, req.groups)
    if req.story is not None:
        profile.save(user["id"], {"story": req.story})
    return out | {"state": onboarding.state(user["id"])}


@app.post("/api/setup/templates")
def setup_templates(req: TemplatesRequest, user: dict = Depends(current_user)):
    """Save the user's email templates (any of: outreach, calendar_invite, post_chat, slots_expired)."""
    for kind, text in req.email_templates.items():
        problem = thank_you.template_problem(text) if kind == "post_chat" else None
        if problem:
            raise HTTPException(status_code=400, detail=f"{templates.EMAIL_KINDS.get(kind, {}).get('label', kind)}: {problem}")
    templates.save_email_templates(user["id"], req.email_templates)
    if req.email_rules is not None:
        profile.save(user["id"], {"email_rules": req.email_rules})
    return onboarding.state(user["id"])


class ClubTemplatesRequest(BaseModel):
    force: bool = False


@app.post("/api/admin/club-templates")
def make_club_templates(req: ClubTemplatesRequest, user: dict = Depends(admin_user)):
    """Make the admin's email templates the standard every Yale account starts with."""
    out = templates.set_club_standard(user["id"], req.force)
    if not out["ok"]:
        raise HTTPException(status_code=409, detail="Your templates contain personal details that would go to everyone: "
                            + "; ".join(out["problems"]) + ". Put them in [brackets] first, or confirm to publish anyway.")
    return onboarding.state(user["id"])


@app.post("/api/setup/cover-template")
async def upload_cover_template(file: UploadFile, user: dict = Depends(current_user)):
    """Save the user's cover letter Word file; new letters are written into a copy of it."""
    data = await file.read()
    if len(data) > 5_000_000:
        raise HTTPException(status_code=400, detail="That file is over 5 MB.")
    if not (file.filename or "").lower().endswith(".docx"):
        raise HTTPException(status_code=400, detail="Upload the Word (.docx) version of your cover letter.")
    out = templates.save_cover_template(user["id"], file.filename or "cover letter.docx", data)
    if not out["ok"]:
        raise HTTPException(status_code=400, detail=out["reason"])
    return onboarding.state(user["id"])


@app.delete("/api/setup/cover-template")
def delete_cover_template(user: dict = Depends(current_user)):
    templates.remove_cover_template(user["id"])
    return onboarding.state(user["id"])


@app.get("/api/setup/cover-template/file")
def download_cover_template(user: dict = Depends(current_user)):
    info = templates.cover_template_info(user["id"])
    name = info["filename"] if info["has_template"] else "Yale SOM Cover Letter Template.docx"
    safe = re.sub(r"[^\w.\-() ]", "_", name)[:120]
    return Response(content=templates.cover_template_bytes(user["id"]),
                    media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    headers={"Content-Disposition": f'attachment; filename="{safe}"'})


@app.post("/api/setup/finish")
def setup_finish(user: dict = Depends(current_user)):
    profile.finish_setup(user["id"])
    return {"ok": True}


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


@app.post("/api/assistant/file")
async def assistant_file(file: UploadFile, message: str = Form(""), history: str = Form("[]"), user: dict = Depends(current_user)):
    """A file dropped into the assistant (a team card, a saved email, a screenshot), filed like a pasted message."""
    chosen = ai_for(user)
    name = (file.filename or "file").strip()
    try:
        text, binary = attachments.read(name, await file.read(), outlook=accounts.in_preview(user))
    except attachments.AttachmentError as err:
        raise HTTPException(status_code=400, detail=str(err))
    try:
        past = json.loads(history)
    except ValueError:
        past = []
    note = message.strip() or "File what this tells you about my recruiting."
    body = f'{note}\n\nAttached file "{name}":\n{text}' if text else f'{note}\n\n(Attached file "{name}" is shown to you below.)'
    out = await assistant.run(user, chosen, body, past if isinstance(past, list) else [], transcript=True, attachment=binary)
    return await with_thank_you_drafts(user, chosen, out)


@app.post("/api/catch-up")
async def catch_up_bank(req: catch_up.BankCatchUp, user: dict = Depends(current_user)):
    """Preview: one bank of a student's past recruiting, from the catch-up form, filed by the assistant."""
    if not accounts.in_preview(user):
        raise HTTPException(status_code=404, detail="Not found")
    if not any(p.name.strip() for p in req.people) and not (req.emails + req.notes + req.sheet_rows).strip() and not req.applied:
        return {"reply": "Nothing to file for this bank.", "steps": [], "usage": None, "run_id": None, "changed": False}
    chosen = ai_for(user)
    sc = schools.for_user(user["id"])
    return await assistant.run(user, chosen, catch_up.message(req, sc["short"] or "school", sc["peer"]), [], transcript=True)


@app.post("/api/catch-up/sheet")
async def catch_up_sheet(file: UploadFile, user: dict = Depends(current_user)):
    """Preview: a student's own networking spreadsheet, split into one block of rows per bank (nothing is saved yet)."""
    if not accounts.in_preview(user):
        raise HTTPException(status_code=404, detail="Not found")
    try:
        return catch_up.split_sheet(file.filename or "sheet", await file.read())
    except catch_up.SheetError as err:
        raise HTTPException(status_code=400, detail=str(err))


# ---- Preview: the Recruiting HQ Reader (read-only sync from email, Slack and WhatsApp) ----

@app.get("/api/sync/state")
def sync_state(user: dict = Depends(preview_user)):
    return sync.state(user["id"])


@app.post("/api/sync/key")
def sync_key(user: dict = Depends(preview_user)):
    """A sign-in key for the reader extension, shown once; making a new one turns the old one off."""
    return {"key": sync.new_key(user)}


@app.post("/api/sync/key/revoke")
def sync_key_revoke(user: dict = Depends(preview_user)):
    sync.revoke(user["id"])
    return {"ok": True}


@app.post("/api/sync/config")
def sync_config(config: sync.ReaderConfig, user: dict = Depends(preview_user)):
    """What the reader reads (Slack channels, WhatsApp groups), kept in the account rather than in the extension's code."""
    return sync.set_config(user["id"], config)


@app.post("/api/sync/ingest")
async def sync_ingest(batch: sync.Batch, user: dict = Depends(preview_user)):
    if batch.source not in ("outlook", "slack", "whatsapp") or len(batch.items) > 400:
        raise HTTPException(status_code=400, detail="Unknown source or too many messages at once.")
    return await sync.ingest(user, ai_for(user), batch)


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


class RecordRequest(BaseModel):
    interaction_id: int
    person_id: int
    body: str


@app.post("/api/thank-you/record")
def record_thank_you(req: RecordRequest, user: dict = Depends(current_user)):
    """Preview: keep a thank-you the student sent outside the app, so it shows on the contact."""
    if not accounts.in_preview(user):
        raise HTTPException(status_code=404, detail="Not found")
    return thank_you.record_sent(user["id"], req.interaction_id, req.person_id, req.body)


@app.post("/api/people/{person_id}/background")
async def look_up_background(person_id: int, user: dict = Depends(current_user)):
    result = await research.look_up(user["id"], ai_for(user), person_id)
    if result is None:
        raise HTTPException(status_code=404, detail="No such person in your tracker")
    return result


@app.post("/api/people/{person_id}/background/clear")
def clear_background(person_id: int, user: dict = Depends(current_user)):
    return research.clear(user["id"], person_id)


# ---- Profile and cover letters ----

@app.get("/api/profile")
def get_profile(user: dict = Depends(current_user)):
    return profile.get(user["id"])


@app.post("/api/profile")
def save_profile(fields: dict, user: dict = Depends(current_user)):
    return profile.save(user["id"], fields)


@app.post("/api/profile/resume")
async def upload_resume(file: UploadFile, user: dict = Depends(current_user)):
    data = await file.read()
    if len(data) > 5_000_000:
        raise HTTPException(status_code=400, detail="That file is over 5 MB.")
    try:
        text = profile.text_from_upload(file.filename or "", data)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    if len(text.strip()) < 200:
        raise HTTPException(status_code=400, detail="Could not read much text from that file. Try the Word version, or paste the text instead.")
    return profile.save(user["id"], {"resume_text": text})


@app.get("/api/cover-letters")
def list_cover_letters(user: dict = Depends(current_user)):
    return cover_letters.overview(user["id"])


@app.get("/api/cover-letters/{bank}")
def get_cover_letter(bank: str, user: dict = Depends(current_user)):
    return cover_letters.get(user["id"], bank)


@app.post("/api/cover-letters/{bank}/write")
async def write_cover_letter(bank: str, user: dict = Depends(current_user)):
    return await cover_letters.write(user["id"], ai_for(user), bank)


class LetterEdits(BaseModel):
    paragraphs: list[str] | None = None
    details: dict = {}


@app.post("/api/cover-letters/{bank}")
def edit_cover_letter(bank: str, req: LetterEdits, user: dict = Depends(current_user)):
    return cover_letters.save_edits(user["id"], bank, req.paragraphs, req.details)


@app.get("/api/cover-letters/{bank}/docx")
def download_cover_letter(bank: str, user: dict = Depends(current_user)):
    parts = user["name"].split() or ["Cover"]
    name = f"{parts[-1]}_{' '.join(parts[:-1]) or parts[-1]} Cover Letter ({bank}).docx"  # e.g. Nagli_Luke Cover Letter (Citi).docx
    return Response(cover_letters.docx_bytes(user["id"], bank),
                    media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


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
        out = importer.import_live_file(path)
    reference.load_question_bank_notes()  # keep the answer library in step with the question bank
    return out


@app.post("/api/admin/question-bank/dedupe")
def dedupe_question_bank(user: dict = Depends(admin_user)):
    """Keep one copy of each question per bank in the shared question bank."""
    init_db()
    with connect() as conn:
        return importer.dedupe_questions(conn)


class SharedQuestion(BaseModel):
    question: str
    bank: str
    qtype: str = "Technical"
    round: str = "Unknown"
    grp: str = ""
    interviewer: str = ""
    year: str = ""
    answer_notes: str = ""


class SharedQuestions(BaseModel):
    source: str  # where they came from, e.g. "2Y notes: JPM first-round chats"
    questions: list[SharedQuestion]


@app.post("/api/admin/question-bank/add")
def add_shared_questions(req: SharedQuestions, user: dict = Depends(admin_user)):
    """Add questions the admin collected (for example a 2Y's write-up) to the shared question bank, skipping any it has."""
    return importer.add_questions(req.source, [q.model_dump() for q in req.questions])


class ReferenceUpload(BaseModel):
    source: str
    passages: list[dict]
    private: bool = True


@app.post("/api/admin/reference")
def upload_reference(req: ReferenceUpload, user: dict = Depends(admin_user)):
    """Load one source into the answer library: private to this admin, or shared with every account."""
    if not req.source.strip() or len(req.passages) > 5000:
        raise HTTPException(status_code=400, detail="Give a source name and at most 5,000 passages.")
    return reference.load(user["id"] if req.private else None, req.source.strip(), req.passages)


@app.post("/api/admin/reference/question-bank")
def index_question_bank_answers(user: dict = Depends(admin_user)):
    return reference.load_question_bank_notes()


@app.get("/api/stars")
def star_stories(user: dict = Depends(current_user)):
    return stars.all_stories(user["id"])


@app.post("/api/stars/{key}")
def save_star_story(key: str, fields: dict, user: dict = Depends(current_user)):
    out = stars.save(user["id"], key, fields)
    if out is None:
        raise HTTPException(status_code=404, detail="Unknown question")
    return out


@app.get("/api/practice/library")
def answer_library_sources(user: dict = Depends(current_user)):
    return reference.library(user["id"])


@app.post("/api/library/guides")
async def upload_guide(file: UploadFile, name: str = Form(""), user: dict = Depends(current_user)):
    """Add a study guide the user owns (e.g. their Breaking Into Wall Street PDFs). Private to their account."""
    data = await file.read()
    if len(data) > 40_000_000:
        raise HTTPException(status_code=400, detail="That file is over 40 MB.")
    out = reference.add_guide(user["id"], file.filename or "My guide.pdf", data, name)
    if not out["ok"]:
        raise HTTPException(status_code=400, detail=out["reason"])
    return {**out, "library": reference.library(user["id"])}


@app.delete("/api/library/guides")
def remove_guide(source: str, user: dict = Depends(current_user)):
    reference.remove_source(user["id"], source)
    return reference.library(user["id"])


@app.post("/api/admin/import-local-files")
def import_local_question_banks(user: dict = Depends(admin_user)):
    """Re-read the question bank workbooks in this server's data folder."""
    out = importer.run_import()
    reference.load_question_bank_notes()
    return out


@app.get("/api/admin/model-check")
async def model_check(user: dict = Depends(admin_user)):
    """One tiny real model call, so setup problems show up immediately."""
    try:
        agent = Agent(get_model(), instructions="Reply with the single word: ready")
        result = await agent.run("Are you there?")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"{type(exc).__name__}: {exc}")
    return {"reply": result.output, "usage": usage_dict(result.usage)}


# ---- The admin panel: what goes to everyone ----

@app.get("/api/admin/overview")
def admin_overview(user: dict = Depends(admin_user)):
    return {"users": shared.users(), "bank_defaults": shared.bank_defaults(), "club_chats": shared.club_chats(),
            "chat_directory": shared.chat_directory(), "slack_team": shared.slack_team(), "feed": shared.feed(limit=80),
            "early_access": sorted(accounts.early_access()),
            "groups": schools.options(), "domains": banks_info.DOMAINS}


class EarlyAccess(BaseModel):
    emails: list[str]


@app.post("/api/admin/early-access")
def set_early_access(req: EarlyAccess, user: dict = Depends(admin_user)):
    """Who sees the preview besides the admin (friends trying it before it ships to everyone)."""
    return accounts.set_early_access(req.emails)


class BankDefaults(BaseModel):
    banks: dict[str, dict]


@app.post("/api/admin/bank-defaults")
def push_bank_defaults(req: BankDefaults, user: dict = Depends(admin_user)):
    """Push recruiter names, titles, formal names and addresses to every account (students' own entries win)."""
    return shared.push_bank_defaults(req.banks)


class ChatSettings(BaseModel):
    club_chats: list[str]
    chat_directory: list[dict]
    slack_team: str = ""


@app.post("/api/admin/chats")
def push_chat_settings(req: ChatSettings, user: dict = Depends(admin_user)):
    return {"club_chats": shared.set_club_chats(req.club_chats), "chat_directory": shared.set_chat_directory(req.chat_directory),
            "slack_team": shared.set_slack_team(req.slack_team)}


@app.post("/api/admin/feed/{update_id}/hide")
def hide_feed_update(update_id: int, user: dict = Depends(admin_user)):
    shared.hide_update(update_id)
    return {"ok": True}


@app.get("/api/club-feed")
def club_feed(bank: str = "", user: dict = Depends(current_user)):
    """What the club chats said that matters to everyone (read once by the admin's reader)."""
    return shared.feed(bank)


@app.get("/privacy", include_in_schema=False)
def privacy_page():
    return HTMLResponse(legal.page("privacy"))


@app.get("/terms", include_in_schema=False)
def terms_page():
    return HTMLResponse(legal.page("terms"))


# The built website, served by this same server on the hosted site. Mounted last so /api routes win.
if config.FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=config.FRONTEND_DIST, html=True), name="site")
