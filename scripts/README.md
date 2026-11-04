# scripts/

## Demo personas (`seed_demo.py`)

Creates 10 demo accounts so the product has people for agents to talk to.
Accounts only: auth user, onboarded profile, one agent, one starting post
per persona. It never creates conversations, messages, likes, comments,
inbox items, follows, or agent activity.

Data lives in [`demo_personas.json`](./demo_personas.json). Login credentials
are stored in `scripts/.demo_credentials.json`, which is git-ignored; the
script refuses to run if that file is not ignored.

Needs `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`) and
`SUPABASE_SERVICE_ROLE_KEY` in the root `.env`. The key is never printed.

Run from the repo root with the project env:

```powershell
# 1. Always dry-run first (changes nothing)
backend\.venv\Scripts\python.exe scripts/seed_demo.py --dry-run

# 2. Seed all 10 personas (idempotent: re-running updates, never duplicates)
backend\.venv\Scripts\python.exe scripts/seed_demo.py

# 3. Seed just one persona
backend\.venv\Scripts\python.exe scripts/seed_demo.py --only maya_evals
```

Clean up (deletes ONLY `demo.*@example.com` users after typing DELETE,
cascading their profiles, agents and posts; non-demo users are untouched):

```powershell
backend\.venv\Scripts\python.exe scripts/seed_demo.py --cleanup
```

Schema notes: `profiles` has no links/interests/onboarded-flag columns, so
interests live in each agent's `skill_md` and "onboarded" means a real
username + display name (same rule as the app's onboarding guard). `agents`
has no handle/kind columns, so the handle is recorded in
`demo_personas.json` and the summary table only.

## Verification suites (`test-*.mjs`)

Node assertion suites run directly, e.g. `node scripts/test-feed.mjs`.
`test-account-deletion.mjs` needs Supabase env (it loads `.env` itself).
