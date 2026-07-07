# Phase 6 — Verify: render, compare, correct

The reconstruction is not done when it is written. It is done when a rendered image of it has been compared against the source and the deltas are within tolerance. Generating blind and hoping is the root cause of most failures — close the loop.

## The loop

1. **Render to an image.** Open the output file in the browser tooling and screenshot it (load the browser tools via ToolSearch if they are deferred; e.g. navigate to the file, then capture the page). Render the isolated components, the composition, and the skeleton.
2. **Compare side by side** against the source screenshot using the checklist below.
3. **List the deltas** explicitly — what is off, by how much, and why.
4. **Fix and re-render.** Repeat until every checklist item passes.
5. Only then present to the user. If the environment truly cannot render, say so and ask the user to eyeball it — never silently ship unverified work.

## Acceptance checklist ("match" is testable)

Structure (must pass — this is the definition of match):

- [ ] Every block aligns to the inferred grid and shares one gutter. No overlap, no clipping, nothing floating off-margin.
- [ ] Proportions are within a small tolerance of the source (roughly ±5%).
- [ ] Corner radii match the source ladder exactly.
- [ ] Sampled colors are within a tight difference of the source (small ΔE; eyeball if no tooling).
- [ ] Every named material effect is actually present and correct (glass sits over a real non-uniform backdrop with a translucent fill + blur; edge treatment matches the source's variant — flat frosted vs glossy/refractive — and isn't added by default).
- [ ] Signature shapes are geometrically faithful: correct lobe/segment count, symmetric, correct gap widths.
- [ ] The real type system is loaded (display face is not a fallback).
- [ ] Spacing rhythm matches (the vertical cadence feels like the source, not cramped or loose).

Content (category-correct, not identical):

- [ ] Every photographic slot holds a subject of the correct category (portrait for a person, etc.).
- [ ] Illustrated elements (maps, charts) are drawn, not photos.
- [ ] Copy is plausible and in the right register; no placeholder lorem where real-feeling text belongs.

Responsiveness (per breakpoint):

- [ ] A **design-system sheet** exists showing the **column grid** (4/8/12 + margins/gutters) and the layout regions, and the components visibly align to that grid and use the same spacing/type/color.
- [ ] No component carries a fixed width or per-component `max-width` that strands it; components fill their slot. Caps live on the container + text measure.
- [ ] Internals are fluid: waveforms/bars/lists fill their width rather than ending at a fixed count.
- [ ] Aspect-sensitive art (charts, spheres) is not distorted or overflowing at any breakpoint (no `preserveAspectRatio="none"` stretch).
- [ ] A component's **selected/active state reads consistently in every form** it takes (pill / rail / sidebar). Brand and "selected" are not conflated.
- [ ] Substitutions are correct (bottom bar → rail → sidebar), and no stretched mobile layout masquerades as desktop.
- [ ] Interactive controls share sizes from the control scale (no 44-vs-46 drift between sibling icon-buttons). Variants of the same control share one height — an expanded/active nav pill is the same height as its icon-only siblings, just wider.
- [ ] No secondary region (side rail, supporting pane) is bound to a tall hero's grid tracks — no stray vertical gaps; secondary regions flow with their own rhythm.

Composition integrity:

- [ ] The composition reproduces one specific source screen, not a hybrid of several.
- [ ] Secondary details are present (meta lines, badges, floating nav rather than a sticky bar if the source floats).
- [ ] The **navigation menu / overlay** is reconstructed in its *open* state (as an isolated component and wired into the composition), not left as a closed hamburger. Same for any other opener→panel pair the source has (cart, filter, search, account).
- [ ] The skeleton is derived from the same grid and aligns with the composition.

## Catalog of common failures and their fixes

These recur across reconstructions. Check for them specifically:

| Symptom | Root cause | Fix |
|---|---|---|
| "Glass" looks like a flat rounded rectangle | No non-uniform backdrop behind it, or an opaque fill | Put a textured layer behind it and make the fill translucent (the invariant). Match the source's edge variant; don't assume refractive |
| Avatar/shape looks like a lumpy blob | Eyeballed SVG path | Recompute parametrically (equal angles + radii) |
| Roster/cards overlap or names clip | Absolute pixel placement, blown height budget | Switch to flow layout; respect the content height |
| Map/chart looks like a random photo | Substituted a photo for an illustration | Draw it as vector |
| Avatars contain landscapes/objects | Random image seeds | Use category-correct (portrait) assets |
| Type feels generic / not premium | Display font not loaded | `@font-face` the real or nearest face |
| Top section feels "drifty" | Inconsistent left margins (16/18/20/22) | Snap to one gutter token |
| Bottom nav looks like a stuck footer | Edge-to-edge sticky element | Float it: center it with margin all around, per the source |
| Output matches none of the screens well | Merged multiple screens into a hybrid | Pick one screen and reproduce it faithfully |

## Tolerance philosophy

"Match" means structural and material fidelity within tight tolerance, with category-correct content. It does not mean identical pixels or the literal same photos. Hold structure to a tight bar; allow content to be representative. When unsure whether a deviation is acceptable, it's structural → fix it; it's content → it's probably fine if the category is right.
