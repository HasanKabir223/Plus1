"""Seed demo personas: auth user + onboarded profile + one agent + one post.

Creates ACCOUNTS ONLY. Never creates conversations, messages, likes,
comments, inbox items, follows, or action_log rows: all activity must come
from real agent Runs.

Schema notes (verified against supabase/schema.sql, the migrations, and the
live tables; see scripts/README.md):
- profiles has exactly: id, username, profilename, bio, looking_for,
  created_at. There are NO links / interests / onboarded-flag / handle
  columns. "Onboarded" is value-based (lib/auth-context.tsx): a real
  username plus a real profilename, so the seed sets both.
- agents has exactly: id, owner_id, name, personality, skill_md, status,
  is_public, last_run_at, created_at. There are NO handle / kind columns:
  the handle lives in demo_personas.json (and the summary table) only.

Usage (from the repo root, project env has supabase + dotenv):
  backend\\.venv\\Scripts\\python.exe scripts/seed_demo.py --dry-run
  backend\\.venv\\Scripts\\python.exe scripts/seed_demo.py
  backend\\.venv\\Scripts\\python.exe scripts/seed_demo.py --only maya_evals
  backend\\.venv\\Scripts\\python.exe scripts/seed_demo.py --cleanup
"""

import argparse
import fnmatch
import json
import os
import re
import secrets
import string
import sys
import typing
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # backend/.venv always has it; be explicit otherwise
    print("ERROR: python-dotenv is not installed in this interpreter.", file=sys.stderr)
    print("Run with the project env: backend\\.venv\\Scripts\\python.exe scripts/seed_demo.py", file=sys.stderr)
    sys.exit(2)

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
PERSONAS_PATH = HERE / "demo_personas.json"
CREDENTIALS_PATH = HERE / ".demo_credentials.json"
GITIGNORE_PATH = ROOT / ".gitignore"

DEMO_EMAIL_RE = re.compile(r"^demo\.[^@]+@example\.com$")
BIO_SUFFIX = "(demo persona)"
PASSWORD_LENGTH = 20
# created_at spread: persona index i posts (2*i + 1) hours ago -> 1h..19h.
POST_HOURS_AGO = lambda i: 2 * i + 1  # noqa: E731

SKILL_TEMPLATE = """## Interests
- {i1}
- {i2}
- {i3}
## Engagement rules
- Like posts that match my interests.
- Comment only when a post asks a question I can help with.
- Keep it short and specific. Never promise anything on my behalf or share contact details."""


def fail(msg: str) -> typing.NoReturn:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def load_personas() -> list[dict]:
    try:
        data = json.loads(PERSONAS_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(f"personas file not found: {PERSONAS_PATH}")
    except json.JSONDecodeError as exc:
        fail(f"personas file is not valid JSON: {exc}")
    if not isinstance(data, list) or not data:
        fail("personas file must be a non-empty JSON array")
    required = {"username", "display_name", "role", "interests", "looking_for", "agent", "post"}
    for i, p in enumerate(data):
        missing = required - set(p)
        if missing:
            fail(f"persona #{i} is missing keys: {sorted(missing)}")
        if set(p["agent"]) != {"name", "handle", "personality"}:
            fail(f"persona {p.get('username', i)!r}: agent must have name/handle/personality")
        if len(p["interests"]) != 3:
            fail(f"persona {p['username']!r}: interests must have exactly 3 items")
    return data


def build_skill_md(interests: list[str], username: str) -> str:
    skill = SKILL_TEMPLATE.format(i1=interests[0], i2=interests[1], i3=interests[2])
    if len(skill) >= 600:
        fail(f"persona {username!r}: skill_md is {len(skill)} chars, must be under 600")
    return skill


def ensure_credentials_ignored() -> None:
    """Refuse to write credentials unless .gitignore covers the file."""
    name = CREDENTIALS_PATH.name
    rel = CREDENTIALS_PATH.relative_to(ROOT).as_posix()
    try:
        patterns = [
            line.strip()
            for line in GITIGNORE_PATH.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.strip().startswith("#")
        ]
    except FileNotFoundError:
        fail(f"{GITIGNORE_PATH} not found; refusing to store credentials")
    for pat in patterns:
        pat = pat[12:] if pat.startswith("!") else pat  # negations don't protect us
        if pat.startswith("!"):
            continue
        for candidate in (rel, name, "/" + rel):
            if fnmatch.fnmatch(candidate, pat.lstrip("/")):
                return
    fail(
        f"{rel} is NOT covered by .gitignore; refusing to store credentials. "
        f"Add '{rel}' to .gitignore first."
    )


def load_credentials() -> dict:
    if not CREDENTIALS_PATH.exists():
        return {}
    try:
        data = json.loads(CREDENTIALS_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        fail(f"credentials file is corrupt: {exc}")
    return data if isinstance(data, dict) else {}


def save_credentials(creds: dict) -> None:
    CREDENTIALS_PATH.write_text(json.dumps(creds, indent=2) + "\n", encoding="utf-8")


def random_password(length: int = PASSWORD_LENGTH) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def get_env() -> tuple[str, str]:
    load_dotenv(ROOT / ".env")
    url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SECRET_KEY", "")
    if not url:
        fail("SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) is not set")
    if not key:
        fail("SUPABASE_SERVICE_ROLE_KEY is not set")
    return url, key


def make_client(url: str, key):  # never prints the key
    try:
        from supabase import create_client
    except ImportError:
        fail("supabase-py is not installed. Run with backend\\.venv\\Scripts\\python.exe")
    return create_client(url, key)


def _user_to_dict(u) -> dict:
    if isinstance(u, dict):
        return u
    if hasattr(u, "model_dump"):
        return u.model_dump()
    return dict(u.__dict__)


def list_all_users(admin) -> list[dict]:
    users: list[dict] = []
    page = 1
    while True:
        res = admin.list_users(page=page, per_page=100)
        batch = res if isinstance(res, list) else getattr(res, "users", [])
        if not batch:
            break
        users.extend(_user_to_dict(u) for u in batch)
        if len(batch) < 100:
            break
        page += 1
    return users


def find_user_by_email(admin, email: str) -> dict | None:
    for u in list_all_users(admin):
        if (u.get("email") or "").lower() == email.lower():
            return u
    return None


def seed_persona(client, persona: dict, index: int, creds: dict, dry_run: bool) -> tuple[str, str, str]:
    """Seed one persona. Returns (username, agent_handle, action)."""
    username = persona["username"]
    handle = persona["agent"]["handle"]
    email = f"demo.{username}@example.com"
    skill_md = build_skill_md(persona["interests"], username)
    bio = f"{persona['role']} {BIO_SUFFIX}"
    post_body = persona["post"]
    if not (1 <= len(post_body.strip()) <= 500):
        fail(f"persona {username!r}: post body must be 1-500 chars")
    created_at = (
        datetime.now(timezone.utc) - timedelta(hours=POST_HOURS_AGO(index))
    ).isoformat()

    profile_rows = client.table("profiles").select("id").eq("username", username).execute().data or []
    exists = bool(profile_rows)
    auth_user: dict | None = None
    if exists and dry_run is False:
        # The auth id and profile id must match (profiles.id references
        # auth.users). A profile row without its auth user is an orphan
        # from a partial cleanup: refuse rather than violate the unique
        # username or orphan the row's agents/posts.
        auth_user = find_user_by_email(client.auth.admin, email)
        if auth_user is None:
            fail(
                f"persona {username!r}: profile row exists but the auth user {email} is gone. "
                f"Delete the orphan profile row first (or run --cleanup if it is a demo user)."
            )
        if auth_user["id"] != profile_rows[0]["id"]:
            fail(
                f"persona {username!r}: auth user id and profile id disagree; refusing to seed."
            )

    if dry_run:
        print(f"  [dry-run] {username}: {'UPDATE' if exists else 'CREATE'} auth user {email}")
        print(f"  [dry-run] {username}: upsert profile (username/profilename/bio/looking_for)")
        print(f"  [dry-run] {username}: ensure one agent {persona['agent']['name']} (@{handle})")
        print(f"  [dry-run] {username}: ensure starting post ({POST_HOURS_AGO(index)}h ago)")
        return username, handle, "skipped"

    # 1. Auth user (admin API). Reuse the stored password on re-runs so the
    # credentials file stays valid; never rotate silently.
    stored = creds.get(username, {})
    password = stored.get("password") or random_password()
    if auth_user is None and not exists:
        auth_user = find_user_by_email(client.auth.admin, email)
    if auth_user is None:
        created = client.auth.admin.create_user(
            {
                "email": email,
                "password": password,
                "email_confirm": True,
                "user_metadata": {"username": username, "profilename": persona["display_name"]},
            }
        )
        raw_user = created.user if hasattr(created, "user") else created
        user_id = _user_to_dict(raw_user)["id"]
        action = "created"
    else:
        user_id = auth_user["id"]
        action = "updated"
    creds[username] = {"email": email, "password": password}

    # 2. Profile: the auth trigger may already have created a row; upsert the
    # exact remote columns (id, username, profilename, bio, looking_for).
    client.table("profiles").upsert(
        {
            "id": user_id,
            "username": username,
            "profilename": persona["display_name"],
            "bio": bio,
            "looking_for": persona["looking_for"],
        },
        on_conflict="id",
    ).execute()

    # 3. Agent: exactly one per persona; update it if it already exists.
    agents = client.table("agents").select("id").eq("owner_id", user_id).execute().data or []
    agent_payload = {
        "owner_id": user_id,
        "name": persona["agent"]["name"],
        "personality": persona["agent"]["personality"],
        "skill_md": skill_md,
        "status": "active",
        "is_public": True,
    }
    if agents:
        client.table("agents").update(agent_payload).eq("id", agents[0]["id"]).execute()
    else:
        client.table("agents").insert(agent_payload).execute()

    # 4. Starting post: match by exact body so a re-run never adds a second.
    posts = (
        client.table("posts")
        .select("id")
        .eq("author_profile_id", user_id)
        .eq("body", post_body)
        .execute()
        .data
        or []
    )
    if not posts:
        client.table("posts").insert(
            {
                "author_profile_id": user_id,
                "author_agent_id": None,
                "parent_id": None,
                "body": post_body,
                "created_at": created_at,
            }
        ).execute()

    return username, handle, action


def cleanup(client, dry_run: bool) -> int:
    users = [u for u in list_all_users(client.auth.admin) if DEMO_EMAIL_RE.match(u.get("email") or "")]
    if not users:
        print("No demo.*@example.com users found. Nothing to do.")
        return 0
    print("Demo users that would be deleted (auth user, profile, agents, posts):")
    for u in users:
        print(f"  - {u.get('email')} (id={u.get('id')})")
    if dry_run:
        print("[dry-run] nothing deleted.")
        return 0
    answer = input(f"Delete these {len(users)} demo users and ALL their data? Type DELETE to confirm: ")
    if answer.strip() != "DELETE":
        print("Aborted. Nothing deleted.")
        return 0
    creds = load_credentials()
    removed = 0
    for u in users:
        email = u.get("email") or ""
        uid = u["id"]
        client.auth.admin.delete_user(uid)
        # The live DB does not cascade auth.users -> profiles, so remove
        # the profile row explicitly; agents and posts cascade from it.
        client.table("profiles").delete().eq("id", uid).execute()
        leftover_agents = client.table("agents").select("id").eq("owner_id", uid).execute().data or []
        leftover_posts = (
            client.table("posts").select("id").eq("author_profile_id", uid).execute().data or []
        )
        for row in leftover_agents:
            client.table("agents").delete().eq("id", row["id"]).execute()
        for row in leftover_posts:
            client.table("posts").delete().eq("id", row["id"]).execute()
        if leftover_agents or leftover_posts:
            print(
                f"  warning: {email} needed explicit agent/post cleanup "
                f"({len(leftover_agents)} agents, {len(leftover_posts)} posts)"
            )
        # Drop the matching credentials entry (keyed by username).
        for name, entry in list(creds.items()):
            if entry.get("email") == email:
                del creds[name]
        removed += 1
    save_credentials(creds)
    print(f"Deleted {removed} demo users.")
    return removed


def print_summary(rows: list[tuple[str, str, str]]) -> None:
    print()
    print(f"{'username':<16}{'agent handle':<16}{'result'}")
    print(f"{'-' * 16}{'-' * 16}{'-' * 10}")
    for username, handle, action in rows:
        print(f"{username:<16}@{handle:<15}{action}")
    print()


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed demo personas (accounts only).")
    parser.add_argument("--dry-run", action="store_true", help="print what would happen, change nothing")
    parser.add_argument("--only", metavar="USERNAME", help="seed one persona by username")
    parser.add_argument("--cleanup", action="store_true", help="delete ONLY demo.*@example.com users (with confirmation)")
    args = parser.parse_args()

    ensure_credentials_ignored()
    personas = load_personas()
    if args.only:
        personas = [p for p in personas if p["username"] == args.only]
        if not personas:
            fail(f"unknown persona username: {args.only}")

    url, key = get_env()
    client = make_client(url, key)

    if args.cleanup:
        cleanup(client, args.dry_run)
        return

    creds = load_credentials()
    rows: list[tuple[str, str, str]] = []
    # Index into the FULL persona list so post times are stable with --only.
    full_index = {p["username"]: i for i, p in enumerate(load_personas())}
    for persona in personas:
        rows.append(seed_persona(client, persona, full_index[persona["username"]], creds, args.dry_run))
    if not args.dry_run:
        save_credentials(creds)
    print_summary(rows)


if __name__ == "__main__":
    main()
