# Templates - the wrapper layer

These templates fix the **structure of the deliverable**, not the reconstruction. They exist
so that every run produces the same navigable scaffold - same sections, same order, same class
names - while the actual UI you rebuild still matches whatever source was given.

## The split (important)

There are two layers in a ui-reverse-engineer output, and they are treated oppositely:

- **Reconstruction layer - never templated.** The component instances, the assembled
  composition, and the skeleton must match the *source*. Structure matches exactly; content
  is category-correct. A template here would fight fidelity. These are always generated from
  the measured tokens. `components.html`, `composition.html`, and `skeleton.svg` have **no
  template** - build them fresh each time.

- **Wrapper layer - templated.** The index, the design-system sheet, and the multi-frame
  board are the same skeleton on every run, just repainted in the source's tokens. These get
  templates so they don't drift (section order, missing sections, renamed classes).

| File | Template | Why |
|---|---|---|
| `design.html` | `templates/design.html` | Same front-door structure every time |
| `design-system.html` | `templates/design-system.html` | Fixed section order is the contract |
| `board.html` | `templates/board.html` | Same multi-frame framing |
| `components.html` | none - generate | Must match the source's components |
| `composition.html` | none - generate | Must match one source screen |
| `skeleton.svg` | none - generate | Derived from the source's grid |

## How to fill a template

1. **Copy** the template file to the output folder under its real name (drop the leading
   comment block).
2. **Substitute `{{PLACEHOLDERS}}`** - these are scalar values, almost all from `tokens.json`
   (colors, font family + webfont URLs, base unit, source name, breakpoint widths). Fill every
   one; a leftover `{{...}}` in the output is a bug.
3. **Fill `<!-- REGION: name ... -->` blocks** - these are where source-specific generated
   markup goes (the decision list, the per-token specimens, the legend notes). Each region has
   a one-line instruction. Emit one row/specimen per token the source actually uses: e.g. the
   spacing section gets one bar per entry in `tokens.space`, the color section one swatch per
   role in `tokens.color`. The sample row left in the template shows the shape - replace it,
   don't leave it.
4. **Keep section order and class names.** The CSS depends on the classes, and the fixed order
   is the whole point. Only delete an entire section if the source genuinely has no such tokens
   (e.g. no material effects) - and note the omission.

## Placeholder reference (common ones)

- `{{APP_NAME}}` - short name for the source (e.g. "Orion").
- `{{SOURCE}}` - one-line source description (from `tokens.$meta.source`).
- `{{NATIVE_BREAKPOINT}}`, `{{BASE_UNIT}}` - from `tokens.$meta`.
- `{{COLOR_*}}` - bg / panel / card / ink / muted / dim / line / accent / accent_ink, from `tokens.color`.
- `{{FONT_FAMILY}}`, `{{FONT_URL_400|500|600}}` - the loaded webfont (from `tokens.type.identified.loaded`).
- `{{BP_MOBILE|TABLET|DESKTOP}}` - breakpoint widths (from `tokens.responsive.breakpoints`).
- `{{MATERIAL_BACKDROP}}` - a real photo/gradient URL for glass specimens (glass over a flat fill shows nothing).

When in doubt, the Orion demo in `demo-orion/` (design.html, design-system.html,
responsive-board.html) is the reference filled output these templates were extracted from.
