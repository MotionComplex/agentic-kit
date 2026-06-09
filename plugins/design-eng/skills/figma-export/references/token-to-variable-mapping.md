# `tokens.json` → Figma Variables & styles — the mapping

This is the load-bearing knowledge of the skill: how each part of a `ui-reverse-engineer` token system corresponds to a Figma construct. The Figma MCP skills (`figma-use`, `figma-generate-library`) perform the writes; this table decides what to write.

## The correspondence

| `tokens.json` | Figma construct | Notes |
|---|---|---|
| `color.*` (roles: bg, surface, ink, muted, line, accent, …) | **Color variables** in a `color` collection | One variable per role; bind everything to these |
| light / dark (or any theme) variants of color | **Modes** within the one color collection | Don't duplicate variables per theme — add a mode |
| `space.*` (spacing ladder) | **Number variables** in a `space` collection | Keep the base unit; name `space/1`, `space/2`… matching keys |
| `radius.*` | **Number variables** (`radius/sm…`) | Used by component corner radius |
| `border.*` / stroke widths | **Number variables** | |
| `elevation.*` / shadow steps | **Effect styles** (drop-shadow) | Numeric params from the step; bind color to a variable where possible |
| `type.scale.*` (sizes, line-height, tracking) | **Number variables** + **text styles** | Variables hold the numbers; text styles compose them with family/weight |
| `type.identified` (font family + weights) | **Text style** font properties | Load the same family; if paid/licensed, use the nearest available and flag it |
| `responsive.breakpoints.*` | **Number variables** (documentation only) | Figma doesn't enforce breakpoints; store for reference |
| `motion.*` (if present) | **Number/string variables** (documentation) | Figma can't run the motion; store durations/easings as named variables for design reference |
| `$meta` (source, native breakpoint, provenance) | File description / a docs frame | Surface what was inferred vs extracted |

## Naming

Name Figma variables to **match the token keys** (`color/accent`, `space/4`, `radius/lg`). This keeps the export traceable in both directions and makes a later re-sync diffable.

If the source was a URL and `ui-reverse-engineer` harvested the site's own `--token` custom properties, **mirror that vocabulary** (`--color-surface` → `color/surface`) rather than inventing new names — the design team already has a vocabulary; match it.

## Modes vs duplicate variables

If the source has light and dark (or brand) themes, model them as **modes** in a single collection: one `color/surface` variable with a value per mode. Duplicating into `color/surface-light` and `color/surface-dark` defeats the purpose of Variables and breaks theme switching. Map each theme in the source to one mode.

## Components reference variables, never literals

When components are built (Phase 3 of the skill), every property must bind to a variable or style — fill → a color variable, padding → a space variable, corner radius → a radius variable, text → a text style. A component with a hard-coded `#3B82F6` fill is not part of the system; it's a detached shape. This is the single most important rule of the export: the *binding* is what makes it a design system in Figma rather than a drawing.

## Known lossy cases (flag these to the user)

Some things in a faithful HTML reconstruction do not translate cleanly into Figma. Name them rather than shipping a silent approximation:

- **Glass / `backdrop-filter`.** Figma has a background-blur effect but it behaves differently from CSS `backdrop-filter`; the glossy edge-lighting recipe won't reproduce exactly. Approximate and flag.
- **Parametric SVG geometry.** Signature organic shapes (scalloped cutouts, morphs) built as math-driven SVG may need to be imported as vectors (`upload_assets`) rather than rebuilt natively.
- **CSS-only effects.** Gradients-under-glass, mix-blend-modes, and conic/complex gradients may degrade.
- **Responsive behavior.** Auto-layout captures fluidity, but CSS media-query *recomposition* (a tab bar becoming a sidebar) isn't a single Figma construct — represent distinct size-classes as separate frames/variants if the user needs them.
- **Motion.** Not executable in Figma; stored as documentation variables only (use Figma prototyping or `motion-system`'s output for the real thing).

A clean export honestly reports its lossy edges. That report is part of the deliverable.
