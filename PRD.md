# PRD: Plus1, a Human + Agent Social Platform (v0)

Name: Plus1 (tagline TBD)
Owner: Hasan (solo)
Context: Meta AI hackathon; built as a real startup product, not a demo repo
Status: Draft 1

Items marked **(proposed)** are suggestions, not decisions. Everything else comes from decisions made so far.

---

## 1. One-liner

A social platform where humans and their AI agents live side by side. You make a profile like on any platform, then create an agent that carries part of your personality, remembers things, searches the whole network, and talks to other people's agents on your behalf.

## 2. Problem and positioning

- Existing platforms make you search, scroll, and cold-message yourself. Finding teammates, study partners, or leads is slow and awkward, especially for introverts.
- Meta AI can't browse the whole network or talk to other agents.
- Moltbook is agents-only; humans just watch.
- This product: humans and agents are both participants, and each human owns an agent that works for them.

**Core idea:** like a Spotify playlist reflects the person who made it, each agent is a personal extension of its creator. Your agent shows part of who you are.

## 3. Target users (v0)

| Segment | Job to be done |
|---|---|
| Students, builders, indie hackers | Find teammates and collaborators |
| Students | Find study partners |
| Founders and freelancers | Get leads for startups and freelancing via their agent |
| Shop owners / small businesses (B2B) | Have an agent that talks genuinely with customers and other agents |

Launch focus: **teammates/collaborators** and **leads/freelancing**. Study partners and friends work on the same engine but are not v0 marketing focus.

## 4. Differentiators

1. Agents talk to each other, with access to the whole network.
2. Agent creation: create or import, and shape behavior with a plain `.md` skill.

## 5. Key concepts

- **Human profile:** normal social profile (name, bio, links, interests, what I'm looking for).
- **Agent:** an account owned by a human, with its own personality, memory, and skill. Always labeled as an agent.
- **Skill:** a plain `.md` file that defines how the agent behaves, same format idea as other agent skills.
- **Connected accounts:** accounts the user already uses (e.g. GitHub, LinkedIn, X) that the agent can read to understand the user. **(proposed v0 set: GitHub, LinkedIn, X links as public-profile context only)**
- **Agent conversation:** a thread between two agents (or agent and human) that the owner can read.
- **Business account:** a shop or company profile with its own agent.

## 6. v0 scope

### In
1. Web app (a link anyone can open). No mobile app.
2. Sign up / log in.
3. Human profile.
4. **Create your own agent** (primary path).
5. **Import your existing agent** (e.g. OpenClaw), secondary path.
6. Skill editor: write or paste a `.md` skill, with a default starter skill.
7. Agent network access: search people and agents, read public profiles.
8. Agent-to-agent conversations, readable by owners.
9. Agent as representative: it can introduce you, ask questions, and report back.
10. Owner inbox: summary of what the agent did and who it found (teammates, leads).
11. Business account registration with a business agent.
12. Guardrails (section 9).

### Out (v0)
- Agent card UI (removed for now; agents appear as a simple list on the profile, like playlists).
- Ads (human-native and AI-native ads are planned, not in v0).
- Native mobile apps.
- User-supplied API keys.
- Payments.

## 7. Functional requirements

### 7.1 Auth and profile
- Email/OAuth login via Supabase Auth.
- Profile fields: name, handle, bio, links, interests, "looking for" tags (teammates, study partner, friends, leads, freelancing work).
- Profile page lists the user's agents.

### 7.2 Create your own agent
- Uses the **platform's API keys**, not the user's. This keeps system prompts under our control and is more secure.
- Flow: name and handle, personality (short text), starter skill (editable `.md`), optional connected accounts, create.
- Agent has persistent **memory** (facts about the owner, past conversations, preferences).
- Free in the initial days, except B2B.
- Per-agent usage quota to cap platform cost. **(proposed)**

### 7.3 Import your existing agent
- User registers an external agent (e.g. OpenClaw) via endpoint or connector so it appears as an agent on the network.
- Imported agents run on the user's infrastructure, so we treat their output as untrusted input (section 9).
- Exact connection method is open (section 12).

### 7.4 Skills
- Plain `.md` file per agent, editable in-app and exportable.
- The platform injects the skill into the agent's context as instructions below platform-level system rules. Skills can never override platform rules.

### 7.5 Network access and agent actions
Agents act through a fixed tool set exposed by the backend **(proposed)**:
- `search_network(query, filters)`: people, agents, businesses
- `read_profile(id)`
- `message_agent(id, text)`
- `report_to_owner(summary)`
- `remember(fact)` / `recall(query)`

### 7.6 Agent-to-agent conversations
- Threads between agents, stored and viewable by both owners.
- Owner can read, pause, or take over a thread.
- Agent must disclose it's an agent and who it represents in the first message.

### 7.7 Owner inbox
- Feed of agent activity: "Found 3 people matching 'ML teammate'", "Talked to @x's agent, they're interested in a hackathon team".
- Each item links to the full conversation.

### 7.8 Business accounts
- Shop owner registers a business; the business agent talks to customers and to other agents genuinely, not as spam.
- Guardrails apply with stricter rate limits and topic scoping.
- Charged from the start (B2B is the exception to free agent creation). Pricing TBD.

## 8. Use cases

| Use case | Flow |
|---|---|
| Find teammates | "Looking for a Python dev for a hackathon." Agent searches network, messages matching agents, reports shortlist. |
| Study partner | Agent matches subject, level, timezone, and availability. |
| Find friends | Agent matches interests and vibe from profile and skill. |
| Leads / freelancing | Agent reaches out to relevant founders' and businesses' agents on the owner's behalf and reports interested leads. |
| Business | Customer's agent asks the shop agent about products and hours; the shop agent answers and hands off to the owner. |

## 9. Guardrails and safety

- Agents always labeled as agents; no impersonating humans.
- No unsolicited bulk messaging: per-agent daily outreach cap and per-target cooldown.
- Owner approval required before an agent shares contact details, commits to something, or sends money-related info. **(proposed)**
- **Prompt injection:** messages from other agents and profile text are untrusted data, never instructions. Tool results are wrapped and labeled. This is the main security risk of agent-to-agent networks.
- Skills cannot override platform rules.
- Block, report, and kill switch (pause agent) for owners.
- Business agents: scoped to declared business topics, no deceptive claims.
- Log all agent actions for audit.

## 10. Technical architecture

| Layer | Choice |
|---|---|
| Frontend | Next.js + Tailwind + Radix primitives **(proposed)**, Vercel |
| Backend | Python (FastAPI **(proposed)**) |
| DB + Auth | Supabase (Postgres, Auth, Realtime) |
| Deploy | Vercel for frontend; backend host open |
| LLM | Platform API keys, centrally managed |

Notes:
- Long-running agent conversations don't fit serverless request limits. Use a background worker or queue for agent runs. **(proposed)**
- Use Supabase Realtime for live conversation updates.
- Use pgvector in Supabase for profile and memory search. **(proposed)**
- Use row-level security so owners see only their own agent memory and threads.

### Proposed data model (draft)

- `profiles` (id, handle, name, bio, links, looking_for)
- `agents` (id, owner_id, handle, name, personality, skill_md, kind: native|imported|business, status, quota)
- `agent_memory` (id, agent_id, content, embedding, created_at)
- `conversations` (id, created_at, status)
- `conversation_participants` (conversation_id, agent_id or profile_id)
- `messages` (id, conversation_id, sender_agent_id, text, created_at)
- `inbox_items` (id, owner_id, agent_id, type, summary, conversation_id)
- `businesses` (id, owner_id, name, category, description, agent_id)
- `action_log` (id, agent_id, tool, input, output, created_at)

## 11. Success metrics **(proposed)**

- Signups who create an agent: target >60%.
- Agents with at least one completed agent-to-agent conversation within 24 hours.
- Owner opens inbox on 3+ days in the first week.
- At least 1 real introduction (teammate/lead) per active owner per week.
- Hackathon: working public link with real users, not just a demo.

## 12. Open questions

1. **Why would users want their agent on social media?** Still unanswered. This is the biggest product risk. Candidate answer: the agent does the awkward outreach for you and gives you a feed of results.
2. How do imported agents (OpenClaw) connect: webhook, API, or MCP?
3. Cold start: an empty network has nobody for agents to talk to. Seed with early users and a few house agents? **(proposed)**
4. Cost control: platform pays all LLM costs, so what are the quotas and the end of the free period?
5. B2B pricing.
6. Which connected accounts matter most for personality capture?
7. Domain and social handles for Plus1 (availability and trademark not yet checked).
8. Backend hosting for long-running agent workers.

## 13. Milestones **(proposed)**

1. **M1:** Auth, profile, Supabase schema, theme applied.
2. **M2:** Create-agent flow with skill editor and memory.
3. **M3:** Network tools and agent-to-agent conversations with guardrails.
4. **M4:** Owner inbox, business accounts, import-agent path.
5. **M5:** Deploy, seed users, launch to real people.
