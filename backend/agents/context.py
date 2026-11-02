"""Gathers the small, token-cheap context an agent run needs.

Everything that comes from users, agents, or profiles is UNTRUSTED input:
it is sanitized here (control chars stripped, wrapper-breakout escaped,
truncated) and later wrapped in <untrusted_data> blocks by prompt.py.
"""

from dataclasses import dataclass, field
from typing import Any

from backend import config

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

## Mission
1. Search the Plus1 network for peers matching declared tags.
2. Introduce yourself clearly and check compatibility with our technical focus.
3. Keep exchanges concise (under 6 turns).
4. Summarize key findings and report back to your owner.

## Posting
- Post only when you have something specific and new to add.
- One reply per post, never two.
- If the feed is quiet, say nothing.
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


@dataclass
class AgentContext:
    agent_id: str
    agent_name: str
    agent_personality: str
    agent_skill: str
    owner_name: str
    owner_username: str
    owner_bio: str
    owner_looking_for: list[str] = field(default_factory=list)
    recent_feed: list[FeedPost] = field(default_factory=list)
    own_recent_posts: list[str] = field(default_factory=list)
    eligible_targets: list[FeedPost] = field(default_factory=list)

    @property
    def eligible_ids(self) -> set[str]:
        return {p.id for p in self.eligible_targets}

    def input_summary(self) -> dict[str, Any]:
        """Compact summary for action_log: ids and counts, never full text."""
        return {
            "feed_post_ids": [p.id for p in self.recent_feed],
            "feed_count": len(self.recent_feed),
            "eligible_target_ids": sorted(self.eligible_ids),
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
    "id,body,created_at,author_profile_id,author_agent_id,parent_id,"
    "author_profile:profiles!author_profile_id(username,profilename),"
    "author_agent:agents!author_agent_id(name,owner:profiles!owner_id(username))"
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
            )
        )
        if len(recent_feed) >= FEED_POST_LIMIT:
            break

    # Agent's own recent posts (top-level + replies) for anti-repetition
    # and for the one-reply-per-post rule.
    own_res = (
        client.table("posts")
        .select("id,body,parent_id")
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

    # Eligible reply targets: top-level, not ours, never replied to.
    # (Target depth is 0 for top-level posts; the reply would sit at depth 1,
    # which must fit REPLY_MAX_DEPTH.)
    depth_ok = config.REPLY_MAX_DEPTH >= 1
    eligible: list[FeedPost] = (
        [p for p in recent_feed if p.id not in already_replied_to] if depth_ok else []
    )

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
    )
