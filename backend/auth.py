"""Verifies Supabase access tokens for the Python backend.

The browser sends `Authorization: Bearer <access_token>` (fresh from
supabase.auth.getSession() on each click). We verify by asking Supabase Auth
itself: GET {SUPABASE_URL}/auth/v1/user with the token and the anon key.
This works regardless of how the project signs JWTs. Nothing is cached.
"""

import httpx

from backend import config


class AuthError(Exception):
    """Raised when the caller's token is missing, invalid, or expired."""


async def verify_access_token(token: str | None) -> str:
    """Return the authenticated user's id, or raise AuthError (caller gets 401)."""
    if not token:
        raise AuthError("missing access token")
    if not config.SUPABASE_URL or not config.SUPABASE_ANON_KEY:
        raise AuthError("auth not configured")

    url = f"{config.SUPABASE_URL.rstrip('/')}/auth/v1/user"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "apikey": config.SUPABASE_ANON_KEY,
                },
            )
    except httpx.HTTPError as exc:
        raise AuthError(f"auth service unreachable: {type(exc).__name__}") from exc

    if resp.status_code != 200:
        raise AuthError("invalid or expired access token")

    try:
        user_id = resp.json().get("id")
    except ValueError as exc:
        raise AuthError("invalid auth response") from exc
    if not user_id:
        raise AuthError("invalid auth response")
    return str(user_id)
