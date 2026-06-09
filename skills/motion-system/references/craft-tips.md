# Craft — what separates good motion from great

Tokens and triage get you a *correct* motion system. They don't get you one that *feels* great. The gap is craft: a set of small, specific, often non-obvious decisions practitioners arrive at through experience. This reference collects those — drawn largely from Emil Kowalski's design-engineering skill and writing (Linear design engineer; author of Sonner, Vaul, and the animations.dev course).

Three convictions underpin all of it:

- **Taste is trained, not innate.** It's the ability to see *why* something feels good and articulate it as a rule — so it can be made strict and followed. Almost every "taste" decision has a logical reason if you look closely enough.
- **Unseen details compound.** Most of these the user never consciously notices; that's the point. "A thousand barely audible voices all singing in tune" (Paul Graham). The aggregate of invisible correctness is what makes an interface feel right.
- **Beauty is leverage.** When everyone's software is functional, the experience is the differentiator. Good defaults and good motion are underused advantages.

Apply this as a **craft pass** in the Build phase: after tokens and per-state transitions are wired, walk the interface and apply these.

## The "feel" tips (apply by default)

| Symptom / scenario | Fix |
|---|---|
| Element appears "from nowhere" | Animate in from `scale(0.95)` + `opacity: 0`, **never** `scale(0)`. Real objects never shrink to nothing — a deflated balloon still has a shape. |
| Button feels dead / unresponsive | `transform: scale(0.97)` on `:active` (subtle, 0.95-0.98). Instant feedback that the UI heard the press. |
| Animation looks shaky / jittery | `will-change: transform` to promote it to its own layer. |
| Hover transition flickers | Animate the **child**, not the parent — a parent hover style can re-trigger as the pointer crosses child boundaries. |
| Popover/menu scales from the wrong spot | `transform-origin` to the **trigger** location (e.g. `var(--radix-popover-content-transform-origin)`). **Modals are the exception** — they stay `center`, since they aren't anchored to a trigger. |
| Sequence of tooltips feels slow | Keep the initial open delay; after the first, open subsequent tooltips with **no delay and no animation** while the user stays in the group (`[data-instant] { transition-duration: 0ms }`). |
| Hover animation fires on touch tap | Gate it: `@media (hover: hover) and (pointer: fine)`. Touch devices trigger hover on tap → false positives. |
| Crossfade between two states looks off | Add `filter: blur(2px)` during the transition — it blends the two overlapping states into one perceived transformation. Keep blur under ~20px (heavy blur is expensive, especially in Safari). |
| Small control hard to tap | ≥44px hit area via a pseudo-element, without changing visual size. |

Defaults, not laws — each has a reason, so deviate only with a reason.

## Easing: use strong *custom* curves, and never `ease-in`

The most important single decision in an animation is its easing — and the **built-in CSS easings are too weak**; they lack the punch that makes motion feel intentional. Use stronger custom curves (find variants on easing.dev / easings.co rather than inventing them):

```css
--ease-out:    cubic-bezier(0.23, 1, 0.32, 1);     /* strong ease-out — the UI workhorse */
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);    /* strong, for on-screen movement */
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);     /* iOS-like drawer/sheet (from Ionic) */
```

**Never use `ease-in` for UI.** It starts slow, so the interface feels sluggish at the exact moment the user is watching most closely. A dropdown with `ease-in` at 300ms *feels* slower than `ease-out` at the same 300ms. `ease-out` starts fast → reads as an immediate response. (This is also why fast motion improves *perceived* performance — a faster spinner makes loading feel faster even when it isn't.)

The strict picker lives in `motion-tokens.md` (the easing flowchart). The short version: enter/exit → ease-out; on-screen move/morph → ease-in-out; hover/color → ease; constant motion → linear.

## Springs — for motion that should feel alive

Springs simulate physics, so they feel more natural than fixed-duration curves and they **keep velocity when interrupted** (CSS keyframes restart from zero). Reach for them for drag/gesture momentum, interruptible motion, and "alive" elements (Apple's Dynamic Island). Configure them the easy way:

```js
{ type: "spring", duration: 0.5, bounce: 0.2 }   // Apple-style — easy to reason about
{ type: "spring", mass: 1, stiffness: 100, damping: 10 }  // traditional, more control
```

Keep `bounce` subtle (0.1-0.3) and avoid it in most UI — reserve overshoot for playful/drag interactions. Spring-driven mouse-tracking (`useSpring`) feels natural *because it's decorative*; a functional graph in a banking app wants no such motion. Know when physics helps and when it's noise.

## Interruptibility — transitions over keyframes for stateful UI

A user must be able to reverse or redirect a motion mid-flight and have it glide from wherever it is (open something, immediately press Escape → it smoothly reverses). **CSS transitions are interruptible and retarget smoothly; `@keyframes` restart from zero.** So for anything rapidly triggered or reversible (toasts, toggles, open/close, drag), use `transition` (or a spring lib). Reserve keyframes for fire-and-forget motion that won't be reversed.

```css
/* interruptible — good for dynamic UI */ .toast { transition: transform 400ms ease; }
/* not interruptible — avoid for dynamic UI */ @keyframes slideIn { from { transform: translateY(100%); } to { transform: none; } }
```

## Asymmetric timing — slow where deciding, fast where responding

Exits generally run faster than their entrance (~20% is a good default). The deeper rule: motion is **slow where the *user* is deliberating, fast where the *system* is responding.** Hold-to-delete fills over ~2s (deliberate), but release snaps back in ~200ms (response). Apply the same logic anywhere a press is intentional and the release is acknowledgement.

## Modern CSS techniques worth knowing

- **`@starting-style`** animates element *entry* with no JavaScript — define the entered state, then the starting state in `@starting-style`. Replaces the `useEffect(() => setMounted(true))` / `data-mounted` dance where browser support allows (keep the data-attr fallback otherwise).
- **`translateY(100%)`** moves an element by *its own height*, so a drawer/toast hides itself regardless of size — how Sonner and Vaul position. Prefer percentages over hardcoded pixels.
- **`scale()` scales children too** (unlike width/height) — a feature when scaling a button on press (icon + text scale with it).
- **`clip-path: inset(...)`** is a powerful, hardware-accelerated animation tool, not just a shape mask: directional reveals, seamless tab color transitions (duplicate + clip the active copy), hold-to-delete fills, before/after comparison sliders, scroll image reveals.

## Performance — 60fps or none of the above matters

- **Animate `transform` and `opacity` only.** They hit just the composite step; `width`/`height`/`margin`/`padding`/`top` trigger layout + paint + composite.
- **Prefer hardware-accelerated CSS or WAAPI over JS rAF loops.** Framer/Motion's shorthand `x`/`y`/`scale` props are *not* hardware-accelerated (they run `requestAnimationFrame` on the main thread) — use the full `transform: "translateX(100px)"` string for HW acceleration. CSS/WAAPI stay smooth when the main thread is busy (page load, scripts) — exactly when layout animations drop frames. (Real example: Vercel's dashboard tab animation dropped frames on navigation until it moved from Shared Layout Animations to CSS.)
- **CSS variables are inheritable** — setting `--swipe-amount` on a container recalculates styles for *every* child. During a drag, set `transform` directly on the element instead of a parent variable.
- **WAAPI** gives JS control with CSS performance — hardware-accelerated, interruptible, no library: `el.animate([{clipPath:'inset(0 0 100% 0)'},{clipPath:'inset(0 0 0 0)'}], {duration:1000, fill:'forwards', easing:'cubic-bezier(0.77,0,0.175,1)'})`.

## Gestures & drag (drawers, sheets, swipe-to-dismiss)

- **Momentum dismissal** — don't require crossing a fixed distance threshold; compute `velocity = |distance| / elapsedMs` and dismiss if it exceeds ~0.11. A quick flick should be enough.
- **Damping / friction at boundaries** — when dragging past a natural edge, move the element *less* the further they drag, rather than a hard wall. Things in the real world slow before they stop.
- **Pointer capture** once a drag starts, so it continues if the pointer leaves the element.
- **Multi-touch protection** — ignore extra touch points after the drag begins, or the element jumps to a new finger.

## Accessibility (a gate, not a preference)

`prefers-reduced-motion` means **fewer and gentler** animations, not necessarily zero. Keep opacity/color transitions that aid comprehension; remove *movement* and *position* (transform) animation, parallax, and large scale/zoom. Large motion can make people physically ill, so this is non-negotiable.

```css
@media (prefers-reduced-motion: reduce) { .element { animation: fade .2s ease; /* no transform-based motion */ } }
```

## Reviewing motion — the Before/After/Why table

When reviewing existing animation code, output findings as a **markdown table** with `Before | After | Why` columns (one row per issue), not loose prose. It makes each fix and its reason scannable. Common issues to check: `transition: all` (→ name properties), `scale(0)` entry (→ `scale(0.95)`+opacity), `ease-in` on UI (→ `ease-out`/custom), `transform-origin: center` on a popover (→ trigger origin; modals exempt), animation on a keyboard action (→ remove), duration >300ms on UI (→ 150-250ms), hover without the `(hover: hover)` query, keyframes on rapidly-triggered elements (→ transitions), Framer `x`/`y` under load (→ `transform` string), symmetric enter/exit (→ faster exit), everything appearing at once (→ stagger 30-80ms).

## Verifying motion — look closely

Don't trust full-speed playback. **Slow the animation 2-5×** (or use the DevTools Animations panel) and watch for: two distinct states overlapping in a crossfade, abrupt start/stop easing, a wrong transform-origin, and multiple animated properties (opacity/transform/color) falling out of sync. **Step frame-by-frame** for coordinated-property timing. **Test gestures on real devices**, not just the simulator. And **review the next day with fresh eyes** — you'll catch what you missed while building.

## How this fits the rest of the system

`motion-tokens.md` gives the vocabulary; `when-to-animate.md` decides what moves; this file is the **finishing craft** that makes the approved, tokenized motion actually feel great. When a wired animation is technically correct but flat, the fix is almost always one of the items above.

## Sources

- Emil Kowalski — **design-engineering skill** (the most complete source for the above): https://github.com/emilkowalski/skill — installable via `npx skills add emilkowalski/skill`.
- Emil Kowalski — [Great Animations](https://emilkowal.ski/ui/great-animations) (natural / fast / purposeful / performant / interruptible / accessible / feels-right).
- Emil Kowalski — [Agents with Taste](https://emilkowal.ski/ui/agents-with-taste) (packaging taste into agent skills; practical tips, easing flowchart, durations; "articulate the why, be strict").
- Emil Kowalski — [You Don't Need Animations](https://emilkowal.ski/ui/you-dont-need-animations) (purpose + frequency; never animate keyboard actions).
- Emil Kowalski — [animations.dev](https://animations.dev/) (the full course); easing curve resources: [easing.dev](https://easing.dev/), [easings.co](https://easings.co/).
