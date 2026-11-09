# SPEC — Plus1 launch film "Saturday, thread-centered" (A′)

Screen sources (launch.md): captured landing screenshots (reference only —
no authed pixel is faked); thread + report pieces rebuilt in HTML from
Handoff.tsx verbatim copy + the real /messages/[id] labels + captured CSS;
agent chip + names from the repo's own demo content; logo PNG from
public/logo.png (the capture's logo-*.svg guess was wrong); Bricolage/
Geist/Geist Mono woff2 from capture-3. Live authed screens were not
capturable (login wall).

Runtime finding (review pass 1): overlapping scene hosts do NOT composite
— only the topmost host renders (proven by seam strips at 6.0, 8.6, 20.0).
All slots abut; every transition is internalized as entrance choreography
inside the incoming scene.

GOAL: A stranger believes two agents really held a useful conversation and
wants their own agent finding people while they sleep.
OUTPUT: HyperFrames, 1920x1080, 30fps
TIME: 31s x 30fps = 930 frames; SILENT (no music source: no HeyGen
sign-in, catalog holds no tracks) + how-to-add line in delivery; hard cuts
at every seam, each landing on stillness or into a designed entrance
LOOK: ground #FFFFFF flat, 0% grain, 0% vignette, no shadows except the
theme's hard 3px offset on pressed/clicked controls; ink #111111; accent
lime #C6F432 rationed to agent elements + payoff highlight + claim band;
display Bricolage Grotesque 700 at 88-150px, tracking -0.02em; body Geist
400/500/600 at 28-44px; handles/timestamps Geist Mono 28-30px; medium =
real flat product UI: 2px borders (1px vanishes on video), pill chips,
rounded-square agent avatars, circle human avatars; status colors kept
OBJECTS: thread window (header "Live thread" + "Agent to agent · visible
to owners"; owner banner "Your agent is talking in this thread. You can
read everything here." + Pause + Take over; message rows with Agent tags;
typing line; footer approval strip); inbox report card (verbatim Hero
copy); big cursor ~110px entering off-screen; Plus1 mark (real logo PNG) +
wordmark + "Create your agent" button
MOTION: arrivals expo.out / power4.out long tail 10-18f, never bounce on
UI; camera power2.inOut 15f; entrances carry transitions (dip, whip,
match-carry, grow, blur, iris); cursor power1.inOut, click causes next
thing same frame; titles land per motion.md (per-word blur 6px to 0 +
opacity, 2f apart, no translate; or clip-path wipe); landed titles dead
still; overlap 30-50%; typing stagger 0.06-0.08s/word; one hero move per
shot, secondary 50-70% travel starting 3-6f later
SHOTS (abutting slots, hard cuts, internalized transitions):
1. 0-2.5 Hook: thread window open, msg1 types in word by word; DIP CUT to 2
2. 2.5-6.0 Tension: grey composer, cold DM typed then backspaced to
nothing, "Seen. No reply."; CUT to 3 (reveal whips in)
3. 6-8.7 Reveal: "Your agent does the reaching." + chip "Scout ·
@scout.agent" pops, then match-flies onto the avatar mark; CUT to 4
(avatar pops exactly on the mark)
4. 8.7-20.0 Proof/THREAD: msg1 completes, typing line, msg2 types in,
approval banner lands with check pop; each bubble held 0.5s + 0.3s/word;
CUT to 5
5. 20-26.0 Payoff: mini-thread grows into the report card; cursor clicks
"View thread", compact thread panel slides in beside it (no overlap, both
readable); read report; CUT to 6
6. 26-28.0 Claim: "Less searching." stamped + lime band wipes
"More introductions."; read 1.2s+; CUT to 7 (iris opens)
7. 28-31 End card: iris from mark point, cursor clicks mark (press + hard
shadow), "Plus1" wipes in, "Create your agent" + URL hold 2s+
BANNED: spec.md defaults (dark void, glow/particles, gradients/glass,
cream-serif-mono look, centered fade-ups, drifting titles, HUD decor,
3-card rows, dimmed-screenshot titles, docked logo) + typing-opener +
feature-list cards + invented UI labels/copy + turn counter (not in the
built thread UI) + bounce on UI + fade+slide-up title entrances +
overlapping scene hosts (runtime renders topmost only) +
"unlock/seamless/game-changer" hype + voiceover repeating on-screen text
QA: f0 (thumbnail: thread + banner + sender, no black), f120 (empty grey
composer + verdict), f220 (title + chip), f449 (both bubbles complete),
f501 (check popped), f687 (report + panel + cursor on button), f810 (claim
band), f885 (mark + CTA); every cut must land on stillness, never mid-move
