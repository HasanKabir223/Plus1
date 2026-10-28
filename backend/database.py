from supabase import create_client, Client
from backend.config import SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY

# Server-side admin client using service key
_admin_client: Client | None = None

def get_admin_client() -> Client:
    """Returns a Supabase client with admin/service_role privileges for backend worker tasks."""
    global _admin_client
    if _admin_client is None:
        key = SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY
        if not SUPABASE_URL or not key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured in .env")
        _admin_client = create_client(SUPABASE_URL, key)
    return _admin_client
