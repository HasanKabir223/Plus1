"""Deterministic interest matching for the Run shortlist (no LLM).

The agent's skill_md is the "interest file": Python extracts interest_terms
from its "## Interests" bullets plus the owner's profile, then scores each
recent post by distinct-term overlap. The model later scores the shortlist
0-10 in its decision; Python gates on those scores. Everything here is
case-insensitive word-boundary matching on lowercased text.
"""

import re

# Common glue words that must never become interest terms. (One- and
# two-letter words are dropped by the length rule anyway.)
STOPWORDS = frozenset(
    """
    the and for are but not you your all any can had her was one our out day
    get has him his how new now old see two way who did its let put say she
    too use with about into through during before after above below from they
    them then there these those have will would should could might must shall
    been being does doing were what when where which while each other more
    most such only over also back come down even every because between
    """.split()
)

INTERESTS_HEADING_RE = re.compile(r"^##\s+interests\s*$", re.IGNORECASE)
HEADING_RE = re.compile(r"^#{1,6}\s+\S")
BULLET_RE = re.compile(r"^\s*(?:[-*\u2022]|\d+[.)])\s+(.*\S)\s*$")
_WORD_RE = re.compile(r"[a-z0-9]+")

MAX_TERMS = 40
MIN_WORD_LEN = 3
FALLBACK_SKILL_CHARS = 400


def _words(text: str) -> list[str]:
    return _WORD_RE.findall(text.lower())


def _terms_from_text(text: str) -> list[str]:
    kept = [
        w for w in _words(text) if len(w) >= MIN_WORD_LEN and w not in STOPWORDS
    ]
    phrases = [f"{a} {b}" for a, b in zip(kept, kept[1:])]
    return kept + phrases


def _interests_bullets(skill_md: str) -> list[str] | None:
    """Bullet texts under "## Interests", or None when the section is missing."""
    if not skill_md:
        return None
    bullets: list[str] = []
    in_section = False
    for raw_line in skill_md.splitlines():
        line = raw_line.strip()
        if not in_section:
            if INTERESTS_HEADING_RE.match(line):
                in_section = True
            continue
        if HEADING_RE.match(line):
            break
        match = BULLET_RE.match(raw_line)
        if match:
            bullets.append(match.group(1))
    if not in_section:
        return None
    return bullets


def extract_interest_terms(
    skill_md: str | None,
    owner_bio: str | None,
    owner_looking_for: list[str] | None,
) -> list[str]:
    """Build the deterministic interest-term list (max 40, order-stable).

    Sources: "## Interests" bullets plus the owner's profile (bio text and
    looking_for tags). Profiles have no separate interests column, so the
    bio is the free-text source. Without an "## Interests" section, fall
    back to the owner fields plus the first 400 characters of skill_md.
    """
    bullets = _interests_bullets(skill_md or "")
    sources: list[str] = list(bullets) if bullets else []
    if owner_bio:
        sources.append(owner_bio)
    sources.extend(
        tag for tag in (owner_looking_for or []) if isinstance(tag, str)
    )
    if not bullets and skill_md:
        sources.append(skill_md[:FALLBACK_SKILL_CHARS])
    seen: set[str] = set()
    terms: list[str] = []
    for source in sources:
        for term in _terms_from_text(source):
            if term not in seen:
                seen.add(term)
                terms.append(term)
                if len(terms) >= MAX_TERMS:
                    return terms
    return terms


def overlap_score(body: str | None, terms: list[str]) -> int:
    """Number of distinct interest terms found in the body (0 when empty)."""
    if not body or not terms:
        return 0
    text = body.lower()
    score = 0
    for term in terms:
        if re.search(r"\b" + re.escape(term) + r"\b", text):
            score += 1
    return score
