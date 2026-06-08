# Responsive System — breakpoints + cross-viewport component map

Extracting a design system means extracting it across *width*, not just at the one viewport the source happened to show. This file covers: the breakpoint ladder, how to adapt a layout up or down, and the published rules for which component replaces which across viewports.

Contents:
1. The breakpoint ladder
2. The core principle: recompose, don't stretch
3. Direction matters: down is deterministic, up is inferential
4. The cross-viewport component-equivalence map
5. Macro layout-reflow patterns
6. How this lands in tokens.json and the build

---

## 1. The breakpoint ladder

Use the ladder that mainstream design tooling actually ships, so output drops cleanly into real workflows. Two complementary systems:

**Build breakpoints — Webflow / Relume tier** (Relume designs on Webflow, so they share these). Webflow's defaults cascade *down* from a desktop base: Tablet ≤ 991px, Mobile-landscape ≤ 767px, Mobile-portrait ≤ 479px, plus three larger stops (1280, 1440, 1920) that cascade *up*. Relume's base design width is 1440. Net ladder:

| Tier | Width | Typical device | Design anchor |
|---|---|---|---|
| Mobile portrait | ≤ 479 | phones | 390 |
| Mobile landscape | 480–767 | large phones | 480 |
| Tablet | 768–991 | tablets portrait | 768 |
| Laptop / small desktop | 992–1279 | small laptops | 1024 |
| Desktop (base) | 1280–1439 | laptops/desktops | 1280 |
| Large desktop | 1440–1919 | desktops | 1440 (Relume base) |
| Wide | ≥ 1920 | large monitors | 1920 |

Build mobile-first (`min-width` media queries) even though Webflow's editor is desktop-first; the stops are the same numbers.

**Adaptation thresholds — Material 3 window size classes.** Material defines *where component form should flip*, which is exactly what we need for substitution logic: Compact 0–599, Medium 600–839, Expanded 840–1199, Large 1200–1599, Extra-large ≥ 1600. Map them onto the build ladder: Compact ≈ mobile, Medium ≈ tablet, Expanded ≈ laptop/desktop, Large/XL ≈ large/wide desktop.

Use the Webflow/Relume ladder for the *build* breakpoints; use Material's class thresholds to decide *when a component changes form*.

---

## 1.5 Two layers, two mechanisms (component-first)

Handle responsiveness **component-first**, in two layers. A component changes across viewports by exactly one of two mechanisms, and knowing which is which is what keeps adaptation clean:

- **Mechanism A — reflow (intrinsic, Layer 1).** The component keeps its identity and adapts itself: fluid width (fills its slot), internal reflow, density, and **progressive disclosure** (icon-only when narrow → icon+label when wide; *state-driven* disclosure like "the selected item shows its label even in the compact form"). This lives **inside the component**. Build every component as a responsive component that owns this.
- **Mechanism B — substitution (relational, Layer 2).** A *function* (e.g. navigation) is realized by *different components* per size class: bottom tab bar → nav rail → sidebar; full-screen sheet → dialog. The component doesn't decide this about itself; the **composition** picks the size-appropriate component via the map in §4.

**Layer 1 — Responsive components:** each library entry declares its fluid sizing, progressive disclosure, and states (default/selected/hover/focus/disabled) that re-express in each form it can take. Built to fill its slot, never a fixed px size.

**Layer 2 — Composition:** assigns slot roles per breakpoint, caps the container + measure, and performs substitution. It also decides, *per function per threshold*, which mechanism applies — and a single function (nav) often uses both: it reflows within a form and gets substituted between forms.

**Secondary regions flow independently — don't bind them to a hero's grid tracks.** When a tall hero (a big card) shares a multi-column grid, the *other* columns' items will stretch or gap to the hero's row-track heights, leaving stray vertical gaps. Put each secondary region (a side rail, a supporting pane) in its own flow — start-aligned, with its own gap — rather than letting `grid-template-areas` rows tie it to the hero's height. In CSS: group the rail's items and let them stack (`flex-direction:column; gap; align-self:start`) while the hero stretches; or use `display:contents` so the same markup re-groups per breakpoint. This is the cure for "widget at the top, support way below, big empty gap between."

Sequence: build the responsive components first (Layer 1), then compose and adapt (Layer 2). This is the cure for the "stranded mobile component in a desktop column" failure — the component already knows how to fill a larger slot before it's placed.

## 2. The core principle: recompose, don't stretch

Adapting across breakpoints is **relayout, not resize.** A mobile screen scaled to desktop width is a bug, not a desktop design. What changes across breakpoints:

- **Navigation form** (see the map below)
- **Column count** (1 → 2 → 3+ / sidebar + content)
- **Hero composition** (stacked full-bleed → contained or split)
- **Density** (airy single-column → denser multi-region)
- **Targets** (44–48px touch targets → ~32px pointer targets; hover states appear only on pointer devices)
- **Type & space scale** grow on a curve, not linearly (the type ratio widens, gutters and section padding step up)

What does *not* change: the token system, the brand, the material, the content. Same system, different composition.

---

## 3. Direction matters

- **Down-adaptation (desktop → mobile) is largely deterministic.** Collapse multi-column to single, fold a sidebar/top-nav into a bottom tab bar or drawer, stack what was side-by-side, convert popovers to sheets. The source already contains all the content and hierarchy; you are compressing it.
- **Up-adaptation (mobile → desktop) is partly inferential.** The source never showed a desktop layout, so you are *inventing* one — which sidebar, how many columns, what goes in the new horizontal space. Lean on the component map plus the source's taste, keep content parity, and verify hard. Be honest with the user that up-scaled viewports are generated, not extracted.

A tablet source adapts in *both* directions (build mobile and desktop from it), with the tablet as the measured anchor.

---

## 4. The cross-viewport component-equivalence map

This is the published system the question is really about. The strongest sources are Material 3's adaptive guidance, Apple's HIG size-class adaptation, and the classic responsive-pattern literature. Components don't disappear across viewports — they **change into their size-appropriate equivalent**:

| Function | Compact / mobile | Medium / tablet | Expanded / desktop | Authority |
|---|---|---|---|---|
| Primary navigation | Bottom navigation bar (or hamburger drawer) | Navigation rail (vertical icon strip, left) | Persistent navigation drawer / sidebar, or top horizontal nav | Material 3: bar → rail → drawer; Apple: tab bar → sidebar |
| Master/detail content | Single column, drill-in to detail | List-detail beginning to split | Two-pane list-detail (list + detail side by side) | Material canonical layouts (list-detail) |
| Feed / cards | 1 column, stacked | 2 columns | 3+ column grid / bento | Material feed; responsive grids |
| Secondary content | Hidden behind a tab or below the fold | Inline below | Supporting pane (right rail) | Material supporting-pane layout |
| Modal / transient | Full-screen or bottom sheet | Sheet or centered dialog | Centered dialog or popover anchored to a control | Apple HIG sheets vs popovers |
| Hero | Full-bleed image, text stacked over/under | Contained, larger type | Split (text one side, media the other) or contained with wide margins | Common practice |
| Primary action | Sticky bottom CTA / FAB / slide-action | FAB or inline | Inline button(s) in header or toolbar | Material FAB; toolbars |
| Search | Collapsed icon → expands | Field in header | Always-expanded field, possibly with filters inline | Common practice |
| Tabs / segments | Scrollable segmented control | Full tab row | Tab row or promoted to sidebar sections | Material/Apple |

The throughline (Material, Apple, SAP Fiori all converge here): **the same navigation destination is a bottom bar on a phone, a rail on a tablet, and a drawer/sidebar on desktop.** Memorize that triad; most adaptation flows from it.

---

## 5. Macro layout-reflow patterns

At the page level, pick a reflow strategy (Wroblewski / Brad Frost vocabulary):

- **Mostly Fluid** — a fluid grid that simply stacks to one column on small screens; margins grow on large. The safe default.
- **Column Drop** — multi-column that drops columns one by one as width shrinks until single-column.
- **Layout Shifter** — the most adaptive: regions genuinely reposition per breakpoint (closest to "recompose"). Most work, best fidelity for complex apps.
- **Off-Canvas** — secondary content (nav, filters) slides off-screen on mobile, becomes persistent on desktop. Pairs with the nav triad above.
- **Tiny Tweaks** — single-column content (articles) that only adjusts type/margins. For editorial, not apps.

Choose per source: a dashboard is Layout Shifter + Off-Canvas; a marketing page is Mostly Fluid; an article is Tiny Tweaks.

---

## 6. How this lands in tokens.json and the build

Add a responsive layer to the token system (it does not replace the base tokens — it scales them):

```json
"responsive": {
  "native_breakpoint": "mobile",
  "breakpoints": { "mobile": 390, "mobile_l": 480, "tablet": 768, "laptop": 1024, "desktop": 1280, "desktop_l": 1440, "wide": 1920 },
  "scale": {
    "container": { "mobile": "100%", "tablet": 720, "laptop": 960, "desktop": 1200, "desktop_l": 1320 },
    "gutter":    { "mobile": 16, "tablet": 24, "laptop": 32, "desktop": 40 },
    "type_ratio":{ "mobile": 1.2, "tablet": 1.25, "desktop": 1.333 },
    "columns":   { "mobile": 1, "tablet": 2, "laptop": 12, "desktop": 12 }
  },
  "nav_adaptation": { "compact": "bottom-bar", "medium": "rail", "expanded": "sidebar" }
}
```

Build: produce one responsive HTML file using mobile-first `min-width` media queries at these stops, applying the component substitutions from the map at the right thresholds. Then render the multi-frame board by embedding that one file in fixed-width iframes (e.g. 390 / 768 / 1280) so all viewports are visible at once. Verify each breakpoint per Phase 6 — and specifically confirm the *adaptation* is sound (right substitutions, no stretched mobile layout posing as desktop, no overflow), not just that the native width matches.

---

### Sources

- Webflow breakpoints overview (default tablet ≤991 / mobile-landscape ≤767 / mobile-portrait ≤479; larger 1280/1440/1920): https://help.webflow.com/hc/en-us/articles/33961300305811-Breakpoints-overview and https://webflow.com/blog/3-new-larger-breakpoints-in-webflow
- Relume on Webflow breakpoints: https://community.relume.io/changing-the-breakpoint-width-of-pages-in-webflow-HfT2CjgjDS3q
- Material 3 window size classes + adaptive navigation (bar → rail → drawer): https://m3.material.io/foundations/layout/applying-layout/window-size-classes and https://m3.material.io/foundations/layout/applying-layout
- Apple Human Interface Guidelines — tab bars / size-class adaptation (tab bar → sidebar in regular width): https://developer.apple.com/design/human-interface-guidelines/tab-bars and https://developer.apple.com/design/human-interface-guidelines/layout
