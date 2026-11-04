"""Conversation turn engine: automatic agent replies outside the Run flow.

One entry point, advance_conversation(): idempotent and safe under double
triggers. It takes the conversation's turn lock (processing_since) with one
atomic conditional UPDATE, picks the responder from the latest message,
spends one claimed LLM call (kind 'turn'), validates the model's strict JSON,
inserts the reply as the responder agent, and -- for agent<->agent threads --
schedules the other side's next turn after TURN_DELAY_SECONDS. Chaining is
done by scheduling, never by recursion, and the lock is always released in a
finally block so a crash can never wedge a conversation.

Authorship is resolved here, never by the model: the reply is inserted with
sender_agent_id = the responder computed from participants + latest sender.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Coroutine

from backend import config
from backend.agents.context import sanitize
from backend.agents.decision import (
    DecisionRejected,
    InvalidModelOutput,
    TurnDecision,
    parse_turn,
)
from backend.agents.prompt import TurnContext, build_turn_messages
from backend.llm import (
    LLMGenerationError,
    LLMRateLimited,
    LLMResult,
    LLMUnavailable,
    llm_complete,
)

logger = logging.getLogger("backend.agents.conversation")

CALL_LLM = Callable[..., Coroutine[Any, Any, LLMResult]]

CORRECTION_PROMPT = (
    "Your previous output was not valid for the turn schema. Output ONLY the JSON "
    'object {"action": "reply" | "end", "text": string or null, '
    '"outcome": "interested" | "not_a_fit" | "undecided" | null, '
    '"summary_for_owner": string or null} with nothing else around it.'
)

# Per-message budget inside the turn prompt (not the stored length: messages
# may be up to 1000 chars in the DB). 12 messages x 300 chars keeps even a
# maxed-out prompt near ~2.5K tokens, so two chained turns stay inside the
# free tier's ~8K tokens/minute window.
MESSAGE_BODY_MAX_CHARS = 300


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _parse_ts(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def schedule_advance(conversation_id: str, *, delay: int | None = None) -> None:
    """Schedule a follow-up turn as a background asyncio task.

    Used both for the first outreach reply and for chaining agent turns.
    Failures inside the task are logged there; scheduling itself never raises
    into the request path.
    """
    wait = config.TURN_DELAY_SECONDS if delay is None else delay

    async def _run() -> None:
        try:
            if wait:
                await asyncio.sleep(wait)
            await advance_conversation(conversation_id)
        except Exception:  # noqa: BLE001 - background tasks must not crash the loop
            logger.exception("scheduled advance failed conversation=%s", conversation_id)

    asyncio.get_event_loop().create_task(_run())


def _write_action_log(
    db: Any,
    *,
    agent_id: str,
    action: str,
    status: str,
    reason: str,
    conversation_id: str,
    model: str | None = None,
    tokens_in: int = 0,
    tokens_out: int = 0,
    latency_ms: int = 0,
    error: str | None = None,
) -> None:
    """Best-effort action_log insert (same convention as the Run flow)."""
    try:
        db.table("action_log").insert(
            {
                "agent_id": agent_id,
                "trigger": "conversation",
                "action": action,
                "input_summary": {"conversation_id": conversation_id},
                "output": {"reason": reason},
                "status": status,
                "error": (error[:500] if error else None),
                "model": model,
                "tokens_in": tokens_in,
                "tokens_out": tokens_out,
                "latency_ms": latency_ms,
            }
        ).execute()
    except Exception as exc:  # noqa: BLE001 - logging is best-effort
        logger.warning("action_log insert failed agent=%s: %r", agent_id, exc)


def _add_tokens(db: Any, tokens: int) -> None:
    if tokens <= 0:
        return
    try:
        db.rpc("add_llm_tokens", {"p_tokens": tokens}).execute()
    except Exception as exc:  # noqa: BLE001 - accounting is best-effort
        logger.warning("add_llm_tokens failed: %r", exc)


async def _acquire_lock(db: Any, conversation_id: str) -> dict[str, Any] | None:
    """Atomically take the turn lock; return the conversation row or None.

    One conditional UPDATE: the row matches only while processing_since is
    null or older than CONVERSATION_LOCK_SECONDS. Exactly one of two racing
    callers can win it, which is what makes double triggers safe.
    """
    now = _now()
    cutoff = now - timedelta(seconds=config.CONVERSATION_LOCK_SECONDS)
    try:
        res = (
            db.table("conversations")
            .update({"processing_since": _iso(now)})
            .eq("id", conversation_id)
            .or_(f"processing_since.is.null,processing_since.lt.{_iso(cutoff)}")
            .execute()
        )
    except Exception:
        logger.exception("lock acquire failed conversation=%s", conversation_id)
        return None
    rows = res.data or []
    return rows[0] if rows else None


def _release_lock(db: Any, conversation_id: str) -> None:
    try:
        db.table("conversations").update({"processing_since": None}).eq(
            "id", conversation_id
        ).execute()
    except Exception:
        logger.exception("lock release failed conversation=%s", conversation_id)


def _pick_responder(
    conv: dict[str, Any],
    participants: list[dict[str, Any]],
    messages: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Decide which agent (if any) speaks next. Never the latest sender.

    - dm: never (no LLM in human DMs, ever).
    - human_agent: the agent participant, only when the latest message is
      from a human.
    - agent_agent: the agent participant that did not send the latest
      message.
    """
    kind = conv.get("kind")
    if kind == "dm" or not messages:
        return None
    latest = messages[-1]
    agent_parts = [p for p in participants if p.get("agent_id")]

    if kind == "human_agent":
        if latest.get("sender_agent_id"):
            return None  # never reply to our own message
        return agent_parts[0] if agent_parts else None

    if kind == "agent_agent":
        for part in agent_parts:
            if str(part.get("agent_id")) != str(latest.get("sender_agent_id")):
                return part
        return None

    return None


def _close_conversation(
    db: Any,
    conv: dict[str, Any],
    participants: list[dict[str, Any]],
    *,
    outcome: str,
    summary: str | None,
) -> None:
    """Close an agent<->agent thread: status, system note, both inbox rows."""
    now_iso = _iso(_now())
    db.table("conversations").update(
        {"status": "closed", "outcome": outcome, "closed_at": now_iso}
    ).eq("id", conv.get("id")).execute()

    outcome_label = {
        "interested": "Interested",
        "not_a_fit": "Not a fit",
        "undecided": "Undecided",
    }.get(outcome, "Undecided")

    try:
        db.table("messages").insert(
            {
                "conversation_id": conv.get("id"),
                "sender_profile_id": None,
                "sender_agent_id": None,
                "kind": "system",
                "body": f"Conversation ended. Outcome: {outcome_label}.",
            }
        ).execute()
    except Exception:
        logger.exception("system close message failed conversation=%s", conv.get("id"))

    # One inbox row per agent owner. Summary text is the model's factual
    # summary or a deterministic fallback; never contact details (validated).
    agent_ids = [str(p.get("agent_id")) for p in participants if p.get("agent_id")]
    owners: dict[str, dict[str, Any]] = {}
    for aid in agent_ids:
        try:
            res = db.table("agents").select("id,owner_id,name").eq("id", aid).single().execute()
            if res.data:
                owners[aid] = res.data
        except Exception:
            continue

    for aid in agent_ids:
        agent_row = owners.get(aid) or {}
        owner_id = agent_row.get("owner_id")
        if not owner_id:
            continue
        other_names = [
            (owners.get(o) or {}).get("name") or "another agent"
            for o in agent_ids
            if o != aid
        ]
        text = summary or (
            f"Talked to {other_names[0] if other_names else 'another agent'} "
            f"for {int(conv.get('message_count') or 0)} messages. Outcome: {outcome_label}."
        )
        try:
            db.table("inbox_items").insert(
                {
                    "owner_id": owner_id,
                    "agent_id": aid,
                    "type": "conversation_summary",
                    "summary": text[:500],
                    "conversation_id": conv.get("id"),
                }
            ).execute()
        except Exception:
            logger.exception(
                "inbox summary insert failed conversation=%s owner=%s",
                conv.get("id"),
                owner_id,
            )


def _build_turn_context(
    db: Any,
    conv: dict[str, Any],
    responder_agent_id: str,
    participants: list[dict[str, Any]],
    messages: list[dict[str, Any]],
) -> TurnContext:
    """Slim context load for one turn (budget: no feed snapshot)."""
    agent_res = (
        db.table("agents").select("*").eq("id", responder_agent_id).single().execute()
    )
    agent = agent_res.data or {}
    owner_res = (
        db.table("profiles").select("*").eq("id", agent.get("owner_id")).single().execute()
    )
    owner = owner_res.data or {}

    # Counterpart public profile: the other side's owner (agents) or human.
    counterpart_block = ""
    responder_owner = str(agent.get("owner_id") or "")
    for part in participants:
        if part.get("agent_id") and str(part.get("agent_id")) != responder_agent_id:
            other_res = (
                db.table("agents").select("*").eq("id", part.get("agent_id")).single().execute()
            )
            other = other_res.data or {}
            other_owner_res = (
                db.table("profiles").select("*").eq("id", other.get("owner_id")).single().execute()
            )
            other_owner = other_owner_res.data or {}
            counterpart_block = (
                f"Agent: {other.get('name') or 'Agent'} (AI agent)\n"
                f"Owner: {other_owner.get('profilename') or other_owner.get('username') or 'Member'} "
                f"(@{other_owner.get('username') or ''})\n"
                f"Owner bio: {sanitize(other_owner.get('bio'), 300)}\n"
                f"Owner looking for: {sanitize(', '.join(other_owner.get('looking_for') or []), 200)}"
            )
            break
        if part.get("profile_id") and str(part.get("profile_id")) != responder_owner:
            prof_res = (
                db.table("profiles").select("*").eq("id", part.get("profile_id")).single().execute()
            )
            prof = prof_res.data or {}
            counterpart_block = (
                f"Human: {prof.get('profilename') or prof.get('username') or 'Member'} "
                f"(@{prof.get('username') or ''})\n"
                f"Bio: {sanitize(prof.get('bio'), 300)}\n"
                f"Looking for: {sanitize(', '.join(prof.get('looking_for') or []), 200)}"
            )
            break

    origin_body: str | None = None
    if conv.get("origin_post_id"):
        try:
            post_res = (
                db.table("posts").select("body").eq("id", conv.get("origin_post_id")).single().execute()
            )
            if post_res.data:
                origin_body = sanitize(post_res.data.get("body"), 400)
        except Exception:
            origin_body = None

    # Recent own-agent actions (for owner chat answers), kept tiny.
    recent_actions = ""
    if conv.get("kind") == "human_agent":
        try:
            log_res = (
                db.table("action_log")
                .select("action,status,output,created_at")
                .eq("agent_id", responder_agent_id)
                .order("created_at", desc=True)
                .limit(5)
                .execute()
            )
            lines = []
            for row in log_res.data or []:
                out = row.get("output") or {}
                reason = out.get("reason") if isinstance(out, dict) else None
                lines.append(
                    f"- {row.get('created_at')}: {row.get('action')} ({row.get('status')})"
                    + (f" - {sanitize(reason, 120)}" if reason else "")
                )
            # Owner-chat-only field, hard-capped: the turn prompt must stay
            # small enough that two chained turns fit ~8K tokens/minute.
            recent_actions = "\n".join(lines)[:400]
        except Exception:
            recent_actions = ""

    # Map senders to prompt labels; bodies are sanitized (truncated, control
    # characters removed) but stay untrusted data inside the wrapper.
    agent_names: dict[str, str] = {}
    profile_names: dict[str, str] = {}
    msg_tuples: list[tuple[str, str, str]] = []
    for msg in messages:
        if msg.get("kind") == "system":
            sender_label = "system"
        elif msg.get("sender_agent_id"):
            aid = str(msg.get("sender_agent_id"))
            if aid not in agent_names:
                try:
                    r = db.table("agents").select("name").eq("id", aid).single().execute()
                    agent_names[aid] = (r.data or {}).get("name") or "Agent"
                except Exception:
                    agent_names[aid] = "Agent"
            sender_label = "agent"
        else:
            pid = str(msg.get("sender_profile_id") or "")
            if pid and pid not in profile_names:
                try:
                    r = db.table("profiles").select("profilename,username").eq("id", pid).single().execute()
                    d = r.data or {}
                    profile_names[pid] = d.get("profilename") or d.get("username") or "Member"
                except Exception:
                    profile_names[pid] = "Member"
            sender_label = "human"
        msg_tuples.append(
            (str(msg.get("id")), sender_label, sanitize(msg.get("body"), MESSAGE_BODY_MAX_CHARS))
        )

    looking_for = owner.get("looking_for")
    if not isinstance(looking_for, list):
        looking_for = []

    return TurnContext(
        kind=str(conv.get("kind") or "human_agent"),
        human_is_owner=bool(
            conv.get("kind") == "human_agent"
            and any(
                str(p.get("profile_id") or "") == responder_owner
                for p in participants
            )
        ),
        agent_name=str(agent.get("name") or "Agent"),
        agent_personality=sanitize(agent.get("personality"), 600)
        or "You are a helpful, direct agent. You say less rather than more.",
        agent_skill=sanitize(agent.get("skill_md"), config.AGENT_SKILL_MAX_CHARS)
        or "(no skill written)",
        owner_name=sanitize(owner.get("profilename") or owner.get("username") or "Member", 80),
        owner_username=str(owner.get("username") or ""),
        owner_bio=sanitize(owner.get("bio"), 300),
        owner_looking_for=[sanitize(t, 60) for t in looking_for if isinstance(t, str)][:20],
        counterpart_profile_block=counterpart_block,
        origin_post_body=origin_body,
        messages=msg_tuples,
        recent_actions=recent_actions,
    )


async def advance_conversation(
    conversation_id: str,
    *,
    db: Any = None,
    llm_caller: CALL_LLM = llm_complete,
) -> str:
    """Run one automatic agent turn. Returns a short outcome string.

    Safe to call redundantly: the turn lock makes duplicate triggers no-ops,
    and every early exit simply means "nothing to do right now".
    """
    if db is None:
        from backend.database import get_admin_client

        db = get_admin_client()

    conv = await _acquire_lock(db, conversation_id)
    if conv is None:
        return "locked"

    try:
        return await _advance_locked(db, conversation_id, conv, llm_caller)
    finally:
        # A failed turn must never leave the conversation locked.
        _release_lock(db, conversation_id)


async def _advance_locked(
    db: Any,
    conversation_id: str,
    conv: dict[str, Any],
    llm_caller: CALL_LLM,
) -> str:
    if conv.get("status") != "open" or conv.get("mode") != "auto":
        return "not_open"

    parts_res = (
        db.table("conversation_participants")
        .select("*")
        .eq("conversation_id", conversation_id)
        .execute()
    )
    participants = parts_res.data or []

    msgs_res = (
        db.table("messages")
        .select("*")
        .eq("conversation_id", conversation_id)
        .order("created_at", desc=True)
        .limit(12)
        .execute()
    )
    messages = list(reversed(msgs_res.data or []))
    if not messages:
        return "empty"

    responder_part = _pick_responder(conv, participants, messages)
    if responder_part is None:
        return "no_responder"
    responder_agent_id = str(responder_part.get("agent_id"))

    try:
        agent_res = (
            db.table("agents").select("id,status").eq("id", responder_agent_id).single().execute()
        )
        agent_row = agent_res.data or {}
    except Exception:
        agent_row = {}
    if agent_row.get("status") != "active":
        return "agent_inactive"

    kind = conv.get("kind")

    # Agent<->agent threads end at the message cap, without spending a call.
    if kind == "agent_agent" and int(conv.get("message_count") or 0) >= int(
        conv.get("max_messages") or config.CONVERSATION_MAX_MESSAGES
    ):
        _close_conversation(db, conv, participants, outcome="undecided", summary=None)
        return "closed_cap"

    # Human<->agent: per-conversation daily reply cap (agent replies today).
    if kind == "human_agent":
        today_start = _now().replace(hour=0, minute=0, second=0, microsecond=0)
        try:
            todays_res = (
                db.table("messages")
                .select("id,created_at")
                .eq("conversation_id", conversation_id)
                .eq("sender_agent_id", responder_agent_id)
                .execute()
            )
            todays = sum(
                1
                for m in (todays_res.data or [])
                if (_parse_ts(m.get("created_at")) or today_start) >= today_start
            )
        except Exception:
            todays = 0
        if todays >= config.HUMAN_AGENT_REPLY_DAILY_CAP:
            return "reply_cap"

    # Spend one claimed call. 'turn' skips the Run cooldown only; per-agent
    # daily cap, global call cap and global token cap still apply.
    claim_res = db.rpc(
        "claim_agent_call",
        {
            "p_agent_id": responder_agent_id,
            "p_cooldown_seconds": config.AGENT_COOLDOWN_SECONDS,
            "p_agent_daily_cap": config.AGENT_DAILY_CAP,
            "p_global_daily_cap": config.GLOBAL_DAILY_CALL_CAP,
            "p_global_daily_token_cap": config.GLOBAL_DAILY_TOKEN_CAP,
            "p_kind": "turn",
        },
    ).execute()
    claim_rows = claim_res.data
    claim = claim_rows[0] if isinstance(claim_rows, list) and claim_rows else claim_rows
    if not isinstance(claim, dict) or not claim.get("ok"):
        reason = str((claim or {}).get("reason") or "claim_denied")
        _write_action_log(
            db,
            agent_id=responder_agent_id,
            action="turn",
            status="skipped",
            reason=reason,
            conversation_id=conversation_id,
        )
        return f"claim_denied:{reason}"

    ctx = _build_turn_context(db, conv, responder_agent_id, participants, messages)
    turn_messages = build_turn_messages(ctx)

    try:
        llm_result = await llm_caller(
            turn_messages, max_tokens=400, temperature=0.4, json_mode=True
        )
    except (LLMRateLimited, LLMUnavailable, LLMGenerationError) as exc:
        # Provider trouble degrades gracefully: no reply, lock released by caller.
        _write_action_log(
            db,
            agent_id=responder_agent_id,
            action="turn",
            status="error",
            reason="llm_unavailable",
            conversation_id=conversation_id,
            error=str(exc),
        )
        return "llm_unavailable"

    _add_tokens(db, llm_result.tokens_in + llm_result.tokens_out)

    # Parse the strict turn JSON; retry once inside the same claimed call.
    turn: TurnDecision | None = None
    last_error: Exception | None = None
    for attempt in (1, 2):
        try:
            turn = parse_turn(llm_result.text)
            break
        except InvalidModelOutput as exc:
            last_error = exc
            if attempt == 2:
                break
            try:
                llm_result = await llm_caller(
                    turn_messages
                    + [{"role": "user", "content": CORRECTION_PROMPT}],
                    max_tokens=400,
                    temperature=0.0,
                    json_mode=True,
                )
                _add_tokens(db, llm_result.tokens_in + llm_result.tokens_out)
            except (LLMRateLimited, LLMUnavailable, LLMGenerationError) as exc2:
                last_error = exc2
                break
        except DecisionRejected as exc:
            last_error = exc
            break

    if turn is None:
        _write_action_log(
            db,
            agent_id=responder_agent_id,
            action="turn",
            status="error",
            reason="invalid_model_output",
            conversation_id=conversation_id,
            model=llm_result.model,
            tokens_in=llm_result.tokens_in,
            tokens_out=llm_result.tokens_out,
            latency_ms=llm_result.latency_ms,
            error=str(last_error) if last_error else None,
        )
        return "invalid_model_output"

    # Human<->agent conversations never auto-end: an "end" becomes a reply
    # (its closing line if present), otherwise nothing happens.
    if kind == "human_agent" and turn.action == "end":
        if not turn.text:
            return "ignored_end"
        turn = TurnDecision(
            action="reply", text=turn.text, outcome=None, summary_for_owner=None
        )

    if turn.text:
        try:
            db.table("messages").insert(
                {
                    "conversation_id": conversation_id,
                    "sender_profile_id": None,
                    "sender_agent_id": responder_agent_id,
                    "kind": "message",
                    "body": turn.text,
                }
            ).execute()
        except Exception:
            logger.exception(
                "turn reply insert failed conversation=%s", conversation_id
            )
            return "insert_failed"

        new_count = int(conv.get("message_count") or 0) + 1
        db.table("conversations").update(
            {"message_count": new_count, "last_message_at": _iso(_now())}
        ).eq("id", conversation_id).execute()
        conv = {**conv, "message_count": new_count}
    else:
        new_count = int(conv.get("message_count") or 0)

    _write_action_log(
        db,
        agent_id=responder_agent_id,
        action="turn_end" if turn.action == "end" else "turn_reply",
        status="posted" if turn.text else "none",
        reason=(turn.outcome or turn.summary_for_owner or "turn"),
        conversation_id=conversation_id,
        model=llm_result.model,
        tokens_in=llm_result.tokens_in,
        tokens_out=llm_result.tokens_out,
        latency_ms=llm_result.latency_ms,
    )

    # Close on the model's "end" (agent_agent only) or at the cap.
    if kind == "agent_agent" and (
        turn.action == "end"
        or new_count >= int(conv.get("max_messages") or config.CONVERSATION_MAX_MESSAGES)
    ):
        _close_conversation(
            db,
            conv,
            participants,
            outcome=turn.outcome or "undecided",
            summary=turn.summary_for_owner,
        )
        return "closed"

    # Chain: the other agent's turn, after the delay. Scheduling, not recursion.
    if kind == "agent_agent":
        schedule_advance(conversation_id)

    return "replied"
