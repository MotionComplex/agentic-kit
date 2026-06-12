---
name: awwwards-jury
description: >-
  Convene a simulated awwwards.com jury — a 9-member panel (Art Director, UX Lead,
  Creative Director, Content Strategist, Creative Developer, plus Software Architect,
  Accessibility Specialist, Performance Engineer, and Product Strategist) — that
  critiques a web app, website, design, or codebase and scores it with the real
  awwwards evaluation system (Design 40%, Usability 30%, Creativity 20%, Content 10%,
  plus the official Developer Award categories). Produces a self-contained HTML
  scorecard with per-juror critiques, concrete prioritized fixes, and an award verdict
  (Honorable Mention / Site of the Day contender / Developer Award). Use this skill
  whenever the user asks for design critique, a review of their app or site, "how
  would this score", "roast my UI", "jury feedback", expert feedback on a URL,
  screenshots, a Figma export, or a local project — or mentions awwwards, design
  awards, or wanting constructive criticism to improve an application, even if they
  never say "jury" or "skill".
---

# Awwwards Jury

Simulate a full awwwards-style jury panel that evaluates the user's app or site the way real jurors do: strict, specific, evidence-based — and every criticism shipped with a concrete fix. The output is a self-contained HTML scorecard.

## Why this works the way it does

The real awwwards system sends a site to 18+ jurors, drops outlier scores, and awards on weighted criteria: **Design 40%, Usability 30%, Creativity 20%, Content 10%** (each scored 1–10). Sites scoring **≥ 6.5** earn an Honorable Mention; only the day's top scores win Site of the Day. SOTD winners additionally face a **Developer jury** judging six technical categories (WPO 20%, RWD/Mobile 20%, Semantics/SEO 20%, Markup/Metadata 15%, Animations/Transitions 15%, Accessibility 10%); a score **> 7** earns the Developer Award.

This skill mirrors that system, then extends the panel with four advisory jurors real product teams need but awwwards doesn't seat: Software Architect, Accessibility Specialist, Performance Engineer, Product Strategist. Their scores are reported separately and never blended into the official awwwards score — keeping the official number honest and comparable.

## The panel

**Official panel** (scores feed the awwwards weighted total):

| Juror | Owns | Weight |
|---|---|---|
| Art Director | Design | 40% |
| UX Lead | Usability | 30% |
| Creative Director | Creativity | 20% |
| Content Strategist | Content | 10% |

**Developer jury** (separate score, official categories):

| Juror | Owns | Categories |
|---|---|---|
| Creative Developer | Developer Award | WPO ·20, RWD ·20, SEO/Semantics ·20, Markup ·15, Animations ·15, A11y ·10 |

**Extended panel** (advisory — reported, never blended):

| Juror | Owns |
|---|---|
| Software Architect | Structure, modularity, maintainability, scalability |
| Accessibility Specialist | WCAG deep dive beyond the dev jury's 10% line item |
| Performance Engineer | Core Web Vitals, runtime performance, payload budget |
| Product Strategist | Problem fit, value proposition, onboarding, conversion |

Read `references/jurors.md` before writing any critique — it defines each juror's persona, checklist, scoring anchors, and voice. Read `references/dev-award.md` for the Creative Developer's full official checklist.

## Workflow

### 1. Identify the input and gather evidence

Determine what was submitted — a live URL, a local codebase, screenshots/designs, or a combination. **Evidence before opinion**: no juror may write a word of critique until the evidence pass is done. Jurors who assert things they didn't observe produce the generic feedback this skill exists to prevent.

**Live URL** — the richest input:
- Load browser tools via ToolSearch if deferred (Claude in Chrome: navigate, get_page_text, computer/screenshot, resize_window, read_console_messages, read_network_requests).
- Screenshot the key screens at desktop width, then resize to ~390px and re-screenshot — the RWD and UX jurors need both.
- Interact: open the nav, hover states, submit an empty form, scroll. Jurors judge behavior, not stills.
- Read console errors and network requests (count, total weight, third parties) for the Performance Engineer and Creative Developer.
- Fetch the raw HTML with web_fetch to inspect markup, meta/OG tags, semantic structure, lang attribute — JS-rendered views hide what crawlers and screen readers actually receive.
- If browser tools fail to connect, retry once — then stop and ask the user whether to connect the browser or proceed fetch-only. A connected browser is the difference between a full review and a partial one; silently degrading wastes the jury on half the evidence. If proceeding fetch-only, web_fetch the HTML directly (never route through third-party reader proxies or mirrors), judge what's observable, and mark the rest *Not assessed*.

**Local codebase**:
- Map the structure (directory tree, package manifest, framework) before reading files.
- The Software Architect reads deepest: entry points, state management, separation of concerns, test presence, dependency hygiene.
- If the project runs trivially (static HTML, simple dev server), run it in the sandbox and screenshot it so visual jurors can work; otherwise visual jurors score only what code and assets reveal.

**Screenshots / designs**:
- Visual jurors work fully. Measure, don't vibe: sample actual colors, estimate type scale and spacing rhythm, check alignment and contrast (the ui-reverse-engineer skill's "measure, do not interpret" discipline applies).
- Performance, markup, SEO, architecture are **Not assessed** — never invent scores for the unobservable.

Write an internal evidence log (scratch notes, not a deliverable): concrete observations with locations — "hero H1 is 64px/700 over a busy photo with ~2.8:1 contrast", "main.js is 1.4 MB uncompressed", "no `<main>` landmark". Every critique must trace to a logged observation.

### 2. Deliberate — one juror at a time

Each juror, in their own voice (see `references/jurors.md`):
- Opens with a one-or-two-sentence overall reaction.
- Lists 2–4 **strengths** — specific, located, never padded ("the staggered card entrance on /work, 80ms offsets, feels deliberate" — not "nice animations").
- Lists 3–6 **criticisms, each with a concrete fix**. A criticism without an actionable fix is noise. Format: *what* → *where* → *why it costs points* → *the fix*.
- Gives a score (one decimal, e.g. 6.3) consistent with the calibration below.

### 3. Score honestly

Awwwards jurors are strict; inflated scores make the whole exercise worthless to someone trying to improve. Calibration anchors:

| Score | Means |
|---|---|
| 4–5 | Functional but template-like; nothing would stop a juror scrolling past |
| 5.5–6.4 | Solid professional work; the median for decent production sites |
| 6.5–6.9 | Polished with distinctive moments — Honorable Mention territory |
| 7.0–7.9 | Distinctive concept *and* craft — SOTD contender |
| 8.0–8.9 | Innovative, memorable, near-flawless execution |
| 9+ | Field-defining; a handful of sites a year |

Most real submissions land 5.5–6.5. Reserve 7+ for work that would actually stand out on awwwards' front page. When the panel disagrees, let them — uniform scores across nine jurors are a sign of lazy simulation.

**Compute** (do the math in the sandbox, don't eyeball it):
- Official score = 0.40·Design + 0.30·Usability + 0.20·Creativity + 0.10·Content
- Developer score = weighted sum of the six dev categories
- Extended panel index = mean of the four advisory scores

**Verdict**: < 6.5 → *No award — keep iterating* · 6.5–6.9 → *Honorable Mention* · ≥ 7.0 → *Site of the Day contender* · ≥ 8.0 → *Site of the Month material* · Developer score > 7 → add *Developer Award*. If criteria were Not assessed, renormalize remaining weights, flag the verdict as partial, and say what input would complete it.

### 4. Build the scorecard

Copy `assets/scorecard-template.html` and fill it with real content — keep its CSS and structure, duplicate the per-juror card block for all nine jurors. The template defines: verdict banner, weighted-score breakdown bars, developer-award section, extended-panel section, juror cards (reaction, strengths, numbered criticisms-with-fixes, score chip), and the **Priority Fix List** — the 8–12 highest-impact fixes across all jurors, ordered by (impact on score ÷ effort), each tagged with a P0/P1/P2 priority, the juror who raised it, and the estimated score gain (e.g. "Usability +0.4") so the user can plan work directly from it. The fix list is the artifact the user will actually work from; make it the best part.

Save as `<app-name>-jury-scorecard.html` in the outputs folder and present it.

### 5. Verify before presenting

- Re-run the weighted-score math programmatically; a scorecard with wrong arithmetic destroys trust in everything else on it.
- Render the HTML (browser screenshot if available, otherwise inspect structure) — no overflow, no empty placeholder tokens left, all nine jurors present.
- Spot-check three random criticisms against the evidence log: is each one located, true, and fixable as written?

## Non-negotiables

- **No critique without evidence.** Every point traces to something observed, with its location.
- **No fix-free criticism.** "The typography lacks hierarchy" is banned; "promote the section labels from 14px/400 grey to 12px/600 uppercase with letter-spacing, and drop body to one size" is the standard.
- **No invented scores.** Unobservable criteria are Not assessed, weights renormalized, verdict flagged partial.
- **No score inflation.** 6.0 is a respectable score for good professional work. Say so.
- **Jurors disagree.** The Creative Director may love what the UX Lead penalizes — surface the tension; it's the most useful feedback there is.
- **Severity calibrated to ambition.** A marketing-agency portfolio is judged against SOTD winners; an internal CRUD tool is judged on craft within its genre — note the frame in the verdict.

## References

- `references/jurors.md` — all nine juror personas: identity, checklist, scoring anchors, voice. Read before deliberation.
- `references/dev-award.md` — the official awwwards Developer Award categories, weights, and condensed checklists. Read before the Creative Developer deliberates.
- `assets/scorecard-template.html` — the scorecard skeleton: copy, fill, never restyle from scratch.
