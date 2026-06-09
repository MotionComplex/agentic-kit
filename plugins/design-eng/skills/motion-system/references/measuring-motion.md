# Mode MEASURE — extracting real motion from a video or live URL

When the source actually moves — a screen recording, a live interactive page, an exported animation — you don't have to infer. You can measure, then systematize the measurements into tokens exactly as `ui-reverse-engineer` systematizes raw spacing. This is the same "ground truth beats inference" move applied to time, and it lets you set `provenance: "measured"` honestly.

## Live URL — use the motion-trace MCP

The motion-trace MCP resolves per-frame state from the live page, so the numbers are exact rather than guessed from video frames. Load the tools via ToolSearch if deferred.

1. **`motion_discover(url)`** — lists what animates (CSS/WAAPI animations + elements with transitions) with suggested selectors and triggers. Start here when you don't already know the selectors.
2. **`motion_capture(url, selectors, ...)`** — raw MotionTrace: timeline + per-frame resolved state for the elements you chose. This is your measurement.
3. **`motion_review(url, selectors, ...)`** — captures *and* scores against a rubric; returns easing/overshoot findings and a reduced-motion verdict. Useful when you want the judgment, not just the trace.
4. **`motion_diff(a, b)`** — compare two traces; use in Phase 6 to quantify how close your reconstruction is to the source.
5. **`motion_prompt(trace)`** — compact payload + rubric for your own deeper read of a trace.

From a capture, read off: **duration** (start→settle), **easing** (fit the velocity curve to the nearest named bezier), **distance** (translate delta), **overshoot** (does it pass the target and return → a spring), and any **stagger** (per-item offset in a sequence).

## Video / screen recording

If the input is a recording rather than a URL:

- Identify the animated transition and its start/end frames; duration = frames ÷ fps.
- Sample the element's position/scale/opacity across frames to recover the velocity profile, then fit to the nearest named easing — don't keep a bespoke curve per measurement.
- Watch for overshoot (position exceeds the resting value then returns) → model as a spring, not a bezier.
- Measure stagger by the frame offset between successive items' starts.

Video is lower-fidelity than a live trace (frame-rate-limited, no resolved style), so prefer a live URL when both are available.

## Systematize the measurements (same as static tokens)

Measured values are data, not a system. Run the same normalization as `ui-reverse-engineer` Phase 2:

- **Snap durations** to a small ladder (a measured 230ms and 260ms are probably both `base ≈ 240`). Keep deliberate outliers, flag them.
- **Reduce easings** to the named set (`standard` / `decelerate` / `accelerate` / `emphasized` / `spring`). A page full of slightly different curves almost always collapses to 2-3 intents.
- **Express distances** in the spacing base unit.
- **Detect the stagger step** and cap total sequence time.

Emit the same `motion` block (`motion-tokens.md`), but set `$meta.provenance: "measured"` and record the source.

## Verify by round-trip

After building your motion system, re-capture your own output with `motion_capture`/`motion_review` and `motion_diff` it against the source trace. The diff quantifies the match (duration delta, easing mismatch, missing overshoot) and tells you exactly what to correct — the motion analogue of the static skill's render-and-compare loop.

## Honesty note

Even in measure mode, you reconstruct one observed instance. If you measured a hover but not a page transition, the page transition is still *inferred* — track provenance per role, not just per system, when the source only revealed some of its motion.
