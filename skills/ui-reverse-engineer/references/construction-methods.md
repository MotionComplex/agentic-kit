# Phase 4 — Construction Method Decision Table

Every element must be built with the right primitive. The single biggest cause of "almost but wrong" output is using the wrong tool for an element — most often faking geometry with CSS, or faking an illustration with a photo. Decide construction method *before* writing code.

## Decision table

| If the element is… | Build it with… | Because… | Common failure if you don't |
|---|---|---|---|
| Page/screen layout, spacing, alignment | Token-driven CSS grid / flex flow | Alignment must be systemic, not hand-placed | Absolute pixel offsets drift and overlap |
| A plain rectangle/card/button surface | CSS box (bg, border, radius, shadow) | It's literally a box | — |
| An organic or signature shape (scalloped cutout, blob, notch, morphing pill, custom badge) | **Parametric SVG path** (compute points: equal angular spacing, equal radii, smooth curves) | These have exact geometry; symmetry is load-bearing | Eyeballed paths render as lumpy "ink splats" |
| A paired-cutout (two tiles forming a notch) | Fixed 2-col grid with one shared gap value | The gap *is* the effect | Mismatched gaps read as misaligned, not intentional |
| A material effect (glass/frost, neumorphism, scrim) | Effect recipe **+ its precondition** (see material-recipes.md) | Effects depend on what's behind/around them | Glass on a flat fill = flat rectangle |
| An illustration (map, contour, chart, data viz, diagram) | Drawn vector (SVG) | It was never a photo | A substituted photo looks nothing like the source element |
| A photographic slot (hero, avatar, thumbnail) | Category-correct generated/sourced asset | Subject category must match the slot | Random stock (landscape in an avatar) looks absurd |
| Display / brand type | Loaded webfont (`@font-face`, real or nearest-equivalent) | The typeface carries the character | System fallback erases the "premium" feel |
| Icons | A real icon set (do not hand-roll SVG paths) | Hand-drawn glyphs look off and inconsistent | Wonky, inconsistent icon weights |
| Numeric readouts with a specific face (7-segment, dot-matrix) | The actual specialty webfont | The face *is* the component | Plain monospace misses the whole look |

## How to build parametric shapes

For radially symmetric shapes (flowers, gears, scalloped avatars), compute points around a circle rather than guessing a path:

- Choose lobe count `n`, center `(cx, cy)`, outer radius `R` (petal tips), inner radius `r` (valleys).
- Place valley points at angles `i · (360/n)` and petal tips at the half-angles between them.
- Connect with quadratic/cubic curves so joins are smooth. Equal angles + equal radii = the symmetry that makes it read as designed.

For a paired-cutout, never position two tiles by eye: use one grid (`grid-template-columns: <a> <b>; gap: <token>`) so the notch is exactly one gutter wide.

## The principle

CSS is for boxes and layout. SVG is for geometry and illustration. Raster is for photography. Webfonts are for type. When an element is built with the wrong one of these four, no amount of tweaking saves it — change the primitive, not the parameters.
