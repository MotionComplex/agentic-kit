# Lucide Icon Design Spec — Full Reference

A self-contained reproduction of the Lucide design rules. Authoritative source: https://lucide.dev/contribute/icon-design-guide.

## Canvas

- Size: **24 × 24 px**
- Viewbox: `0 0 24 24`
- Minimum padding from edge: **1 px** (artwork lives in 22 × 22)
- Practical padding: **2 px** on all sides → 20 × 20 working area, balances optical weight against existing icons

## Stroke

- `stroke="currentColor"`
- `stroke-width="2"`
- `stroke-linecap="round"`
- `stroke-linejoin="round"`
- Stroke alignment: centered on path (SVG default — there is no other option)
- The 2 px stroke extends **1 px outside** the path's geometric position. This is why a `rect x="3" y="3" width="18" height="18"` exactly fills the visible canvas: stroke extends from x=2 to x=22.

## Spacing

- ≥ **2 px** between distinct elements (measured stroke-edge to stroke-edge)

## Corners

- Shapes ≥ 8 px on a side: `rx="2" ry="2"`
- Shapes < 8 px on a side: `rx="1" ry="1"`
- Hard 90° corners are reserved for shapes that *should* feel sharp (e.g., warning triangles); default to rounded.

## Allowed primitives

- `<path>`
- `<line>`
- `<polyline>`
- `<polygon>`
- `<circle>`
- `<ellipse>`
- `<rect>`

## Forbidden

- `<g>`, `<use>`, `<defs>`, `<symbol>`, `<image>`, `<text>`, `<foreignObject>`
- `<filter>`, `<mask>`, `<clipPath>`
- `<linearGradient>`, `<radialGradient>`, `<pattern>`
- `transform=` attributes (bake transforms into coordinates)
- `id=`, `class=`, `style=` attributes
- Per-element `fill`, `stroke`, `stroke-width`, etc. — all styling lives on the root `<svg>`
- Filled shapes — Lucide is stroke-only

## Path quality

- Snap to integer pixel grid wherever possible
- Continuous curves: cubic Bézier control points should be **mirrored** across shared anchors → smooth tangents, no kinks
- Round numeric values to ≤ **3 decimal places**
- Prefer the simplest primitive that expresses the shape (a `<circle>` reads better than a 4-segment `<path>` arc)

## Optical correction

The mathematical grid is a guide, not the truth. Adjust by 0.5–1 px when:

- A circle next to a square at equal mathematical size — the circle reads smaller. Bump the circle up.
- A right-pointing triangle's geometric center is too far right — shift left ~0.5 px.
- A shape with weight concentrated on one side — shift toward the lighter side to balance.

The blur test: if you blur the icon and it looks lopsided, move the heavy element toward the light side until it balances.

## Library consistency

- Match the visual density of existing Lucide icons. Compare against `house`, `settings`, `user`, `circle`.
- Reuse shape vocabulary across related icons (a "phone body" should be the same shape in every phone icon).
- Variant families (`circle`, `circle-dashed`, `circle-dot`) share base geometry.

## Naming

- lower-kebab-case: `arrow-up-right`
- Depict-not-function: `floppy-disk` not `save`, `magnifying-glass` not `search`
- Modifier suffix: `[base]-[modifier]` → `circle-dashed`, `square-arrow-up`
- Multi-element ordering: largest first, then top-to-bottom, then left-to-right

## Code output rules

- Minify path data to ≤ 3 decimal places
- No XML comments inside the body of distributed icons
- No `<title>` / `<desc>` (accessibility lives at the consumer level)
- File extension: `.svg`

## Metadata (only if contributing back to lucide/lucide)

If you intend to upstream the icon to the Lucide repo, each `.svg` needs a sibling `.json`:

```json
{
  "$schema": "../icon.schema.json",
  "contributors": ["github-handle"],
  "tags": ["search-keyword-1", "search-keyword-2"],
  "categories": ["navigation"]
}
```

For local/private icons, this is unnecessary.
