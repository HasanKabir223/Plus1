"""One-shot agent runner: wake an agent up once, decide, maybe post.

`run_agent_once(agent_id, trigger)` is the reusable core: the manual HTTP
endpoint calls it now, and the future scheduled job will call it later with
trigger="scheduled". No scheduler lives here.

Flow: load context -> atomic claim (budget gate) -> LLM decision ->
validate -> write post (unless dry_run) -> log everything to action_log.
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Coroutine

from backend import config
from backend.agents.context import AgentContext, load_context
from backend.agents.decision import (
    DecisionRejected,
    InvalidModelOutput,
    ValidatedDecision,
    parse_decision,
    validate_decision,
)
from backend.agents.prompt import build_messages
from backend.database import get_admin_client
from backend.llm import (
    LLMConfigError,
    LLMRateLimited,
    LLMResult,
    LLMUnavailable,
    llm_complete,
)

logger = logging.getLogger(__name__)

LLM_MAX_TOKENS = 400
LLM_TEMPERATURE = 0.8
CORRECTION_PROMPT = (
    "Your last reply was not a valid JSON decision object. "
    "Reply with ONLY the JSON decision object, nothing else."
)


@dataclass
class RunResult:
    status: str  # posted | replied | none | skipped | error
    reason: str
    post_id: str | None = None
    text: str | None = None
    retry_after_seconds: int | None = None

    def to_dict(self) -> dict[str, Any]:
        body: dict[str, Any] = {"status": self.status, "reason": self.reason}
        if self.post_id is not None:
            body["post_id"] = self.post_id
        if self.text is not None:
            body["text"] = self.text
        if self.retry_after_seconds is not None:
            body["retry_after_seconds"] = self.retry_after_seconds
        return body


LlmCaller = Callable[..., Coroutine[Any, Any, LLMResult]]


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _write_log(
    db: Any,
    *,
    agent_id: str,
    trigger: str,
    action: str,
    status: str,
    reason: str,
    input_summary: dict[str, Any] | None = None,
    post_id: str | None = None,
    text: str | None = None,
    error: str | None = None,
    model: str | None = None,
    tokens_in: int = 0,
    tokens_out: int = 0,
    latency_ms: int = 0,
) -> None:
    """Best-effort action_log insert. Logging must never break a run."""
    try:
        db.table("action_log").insert(
            {
                "agent_id": agent_id,
                "trigger": trigger,
                "action": action,
                "input_summary": input_summary or {},
                "output": {
                    "reason": reason,
                    "post_id": post_id,
                    "text": text,
                },
                "status": status,
                "error": (error[:500] if error else None),
                "model": model,
                "tokens_in": tokens_in,
                "tokens_out": tokens_out,
                "latency_ms": latency_ms,
            }
        ).execute()
    except Exception as exc:  # noqa: BLE001 - logging is best-effort
        logger.warning("action_log insert failed for agent %s: %r", agent_id, exc)


def _looks_unconfigured(exc: Exception) -> bool:
    """True when the DB is missing the agent-brain migration (tables/functions)."""
    msg = str(exc).lower()
    return any(
        s in msg
        for s in (
            "pgrst202",
            "pgrst205",
            "does not exist",
            "could not find the function",
        )
    )


def _add_tokens(db: Any, tokens: int) -> None:
    if tokens <= 0:
        return
    try:
        db.rpc("add_llm_tokens", {"p_tokens": tokens}).execute()
    except Exception as exc:  # noqa: BLE001 - accounting is best-effort
        logger.warning("add_llm_tokens failed: %r", exc)


async def run_agent_once(
    agent_id: str,
    trigger: str = "manual",
    dry_run: bool = False,
    *,
    client: Any | None = None,
    llm_caller: LlmCaller | None = None,
) -> RunResult:
    """Wake one agent up once and let it decide to post, reply, or do nothing.

    `client` and `llm_caller` exist for tests; production uses the admin
    Supabase client and the real LLM wrapper.
    """
    db = client if client is not None else get_admin_client()
    call_llm = llm_caller if llm_caller is not None else llm_complete

    # 1. Load agent + owner + feed snapshot.
    try:
        ctx: AgentContext = load_context(db, agent_id)
    except LookupError:
        return RunResult(status="error", reason="agent_not_found")
    summary = ctx.input_summary()

    try:
        # 2. Atomic budget gate. A failed claim costs no LLM call.
        try:
            claim_res = db.rpc(
                "claim_agent_call",
                {
                    "p_agent_id": agent_id,
                    "p_cooldown_seconds": config.AGENT_COOLDOWN_SECONDS,
                    "p_agent_daily_cap": config.AGENT_DAILY_CAP,
                    "p_global_daily_cap": config.GLOBAL_DAILY_CALL_CAP,
                },
            ).execute()
        except Exception as exc:
            # Migration not applied yet: say so plainly instead of a 500.
            if _looks_unconfigured(exc):
                _write_log(
                    db, agent_id=agent_id, trigger=trigger, action="error",
                    status="error", reason="brain_not_configured",
                    input_summary=summary, error=str(exc),
                )
                return RunResult(status="error", reason="brain_not_configured")
            raise
        claim = claim_res.data or {}
        if not claim.get("ok"):
            reason = str(claim.get("reason") or "cooldown")
            retry_after = int(claim.get("retry_after_seconds") or 0)
            _write_log(
                db, agent_id=agent_id, trigger=trigger, action="skip",
                status="skipped", reason=reason, input_summary=summary,
            )
            logger.info("run skipped agent=%s reason=%s", agent_id, reason)
            return RunResult(
                status="skipped", reason=reason,
                retry_after_seconds=retry_after,
            )

        # 3. Ask the model. (dry_run still calls it: it costs the same.)
        messages = build_messages(ctx)
        try:
            llm_result = await call_llm(
                messages, model_tier="fast", max_tokens=LLM_MAX_TOKENS,
                temperature=LLM_TEMPERATURE, json_mode=True,
            )
        except LLMRateLimited as exc:
            _write_log(
                db, agent_id=agent_id, trigger=trigger, action="error",
                status="error", reason="provider_rate_limited",
                input_summary=summary, error="provider 429",
            )
            return RunResult(
                status="error", reason="provider_rate_limited",
                retry_after_seconds=exc.retry_after,
            )
        except LLMUnavailable as exc:
            _write_log(
                db, agent_id=agent_id, trigger=trigger, action="error",
                status="error", reason="provider_unavailable",
                input_summary=summary, error=str(exc),
            )
            return RunResult(status="error", reason="provider_unavailable")
        except LLMConfigError as exc:
            _write_log(
                db, agent_id=agent_id, trigger=trigger, action="error",
                status="error", reason="llm_config_error",
                input_summary=summary, error=str(exc),
            )
            return RunResult(status="error", reason="llm_config_error")

        model = llm_result.model
        tokens_in, tokens_out = llm_result.tokens_in, llm_result.tokens_out
        latency_ms = llm_result.latency_ms
        _add_tokens(db, tokens_in + tokens_out)

        # 4. Parse, with ONE correction retry inside the same claimed budget.
        try:
            parsed = parse_decision(llm_result.text)
        except InvalidModelOutput:
            try:
                retry_result = await call_llm(
                    messages + [{"role": "user", "content": CORRECTION_PROMPT}],
                    model_tier="fast", max_tokens=LLM_MAX_TOKENS,
                    temperature=0.0, json_mode=True,
                )
            except (LLMRateLimited, LLMUnavailable, LLMConfigError) as exc:
                reason = (
                    "provider_rate_limited" if isinstance(exc, LLMRateLimited)
                    else "provider_unavailable" if isinstance(exc, LLMUnavailable)
                    else "llm_config_error"
                )
                _write_log(
                    db, agent_id=agent_id, trigger=trigger, action="error",
                    status="error", reason=reason, input_summary=summary,
                    error=str(exc), model=model,
                    tokens_in=tokens_in, tokens_out=tokens_out,
                    latency_ms=latency_ms,
                )
                retry_after = exc.retry_after if isinstance(exc, LLMRateLimited) else None
                return RunResult(
                    status="error", reason=reason,
                    retry_after_seconds=retry_after,
                )
            tokens_in += retry_result.tokens_in
            tokens_out += retry_result.tokens_out
            latency_ms += retry_result.latency_ms
            _add_tokens(db, retry_result.tokens_in + retry_result.tokens_out)
            try:
                parsed = parse_decision(retry_result.text)
            except InvalidModelOutput as exc:
                _write_log(
                    db, agent_id=agent_id, trigger=trigger, action="error",
                    status="error", reason="invalid_model_output",
                    input_summary=summary, error=str(exc), model=model,
                    tokens_in=tokens_in, tokens_out=tokens_out,
                    latency_ms=latency_ms,
                )
                return RunResult(status="error", reason="invalid_model_output")

        # 5. Validate in code; the model is never trusted.
        try:
            decision: ValidatedDecision = validate_decision(
                parsed,
                eligible_ids=ctx.eligible_ids,
                skill_md=ctx.agent_skill,
            )
        except InvalidModelOutput as exc:
            _write_log(
                db, agent_id=agent_id, trigger=trigger, action="error",
                status="error", reason="invalid_model_output",
                input_summary=summary, error=str(exc), model=model,
                tokens_in=tokens_in, tokens_out=tokens_out,
                latency_ms=latency_ms,
            )
            return RunResult(status="error", reason="invalid_model_output")
        except DecisionRejected as exc:
            _write_log(
                db, agent_id=agent_id, trigger=trigger, action="none",
                status="none", reason=exc.reason, input_summary=summary,
                model=model, tokens_in=tokens_in, tokens_out=tokens_out,
                latency_ms=latency_ms,
            )
            return RunResult(status="none", reason=exc.reason)

        if decision.action == "none":
            _write_log(
                db, agent_id=agent_id, trigger=trigger, action="none",
                status="none", reason=decision.reason, input_summary=summary,
                model=model, tokens_in=tokens_in, tokens_out=tokens_out,
                latency_ms=latency_ms,
            )
            return RunResult(status="none", reason=decision.reason)

        # 6. Reply safety re-checks against live DB state (the feed snapshot
        # may be stale by seconds): target exists, is top-level, is not the
        # agent's own post, and has no reply from this agent yet.
        if decision.action == "reply":
            assert decision.reply_to_post_id is not None
            # Fail closed: any lookup problem means "post nothing".
            try:
                target_res = (
                    db.table("posts")
                    .select("id,author_agent_id,parent_id")
                    .eq("id", decision.reply_to_post_id)
                    .single()
                    .execute()
                )
                target = target_res.data or {}
                dupe_res = (
                    db.table("posts")
                    .select("id")
                    .eq("author_agent_id", agent_id)
                    .eq("parent_id", decision.reply_to_post_id)
                    .limit(1)
                    .execute()
                )
            except Exception:
                target, dupe_res = {}, None
            if (
                not target.get("id")
                or target.get("author_agent_id") == agent_id
                or target.get("parent_id") is not None
                or dupe_res is None
                or (dupe_res.data or [])
            ):
                _write_log(
                    db, agent_id=agent_id, trigger=trigger, action="none",
                    status="none", reason="rejected_by_filter",
                    input_summary=summary, model=model,
                    tokens_in=tokens_in, tokens_out=tokens_out,
                    latency_ms=latency_ms,
                )
                return RunResult(status="none", reason="rejected_by_filter")

        if dry_run:
            _write_log(
                db, agent_id=agent_id, trigger=trigger,
                action=decision.action, status="none",
                reason=f"dry_run:{decision.action}",
                input_summary=summary, text=decision.text,
                model=model, tokens_in=tokens_in,
                tokens_out=tokens_out, latency_ms=latency_ms,
            )
            return RunResult(
                status="none", reason=f"dry_run:{decision.action}",
                text=decision.text,
            )

        # 7. Write the post as the agent (service role bypasses RLS).
        assert decision.text is not None
        insert_res = db.table("posts").insert(
            {
                "author_agent_id": agent_id,
                "author_profile_id": None,
                "body": decision.text,
                "parent_id": decision.reply_to_post_id,
            }
        ).execute()
        rows = insert_res.data or []
        post_id = str(rows[0].get("id")) if rows else None
        db.table("agents").update({"last_run_at": _utcnow_iso()}).eq(
            "id", agent_id
        ).execute()

        status = "replied" if decision.action == "reply" else "posted"
        _write_log(
            db, agent_id=agent_id, trigger=trigger,
            action=decision.action, status=status,
            reason=decision.reason, input_summary=summary,
            post_id=post_id, text=decision.text,
            model=model, tokens_in=tokens_in,
            tokens_out=tokens_out, latency_ms=latency_ms,
        )
        logger.info(
            "run ok agent=%s action=%s post_id=%s", agent_id, status, post_id
        )
        return RunResult(
            status=status, reason=decision.reason,
            post_id=post_id, text=decision.text,
        )
    except Exception:
        # Real bug: log a best-effort row, then re-raise so the endpoint
        # returns 500 (never a silent wrong outcome).
        logger.exception("run_agent_once crashed agent=%s", agent_id)
        try:
            _write_log(
                db, agent_id=agent_id, trigger=trigger, action="error",
                status="error", reason="internal_error",
                input_summary=summary, error="internal error",
            )
        except Exception:  # noqa: BLE001 - last-resort logging
            pass
        raise
