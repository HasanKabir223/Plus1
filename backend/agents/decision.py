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

REASON_MAX_CHARS = 200
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
class ValidatedDecision:
    action: str  # "post" | "reply" | "none"
    text: str | None
    reply_to_post_id: str | None
    reason: str
    like_post_ids: list[str] = field(default_factory=list)


def extract_like_ids(
    parsed: dict,
    *,
    eligible_like_ids: set[str],
    likes_today: int = 0,
    per_run_cap: int | None = None,
    daily_cap: int | None = None,
) -> list[str]:
    """Filter the model's like_post_ids down to what code allows.

    Never raises: a malformed value simply yields no likes. Order: keep
    first-seen eligible ids, drop duplicates, truncate to the per-run cap,
    then trim to the remaining daily-cap headroom.
    """
    if per_run_cap is None:
        per_run_cap = config.AGENT_LIKES_PER_RUN
    if daily_cap is None:
        daily_cap = config.AGENT_LIKE_DAILY_CAP

    raw = parsed.get("like_post_ids")
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
) -> ValidatedDecision:
    """Validate a parsed decision dict. Raises DecisionRejected/InvalidModelOutput."""
    if replies_enabled is None:
        replies_enabled = config.AGENT_REPLIES_ENABLED
    if max_chars is None:
        max_chars = config.AGENT_POST_MAX_CHARS
    if comment_max_chars is None:
        comment_max_chars = config.AGENT_COMMENT_MAX_CHARS

    like_ids = extract_like_ids(
        parsed,
        eligible_like_ids=eligible_like_ids or set(),
        likes_today=likes_today,
    )

    action = parsed.get("action")
    if action not in ("post", "reply", "none"):
        raise InvalidModelOutput(f"unknown action: {action!r}")

    reason = parsed.get("reason")
    reason = reason.strip() if isinstance(reason, str) else ""
    reason = reason[:REASON_MAX_CHARS] if reason else ("no reason given" if action == "none" else "decided")

    if action == "none":
        return ValidatedDecision(
            action="none", text=None, reply_to_post_id=None, reason=reason,
            like_post_ids=like_ids,
        )

    raw_text = parsed.get("text")
    if not isinstance(raw_text, str) or not raw_text.strip():
        raise InvalidModelOutput("post/reply decision has no text")
    text = _clean_text(raw_text)
    if not text:
        raise InvalidModelOutput("post/reply text is empty after cleaning")

    # Content filters: contacts, wrapper breakout, unapproved links.
    if _EMAIL_RE.search(text):
        raise DecisionRejected("rejected_by_filter")
    if _PHONE_RE.search(text):
        raise DecisionRejected("rejected_by_filter")
    if "<untrusted_data" in text:
        raise DecisionRejected("rejected_by_filter")
    if _URL_RE.search(text) and not skill_allows_links(skill_md):
        raise DecisionRejected("rejected_by_filter")

    text = _fit_length(text, comment_max_chars if action == "reply" else max_chars)

    if action == "post":
        return ValidatedDecision(
            action="post", text=text, reply_to_post_id=None, reason=reason,
            like_post_ids=like_ids,
        )

    # action == "reply"
    if not replies_enabled:
        raise DecisionRejected("replies_disabled")
    reply_to = parsed.get("reply_to_post_id")
    if not isinstance(reply_to, str) or reply_to not in eligible_ids:
        raise DecisionRejected("rejected_by_filter")
    return ValidatedDecision(
        action="reply", text=text, reply_to_post_id=reply_to, reason=reason,
        like_post_ids=like_ids,
    )
