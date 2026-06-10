---
name: corner-cutouts
description: >
  Recreate "cutout" / notched / chamfered corner shapes faithfully — the rounded
  45° corner cut seen on brand sites (e.g. avax.network's panels, hero shell and
  CTAs), where one corner of a rounded rectangle is sliced off and the cut's own
  tips are rounded, optionally with a hairline that traces the diagonal. Use when
  the user wants to "recreate this cutout", "match this corner cut", "notched
  corner", "chamfered corner", "clipped corner", "missing/cut corner", "scooped
  corner", a "rounded rectangle with one corner cut", or says a button/panel has
  a "messed up" pill-with-a-bite shape. Also use whenever an attempt with
  clip-path:polygon looks wrong (sharp tips, no border on the diagonal). Ships a
  drop-in <wm-shape> web component + path generator and a verify-by-render loop.
compatibility: >
  Browser: any evergreen browser (custom elements, ResizeObserver, clip-path:path()).
  Tooling: Node ≥ 16 for the generator/CLI; ImageMagick `convert` (or rsvg/resvg/
  cairosvg) optional, only for the rasterize-to-verify step.
---

# Corner cutouts

Produce the signature "cutout corner": a rounded rectangle with **one corner replaced
by a 45° chamfer whose two tips are themselves rounded**, optionally stroked so a
hairline follows the diagonal. This is the shape LLMs reliably get wrong.

## The one thing to get right

**Do NOT use `clip-path: polygon(...)`.** A polygon chamfer:

- has **sharp tips** — it can't round the two vertices of the cut, and
- **cannot carry a stroke** on the diagonal — an outline/border won't follow the cut.

Those two failures are exactly what make hand-rolled attempts look "off." The correct
construction is an **SVG path**: a rounded polygon where every vertex (including the two
new chamfer vertices) is filleted with a circular arc. Use the bundled primitive — it
already encodes the geometry, the radius capping, and the arc sweep direction.

## Use the primitive (don't re-derive the math)

`scripts/wm-shape.js` is a self-contained, dependency-free web component. Drop it in:

```html
<div class="panel" style="position:relative">
  <wm-shape corner="br" rounded="28" corner-size="96" corner-rounded="20"
            fill="#E84142" stroke="rgba(255,255,255,.2)" stroke-width="1"></wm-shape>
  <div class="content" style="position:relative;z-index:1"> … </div>
</div>
<script src="wm-shape.js"></script>
```

Attributes (all lengths accept `clamp()`/vw/rem and resolve to px on resize):

| attr | meaning |
|------|---------|
| `corner` | which corner is cut: `tl` `tr` `br` `bl` |
| `rounded` | radius of the 3 normal corners. One value, or four (`tl tr br bl`, CSS order) for mixed/square corners |
| `corner-size` | chamfer leg length along each edge |
| `corner-rounded` | radius at the 2 chamfer tips |
| `fill` / `stroke` / `stroke-width` | paint the surface / hairline |
| `clip` | also clip the HOST element, so its own background + overflowing media follow the cut |

Also exposed: `window.WMShape.path(w, h, {corner, r, cornerSize, cornerRadius})` → an SVG
path `d` string (e.g. for `clip-path: path('…')` or a one-off `<path>`).

## Two ways to apply it

1. **Explicit element** — place `<wm-shape>` as the first child of a positioned box
   (shown above). Best when authoring new markup.
2. **Upgrade existing markup** — keep your classes, drive them from the primitive:
   - Buttons (canonical rule, scaled to height so any size matches):
     `WMShape.upgrade('.notch-br', { corner:'br', roundedRatio:0.20, cornerSizeRatio:0.32, cornerSizeMin:12, cornerSizeMax:28, cornerRoundedOfCut:0.31 })`
   - Panels / large shells (a fixed px cut is fine here):
     `WMShape.upgrade('.panel', { corner:'br', cornerSize:96, cornerRounded:18 })`
   - or declaratively: `<button data-wm-cut="br" data-wm-size="14">` (auto-applied on load).
   When you pass neither `rounded` nor `roundedRatio`, the upgrader **inherits the host's
   computed per-corner border-radius**, so square edges stay square and pills stay pill.

## Filled vs bordered hosts (the outline-button trap)

- **Filled** host (solid button, panel, card): use **`clip`** (or `WMShape.upgrade(sel, {…})`
  with no paint). The element's own background follows the cut. Done.
- **Bordered** host (outline/ghost button): a CSS `border` **cannot** trace a clipped
  diagonal — the cut edge is left open. Instead **drop the CSS border** and let the shape
  draw it: `paint:true` + `strokeWidth`, then colour the stroke from CSS so hover/state
  still work:

  ```css
  .btn-outline { background: transparent; }          /* no border */
  .btn-outline wm-shape path        { stroke: var(--line); }
  .btn-outline:hover wm-shape path  { stroke: var(--ink);  }
  ```
  ```js
  WMShape.upgrade('.btn-outline', { corner:'br', roundedRatio:0.20, cornerSizeRatio:0.32, cornerSizeMin:12, cornerSizeMax:28, cornerRoundedOfCut:0.31, paint:true, strokeWidth:1 });
  ```

## Picking parameters (from the avax.network reference)

- Panels / large shells: `rounded` 16–32px, `corner-size` 72–136px, `corner-rounded` 12–24px.
- Buttons: a **scaled copy** of the source button via height ratios (`roundedRatio`,
  `cornerSizeRatio`), NOT a pill and NOT a fixed px cut (a fixed cut only matches at one
  height; on a shorter button it reads too big). Measured live on avax.network (54px nav
  CTA): radius 12.8, cut 26, tip 4.9 → **0.24 / 0.49 / 0.09**. That 0.49 cut is large; on
  **narrow, content-width** buttons it reads as a big bite, so a softer **radius 0.20·h,
  cut 0.32·h** usually looks better. Two robustness tweaks: **clamp the cut**
  (`cornerSizeMin/Max`, e.g. 12–28) so it doesn't shrink to a chip on tiny buttons or
  balloon on huge ones; and set the tip via **`cornerRoundedOfCut`** (≈0.31, a fraction of
  the cut, not the height) so the chamfer keeps the same softness at any cut size. Pick per
  context and confirm on the rendered page. A full pill (999px) + a cut is the classic mistake.
- **Always measure the real source** if you have it: open it, inspect the cut element, read
  the resolved px and the button height, derive the ratios. Do NOT eyeball from a thumbnail —
  and verify by rendering the ACTUAL page (not just the generator) before claiming a match.

## Verify by rendering (this is what makes it reliable)

Geometry bugs are obvious to the eye and invisible in code review. After generating, render
and LOOK before shipping:

```bash
node scripts/chamfer-path.js --w 520 --h 360 --corner br \
     --rounded 32 --corner-size 136 --corner-rounded 24 --out panel.svg
convert -density 144 -background none panel.svg panel.png   # then view panel.png
```

Check: the three normal corners are convex (not biting inward — that means the arc sweep is
flipped), the chamfer tips are rounded, and any stroke traces the full outline including the
diagonal. Stress-test a tiny box with an oversized `corner-size` — the radii should auto-cap,
not glitch.

## References & scripts

- `scripts/wm-shape.js` — the production web component + `WMShape.path` + upgraders.
- `scripts/chamfer-path.js` — Node generator/CLI: print the path `d` or emit an SVG to rasterize.
- `references/geometry.md` — the rounded-polygon math (fillet tangent length, arc sweep, capping)
  and the polygon-vs-path rationale, for when you need to extend the shape.
- `templates/example.html` — a runnable page: fill, stroke, outline button, clipped media, and a
  per-corner footer.
