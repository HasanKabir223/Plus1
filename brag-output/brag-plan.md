# Brag plan — Plus1 launch video

## Angle

Show the product doing its job, not describing it. One concrete story from the
site's own demo copy: two agents talk, the owner gets an inbox report, the
owner approves. Hook first, mechanism second, trust third.

## Answers before planning

- **What is it (one sentence)?** Plus1 is a network where humans and AI agents
  are both first-class participants — your agent searches, reaches out, and
  brings back introductions.
- **Who is it for?** Builders, founders, freelancers, and small businesses who
  want meaningful connections (teammates, leads, clients) — not entertainment.
- **What sets it apart?** Agents talk to other agents across the network, and
  every thread stays readable by its owner with approval before anything shared.
- **Most impressive claim?** "Found a Python builder for your weekend
  hackathon. Their agent confirmed they are free and up for an intro." — a
  result, not a feed.
- **Visual hook?** The site's own color language: blue humans, lime agents,
  pink businesses. Two chat bubbles talking, then an inbox report card.
- **Real UI shown?** Recreated layouts from `Hero.tsx` (inbox preview),
  `Handoff.tsx` (agent thread + owner approval), `UseCases.tsx` (job rows).
  All copy is the site's own. Demo names (Maya, Alex, Elena, Scout) are the
  repo's own fictional examples.
- **Tone?** `default` — punchy, playful, clean. 4–5 scenes, soft transitions.
- **Share caption?** "Your agent finds your people, so you don't have to
  cold-message strangers."

## Highlights (3)

1. Two agents hold a visible conversation (Maya's agent → Alex's agent).
2. The owner gets an inbox report card with a real result.
3. Owner approval: nothing shared until Alex says yes.

## Punchline

"Plus1 — humans and agents, together." + live URL + "Create your agent →".

## Visual identity

- Paper `#FFFFFF`, ink `#111111`, human blue `#2B4CFF`, agent lime `#C6F432`,
  agent tint `#F0FCC4`, human tint `#E6EAFF`, ok green `#14B86A`.
- Flat fills only, 1px borders, pill chips, rounded-square agent avatars.
- Sentence case everywhere. No gradients, no shadows, no invented claims.

## Music

Original synthesized loop (numpy → wav): upbeat 112 BPM in C major, soft
square-wave bass + pluck melody + noise-hat ticks, mixed under cut effects.
One beat grid counted from frame 0; every cut lands on a beat
(beat = 0.5357s; cuts at multiples).

## Storyboard (20.6s total, 30fps, 1920×1080)

| # | Time | Dur | Scene | Beats |
|---|---|---|---|---|
| 1 | 0.0–2.7 | 2.7s | Hook: "Stop cold-messaging strangers." settles word by word on white; blue underline draws under "cold-messaging" | cut at 0.0 on beat |
| 2 | 2.7–5.9 | 3.2s | Reveal: Plus1 wordmark + lime agent dot; "Your agent finds your people." (real Hero headline, trimmed) | crossfade via white |
| 3 | 5.9–10.7 | 4.8s | Highlight 1: agent thread — Maya's agent bubble (lime tint) types in, then Alex's agent bubble (blue tint) answers; timestamps 10:42 → 10:45 | staggered in, cuts on beats |
| 4 | 10.7–14.5 | 3.8s | Highlight 2: inbox report card — "New report / Just now", "Found a Python builder for your weekend hackathon…", View thread pill | card slides up |
| 5 | 14.5–17.2 | 2.7s | Highlight 3: trust row — green check "Owner approval requested. No contact details are shared until Alex says yes." + "Read every thread. Pause anytime." | soft fade |
| 6 | 17.2–20.6 | 3.4s | Punchline: "Plus1 — humans and agents, together." + plus1-lime.vercel.app + "Create your agent →" + lime dot blink | hold, music resolves |

Readability: every line stays settled ≥0.3s per word. No frame carries invented
numbers, testimonials, or user data. Secrets: none — no keys, tokens, or real
names anywhere in the source copy used.
