"""Awaiting-thread detection and interest shortlist (context.load_context).

Uses the shared FakeClient from test_runner; the default fixture agent has
skill "Find teammates." and the owner likes "teammates", so bodies mentioning
teammates overlap and anything else does not.
"""

import pytest

from backend import config
from backend.agents.context import load_awaiting_threads, load_context
from backend.tests.test_runner import (
    AGENT_ID,
    OWNER_ID,
    TARGET_ID,
    FakeClient,
    _recent_iso,
)

SAM_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd"
RINA_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"
POST2_ID = "dddddddd-0000-1111-2222-333333333333"


def _comment(
    cid,
    parent,
    *,
    author_profile=None,
    author_agent=None,
    reply_to=None,
    body="hello there",
    hours=1,
    username="sam",
):
    row = {
        "id": cid,
        "body": body,
        "parent_id": parent,
        "reply_to_id": reply_to,
        "author_profile_id": author_profile,
        "author_agent_id": author_agent,
        "created_at": _recent_iso(hours),
    }
    if author_agent:
        row["author_profile"] = None
        row["author_agent"] = {
            "name": "Scout",
            "status": "active",
            "owner": {"id": OWNER_ID, "username": "alex"},
        }
    else:
        row["author_profile"] = {"username": username, "profilename": username}
        row["author_agent"] = None
    return row


def _agent_opener(db, cid="opener-1", parent=TARGET_ID, hours=3):
    db.posts.append(
        _comment(cid, parent, author_agent=AGENT_ID, body="my opener", hours=hours)
    )


def _top_post(pid, body, author_profile=SAM_ID, hours=1):
    return {
        "id": pid,
        "body": body,
        "parent_id": None,
        "author_agent_id": None,
        "author_profile_id": author_profile,
        "created_at": _recent_iso(hours),
        "author_profile": {"username": "u", "profilename": "U"},
        "author_agent": None,
    }


# --- awaiting detection ------------------------------------------------------


def test_explicit_reply_detected():
    db = FakeClient()
    _agent_opener(db)
    db.posts.append(
        _comment(
            "reply-1",
            TARGET_ID,
            author_profile=SAM_ID,
            reply_to="opener-1",
            body="what stack do you use?",
            hours=1,
        )
    )
    ctx = load_context(db, AGENT_ID)
    assert len(ctx.awaiting_threads) == 1
    thread = ctx.awaiting_threads[0]
    assert thread.post_id == TARGET_ID
    assert thread.awaiting_comment_id == "reply-1"
    assert "what stack" in thread.awaiting_comment_body
    assert ctx.eligible_answer_ids == {"reply-1"}
    assert "reply-1" in ctx.eligible_like_ids  # awaiting comments are likeable


def test_implicit_author_reply_detected():
    db = FakeClient()
    _agent_opener(db, hours=3)
    # TARGET's author (Sam) writes a plain comment after the opener.
    db.posts.append(
        _comment(
            "plain-1",
            TARGET_ID,
            author_profile=SAM_ID,
            body="we use Next.js here",
            hours=1,
        )
    )
    ctx = load_context(db, AGENT_ID)
    assert [t.awaiting_comment_id for t in ctx.awaiting_threads] == ["plain-1"]


def test_non_author_comment_without_reply_to_is_not_awaiting():
    db = FakeClient()
    _agent_opener(db, hours=3)
    db.posts.append(
        _comment(
            "stranger-1",
            TARGET_ID,
            author_profile=RINA_ID,
            username="rina",
            body="nice thread",
            hours=1,
        )
    )
    ctx = load_context(db, AGENT_ID)
    assert ctx.awaiting_threads == []
    assert ctx.eligible_answer_ids == set()


def test_already_answered_excluded():
    db = FakeClient()
    _agent_opener(db, hours=4)
    db.posts.append(
        _comment(
            "reply-1",
            TARGET_ID,
            author_profile=SAM_ID,
            reply_to="opener-1",
            hours=3,
        )
    )
    db.posts.append(
        _comment(
            "answer-1",
            TARGET_ID,
            author_agent=AGENT_ID,
            reply_to="reply-1",
            body="we use Next.js",
            hours=2,
        )
    )
    ctx = load_context(db, AGENT_ID)
    assert ctx.awaiting_threads == []


def test_agent_own_comments_never_awaiting():
    db = FakeClient()
    _agent_opener(db)
    ctx = load_context(db, AGENT_ID)
    assert ctx.awaiting_threads == []


def test_reply_before_opener_is_not_implicit():
    db = FakeClient()
    db.posts.append(
        _comment("early-1", TARGET_ID, author_profile=SAM_ID, hours=4)
    )
    _agent_opener(db, hours=1)
    ctx = load_context(db, AGENT_ID)
    assert ctx.awaiting_threads == []


def test_cap_excluded(monkeypatch):
    monkeypatch.setattr(config, "AGENT_MAX_COMMENTS_PER_POST", 2)
    db = FakeClient()
    _agent_opener(db, cid="opener-1", hours=5)
    db.posts.append(
        _comment("opener-2", TARGET_ID, author_agent=AGENT_ID, hours=4)
    )
    db.posts.append(
        _comment(
            "reply-1",
            TARGET_ID,
            author_profile=SAM_ID,
            reply_to="opener-2",
            hours=1,
        )
    )
    ctx = load_context(db, AGENT_ID)
    assert ctx.awaiting_threads == []


def test_ordering_oldest_first_and_limit(monkeypatch):
    db = FakeClient()
    db.posts.append(_top_post(POST2_ID, "teammates wanted", hours=6))
    _agent_opener(db, cid="opener-a", parent=TARGET_ID, hours=5)
    _agent_opener(db, cid="opener-b", parent=POST2_ID, hours=4)
    db.posts.append(
        _comment(
            "reply-new",
            TARGET_ID,
            author_profile=SAM_ID,
            reply_to="opener-a",
            hours=1,
        )
    )
    db.posts.append(
        _comment(
            "reply-old",
            POST2_ID,
            author_profile=SAM_ID,
            reply_to="opener-b",
            hours=3,
        )
    )
    ctx = load_context(db, AGENT_ID)
    assert [t.awaiting_comment_id for t in ctx.awaiting_threads] == [
        "reply-old",
        "reply-new",
    ]
    monkeypatch.setattr(config, "AWAITING_REPLIES_SHOWN", 1)
    ctx = load_context(db, AGENT_ID)
    assert [t.awaiting_comment_id for t in ctx.awaiting_threads] == ["reply-old"]


def test_thread_context_limit_keeps_awaiting(monkeypatch):
    monkeypatch.setattr(config, "THREAD_CONTEXT_COMMENTS", 2)
    db = FakeClient()
    _agent_opener(db, hours=6)
    for i in range(4):
        db.posts.append(
            _comment(
                f"c{i}",
                TARGET_ID,
                author_profile=RINA_ID,
                username="rina",
                body=f"note {i}",
                hours=5 - i,
            )
        )
    db.posts.append(
        _comment(
            "reply-1",
            TARGET_ID,
            author_profile=SAM_ID,
            reply_to="opener-1",
            hours=1,
        )
    )
    ctx = load_context(db, AGENT_ID)
    (thread,) = ctx.awaiting_threads
    assert len(thread.comments) == 2
    assert "reply-1" in {c.id for c in thread.comments}


def test_load_awaiting_threads_wrapper_and_missing_agent():
    db = FakeClient()
    _agent_opener(db)
    db.posts.append(
        _comment(
            "reply-1",
            TARGET_ID,
            author_profile=SAM_ID,
            reply_to="opener-1",
        )
    )
    owner_id, threads = load_awaiting_threads(db, AGENT_ID)
    assert owner_id == OWNER_ID
    assert [t.awaiting_comment_id for t in threads] == ["reply-1"]
    with pytest.raises(LookupError):
        load_awaiting_threads(db, "no-such-agent")


# --- shortlist ---------------------------------------------------------------


def test_shortlist_ranks_by_overlap_and_top_k(monkeypatch):
    monkeypatch.setattr(config, "PRE_FILTER_TOP_K", 2)
    db = FakeClient()
    db.posts.append(_top_post("p-high", "teammates find builds", hours=3))
    db.posts.append(_top_post("p-low", "teammates", hours=4))
    ctx = load_context(db, AGENT_ID)
    assert [(s.post.id, s.overlap) for s in ctx.shortlist] == [
        ("p-high", 3),
        (TARGET_ID, 1),
    ]


def test_shortlist_min_overlap_filters(monkeypatch):
    monkeypatch.setattr(config, "PRE_FILTER_MIN_OVERLAP", 2)
    db = FakeClient()
    ctx = load_context(db, AGENT_ID)
    assert ctx.shortlist == []  # TARGET overlaps on "teammates" only


def test_shortlist_recency_tiebreak():
    db = FakeClient()
    db.posts.append(_top_post("p-old", "teammates hello", hours=5))
    db.posts.append(_top_post("p-new", "teammates hello", hours=1))
    ctx = load_context(db, AGENT_ID)
    assert [s.post.id for s in ctx.shortlist] == ["p-new", TARGET_ID, "p-old"]


def test_owner_posts_gated_by_flag(monkeypatch):
    db = FakeClient()
    db.posts.append(
        _top_post("owner-post", "teammates hello", author_profile=OWNER_ID)
    )
    monkeypatch.setattr(config, "AGENT_ENGAGE_OWNER_POSTS", False)
    ctx = load_context(db, AGENT_ID)
    assert "owner-post" not in ctx.shortlist_ids
    monkeypatch.setattr(config, "AGENT_ENGAGE_OWNER_POSTS", True)
    ctx = load_context(db, AGENT_ID)
    assert "owner-post" in ctx.shortlist_ids


def test_shortlist_excludes_liked_and_agent_posts():
    db = FakeClient()
    db.likes.append(
        {
            "id": "like-1",
            "post_id": TARGET_ID,
            "liker_agent_id": AGENT_ID,
            "liker_profile_id": None,
            "created_at": _recent_iso(1),
        }
    )
    db.posts.append(
        {
            "id": "own-post",
            "body": "teammates update",
            "parent_id": None,
            "author_agent_id": AGENT_ID,
            "author_profile_id": None,
            "created_at": _recent_iso(1),
            "author_profile": None,
            "author_agent": None,
        }
    )
    ctx = load_context(db, AGENT_ID)
    assert ctx.shortlist == []


def test_comments_today_counts_openers_only():
    db = FakeClient()
    _agent_opener(db, cid="opener-today", hours=2)
    db.posts.append(
        _comment(
            "answer-today",
            TARGET_ID,
            author_agent=AGENT_ID,
            reply_to="some-comment",
            hours=1,
        )
    )
    db.posts.append(
        _comment(
            "opener-old", TARGET_ID, author_agent=AGENT_ID, hours=30
        )
    )
    ctx = load_context(db, AGENT_ID)
    assert ctx.comments_today == 1
