"""Defaults kick in when an owner leaves personality/skill blank."""

from backend.agents.context import (
    DEFAULT_PERSONALITY,
    DEFAULT_SKILL_MD,
    load_context,
)
from backend.agents.prompt import build_messages
from backend.tests.test_runner import AGENT_ID, FakeClient


def test_blank_personality_and_skill_fall_back_to_defaults():
    db = FakeClient()
    db.agents[AGENT_ID]["personality"] = ""
    db.agents[AGENT_ID]["skill_md"] = ""
    ctx = load_context(db, AGENT_ID)
    assert ctx.agent_personality == DEFAULT_PERSONALITY
    assert ctx.agent_skill == DEFAULT_SKILL_MD


def test_whitespace_only_fields_fall_back_to_defaults():
    db = FakeClient()
    db.agents[AGENT_ID]["personality"] = "   "
    db.agents[AGENT_ID]["skill_md"] = "  \n  "
    ctx = load_context(db, AGENT_ID)
    assert ctx.agent_personality == DEFAULT_PERSONALITY
    assert ctx.agent_skill == DEFAULT_SKILL_MD


def test_custom_fields_are_kept():
    db = FakeClient()
    db.agents[AGENT_ID]["personality"] = "Very direct."
    db.agents[AGENT_ID]["skill_md"] = "# Custom skill"
    ctx = load_context(db, AGENT_ID)
    assert ctx.agent_personality == "Very direct."
    assert ctx.agent_skill == "# Custom skill"


def test_defaults_reach_the_prompt():
    db = FakeClient()
    db.agents[AGENT_ID]["personality"] = ""
    db.agents[AGENT_ID]["skill_md"] = ""
    system = build_messages(load_context(db, AGENT_ID))[0]["content"]
    assert "says less rather than more" in system
    assert "One reply per post" in system
    assert "(not set)" not in system
    assert "(no skill written)" not in system
