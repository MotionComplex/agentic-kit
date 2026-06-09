---
name: motion-system
description: >-
  Design a coherent motion/animation system for a UI: a set of motion tokens
  (duration scale, easing/spring set, distance ladder) plus the choreography
  patterns and per-state transitions that use them, delivered as an animated
  specimen sheet and ready-to-paste CSS/JS. Works from any design and its
  tokens — a Figma export, a coded UI, a screenshot, or an existing token
  file. Use this skill whenever the user wants to add, design, define, or
  systematize animation for an interface — "how should this animate", "design
  a motion system", "add transitions", "give me motion tokens", "choreograph
  the entrance", "make this feel alive", "animate these components", "what
  easing should I use". For a STATIC source it infers a motion system from the
  design's taste; for a VIDEO or live URL it can measure real timing/easing via
  the motion-trace MCP. Composes with ui-reverse-engineer (whose output it can
  extend in place) and motion-review (which audits existing motion), but needs
  neither to run. Trigger even if the words "skill" or "motion system" aren't
  used, whenever the goal is defining how a UI moves rather than how it looks
  at rest.
---

# Motion System

Design *how a UI moves* as a system, not as one-off `transition: all 0.3s`. The output is a small set of **motion tokens** (durations, easings/springs, distances) plus the **choreography** and **per-state transitions** that consume them — so every animation in the interface is drawn from the same vocabulary, the way every color comes from the same palette.

Where a static design system describes the *resting state* — colors, spacing, type, the component states — this skill defines the *temporal* layer: how the interface transitions between those states. It takes a design and its tokens, and produces the motion vocabulary that animates them. It runs standalone; if you happen to have a `ui-reverse-engineer` output, it extends that in place rather than starting over (see Output structure and Related skills).

## The honesty contract (read first)

Motion has a provenance problem that color does not, so be explicit about where each value comes from:

- **A static source contains no motion.** A screenshot, mockup, or resting-state design tells you *nothing* about timing or easing. Any motion you produce from it is **inferred from convention and taste**, not measured. Say so. Unlike extracting a static design system — where the rule is "measure, don't invent" — here, for static input, you *are* inventing, responsibly.
- **A video or live URL contains real motion.** A screen recording, a Lottie/animation file, or a live interactive page carries actual timing and easing you can *measure*. When you have one, measure it — don't infer.

State which mode you're in up front, and flag every inferred value as inferred. "Here is a motion system that fits this design's taste" is honest; "here is the source's actual motion" is only true in measure mode.

## Inputs and modes

**Mode INFER (static source — the common case).** Input is any resting-state design plus its tokens — a Figma export, a coded UI, a screenshot with hand-written tokens, or a `ui-reverse-engineer` output. You propose a motion system grounded in the design's *taste*: a dense, precise enterprise UI gets fast, restrained, near-linear motion; a playful consumer app gets springier, longer, more expressive motion. The design system itself constrains the answer — base unit, density, accent character, and brand family all imply a motion personality. See `references/motion-inference.md`.

**Mode MEASURE (video / live URL).** Input is a recording or a URL with real animation. Use the **motion-trace MCP** (load via ToolSearch if deferred: `motion_discover`, `motion_capture`, `motion_review`, `motion_diff`, `motion_prompt`) to extract resolved per-frame state — real durations, easing curves, overshoot — reading the page rather than guessing from pixels. Then *systematize* the measured values into tokens exactly as you would raw spacing. See `references/measuring-motion.md`.

Both modes converge on the same output: a normalized motion-token layer plus the patterns that use it.

## What you produce

1. **Motion tokens in `tokens.json`** — a `motion` block added to the existing design tokens: a **duration scale**, an **easing/spring set**, a **distance ladder** (how far things travel), stagger steps, and named **semantic roles** (see Phase 3). The reusable source of truth; everything else references it.
2. **`motion.html` — the animated specimen sheet.** The motion counterpart to `design-system.html`: each duration, each easing curve (plotted *and* demonstrated on a moving element), each named pattern (enter / exit / hover / press / expand / stagger) shown live and replayable. This makes the system confirmable *before* it's wired into the real UI. Include a **prefers-reduced-motion** toggle that shows the reduced variant of every pattern.
3. **Per-state transitions on the components** — the transitions *between* the component states (default ↔ hover ↔ focus ↔ active ↔ disabled, collapsed ↔ expanded, entering ↔ leaving), whether those states were enumerated by a prior reverse-engineer run or read off the components you were given. Motion is the verb connecting the states.
4. **Choreography patterns** — reusable recipes for multi-element motion: list/grid **stagger**, **shared-element** transitions, page/route enter-exit, modal/sheet present-dismiss, scroll-reveal. Delivered as copy-pasteable CSS (custom properties + keyframes) and, where CSS can't express it (springs, FLIP, sequenced timelines), a small framework-agnostic JS helper.
5. **A short rationale** (fold into the existing `design.html` if present, else a `motion.md`): the motion personality in a line, the inferred-vs-measured split, key decisions, and a copyable reuse prompt.

## The pipeline

The mental model mirrors how a static design system is extracted: **Triage → Source → Systematize → Map to states → Choreograph → Build → Verify.**

### Phase 1 — Triage (decide what animates, before how)

Allocating motion is a design decision that precedes timing. Animating everything is as wrong as animating nothing — so first decide *which moments earn motion*, then tune *how* they feel. Work through `references/when-to-animate.md`:

- Split candidates into **functional** (guides/informs/gives feedback — allowed by default) and **decorative** (brand/delight — must justify a non-disruptive, low-frequency moment).
- For each kept animation, name the **job** it does — one of expectation, continuity, narrative, relationship (Willenskomer's four usability purposes). If you can't name the job, cut it.
- Note whether it's **real-time** (instant feedback to manipulation — almost always worth it, must be fast) or **non-real-time** (plays after an action, is latency the user can't skip — budget carefully).
- Set the budget by **frequency and density**: high-frequency / dense interactions get terse, near-instant motion or none; rare, high-ceremony moments can be expressive.

Output a **motion map**: the moments that get motion, each tagged with its job, kind, and rough budget. Phases 4-5 build *only* what this approves — not every state pair.

### Phase 2 — Source the timing (infer or measure)

- **INFER:** read the design's taste from its tokens and any design rationale you have (family, density, accent, brand — e.g. a `ui-reverse-engineer` `design.html`, if one exists). Derive a **motion personality** (e.g. "crisp/functional", "smooth/premium", "bouncy/playful") and the timing implications. Do not pull numbers from thin air — anchor them to the conventions in `references/motion-inference.md` (platform defaults, the 200-300ms "feels instant but visible" band, easing-by-intent).
- **MEASURE:** `motion_discover` the URL, `motion_capture`/`motion_review` the relevant elements, and record real durations, easing, distances, and overshoot. Note `prefers-reduced-motion` handling if present.

Output a written **motion spec** (the durations/easings/distances you're working from, with each marked *inferred* or *measured*) before systematizing.

### Phase 3 — Systematize (raw timing → motion tokens)

Same move as static token extraction, applied to time. A pile of durations is not a system.

- **Duration scale.** A small ladder, not arbitrary ms. A common, defensible base: `instant 0`, `fast 120`, `base 200`, `slow 320`, `slower 480`. Bigger/further travel → longer duration. Snap measured values to the nearest step; flag deliberate outliers.
- **Easing set.** A *named* set tied to intent, not one global curve: **standard** (most state changes, e.g. `cubic-bezier(.2,0,0,1)`), **decelerate/enter** (things arriving), **accelerate/exit** (things leaving), **emphasized** (large or hero transitions), and optionally a **spring** (stiffness/damping) for playful systems. Reduce measured curves to the nearest named easing; don't keep 12 bespoke beziers.
- **Distance ladder.** How far elements translate on enter/exit, expressed in the *same base unit* as the spacing scale (e.g. enter from `space-4` below). Motion distance and layout spacing should rhyme.
- **Stagger step.** The per-item delay for sequences (commonly 30-60ms).
- **Semantic roles.** Map raw scales to intent names the components will reference: `motion.hover`, `motion.press`, `motion.enter`, `motion.exit`, `motion.expand`, `motion.page`. Components reference roles, never raw ms — exactly as they reference `space-2`, never `8px`.

See `references/motion-tokens.md` for the schema and the `tokens.json` `motion` block.

### Phase 4 — Map motion to states

For each state pair **the Phase 1 triage approved** (not every possible pair — only the moments with a named job), define the transition: which properties animate, which role/duration/easing applies, and the reduced-motion fallback. State pairs triage left out stay instant. Principles:

- **Animate cheap properties.** `transform` and `opacity` only, wherever possible — they're GPU-composited and don't trigger layout. Avoid animating `width`/`height`/`top`/`left`/`box-shadow` directly; use `transform: scale/translate`, and FLIP for layout changes.
- **The same logical transition re-expresses in every form the component takes.** Just as a "selected" state must read across breakpoints, its *transition* must too — a nav item's selection animation shouldn't vanish when it becomes a rail item.
- **Asymmetric enter/exit.** Things enter with decelerate easing (arriving, settling) and leave with accelerate easing (departing), usually faster on exit. Don't use one symmetric curve for both.

### Phase 5 — Choreograph (multi-element motion)

Move from single transitions to coordinated sequences:

- **Stagger** lists/grids so items arrive in sequence, not all at once (cap total sequence time so it never feels slow).
- **Shared-element / FLIP** for elements that persist across a state change (a card expanding into a detail view) — measure first/last rects, animate the delta on `transform`.
- **Choreography hierarchy:** primary content leads, secondary/chrome follows. Define enter order, not just per-element timing.
- **Orchestrate present/dismiss** for overlays (modal, sheet, popover) including the scrim, and respect any responsive size-class substitutions in the design (a bottom sheet and a centered dialog present differently).

### Phase 6 — Build

- Emit tokens as CSS custom properties (`--motion-fast`, `--ease-standard`, `--motion-enter` …) and/or a JS token object for spring/FLIP helpers.
- Build the `motion.html` specimen sheet: every token and pattern shown **live and replayable**, with the reduced-motion toggle.
- Wire per-state transitions and choreography onto the reconstruction's components.
- Keep it framework-agnostic single-file CSS/JS unless the user asks for a stack (Framer Motion, GSAP, Web Animations API, CSS-only).

### Phase 7 — Verify (watch it, don't imagine it)

Motion cannot be verified from a static render — you must see it move.

1. Render the specimen and the wired components, and **watch the animation** — via the browser tooling (navigate + record), or by capturing it with the **motion-trace MCP** (`motion_capture`/`motion_review`) for a numeric read on what you actually produced.
2. Check: nothing janky (dropped frames / layout thrash), durations inside the intended band, enter/exit asymmetry present, stagger reads as a sequence not a stutter, and — non-negotiable — **`prefers-reduced-motion: reduce` is honored** (transforms replaced by instant/opacity-only, no parallax or large travel).
3. In measure mode, optionally `motion_diff` your output against the source trace to quantify the match. Fix deltas, re-watch.

## Non-negotiables (the anti-slop list)

- **Every animation has a nameable job.** If it doesn't serve expectation, continuity, narrative, or relationship, it's decoration — cut it or confine it to a rare, non-disruptive moment. Motion is behavior, not garnish.
- **Don't animate high-frequency actions into latency.** Motion on a thing the user does dozens of times a day is a tax paid repeatedly; keep those near-instant. Allocate expressive motion to rare, high-ceremony moments.
- **Tokens, not magic numbers.** No `transition: all 0.3s ease` sprinkled per element. Everything references a named role.
- **No `transition: all`.** Name the properties; `all` animates unexpected things and forces layout/paint.
- **Animate transform + opacity.** Layout-triggering properties cause jank; use compositor-friendly properties and FLIP.
- **Respect `prefers-reduced-motion`.** First-class, defined for every pattern — not an afterthought. Reduced means *reduced* (instant or opacity-only), not "slightly less".
- **Asymmetric, intent-driven easing.** Enter decelerates, exit accelerates; pick easing by what the motion *means*, not one global curve.
- **Don't overshoot a serious UI.** Springiness/bounce is a taste signal — appropriate for playful consumer apps, wrong for dense/enterprise tools. Match the design's personality.
- **Keep it fast.** Most UI transitions live in 150-300ms. Long, showy motion that slows the user down is slop, not polish.
- **Be honest about provenance.** Inferred motion is labelled inferred; only measure mode may claim to reproduce the source's real motion.

## Output structure

```
<taste-or-app-name>/
├── tokens.json          # gains a `motion` block (source of truth) — extends the ui-reverse-engineer file
├── motion.html          # animated specimen sheet: every token + pattern, live + replayable, with reduced-motion toggle
├── motion.css           # custom properties + keyframes + per-state transitions (paste-ready)
├── motion.js            # optional: spring / FLIP / sequenced-timeline helpers where CSS can't express it
└── motion.md            # rationale: personality, inferred-vs-measured, decisions, reuse prompt (or fold into design.html)
```

If a `ui-reverse-engineer` output already exists, extend it in place (add the `motion` block to its `tokens.json`, add `motion.html`, wire the transitions onto its `components.html`) rather than starting a parallel folder.

## References

- `references/when-to-animate.md` — Phase 1 triage: functional vs decorative, the four usability purposes, real-time vs non-real-time, the animate / don't-animate checklist, and the accessibility gate. The "what should move" decision framework, with sources.
- `references/motion-inference.md` — Mode INFER: reading motion personality from a static design's taste, platform-default timings, the duration bands, easing-by-intent, and a sourced further-reading list. The convention library that keeps inferred motion grounded.
- `references/measuring-motion.md` — Mode MEASURE: using the motion-trace MCP to extract real timing/easing from a video or live URL, and reducing measured curves to the named easing set.
- `references/motion-tokens.md` — the duration/easing/distance/stagger scales, semantic roles, and the `tokens.json` `motion` block schema.
- `references/choreography.md` — stagger, shared-element/FLIP, present/dismiss, and scroll-reveal recipes, with the reduced-motion variant of each.

## Related skills

- `ui-reverse-engineer` — extracts the static design system this skill animates. Run it first (or accept its output) for the tokens and component states.
- `motion-review` (motion-trace plugin) — *audits/scores* existing motion. Use it to verify this skill's output, or to review motion you didn't build.
