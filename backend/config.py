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

# --- LLM provider (swappable by env only; OpenAI-compatible API) ---
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.groq.com/openai/v1").rstrip("/")
# CHAT_GROQ and GOOGLE_GEMINI_KEY are accepted as fallbacks so an existing
# repo .env keeps working without renaming its provider key.
LLM_API_KEY = (
    os.getenv("LLM_API_KEY") or os.getenv("GOOGLE_GEMINI_KEY") or os.getenv("CHAT_GROQ", "")
)
LLM_MODEL = os.getenv("LLM_MODEL", "openai/gpt-oss-20b")
LLM_REASONING_EFFORT = os.getenv("LLM_REASONING_EFFORT", "").strip()
LLM_TIMEOUT_SECONDS = _get_int("LLM_TIMEOUT_SECONDS", 30)

# --- Fallback provider (same request retried here when the primary is
# rate-limited, unreachable, or rejects its own output) ---
LLM_FALLBACK_BASE_URL = os.getenv("LLM_FALLBACK_BASE_URL", "").rstrip("/")
LLM_FALLBACK_API_KEY = os.getenv("LLM_FALLBACK_API_KEY") or os.getenv("CHAT_GROQ", "")
LLM_FALLBACK_MODEL = os.getenv("LLM_FALLBACK_MODEL", "")
LLM_FALLBACK_REASONING_EFFORT = os.getenv("LLM_FALLBACK_REASONING_EFFORT", "").strip()


def llm_fallback_configured() -> bool:
    """True when a complete fallback provider triple is configured."""
    return bool(LLM_FALLBACK_BASE_URL and LLM_FALLBACK_API_KEY and LLM_FALLBACK_MODEL)

# --- Agent brain limits (read once here, never hard-coded in logic) ---
# Conversations (agent outreach + turn engine; see backend/agents/conversation.py)
CONVERSATION_MAX_MESSAGES = _get_int("CONVERSATION_MAX_MESSAGES", 6)
OUTREACH_PER_RUN = _get_int("OUTREACH_PER_RUN", 1)
AGENT_OUTREACH_DAILY_CAP = _get_int("AGENT_OUTREACH_DAILY_CAP", 3)
OUTREACH_TARGET_COOLDOWN_HOURS = _get_int("OUTREACH_TARGET_COOLDOWN_HOURS", 24)
HUMAN_AGENT_REPLY_DAILY_CAP = _get_int("HUMAN_AGENT_REPLY_DAILY_CAP", 20)
TURN_DELAY_SECONDS = _get_int("TURN_DELAY_SECONDS", 8)
MESSAGE_MAX_CHARS = _get_int("MESSAGE_MAX_CHARS", 500)
CONVERSATION_LOCK_SECONDS = _get_int("CONVERSATION_LOCK_SECONDS", 90)
OUTREACH_TARGET_MAX_AGE_DAYS = _get_int("OUTREACH_TARGET_MAX_AGE_DAYS", 7)
MESSAGE_MODEL_MAX_CHARS = _get_int("MESSAGE_MODEL_MAX_CHARS", 320)

AGENT_COOLDOWN_SECONDS = _get_int("AGENT_COOLDOWN_SECONDS", 300)
AGENT_DAILY_CAP = _get_int("AGENT_DAILY_CAP", 12)
# DEMO ONLY: when true, the atomic budget gate (cooldown + agent/global
# daily caps) is skipped so runs can be tested back-to-back. Per-action
# caps (likes/comments/outreach) still apply. Never enable in production.
DEMO_NO_DAILY_CAPS = os.getenv("DEMO_NO_DAILY_CAPS", "").strip().lower() in (
    "1", "true", "yes",
)
GLOBAL_DAILY_CALL_CAP = _get_int("GLOBAL_DAILY_CALL_CAP", 700)
GLOBAL_DAILY_TOKEN_CAP = _get_int("GLOBAL_DAILY_TOKEN_CAP", 150000)
AGENT_SKILL_MAX_CHARS = _get_int("AGENT_SKILL_MAX_CHARS", 2000)
AGENT_POST_MAX_CHARS = _get_int("AGENT_POST_MAX_CHARS", 280)
REPLY_MAX_DEPTH = _get_int("REPLY_MAX_DEPTH", 1)
AGENT_REPLIES_ENABLED = _get_bool("AGENT_REPLIES_ENABLED", True)
AGENT_LIKES_PER_RUN = _get_int("AGENT_LIKES_PER_RUN", 2)
AGENT_LIKE_DAILY_CAP = _get_int("AGENT_LIKE_DAILY_CAP", 10)
AGENT_COMMENT_MAX_CHARS = _get_int("AGENT_COMMENT_MAX_CHARS", 240)
COMMENT_TARGET_MAX_AGE_DAYS = _get_int("COMMENT_TARGET_MAX_AGE_DAYS", 7)

# --- Selective engagement (awaiting replies + interest shortlist + score gates)
AGENT_ENGAGE_OWNER_POSTS = _get_bool("AGENT_ENGAGE_OWNER_POSTS", True)
AGENT_MAX_COMMENTS_PER_POST = _get_int("AGENT_MAX_COMMENTS_PER_POST", 4)
AWAITING_REPLIES_SHOWN = _get_int("AWAITING_REPLIES_SHOWN", 2)
THREAD_CONTEXT_COMMENTS = _get_int("THREAD_CONTEXT_COMMENTS", 3)
PRE_FILTER_TOP_K = _get_int("PRE_FILTER_TOP_K", 5)
PRE_FILTER_MIN_OVERLAP = _get_int("PRE_FILTER_MIN_OVERLAP", 1)
POST_SNIPPET_CHARS = _get_int("POST_SNIPPET_CHARS", 240)
THREAD_SNIPPET_CHARS = _get_int("THREAD_SNIPPET_CHARS", 200)
LIKE_MIN_SCORE = _get_int("LIKE_MIN_SCORE", 6)
COMMENT_MIN_SCORE = _get_int("COMMENT_MIN_SCORE", 8)
AGENT_COMMENTS_PER_RUN = _get_int("AGENT_COMMENTS_PER_RUN", 1)
AGENT_COMMENT_DAILY_CAP = _get_int("AGENT_COMMENT_DAILY_CAP", 5)
RUN_PROMPT_TOKEN_BUDGET = _get_int("RUN_PROMPT_TOKEN_BUDGET", 1500)
