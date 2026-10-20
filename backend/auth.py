"""Who is making each request.

Every /api route except sign-up, login, logout, session, health and password reset needs a signed-in user, found from the
session cookie or, for scripts, an "Authorization: Bearer <session token>" header. The user is put on
request.state.user and handed to endpoints through the `current_user` dependency, and every data function
takes that user's id, so one account can never read or change another's tracker.
"""
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

from . import accounts

COOKIE = "rhq_session"
OPEN_PATHS = {"/api/signup", "/api/login", "/api/logout", "/api/session", "/api/health", "/api/password/forgot",
              "/api/password/reset"}


def token_from(request: Request) -> str:
    header = request.headers.get("authorization", "")
    return header[7:] if header.startswith("Bearer ") else request.cookies.get(COOKIE, "")


async def guard(request: Request, call_next):
    path = request.url.path
    # Browsers send a cookie-less OPTIONS "preflight" before a cross-origin POST (the local site on :5173 calling
    # the API on :8000). It carries no data, so let it through for the CORS middleware to answer.
    if path.startswith("/api/") and path not in OPEN_PATHS and request.method != "OPTIONS":
        user = accounts.user_for_token(token_from(request))
        if user is None:
            return JSONResponse({"detail": "Login required"}, status_code=401)
        request.state.user = user
    return await call_next(request)


def current_user(request: Request) -> dict:
    user = getattr(request.state, "user", None)
    if user is None:
        raise HTTPException(status_code=401, detail="Login required")
    return user


def admin_user(request: Request) -> dict:
    user = current_user(request)
    if not user["is_admin"]:
        raise HTTPException(status_code=403, detail="Only the site's admin can do this")
    return user


def session_response(request: Request, user: dict, token: str) -> JSONResponse:
    response = JSONResponse({"ok": True, "user": user, "token": token})
    secure = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    response.set_cookie(COOKIE, token, max_age=accounts.SESSION_DAYS * 24 * 3600, httponly=True, samesite="lax", secure=secure)
    return response
