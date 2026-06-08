# Phase 1 — Mode A: Extraction from a live URL

When the source is a URL instead of a static image, you stop *inferring* values and start *reading* them. The page already contains the answers a screenshot forces you to estimate: exact colors, the real font stack, true radii and shadows, the spacing actually used, and — on a well-built site — the design tokens themselves. This is the highest-fidelity input the skill can take. Treat it that way: measure the DOM, and fall back to pixels only where the DOM can't answer.

## The principle: ground truth beats inference

A screenshot has no metadata, so Phase 1 Mode B reconstructs values from pixels: sampling hex, guessing a base unit, naming a typeface from letterforms. Every one of those is a best-guess with error bars. A live page hands you the computed value directly. So in Mode A the work is *harvesting and normalizing*, not estimating — and the normalizing (Phase 2) is often half-done already, because component-based sites ship explicit token systems.

The one thing the DOM does **not** give you is the visual *classification* — whether a surface is a photo, an illustration, or a material effect — and you still need a render for Phase 6. So Mode A is DOM-first **plus** a screenshot, never DOM-only.

## Tooling

Use Claude in Chrome. Load the tools via ToolSearch if they're deferred (`mcp__Claude_in_Chrome__navigate`, `..._javascript_tool`, `..._computer`, `..._get_page_text`, `..._read_page`).

1. `navigate` to the URL.
2. Get the page into the **one state** you want to reconstruct (see scoping below): set the viewport, dismiss cookie/consent overlays, log in if you legitimately can, expand the relevant view.
3. Run extraction JS through `javascript_tool`.
4. `computer` screenshot at the recorded viewport width — this feeds classification and verification.

## Scope to one screen and one state

The skill's "don't conflate screens" rule applies harder to URLs, because a site is many screens and many states. Before extracting:

- Pick **one route/page** and reconstruct that. Don't blend the marketing home and the app dashboard.
- Settle the **state**: dismiss modals/cookie banners (or, if the modal *is* the target, capture that and nothing behind it), choose logged-in vs logged-out, pick light or dark theme.
- Record the **viewport width** you read at — that becomes the native breakpoint anchor in Phase 2. If you want the responsive ladder, re-read computed values at 2-3 widths (e.g. 390 / 768 / 1280) rather than guessing how it reflows.

## What to extract, and the snippets

### Exposed design tokens (check first — this can shortcut Phase 2)

Many design systems publish their tokens as CSS custom properties on `:root`. If present, this *is* the design system — harvest it directly instead of inferring it.

```js
// All custom properties declared on :root
const root = document.documentElement;
const sheetVars = {};
for (const sheet of document.styleSheets) {
  let rules; try { rules = sheet.cssRules; } catch { continue; } // cross-origin sheet
  for (const rule of rules || []) {
    if (rule.selectorText === ':root' && rule.style) {
      for (const name of rule.style) {
        if (name.startsWith('--')) sheetVars[name] = rule.style.getPropertyValue(name).trim();
      }
    }
  }
}
JSON.stringify(sheetVars, null, 2);
```

Token names alone are informative (`--color-surface`, `--space-4`, `--radius-lg`, `--font-sans`) — they reveal the system's own vocabulary, which you can mirror in `tokens.json`.

### Computed values per element

For any element you care about (read its selector off `read_page` / `get_page_text` or inspect the DOM), pull the resolved values:

```js
function readStyle(sel) {
  const el = document.querySelector(sel);
  if (!el) return null;
  const cs = getComputedStyle(el);
  const props = [
    'color','background-color','background-image',
    'font-family','font-size','font-weight','line-height','letter-spacing',
    'border-radius','border-width','border-color',
    'box-shadow','backdrop-filter','opacity',
    'padding','margin','gap','display','flex-direction',
    'width','height'
  ];
  return Object.fromEntries(props.map(p => [p, cs.getPropertyValue(p)]));
}
readStyle('.your-selector');
```

### Color, type, spacing harvest (whole page)

To infer scales when no token vars exist, sample the distribution across many elements rather than eyeballing a few:

```js
const all = [...document.querySelectorAll('*')].slice(0, 4000);
const tally = (fn) => {
  const m = new Map();
  for (const el of all) { const v = fn(getComputedStyle(el)); if (v) m.set(v, (m.get(v)||0)+1); }
  return [...m.entries()].sort((a,b)=>b[1]-a[1]);
};
({
  colors:       tally(cs => cs.color),
  backgrounds:  tally(cs => cs.backgroundColor).filter(([v]) => v !== 'rgba(0, 0, 0, 0)'),
  fontFamilies: tally(cs => cs.fontFamily),
  fontSizes:    tally(cs => cs.fontSize),
  radii:        tally(cs => cs.borderRadius).filter(([v]) => v !== '0px'),
  shadows:      tally(cs => cs.boxShadow).filter(([v]) => v !== 'none'),
});
```

The frequency-ranked output makes the system legible: the top few colors are your roles (bg / surface / ink / muted / line / accent), the recurring font-sizes are your type scale, the common gaps reveal the base unit.

### Breakpoints

Read them from the stylesheets rather than guessing:

```js
const bps = new Set();
for (const sheet of document.styleSheets) {
  let rules; try { rules = sheet.cssRules; } catch { continue; }
  for (const rule of rules || []) {
    if (rule.media) for (const m of rule.media) {
      const hit = /\d+px/.exec(m); if (hit) bps.add(m);
    }
  }
}
[...bps].sort();
```

### Fonts

`font-family` gives you the real stack — no letterform guessing. Record the first declared family and load that exact webfont (or its nearest free equivalent if it's a paid/licensed face). Confidence is "known," not "inferred."

### Assets

For real `<img>`/background images, note the URL and — per the fidelity contract — decide whether to reuse it or substitute a category-correct asset. Don't hotlink the source's production assets into the reconstruction; treat them as category references.

## What to trust vs re-derive

- **Trust directly:** computed colors, font stacks, radii, shadows, the page's own `--token` vars, declared `@media` widths. These are exact.
- **Still normalize (Phase 2):** raw computed paddings/margins are exact but *not yet a system* — a page can use 13/14/15px sloppily. Run the same base-unit inference and snapping you'd run on a screenshot; the difference is your inputs are precise, so the inferred scale is cleaner.
- **Still classify visually (Mode B work on the screenshot):** photo vs illustration vs material effect, full-bleed vs inset, signature geometry. `backdrop-filter: blur(...)` in the computed style confirms glass, but you still confirm the *style* (glossy vs flat frosted) from the render.
- **Don't trust blindly:** computed styles reflect the live DOM including A/B tests, consent-state, and JS-injected overrides. Re-read after you've settled the state.

## When to fall back to a screenshot (Mode B)

Drop to pixel measurement for anything the DOM can't answer cleanly:

- **Canvas / WebGL / `<video>`** surfaces — the pixels aren't in styleable DOM.
- **Cross-origin stylesheets** that throw on `cssRules` access and expose no `--token` vars.
- **Auth-walled or paywalled** pages you can't legitimately reach.
- **Hostile/obfuscated CSS** (atomic class soup with thousands of rules) where reading is slower and less reliable than just measuring the render.

In these cases, screenshot and proceed exactly as Mode B. A single source can be mixed: read the chrome from the DOM, measure a canvas chart from pixels.

## Hand-off to Phase 2

Mode A and Mode B converge here. Whatever you harvested — exact computed values or sampled pixels — gets the same treatment: infer the base unit, derive the scales, snap-and-flag, emit `tokens.json`. If the site shipped its own token vars, map them onto the schema and note in `design.html` that the system was *extracted from published tokens* (high confidence) rather than inferred — that's a flagged provenance fact worth surfacing.
