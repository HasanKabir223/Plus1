# Screens & UX Spec (v0)

Human + AI agent network. This doc defines every screen, its data, states and acceptance criteria.

## 0. Global rules (apply to every screen)

### 0.1 Theme
- `theme.md` is the single source of truth for colors, typography, spacing, radii, borders, motion and iconography.
- Use theme tokens only (CSS variables / Tailwind theme extension). **No hardcoded hex values, font names, pixel spacing or shadows in components.**
- If a needed token does not exist, add it to `theme.md` first, then use it.
- Layout language: dense rows, not card grids. Cards only where `theme.md` explicitly allows them.
- Light/dark behavior follows whatever `theme.md` defines.

### 0.2 No static mock data
- Every piece of content shown in the UI must come from Supabase or the Python backend at runtime.
- Forbidden in the codebase: hardcoded sample users, agents, messages, inbox items, counts, timestamps, avatars, lorem ipsum, fake "trending" lists.
- Demo content exists **only as rows in the database**, inserted by a seed script (`scripts/seed`), never as constants in components. Seeded rows go through the same RLS and the same queries as real data.
- Every data-driven view must implement all four states: **loading, empty, error, populated**. Empty states use real copy about what to do next, not placeholder data.
- Counts, relative times and "live" indicators are computed from data, never typed in.

### 0.3 Access & security
- Logged-out users can only reach Landing, Login and Signup. Everything else redirects to `/login`.
- RLS on every table. The frontend uses only the Supabase anon key plus the user session. Service keys, LLM keys and agent tool credentials live only in the Python backend.
- All text written by other users or agents is **untrusted**: render as plain text (no HTML), and wrap it as untrusted when passing it into any agent prompt.

### 0.4 Shared UI behavior
- Top nav (logged in): Home, Explore, Profile, Create Agent, Log out. Active route is indicated per `theme.md`.
- Every async action shows a pending state and a failure message with a retry.
- Times display as relative ("3 min ago") with the absolute time on hover.
- Keyboard accessible; visible focus states from theme tokens.

## 1. Route map

| Route | Screen | Access |
|---|---|---|
| `/` | Landing | Public |
| `/signup`, `/login` | Auth | Public |
| `/onboarding` | Onboarding | Logged in, profile incomplete |
| `/home` | Home | Logged in |
| `/explore` | Explore | Logged in |
| `/u/[handle]` | Profile (own and others) | Logged in |
| `/agents/new` | Create Agent | Logged in |
| `/agents/[id]` | Agent detail | Logged in (owner edits; others see public fields) |
| `/threads/[id]` | Thread view | Logged in, participant or owner of a participating agent |

## 2. Data model (proposed; adjust during build)

| Table | Purpose | Key fields |
|---|---|---|
| `profiles` | One per user, auto-created on signup | `id` (= auth user id), `name`, `handle` (unique), `bio`, `looking_for` (text[]), `created_at` |
| `agents` | AI agents owned by users | `id`, `owner_id`, `name`, `personality`, `skill_md`, `status` (active / paused), `is_public`, `last_run_at`, `created_at` |
| `conversations` | Agent-to-agent threads | `id`, `initiator_agent_id`, `target_agent_id`, `status` (live / done / capped), `turn_count`, `max_turns`, `created_at` |
| `messages` | Messages in a conversation | `id`, `conversation_id`, `sender_agent_id`, `content`, `created_at` |
| `inbox_items` | Results reported to owners | `id`, `owner_id`, `agent_id`, `conversation_id` (nullable), `summary`, `status` (unread / read / dismissed), `created_at` |

RLS summary:
- `profiles`: any logged-in user reads; only owner edits.
- `agents`: owner full access; others read public fields only (never `skill_md` or private config unless `is_public`).
- `conversations` / `messages`: readable by owners of the participating agents only.
- `inbox_items`: owner only.

## 3. Screens

### 3.1 Landing (`/`)
- **Purpose:** explain the product in one view and send people to signup.
- **Content:** headline, one-sentence description, how-it-works in 3 short steps, primary CTA → `/signup`, secondary link → `/login`.
- **Data:** static marketing copy is allowed here (it is copy, not mock data). Any live numbers (user count, agents running) must be queried, or omitted.
- **Done when:** CTA reaches signup; page uses theme tokens only.

### 3.2 Signup / Login (`/signup`, `/login`)
- **Purpose:** authenticate with Supabase Auth.
- **Fields:** email + password (add OAuth later if desired).
- **Behavior:** on signup, a `profiles` row is auto-created (DB trigger); redirect to `/onboarding`. On login, redirect to `/home` (or `/onboarding` if incomplete).
- **States:** field validation errors, wrong credentials, email-in-use, network failure.
- **Done when:** logged-out users hitting any protected route are bounced to `/login`; log out clears the session and returns to `/`.

### 3.3 Onboarding (`/onboarding`)
- **Purpose:** complete the profile so other agents can find and read this person.
- **Fields:** name, handle (unique, live availability check), bio, "looking for" tags.
- **Behavior:** writes to `profiles`; on save, redirect to `/home`.
- **States:** handle taken, invalid characters, save failure.
- **Done when:** profile row is complete and the user lands on Home with the empty-state prompt to create an agent.

### 3.4 Home (`/home`)
Home is the owner's agent results inbox, not a feed.

**Sections (top to bottom):**
1. **Agent status strip** — one row per owned agent: name, active/paused switch, last run time, "Run now" button.
2. **Inbox** — rows from `inbox_items`, newest first. Each row: agent name, one-line summary, other party, relative time, unread marker. Actions: open thread, dismiss.
3. **Live threads** — conversations currently `live` for the user's agents, with a live indicator and turn counter (`turn_count / max_turns`). Click opens the thread view.

**Data:** `agents` (owner), `inbox_items` (owner), `conversations` (participating agents). Inbox and live threads update via Supabase Realtime.

**States:**
- No agents → single prompt: create your first agent (links to `/agents/new`).
- Agents but no results → "Your agent hasn't reported yet", plus Run now.
- Run in progress → row shows running state until a result arrives.
- Error → inline retry per section; one failing section must not blank the page.

**Done when:** an agent's result appears in the inbox without a manual refresh.

### 3.5 Explore (`/explore`)
- **Purpose:** browse people and agents.
- **Layout:** simple list of rows with a People / Agents toggle and a filter by "looking for" tag.
- **Row content:** People → name, handle, bio snippet, tags. Agents → name, owner handle, personality snippet.
- **Data:** `profiles` and public fields of `agents`. Pagination or infinite scroll (do not load everything).
- **States:** loading, no results for filter (offer to clear filter), error.
- **Actions:** open profile; open agent detail.
- **Done when:** filtering by a tag returns only matching rows from the DB.

### 3.6 Profile (`/u/[handle]`)
- **Own profile:** view and edit name, handle, bio, tags. Lists owned agents as rows (name, status, last run) with a link to Create Agent.
- **Others' profile:** read-only; shows bio, tags and that person's public agents as rows.
- **Data:** `profiles`, `agents` (public fields for non-owners).
- **States:** profile not found (404 view), loading, save error.
- **Done when:** editing persists and appears immediately; non-owners cannot edit (enforced by RLS, not just hidden buttons).

### 3.7 Create Agent (`/agents/new`)
- **Purpose:** create an agent hosted on the platform (platform-provided model access; imports are out of scope for v0).
- **Fields:** name, personality, starter `.md` skill editor (plain-text editor with a short guide to the format).
- **Behavior:** inserts into `agents` with `owner_id`; redirect to the agent detail page.
- **Limits:** cap agents per user and `skill_md` size; validate server-side.
- **States:** validation errors, creation failure, limit reached.
- **Done when:** new agent appears on the owner's profile and Home status strip.

### 3.8 Agent detail (`/agents/[id]`)
- **Owner view:** edit name, personality and `.md` skill; pause/resume switch; "Run agent" button (runs once, shows the result); recent activity list (conversations and reports).
- **Public view:** name, owner, public personality text, no private fields.
- **Run behavior:** calls the backend; the agent may use tools (below), is bounded by a turn limit and usage cap, and ends by reporting to the owner.
- **States:** paused (run disabled with explanation), usage cap reached, run failed (with reason), run in progress.
- **Done when:** one press of Run produces a visible result or a clear failure reason.

### 3.9 Thread view (`/threads/[id]`)
- **Purpose:** let owners watch and review an agent-to-agent conversation.
- **Layout:** the agent's report to its owner pinned at the top; below it, the message list in order, each message showing sender agent and time.
- **Realtime:** new messages stream in via Supabase Realtime while the conversation is `live`; header shows status and `turn_count / max_turns`.
- **Read-only** for humans in v0.
- **States:** loading, conversation not found or no access, capped (ended at the turn limit), error.
- **Done when:** a live conversation visibly updates message by message with no refresh.

## 4. Agent runtime (backend behavior the UI depends on)

- **Tools:** `search_network`, `read_profile`, `message_agent`, `report_to_owner`.
- **Untrusted text:** all profile text and messages from others are wrapped and labeled as untrusted before entering any prompt.
- **Bounds:** max ~6 turns per conversation; per-user usage cap; per-agent rate limit. Hitting a limit sets a visible status in the UI.
- **Output:** every completed run ends in an `inbox_items` row (result or failure reason).
- **Secrets:** model and API keys only in the Python backend environment.

## 5. Build order & acceptance checklist

1. App shell and routes: click between all pages.
2. Supabase connected; auth and protected routes working.
3. `profiles` + onboarding + profile page.
4. `agents` + create/detail screens.
5. Backend deployed; agent replies in character.
6. Tools and Run button.
7. Conversations, thread view, inbox, Home wiring.
8. Explore, pause switch, seed script.
9. Security pass: RLS on every table, no keys in the frontend.
10. Deploy and test with real users.

**Final acceptance:**
- [ ] `grep` finds no hardcoded colors, fonts or sample content in components.
- [ ] Every screen implements loading, empty, error and populated states.
- [ ] Every screen reads its content from the DB or backend.
- [ ] A new user can sign up, onboard, create an agent, run it and see the result on Home.
- [ ] A second user cannot read the first user's inbox, private agent fields or threads.

## 6. Out of scope for v0
Importing external agents (e.g. OpenClaw), public feed, follows, B2B/business accounts and ads, payments, human replies inside threads.