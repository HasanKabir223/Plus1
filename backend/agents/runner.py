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
from backend.agents.conversation import schedule_advance
from backend.agents.decision import (
    DecisionRejected,
    InvalidModelOutput,
    ValidatedDecision,
    extract_like_ids,
    looks_like_thanks,
    parse_decision,
    parse_scores,
    validate_decision,
)
from backend.agents.prompt import build_messages
from backend.database import get_admin_client
from backend.llm import (
    LLMConfigError,
    LLMGenerationError,
    LLMRateLimited,
    LLMResult,
    LLMUnavailable,
    llm_complete,
)

logger = logging.getLogger(__name__)

# Decision JSON grows with the shortlist (up to 5 scored posts plus awaiting
# comments); 400 truncated it into invalid JSON. 800 leaves headroom while
# staying far under the daily token caps.
LLM_MAX_TOKENS = 800
LLM_TEMPERATURE = 0.8
CORRECTION_PROMPT = (
    "Your last reply was not a valid JSON decision object. "
    "Reply with ONLY the JSON decision object, nothing else."
)


@dataclass
class RunResult:
    status: str  # posted | commented | answered | messaged | none | skipped | error
    reason: str
    post_id: str | None = None
    text: str | None = None
    retry_after_seconds: int | None = None
    likes_applied: int = 0
    parent_post_id: str | None = None
    likes_would_apply: int = 0
    conversation_id: str | None = None
    target_label: str | None = None
    comment_id: str | None = None
    answered_comment_id: str | None = None
    shortlist_size: int | None = None
    scores: list[dict[str, Any]] | None = None
    awaiting_threads_seen: int | None = None

    def to_dict(self) -> dict[str, Any]:
        body: dict[str, Any] = {"status": self.status, "reason": self.reason}
        if self.post_id is not None:
            body["post_id"] = self.post_id
        if self.text is not None:
            body["text"] = self.text
        if self.retry_after_seconds is not None:
            body["retry_after_seconds"] = self.retry_after_seconds
        if self.likes_applied:
            body["likes_applied"] = self.likes_applied
        if self.parent_post_id is not None:
            body["parent_post_id"] = self.parent_post_id
        if self.likes_would_apply:
            body["likes_would_apply"] = self.likes_would_apply
        if self.conversation_id is not None:
            body["conversation_id"] = self.conversation_id
        if self.target_label is not None:
            body["target_label"] = self.target_label
        if self.comment_id is not None:
            body["comment_id"] = self.comment_id
        if self.answered_comment_id is not None:
            body["answered_comment_id"] = self.answered_comment_id
        if self.shortlist_size is not None:
            body["shortlist_size"] = self.shortlist_size
        if self.scores is not None:
            body["scores"] = self.scores
        if self.awaiting_threads_seen is not None:
            body["awaiting_threads_seen"] = self.awaiting_threads_seen
        return body


LlmCaller = Callable[..., Coroutine[Any, Any, LLMResult]]


def _iso_now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


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
    like_ids: list[str] | None = None,
    parent_post_id: str | None = None,
    comment_id: str | None = None,
    answered_comment_id: str | None = None,
    shortlist_size: int | None = None,
    scores: list[dict[str, Any]] | None = None,
) -> None:
    """Best-effort action_log insert. Logging must never break a run."""
    try:
        output: dict[str, Any] = {
            "reason": reason,
            "post_id": post_id,
            "text": text,
        }
        if like_ids:
            output["like_post_ids"] = list(like_ids)
            output["likes_applied"] = len(like_ids)
        if parent_post_id is not None:
            output["parent_post_id"] = parent_post_id
        if comment_id is not None:
            output["comment_id"] = comment_id
        if answered_comment_id is not None:
            output["answered_comment_id"] = answered_comment_id
        if shortlist_size is not None:
            output["shortlist_size"] = shortlist_size
        if scores is not None:
            output["scores"] = scores
        db.table("action_log").insert(
            {
                "agent_id": agent_id,
                "trigger": trigger,
                "action": action,
                "input_summary": input_summary or {},
                "output": output,
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


def _scores_for_log(scores: dict) -> list[dict[str, Any]]:
    """Model scores in owner-visible shape: [{post_id, score}]."""
    return [
        {"post_id": sid, "score": entry.score} for sid, entry in scores.items()
    ]


def _is_unique_violation(exc: Exception) -> bool:
    """True when the DB rejected an insert as a duplicate (lost race)."""
    msg = str(exc).lower()
    return "23505" in msg or "duplicate" in msg or "already exists" in msg


def _apply_likes(db: Any, agent_id: str, like_ids: list[str]) -> list[str]:
    """Insert agent likes (service role). Idempotent: duplicates are skipped.

    Uses ON CONFLICT DO NOTHING semantics (ignore_duplicates), so a second
    like of the same post is a no-op rather than an error. Returns the ids
    that were actually inserted.
    """
    applied: list[str] = []
    for post_id in like_ids:
        try:
            res = (
                db.table("post_likes")
                .insert(
                    {
                        "post_id": post_id,
                        "liker_agent_id": agent_id,
                        "liker_profile_id": None,
                    },
                    ignore_duplicates=True,
                )
                .execute()
            )
        except Exception as exc:  # noqa: BLE001 - one bad like must not fail the run
            logger.warning(
                "like insert failed agent=%s post=%s: %r", agent_id, post_id, exc
            )
            continue
        if res.data:
            applied.append(post_id)
    return applied


async def run_agent_once(
    agent_id: str,
    trigger: str = "manual",
    dry_run: bool = False,
    *,
    client: Any | None = None,
    llm_caller: LlmCaller | None = None,
) -> RunResult:
    """Wake one agent up once: maybe post, comment, answer, message, or nothing.

    Free when there is nothing worth doing (no claim, no LLM call).
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

    # 1b. Paused agents stop here (no claim needed to know the status).
    if ctx.agent_status != "active":
        _write_log(
            db, agent_id=agent_id, trigger=trigger, action="skip",
            status="skipped", reason="paused", input_summary=summary,
        )
        logger.info("run skipped agent=%s reason=paused", agent_id)
        return RunResult(status="skipped", reason="paused", retry_after_seconds=0)

    # 1c. Free path: nothing awaiting and nothing shortlisted costs no
    # budget and no LLM call. Still logged (counts only), unless dry_run.
    if not ctx.awaiting_threads and not ctx.shortlist:
        if not dry_run:
            _write_log(
                db, agent_id=agent_id, trigger=trigger, action="none",
                status="none", reason="nothing_relevant",
                input_summary=summary,
            )
        logger.info("run free agent=%s reason=nothing_relevant", agent_id)
        return RunResult(
            status="none", reason="nothing_relevant",
            shortlist_size=0, scores=[], awaiting_threads_seen=0,
        )

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
                    "p_global_daily_token_cap": config.GLOBAL_DAILY_TOKEN_CAP,
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
                messages, max_tokens=LLM_MAX_TOKENS,
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
        except LLMGenerationError as exc:
            _write_log(
                db, agent_id=agent_id, trigger=trigger, action="error",
                status="error", reason="invalid_model_output",
                input_summary=summary, error=str(exc),
            )
            return RunResult(status="error", reason="invalid_model_output")
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
                    max_tokens=LLM_MAX_TOKENS,
                    temperature=0.0, json_mode=True,
                )
            except (LLMRateLimited, LLMUnavailable, LLMConfigError, LLMGenerationError) as exc:
                reason = (
                    "provider_rate_limited" if isinstance(exc, LLMRateLimited)
                    else "provider_unavailable" if isinstance(exc, LLMUnavailable)
                    else "invalid_model_output" if isinstance(exc, LLMGenerationError)
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
                    text=(retry_result.text or "")[:300],
                    tokens_in=tokens_in, tokens_out=tokens_out,
                    latency_ms=latency_ms,
                )
                return RunResult(status="error", reason="invalid_model_output")
            # Validation and logging below must see the output that parsed.
            llm_result = retry_result

        # 5. Validate in code; the model is never trusted. Likes are
        # extracted first (never raises) so they survive a rejected comment.
        known_ids = (
            ctx.eligible_ids
            | ctx.eligible_like_ids
            | ctx.eligible_answer_ids
            | {t.post.id for t in ctx.outreach_targets}
        )
        parsed_scores = parse_scores(parsed, known_ids=known_ids)
        like_ids = extract_like_ids(
            parsed,
            eligible_like_ids=ctx.eligible_like_ids,
            scores=parsed_scores,
            likes_today=ctx.likes_today,
        )
        outreach_ids = (
            {t.post.id for t in ctx.outreach_targets}
            if config.OUTREACH_PER_RUN >= 1
            else set()
        )
        shortlist_size = len(ctx.shortlist)
        log_scores = _scores_for_log(parsed_scores)
        try:
            decision: ValidatedDecision = validate_decision(
                parsed,
                eligible_ids=ctx.eligible_ids,
                skill_md=ctx.agent_skill,
                eligible_like_ids=ctx.eligible_like_ids,
                likes_today=ctx.likes_today,
                eligible_outreach_ids=outreach_ids,
                eligible_answer_ids=ctx.eligible_answer_ids,
            )
        except InvalidModelOutput as exc:
            _write_log(
                db, agent_id=agent_id, trigger=trigger, action="error",
                status="error", reason="invalid_model_output",
                input_summary=summary, error=str(exc), model=model,
                text=(llm_result.text or "")[:300],
                tokens_in=tokens_in, tokens_out=tokens_out,
                latency_ms=latency_ms,
            )
            return RunResult(status="error", reason="invalid_model_output")
        except DecisionRejected as exc:
            applied = [] if dry_run else _apply_likes(db, agent_id, like_ids)
            _write_log(
                db, agent_id=agent_id, trigger=trigger, action="none",
                status="none", reason=exc.reason, input_summary=summary,
                model=model, tokens_in=tokens_in, tokens_out=tokens_out,
                latency_ms=latency_ms, like_ids=applied or None,
                shortlist_size=shortlist_size, scores=log_scores,
            )
            return RunResult(
                status="none", reason=exc.reason,
                likes_applied=len(applied),
                likes_would_apply=(len(like_ids) if dry_run else 0),
                shortlist_size=shortlist_size, scores=log_scores,
                awaiting_threads_seen=len(ctx.awaiting_threads),
            )

        like_ids = decision.like_post_ids
        applied_like_ids = [] if dry_run else _apply_likes(db, agent_id, like_ids)
        likes_applied = len(applied_like_ids)
        log_scores = _scores_for_log(decision.scores)

        def _reject_to_none(reason: str) -> RunResult:
            _write_log(
                db, agent_id=agent_id, trigger=trigger, action="none",
                status="none", reason=reason, input_summary=summary,
                model=model, tokens_in=tokens_in, tokens_out=tokens_out,
                latency_ms=latency_ms, like_ids=applied_like_ids or None,
                shortlist_size=shortlist_size, scores=log_scores,
            )
            return RunResult(
                status="none", reason=reason,
                likes_applied=len(applied_like_ids),
                likes_would_apply=(len(like_ids) if dry_run else 0),
                shortlist_size=shortlist_size, scores=log_scores,
                awaiting_threads_seen=len(ctx.awaiting_threads),
            )

        if decision.action == "none":
            _write_log(
                db, agent_id=agent_id, trigger=trigger, action="none",
                status="none", reason=decision.reason, input_summary=summary,
                model=model, tokens_in=tokens_in, tokens_out=tokens_out,
                latency_ms=latency_ms, like_ids=applied_like_ids or None,
                shortlist_size=shortlist_size, scores=log_scores,
            )
            return RunResult(
                status="none", reason=decision.reason,
                likes_applied=likes_applied,
                likes_would_apply=(len(like_ids) if dry_run else 0),
                shortlist_size=shortlist_size, scores=log_scores,
                awaiting_threads_seen=len(ctx.awaiting_threads),
            )

        # 6. Comment safety re-checks against live DB state (the shortlist
        # snapshot may be stale by seconds). Fail closed: any lookup
        # problem means "post nothing".
        if decision.action == "comment":
            assert decision.target_post_id is not None
            try:
                target_res = (
                    db.table("posts")
                    .select("id,author_agent_id,parent_id")
                    .eq("id", decision.target_post_id)
                    .single()
                    .execute()
                )
                target = target_res.data or {}
                opener_res = (
                    db.table("posts")
                    .select("id")
                    .eq("author_agent_id", agent_id)
                    .eq("parent_id", decision.target_post_id)
                    .is_("reply_to_id", "null")
                    .limit(1)
                    .execute()
                )
                count_res = (
                    db.table("posts")
                    .select("id")
                    .eq("author_agent_id", agent_id)
                    .eq("parent_id", decision.target_post_id)
                    .execute()
                )
            except Exception:
                target, opener_res, count_res = {}, None, None
            per_post = (
                len(count_res.data or []) if count_res is not None else 10**9
            )
            if (
                not target.get("id")
                or target.get("author_agent_id") == agent_id
                or target.get("parent_id") is not None
                or opener_res is None
                or count_res is None
            ):
                return _reject_to_none("rejected_by_filter")
            if opener_res.data or []:
                return _reject_to_none("already_done")
            if (
                config.AGENT_COMMENTS_PER_RUN < 1
                or per_post >= config.AGENT_MAX_COMMENTS_PER_POST
                or ctx.comments_today >= config.AGENT_COMMENT_DAILY_CAP
            ):
                return _reject_to_none("below_threshold")

        # 6b. Answer safety re-checks: the comment must still exist under
        # the named post, unanswered by this agent, with cap room left.
        if decision.action == "answer":
            assert decision.answer_to_comment_id is not None
            assert decision.target_post_id is not None
            try:
                ans_res = (
                    db.table("posts")
                    .select("id,parent_id,body")
                    .eq("id", decision.answer_to_comment_id)
                    .single()
                    .execute()
                )
                ans_row = ans_res.data or {}
                answered_res = (
                    db.table("posts")
                    .select("id")
                    .eq("author_agent_id", agent_id)
                    .eq("reply_to_id", decision.answer_to_comment_id)
                    .limit(1)
                    .execute()
                )
                count_res = (
                    db.table("posts")
                    .select("id")
                    .eq("author_agent_id", agent_id)
                    .eq("parent_id", decision.target_post_id)
                    .execute()
                )
            except Exception:
                ans_row, answered_res, count_res = {}, None, None
            if (
                not ans_row.get("id")
                or ans_row.get("parent_id") != decision.target_post_id
                or answered_res is None
                or count_res is None
            ):
                return _reject_to_none("rejected_by_filter")
            if answered_res.data or []:
                return _reject_to_none("already_done")
            if len(count_res.data or []) >= config.AGENT_MAX_COMMENTS_PER_POST:
                return _reject_to_none("below_threshold")
            # Thanks-only replies get a like or nothing, never inserted text.
            thread_body = next(
                (
                    t.awaiting_comment_body
                    for t in ctx.awaiting_threads
                    if t.awaiting_comment_id == decision.answer_to_comment_id
                ),
                None,
            )
            if thread_body is None:
                thread_body = ans_row.get("body")
            if looks_like_thanks(thread_body):
                thanks_room = (
                    decision.answer_to_comment_id in ctx.eligible_like_ids
                    and len(applied_like_ids) < config.AGENT_LIKES_PER_RUN
                    and ctx.likes_today + len(applied_like_ids)
                    < config.AGENT_LIKE_DAILY_CAP
                )
                if thanks_room:
                    if dry_run:
                        like_ids = [
                            *like_ids,
                            decision.answer_to_comment_id,
                        ]
                    else:
                        applied_like_ids += _apply_likes(
                            db, agent_id, [decision.answer_to_comment_id]
                        )
                    return _reject_to_none("thanks_liked")
                return _reject_to_none("thanks_skipped")

        # 6b. Outreach: open a conversation with the eligible post's author.
        # The recipient was resolved by Python in load_context; the model
        # only ever supplied the post id.
        if decision.action == "message":
            if dry_run:
                _write_log(
                    db, agent_id=agent_id, trigger=trigger,
                    action="message", status="none",
                    reason="dry_run:message",
                    input_summary=summary, text=decision.text,
                    model=model, tokens_in=tokens_in,
                    tokens_out=tokens_out, latency_ms=latency_ms,
                    shortlist_size=shortlist_size, scores=log_scores,
                )
                return RunResult(
                    status="none", reason="dry_run:message",
                    text=decision.text,
                    likes_would_apply=len(like_ids),
                    shortlist_size=shortlist_size, scores=log_scores,
                    awaiting_threads_seen=len(ctx.awaiting_threads),
                )

            target = next(
                (t for t in ctx.outreach_targets if t.post.id == decision.target_post_id),
                None,
            )
            if target is None:
                _write_log(
                    db, agent_id=agent_id, trigger=trigger, action="none",
                    status="none", reason="rejected_by_filter",
                    input_summary=summary, model=model,
                    tokens_in=tokens_in, tokens_out=tokens_out,
                    latency_ms=latency_ms,
                    like_ids=applied_like_ids or None,
                    shortlist_size=shortlist_size, scores=log_scores,
                )
                return RunResult(
                    status="none", reason="rejected_by_filter",
                    likes_applied=likes_applied,
                    shortlist_size=shortlist_size, scores=log_scores,
                    awaiting_threads_seen=len(ctx.awaiting_threads),
                )

            # Python writes the disclosure line; the model never does.
            disclosure = (
                f"Hi {target.display_name}, I'm {ctx.agent_name}, "
                f"an AI agent working for @{ctx.owner_username}."
            )
            stored_body = f"{disclosure}\n\n{decision.text or ''}".strip()
            if len(stored_body) > config.MESSAGE_MAX_CHARS:
                stored_body = stored_body[: config.MESSAGE_MAX_CHARS].rstrip()

            conv_kind = "agent_agent" if target.recipient_kind == "agent" else "human_agent"
            try:
                conv_res = (
                    db.table("conversations")
                    .insert(
                        {
                            "kind": conv_kind,
                            "status": "open",
                            "mode": "auto",
                            "origin_post_id": target.post.id,
                            "initiated_by_agent_id": agent_id,
                            "message_count": 0,
                            "max_messages": config.CONVERSATION_MAX_MESSAGES,
                        }
                    )
                    .execute()
                )
                conv_row = (conv_res.data or [{}])[0]
                conversation_id = str(conv_row.get("id"))

                db.table("conversation_participants").insert(
                    {
                        "conversation_id": conversation_id,
                        "profile_id": None,
                        "agent_id": agent_id,
                    }
                ).execute()
                db.table("conversation_participants").insert(
                    {
                        "conversation_id": conversation_id,
                        "profile_id": target.recipient_profile_id,
                        "agent_id": target.recipient_agent_id,
                    }
                ).execute()

                db.table("messages").insert(
                    {
                        "conversation_id": conversation_id,
                        "sender_profile_id": None,
                        "sender_agent_id": agent_id,
                        "kind": "message",
                        "body": stored_body,
                    }
                ).execute()

                db.table("conversations").update(
                    {"message_count": 1, "last_message_at": _iso_now()}
                ).eq("id", conversation_id).execute()
            except Exception as exc:  # noqa: BLE001 - one bad run must not 500 the endpoint
                logger.warning("outreach create failed agent=%s: %r", agent_id, exc)
                return RunResult(status="error", reason="write_failed")

            _write_log(
                db, agent_id=agent_id, trigger=trigger, action="message",
                status="messaged", reason=decision.reason,
                input_summary=summary, text=decision.text,
                model=model, tokens_in=tokens_in,
                tokens_out=tokens_out, latency_ms=latency_ms,
                like_ids=applied_like_ids or None,
                shortlist_size=shortlist_size, scores=log_scores,
            )
            if target.recipient_kind == "agent":
                schedule_advance(conversation_id)
            return RunResult(
                status="messaged", reason=decision.reason,
                text=decision.text, likes_applied=likes_applied,
                conversation_id=conversation_id,
                target_label=target.display_name,
                shortlist_size=shortlist_size, scores=log_scores,
                awaiting_threads_seen=len(ctx.awaiting_threads),
            )

        if dry_run:
            _write_log(
                db, agent_id=agent_id, trigger=trigger,
                action=decision.action, status="none",
                reason=f"dry_run:{decision.action}",
                input_summary=summary, text=decision.text,
                model=model, tokens_in=tokens_in,
                tokens_out=tokens_out, latency_ms=latency_ms,
                shortlist_size=shortlist_size, scores=log_scores,
            )
            return RunResult(
                status="none", reason=f"dry_run:{decision.action}",
                text=decision.text,
                likes_would_apply=len(like_ids),
                shortlist_size=shortlist_size, scores=log_scores,
                awaiting_threads_seen=len(ctx.awaiting_threads),
            )

        # 7. Write the post/comment/answer as the agent (service role
        # bypasses RLS). A duplicate-insert race is a quiet none, not a crash.
        assert decision.text is not None
        parent_id = (
            decision.target_post_id
            if decision.action in ("comment", "answer")
            else None
        )
        reply_to_id = (
            decision.answer_to_comment_id if decision.action == "answer" else None
        )
        try:
            insert_res = db.table("posts").insert(
                {
                    "author_agent_id": agent_id,
                    "author_profile_id": None,
                    "body": decision.text,
                    "parent_id": parent_id,
                    "reply_to_id": reply_to_id,
                }
            ).execute()
        except Exception as exc:
            if _is_unique_violation(exc):
                return _reject_to_none("already_done")
            raise
        rows = insert_res.data or []
        post_id = str(rows[0].get("id")) if rows else None
        db.table("agents").update({"last_run_at": _utcnow_iso()}).eq(
            "id", agent_id
        ).execute()

        status = {"comment": "commented", "answer": "answered"}.get(
            decision.action, "posted"
        )
        is_thread = decision.action in ("comment", "answer")
        thread_id = parent_id if is_thread else post_id
        comment_id = post_id if is_thread else None
        _write_log(
            db, agent_id=agent_id, trigger=trigger,
            action=decision.action, status=status,
            reason=decision.reason, input_summary=summary,
            post_id=thread_id, text=decision.text,
            model=model, tokens_in=tokens_in,
            tokens_out=tokens_out, latency_ms=latency_ms,
            like_ids=applied_like_ids or None,
            parent_post_id=parent_id,
            comment_id=comment_id,
            answered_comment_id=reply_to_id,
            shortlist_size=shortlist_size, scores=log_scores,
        )
        logger.info(
            "run ok agent=%s action=%s post_id=%s", agent_id, status, post_id
        )
        return RunResult(
            status=status, reason=decision.reason,
            post_id=thread_id, text=decision.text,
            likes_applied=likes_applied,
            parent_post_id=parent_id,
            comment_id=comment_id,
            answered_comment_id=reply_to_id,
            shortlist_size=shortlist_size, scores=log_scores,
            awaiting_threads_seen=len(ctx.awaiting_threads),
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
