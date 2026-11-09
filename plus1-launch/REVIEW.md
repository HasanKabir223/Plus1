# REVIEW — Plus1 launch film "Saturday, thread-centered" (A′)

## Creative calls

- Built A′ (from STORYLINES.md): the agent-to-agent thread is ~40% of
  runtime, played in full with typing, both answers, and owner approval.
- Every product word is verbatim (landing copy, thread labels, report,
  chips, CTA). Live authed screens were login-walled, so the thread and
  report are pieces rebuilt in HTML from the repo's own code, CSS, demo
  data, fonts, and logo — no invented UI, no faked pixels.
- Review pass 1 found overlapping scene hosts do not composite (only the
  topmost host renders — proven by seam strips). All slots now abut with
  hard cuts; every transition was internalized as entrance choreography
  (dip, whip-in, match-cut chip→avatar, grow-mini morph, blur-in, iris).
- SILENT: no music source exists here (no HeyGen sign-in, catalog holds no
  tracks), so per sound.md the film delivers silent with a how-to-add line.
- Not built: B "Two inboxes" and C "Follow the skill" (kept in
  STORYLINES.md for a later switch).

## Measured vs looked

- Measured: `check` green on lint, runtime, layout, motion, contrast, zero
  findings (9 layout samples + 248 craft checks). Read-holds computed per
  line (0.5s + 0.3s/word) and hold.
- Looked at: beat sheet, phone sheet, all seam strips, full-res frames at
  8.6, 19, 19.4, 23.1, 29.5 (thumbnail, thread geometry, payoff click,
  endcard). Two review passes; second pass verified all fixes.
- Nobody checked: sound (there is none — measured N/A, not heard).

## Weakest shot

- The tension beat is thinnest: one static card, one cursor, one verdict
  line. With more time, add a second failed cold-DM (a "seen 3 weeks ago"
  thread) for rhythm before the reveal.
- Accepted: thread bubbles are unreadable at 360px phone width. This is a
  landscape-first film; titles, claim, and CTA all read at 360px.

## Markers kept on purpose

- `data-layout-allow-overflow` on the thread cursor: intentional
  off-screen entrance (launch.md wants cursors entering from off-screen).
- `data-layout-allow-overlap` on the payoff grow-mini: designed
  transitional co-visibility with the incoming report card (0.65s).
