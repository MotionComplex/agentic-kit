---
name: ui-reverse-engineer
description: >-
  Reverse-engineer any UI screenshot or design image into a faithful, disassembled
  reconstruction: the individual components rebuilt in isolation, the assembled
  composition, the bare layout skeleton, and an extracted design-token system. Use
  this skill whenever the user supplies a UI screenshot, app screen, website shot,
  Dribbble or Figma image, or any interface mockup and wants to recreate it, match
  it, rebuild it, clone the style, "extract the design system," "break it into
  components," "disassemble the UI," "what is this made of," or build a taste or
  component library from it — even if they never say the words "skill" or "pipeline."
  Trigger for phrases like "match this screenshot," "rebuild this interface,"
  "recreate this UI," "extract the tokens/taste from this image," or "show me the
  components this is built from."
---

# UI Reverse-Engineer

Turn a UI screenshot into a faithful, disassembled reconstruction. The hard part — and the point — is the **disassembled view**: each component rebuilt in isolation so it independently matches the source.

## The fidelity contract (read first)

Separate two things and treat them differently:

- **Structure must match exactly.** Layout grid, geometry of every shape, material (glass, shadow, blur), corner radii, type system, proportions, spacing rhythm. This is non-negotiable and is what "match" means.
- **Content only has to be category-correct.** The literal face, photo, or copy can be substituted, but the *category* must be right: a portrait where a portrait belongs, a contour map where a map belongs, a city street where a hero photo belongs. A landscape inside a person-avatar is a failure even though it's "an image."

When you tell the user what you're doing, state this split. It is the difference between "match the form, swap the content" and a brittle pixel trace.

## What you produce

The flow is: foundations → components → composition. Each stage visibly inherits from the one before it.

1. **`design.html`** — the **index / front door**, generated last but listed first. A short, browsable overview: the design read (taste/family in a line), key decisions and **flagged inferences** (what was *invented* vs extracted — e.g. the desktop layout), source-screen mapping, a few live swatch/type samples, links into all the files below, and a **copyable reuse prompt** (in a `<pre>`, selectable, for pasting into another AI). It's the rationale hub, not a re-listing of tokens. Open this first.
2. **`tokens.json`** — the extracted design system as data (see Phase 2). The reusable source of truth; everything is built from it.
3. **Design-system sheet** — a *visual* rendering of those tokens: the breakpoint ladder, the column grid, the spacing scale, the type scale, color roles, radii, control sizes, and material samples, shown as tables/specimens. This makes the extracted system explicit and confirmable *before* any component is built. The same tokens then visibly drive the components and the final composition.
4. **Components** — every distinctive element rebuilt as its own isolated, labelled instance, **built as a responsive component** (see Phase 5), and **shown in its states** (normal / hover / focus / active / disabled, wherever it has them) as labelled instances side by side. This is the deliverable that matters most; each must stand on its own and adapt on its own. Read the *active/selected* treatment off the source rather than imposing a rule — e.g. a tab whose active state is an expanded dark pill with a label is state-driven disclosure, not a separate accent.
5. **Composition** — those same components assembled into the screen, faithful to one specific source screen (do not merge multiple screens into a hybrid).
6. **Layout skeleton** — the composition with skin removed, derived from the *same grid* so it inherits alignment.

The reconstruction is **responsive**, not single-width. A design system that only exists at one viewport isn't fully extracted. Infer the source's native breakpoint, then adapt the screen across the breakpoint ladder (mobile up to desktop, or desktop down to mobile, whichever directions the user needs). Deliver a real responsive HTML file (media queries that reflow) plus a multi-frame board showing the screen at mobile / tablet / desktop side by side. See `references/responsive-system.md`.

## The pipeline

Run these phases in order. Every phase has a job; skipping one is where fidelity dies. The mental model: **Measure → Systematize → Decompose → Classify → Build → Verify.** Raw pixels enter at Phase 1 and never reappear after Phase 2 — everything downstream speaks in tokens.

### Phase 1 — Measure (observe, do not interpret)

Extract ground-truth from the pixels. Do not build from a memory of "the look" — only from measured values. Capture, per the source image:

- Device/frame size, the content safe-margins, and the column structure.
- Sampled color values (read actual hex from the pixels, not a guess).
- Corner radii, stroke widths, shadow direction/spread/softness.
- Type: sizes, weights, tracking, and **identify the typeface** — a screenshot has no font metadata, so: (1) if the source *labels* the font, use it; (2) else read letterform tells (single/double-story `a`/`g`, the `R` leg, `t` terminal, `1` shape, dot shape, x-height, contrast) to name a family-class + best-guess face; (3) record a **confidence** and 2-3 candidates, since plain UI sans (Inter/SF Pro/Helvetica Now/Roboto) are near-identical and often unknowable exactly. Then load the nearest free webfont and flag it as inferred.
- For every surface, classify what it *is*: photo, vector/illustration, text, or material effect.
- Note which elements are **full-bleed** (touch the screen edges, ignoring the safe margin — hero photos, edge-to-edge charts/media) vs **inset** (sit within the margin). Full-bleed is a deliberate treatment; don't quietly cap a bleeding element to a centered box, and on larger viewports a full-bleed element often becomes contained once it sits inside a defined panel.
- The geometry of each distinctive shape (lobe count, gaps, proportions).

Output a written **spec sheet** of raw values before going further.

### Phase 2 — Systematize (raw values → design system)

Measurement is data, not a system, and raw pixels are brittle. Normalize them so the reconstruction is scalable, internally consistent, and reusable. This phase is what turns "trace one artboard" into "extract the system that generated it."

- **Infer the base unit.** Find the dominant spacing increment (commonly 4 or 8). A measured 17px is almost certainly `2 × 8` with rounding noise.
- **Derive the scales.** Spacing ladder, type scale (find the ratio), radius ladder, elevation/shadow steps, color roles (bg, surface, ink, muted, line, one accent).
- **Snap, then flag.** Snap each raw reading to the nearest scale step *within tolerance*. Values that sit clearly off the dominant scale are **intentional outliers** — flag and preserve them as deliberate exceptions, don't force-snap them. System where possible, exception where intended.
- **Emit tokens + ratios**, not absolute pixels. Everything downstream references `space-2`, `radius-lg`, `text-xl`, never `17px`.
- **Infer the native breakpoint.** Which viewport was this source designed at — mobile, tablet, or desktop? That sets the anchor. Then record the responsive token layer: the breakpoint ladder and how type/space/density scale across it. This is the same systematizing move, applied to width. See `references/responsive-system.md`.

This step alone prevents the alignment drift that comes from hand-placed values like `left: 16 / 18 / 20 / 22` — snapped to one token, that drift is impossible by construction. See `references/token-extraction.md` for the base-unit and scale-inference method and the `tokens.json` schema.

### Phase 3 — Decompose (component inventory)

List every component with its bounding box, its states/variants, and its parameters (a chip = label + optional dot + live/idle state). This inventory *is* the disassembled view — you are naming exactly what must be rebuilt in isolation.

**Capture the hierarchy, not just a flat list.** Components nest (atomic-design: atoms → molecules → organisms). An icon-button + a label compose a *nav item*; nav items compose a *navigation bar*; the bar is a component too, not just a container. So decompose at every level: record the atoms, and record the **composites** (nav bar, list row, toolbar, card) as their own components, noting which parts they're built from. The components view should show both — the atoms *and* the composites that assemble them — so the build reuses the atoms inside the composites rather than re-inventing them.

### Phase 4 — Classify construction method

For each element, choose the right primitive. Choosing wrong guarantees "almost but off." See `references/construction-methods.md` for the full decision table; the short version:

- **Layout** → token-driven grid/flow. Never absolute pixel placement.
- **Plain surfaces** → CSS boxes.
- **Signature / organic geometry** (cutouts, scalloped shapes, morphs) → **parametric SVG** built from math (equal angles, equal radii, smooth joins). Never eyeballed.
- **Material effects** (glass, etc.) → an effect recipe *plus its precondition*. Glass is meaningless without a textured backdrop behind it.
- **Illustration** (maps, charts, diagrams) → drawn vector. Never a substituted photo.
- **Photographic slots** → category-correct generated/sourced assets. Never random.
- **Type** → load the real or nearest-equivalent webfont. Never rely on a fallback for display type.

### Phase 5 — Build & adapt (foundations → responsive components → composition)

Build in three stages, each visibly inheriting from the last. Responsiveness is handled **component-first**, in two layers (see `references/responsive-system.md`):

**Stage A — Foundations.** Turn tokens into code variables, **load the fonts**, **generate/collect category-correct assets**, and render the **design-system sheet** (the visual of the grid, spacing scale, type scale, color, radii, material). Confirm the system reads right before building on it.

For the **wrapper deliverables** — `design.html` (index), `design-system.html` (this sheet), and `board.html` (multi-frame) — start from the shells in `templates/` rather than re-deriving the scaffold each run. Copy the template, fill its `{{PLACEHOLDERS}}` from `tokens.json`, and fill its `<!-- REGION -->` blocks with one specimen per token the source actually uses. This keeps section order, naming, and structure identical across runs. The **reconstruction deliverables** — `components.html`, `composition.html`, `skeleton.svg` — have **no template** and are generated fresh, because they must match the source, not a fixed mold. See `templates/README.md` for the fill contract.

**Stage B — Responsive components (Layer 1, intrinsic).** Build each component in isolation as a *responsive component* that owns its own behavior across sizes:
- **Fluid to its slot** — it fills the space it's given. Do NOT put a fixed width or a per-component `max-width` on it (that's what strands a component in a wide column). Internals fill too: a waveform's bars grow/`flex` to the width rather than being a fixed count at a fixed width.
- **Progressive disclosure** — reveal/hide parts by available space (icon-only when narrow → icon+label when wide), including *state-driven* disclosure (e.g. the selected item shows its label even in the compact form).
- **States are first-class** — default / selected / hover / focus / disabled are defined as part of the component, and the *same logical state re-expresses in every form* the component takes. A "selected" nav item must read as selected whether it's a pill, a rail item, or a sidebar row.
- Aspect-ratio-sensitive illustration (charts, spheres) must **preserve or redraw** their aspect ratio, never force-stretch (`preserveAspectRatio="none"` across changing box ratios distorts and overflows).

**Stage C — Composition (Layer 2, relational).** Assemble the source screen, then adapt across breakpoints by *recomposing, not stretching*:
- **Cap the container and the text measure, not the components.** A content container maxes (~1200–1440px) then centers; text caps (~65–75ch). Components stay fluid and fill their (now-bounded) slots.
- **Substitution where a function changes form.** Some functions are realized by *different components* per size class — bottom tab bar ↔ nav rail ↔ sidebar; full-screen sheet ↔ dialog. Pick the size-appropriate component via the equivalence map. This is a composition decision, not the component's job.
- **Decide reflow-vs-replace per function per threshold.** Within a form a component reflows (Layer 1); crossing a threshold the composition may swap it (Layer 2). A single function (e.g. nav) often uses both.
- Down-adaptation (desktop → mobile) is largely deterministic collapse; **up-adaptation (mobile → desktop) is partly inferential** — you are inventing layout the source never showed, so lean on the map + the taste and verify hard.

Then derive the skeleton from the same grid. See `references/material-recipes.md` for effect stacks and `references/responsive-system.md` for the two-layer model, the breakpoint ladder, and the component map.

### Phase 6 — Verify (render → compare → correct)

This is the step that converts "approximation" into "match," and the one most often skipped. **Do not declare done from imagination — render and look.**

1. Render the output to an image using the browser tooling (navigate to the file, screenshot it). Load the browser tools via ToolSearch if they are deferred. Render **at each target breakpoint** (resize the viewport), not just one width.
2. Place the render beside the source and check the deltas in `references/acceptance-criteria.md`: grid alignment, proportions, sampled colors, radii, presence/quality of each material, geometric symmetry, type, and any overflow/overlap. At non-native breakpoints, also verify the adaptation is sound — correct component substitutions, no stretched mobile layout masquerading as desktop, no overflow.
3. List the deltas, fix them, re-render. Repeat until inside tolerance.

If the environment genuinely has no rendering capability, say so and ask the user to eyeball the render — never silently ship unverified.

## Non-negotiables (the anti-slop list)

These are the specific failure modes that wreck fidelity. Internalize the *why*:

- **Glass needs a backdrop.** `backdrop-filter` only frosts *non-uniform* content behind the element — blurring a flat fill produces no visible change — so a glass element (including an isolated specimen) must sit over a photo/gradient/texture. The only mechanical requirements are a translucent (not opaque) fill plus the blur. The edge treatment (1px inner-light border, inner top highlight, tinted shadow, `saturate()`) is one *style* — glossy/refractive glass; flat frosted glass omits all of it. Measure which style the source uses and don't stamp edge-lighting on by default.
- **No random images.** Subject category must match the slot. Generate or source accordingly; an illustrated element (map, chart) is drawn as vector, not faked with a photo.
- **No eyeballed geometry.** Signature shapes are parametric and symmetric. "Almost right" reads worse than honestly stylized.
- **No absolute pixel placement for layout.** One safe-margin, one gutter value, vertical rhythm, normal flow. This is the cure for misalignment and overlap.
- **Load real type.** The "premium" feel of most sources is largely the typeface; fallbacks erase it.
- **Don't conflate screens.** Reproduce one source screen faithfully rather than a hybrid that matches none.
- **Respect the height budget.** Composition content must fit without elements overlapping or clipping.
- **Cap the container, not the component.** Width limits belong on layout containers and text measure; components fill their slot. A per-component `max-width` strands it in a wider column with dead space.
- **States travel with the component.** When a component changes form across breakpoints, its selected/active/hover/disabled states must re-express in the new form, not get re-improvised. And distinguish brand/structural elements from stateful ones (a logo is not a selected tab).
- **Don't stretch aspect-sensitive art.** Charts, spheres, and diagrams preserve or redraw their aspect ratio; never `preserveAspectRatio="none"` across a changing box.

## Output structure

```
<taste-or-app-name>/
├── design.html          # [template] INDEX / front door: design read, decisions, inferences, links, reuse prompt (open first)
├── tokens.json          # extracted design system, as data (source of truth)
├── design-system.html   # [template] VISUAL of the tokens: breakpoints, grid, spacing, type, color, radii, control sizes, material
├── components.html      # [generated] disassembled, isolated, responsive component instances + states + composites (the priority)
├── composition.html     # [generated] one source screen, assembled + adapted across breakpoints
├── board.html           # [template] multi-frame board: composition.html iframed at mobile / tablet / desktop
└── skeleton.svg          # [generated] layout skeleton derived from the same grid
```

`[template]` files start from the shells in `templates/` (wrapper chrome — fill placeholders + regions). `[generated]` files are built fresh from the tokens so they match the source. See `templates/README.md`.

A single combined board (components → composition → skeleton in three labelled zones) is also fine if the user prefers one file per screen. Default to framework-agnostic single-file HTML/CSS unless the user asks for a specific stack.

## References

- `references/token-extraction.md` — Phase 2 in depth: base-unit inference, scale derivation, snapping tolerance, outlier handling, `tokens.json` schema.
- `references/construction-methods.md` — Phase 4 decision table: element type → primitive, with rationale and gotchas.
- `references/material-recipes.md` — Phase 5 effect stacks: glassmorphism (with the backdrop precondition), neumorphism, scrims, gradient-under-glass, and the "effects need preconditions" principle.
- `references/acceptance-criteria.md` — Phase 6: the match checklist, the render-compare loop, tolerances, and a catalog of common failures with their fixes.
- `references/responsive-system.md` — the breakpoint ladder (grounded in Webflow/Relume + Material window size classes), the cross-viewport component-equivalence map (Material adaptive navigation + Apple HIG + classic responsive patterns), and the "recompose, don't stretch" / "up-scaling is inferential" principles.
- `templates/` — wrapper-layer shells (`design.html`, `design-system.html`, `board.html`) with a fill contract in `templates/README.md`. Fill these for the index, the design-system sheet, and the multi-frame board; generate the reconstruction files fresh.
