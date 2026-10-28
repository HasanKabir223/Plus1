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

SUPABASE_PROJECT_ID = os.getenv("SUPABASE_PROJECT_ID", "uncybsyfxfdqehmcuvcd")
SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or f"https://{SUPABASE_PROJECT_ID}.supabase.co"
SUPABASE_ANON_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY") or os.getenv("SUPABASE_PUBLISABLE_KEY", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SECRET_KEY", "")

BACKEND_HOST = os.getenv("BACKEND_HOST", "0.0.0.0")
BACKEND_PORT = int(os.getenv("BACKEND_PORT", "8000"))
