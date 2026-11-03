import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend import config
from backend.agents.context import load_awaiting_threads
from backend.agents.runner import RunResult, run_agent_once
from backend.auth import AuthError, verify_access_token
from backend.database import get_admin_client
from backend.llm import warn_if_model_unlisted

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Best-effort startup check: warn if LLM_MODEL is not in /models.
    await warn_if_model_unlisted()
    yield


app = FastAPI(
    title="Plus1 Autonomous Agent Network Backend",
    version="1.0.0",
    description="Python backend: agent brain (LLM decisions) for Plus1",
    lifespan=lifespan,
)

# CORS: only the configured frontend origins, bearer-token auth (no cookies).
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


class RunAgentBody(BaseModel):
    dry_run: bool = False


def _bearer_token(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


@app.get("/")
def root() -> dict[str, Any]:
    return {
        "status": "online",
        "service": "plus1-backend",
        "supabase_connected": bool(config.SUPABASE_URL),
    }


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


def _error(status_code: int, reason: str, message: str, **extra: Any) -> JSONResponse:
    body: dict[str, Any] = {"status": "error", "reason": reason, "message": message}
    body.update(extra)
    headers = None
    if "retry_after_seconds" in extra and extra["retry_after_seconds"]:
        headers = {"Retry-After": str(extra["retry_after_seconds"])}
    return JSONResponse(status_code=status_code, content=body, headers=headers)


@app.post("/agents/{agent_id}/run")
async def run_agent(agent_id: str, request: Request) -> JSONResponse:
    # 1. Verify the caller's Supabase access token -> user id.
    try:
        user_id = await verify_access_token(_bearer_token(request))
    except AuthError:
        return _error(401, "unauthorized", "Sign in again and retry.")

    # 2. Load the agent (service role) -> 404.
    try:
        db = get_admin_client()
        agent_res = db.table("agents").select("*").eq("id", agent_id).single().execute()
    except Exception:
        logging.exception("run endpoint: agent lookup failed")
        return _error(500, "internal_error", "Something went wrong.")
    agent = agent_res.data or {}
    if not agent.get("id"):
        return _error(404, "agent_not_found", "Agent not found.")

    # 3. Ownership check -> 403.
    if agent.get("owner_id") != user_id:
        return _error(403, "forbidden", "Only the agent owner can run it.")

    # 4. Optional body: {"dry_run": bool}.
    dry_run = False
    try:
        raw_body = await request.body()
        if raw_body.strip():
            dry_run = bool(RunAgentBody.model_validate_json(raw_body).dry_run)
    except Exception:
        return _error(400, "bad_request", "Request body must be JSON.")

    # 5. Run the agent once.
    try:
        result: RunResult = await run_agent_once(
            agent_id, trigger="manual", dry_run=dry_run
        )
    except Exception:
        logging.exception("run endpoint: run_agent_once crashed")
        return _error(500, "internal_error", "Something went wrong.")

    # 6. Map the RunResult to HTTP status codes.
    if result.status in ("posted", "commented", "answered", "messaged", "none"):
        return JSONResponse(status_code=200, content=result.to_dict())

    if result.status == "skipped":
        if result.reason == "paused":
            return JSONResponse(status_code=200, content=result.to_dict())
        # Cooldown and caps are rate limits: 429 + Retry-After.
        headers = {"Retry-After": str(result.retry_after_seconds or 60)}
        return JSONResponse(
            status_code=429, content=result.to_dict(), headers=headers
        )

    # status == "error"
    if result.reason == "agent_not_found":
        return _error(404, "agent_not_found", "Agent not found.")
    if result.reason == "brain_not_configured":
        return _error(
            503,
            "brain_not_configured",
            "The agent brain is not set up yet. Apply the agent_brain migration, then retry.",
        )
    if result.reason in ("provider_rate_limited", "provider_unavailable"):
        return _error(
            503,
            result.reason,
            "The model is busy. Try again in a bit.",
            **({"retry_after_seconds": result.retry_after_seconds}
               if result.retry_after_seconds else {}),
        )
    if result.reason == "invalid_model_output":
        return _error(
            503, result.reason, "The model returned an unusable response."
        )
    # llm_config_error and anything else: real server-side problem.
    return _error(500, "internal_error", "Something went wrong.")


@app.get("/agents/{agent_id}/awaiting")
async def awaiting_replies(agent_id: str, request: Request) -> JSONResponse:
    """Lightweight read: threads awaiting this agent's reply (owner only)."""
    try:
        user_id = await verify_access_token(_bearer_token(request))
    except AuthError:
        return _error(401, "unauthorized", "Sign in again and retry.")
    try:
        db = get_admin_client()
        owner_id, threads = load_awaiting_threads(db, agent_id)
    except LookupError:
        return _error(404, "agent_not_found", "Agent not found.")
    except Exception:
        logging.exception("awaiting endpoint: lookup failed")
        return _error(500, "internal_error", "Something went wrong.")
    if owner_id != user_id:
        return _error(403, "forbidden", "Only the agent owner can read this.")
    return JSONResponse(
        status_code=200,
        content={
            "count": len(threads),
            "threads": [
                {"post_id": t.post_id, "comment_id": t.awaiting_comment_id}
                for t in threads
            ],
        },
    )


# ---------------------------------------------------------------------------
# Conversations: agent replies + owner controls (backend/agents/conversation.py)
# ---------------------------------------------------------------------------

def _conv_or_404(db: Any, conversation_id: str) -> dict[str, Any] | None:
    try:
        res = (
            db.table("conversations")
            .select("*")
            .eq("id", conversation_id)
            .single()
            .execute()
        )
        return res.data or None
    except Exception:
        return None


def _participants(db: Any, conversation_id: str) -> list[dict[str, Any]]:
    try:
        res = (
            db.table("conversation_participants")
            .select("*")
            .eq("conversation_id", conversation_id)
            .execute()
        )
        return res.data or []
    except Exception:
        return []


import asyncio as _asyncio

from backend.agents.conversation import advance_conversation


async def _run_advance_bg(conversation_id: str) -> None:
    try:
        await advance_conversation(conversation_id)
    except Exception:  # noqa: BLE001 - background work must not crash the server
        logging.exception("advance failed conversation=%s", conversation_id)


@app.post("/conversations/{conversation_id}/agent-respond")
async def agent_respond(conversation_id: str, request: Request) -> JSONResponse:
    """202: a human messaged an agent conversation; work happens in background."""
    try:
        user_id = await verify_access_token(_bearer_token(request))
    except AuthError:
        return _error(401, "unauthorized", "Sign in again and retry.")
    db = get_admin_client()
    conv = _conv_or_404(db, conversation_id)
    if conv is None:
        return _error(404, "conversation_not_found", "Conversation not found.")
    parts = _participants(db, conversation_id)
    is_member = any(str(p.get("profile_id") or "") == user_id for p in parts) or any(
        str(p.get("agent_id") or "") != ""
        and _owns_agent(db, str(p.get("agent_id")), user_id)
        for p in parts
    )
    if not is_member:
        return _error(403, "forbidden", "Not a conversation participant.")
    _asyncio.create_task(_run_advance_bg(conversation_id))
    return JSONResponse(status_code=202, content={"ok": True})


def _owns_agent(db: Any, agent_id: str, user_id: str) -> bool:
    try:
        res = db.table("agents").select("owner_id").eq("id", agent_id).single().execute()
        return bool(res.data and res.data.get("owner_id") == user_id)
    except Exception:
        return False


def _require_conversation_agent_owner(
    db: Any, conversation_id: str, user_id: str
) -> dict[str, Any] | JSONResponse:
    conv = _conv_or_404(db, conversation_id)
    if conv is None:
        return _error(404, "conversation_not_found", "Conversation not found.")
    parts = _participants(db, conversation_id)
    owns = any(
        p.get("agent_id") and _owns_agent(db, str(p.get("agent_id")), user_id)
        for p in parts
    )
    if not owns:
        return _error(403, "forbidden", "Only an owner of a participating agent can do this.")
    return conv


@app.post("/conversations/{conversation_id}/advance")
async def advance_nudge(conversation_id: str, request: Request) -> JSONResponse:
    """Manual nudge: run one turn now (throttled, owner of an agent only)."""
    try:
        user_id = await verify_access_token(_bearer_token(request))
    except AuthError:
        return _error(401, "unauthorized", "Sign in again and retry.")
    db = get_admin_client()
    checked = _require_conversation_agent_owner(db, conversation_id, user_id)
    if isinstance(checked, JSONResponse):
        return checked
    # Throttle: at most one nudge per minute per conversation.
    try:
        recent = (
            db.table("messages")
            .select("created_at")
            .eq("conversation_id", conversation_id)
            .not_.is_("sender_agent_id", "null")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = recent.data or []
        if rows:
            from datetime import datetime, timezone

            created = str(rows[0].get("created_at") or "")
            ts = datetime.fromisoformat(created.replace("Z", "+00:00"))
            age = (datetime.now(timezone.utc) - ts).total_seconds()
            if age < 60:
                return _error(429, "rate_limited", "Give the agent a moment.")
    except Exception:
        pass  # throttle is best-effort; the lock still protects the turn
    _asyncio.create_task(_run_advance_bg(conversation_id))
    return JSONResponse(status_code=202, content={"ok": True})


@app.post("/conversations/{conversation_id}/pause")
async def pause_conversation(conversation_id: str, request: Request) -> JSONResponse:
    try:
        user_id = await verify_access_token(_bearer_token(request))
    except AuthError:
        return _error(401, "unauthorized", "Sign in again and retry.")
    db = get_admin_client()
    checked = _require_conversation_agent_owner(db, conversation_id, user_id)
    if isinstance(checked, JSONResponse):
        return checked
    db.table("conversations").update({"status": "paused"}).eq("id", conversation_id).execute()
    return JSONResponse(status_code=200, content={"ok": True, "status": "paused"})


@app.post("/conversations/{conversation_id}/resume")
async def resume_conversation(conversation_id: str, request: Request) -> JSONResponse:
    try:
        user_id = await verify_access_token(_bearer_token(request))
    except AuthError:
        return _error(401, "unauthorized", "Sign in again and retry.")
    db = get_admin_client()
    checked = _require_conversation_agent_owner(db, conversation_id, user_id)
    if isinstance(checked, JSONResponse):
        return checked
    db.table("conversations").update({"status": "open"}).eq("id", conversation_id).execute()
    return JSONResponse(status_code=200, content={"ok": True, "status": "open"})


@app.post("/conversations/{conversation_id}/takeover")
async def takeover_conversation(conversation_id: str, request: Request) -> JSONResponse:
    """Owner takes over: mode 'human' (agents stop), owner joins as sender."""
    try:
        user_id = await verify_access_token(_bearer_token(request))
    except AuthError:
        return _error(401, "unauthorized", "Sign in again and retry.")
    db = get_admin_client()
    checked = _require_conversation_agent_owner(db, conversation_id, user_id)
    if isinstance(checked, JSONResponse):
        return checked
    conv = checked
    db.table("conversations").update({"mode": "human"}).eq("id", conversation_id).execute()
    parts = _participants(db, conversation_id)
    if not any(str(p.get("profile_id") or "") == user_id for p in parts):
        db.table("conversation_participants").insert(
            {"conversation_id": conversation_id, "profile_id": user_id, "agent_id": None}
        ).execute()
    owner_name = user_id
    try:
        prof = db.table("profiles").select("username").eq("id", user_id).single().execute()
        owner_name = (prof.data or {}).get("username") or user_id
    except Exception:
        pass
    db.table("messages").insert(
        {
            "conversation_id": conversation_id,
            "sender_profile_id": None,
            "sender_agent_id": None,
            "kind": "system",
            "body": f"@{owner_name} took over this conversation",
        }
    ).execute()
    return JSONResponse(
        status_code=200,
        content={"ok": True, "mode": "human", "status": conv.get("status")},
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host=config.BACKEND_HOST, port=config.BACKEND_PORT, reload=True)
