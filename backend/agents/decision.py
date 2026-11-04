"""Parsing and validation for model decisions. Never trusts the model.

Pipeline: raw text -> parse_decision() -> validate_decision().
- parse_decision() extracts a JSON object defensively (code fences, extra
  prose tolerated). Raises InvalidModelOutput if no valid object is found.
- validate_decision() enforces every rule in code: action vocabulary, text
  cleaning + length, contact/URL filters, reply-target eligibility, and the
  AGENT_REPLIES_ENABLED flag. Filter rejections raise DecisionRejected,
  which the runner turns into a logged "none" outcome (post nothing).
"""

import json
import re
from dataclasses import dataclass, field

from backend import config

REASON_MAX_CHARS = 120
# Texts at most this far over the limit may be trimmed at a word boundary.
TRIM_SLACK_CHARS = 20

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
# Conservative phone pattern: 7+ digits possibly separated by spaces/dashes.
_PHONE_RE = re.compile(r"\+?[\d][\d\s().-]{6,}[\d]")
_URL_RE = re.compile(r"https?://|www\.", re.IGNORECASE)
# Phrases in the owner's skill that explicitly permit links in posts --
# and phrases that forbid them. Fail closed: a prohibition anywhere in the
# skill wins over a permission, and silence means "no links".
_LINKS_PROHIBITED_RE = re.compile(
    r"\b(never|no|not|don't|dont|do not|cannot|can't|without|avoid|forbid\w*|ban\w*)\b.{0,25}?\blinks?\b",
    re.IGNORECASE,
)
_LINKS_ALLOWED_RE = re.compile(
    r"\ballow\w*\b.{0,30}?\blinks?\b"
    r"|\blinks?\b.{0,30}?\ballowed\b"
    r"|\b(include|includes|share|sharing|embed|post)\b.{0,20}?\blinks?\b",
    re.IGNORECASE,
)


class InvalidModelOutput(Exception):
    """The model did not return a usable JSON decision object."""


class DecisionRejected(Exception):
    """A validation rule rejected the decision. Carries the owner's reason."""

    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


@dataclass
class ModelScore:
    """The model's 0-10 relevance score for one Python-provided id."""

    score: int
    needs_interaction: bool = False


@dataclass
class ValidatedDecision:
    action: str  # "post" | "comment" | "answer" | "message" | "none"
    text: str | None
    target_post_id: str | None
    reason: str
    like_post_ids: list[str] = field(default_factory=list)
    answer_to_comment_id: str | None = None
    scores: dict[str, ModelScore] = field(default_factory=dict)


def parse_scores(parsed: dict, *, known_ids: set[str]) -> dict[str, ModelScore]:
    """The model's per-id scores, filtered to ids Python provided.

    Never raises: malformed entries are dropped. Scores outside 0-10 and
    ids outside the provided lists never survive.
    """
    raw = parsed.get("scores")
    if not isinstance(raw, list):
        return {}
    out: dict[str, ModelScore] = {}
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        sid = entry.get("id")
        score = entry.get("score")
        if not isinstance(sid, str) or sid not in known_ids:
            continue
        if isinstance(score, bool) or not isinstance(score, (int, float)):
            continue
        score = int(score)
        if score < 0 or score > 10 or sid in out:
            continue
        out[sid] = ModelScore(
            score=score, needs_interaction=entry.get("needs_interaction") is True
        )
    return out


def extract_like_ids(
    parsed: dict,
    *,
    eligible_like_ids: set[str],
    scores: dict[str, ModelScore] | None = None,
    likes_today: int = 0,
    per_run_cap: int | None = None,
    daily_cap: int | None = None,
    min_score: int | None = None,
) -> list[str]:
    """Filter the model's like ids down to what code allows.

    Never raises: a malformed value simply yields no likes. An id survives
    only when eligible AND scored at or above the like threshold (unscored
    ids count as 0). Order: keep first-seen survivors, drop duplicates,
    truncate to the per-run cap, then trim to daily-cap headroom.
    """
    if per_run_cap is None:
        per_run_cap = config.AGENT_LIKES_PER_RUN
    if daily_cap is None:
        daily_cap = config.AGENT_LIKE_DAILY_CAP
    if min_score is None:
        min_score = config.LIKE_MIN_SCORE
    scores = scores or {}

    raw = parsed.get("like_ids")
    if raw is None:
        raw = parsed.get("like_post_ids")  # backward-compat alias
    if not isinstance(raw, list):
        return []

    seen: set[str] = set()
    kept: list[str] = []
    for item in raw:
        if not isinstance(item, str):
            continue
        if item in seen or item not in eligible_like_ids:
            continue
        seen.add(item)
        entry = scores.get(item)
        if entry is None or entry.score < min_score:
            continue
        kept.append(item)

    kept = kept[: max(0, int(per_run_cap))]
    headroom = max(0, int(daily_cap) - max(0, int(likes_today)))
    return kept[:headroom]


def skill_allows_links(skill_md: str | None) -> bool:
    """True only if the owner's skill explicitly asks for links."""
    if not skill_md:
        return False
    if _LINKS_PROHIBITED_RE.search(skill_md):
        return False
    return bool(_LINKS_ALLOWED_RE.search(skill_md))


def parse_decision(raw_text: str | None) -> dict:
    """Extract the JSON decision object from messy model output.

    Strips markdown code fences, then decodes the span from the first '{'
    to the last '}'. Raises InvalidModelOutput on any failure.
    """
    if not raw_text or not raw_text.strip():
        raise InvalidModelOutput("empty model output")

    text = raw_text.strip()
    # Strip one layer of ``` fences (```json ... ``` or ``` ... ```).
    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, re.DOTALL | re.IGNORECASE)
    if fence:
        text = fence.group(1).strip()

    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise InvalidModelOutput("no JSON object found in model output")

    try:
        parsed = json.loads(text[start : end + 1])
    except json.JSONDecodeError as exc:
        raise InvalidModelOutput(f"invalid JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise InvalidModelOutput("decision JSON is not an object")
    return parsed


def _clean_text(text: str) -> str:
    """Trim, strip markdown artifacts and surrounding quotes, collapse space."""
    cleaned = text.strip()
    # Strip one layer of code fences or quotes wrapping the whole text.
    fence = re.match(r"^```(?:\w+)?\s*(.*?)\s*```$", cleaned, re.DOTALL)
    if fence:
        cleaned = fence.group(1).strip()
    if len(cleaned) >= 2 and cleaned[0] == cleaned[-1] and cleaned[0] in ("\"", "'", "\u201c", "\u201d"):
        cleaned = cleaned[1:-1].strip()
    # Strip inline markdown artifacts (bold/italic/code markers, headings).
    cleaned = re.sub(r"(\*\*|__)(.*?)\1", r"\2", cleaned)
    cleaned = cleaned.replace("**", "").replace("__", "")
    cleaned = re.sub(r"^#{1,6}\s+", "", cleaned, flags=re.MULTILINE)
    cleaned = cleaned.replace("`", "")
    # Collapse all whitespace runs to single spaces (posts stay one line).
    cleaned = " ".join(cleaned.split())
    return cleaned


def _fit_length(text: str, max_chars: int) -> str:
    """Enforce the hard length limit.

    Fits as-is when within the limit. When slightly over (<= slack), cuts at
    the last word boundary inside the limit and, only if clean, drops a
    trailing sentence fragment at its final [.?!]. Otherwise raises.
    """
    if len(text) <= max_chars:
        return text
    if len(text) > max_chars + TRIM_SLACK_CHARS:
        raise DecisionRejected("rejected_by_filter")
    cut = text[:max_chars]
    space = cut.rfind(" ")
    if space <= 0:
        raise DecisionRejected("rejected_by_filter")
    cut = cut[:space].rstrip()
    # Drop an incomplete trailing sentence only when it is clean to do so:
    # keep the cut if it already ends with terminal punctuation, else fall
    # back to the last complete sentence when that keeps most of the text.
    if cut and cut[-1] not in ".?!":
        last_stop = max(cut.rfind(". "), cut.rfind("? "), cut.rfind("! "))
        if last_stop > len(cut) // 2:
            cut = cut[: last_stop + 1]
        else:
            raise DecisionRejected("rejected_by_filter")
    return cut


_PROMISE_RE = re.compile(
    r"\b(will reach out|will contact|will introduce|intro you|connect you|"
    r"set up a (call|meeting|intro)|i'll introduce)\b",
    re.IGNORECASE,
)
_MONEY_RE = re.compile(
    r"(\$\s?\d|\b(payment|pay|price|pricing|cost|fee|salary|budget of|per hour)\b)",
    re.IGNORECASE,
)
_INTRO_RE = re.compile(
    r"^\s*(hi|hello|hey)\b.{0,60}\b(i'?m|i am)\b.{0,60}\bagent\b",
    re.IGNORECASE,
)


def validate_message_text(text: str, *, max_chars: int) -> str:
    """Validate an agent-authored conversation message body.

    Raises DecisionRejected('rejected_by_filter') on any violation: over the
    length limit (with the usual trim slack), contacts, URLs, wrapper
    breakout, promises, money talk, or a self-introduction (Python writes the
    introduction line itself).
    """
    cleaned = _clean_text(text)
    if not cleaned:
        raise DecisionRejected("rejected_by_filter")
    if _EMAIL_RE.search(cleaned):
        raise DecisionRejected("rejected_by_filter")
    if _PHONE_RE.search(cleaned):
        raise DecisionRejected("rejected_by_filter")
    if _URL_RE.search(cleaned):
        raise DecisionRejected("rejected_by_filter")
    if "<untrusted_data" in cleaned:
        raise DecisionRejected("rejected_by_filter")
    if _PROMISE_RE.search(cleaned):
        raise DecisionRejected("rejected_by_filter")
    if _MONEY_RE.search(cleaned):
        raise DecisionRejected("rejected_by_filter")
    if _INTRO_RE.search(cleaned):
        raise DecisionRejected("rejected_by_filter")
    return _fit_length(cleaned, max_chars)


_THANKS_RE = re.compile(
    r"^(thanks?|thank you|thx|ok(ay)?|agreed?|yes|yeah|yep)\s*[!.]*$",
    re.IGNORECASE,
)


def looks_like_thanks(body: str | None) -> bool:
    """A short thanks/ok/agreement note that deserves no text answer.

    True only when the trimmed body is under 15 characters and matches the
    thanks pattern. The runner converts such answers into a like or none.
    """
    if not isinstance(body, str):
        return False
    text = " ".join(body.strip().split())
    return len(text) < 15 and bool(_THANKS_RE.match(text))


def validate_decision(
    parsed: dict,
    *,
    eligible_ids: set[str],
    skill_md: str | None = None,
    replies_enabled: bool | None = None,
    max_chars: int | None = None,
    eligible_like_ids: set[str] | None = None,
    likes_today: int = 0,
    comment_max_chars: int | None = None,
    eligible_outreach_ids: set[str] | None = None,
    eligible_answer_ids: set[str] | None = None,
    like_min_score: int | None = None,
    comment_min_score: int | None = None,
) -> ValidatedDecision:
    """Validate a parsed decision dict. Raises DecisionRejected/InvalidModelOutput.

    Old field names stay accepted ("reply" -> "comment", reply_to_post_id ->
    target_post_id, like_post_ids -> like_ids); the prompt uses the new ones.
    DB-backed gates (already-commented, daily caps, parent equality) live in
    the runner's re-checks; everything checkable here is enforced here.
    """
    if replies_enabled is None:
        replies_enabled = config.AGENT_REPLIES_ENABLED
    if max_chars is None:
        max_chars = config.AGENT_POST_MAX_CHARS
    if comment_max_chars is None:
        comment_max_chars = config.AGENT_COMMENT_MAX_CHARS
    if like_min_score is None:
        like_min_score = config.LIKE_MIN_SCORE
    if comment_min_score is None:
        comment_min_score = config.COMMENT_MIN_SCORE
    eligible_like_ids = eligible_like_ids or set()
    eligible_answer_ids = eligible_answer_ids or set()

    known_ids = (
        set(eligible_ids)
        | eligible_like_ids
        | eligible_answer_ids
        | set(eligible_outreach_ids or set())
    )
    scores = parse_scores(parsed, known_ids=known_ids)
    like_ids = extract_like_ids(
        parsed,
        eligible_like_ids=eligible_like_ids,
        scores=scores,
        likes_today=likes_today,
        min_score=like_min_score,
    )

    action = parsed.get("action")
    if action == "reply":  # backward-compat alias for "comment"
        action = "comment"
    if action is None:
        # Models sometimes emit "action": null to mean "do nothing";
        # treat it as "none" (likes still apply) instead of an error.
        action = "none"
    if action not in ("post", "comment", "answer", "message", "none"):
        raise InvalidModelOutput(f"unknown action: {action!r}")

    reason = parsed.get("reason")
    reason = reason.strip() if isinstance(reason, str) else ""
    reason = reason[:REASON_MAX_CHARS] if reason else ("no reason given" if action == "none" else "decided")

    if action == "none":
        return ValidatedDecision(
            action="none", text=None, target_post_id=None, reason=reason,
            like_post_ids=like_ids, scores=scores,
        )

    raw_text = parsed.get("text")
    if not isinstance(raw_text, str) or not raw_text.strip():
        raise InvalidModelOutput("post/comment/answer decision has no text")
    text = _clean_text(raw_text)
    if not text:
        raise InvalidModelOutput("post/comment/answer text is empty after cleaning")

    # Content filters: contacts, wrapper breakout, links. Comments and
    # answers never allow links; top-level posts keep the skill opt-in.
    if _EMAIL_RE.search(text):
        raise DecisionRejected("rejected_by_filter")
    if _PHONE_RE.search(text):
        raise DecisionRejected("rejected_by_filter")
    if "<untrusted_data" in text:
        raise DecisionRejected("rejected_by_filter")
    if _URL_RE.search(text) and (
        action in ("comment", "answer") or not skill_allows_links(skill_md)
    ):
        raise DecisionRejected("rejected_by_filter")

    if action == "message":
        target = parsed.get("target_post_id")
        if not isinstance(target, str) or target not in (eligible_outreach_ids or set()):
            raise DecisionRejected("rejected_by_filter")
        text = validate_message_text(text, max_chars=config.MESSAGE_MODEL_MAX_CHARS)
        return ValidatedDecision(
            action="message", text=text, target_post_id=target, reason=reason,
            like_post_ids=like_ids, scores=scores,
        )

    if action == "post":
        text = _fit_length(text, max_chars)
        return ValidatedDecision(
            action="post", text=text, target_post_id=None, reason=reason,
            like_post_ids=like_ids, scores=scores,
        )

    target = parsed.get("target_post_id")
    if target is None:
        target = parsed.get("reply_to_post_id")  # backward-compat alias

    if action == "comment":
        # Opening comment, last resort: shortlisted target, high score,
        # explicit interaction need. Anything short becomes a quiet none.
        if not replies_enabled:
            raise DecisionRejected("replies_disabled")
        if not isinstance(target, str) or target not in eligible_ids:
            raise DecisionRejected("below_threshold")
        entry = scores.get(target)
        if (
            entry is None
            or entry.score < comment_min_score
            or not entry.needs_interaction
        ):
            raise DecisionRejected("below_threshold")
        text = _fit_length(text, comment_max_chars)
        return ValidatedDecision(
            action="comment", text=text, target_post_id=target, reason=reason,
            like_post_ids=like_ids, scores=scores,
        )

    # action == "answer": the target comment must be one Python provided.
    # Parent equality and the thanks-pattern conversion happen in the
    # runner, which holds the thread rows.
    if not replies_enabled:
        raise DecisionRejected("replies_disabled")
    answer_to = parsed.get("answer_to_comment_id")
    if not isinstance(answer_to, str) or answer_to not in eligible_answer_ids:
        raise DecisionRejected("rejected_by_filter")
    if not isinstance(target, str):
        raise DecisionRejected("rejected_by_filter")
    text = _fit_length(text, comment_max_chars)
    return ValidatedDecision(
        action="answer", text=text, target_post_id=target, reason=reason,
        like_post_ids=like_ids, answer_to_comment_id=answer_to, scores=scores,
    )


# ---------------------------------------------------------------------------
# Conversation turns: {"action": "reply"|"end", ...} from the turn engine.
# ---------------------------------------------------------------------------

_TURN_OUTCOMES = ("interested", "not_a_fit", "undecided")


@dataclass
class TurnDecision:
    action: str  # "reply" | "end"
    text: str | None
    outcome: str | None
    summary_for_owner: str | None


def parse_turn(raw_text: str | None) -> TurnDecision:
    """Parse + validate one conversation-turn model output.

    Strict: unknown actions/outcomes and bad summaries raise
    InvalidModelOutput; bad message text raises DecisionRejected. The turn
    engine retries once on InvalidModelOutput within the same claimed call.
    """
    payload = parse_decision(raw_text)
    action = payload.get("action")
    if action not in ("reply", "end"):
        raise InvalidModelOutput(f"unknown turn action: {action!r}")

    outcome = payload.get("outcome")
    if outcome is not None and outcome not in _TURN_OUTCOMES:
        raise InvalidModelOutput(f"unknown turn outcome: {outcome!r}")

    summary = payload.get("summary_for_owner")
    if summary is not None:
        if not isinstance(summary, str):
            raise InvalidModelOutput("summary_for_owner is not a string")
        summary = summary.strip()[:200] or None

    raw_text_value = payload.get("text")
    text: str | None = None
    if isinstance(raw_text_value, str) and raw_text_value.strip():
        text = validate_message_text(
            raw_text_value, max_chars=config.MESSAGE_MAX_CHARS
        )

    if action == "reply" and text is None:
        raise InvalidModelOutput("reply turn has no text")
    if action == "end":
        if outcome is None:
            raise InvalidModelOutput("end turn has no outcome")
        if summary is None:
            raise InvalidModelOutput("end turn has no summary_for_owner")

    return TurnDecision(
        action=action, text=text, outcome=outcome, summary_for_owner=summary
    )
