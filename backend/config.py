import os
from pathlib import Path
from dotenv import load_dotenv

# Locate .env in repo root or current directory
root_dir = Path(__file__).resolve().parent.parent
env_file = root_dir / ".env"
if env_file.exists():
    load_dotenv(env_file)
else:
    load_dotenv()


def _get_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)).strip())
    except (ValueError, AttributeError):
        return default


def _get_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


SUPABASE_PROJECT_ID = os.getenv("SUPABASE_PROJECT_ID", "uncybsyfxfdqehmcuvcd")
SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or f"https://{SUPABASE_PROJECT_ID}.supabase.co"
SUPABASE_ANON_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY") or os.getenv("SUPABASE_PUBLISABLE_KEY", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SECRET_KEY", "")

BACKEND_HOST = os.getenv("BACKEND_HOST", "0.0.0.0")
BACKEND_PORT = int(os.getenv("BACKEND_PORT", "8000"))

# CORS: comma-separated list, no wildcards.
ALLOWED_ORIGINS = [
    o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",") if o.strip()
]

# --- LLM provider (swappable by env only; Groq via OpenAI-compatible API) ---
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.groq.com/openai/v1").rstrip("/")
# CHAT_GROQ is accepted as a fallback so the existing repo .env keeps working.
LLM_API_KEY = os.getenv("LLM_API_KEY") or os.getenv("CHAT_GROQ", "")
LLM_MODEL = os.getenv("LLM_MODEL", "openai/gpt-oss-20b")
LLM_REASONING_EFFORT = os.getenv("LLM_REASONING_EFFORT", "").strip()
LLM_TIMEOUT_SECONDS = _get_int("LLM_TIMEOUT_SECONDS", 30)

# --- Agent brain limits (read once here, never hard-coded in logic) ---
AGENT_COOLDOWN_SECONDS = _get_int("AGENT_COOLDOWN_SECONDS", 300)
AGENT_DAILY_CAP = _get_int("AGENT_DAILY_CAP", 12)
GLOBAL_DAILY_CALL_CAP = _get_int("GLOBAL_DAILY_CALL_CAP", 700)
GLOBAL_DAILY_TOKEN_CAP = _get_int("GLOBAL_DAILY_TOKEN_CAP", 150000)
AGENT_SKILL_MAX_CHARS = _get_int("AGENT_SKILL_MAX_CHARS", 2000)
AGENT_POST_MAX_CHARS = _get_int("AGENT_POST_MAX_CHARS", 280)
REPLY_MAX_DEPTH = _get_int("REPLY_MAX_DEPTH", 1)
AGENT_REPLIES_ENABLED = _get_bool("AGENT_REPLIES_ENABLED", True)
AGENT_LIKES_PER_RUN = _get_int("AGENT_LIKES_PER_RUN", 3)
AGENT_LIKE_DAILY_CAP = _get_int("AGENT_LIKE_DAILY_CAP", 30)
AGENT_COMMENT_MAX_CHARS = _get_int("AGENT_COMMENT_MAX_CHARS", 280)
COMMENT_TARGET_MAX_AGE_DAYS = _get_int("COMMENT_TARGET_MAX_AGE_DAYS", 7)
