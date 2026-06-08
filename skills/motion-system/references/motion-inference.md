# Mode INFER — deriving motion from a static design's taste

A static source has no timing. So when you produce motion for it, you are *inventing* — but not freely. The resting design constrains the answer: its density, base unit, accent character, and brand family all imply a motion personality. This reference is the convention library that keeps that invention grounded and defensible, instead of "0.3s ease on everything."

State clearly that this motion is **inferred to fit the design**, not measured from it.

## Step 1 — Read the motion personality off the static tokens

The `ui-reverse-engineer` output already tells you most of what you need:

| Static signal | Points toward |
|---|---|
| Dense layout, small base unit (4px), tight spacing, muted palette | **Crisp / functional** — fast, restrained, near-`standard` easing, no overshoot |
| Generous spacing, large radii, soft shadows, premium type | **Smooth / premium** — slightly longer, emphasized easing, gentle settle |
| Bright accents, rounded everything, playful brand | **Bouncy / playful** — springs, overshoot, expressive distance |
| Data/enterprise tool, high information density | **Functional, fastest** — motion is feedback, never decoration; ≤200ms |
| Editorial / marketing, lots of imagery | **Expressive** — scroll-reveal, parallax (reduced-motion-gated), staged entrances |

Pick one personality and let it set the defaults; don't mix a bouncy hover with an enterprise duration scale.

## Step 2 — Anchor numbers to conventions, not vibes

These are the defensible reference points to snap inferred values to:

- **Perception bands.** Under ~100ms reads as instant (good for direct manipulation). 100-300ms reads as a visible-but-quick transition — where most UI motion belongs. Over ~500ms starts to feel slow unless it's a deliberate hero moment.
- **Platform defaults** are reasonable priors: Material's standard transitions cluster around 200-300ms with emphasized easing; Apple HIG favors quick, physical, spring-like motion. If the design echoes a platform, echo its timing.
- **Hover/press** are the fastest (≤120ms) — they're direct feedback to the user's own action.
- **Enter/exit** sit at the base (~200ms), asymmetric: exits quicker than enters.
- **Expand/collapse and sheets** are slower (~320ms) because more surface moves further.
- **Page/route** transitions are the longest the system should have (~400-480ms).

## Step 3 — Easing by intent

Don't pick a curve by name-recognition; pick it by what the motion *means*:

- Something **arriving** decelerates (fast in, soft settle) — `ease-decelerate`.
- Something **leaving** accelerates (soft start, quick exit) — `ease-accelerate`.
- Something **moving on-screen between states** uses the balanced `ease-standard`.
- **Big/hero** moments use `ease-emphasized` (a longer-duration standard curve) for weight.
- **Springs/overshoot** only for playful personalities — and even then, restrained.

## Step 4 — Distance follows spacing

Inferred travel distances reuse the spacing scale: a card enters by rising `space-4`, a tooltip by `space-2`. Motion that travels a random `12px` when the layout is built on 8s will feel off. Tie distance to the base unit you already extracted.

## What inference does NOT license

- It does not license claiming the source "uses" this motion. The source is silent; you filled the silence tastefully.
- It does not license ignoring `prefers-reduced-motion` — accessibility is not a taste call.
- It does not license decorative motion in a functional UI. When the personality says "feedback only," keep it minimal.

If the user later supplies a video or live URL of the real product, switch to Mode MEASURE (`measuring-motion.md`) and replace the inferred values with measured ones, updating `provenance` to `"measured"`.
