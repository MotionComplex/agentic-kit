---
name: figma-export
description: >-
  Push an extracted design system into Figma: turn a tokens.json (colors,
  spacing, type, radii, breakpoints) into Figma Variables + text/effect styles,
  and a components.html (isolated component instances + states) into a Figma
  component library with variants. Use this skill whenever the user wants to
  send, push, export, sync, or recreate a design system, tokens, or components
  IN Figma — "put this in Figma", "export these tokens to Figma", "make Figma
  variables from this", "turn these components into a Figma library", "sync the
  design system to Figma", "build the Figma file" — especially as the follow-on
  to a ui-reverse-engineer run (tokens.json + components.html → Figma). It is a
  token-first bridge: it maps the extracted system onto Figma constructs and
  hands the actual Figma mechanics to the official Figma MCP skills
  (figma-use, figma-generate-library). Trigger whenever the destination is
  Figma and the input is an extracted/coded design system, even if the word
  "skill" isn't used.
---

# Figma Export

Push an *extracted* design system — typically a `ui-reverse-engineer` output — **into** Figma: `tokens.json` becomes Figma **Variables** and styles; `components.html` becomes a Figma **component library** with variants. This is the code→design direction.

This skill is deliberately **thin**. Its value is the *mapping knowledge* (how a CSS/token system corresponds to Figma's Variables, styles, and component-set model) and the *right order of operations*. The actual Figma writes are done by the official Figma MCP and its skills — this skill decides **what** to create and hands off **how** to them.

## Use the official Figma skills for the mechanics (not optional)

The Figma MCP ships skills that own the write mechanics. Load and follow them:

- **`figma-use`** — **MANDATORY before any `use_figma` call.** Read it first.
- **`figma-generate-library`** — the flow for building a design system / component library in Figma from code. This is the primary engine for this skill.
- **`figma-generate-design`** — for translating a full page/layout into Figma (use if also pushing `composition.html`).
- **`figma-code-connect`** — to map the Figma components back to code components, if the user wants Code Connect.

If those skills are present, they win on mechanics. This skill supplies the token/component mapping and sequencing below; it does not re-document Figma API calls.

## Why token-first, not a composition trace

Do **not** try to faithfully re-trace the rendered `composition.html` pixel-for-pixel into Figma. Figma's model (Variables, auto-layout, constraints, component sets) is not CSS, and a pixel trace fights it. The high-fidelity, durable path is:

1. **Variables first** — establish the token foundation as Figma Variables.
2. **Styles** — text and effect styles built *on* those variables.
3. **Components** — built from the variables/styles, with states as variants.
4. **Composition (optional)** — assemble a screen *from* those components.

Each layer references the one below, exactly as the HTML output does. A `ui-reverse-engineer` output is already structured this way, which is why it maps cleanly. Anything built without this layering becomes a flat, unmaintainable trace.

## Inputs

- **`tokens.json`** (required) — the source of truth. Colors, spacing, type, radii, elevation, breakpoints, and (if present) the `motion` block. Map directly to Variables.
- **`components.html`** (recommended) — isolated, labelled component instances with their states. Each distinct component → a Figma component; each state → a variant.
- **`composition.html`** (optional) — one assembled screen; export only if the user wants a sample frame.
- **`design.html`** (context) — the rationale/flagged inferences; useful for naming and for telling the user what's provenance-flagged.

If there's no `tokens.json` yet, run `ui-reverse-engineer` first (or extract one) — this skill starts from tokens, it doesn't extract them.

## The pipeline

### Phase 1 — Map tokens → Figma Variables

Translate the `tokens.json` scales into Variable collections. See `references/token-to-variable-mapping.md` for the full table; the shape:

- **Color** roles (`bg`, `surface`, `ink`, `muted`, `line`, `accent`, …) → a **color** Variable collection. If the source had light/dark, use **modes** in one collection rather than duplicate variables.
- **Spacing** ladder → a **number** collection (`space/1…`), in the source's base unit.
- **Radius**, **border width**, **elevation** → number/effect collections.
- **Type** scale → number variables for size/line-height, paired with text styles in Phase 2.
- **Breakpoints** → number variables (documentation; Figma doesn't enforce them).
- Preserve the source's own naming where it exposed `--token` vars (URL extraction often hands you these) — mirror their vocabulary instead of inventing new names.

Name variables to match the token keys so the mapping is traceable both ways.

### Phase 2 — Build styles on the variables

- **Text styles** from the type scale (family + size + weight + line-height + tracking), each bound to the Phase 1 variables.
- **Effect styles** from the elevation/shadow steps and any material recipes (glass, etc.). Note: Figma can't reproduce `backdrop-filter` glass faithfully — approximate with a blur/fill and flag the limitation to the user.

### Phase 3 — Build components with variants

For each component in `components.html`:

- Create a **component**, built from the variables/styles (not hard-coded values).
- Map each **state** (default / hover / focus / active / disabled, and any selected/expanded) to a **variant**, with a `state` property. This is exactly the state set `ui-reverse-engineer` already enumerated — reuse it, don't re-derive.
- Respect **atoms vs composites**: build atoms first, then assemble composites (nav bar, list row, card) from instances of those atoms, mirroring the hierarchy the decomposition captured.
- Use **auto-layout** so components are fluid (the Figma analogue of "cap the container, not the component").
- Drive this through `figma-generate-library`.

### Phase 4 — Composition (optional) and Code Connect (optional)

- If asked, assemble one screen from the component instances via `figma-generate-design` — one source screen, not a hybrid.
- If the user wants the Figma components linked to their codebase, run `figma-code-connect`.

### Phase 5 — Verify

1. After the writes, pull the result back with `get_design_context` / `get_screenshot` and compare against the source `design-system.html` and `components.html`.
2. Check: variables resolve (no detached hard-coded values), states present as variants, components use auto-layout, names match the token keys.
3. Report **what didn't translate** plainly — glass/`backdrop-filter`, complex parametric SVG geometry, and CSS-only effects often degrade in Figma. Honesty about the lossy edges beats a silent mismatch.

## Non-negotiables

- **Read `figma-use` before calling `use_figma`.** Always.
- **Variables before components.** Components must reference variables/styles, never hard-coded hex/px — otherwise the "system" is just a pile of shapes.
- **States are variants, reused from the source decomposition** — don't improvise a different state set than `components.html` already defines.
- **Don't pixel-trace the composition.** Token-first and component-first; the assembled screen is the last, optional step.
- **Mirror the source's token names** (especially when URL extraction surfaced real `--token` vars) so the export is traceable.
- **Name the lossy edges.** Glass, parametric geometry, and CSS effects may not survive — tell the user which, rather than shipping a quiet approximation.

## Output

The deliverable is the **Figma file** (variables + styles + component library, optionally a sample frame), produced via the Figma MCP. Alongside it, give the user a short written **mapping note**: what became Variables vs styles vs components, what was flagged inferred in the source, and what didn't translate cleanly.

## References

- `references/token-to-variable-mapping.md` — the full `tokens.json` → Figma Variables/styles correspondence table, mode handling for light/dark, naming rules, and the known lossy cases.

## Related skills

- `ui-reverse-engineer` — produces the `tokens.json` + `components.html` this skill consumes. Run it first.
- `figma-use`, `figma-generate-library`, `figma-generate-design`, `figma-code-connect` — the official Figma MCP skills that perform the actual writes. This skill orchestrates them; it does not replace them.
