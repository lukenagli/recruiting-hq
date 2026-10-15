"""Single source of truth for settings. The model name lives here and nowhere else."""
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent

# Repo folder first, then the folder above it (where the graders' .env sits).
load_dotenv(ROOT / ".env")
load_dotenv(ROOT.parent / ".env")

os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")

MODEL_NAME = "gpt-6-luna"
PORTKEY_BASE_URL = os.getenv("PORTKEY_BASE_URL", "https://api.portkey.ai/v1")
# On the hosted site the database sits on the server's data disk (APP_DB_PATH); locally it is data/app.db.
DB_PATH = Path(os.getenv("APP_DB_PATH") or ROOT / "data" / "app.db")
FRONTEND_DIST = ROOT / "frontend" / "dist"
# Models for people who bring their own key. The course key (Portkey) only ever runs MODEL_NAME above and
# is used only by the site's admin account; everyone else pays for their own usage with their own key.
CLAUDE_MODEL = "claude-opus-5-5"
USER_OPENAI_MODEL = os.getenv("USER_OPENAI_MODEL", MODEL_NAME)
# Encrypts the API keys people save. Set APP_SECRET on the hosted site; locally a random one is kept in data/.
APP_SECRET = os.getenv("APP_SECRET", "").strip()
APP_SECRET_FILE = ROOT / "data" / ".app_secret"
PORTKEY_API_KEY_SET = bool(os.getenv("PORTKEY_API_KEY", "").strip())
# Most tokens (input + output) one account may use per day across all AI features.
DAILY_TOKEN_BUDGET = int(os.getenv("DAILY_TOKEN_BUDGET", "400000"))
# Real recruiting files stay on the owner's machine; the repo ships a made-up sample set.
PRIVATE_BANKS_DIR = ROOT / "Recruiting Files" / "Interview Question Banks"
SAMPLE_BANKS_DIR = ROOT / "data" / "sample" / "Interview Question Banks"
NETWORKING_SHEET = ROOT / "Recruiting Files" / "IB Networking Sheet Yale.xlsx"
NETWORK_EXTRAS = ROOT / "data" / "private" / "network_extras.json"
RECRUITING_CALENDAR = ROOT / "data" / "private" / "recruiting_calendar.json"
FRONTEND_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]


def banks_dir() -> Path:
    """Private files when present, sample data otherwise. USE_SAMPLE_DATA=1 forces the sample set."""
    if os.getenv("USE_SAMPLE_DATA", "").strip() == "1" or not PRIVATE_BANKS_DIR.is_dir():
        return SAMPLE_BANKS_DIR
    return PRIVATE_BANKS_DIR


def portkey_api_key() -> str:
    key = os.getenv("PORTKEY_API_KEY", "").strip()
    if not key:
        raise RuntimeError(
            "PORTKEY_API_KEY is not set. Put it in a .env file in the repo folder "
            "or the folder above it (see .env.example)."
        )
    return key
