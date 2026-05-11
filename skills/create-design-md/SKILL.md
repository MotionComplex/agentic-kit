---
name: create-design-md
description: >
  Author a Google Stitch DESIGN.md at the root of an existing codebase, extracted
  from the project's actual design tokens and styling files. Use when the user
  says "create a DESIGN.md", "extract a DESIGN.md from this project", "generate
  a DESIGN.md from my tokens/CSS/Tailwind config", "make this codebase
  Stitch-compatible", or asks how to write or scaffold a DESIGN.md. The skill
  produces a section-ordered, lint-checkable spec (YAML front matter + 8
  canonical sections), wires up the `@google/design.md` CLI for validation and
  export, and cross-links the new file from any existing design-system docs.
  Not for editing UI itself or for new design-system work from scratch — this
  skill assumes the design system already exists in code.
compatibility: >
  Requires Node ≥ 18 (for `npx @google/design.md`). Works on any codebase with
  design tokens in CSS variables, Tailwind config, JSON tokens, SCSS variables,
  or a style guide — the skill adapts the extraction step to the source.
---

# Create DESIGN.md

Author a [Google Stitch](https://stitch.withgoogle.com) `DESIGN.md` for an
existing codebase by **extracting** values from the project's real design
tokens — not by inventing a new system. The output is a single, ordered,
lint-checkable markdown file that AI agents (Stitch, Claude, etc.) read before
generating UI.

This is the design-side counterpart to `AGENTS.md` / `CLAUDE.md`: machine-
readable YAML front matter for normative values, human-readable markdown body
for design rationale.

## When to use this skill

Trigger when the user asks to:

- "Create a DESIGN.md for this project"
- "Extract a DESIGN.md from our tokens / globals.css / Tailwind config"
- "Generate a Stitch-compatible design spec"
- "Set up DESIGN.md and wire up linting"

Skip this skill if:

- The user wants to design a *new* system from scratch — DESIGN.md is for
  documenting what already exists in code.
- The user is editing UI itself (use the design-system files directly).
- The user only wants tokens.json / DTCG output — use the
  `@google/design.md export --format dtcg` command from an existing
  DESIGN.md instead.

## Required inputs

Ask if missing:

1. **Where do the design tokens live?** Common patterns:
   - `globals.css` / `tokens.css` with `:root { --name: value }` declarations
   - `tailwind.config.{js,ts}` with `theme.extend.colors`, etc.
   - `tokens.json` / `design-tokens.json` (DTCG-shaped)
   - SCSS variables (`_tokens.scss`)
   - A TS/JS module exporting a token object
2. **Is there an existing design-system guide?** (`docs/design-system.md`,
   storybook docs, brand book) — its narrative feeds the markdown body.
3. **Light + dark themes, or single theme?** Affects how the `colors:` map is
   structured.

If the user doesn't supply paths, scan with `find . -type f \( -name 'tokens*'
-o -name 'globals.css' -o -name 'tailwind.config.*' -o -name '*.tokens.json'
\) -not -path '*/node_modules/*' | head -20` and confirm.

## The canonical DESIGN.md structure

Order is enforced by the `section-order` lint rule. Omit a section if
inapplicable, but never reorder.

```
---
version: alpha
name: <Project Name>           # required
description: >
  One- or two-sentence brand summary.
colors:                        # map<string, hex-string>
typography:                    # map<level-name, Typography>
rounded:                       # map<scale-level, Dimension>
spacing:                       # map<scale-level, Dimension>
components:                    # map<component-name, map<property, value|token-ref>>
---

# Overview                     # brand personality, design principles
# Colors                       # palette intent, semantic families, theme rationale
# Typography                   # type families, scale rationale
# Layout & Spacing             # grid, scale, content widths, z-index
# Elevation & Depth            # shadow vs tonal strategy, glass recipes
# Shapes                       # radius scale + when to use which
# Components                   # per-component anatomy / variants / states / a11y
# Do's and Don'ts              # guardrails (DO use named utilities, DON'T ...)
```

### Token taxonomy Stitch expects

- **Color** — sRGB hex, **6 chars only** (`#rrggbb`). Stitch's `Color` type
  does **not** support alpha — 8-char hex (`#rrggbbaa`) is a lint error. If
  alpha matters in your source (e.g. glass tokens), drop alpha here and keep
  the precise value in the source CSS, describing the alpha narratively in
  the body.
- **Dimension** — number + unit: `16px`, `1rem`, `-0.02em`, `9999px`. Bare
  numbers are also accepted for `spacing`.
- **Token Reference** — `{path.to.token}`, e.g. `{colors.primary}`,
  `{typography.label-lg}`. Allowed in `components:` and in `*.foreground`
  pairings.
- **Typography** — composite: `fontFamily`, `fontSize`, `fontWeight`,
  `lineHeight`, `letterSpacing`, `fontFeatures`, `fontVariations`.

### Recommended token names (Stitch convention)

- Colors: `primary`, `secondary`, `tertiary`, `neutral`, `surface`,
  `on-surface`, `error`, plus semantic families (`status-*`, `priority-*`)
  if the app needs them.
- Typography: `headline-display`, `headline-{lg,md,sm}`, `body-{lg,md,sm}`,
  `label-{lg,md,sm}`.
- Rounded: `none`, `sm`, `md`, `lg`, `xl`, `full`.
- Spacing: `xs`, `sm`, `md`, `lg`, `xl`, `2xl`, `3xl`.

Project-specific aliases (e.g. `ink`, `ink-foreground`, `glass-bg`,
`status-in-progress`) are fine and should be preserved if they exist —
agents reading the file rely on them.

### Component map shape

Stitch's `components:` is **intentionally shallow** — recognized sub-properties:
`backgroundColor`, `textColor`, `typography`, `rounded`, `padding`, `size`,
`height`, `width`. Token references allowed. Do not try to mirror every prop;
capture the **style contract** for the high-leverage atoms.

First pass should cover: `button` (and variants), `card`, `input`, `textarea`,
`badge`, `dialog`, `sheet`. Defer long tail (calendar, command palette, etc.)
with a body-section note pointing to `src/components/ui/`.

## Step-by-step

### Step 1 — Locate the design-token source

Read the file(s) the user named (or that you found via `find`). Identify:

- All color declarations (CSS vars, Tailwind colors, JSON entries)
- Radius / rounded values
- Spacing scale (named tokens like `header-clearance` count)
- Typography family + size/weight matrix
- Existing component recipes (`.button-*`, `.card-*`, etc.)

If light + dark themes exist, note which selector scopes them
(`:root` / `.dark`, `[data-theme="dark"]`, `@media (prefers-color-scheme:
dark)`). Capture both.

### Step 2 — Convert color values to 6-char hex

Stitch requires sRGB hex. Convert from whatever the source uses:

- **OKLCH** — use the conversion script in
  [references/oklch-to-hex.mjs](references/oklch-to-hex.mjs). Copy it
  into the target repo at `scripts/oklch-to-hex.mjs` and run:
  `node scripts/oklch-to-hex.mjs > /tmp/colors.yaml`.
- **HSL / RGB / Named** — use `culori` (`npx --yes culori`), or write a
  small inline conversion. For HSL specifically: `culori.formatHex({mode:
  'hsl', h, s/100, l/100})`.
- **Hex with alpha (`#rrggbbaa` or `rgba()`)** — drop the alpha; keep only
  the 6-char base. Document the alpha narratively under _Elevation & Depth_
  or _Colors_.

For dual-theme projects: emit both themes in `colors:` using a `*-dark`
suffix convention for the overrides (a pragmatic extension — Stitch has no
first-class theme model, and `*-dark` siblings are accepted by the lint
rules as ordinary token keys).

### Step 3 — Author the YAML front matter

Order: `version → name → description → colors → typography → rounded →
spacing → components`.

For each token group, prefer the **existing semantic names** in the
codebase over Stitch's recommended names. An agent reading DESIGN.md needs
to find the same identifiers it sees in JSX (`bg-primary`, `text-status-
in-progress`) — renaming would break that contract.

Components: populate the style contract for high-leverage atoms only.

### Step 4 — Write the markdown body

Eight sections in canonical order. Pull intent from any existing design-system
guide; cite it inline so a reader can deep-dive. Keep sections tight
(~150–250 words each).

**Overview** — 2–3 sentence product/brand summary + 3–5 design principles
(bullets). Reuse the project's own phrasing if a design-system guide
already states them.

**Colors** — palette intent: which color is the brand accent, what role
each semantic family plays (canvas, feedback, status, priority, charts),
how the dark theme is structured. Don't restate every hex value — the
front matter is normative.

**Typography** — type families and what each is reserved for. Note any
numerics treatment (`tabular-nums`, `font-feature-settings`).

**Layout & Spacing** — base unit, standard card/page padding, content
widths, header/bottom-nav clearance (mobile), z-index scale. Mention named
Tailwind utilities (`pt-header`, `pb-bottom-nav`, `z-modal`) so agents use
them at call sites.

**Elevation & Depth** — shadow vs tonal strategy. If the project uses
glass, this is where the glass recipe lives (the alpha values that got
dropped from `colors:` go here). Call out any "contract" requirements
(e.g. "glass needs an ambient color layer").

**Shapes** — radius scale + when to use which (e.g. controls vs cards).

**Components** — one short subsection per component covered in the front
matter: anatomy / variants / states / accessibility notes.

**Do's and Don'ts** — guardrails distilled from the project's ground rules
and any saved-preference memory. Cover at minimum:
- DO use named utilities, not arbitrary-value escapes
- DO honor `prefers-reduced-motion`
- DO use CSS logical properties if the repo's convention requires them
- DON'T introduce a second brand accent (if applicable)
- DON'T hardcode hex/blur/radius/easing at call sites
- Any project-specific "don't"s the user has flagged in CLAUDE.md or
  memory (e.g. forbidden words in copy, hover-lift prohibitions, etc.)

### Step 5 — Wire up the lint CLI

Add to `package.json` scripts:

```json
"design:lint": "npx --yes @google/design.md lint DESIGN.md",
"design:export:tailwind": "npx --yes @google/design.md export --format tailwind DESIGN.md",
"design:export:dtcg": "npx --yes @google/design.md export --format dtcg DESIGN.md",
"design:tokens:extract": "node scripts/oklch-to-hex.mjs"
```

`npx --yes` keeps it zero-install. Don't add `@google/design.md` as a
dependency. Don't add `design:lint` to a pre-commit hook on the first pass
— get clean output first.

### Step 6 — Cross-link from existing docs

Single-line edits, no new content:

- **Design-system guide** (if one exists): banner near the top —
  "Agents and tooling should consult /DESIGN.md for the normative token
  set; this guide is the long-form rationale."
- **CLAUDE.md / AGENTS.md**: under "Styling" (or equivalent), point to
  `/DESIGN.md` and `npm run design:lint`.

### Step 7 — Verify

1. **`npm run design:lint`** must exit 0 with **0 errors**. Run it and
   read the JSON output's `summary` field.

   Expected warnings:
   - `orphaned-tokens` for every semantic color not referenced by a
     `components:` entry. This is normal — a real codebase uses semantic
     aliases through JSX/CSS at the call site, not through DESIGN.md's
     shallow component map. Acceptable as long as `errors: 0`.

   Errors to fix immediately:
   - `broken-ref` — a `{token.path}` doesn't resolve. Re-check spelling.
   - `'#xxxxxxxx' is not a valid color` — 8-char hex with alpha. Strip
     the last 2 chars.
   - `contrast-ratio` (warning, not error) — surfaces foreground/background
     pairings below WCAG AA 4.5:1. Fix if the pairing is wrong; document
     if intentional (e.g. a non-text decorative pairing).

2. **`npm run design:export:tailwind`** — exits 0 and emits a
   `theme.extend.colors` object. Spot-check a half-dozen values against
   the source CSS by eye.

3. **Stitch web viewer** — drag-and-drop the file at
   `stitch.withgoogle.com` to confirm it renders. (Manual; mention this to
   the user as the last sanity check.)

4. **Agent spot-check** (optional) — ask an agent to "create a primary
   button" with DESIGN.md as sole context. It should emit
   `bg-primary text-primary-foreground rounded-{lg|md}` and not arbitrary
   hex. If it emits hex, the components map is missing the button entry
   or the token names don't match the codebase's Tailwind utilities.

## Common pitfalls

- **Alpha channels.** Stitch rejects 8-char hex. Drop alpha from `colors:`,
  describe it under _Elevation & Depth_ or _Colors_. The source CSS is the
  authority for precise alpha values; DESIGN.md is the contract surface.
- **Over-stuffing `components:`.** The map is intentionally shallow.
  Cover 6–10 high-leverage atoms; defer the long tail with a body-section
  pointer. Trying to mirror every prop produces noise and false orphan
  warnings.
- **Inventing token names.** Use the names that already exist in the
  codebase. An agent reading DESIGN.md needs to map names → Tailwind
  utilities → JSX — renamed tokens break that chain.
- **Forgetting the dark theme.** If the project has one, capture it.
  `*-dark` siblings are the most pragmatic encoding.
- **Treating the design-system guide as the source.** The guide can lie
  about exact values (`--radius: 1rem` says 16px, the guide may say
  "rounded-lg = 14px"). The CSS/Tailwind config is authoritative; the
  guide is rationale.
- **Skipping the lint step.** Running `npm run design:lint` after every
  edit catches typos, broken refs, and contrast issues immediately. It's
  the fastest feedback loop.

## Reference files

- **[references/oklch-to-hex.mjs](references/oklch-to-hex.mjs)** — zero-dep
  OKLCH→sRGB-hex conversion script. Copy into the target repo at
  `scripts/oklch-to-hex.mjs`. Implements the W3C CSS Color 4 reference
  algorithm (no `culori`, no dependencies). Reads
  `src/styles/tokens.css` by default; adjust `TOKENS_PATH` if the source
  lives elsewhere.

## Tips

- **Author the front matter first, the body last.** Token values are
  mechanical; narrative depends on knowing what shape the front matter
  settled on.
- **Cite the source.** In _Colors_ and _Shapes_, reference the actual file
  paths (`src/styles/tokens.css`, `tailwind.config.ts`) so an agent or
  reader can verify and extend.
- **Defer the long tail of components.** First pass = atoms. A second pass
  can fold in molecules (timeline, calendar, command palette) once the
  format proves itself.
- **Treat warnings as signal, not noise — then ignore the noise.** Read
  every warning the first time. Once you've decided which categories are
  expected for this codebase (typically `orphaned-tokens` for semantic
  aliases), it's fine to leave them.
- **Re-run extraction after token edits.** If the source CSS changes,
  `npm run design:tokens:extract` regenerates the hex values for re-paste
  into DESIGN.md. Don't hand-edit hex.
