"""HTTP API. Every route below the account routes runs for the signed-in user only (see auth.py)."""
import json
import os
import re
import tempfile
from datetime import date, datetime
from pathlib import Path

from fastapi import Depends, FastAPI, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from pydantic_ai import Agent
from starlette.background import BackgroundTask

from . import banks as banks_info
from . import tracker_edits
from . import chat_notes, filing_queue, folder_setup, interviewer, scan_cleanup
from . import accounts, assistant, attachments, auth, budget, capiq, catch_up, config, cover_letters, deal_docs, deal_recs, deal_sources, deals, honorific, importer, legal, llm, market, network, onboarding, levels, practice, profile, question_clean, schools, reference, research, shared, stars, stories, superday, sync, templates, test_scan, thank_backfill, thank_you, transfer, user_keys
from .auth import admin_user, current_user
from .db import connect, init_db
from .llm import get_model, usage_dict

app = FastAPI(title="Recruiting HQ")


@app.on_event("startup")
async def start_filing_worker():
    """The reader's filing runs in the background here (filing_queue), so a student needn't wait for it."""
    import asyncio

    app.state.filing_worker = asyncio.create_task(filing_queue.worker())
    # new school bank entries get the answer some students typed into them split out (question_clean)
    app.state.question_clean = asyncio.create_task(question_clean.on_start())
    # technical questions not yet rated on the club's difficulty scale get rated (levels)
    app.state.level_rating = asyncio.create_task(levels.on_start())
    app.state.greetings = asyncio.create_task(honorific.on_start())  # Mr./Ms. for recruiters saved without it
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
    return {"user": user, "context": schools.for_user(user["id"]), "needs_setup": not prof["onboarded_at"] or _setup_again(user, prof)}


READER_STEP_ADDED = "2026-11-05"  # setup's Outlook step dates from here


def _setup_again(user: dict, prof: dict) -> bool:
    """Someone who finished setup before it had the Outlook step, and hasn't connected the reader, goes through
    setup once more (their key, resume and banks are kept, so those steps are already filled in). Finishing it again
    stamps a new date, so it isn't shown twice."""
    if prof["onboarded_at"][:10] >= READER_STEP_ADDED:
        return False
    return not sync.state(user["id"])["has_key"]


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
    return {**network.home(user["id"]), "ai_used_today": budget.used_for_allowance(user["id"]), "ai_budget": budget.allowance(user["id"])}


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


@app.get("/api/prep/superday")
def superday_brief(bank: str = "", user: dict = Depends(current_user)):
    """Superday prep for one bank: its Superday questions, your weakest technical areas, and your saved story."""
    out = superday.brief(user["id"], bank.strip())
    if not schools.for_user(user["id"])["club"]:  # the question bank is the school club's material
        out |= {"questions": [], "total": 0, "by_type": {}}
    return out


class StoryRequest(BaseModel):
    bank: str = Field(min_length=1, max_length=120)


@app.post("/api/prep/superday/story")
async def superday_story(req: StoryRequest, user: dict = Depends(current_user)):
    return await superday.write_story(user["id"], ai_for(user), req.bank)


class PracticeRequest(BaseModel):
    categories: list[str] = []
    topics: list[str] = []
    stage: str = ""
    difficulty: str = "adaptive"
    bank: str = "Any"
    seen: list[str] = []
    like: str = ""  # key of a question to find a similar one to
    guides: list[str] | None = []  # uploaded guides to include: [] all of them (the default), None none
    after: str = ""  # a guide question just answered: return its follow-up (the next part of the same question)


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
    if req.after:  # the next part of a question with follow-ups
        return {"question": practice.next_part(user["id"], req.after)}
    built = practice.rebuild(req.like, user["id"]) if req.like else None
    like = built[0] if built else None
    q = practice.next_question(user["id"], req.categories, req.topics, req.stage, req.difficulty, req.bank, req.seen[-300:], like,
                               guides=req.guides,
                               club=schools.for_user(user["id"])["club"])
    return {"question": practice.with_next(user["id"], q)}


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


class SmallTalk(BaseModel):
    said: str = Field(default="", max_length=1000)
    bank: str = ""


@app.post("/api/practice/interviewer/small-talk")
async def interviewer_small_talk(req: SmallTalk, user: dict = Depends(current_user)):
    """A voice interview's opening: the interviewer's short reply to how the student says they're doing."""
    try:
        chosen = ai_for(user)
    except HTTPException:
        chosen = None  # no key or the day's allowance is used: a set line instead
    return {"reply": await interviewer.small_talk(user["id"], chosen, req.said, req.bank[:80])}


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
    capiq.ensure()  # each deal's Capital IQ link
    out = deals.all_deals(user["id"])
    # each deal's reading list, and where each gathered document came from
    reading, urls = deal_sources.reading(user["id"]), deal_sources.source_urls(user["id"])
    for d in out["deals"]:
        d["reading"] = reading.get(d["id"], [])
        for doc in d["documents"]:
            found = urls.get(doc["id"], {})
            doc["source_url"], doc["source_page"] = found.get("url", ""), found.get("page", "")
    return out


@app.post("/api/deals/{deal_id}/gather")
async def gather_deal_documents(deal_id: int, user: dict = Depends(current_user)):
    """Download the deal's filings from SEC EDGAR and the companies' own sites."""
    return await deal_sources.gather(user["id"], ai_for(user), deal_id)


@app.post("/api/deals/{deal_id}/to-pdf")
async def deal_documents_to_pdf(deal_id: int, user: dict = Depends(current_user)):
    """Turn the deal's SEC web-page copies into PDFs (no AI, so it works when the day's allowance is used)."""
    return await deal_sources.convert(user["id"], deal_id)


@app.post("/api/deals/{deal_id}/reading")
async def find_deal_reading(deal_id: int, user: dict = Depends(current_user)):
    """Analysis pieces about the deal, each with a different angle."""
    return await deal_sources.find_reading(user["id"], ai_for(user), deal_id)


@app.delete("/api/deals/reading/{item_id}")
def remove_deal_reading(item_id: int, user: dict = Depends(current_user)):
    return deal_sources.remove_reading(user["id"], item_id)


def reader_user(user: dict = Depends(current_user)) -> dict:
    """Whose tracker the reader fills: the signed-in account's, or, while its owner runs a test scan, the test tracker's."""
    return test_scan.target(user)


@app.get("/api/deals/recommended")
def recommended_deals(bank: str = "", user: dict = Depends(current_user)):
    """The last deals recommended for the student (or for one bank), by the Finance Club's criteria."""
    return deal_recs.saved(user["id"], bank)


@app.post("/api/deals/recommended")
async def find_recommended_deals(bank: str = "", user: dict = Depends(current_user)):
    return await deal_recs.recommend(user["id"], ai_for(user), bank)


@app.get("/api/deals/capiq-queue")
def capiq_queue(user: dict = Depends(current_user)):
    """For the Reader: recommended deals still to look up on Capital IQ in the student's own Chrome."""
    return deal_recs.capiq_queue(user["id"])


@app.post("/api/deals/capiq")
def capiq_result(got: deal_recs.CapIQDeal, user: dict = Depends(current_user)):
    return deal_recs.capiq_save(user["id"], got)


@app.get("/api/deals/{deal_id}/announced")
def deal_announced(deal_id: int, user: dict = Depends(current_user)):
    """The announcement date found in the deal's timeline, to prefill the share price lookup."""
    found = market.announced_on(deal_id, user["id"])
    return {"announced": found.isoformat() if found else ""}


class MarketRequest(BaseModel):
    announced: str = ""


@app.post("/api/deals/{deal_id}/market")
def deal_market(deal_id: int, req: MarketRequest, user: dict = Depends(current_user)):
    """Both companies' share price reaction, from Yahoo Finance (no AI)."""
    return market.fill(user["id"], deal_id, req.announced)


class CapIQLink(BaseModel):
    url: str


@app.post("/api/deals/{deal_id}/capiq-link")
def set_capiq_link(deal_id: int, req: CapIQLink, user: dict = Depends(current_user)):
    """The deal's Capital IQ transaction page, which the reader reads from the student's Chrome."""
    return capiq.set_link(user["id"], deal_id, req.url)


@app.post("/api/deals/{deal_id}/capiq-want")
def want_capiq(deal_id: int, user: dict = Depends(current_user)):
    return capiq.want(user["id"], deal_id)


@app.get("/api/capiq/jobs")
def capiq_jobs(user: dict = Depends(current_user)):
    """For the reader: the deals whose Capital IQ pages to fetch."""
    return capiq.jobs(user["id"])


class CapIQPage(BaseModel):
    url: str          # what the reader was asked to fetch
    final_url: str    # where Capital IQ ended up (its sign-in page when the student isn't signed in)
    html: str


class CapIQPages(BaseModel):
    deal_id: int
    pages: list[CapIQPage]


@app.post("/api/capiq/pages")
def capiq_pages(req: CapIQPages, user: dict = Depends(current_user)):
    """For the reader: the Capital IQ pages fetched so far for one deal. Answers with the next pages to fetch, or, once it
    has them all, saves each as a PDF and reads them into the pitch."""
    if len(req.pages) > 12 or sum(len(p.html) for p in req.pages) > 15_000_000 or \
            any(not p.url.startswith(capiq.BASE + "/") for p in req.pages):
        raise HTTPException(status_code=400, detail="Not Capital IQ pages.")
    return capiq.step(user["id"], req.deal_id, [p.model_dump() for p in req.pages])


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
    if kind == deal_docs.CAPIQ_KIND:  # a CapIQ page the student saved as a PDF, linked to the deal's CapIQ page
        capiq.attach_upload(user["id"], deal_id, out["id"])
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


class PointEdit(BaseModel):
    value: str = Field(max_length=700)
    source: str = Field("My notes", max_length=200)


@app.post("/api/deals/points/{point_id}")
def edit_deal_point(point_id: int, req: PointEdit, user: dict = Depends(current_user)):
    """The student types a point in themselves (their own view, or a number they looked up)."""
    return deals.update_point(user["id"], point_id, req.value, req.source)


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
    try:
        chosen = llm.model_for(user)
    except llm.NoModelError as err:
        raise HTTPException(status_code=428, detail=str(err))
    # The daily allowance only guards the course key (the owner). Someone on their own key uses
    # what they need, billed to them.
    if chosen.provider == "course":
        budget.check(user["id"])
    return chosen

class ChatNotes(BaseModel):
    notes: str = Field(min_length=1, max_length=12000)
    name: str = ""
    bank: str = ""
    group: str = ""
    title: str = ""


@app.post("/api/chat-notes/polish")
async def polish_chat_notes(req: ChatNotes, user: dict = Depends(current_user)):
    """Dictated coffee chat notes, tidied into short bullets under a few headings (nothing added)."""
    chosen = ai_for(user)
    try:
        return {"notes": await chat_notes.polish(user["id"], chosen, req.notes, req.name[:120], req.bank[:80], req.group[:80], req.title[:80])}
    except Exception as err:  # noqa: BLE001 - the notes stay as dictated
        raise HTTPException(status_code=502, detail=f"Couldn't tidy the notes ({type(err).__name__}); they're kept as you said them.") from None


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
        text, binary = attachments.read(name, await file.read(), outlook=True)
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
    """One bank of a student's past recruiting, from the catch-up form, filed by the assistant."""
    if not any(p.name.strip() for p in req.people) and not (req.emails + req.notes + req.sheet_rows).strip() and not req.applied:
        return {"reply": "Nothing to file for this bank.", "steps": [], "usage": None, "run_id": None, "changed": False}
    chosen = ai_for(user)
    sc = schools.for_user(user["id"])
    return await assistant.run(user, chosen, catch_up.message(req, sc["short"] or "school", sc["peer"]), [], transcript=True)


@app.post("/api/catch-up/sheet")
async def catch_up_sheet(file: UploadFile, user: dict = Depends(current_user)):
    """A student's own networking spreadsheet, split into one block of rows per bank (nothing is saved yet)."""
    try:
        return catch_up.split_sheet(file.filename or "sheet", await file.read())
    except catch_up.SheetError as err:
        raise HTTPException(status_code=400, detail=str(err))


# ---- The Recruiting HQ Reader (read-only sync from email, Slack and WhatsApp) ----

class TrackerEdits(BaseModel):
    ops: list[dict]
    note: str = ""


@app.post("/api/tracker/edits")
def edit_tracker(req: TrackerEdits, user: dict = Depends(current_user)):
    """Direct corrections to the student's own tracker, without the AI (undone like an assistant run)."""
    return tracker_edits.apply(user["id"], req.ops, req.note)


@app.post("/api/todos/{entry_id}/done")
def todo_done(entry_id: int, user: dict = Depends(current_user)):
    """Tick a to-do off on the home page (no AI needed)."""
    with connect() as conn:
        n = conn.execute("UPDATE interactions SET status = 'done' WHERE id = ? AND user_id = ? AND status = 'todo'",
                         (entry_id, user["id"])).rowcount
    return {"ok": bool(n)}


class RereadRequest(BaseModel):
    since: str


@app.post("/api/sync/reread")
def sync_reread(req: RereadRequest, user: dict = Depends(current_user)):
    if not re.fullmatch(r"20\d\d-\d\d-\d\d", req.since):
        raise HTTPException(status_code=400, detail="since must be YYYY-MM-DD")
    return {"folders": sync.reread_from(user["id"], req.since)}


class FolderRecord(BaseModel):
    listed: list[str] = Field(default_factory=list, max_length=500)
    read: list[dict] = Field(default_factory=list, max_length=500)
    skipped: list[str] = Field(default_factory=list, max_length=500)


@app.post("/api/sync/folders")
def sync_folders_record(req: FolderRecord, user: dict = Depends(reader_user)):
    """From the reader after each Outlook round: which folders it saw, opened and skipped (how it learns your filing)."""
    return sync.record_folders(user["id"], req.listed, req.read, req.skipped)


@app.get("/api/sync/folders")
def sync_folders(user: dict = Depends(current_user)):
    """Each Outlook folder: read in full, screened or skipped on the next refresh, and why."""
    return {"folders": [f for f in sync.folder_plan(user["id"]) if not f.get("mailbox")]}


@app.get("/api/sync/folder-setup")
def folder_setup_get(user: dict = Depends(reader_user)):
    """Before your first scan: each Outlook folder, with what the site suggests (read, check or skip) and why."""
    return folder_setup.suggest(user["id"])


class FolderSetup(BaseModel):
    choices: dict[str, str] = Field(default_factory=dict)
    note: str = Field(default="", max_length=2000)


@app.post("/api/sync/folder-setup")
def folder_setup_post(req: FolderSetup, user: dict = Depends(reader_user)):
    if len(req.choices) > 500:
        raise HTTPException(status_code=400, detail="Too many folders.")
    return folder_setup.confirm(user["id"], req.choices, req.note)


class FolderMode(BaseModel):
    folder: str
    mode: str


@app.post("/api/sync/folders/mode")
def sync_folder_mode(req: FolderMode, user: dict = Depends(current_user)):
    try:
        return sync.set_folder_mode(user["id"], req.folder, req.mode)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from None


class FolderReread(BaseModel):
    folder: str
    since: str


@app.post("/api/sync/folders/reread")
def sync_folder_reread(req: FolderReread, user: dict = Depends(current_user)):
    if not re.fullmatch(r"20\d\d-\d\d-\d\d", req.since):
        raise HTTPException(status_code=400, detail="since must be YYYY-MM-DD")
    try:
        return sync.reread_folder(user["id"], req.folder, req.since)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from None


@app.get("/api/sync/state")
def sync_state(user: dict = Depends(reader_user)):
    # ai_left: the reader can't file anything once the day's AI allowance is used, so it doesn't start a run then.
    # outlook_only: every reader reads Outlook only (Slack and WhatsApp had too little news to be worth the windows).
    # start_from: an account's first sync goes back to the start of fall recruiting, not just to when it was set up.
    return {**sync.state(user["id"]), "ai_left": 0 if budget.filing_stuck(user["id"]) else 1,
            "outlook_only": True, "start_from": sync.first_start(user["id"]), "combine": True,
            "calendar_from": sync.calendar_from(user["id"]), "test_scan": bool(user.get("test_of")), "queue": True,
            "filing_busy": filing_queue.status(user["id"])["busy"],
            # before a first scan the student says which folders hold recruiting email (folder_setup)
            "folders_confirmed": folder_setup.confirmed(user["id"]), "folders_known": len([f for f in sync.folder_plan(user["id"]) if not f.get("mailbox")])}


@app.get("/api/reader/questions")
def reader_questions(user: dict = Depends(current_user)):
    """What the reader couldn't file without you (which bank a chat was with, say)."""
    return sync.questions(user["id"])


class QuestionAnswer(BaseModel):
    answer: str = Field(min_length=1, max_length=2000)


@app.post("/api/reader/questions/{qid}/answer")
async def reader_question_answer(qid: int, req: QuestionAnswer, user: dict = Depends(current_user)):
    """The student answers one of the reader's questions right on the home page: the assistant files it (as if they'd
    typed it in the update box) and the question is closed."""
    q = next((q for q in sync.questions(user["id"]) if q["id"] == qid), None)
    if q is None:
        raise HTTPException(status_code=404, detail="That question was already answered.")
    out = await assistant.run(user, ai_for(user), f'You asked me: "{q["question"]}" My answer: {req.answer.strip()} '
                                                   "File what this settles (update the entry or person it's about).", [])
    sync.question_done(user["id"], qid)
    return {"reply": out.get("reply", "")[:600], "run_id": out.get("run_id")}


@app.post("/api/reader/questions/{qid}/done")
def reader_question_done(qid: int, user: dict = Depends(current_user)):
    return sync.question_done(user["id"], qid)


@app.post("/api/sync/key")
def sync_key(user: dict = Depends(current_user)):
    """A sign-in key for the reader extension, shown once; making a new one turns the old one off."""
    return {"key": sync.new_key(user)}


@app.post("/api/sync/key/revoke")
def sync_key_revoke(user: dict = Depends(current_user)):
    sync.revoke(user["id"])
    return {"ok": True}


@app.post("/api/sync/config")
def sync_config(config: sync.ReaderConfig, user: dict = Depends(current_user)):
    """What the reader reads (Slack channels, WhatsApp groups), kept in the account rather than in the extension's code."""
    return sync.set_config(user["id"], config)


class ThankYouEmails(BaseModel):
    emails: list[thank_backfill.Email]


@app.post("/api/sync/thank-yous")
def sync_thank_yous(req: ThankYouEmails, user: dict = Depends(current_user)):
    """For the reader's one-time catch-up: thank-you emails the student already sent, each filed on its person (no AI)."""
    if len(req.emails) > 40 or sum(len(e.text) for e in req.emails) > 4_000_000:
        raise HTTPException(status_code=400, detail="Send at most 40 emails at a time.")
    return thank_backfill.save(user["id"], req.emails, user["name"])


def reader_ai(user: dict) -> llm.Chosen:
    """The model for a reader filing: the account's own, or for a test tracker its owner's. Filing has no daily allowance:
    a first scan uses what it takes."""
    budget.check_filing(user["id"])  # no daily allowance for filing, only the guard against a fault
    try:
        return llm.model_for(user["test_of"] if user.get("test_of") else user)
    except llm.NoModelError as err:
        raise HTTPException(status_code=428, detail=str(err)) from None


@app.post("/api/sync/ingest")
async def sync_ingest(batch: sync.Batch, user: dict = Depends(reader_user)):
    if batch.source not in ("outlook", "slack", "whatsapp") or len(batch.items) > 400:
        raise HTTPException(status_code=400, detail="Unknown source or too many messages at once.")
    return await sync.ingest(user, reader_ai(user), batch)


class Batches(BaseModel):
    batches: list[sync.Batch] = Field(max_length=60)


@app.post("/api/sync/ingest-many")
async def sync_ingest_many(req: Batches, user: dict = Depends(reader_user)):
    """Reader 1.19: several Outlook folders' new mail at once, filed together (fewer, fuller model runs)."""
    if any(b.source != "outlook" for b in req.batches) or sum(len(b.items) for b in req.batches) > 400:
        raise HTTPException(status_code=400, detail="Outlook folders only, and at most 400 emails at once.")
    return await sync.ingest_many(user, reader_ai(user), req.batches)


class QueueJob(BaseModel):
    refresh: str = Field(min_length=1, max_length=40)
    kind: str
    batches: list[sync.Batch] = Field(default_factory=list, max_length=60)
    batch: sync.Batch | None = None
    listed: list[str] = Field(default_factory=list)
    read: list[dict] = Field(default_factory=list)
    skipped: list[str] = Field(default_factory=list)
    first_scan: bool = False


@app.post("/api/sync/queue")
def sync_queue(req: QueueJob, user: dict = Depends(reader_user)):
    """Reader 1.21: hand over what was read, to be filed in the background (the reader's window can close at once)."""
    if req.kind == "mail" and (any(b.source != "outlook" for b in req.batches) or sum(len(b.items) for b in req.batches) > 400):
        raise HTTPException(status_code=400, detail="Outlook folders only, and at most 400 emails at once.")
    if req.kind == "calendar" and (req.batch is None or len(req.batch.items) > 400):
        raise HTTPException(status_code=400, detail="A calendar job needs its events (at most 400).")
    if req.kind in ("mail", "calendar"):
        reader_ai(user)  # no key, or the guard against a fault: say so now, while the reader is still open
    payload = {"mail": lambda: {"batches": [b.model_dump() for b in req.batches]},
               "calendar": lambda: {"batch": req.batch.model_dump()},
               "folders": lambda: {"listed": req.listed, "read": req.read, "skipped": req.skipped},
               "finish": lambda: {"first_scan": req.first_scan}}.get(req.kind)
    if payload is None:
        raise HTTPException(status_code=400, detail="Unknown kind.")
    return filing_queue.add(user, req.refresh, req.kind, payload())


@app.get("/api/sync/filing")
def sync_filing(user: dict = Depends(reader_user)):
    """How far the background filing of the latest refresh has got."""
    return filing_queue.status(user["id"])


@app.get("/api/reader/review")
def reader_review(user: dict = Depends(current_user)):
    """After your first scan: what it found, bank by bank, to look over once."""
    return scan_cleanup.review(user["id"])


@app.post("/api/reader/review/done")
def reader_review_done(user: dict = Depends(current_user)):
    return scan_cleanup.review_done(user["id"])


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
    """Keep a thank-you the student sent outside the app, so it shows on the contact."""
    return thank_you.record_sent(user["id"], req.interaction_id, req.person_id, req.body)


@app.post("/api/people/{person_id}/background")
async def look_up_background(person_id: int, user: dict = Depends(current_user)):
    """Start a web lookup; it takes a minute or more, so the page checks /background/status until it's done."""
    result = research.start(user["id"], ai_for(user), person_id)
    if result is None:
        raise HTTPException(status_code=404, detail="No such person in your tracker")
    return result


@app.get("/api/people/{person_id}/background/status")
def background_status(person_id: int, user: dict = Depends(current_user)):
    return research.status(user["id"], person_id)


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
    out = cover_letters.get(user["id"], bank)
    if out["exists"]:  # say when it can't be kept on one page
        out["warnings"] = out["warnings"] + cover_letters.page_warning(user["id"], bank)
    out["warnings"] = out["warnings"] + cover_letters.greeting_warning(out)
    return out


@app.post("/api/cover-letters/{bank}/write")
async def write_cover_letter(bank: str, user: dict = Depends(current_user)):
    return await cover_letters.write(user["id"], ai_for(user), bank)


class LetterEdits(BaseModel):
    paragraphs: list[str] | None = None
    details: dict = {}


@app.post("/api/cover-letters/{bank}")
async def edit_cover_letter(bank: str, req: LetterEdits, user: dict = Depends(current_user)):
    out = cover_letters.save_edits(user["id"], bank, req.paragraphs, req.details)
    if "recruiter_name" in req.details and out["needs_honorific"]:
        try:  # how the recruiter is addressed, looked up in the background (skipped without an AI key)
            honorific.schedule(honorific.fill_for_user(user["id"], ai_for(user), bank))
        except HTTPException:
            pass
    return out


class SubmittedRequest(BaseModel):
    submitted: bool


@app.post("/api/cover-letters/{bank}/submitted")
def cover_letter_submitted(bank: str, req: SubmittedRequest, user: dict = Depends(current_user)):
    """Mark a letter as sent, so drafts for the same group start from it."""
    return cover_letters.mark_submitted(user["id"], bank, req.submitted)


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
    """Download your whole tracker as JSON (a backup you keep). Written to a file first, then sent from it, so a big
    account doesn't run the server out of memory; the file is deleted once it's sent."""
    path = transfer.export_to_file(user["id"], include_shared=user["is_admin"])
    return FileResponse(path, media_type="application/json", filename=f"recruiting-hq-{date.today().isoformat()}.json",
                        background=BackgroundTask(os.unlink, path))


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


class TechSessionQuestion(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    answer: str = Field("", max_length=8000)
    level: int = Field(0, ge=0, le=4)
    topic: str = ""
    deck: str = ""


class TechSessionQuestions(BaseModel):
    questions: list[TechSessionQuestion] = Field(max_length=400)


@app.post("/api/admin/question-bank/tech-sessions")
def add_tech_session_questions(req: TechSessionQuestions, user: dict = Depends(admin_user)):
    """The Finance Club Technicals Session decks' practice questions, with the deck's answers and the club's ratings."""
    return importer.add_tech_sessions([q.model_dump() for q in req.questions])


@app.post("/api/admin/levels/rate")
async def rate_question_levels(user: dict = Depends(admin_user)):
    """Rate every unrated technical question against the club's rated ones (runs on its own; check /api/admin/levels)."""
    import asyncio

    task = asyncio.create_task(levels.rate_pending(ai_for(user), user["id"]))
    app.state.level_rating = task
    return {"started": True, **levels.status(user["id"])}


@app.get("/api/admin/levels")
def question_levels_status(user: dict = Depends(admin_user)):
    task = getattr(app.state, "level_rating", None)
    return {"running": bool(task and not task.done()), **levels.status(user["id"])}


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


# ---- The story bank: the student's six to eight stories, built in a conversation with the coach ----

class StoryChat(BaseModel):
    message: str = ""
    history: list[dict] = []


class StoryFields(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    situation: str = ""
    action: str = ""
    result: str = ""
    buckets: list[str] = []
    polarity: str = "went well"


@app.get("/api/stories")
def get_stories(user: dict = Depends(current_user)):
    """The stories, the eight buckets interviewers test, and which buckets the stories cover."""
    return stories.overview(user["id"])


@app.post("/api/stories/chat")
async def story_chat(req: StoryChat, user: dict = Depends(current_user)):
    """One turn of the conversation that builds the story bank (the coach saves stories as it goes)."""
    chosen = ai_for(user)
    return await stories.chat(user, chosen, req.message, req.history)


@app.post("/api/stories")
def add_story(req: StoryFields, user: dict = Depends(current_user)):
    out = stories.save(user["id"], req.title, req.situation, req.action, req.result, req.buckets, req.polarity)
    if not out["ok"]:
        raise HTTPException(status_code=400, detail=out["reason"])
    return stories.overview(user["id"])


@app.post("/api/stories/{story_id}")
def edit_story(story_id: int, req: StoryFields, user: dict = Depends(current_user)):
    out = stories.save(user["id"], req.title, req.situation, req.action, req.result, req.buckets, req.polarity, story_id)
    if not out["ok"]:
        raise HTTPException(status_code=404 if out["reason"].startswith("No story") else 400, detail=out["reason"])
    return stories.overview(user["id"])


@app.delete("/api/stories/{story_id}")
def delete_story(story_id: int, user: dict = Depends(current_user)):
    if not stories.remove(user["id"], story_id)["ok"]:
        raise HTTPException(status_code=404, detail="No such story.")
    return stories.overview(user["id"])


@app.get("/api/practice/library")
def answer_library_sources(user: dict = Depends(current_user)):
    return reference.library(user["id"])


@app.post("/api/library/guides")
async def upload_guide(file: UploadFile, name: str = Form(""), user: dict = Depends(current_user)):
    """Add a study guide the user owns (e.g. their Breaking Into Wall Street PDFs). Private to their account."""
    data = await file.read()
    if len(data) > 40_000_000:
        raise HTTPException(status_code=400, detail="That file is over 40 MB.")
    try:  # with the student's AI, each question is made to say what to answer (without it, they're kept as found)
        chosen = ai_for(user)
    except HTTPException:
        chosen = None
    out = await reference.add_guide(user["id"], file.filename or "My guide.pdf", data, name, chosen)
    if not out["ok"]:
        raise HTTPException(status_code=400, detail=out["reason"])
    if chosen is not None:  # the guide's technical questions get rated on the club's scale, on their own
        import asyncio

        app.state.guide_rating = asyncio.create_task(levels.rate_pending(chosen, None, [
            (f"gq:{q['id']}", q["question"]) for q in reference.guide_questions(user["id"])
            if q["category"] == "Technical" and f"gq:{q['id']}" not in levels.practice_levels()]))
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
            "groups": schools.options(), "domains": banks_info.DOMAINS}


@app.get("/api/admin/test-scan")
def test_scan_status(user: dict = Depends(admin_user)):
    """A test of a new student's first scan, run on your own Outlook into a test tracker."""
    return test_scan.status(user)


class TestScanAction(BaseModel):
    action: str  # start | stop | delete


@app.post("/api/admin/test-scan")
def test_scan_action(req: TestScanAction, user: dict = Depends(admin_user)):
    if req.action == "start":
        return test_scan.start(user)
    if req.action == "stop":
        return test_scan.stop(user)
    if req.action == "resume":
        return test_scan.resume(user)
    if req.action == "redo":  # file the test's failed batches again
        row = test_scan._row(user["id"])
        return filing_queue.redo_failed(row["sandbox_id"]) if row else {"ok": False}
    if req.action == "delete":
        return test_scan.delete(user)
    raise HTTPException(status_code=400, detail="action must be start, stop or delete")


@app.get("/api/admin/trim-check")
def trim_check(user: dict = Depends(admin_user)):
    """How much of your past filing runs' email the new trimming would have cut (counts only, nothing changed)."""
    from . import mail_trim

    with connect(read_only=True) as conn:
        rows = [r[0] for r in conn.execute("SELECT user_message FROM agent_runs WHERE user_id = ? AND user_message LIKE "
                                           "'New messages from my Outlook email, %' AND user_message NOT LIKE '%''Calendar''%' ORDER BY id",
                                           (user["id"],))]
    return mail_trim.check(rows)


@app.get("/api/admin/question-clean")
def question_clean_status(user: dict = Depends(admin_user)):
    """How much of the school bank has had typed-in answers split out of its questions."""
    return {"split": len(question_clean.splits()), "pending": len(question_clean.pending())}


@app.get("/api/admin/filing-messages")
def filing_messages(n: int = 3, user: dict = Depends(admin_user)):
    """What the reader's last few filing runs sent the model, for your own account (to trace a missed email)."""
    with connect(read_only=True) as conn:
        return [dict(r) for r in conn.execute(
            """SELECT started_at, outcome, SUBSTR(user_message, 1, 60000) AS message, SUBSTR(reply, 1, 2000) AS reply FROM agent_runs
               WHERE user_id = ? AND user_message LIKE 'New messages from %' ORDER BY id DESC LIMIT ?""", (user["id"], max(1, min(n, 10))))]


@app.get("/api/admin/test-scan/compare")
def test_scan_compare(user: dict = Depends(admin_user)):
    """What the test scan found against your own tracker: who and what it missed, and what it added."""
    return test_scan.compare(user)


class AdminRights(BaseModel):
    admin: bool


@app.post("/api/admin/users/{uid}/admin")
def set_admin(uid: int, req: AdminRights, user: dict = Depends(admin_user)):
    """Give another account admin rights, or take them back."""
    try:
        return accounts.set_admin(user["id"], uid, req.admin)
    except accounts.AccountError as err:
        raise HTTPException(status_code=400, detail=str(err)) from None


class BankDefaults(BaseModel):
    banks: dict[str, dict]


@app.post("/api/admin/bank-defaults")
async def push_bank_defaults(req: BankDefaults, user: dict = Depends(admin_user)):
    """Push recruiter names, titles, formal names and addresses to every account (students' own entries win)."""
    out = shared.push_bank_defaults(req.banks)
    try:  # Mr./Ms. for any pushed recruiter saved without it, looked up in the background
        honorific.schedule(honorific.fill_defaults(user["id"], ai_for(user)))
    except HTTPException:
        pass
    return out


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


class SiteFiles(StaticFiles):
    """The built website. Its code files have the build's fingerprint in their names, so browsers may keep them;
    the page itself is checked on every visit, so after a deploy no browser runs a page whose code is gone (blank)."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        long_lived = path.replace("\\", "/").startswith("assets/") and response.status_code in (200, 304)  # Windows paths too; 304: "not modified"
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable" if long_lived else "no-cache"
        return response


# The built website, served by this same server on the hosted site. Mounted last so /api routes win.
if config.FRONTEND_DIST.is_dir():
    app.mount("/", SiteFiles(directory=config.FRONTEND_DIST, html=True), name="site")
