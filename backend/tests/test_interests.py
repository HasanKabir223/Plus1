"""Tests for deterministic interest matching (backend/agents/interests.py)."""

from backend.agents.interests import (
    MAX_TERMS,
    extract_interest_terms,
    overlap_score,
    rank_score,
)


def test_extract_from_interests_section():
    skill = (
        "# Agent Instructions\n"
        "You are a scout.\n"
        "## Interests\n"
        "- Python builders\n"
        "- hackathons\n"
        "## Engagement rules\n"
        "- Like posts.\n"
    )
    terms = extract_interest_terms(skill, "Bio here.", ["teammates"])
    assert "python" in terms
    assert "builders" in terms
    assert "python builders" in terms  # 2-word phrase kept
    assert "hackathons" in terms
    assert "teammates" in terms  # owner looking_for included
    assert "like" not in terms  # engagement rules are not interests


def test_heading_case_insensitive_and_bullets_variants():
    skill = "## INTERESTS\n* distributed systems\n1. study groups\n"
    terms = extract_interest_terms(skill, "", [])
    assert "distributed" in terms
    assert "distributed systems" in terms
    assert "study" in terms
    assert "study groups" in terms


def test_stopwords_and_short_words_dropped():
    terms = extract_interest_terms("## Interests\n- the UX and me to do\n", "", [])
    assert terms == []


def test_domain_short_terms_kept():
    terms = extract_interest_terms("## Interests\n- ML research\n- AI safety\n", "", [])
    assert "ml" in terms
    assert "ai" in terms
    assert "ml research" in terms


def test_hiring_post_matches_ml_interest():
    terms = extract_interest_terms(
        "## Interests\n- ML research collaborators\n", "", []
    )
    assert overlap_score("we are hiring ML engineer, DM if interested", terms) >= 1
    assert overlap_score("sourdough starter finally doubled", terms) == 0


def test_collaboration_ask_outranks_plain_chatter():
    terms = extract_interest_terms(
        "## Interests\n- ML research collaborators\n", "", []
    )
    ask = rank_score("we are hiring ML engineer, DM if interested", terms)
    chatter = rank_score("thinking about research collaborators today", terms)
    assert overlap_score("thinking about research collaborators today", terms) == 3
    assert ask > chatter


def test_ask_bonus_needs_overlap():
    terms = extract_interest_terms(
        "## Interests\n- ML research collaborators\n", "", []
    )
    assert rank_score("hiring a pastry chef, DM if interested", terms) == 0


def test_dedupe_and_cap():
    bullets = "\n".join(f"- topic{i} builders" for i in range(30))
    terms = extract_interest_terms(f"## Interests\n{bullets}\n", "", [])
    assert len(terms) == MAX_TERMS
    assert len(set(terms)) == len(terms)


def test_fallback_without_interests_section():
    skill = "# Skill\nPython builders and hackathons everywhere."
    terms = extract_interest_terms(skill, "Robotics fan.", ["teammates"])
    assert "robotics" in terms  # owner bio
    assert "teammates" in terms  # looking_for
    assert "python" in terms  # first 400 chars of skill_md
    assert "hackathons" in terms


def test_fallback_skill_head_truncated():
    skill = "## Other\n" + "zebra " * 200
    terms = extract_interest_terms(skill, "", [])
    assert "zebra" in terms  # within the first 400 chars


def test_empty_inputs_give_no_terms():
    assert extract_interest_terms("", "", []) == []
    assert extract_interest_terms(None, None, None) == []


def test_overlap_counts_distinct_terms():
    terms = ["teammates", "python", "python builders"]
    assert overlap_score("Looking for teammates, teammates!", terms) == 1
    assert overlap_score("Python builders and teammates?", terms) == 3


def test_overlap_word_boundaries_and_case():
    terms = ["cat", "hackathon"]
    assert overlap_score("Cats and dogs.", terms) == 0
    assert overlap_score("A CAT and a Hackathon!", terms) == 2


def test_overlap_empty_body_or_terms():
    assert overlap_score("", ["a"]) == 0
    assert overlap_score(None, ["a"]) == 0
    assert overlap_score("hello", []) == 0
