# Motion tokens — scales, roles, and the `tokens.json` block

Motion becomes a *system* the same way spacing does: stop using raw numbers, derive small ladders, and reference them by name everywhere. A component should say `var(--motion-enter)`, never `0.24s cubic-bezier(...)`, exactly as it says `var(--space-2)`, never `8px`.

## The four scales

### 1. Duration scale

A short ladder of named steps, not arbitrary milliseconds. Bigger or further-travelling things take longer; small state flips are near-instant. A defensible default:

| Token | ms | Use |
|---|---|---|
| `instant` | 0 | reduced-motion fallback, immediate state |
| `fast` | 120 | small state flips: hover tint, checkbox, icon swap |
| `base` | 200 | the default for most transitions |
| `slow` | 320 | larger surfaces: expand/collapse, sheet, card |
| `slower` | 480 | page/route transitions, hero, emphasized |

Keep only the steps the system uses. Snap measured durations to the nearest step; preserve a clearly intentional outlier as an exception (flag it).

### 2. Easing set (named by intent, not one global curve)

| Token | Curve (example) | Use |
|---|---|---|
| `ease-standard` | `cubic-bezier(.2, 0, 0, 1)` | most state changes, on-screen movement |
| `ease-decelerate` | `cubic-bezier(0, 0, 0, 1)` | **entering** — arrives fast, settles soft |
| `ease-accelerate` | `cubic-bezier(.3, 0, 1, 1)` | **leaving** — eases in, exits fast |
| `ease-emphasized` | `cubic-bezier(.2, 0, 0, 1)` (longer dur) | large/hero transitions that need weight |
| `spring` (optional) | stiffness/damping pair | playful systems only; needs JS |

Enter and exit are **asymmetric**: arriving content decelerates, departing content accelerates and is usually quicker. Reduce any measured curves to the nearest named easing — don't keep a dozen bespoke beziers.

### 3. Distance ladder

How far elements translate on enter/exit, expressed in the **same base unit as the spacing scale** so motion and layout rhyme. E.g. `motion-rise-sm = space-2` (8px), `motion-rise = space-4` (16px). Never invent a separate distance system.

### 4. Stagger step

Per-item delay for sequences, commonly **30-60ms**. Cap the *total* sequence time (e.g. ≤ ~400ms across the visible set) so a long list never feels slow — shrink the step as item count grows.

## Semantic roles

Map the raw scales onto intent names that components reference. This is the layer that keeps usage consistent:

| Role | Resolves to | Applied when |
|---|---|---|
| `motion.hover` | `fast` + `ease-standard` | pointer hover feedback |
| `motion.press` | `fast` + `ease-standard`, small scale | active/press |
| `motion.enter` | `base` + `ease-decelerate` + `rise` | element appears |
| `motion.exit` | `fast` + `ease-accelerate` + `rise` | element leaves |
| `motion.expand` | `slow` + `ease-standard` | collapse/expand, accordion, sheet |
| `motion.page` | `slower` + `ease-emphasized` | route/page transition |

Components reference roles; roles reference scales; scales hold the numbers. Three layers, one source of truth.

## `tokens.json` — the `motion` block

Add alongside the existing `ui-reverse-engineer` keys (`color`, `space`, `type`, `radius`, `responsive`, …):

```json
{
  "motion": {
    "$meta": {
      "personality": "crisp-functional",
      "provenance": "inferred",            // "inferred" | "measured"
      "source": "static mockup, no timing data",
      "reduced_motion": "opacity-only, transforms removed"
    },
    "duration": { "instant": 0, "fast": 120, "base": 200, "slow": 320, "slower": 480 },
    "easing": {
      "standard":   "cubic-bezier(0.2, 0, 0, 1)",
      "decelerate": "cubic-bezier(0, 0, 0, 1)",
      "accelerate": "cubic-bezier(0.3, 0, 1, 1)",
      "emphasized": "cubic-bezier(0.2, 0, 0, 1)"
    },
    "spring": null,                          // or { "stiffness": 300, "damping": 30 }
    "distance": { "rise_sm": "space-2", "rise": "space-4" },
    "stagger": { "step_ms": 40, "max_total_ms": 400 },
    "roles": {
      "hover":  { "duration": "fast",  "easing": "standard" },
      "press":  { "duration": "fast",  "easing": "standard", "scale": 0.98 },
      "enter":  { "duration": "base",  "easing": "decelerate", "distance": "rise" },
      "exit":   { "duration": "fast",  "easing": "accelerate", "distance": "rise" },
      "expand": { "duration": "slow",  "easing": "standard" },
      "page":   { "duration": "slower","easing": "emphasized" }
    }
  }
}
```

`provenance` is required and load-bearing: `"inferred"` means the timings fit the design's taste but were never in the source; `"measured"` means they came from a video/URL trace. Surface this in `design.html`/`motion.md`.

## CSS emission

```css
:root {
  --motion-fast: 120ms;  --motion-base: 200ms;  --motion-slow: 320ms;  --motion-slower: 480ms;
  --ease-standard: cubic-bezier(.2,0,0,1);
  --ease-decelerate: cubic-bezier(0,0,0,1);
  --ease-accelerate: cubic-bezier(.3,0,1,1);
  --motion-enter: var(--motion-base) var(--ease-decelerate);
  --motion-exit:  var(--motion-fast) var(--ease-accelerate);
}
@media (prefers-reduced-motion: reduce) {
  :root { --motion-fast:1ms; --motion-base:1ms; --motion-slow:1ms; --motion-slower:1ms; }
}
```

The reduced-motion override collapsing every duration to ~1ms is the cheapest correct fallback for property transitions; for keyframe/transform animations, also drop translate/scale to opacity-only (see `choreography.md`).
