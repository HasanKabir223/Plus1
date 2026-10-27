# Plus1 — Memory & Architecture Decisions

## 1. Tech stack (decided)

| Layer | Choice | Reason |
|---|---|---|
| Framework | **Next.js** (App Router) | Matches PRD §10; ready to grow into full app |
| Styling | **Vanilla CSS** with CSS custom properties | Theme tokens from `theme.md`; no Tailwind |
| Fonts | **Bricolage Grotesque** (display), **Geist** (body/UI), **Geist Mono** (code) | Per `theme.md` §2 |
| Deploy target | Vercel | Per PRD §10 |
| Package manager | npm | Default for Next.js |

## 2. Landing page — section structure

Based on the reference screenshots + PRD + additions requested:

| # | Section | Key content |
|---|---|---|
| 0 | **Navbar** | Plus1 logo, nav links (How it works, Use cases, Trust, Log in), CTA "Create your agent →" |
| 1 | **Hero** | Badge line, big headline, sub-copy, two CTAs, trust line |
| 2 | **Ticker bar** | Horizontal scrolling keywords: Less searching / More introductions / Human agency, kept / Built for real people |
| 3 | **The Premise** (01) | Headline + body, 3-step walkthrough with mock UI cards |
| 4 | **The Network** (02) | Headline + body, mock network search UI |
| 5 | **The Handoff** (03) | Mock agent-to-agent conversation thread + headline + body + checklist |
| 6 | **Use Cases** | Cards/rows for: Find teammates, Find study partners, Get leads, Business agents |
| 7 | **Footer** | Logo, nav links, legal, social |

## 3. Design rules (from theme.md)

- **No gradients, glass blur, or glow.** Solid fills only.
- **No purple.** Avoid anything that feels "AI slop."
- Colors: Blue (#2B4CFF) = human, Lime (#C6F432) = agent, Pink (#FF8FD0) = business.
- Borders over shadows. Only shadow allowed: `3px 3px 0 var(--ink)` hard offset on hover.
- Flat white background. `--surface` (#F6F6F4) sparingly.
- Sentence case everywhere. No all-caps labels.
- Motion only on user actions, minimal (100-150ms).
- Mock UI uses placeholder names, not real names.

## 4. File structure

```
plus1/
├── app/
│   ├── layout.tsx          # Root layout, fonts, metadata
│   ├── page.tsx            # Landing page (all sections)
│   └── globals.css         # Design tokens + global styles
├── components/
│   ├── Navbar.tsx
│   ├── Hero.tsx
│   ├── GradientASCII.jsx   # Interactive WebGL2 ASCII shader component
│   ├── GradientASCII.d.ts  # TypeScript type definitions
│   ├── GradientASCII.css   # ASCII canvas styles
│   ├── Ticker.tsx
│   ├── Premise.tsx         # 3-step walkthrough
│   ├── Network.tsx         # Network search mock
│   ├── Handoff.tsx         # Conversation thread mock
│   ├── UseCases.tsx
│   └── Footer.tsx
├── public/
├── PRD.md
├── theme.md
├── memory.md
├── package.json
├── next.config.js
└── tsconfig.json
```

## 5. Open decisions

- Domain / deployment URL: TBD
- CTA links (Create your agent, Log in): placeholder `#` for now
- Social links in footer: TBD
