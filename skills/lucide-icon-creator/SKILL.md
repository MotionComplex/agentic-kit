---
name: lucide-icon-creator
description: 'Design and produce Lucide-style SVG icons that conform to the official Lucide icon design guide (24×24 grid, 2px round-stroke, currentColor). Use when the user asks to "create an icon", "design an icon", "make a custom Lucide icon", "draw an SVG icon", needs an icon that does not exist in the Lucide set, wants to extend the lucide-react/lucide library, or wants a brand/feature icon that visually matches Lucide. Outputs a single `<icon-name>.svg` file plus an optional preview/validation step.'
---

# Lucide Icon Creator

Author SVG icons that look and behave like first-party Lucide icons. The Lucide library has strict, well-documented design rules — this skill bakes them in so the output drops into a Lucide-using codebase (lucide-react, lucide-svelte, raw SVG sprites) without retouching.

## When to use this skill

Trigger on any of:

- "Create an icon for X"
- "Design a Lucide-style icon"
- "Make a custom icon that matches our other Lucide icons"
- "Draw an SVG icon for a [feature/brand/concept]"
- "I need an icon for X but it isn't in Lucide"
- "Extend our icon set with…"

If the user just wants to *find* an existing Lucide icon, do NOT use this skill — point them to https://lucide.dev/icons/ instead.

## Pre-flight: check Lucide first

Before designing, ask (or check) whether the icon already exists in Lucide. Designing a custom icon when an official one exists is wasted work and breaks visual consistency.

- Search: `https://lucide.dev/icons/?search=<concept>`
- If a close match exists, recommend it and stop.
- If nothing matches, proceed with design.

## The Lucide design specification

These rules are non-negotiable. Every output icon must satisfy all of them.

### Canvas

| Property | Value |
| --- | --- |
| Canvas size | **24 × 24 px** |
| Viewbox | `0 0 24 24` |
| Safe area (padding from edge) | **≥ 1 px** on every side (so artwork lives in the **22 × 22** inner box, ideally **20 × 20** for visual balance) |
| Element spacing | **≥ 2 px** between distinct shapes |

### Stroke

| Property | Value |
| --- | --- |
| `stroke` | `currentColor` |
| `stroke-width` | `2` |
| `stroke-linecap` | `round` |
| `stroke-linejoin` | `round` |
| `fill` | `none` |
| Stroke alignment | Centered on the path (SVG default) |

### Corner radius

| Shape size | Radius |
| --- | --- |
| ≥ 8 px | **2 px** (`rx="2" ry="2"`) |
| < 8 px | **1 px** (`rx="1" ry="1"`) |

### Allowed SVG elements

Only these primitives. **No** `<g>`, `<use>`, `<filter>`, `<mask>`, transforms, gradients, fills, or per-element strokes.

- `<path>`
- `<line>`
- `<polyline>`
- `<polygon>`
- `<circle>`
- `<ellipse>`
- `<rect>`

### Path & coordinate rules

- Snap endpoints, centers, and corners to the **integer pixel grid** wherever possible — pixel-perfectness keeps icons crisp at 16 px and 24 px.
- Curves should be smooth: cubic Bézier control points should be **mirrored** across shared anchors (continuous tangents).
- Round numeric values to **3 decimal places** maximum.
- Prefer geometric primitives (`<circle>`, `<rect>`, `<line>`) over `<path>` when the shape is a true primitive — they minify smaller and read more clearly.

### Optical balance (more important than the grid)

The grid is a starting point, not a prison. Adjust by **0.5–1 px** when math-perfect alignment looks wrong:

- A circle of diameter D and a square of side D look **different sizes** to the eye — circles read smaller. Make circles ~1 px larger than mathematical parity.
- A triangle pointing right has its visual center *behind* its geometric center. Shift it left by ~0.5 px.
- Diagonal strokes look thinner than orthogonal strokes at the same width — usually fine at 2 px, but worth knowing.
- Visually center by **center of gravity**, not bounding box.

Quick test: blur the icon mentally (or with a real Gaussian blur) — if it looks lopsided blurred, it is lopsided sharp.

### Visual consistency with the Lucide set

- Match the **density** of existing Lucide icons: not too sparse, not too busy. If your icon is more detailed than `house` or `settings`, simplify.
- Reuse shape vocabulary: a "phone" body in your icon should look like the body in `phone`, `smartphone`, etc.
- Variants of one concept (`circle`, `circle-dashed`, `circle-dot`) should share the base geometry.

### Naming

- **lower-kebab-case**: `arrow-up-right`, not `ArrowUpRight` or `arrow_up_right`.
- Name by **what it depicts**, not what it does: `floppy-disk` not `save`, `magnifying-glass` not `search`. (Lucide itself violates this in legacy aliases, but new icons follow the rule.)
- Modifier pattern: `[base]-[modifier]` → `circle-dashed`, `square-arrow-up`.
- Multi-element ordering: largest first, otherwise top-to-bottom then left-to-right.

## Workflow

### 1. Clarify the concept (1 question max)

If the request is ambiguous ("make an icon for the dashboard"), ask **one** sharp question:

> "What single object or metaphor should the icon depict? (e.g., a bar chart, a gauge, a grid of tiles)"

If it is clear, skip to step 2.

### 2. Sketch in words before SVG

Write a 1–2 sentence description of the geometry **before writing any SVG**:

> "A 16×16 rounded square centered at (12,12), with a 6×6 rounded square in its bottom-right corner overlapping by 2 px."

This catches composition problems before they become coordinate problems.

### 3. Compose with primitives where possible

Walk down this preference list:

1. `<circle>` / `<rect>` / `<line>` — use when the shape is a true primitive.
2. `<polyline>` / `<polygon>` — use for angular shapes with no curves.
3. `<path>` — use only when curves or mixed segments are needed.

For each shape, pick coordinates on integer pixels inside the 1 px safe area (so x ∈ [1, 23], y ∈ [1, 23] for stroke endpoints; further inset for filled-looking primitives because the 2 px stroke extends 1 px outward).

### 4. Write the SVG

Start from [templates/starter.svg](templates/starter.svg) and add child elements. **Do not add transforms, fills, gradients, IDs, classes, or `<g>` wrappers.**

### 5. Validate

Run the validator before reporting done:

```bash
python3 ~/.claude/skills/lucide-icon-creator/scripts/validate-icon.py path/to/icon.svg
```

It checks: viewbox, stroke attributes, allowed elements, fill, ID/class absence, decimal precision, and safe-area violations. Fix any failures.

### 6. Preview

If the icon is going into the user's repo, render it in context (next to existing Lucide icons at the same size) before declaring done. For a quick standalone preview, the SVG opens in any browser; for a Lucide-set comparison, drop it into the user's app and view it next to a sibling icon at 24 px and 16 px.

### 7. Save

Save as `<name>.svg` using the kebab-case naming rules. If the user has a conventional icons directory in their repo, save there; otherwise ask where.

## Output contract

Every icon must:

- [ ] Have `viewBox="0 0 24 24"` and `width="24" height="24"`
- [ ] Have `fill="none"` at the root, and **no** `fill` attributes on children
- [ ] Have `stroke="currentColor"`, `stroke-width="2"`, `stroke-linecap="round"`, `stroke-linejoin="round"` at the root
- [ ] Use only allowed primitives (`path`, `line`, `polyline`, `polygon`, `circle`, `ellipse`, `rect`)
- [ ] Contain no `<g>`, `<use>`, `<filter>`, `<mask>`, `<defs>`, transforms, IDs, classes, gradients, or per-element fill/stroke overrides
- [ ] Keep all artwork ≥ 1 px from every edge
- [ ] Round all coordinates to ≤ 3 decimals
- [ ] Pass `validate-icon.py` cleanly
- [ ] Use kebab-case file name describing the depicted object

## Common patterns (cheat sheet)

| Need | Snippet |
| --- | --- |
| Centered circle (radius 10) | `<circle cx="12" cy="12" r="10" />` |
| Centered rounded square (full bleed) | `<rect x="3" y="3" width="18" height="18" rx="2" ry="2" />` |
| Diagonal line corner-to-corner | `<line x1="5" y1="5" x2="19" y2="19" />` |
| Plus | `<line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />` |
| Chevron right | `<polyline points="9 6 15 12 9 18" />` |
| Triangle (right-pointing, optically centered) | `<polygon points="6 4 19 12 6 20" />` |

## Adding to a Lucide-React project

Lucide-react does not auto-import custom icons. Two options to integrate:

1. **Inline as a React component** — wrap the SVG body in `<svg ...attrs>{children}</svg>`, accepting `size`, `color`, `strokeWidth` props. Look at any existing `lucide-react` icon source for the prop signature.
2. **Use as a static asset** — drop the `.svg` into `public/icons/` and reference via `<img src="/icons/name.svg" />`. Note: this loses `currentColor` recoloring unless you inline-render.

For this repo specifically, check how other custom icons are handled before assuming.

## Anti-patterns (do not do these)

- ❌ Filled shapes (`fill="currentColor"` on a child) — Lucide is a stroke-only system.
- ❌ Stroke widths other than 2.
- ❌ `<g transform="…">` to position elements — bake the transform into the coordinates.
- ❌ Decorative gradients, drop shadows, or multi-color elements — Lucide is monochrome by design.
- ❌ Cramming detail to be "more accurate." If you cannot read the icon at 16 px, it is too detailed.
- ❌ Designing literally (a "search" icon as the word "SEARCH") — depict the object (magnifying glass).

## References

- [references/design-spec.md](references/design-spec.md) — full reproduction of the Lucide spec for offline reference
- [templates/starter.svg](templates/starter.svg) — empty 24×24 SVG with all required attributes
- [scripts/validate-icon.py](scripts/validate-icon.py) — pre-flight validator, exit code 0 = pass
- Official guide: https://lucide.dev/contribute/icon-design-guide
- Icon search (check before designing): https://lucide.dev/icons/
