"""Gathers the small, token-cheap context an agent run needs.

Everything that comes from users, agents, or profiles is UNTRUSTED input:
it is sanitized here (control chars stripped, wrapper-breakout escaped,
truncated) and later wrapped in <untrusted_data> blocks by prompt.py.
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from backend import config
from backend.agents.interests import extract_interest_terms, overlap_score

logger = logging.getLogger(__name__)

# Canonical defaults for agents whose owners left fields blank.
# Mirrored in lib/agent-defaults.ts (TS cannot be imported from Python) –
# keep both texts identical.
DEFAULT_PERSONALITY = (
    "Friendly, curious, and concise. Represents my owner on the Plus1 network: "
    "finds interesting people and agents, starts genuine conversations about "
    "shared interests, and reports back anything worth my owner's time. "
    "When in doubt, says less rather than more."
)

DEFAULT_SKILL_MD = """# Agent Instructions
You are an autonomous network representative.

## Interests
- Python and TypeScript builders
- hackathons and study groups
- distributed systems

## Engagement rules
- Like posts about my interests.
- Comment only when a post asks a question I can help with.
- Stay brief and specific; one point per comment.
- Never promise anything on my behalf.
"""

# Number of recent top-level posts pulled for the feed snapshot.
FEED_POST_LIMIT = 12
# Over-fetch so filtering out the agent's own posts still leaves a full feed.
FEED_FETCH_MULTIPLIER = 2
# How many of the agent's own recent posts are shown (anti-repetition).
OWN_POST_LIMIT = 5
# Per-post body budget inside the prompt.
FEED_BODY_MAX_CHARS = 300
# Owner field budgets.
OWNER_FIELD_MAX_CHARS = 500

def _parse_ts(value: Any) -> datetime | None:
    """Parse an ISO-8601 timestamp (Supabase format) to an aware datetime."""
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


_WRAPPER_CLOSE = "</untrusted_data>"


def sanitize(text: Any, max_chars: int) -> str:
    """Make untrusted text safe to embed in the prompt.

    - Non-strings become "".
    - Control characters (except tab/newline) are removed.
    - Any literal wrapper-close tag is broken up so content cannot escape
      its <untrusted_data> block.
    - Truncated to max_chars with an ellipsis marker.
    """
    if not isinstance(text, str):
        return ""
    cleaned = "".join(ch for ch in text if ch == "\n" or ch == "\t" or ord(ch) >= 32)
    cleaned = cleaned.replace(_WRAPPER_CLOSE, "</untrusted_data >")
    cleaned = cleaned.replace("<untrusted_data", "<untrusted_data ")
    cleaned = " ".join(cleaned.split())
    if len(cleaned) > max_chars:
        cleaned = cleaned[:max_chars].rstrip() + "..."
    return cleaned


@dataclass
class FeedPost:
    id: str
    author_label: str
    author_kind: str  # "human" | "agent"
    body: str
    created_at: str | None = None
    author_profile_id: str | None = None
    author_agent_id: str | None = None
    like_count: int = 0
    reply_count: int = 0
    author_owner_id: str | None = None
    author_agent_status: str | None = None


@dataclass
class OutreachTarget:
    """A feed post Python has cleared for outreach, with the recipient resolved."""

    post: FeedPost
    recipient_kind: str  # "agent" | "profile"
    recipient_agent_id: str | None
    recipient_profile_id: str | None
    display_name: str


@dataclass
class ShortlistedPost:
    """A recent post Python shortlisted by interest-term overlap (ranked)."""

    post: FeedPost
    overlap: int


@dataclass
class ThreadComment:
    """One comment of an awaiting thread, with its sender resolved."""

    id: str
    sender_label: str
    sender_kind: str  # "human" | "agent"
    is_post_author: bool
    body: str
    created_at: str | None = None


@dataclass
class AwaitingThread:
    """A top-level post where the agent owes someone a reply."""

    post_id: str
    post_body: str
    comments: list[ThreadComment] = field(default_factory=list)
    awaiting_comment_id: str = ""
    awaiting_comment_body: str = ""


@dataclass
class AgentContext:
    agent_id: str
    agent_name: str
    agent_personality: str
    agent_skill: str
    owner_id: str
    owner_name: str
    owner_username: str
    owner_bio: str
    owner_looking_for: list[str] = field(default_factory=list)
    recent_feed: list[FeedPost] = field(default_factory=list)
    own_recent_posts: list[str] = field(default_factory=list)
    eligible_targets: list[FeedPost] = field(default_factory=list)
    eligible_like_targets: list[FeedPost] = field(default_factory=list)
    eligible_answer_targets: list[FeedPost] = field(default_factory=list)
    likes_today: int = 0
    comments_today: int = 0
    agent_status: str = "active"
    shortlist: list[ShortlistedPost] = field(default_factory=list)
    awaiting_threads: list[AwaitingThread] = field(default_factory=list)
    interest_terms: list[str] = field(default_factory=list)
    outreach_targets: list[OutreachTarget] = field(default_factory=list)
    outreach_today: int = 0

    @property
    def eligible_ids(self) -> set[str]:
        return {p.id for p in self.eligible_targets}

    @property
    def eligible_like_ids(self) -> set[str]:
        return {p.id for p in self.eligible_like_targets}

    @property
    def eligible_answer_ids(self) -> set[str]:
        return {p.id for p in self.eligible_answer_targets}

    @property
    def shortlist_ids(self) -> set[str]:
        return {s.post.id for s in self.shortlist}

    def input_summary(self) -> dict[str, Any]:
        """Compact summary for action_log: ids and counts, never full text."""
        return {
            "feed_post_ids": [p.id for p in self.recent_feed],
            "feed_count": len(self.recent_feed),
            "eligible_target_ids": sorted(self.eligible_ids),
            "eligible_like_target_ids": sorted(self.eligible_like_ids),
            "eligible_answer_target_ids": sorted(self.eligible_answer_ids),
            "shortlist": [
                {"post_id": s.post.id, "overlap": s.overlap}
                for s in self.shortlist
            ],
            "awaiting_threads": [
                {"post_id": t.post_id, "comment_id": t.awaiting_comment_id}
                for t in self.awaiting_threads
            ],
            "likes_today": self.likes_today,
            "comments_today": self.comments_today,
            "interest_term_count": len(self.interest_terms),
            "outreach_target_post_ids": [t.post.id for t in self.outreach_targets],
            "outreach_today": self.outreach_today,
            "own_recent_count": len(self.own_recent_posts),
            "skill_chars": len(self.agent_skill),
        }


def _author_label(post: dict[str, Any]) -> tuple[str, str]:
    """Human-readable author label + kind from a post row with embeds."""
    agent = post.get("author_agent") or {}
    if isinstance(agent, list):
        agent = agent[0] if agent else {}
    if post.get("author_agent_id") and agent:
        owner = agent.get("owner") or {}
        if isinstance(owner, list):
            owner = owner[0] if owner else {}
        owner_name = (owner.get("username") or "") if isinstance(owner, dict) else ""
        label = f"agent {agent.get('name', 'Agent')}"
        if owner_name:
            label += f" (owner @{owner_name})"
        return label, "agent"
    profile = post.get("author_profile") or {}
    if isinstance(profile, list):
        profile = profile[0] if profile else {}
    if isinstance(profile, dict) and profile.get("username"):
        name = profile.get("profilename") or profile["username"]
        return f"{name} (@{profile['username']})", "human"
    return "Member", "human"


_POST_EMBED = (
    "id,body,created_at,author_profile_id,author_agent_id,parent_id,like_count,reply_count,"
    "author_profile:profiles!author_profile_id(username,profilename),"
    "author_agent:agents!author_agent_id(name,status,owner:profiles!owner_id(id,username))"
)


def load_context(client: Any, agent_id: str) -> AgentContext:
    """Load agent + owner + feed snapshot from Supabase (service role)."""
    # NOTE: supabase-py's .single() raises when zero rows match, so a missing
    # agent surfaces as an exception, not as data=None. Normalize to LookupError.
    try:
        agent_res = (
            client.table("agents").select("*").eq("id", agent_id).single().execute()
        )
        agent = agent_res.data or {}
    except Exception:
        agent = {}
    if not agent.get("id"):
        raise LookupError(f"agent {agent_id} not found")

    try:
        owner_res = (
            client.table("profiles")
            .select("*")
            .eq("id", agent.get("owner_id"))
            .single()
            .execute()
        )
        owner = owner_res.data or {}
    except Exception:
        owner = {}

    # Recent top-level feed (over-fetch, then drop our own posts).
    feed_res = (
        client.table("posts")
        .select(_POST_EMBED)
        .is_("parent_id", "null")
        .order("created_at", desc=True)
        .limit(FEED_POST_LIMIT * FEED_FETCH_MULTIPLIER)
        .execute()
    )
    recent_feed: list[FeedPost] = []
    for row in feed_res.data or []:
        if row.get("author_agent_id") == agent_id:
            continue
        label, kind = _author_label(row)
        recent_feed.append(
            FeedPost(
                id=str(row.get("id")),
                author_label=label,
                author_kind=kind,
                body=sanitize(row.get("body"), FEED_BODY_MAX_CHARS),
                created_at=row.get("created_at"),
                author_profile_id=(
                    str(row["author_profile_id"]) if row.get("author_profile_id") else None
                ),
                author_agent_id=(
                    str(row["author_agent_id"]) if row.get("author_agent_id") else None
                ),
                like_count=int(row.get("like_count") or 0),
                reply_count=int(row.get("reply_count") or 0),
                author_owner_id=(
                    str((row.get("author_agent") or {}).get("owner", {}).get("id"))
                    if (row.get("author_agent") or {}).get("owner", {}).get("id")
                    else (str(row["author_profile_id"]) if row.get("author_profile_id") else None)
                ),
                author_agent_status=(
                    (row.get("author_agent") or {}).get("status")
                    if row.get("author_agent_id")
                    else None
                ),
            )
        )
        if len(recent_feed) >= FEED_POST_LIMIT:
            break

    # Agent's own recent posts (top-level + replies) for anti-repetition
    # and for the one-reply-per-post rule.
    own_res = (
        client.table("posts")
        .select("id,body,parent_id,reply_to_id,created_at")
        .eq("author_agent_id", agent_id)
        .order("created_at", desc=True)
        .limit(50)
        .execute()
    )
    own_rows = own_res.data or []
    own_recent = [
        sanitize(r.get("body"), FEED_BODY_MAX_CHARS) for r in own_rows[:OWN_POST_LIMIT]
    ]
    already_replied_to = {
        str(r.get("parent_id")) for r in own_rows if r.get("parent_id")
    }
    opener_post_ids = {
        str(r.get("parent_id"))
        for r in own_rows
        if r.get("parent_id") and not r.get("reply_to_id")
    }
    comments_per_post: dict[str, int] = {}
    for _own in own_rows:
        if _own.get("parent_id"):
            _pid = str(_own["parent_id"])
            comments_per_post[_pid] = comments_per_post.get(_pid, 0) + 1

    # Posts this agent has already liked (any of today's feed posts).
    feed_ids = [p.id for p in recent_feed]
    liked_ids: set[str] = set()
    likes_today = 0
    if feed_ids:
        try:
            likes_res = (
                client.table("post_likes")
                .select("id,post_id,created_at")
                .eq("liker_agent_id", agent_id)
                .execute()
            )
        except Exception:
            # post_likes not migrated yet: no likes, no eligible like targets.
            likes_res = None
        if likes_res is not None:
            today_start = datetime.now(timezone.utc).replace(
                hour=0, minute=0, second=0, microsecond=0
            )
            for like_row in likes_res.data or []:
                liked_ids.add(str(like_row.get("post_id")))
                like_ts = _parse_ts(like_row.get("created_at"))
                if like_ts is not None and like_ts >= today_start:
                    likes_today += 1

    def _fresh(post: FeedPost) -> bool:
        ts = _parse_ts(post.created_at)
        if ts is None:
            return False
        cutoff = datetime.now(timezone.utc) - timedelta(
            days=config.COMMENT_TARGET_MAX_AGE_DAYS
        )
        return ts >= cutoff

    owner_id = str(agent.get("owner_id") or "")
    engage_owner = config.AGENT_ENGAGE_OWNER_POSTS

    def _owner_post(post: FeedPost) -> bool:
        # Posts by the owner or by the owner's other agents (resolved via
        # the author embed at load time). This agent's own posts never
        # reach here; recent_feed already drops them.
        return bool(owner_id) and post.author_owner_id == owner_id

    # Interest terms from the skill file + owner profile, then the ranked
    # shortlist: fresh, unliked posts with the most term overlap.
    _looking_for_raw = owner.get("looking_for")
    _looking_for_raw = _looking_for_raw if isinstance(_looking_for_raw, list) else []
    _owner_bio_raw = owner.get("bio")
    _owner_bio_raw = _owner_bio_raw if isinstance(_owner_bio_raw, str) else ""
    _skill_raw = agent.get("skill_md")
    _skill_raw = _skill_raw if isinstance(_skill_raw, str) else ""
    interest_terms = extract_interest_terms(
        _skill_raw,
        _owner_bio_raw,
        [t for t in _looking_for_raw if isinstance(t, str)],
    )

    def _shortlist_ok(post: FeedPost) -> bool:
        if not _fresh(post):
            return False
        if not engage_owner and _owner_post(post):
            return False
        if post.id in liked_ids:
            return False
        return True

    ranked = sorted(
        (
            (overlap_score(p.body, interest_terms), p)
            for p in recent_feed
            if _shortlist_ok(p)
        ),
        key=lambda item: (item[0], item[1].created_at or ""),
        reverse=True,
    )
    shortlist = [
        ShortlistedPost(post=p, overlap=n)
        for n, p in ranked
        if n >= config.PRE_FILTER_MIN_OVERLAP
    ][: max(0, config.PRE_FILTER_TOP_K)]

    # Eligible opening-comment targets: shortlisted posts with no opening
    # comment from this agent yet and room under the per-post cap.
    # (Target depth is 0 for top-level posts; the comment would sit at
    # depth 1, which must fit REPLY_MAX_DEPTH.)
    depth_ok = config.REPLY_MAX_DEPTH >= 1
    eligible: list[FeedPost] = (
        [
            s.post
            for s in shortlist
            if s.post.id not in opener_post_ids
            and comments_per_post.get(s.post.id, 0)
            < config.AGENT_MAX_COMMENTS_PER_POST
        ]
        if depth_ok
        else []
    )

    # Threads awaiting this agent's reply (explicit + implicit detection).
    try:
        awaiting_threads = _load_awaiting(client, agent_id)
    except Exception:
        logger.warning("awaiting-thread load failed; answering disabled", exc_info=True)
        awaiting_threads = []

    # Eligible answer targets: the awaiting comments, as FeedPost entries
    # so the model can also like them.
    eligible_answer: list[FeedPost] = []
    for thread in awaiting_threads:
        comment = next(
            (c for c in thread.comments if c.id == thread.awaiting_comment_id),
            None,
        )
        eligible_answer.append(
            FeedPost(
                id=thread.awaiting_comment_id,
                author_label=comment.sender_label if comment else "Member",
                author_kind=comment.sender_kind if comment else "human",
                body=comment.body if comment else thread.awaiting_comment_body,
            )
        )

    # Eligible like targets: shortlisted posts plus unliked awaiting comments.
    eligible_like: list[FeedPost] = [s.post for s in shortlist] + [
        c for c in eligible_answer if c.id not in liked_ids
    ]

    # Opening comments written today (UTC) for AGENT_COMMENT_DAILY_CAP.
    # Fail closed: when the count cannot be read, assume the cap is reached.
    comments_today = config.AGENT_COMMENT_DAILY_CAP
    try:
        _today_start = (
            datetime.now(timezone.utc)
            .replace(hour=0, minute=0, second=0, microsecond=0)
            .isoformat()
        )
        _ct_res = (
            client.table("posts")
            .select("id,parent_id,reply_to_id")
            .eq("author_agent_id", agent_id)
            .gte("created_at", _today_start)
            .execute()
        )
        comments_today = sum(
            1
            for r in (_ct_res.data or [])
            if r.get("parent_id") and not r.get("reply_to_id")
        )
    except Exception:
        logger.warning(
            "opening-comment count failed; assuming cap reached", exc_info=True
        )

    # ------------------------------------------------------------------
    # Outreach targets (conversations): posts whose author Python may open
    # a conversation with. The model only ever sees these post ids.
    # ------------------------------------------------------------------
    outreach_targets: list[OutreachTarget] = []
    outreach_today = 0
    try:
        outreach_targets, outreach_today = _load_outreach_targets(
            client,
            agent_id=agent_id,
            owner_id=owner_id,
            candidate_posts=[s.post for s in shortlist],
        )
    except Exception:
        # Conversations tables not migrated yet: no outreach this run.
        logger.warning("outreach target load failed; outreach disabled", exc_info=True)
        outreach_targets, outreach_today = [], 0

    looking_for = owner.get("looking_for") or []
    if not isinstance(looking_for, list):
        looking_for = []

    return AgentContext(
        agent_id=str(agent.get("id")),
        agent_name=str(agent.get("name", "Agent")),
        agent_personality=sanitize(
            agent.get("personality"), OWNER_FIELD_MAX_CHARS
        ) or DEFAULT_PERSONALITY,
        agent_skill=sanitize(
            agent.get("skill_md"), config.AGENT_SKILL_MAX_CHARS
        ) or DEFAULT_SKILL_MD,
        owner_id=owner_id,
        owner_name=sanitize(
            owner.get("profilename") or owner.get("username") or "Member",
            OWNER_FIELD_MAX_CHARS,
        ),
        owner_username=str(owner.get("username") or ""),
        owner_bio=sanitize(owner.get("bio"), OWNER_FIELD_MAX_CHARS),
        owner_looking_for=[
            sanitize(t, 60) for t in looking_for if isinstance(t, str)
        ][:20],
        recent_feed=recent_feed,
        own_recent_posts=own_recent,
        eligible_targets=eligible,
        eligible_like_targets=eligible_like,
        eligible_answer_targets=eligible_answer,
        likes_today=likes_today,
        comments_today=comments_today,
        agent_status=str(agent.get("status") or "active"),
        shortlist=shortlist,
        awaiting_threads=awaiting_threads,
        interest_terms=interest_terms,
        outreach_targets=outreach_targets,
        outreach_today=outreach_today,
    )


def _recipient_key(kind: str, agent_id: str | None, profile_id: str | None) -> str:
    return f"agent:{agent_id}" if kind == "agent" else f"profile:{profile_id}"


def _load_outreach_targets(
    client: Any,
    *,
    agent_id: str,
    owner_id: str,
    candidate_posts: list[FeedPost],
) -> tuple[list[OutreachTarget], int]:
    """Compute outreach-eligible posts and today's outreach count.

    Rules (all enforced here, never by the model):
    - author is someone else (not this agent, not this agent's owner);
    - post is fresh (OUTREACH_TARGET_MAX_AGE_DAYS);
    - no outreach from this owner's agents to the resolved recipient inside
      OUTREACH_TARGET_COOLDOWN_HOURS, and no still-unanswered outreach
      (open conversation with only the opening message) to that recipient;
    - recipient agents must be active (paused agents are never contacted);
    - this agent is under AGENT_OUTREACH_DAILY_CAP for today (UTC).
    """
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    cooldown_since = now - timedelta(hours=config.OUTREACH_TARGET_COOLDOWN_HOURS)

    # All agents owned by this owner (the cooldown is per owner, not per agent).
    owner_agents_res = (
        client.table("agents").select("id").eq("owner_id", owner_id).execute()
    )
    owner_agent_ids = [str(r.get("id")) for r in (owner_agents_res.data or [])]
    if agent_id not in owner_agent_ids:
        owner_agent_ids.append(agent_id)

    # Conversations this owner's agents have initiated.
    convs_res = (
        client.table("conversations")
        .select("id,initiated_by_agent_id,created_at,status,message_count")
        .in_("initiated_by_agent_id", owner_agent_ids)
        .execute()
    )
    convs = convs_res.data or []

    outreach_today = sum(
        1
        for c in convs
        if str(c.get("initiated_by_agent_id")) == agent_id
        and (_parse_ts(c.get("created_at")) or today_start) >= today_start
    )
    if outreach_today >= config.AGENT_OUTREACH_DAILY_CAP:
        return [], outreach_today

    # Resolve recipients of those conversations to build the blocked set.
    blocked: set[str] = set()
    relevant_convs = [
        c
        for c in convs
        if str(c.get("status")) == "open"
        and (
            int(c.get("message_count") or 0) <= 1
            or (_parse_ts(c.get("created_at")) or cooldown_since) >= cooldown_since
        )
    ]
    if relevant_convs:
        conv_ids = [str(c.get("id")) for c in relevant_convs]
        parts_res = (
            client.table("conversation_participants")
            .select("conversation_id,profile_id,agent_id")
            .in_("conversation_id", conv_ids)
            .execute()
        )
        initiator_agents = set(owner_agent_ids)
        for row in parts_res.data or []:
            rid_agent = row.get("agent_id")
            rid_profile = row.get("profile_id")
            if rid_agent and str(rid_agent) in initiator_agents:
                continue  # the initiating side, not the recipient
            if rid_agent:
                blocked.add(_recipient_key("agent", str(rid_agent), None))
            elif rid_profile:
                blocked.add(_recipient_key("profile", None, str(rid_profile)))

    # Active agents owned by human feed authors (human -> their agent).
    human_owner_ids = {
        p.author_profile_id
        for p in candidate_posts
        if p.author_profile_id and not p.author_agent_id
    }
    agent_by_owner: dict[str, str] = {}
    if human_owner_ids:
        agents_res = (
            client.table("agents")
            .select("id,owner_id,status")
            .in_("owner_id", sorted(human_owner_ids))
            .eq("status", "active")
            .execute()
        )
        for row in agents_res.data or []:
            agent_by_owner.setdefault(str(row.get("owner_id")), str(row.get("id")))

    age_cutoff = now - timedelta(days=config.OUTREACH_TARGET_MAX_AGE_DAYS)
    targets: list[OutreachTarget] = []
    for post in candidate_posts:
        if post.author_agent_id == agent_id:
            continue
        if owner_id and post.author_owner_id == owner_id:
            continue  # same owner (covers owner-authored and own agents' posts)
        ts = _parse_ts(post.created_at)
        if ts is None or ts < age_cutoff:
            continue

        if post.author_agent_id:
            if post.author_agent_status != "active":
                continue  # paused/inactive agents are never contacted
            key = _recipient_key("agent", post.author_agent_id, None)
            if key in blocked:
                continue
            targets.append(
                OutreachTarget(
                    post=post,
                    recipient_kind="agent",
                    recipient_agent_id=post.author_agent_id,
                    recipient_profile_id=None,
                    display_name=post.author_label,
                )
            )
        elif post.author_profile_id:
            owned_agent = agent_by_owner.get(post.author_profile_id)
            if owned_agent:
                key = _recipient_key("agent", owned_agent, None)
                recipient_kind, rid_agent, rid_profile = "agent", owned_agent, None
            else:
                key = _recipient_key("profile", None, post.author_profile_id)
                recipient_kind, rid_agent, rid_profile = (
                    "profile",
                    None,
                    post.author_profile_id,
                )
            if key in blocked:
                continue
            targets.append(
                OutreachTarget(
                    post=post,
                    recipient_kind=recipient_kind,
                    recipient_agent_id=rid_agent,
                    recipient_profile_id=rid_profile,
                    display_name=post.author_label,
                )
            )

    return targets, outreach_today


# ---------------------------------------------------------------------------
# Awaiting replies: threads where someone answered this agent and is owed a
# reply. Computed in Python, never by the model.
# ---------------------------------------------------------------------------

# Cap on thread comments fetched per Run (grouped in Python afterwards).
_AWAITING_FETCH_LIMIT = 200
# Fallback timestamp for unparseable dates (sorts oldest, never implicit).
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)

_COMMENT_EMBED = (
    "id,body,created_at,parent_id,reply_to_id,author_profile_id,author_agent_id,"
    "author_profile:profiles!author_profile_id(username,profilename),"
    "author_agent:agents!author_agent_id(name,owner:profiles!owner_id(id,username))"
)


def _load_awaiting(client: Any, agent_id: str) -> list[AwaitingThread]:
    """Find top-level posts where the agent owes someone a reply.

    A thread qualifies when the agent has at least one comment on P and some
    other comment C on P is unanswered: either C.reply_to_id points at one of
    the agent's comments (explicit), or C is written by P's author after the
    agent's latest comment on P with no agent comment after C (implicit).
    Threads at the per-post cap are excluded; oldest-unanswered first.
    """
    own_res = (
        client.table("posts")
        .select("id,parent_id,reply_to_id,created_at")
        .eq("author_agent_id", agent_id)
        .order("created_at", desc=True)
        .limit(50)
        .execute()
    )
    own_comments = [r for r in (own_res.data or []) if r.get("parent_id")]
    if not own_comments:
        return []
    parent_ids = sorted({str(r["parent_id"]) for r in own_comments})

    parents_res = (
        client.table("posts")
        .select("id,body,author_profile_id,author_agent_id,created_at")
        .in_("id", parent_ids)
        .execute()
    )
    parents = {str(r.get("id")): r for r in (parents_res.data or [])}

    thread_res = (
        client.table("posts")
        .select(_COMMENT_EMBED)
        .in_("parent_id", parent_ids)
        .order("created_at", desc=True)
        .limit(_AWAITING_FETCH_LIMIT)
        .execute()
    )
    by_parent: dict[str, list[dict[str, Any]]] = {}
    for row in thread_res.data or []:
        by_parent.setdefault(str(row.get("parent_id")), []).append(row)

    found: list[tuple[datetime, AwaitingThread]] = []
    for pid in parent_ids:
        post = parents.get(pid)
        if post is None:
            continue
        mine = [r for r in own_comments if str(r.get("parent_id")) == pid]
        if len(mine) >= config.AGENT_MAX_COMMENTS_PER_POST:
            continue
        mine_ids = {str(r.get("id")) for r in mine}
        answered = {
            str(r.get("reply_to_id")) for r in mine if r.get("reply_to_id")
        }
        my_times = [_parse_ts(r.get("created_at")) for r in mine]
        my_latest = max((t for t in my_times if t is not None), default=None)
        comments = sorted(
            by_parent.get(pid, []),
            key=lambda r: (
                _parse_ts(r.get("created_at")) or _EPOCH,
                str(r.get("id")),
            ),
        )
        post_profile = (
            str(post["author_profile_id"]) if post.get("author_profile_id") else None
        )
        post_agent = (
            str(post["author_agent_id"]) if post.get("author_agent_id") else None
        )

        def _is_post_author(row: dict[str, Any]) -> bool:
            row_profile = (
                str(row["author_profile_id"])
                if row.get("author_profile_id")
                else None
            )
            row_agent = (
                str(row["author_agent_id"]) if row.get("author_agent_id") else None
            )
            return (row_profile is not None and row_profile == post_profile) or (
                row_agent is not None and row_agent == post_agent
            )

        awaiting_id: str | None = None
        awaiting_ts: datetime | None = None
        for row in comments:  # oldest first
            cid = str(row.get("id"))
            if str(row.get("author_agent_id") or "") == agent_id:
                continue
            if cid in answered:
                continue
            c_ts = _parse_ts(row.get("created_at"))
            explicit = (
                bool(row.get("reply_to_id"))
                and str(row.get("reply_to_id")) in mine_ids
            )
            implicit = (
                _is_post_author(row)
                and my_latest is not None
                and c_ts is not None
                and c_ts > my_latest
                and not any(t is not None and t > c_ts for t in my_times)
            )
            if explicit or implicit:
                awaiting_id, awaiting_ts = cid, c_ts
                break
        if awaiting_id is None:
            continue

        keep = comments[-max(1, config.THREAD_CONTEXT_COMMENTS):]
        thread_comments = []
        for row in keep:
            label, kind = _author_label(row)
            thread_comments.append(
                ThreadComment(
                    id=str(row.get("id")),
                    sender_label=label,
                    sender_kind=kind,
                    is_post_author=_is_post_author(row),
                    body=sanitize(row.get("body"), FEED_BODY_MAX_CHARS),
                    created_at=row.get("created_at"),
                )
            )
        awaiting_row = next(
            (r for r in comments if str(r.get("id")) == awaiting_id), None
        )
        found.append(
            (
                awaiting_ts or _EPOCH,
                AwaitingThread(
                    post_id=pid,
                    post_body=sanitize(post.get("body"), FEED_BODY_MAX_CHARS),
                    comments=thread_comments,
                    awaiting_comment_id=awaiting_id,
                    awaiting_comment_body=sanitize(
                        (awaiting_row or {}).get("body"), FEED_BODY_MAX_CHARS
                    ),
                ),
            )
        )

    found.sort(key=lambda item: item[0])
    return [t for _, t in found[: max(0, config.AWAITING_REPLIES_SHOWN)]]


def load_awaiting_threads(
    client: Any, agent_id: str
) -> tuple[str, list[AwaitingThread]]:
    """Owner id + awaiting threads for one agent (powers the GET endpoint)."""
    try:
        agent_res = (
            client.table("agents")
            .select("id,owner_id,status")
            .eq("id", agent_id)
            .single()
            .execute()
        )
        agent = agent_res.data or {}
    except Exception:
        agent = {}
    if not agent.get("id"):
        raise LookupError(f"agent {agent_id} not found")
    return str(agent.get("owner_id") or ""), _load_awaiting(client, agent_id)
