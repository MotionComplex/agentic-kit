---
name: motion-review
description: Review or test the motion/animation of a web page as data. Use whenever the user wants to check, review, audit, score, or compare UI animation, transitions, easing, entrance/hover/scroll motion, overshoot/bounce, jank/performance, or prefers-reduced-motion accessibility on a URL — e.g. "how's the animation on this page", "is this motion accessible", "did my change make the motion worse", "review the hero entrance", "test this hover transition". Backed by the motion-trace MCP tools.
---

# Motion review

Review web motion as structured data (not video) using the motion-trace MCP tools.
Resolved per-frame state is extracted from the live page, so judgments are numeric
and exact rather than guessed from pixels.

## Tools

- `motion_discover(url)` — lists what animates on a page (live CSS/WAAPI animations
  and elements with CSS transitions) with suggested selectors + triggers.
- `motion_review(url, selectors, ...)` — captures + scores motion against a rubric;
  returns score, findings, reduced-motion verdict, and a markdown report.
- `motion_capture(url, selectors, ...)` — raw MotionTrace (timeline + per-frame state).
- `motion_diff(a, b)` — compares two traces (motion regression).
- `motion_prompt(trace)` — compact payload + rubric for your own deeper judgment.

## Workflow

1. **If you don't know the selectors, call `motion_discover` first.** Pick the
   relevant entries. Animated entries play on load; interactive entries (transitions)
   need a trigger — use their suggested `triggerAction`/`triggerSelector`.
2. **Call `motion_review`** with the chosen `selectors`. Set:
   - `triggerAction` + `triggerSelector` for hover/click/focus motion (e.g. buttons);
   - `duration` to roughly the animation length (default 1000ms; spinners ~one period);
   - `realtime: true` for JS-library or scroll-driven motion (Framer Motion, GSAP) that
     load/CSS capture misses, and to get real fps + jank signals.
3. **Report results plainly**: the score, each finding (severity + what + why), and the
   reduced-motion verdict. Quote the numeric evidence (overshoot %, ms, fps) — that is
   the point of using data over video. Offer the markdown report.

## Choosing a mode

- Default (deterministic) for CSS animations, transitions, WAAPI, and timestamp-driven
  rAF motion — exact and reproducible; best for regressions/`motion_diff`.
- `realtime: true` when motion is JS-library/scroll-driven or when the user asks about
  smoothness/performance/jank (only realtime yields measured fps and dropped frames).

## Notes

- If a `motion_review` comes back with no motion and an empty timeline, the page's
  motion is likely JS-driven — retry with `realtime: true`, or `motion_discover` to
  confirm what (if anything) animates.
- Reduced-motion accessibility: `motion_review` captures the page under
  `prefers-reduced-motion: reduce` automatically and fails it if positional motion
  isn't suppressed. Surface that verdict when accessibility is in scope.
- The browser installs itself on first use; no manual setup. To use a remote/hosted
  browser instead of a local one, set the MOTION_TRACE_CDP env var on the server.
