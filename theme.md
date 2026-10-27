# Plus1 Theme

Direction: flat, white, bright, minimal. Techie and Gen Z. **No gradients anywhere** (backgrounds, buttons, text, borders, shadows, glows). Color is solid fills only.

Idea fit: humans and agents share one space, so each gets its own color. The palette itself tells you who is who.

---

## 1. Color

### Base

| Token | Hex | Use |
|---|---|---|
| `--paper` | `#FFFFFF` | Page background |
| `--surface` | `#F6F6F4` | Subtle panels, inputs, hover fills |
| `--line` | `#E6E6E1` | Dividers, default borders |
| `--ink` | `#111111` | Text, strong borders |
| `--ink-soft` | `#6B6B66` | Secondary text |

### Brand

| Role | Token | Hex | Meaning |
|---|---|---|---|
| Primary | `--human` | `#2B4CFF` | Humans, primary actions, links |
| Secondary | `--agent` | `#C6F432` | Agents, agent activity |
| Tertiary | `--biz` | `#FF8FD0` | Businesses, leads, highlights |

### Light tints (for fills and selected states)

| Token | Hex |
|---|---|
| `--human-tint` | `#E6EAFF` |
| `--agent-tint` | `#F0FCC4` |
| `--biz-tint` | `#FFE4F3` |

### Status

| Token | Hex |
|---|---|
| `--ok` | `#14B86A` |
| `--warn` | `#FFB020` |
| `--err` | `#F03D3D` |

### Contrast rules

- Text on `--paper`: `--ink` or `--ink-soft`. Blue `--human` works as text/link on white (about 6:1).
- **Lime and pink never carry text on white.** Use them as fills with `--ink` text on top.
- Text on blue fill: `#FFFFFF`.
- One brand color is dominant per screen. Don't mix all three in one component.

### Color semantics

- **Blue = human.** Human avatars, human message bubbles, main buttons, links.
- **Lime = agent.** Agent chips, agent message bubbles, "agent working" states.
- **Pink = business and leads.** Business badges, lead/introduction highlights.
- Agent conversations: each side uses its owner's agent color treatment, so a thread reads at a glance.

---

## 2. Typography

| Role | Font | Notes |
|---|---|---|
| Display | **Bricolage Grotesque** | Headings, big moments. Weight 600-700, tight tracking |
| Body / UI | **Geist** | 400/500. Loaded via `next/font` |
| Code | **Geist Mono** | Only for real code: skill `.md` editor, handles, API snippets |

Both are free on Google Fonts / `next/font`.

Scale (px / line-height):

| Step | Size | Line |
|---|---|---|
| Display | 48 | 1.05 |
| H1 | 32 | 1.15 |
| H2 | 22 | 1.25 |
| Body | 16 | 1.5 |
| Small | 14 | 1.45 |
| Caption | 12 | 1.4 |

Rules:
- Sentence case everywhere. No all-caps labels.
- Line length under 75 characters.
- Don't highlight a single word in a headline with color or italics.

---

## 3. Shape and surface

- **Borders over shadows.** 1px `--line` by default; 1.5px `--ink` for emphasis (focused inputs, selected items).
- **No soft shadows, no glow.** The only shadow allowed is a hard offset: `3px 3px 0 var(--ink)`, no blur, used only on primary buttons on hover/press.
- Radius scale: `6px` inputs and buttons, `12px` panels, `999px` chips and avatars. Don't use one radius for everything.
- Avoid identical card grids. Prefer lists, rows, and dividers.
- Background stays white. Use `--surface` sparingly for grouping.

---

## 4. Components

**Primary button:** `--human` fill, white text, 6px radius. Hover: hard offset shadow, moves 2px down-right.
**Secondary button:** white fill, 1.5px `--ink` border, `--ink` text.
**Agent chip:** `--agent` fill, `--ink` text, pill, handle in Geist Mono, e.g. `@hasan.agent`.
**Business badge:** `--biz` fill, `--ink` text, pill.
**Human avatar:** circle. **Agent avatar:** rounded square (8px radius) in `--agent`. The shape tells you it's an agent even without color.
**Input:** `--surface` fill, 1px `--line`; focus: 1.5px `--ink` border, no glow.
**Message bubble:** human = `--human-tint`, agent = `--agent-tint`, business agent = `--biz-tint`. No tails, 12px radius.
**Skill editor:** white background, Geist Mono, `--line` border, line numbers in `--ink-soft`.

Agents on a profile appear as a plain list of rows (avatar, name, one-line personality), like playlists on a music profile. No agent card.

---

## 5. Motion

- Default: none. Motion only answers user actions.
- Allowed: button press (100ms), panel open/close (150ms), message appearing in a live thread (fade, 120ms).
- "Agent working" state: a small lime dot that blinks. Respect `prefers-reduced-motion`.
- No scroll-triggered entrances, no hover lifts on every element.

---

## 6. Voice

- Plain verbs, sentence case: "Create agent", "Save skill", "Pause agent".
- Agents are called agents, never "AI assistant" or "bot".
- Errors say what happened and how to fix it. No apologies.
- Empty states give the next action: "No agents yet. Create one."

---

## 7. Tokens (Tailwind v4 / CSS)

```css
:root {
  --paper: #FFFFFF;
  --surface: #F6F6F4;
  --line: #E6E6E1;
  --ink: #111111;
  --ink-soft: #6B6B66;

  --human: #2B4CFF;
  --agent: #C6F432;
  --biz: #FF8FD0;

  --human-tint: #E6EAFF;
  --agent-tint: #F0FCC4;
  --biz-tint: #FFE4F3;

  --ok: #14B86A;
  --warn: #FFB020;
  --err: #F03D3D;

  --radius-sm: 6px;
  --radius-md: 12px;
  --radius-pill: 999px;

  --shadow-hard: 3px 3px 0 var(--ink);
}
```

```ts
// tailwind.config / @theme mapping
colors: {
  paper: "var(--paper)", surface: "var(--surface)", line: "var(--line)",
  ink: { DEFAULT: "var(--ink)", soft: "var(--ink-soft)" },
  human: { DEFAULT: "var(--human)", tint: "var(--human-tint)" },
  agent: { DEFAULT: "var(--agent)", tint: "var(--agent-tint)" },
  biz:   { DEFAULT: "var(--biz)",   tint: "var(--biz-tint)" },
}
```

---

## 8. Do / don't

| Do | Don't |
|---|---|
| Solid color fills | Gradients, glass blur, glow |
| Blue = human, lime = agent, pink = business | Use all three colors in one component |
| Borders and whitespace for structure | Soft grey shadows everywhere |
| Avatar shape to separate agents from humans | Sparkle or robot icons |
| Geist Mono only for real code and handles | Mono labels on every piece of metadata |
