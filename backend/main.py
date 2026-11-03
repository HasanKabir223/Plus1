import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend import config
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
    if result.status in ("posted", "replied", "none"):
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host=config.BACKEND_HOST, port=config.BACKEND_PORT, reload=True)
