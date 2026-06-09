# Motion tokens — scales, roles, and the `tokens.json` block

Motion becomes a *system* the same way spacing does: stop using raw numbers, derive small ladders, and reference them by name everywhere. A component should say `var(--motion-enter)`, never `0.24s cubic-bezier(...)`, exactly as it says `var(--space-2)`, never `8px`.

## The four scales

### 1. Duration scale

A short ladder of named steps, not arbitrary milliseconds. Bigger or further-travelling things take longer; small state flips are near-instant. A defensible default:

| Token | ms | Use |
|---|---|---|
| `instant` | 0 | reduced-motion fallback, immediate state |
| `fast` | 120 | micro-interactions: hover tint, press, checkbox, icon swap (100-150ms band) |
| `base` | 200 | standard UI: tooltips, dropdowns, menus (150-250ms band) |
| `slow` | 280 | larger surfaces: modals, drawers, expand/collapse (200-300ms band) |
| `slower` | 440 | page/route transitions only — the one category that may exceed 300ms |

Keep only the steps the system uses. Snap measured durations to the nearest step; preserve a clearly intentional outlier as an exception (flag it).

**Hard cap: UI animations stay under ~300ms** (Kowalski; corroborated by NN/g — past that, motion stops feeling responsive). The `slower` step exists only for full page/route transitions, a different category. The bands above (micro 100-150, standard 150-250, modals/drawers 200-300) are Emil Kowalski's duration guidelines and make a reliable default. Two scaling rules ride on top: **larger / further-travelling elements animate slower**, and **exits run ~20% faster than their matching entrance**.

### 2. Easing set (named by intent, not one global curve)

| Token | Curve (example) | Use |
|---|---|---|
| `ease-standard` | `cubic-bezier(.2, 0, 0, 1)` | most state changes, on-screen movement |
| `ease-decelerate` | `cubic-bezier(0, 0, 0, 1)` | **entering** — arrives fast, settles soft |
| `ease-accelerate` | `cubic-bezier(.3, 0, 1, 1)` | **leaving** — eases in, exits fast |
| `ease-emphasized` | `cubic-bezier(.2, 0, 0, 1)` (longer dur) | large/hero transitions that need weight |
| `spring` (optional) | stiffness/damping pair | playful systems only; needs JS |

Enter and exit are **asymmetric**: arriving content decelerates, departing content accelerates and is usually quicker. Reduce any measured curves to the nearest named easing — don't keep a dozen bespoke beziers.

**Picking the easing — the strict flowchart (Kowalski).** When you'd otherwise guess, follow this decision tree rather than inventing a curve. `ease-out` is the workhorse; the others are for specific cases:

```
Is the element entering or exiting the viewport?
├── Yes → ease-out          (decelerate; this is the default for most UI motion)
└── No
    ├── Is it moving / morphing on screen?
    │   └── Yes → ease-in-out  (your ease-standard)
    └── Is it a hover change?
        ├── Yes → ease
        └── Is it constant motion (spinner, marquee)?
            ├── Yes → linear
            └── Default → ease-out
```

Note the two coherent philosophies here, and pick one per system rather than mixing them mid-interface: Kowalski uses **`ease-out` for both enter and exit** (simple, hard to get wrong — `ease-decelerate` is an ease-out curve); Material's model keeps the **asymmetric** refinement where exits *accelerate* (`ease-accelerate`, an ease-in) and run faster. Asymmetric reads as slightly more polished; the flat ease-out default is safer when unsure. Either way, **avoid ease-in on entrances** (things arriving should never start slow) and avoid `linear` for anything but constant motion.

**Use strong curves, not the weak built-ins.** The example beziers above are gentle; for UI that feels intentional, prefer punchier custom curves (Kowalski) — e.g. `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`, `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`, `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)` (iOS-like). Find variants on easing.dev / easings.co rather than inventing them. See `craft-tips.md`.

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
    "duration": { "instant": 0, "fast": 120, "base": 200, "slow": 280, "slower": 440 },
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
  --motion-fast: 120ms;  --motion-base: 200ms;  --motion-slow: 280ms;  --motion-slower: 440ms;
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
