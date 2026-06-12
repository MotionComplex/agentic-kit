# Developer Award — Official Categories & Checklists

Condensed from the official awwwards Developer Jury Voting Guidelines. The developer score is the weighted sum of six categories; **> 7.0 earns the Developer Award** (on the real platform, only SOTD winners are sent to the developer jury — in this simulation, always evaluate and note the distinction).

| # | Category | Weight |
|---|---|---|
| 1 | Web Performance Optimization (WPO) | 0.20 |
| 2 | RWD / Mobile | 0.20 |
| 3 | Semantics / SEO | 0.20 |
| 4 | Markup / Metadata | 0.15 |
| 5 | Animations / Transitions | 0.15 |
| 6 | Accessibility | 0.10 |

Score each category 1–10 from observed evidence, then compute the weighted total. If a category is unobservable (e.g., screenshots-only input), mark it Not assessed and renormalize.

---

## 1. WPO — Web Performance Optimization (0.20)

Goal: contents displayed fast to the end user; optimized delivery; proper render-blocking management; balance of metric-based and *perceived* performance.

Check: compression/gzip(brotli) enabled · critical rendering path and resource load order · render-blocking JS deferred/async · above-the-fold prioritized · CSS/JS minified · media optimized, compressed, lazy/deferred (modern formats) · CDN use · cache layers and Cache-Control/Expires headers · few redirects and DNS lookups · third-party plugin restraint · no iframes where avoidable · responsive images (scale, format, lazy) · progressive enhancement / graceful degradation · conditional/lazy loading · **no console logs or errors** · rendering performance · HTTPS + HTTP/2(+) · works cross-browser.

Relevant metrics: page load and above-the-fold time · total HTTP requests · asset count and weight · media weight · domain count · third-party dependency count.

## 2. RWD / Mobile (0.20)

Goal: consistent experience regardless of screen size or input method; critical content reachable via click, swipe, and pinch alike.

Check: flexible grid / liquid layout (not three frozen artboards) · flexible media · responsive images · consistent breakpoints · mobile performance · readable, responsive typography · conditional/lazy loading · viewport meta correct · feature detection over UA sniffing · retina/pixel-density assets · proper input handling per device · **tap target size** · recognized RWD navigation patterns · cross-browser.

## 3. Semantics / SEO (0.20)

Goal: information hierarchy that users, browsers, and crawlers can understand; the site findable and indexable.

Check: unique, accurate per-page meta (title, description) · clean URL structure (readable, hyphenated, no junk params) · image alt text with descriptive filenames · sensible anchor text · canonicalization; avoid duplicate content · structured data (Schema.org), Open Graph, Twitter Cards · `lang` declared · HTML5 semantic sectioning (nav/main/section/footer) and heading hierarchy used for actual relevance · XML sitemap + robots.txt · proper redirects (301 vs 307), minimized 404s · real text for navigation and content (crawlers can't read your WebGL) · quality signals: speed, no broken links, no spelling errors.

## 4. Markup / Metadata (0.15)

Goal: minimal, meaningful, valid markup; the document's structure legible to machines and the next developer.

Check: valid HTML · doctype, lang, charset · complete `<head>` (title, meta, viewport) · standard + structured metadata · OpenGraph/social integration · images with alt, width, height · document organization and cohesion · readable source (indentation, naming, comments where they earn their place) · semantic naming conventions · **no div-itis / class-itis / tag soup** · favicon set at multiple sizes, cacheable.

Tip from the guideline: isolate the content and mentally project its markup — content-first thinking produces structural, semantic HTML.

## 5. Animations / Transitions (0.15)

Goal: a consistent animation strategy, fluidly executed across pages and interactions; motion that informs (feedback, orientation, story), not just decorates. Real-time scripted animation only — video and image sequences don't count.

Check: smooth, stable frame rate · easings, timing, rhythm, appeal · balance — not too slow, fast, frequent, or inconsistent · technique quality (2D/3D, math/physics/generative where used) · memory and GPU hygiene (leaks, GLSL cost, asset management) · parallax done properly · CSS vs JS animation chosen appropriately · cross-browser.

The guideline's taxonomy, useful for critique vocabulary: **linear** (keyframed, simple triggers) vs **interactive** (driven by user input/variables) vs **transitional** (between sections/pages — with history, loading UI); procedural / representational / stochastic / behavioral types.

## 6. Accessibility (0.10)

Goal: usable by everyone, including assistive-technology users; custom widgets keyboard-operable per WCAG.

Check: keyboard/mouse/touch all supported · labeled interactive elements · focus management and visible focus · logical tab order · single large click targets (no nested duplicate links) · legible font sizes · text/background contrast · nothing essential hover-only · text alternatives for non-text content · captions/transcripts for video with audio · aria-hidden on decorative elements · working browser history · WAI-ARIA landmarks, widget roles, states/properties — correctly applied · language declared · pause controls for auto-playing animation > 5s · content survives no-CSS and no-JS · cross-browser.

Custom-control checklist: keyboard operable · touch operable (with AT enabled) · standard keys/gestures for the control type · focusable · clear focus indication · accessible name · correct role · states/properties exposed · contrast · high-contrast-mode survival.

---

## Measurement tools

When a live URL is available, ground scores in measurement rather than impression: Lighthouse / PageSpeed Insights for WPO and vitals, W3C validator for markup, WAVE/axe for accessibility, the network panel for payload and request profile, and OG debuggers for social metadata. Name the numbers in the critique.
