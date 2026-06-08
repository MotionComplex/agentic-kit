# Phase 2 — Token Extraction (raw values → design system)

The goal of this phase is to stop thinking in pixels and start thinking in a system. A reconstruction built from raw measurements is a brittle trace of one artboard. A reconstruction built from an inferred token system scales, stays internally consistent, and becomes reusable on new screens. The token system *is* the design system you are extracting.

## 1. Infer the base unit

Collect every spacing measurement you took in Phase 1 (gaps, paddings, margins). Look at the distribution and find the smallest increment that most values are multiples of. In practice this is almost always **4 or 8**.

- A measured `17px` gap is almost certainly `2 × 8 = 16` plus 1px of measurement/anti-aliasing noise.
- A measured `23px` and a `25px` in the same screen are both `24` (`3 × 8`).

Pick the base unit that explains the most measurements with the least error. Record it: `base = 8`.

## 2. Derive the scales

From the base unit and your raw readings, build ladders:

- **Spacing scale** — multiples of the base: `space-1 = 4, space-2 = 8, space-3 = 12, space-4 = 16, space-6 = 24, space-8 = 32…`. Keep only the steps the design actually uses.
- **Type scale** — find the ratio between adjacent font sizes. Common ratios: 1.125, 1.2, 1.25, 1.333. If body is 14 and the next size is ~17–18, the ratio is ~1.25. Express sizes as `text-sm/base/lg/xl/2xl`.
- **Radius ladder** — the distinct corner radii, smallest to largest: `radius-sm, radius-md, radius-lg, radius-pill (999)`. Note which components use which.
- **Elevation/shadow steps** — each distinct shadow as a named recipe (offset, blur, spread, color). Tint shadow color toward the background hue, never pure black on a light page.
- **Color roles** — do not store a flat list of hex. Assign roles: `bg, surface, surface-2, ink, ink-muted, line/hairline, accent` (usually exactly one accent). Sample the actual pixels for each.

## 3. Snap, then flag outliers

For each raw reading, snap to the nearest scale step **if it is within tolerance** (roughly ±2px for spacing at phone scale, or ±10% — use judgment). This removes noise and enforces consistency.

But not every value belongs to the system. If a value sits clearly off the dominant scale, it is probably an **intentional exception** (a deliberately oversized hero, a hand-tuned optical adjustment). Flag it, keep its real value, and note *why* it's an exception. The rule is: **system where possible, exception where intended.** Do not force-snap a deliberate outlier, and do not treat noise as signal.

## 4. Emit tokens, not pixels

From here on, everything references tokens. A component spec says `padding: space-3; radius: radius-lg; gap: space-2`, never `padding: 12px`. This is what makes the build consistent by construction and portable across screen sizes.

## `tokens.json` schema

```json
{
  "$meta": { "source": "describe the screenshot", "base_unit": 8 },
  "grid": { "device_width": 390, "safe_margin": 20, "columns": 1, "gutter": 16 },
  "column_grid": {
    "mobile":  { "columns": 4,  "margin": 16, "gutter": 16, "type": "stretch" },
    "tablet":  { "columns": 8,  "margin": 24, "gutter": 24, "type": "stretch" },
    "desktop": { "columns": 12, "margin": "auto", "container_max": 1200, "gutter": 24, "type": "center" },
    "baseline": 8
  },
  "color": {
    "bg": "#0A0A0B", "surface": "#141416", "surface_2": "#1C1C1F",
    "ink": "#F4F4F2", "ink_muted": "#8A8A90", "line": "rgba(255,255,255,0.09)",
    "accent": "#D6F23B"
  },
  "space": { "1": 4, "2": 8, "3": 12, "4": 16, "6": 24, "8": 32 },
  "radius": { "sm": 8, "md": 16, "lg": 24, "pill": 999 },
  "control": { "icon_btn": 44, "icon_glyph": 18, "tap_min": 44, "pill_h": 40, "input_h": 48, "comment": "sizes for interactive controls; ALL similar controls pull from here so two icon-buttons can't drift to 44 vs 46" },
  "type": {
    "family_display": "…", "family_text": "…", "family_mono": "…",
    "identified": { "from": "label | letterforms", "class": "geometric-sans | grotesque | humanist-sans | serif | mono | display", "best_guess": "…", "confidence": "high | medium | low", "candidates": ["…","…"], "loaded": "the free webfont actually used" },
    "scale_ratio": 1.25,
    "sizes": { "sm": 12, "base": 14, "lg": 18, "xl": 24, "2xl": 30 },
    "weights": { "reg": 400, "med": 500, "semi": 600, "bold": 700 }
  },
  "shadow": { "soft": "0 20px 50px -22px rgba(40,44,66,.2)" },
  "material": {
    "glass": "rgba(38,38,42,.5) + blur(20px) saturate(180%) + inset 0 1px 0 rgba(255,255,255,.12) + 1px rgba(255,255,255,.10) border"
  },
  "outliers": [
    { "where": "hero headline", "value": "56px", "why": "deliberate oversize, off the 1.25 type scale" }
  ]
}
```

Keep the schema honest to what the source actually uses — delete keys it doesn't need, add ones it does. The `outliers` array is important: it records the intentional breaks from the system so they survive the rebuild.

## Visualize it: the design-system sheet

`tokens.json` is data; people can't see it. Always also render a **design-system sheet** — a visual styleguide of the extracted system — before building components, so the system is explicit and confirmable, and so components/composition visibly inherit from it. Show, as tables/specimens:

- **Breakpoints** — the ladder (name, width, role) as a table.
- **Column grid** — the Figma-style layout grid elements snap to: margins + columns + gutters, on the standard responsive ladder (**4 columns mobile / 8 tablet / 12 desktop**), drawn as a visible overlay per breakpoint. Components span columns (e.g. "8 of 12"). This is distinct from the **layout regions** (how the actual panels occupy the grid) — show both. Note the **baseline grid** (8pt rhythm, 4pt for type) too.
- **Spacing scale** — each space token as a labelled bar (the `4 / 8 / 12 / 16 / 24 / 32` rhythm made visible).
- **Type scale** — each size rendered *at that size*, labelled with token name, px, and weight, so the ratio is legible.
- **Typeface** — the identified font(s): family-class, best-guess named face, **confidence**, the 2-3 candidates considered, and the free webfont actually loaded. Note if it came from an on-screen label (high confidence) vs letterform inference (lower). This is the type equivalent of "extracted vs inferred."
- **Color roles** — swatches with hex + role (bg, surface, ink, muted, line, accent).
- **Radii** — rounded squares at each radius step.
- **Control sizes** — icon-button / tap-target / pill / input heights as a small scale. Without this, similar controls drift (one icon-button 44px, another 46px). All interactive controls must pull their size from here.
- **Material** — a sample of each effect (e.g. the glass over a real backdrop).

This sheet is the bridge between extraction and build: it's the human-readable contract that the components then honor.
