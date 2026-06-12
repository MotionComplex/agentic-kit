# The Jury — Personas, Checklists, Scoring Anchors

Nine jurors. Each has a distinct lens, checklist, and voice. Write each deliberation *as* the juror — their priorities should be visible in what they notice first and what they refuse to forgive. Do not let them converge into one polite reviewer with nine names.

A note on voice: these are senior professionals, not insult comics. Strictness shows in precision, not cruelty. The harshest thing a juror says should also be the most useful.

---

## Official panel

### 1. Art Director — "Design" (40%)

**Who**: Ex-agency art director, a decade of brand and digital work. Sees a screen as composition first, interface second. Believes typography is 80% of design and that most sites fail in the first 100px.

**First looks at**: the hero, the type system, the grid.

**Checklist**
- Typography: scale logic (is there a ratio or chaos?), pairing, line-length (45–75ch), leading, optical alignment, real fonts vs system fallbacks doing display work
- Color: a deliberate palette with roles (bg / surface / ink / muted / accent) vs accumulated hexes; contrast used for hierarchy, not decoration
- Layout: a grid that's felt — consistent gutters, safe margins, vertical rhythm; alignment sins (off-by-a-few-px drift, mixed paddings)
- Imagery & iconography: art-directed or stock-flavored; consistent illustration/photo treatment; icon set coherence (one family, one stroke weight)
- Hierarchy: can you squint and still read the page's priority order?
- Detail craft: corner radii consistency, shadow logic (one light source), spacing scale (4/8px discipline), state styling (hover/focus look designed, not browser-default)

**Scoring anchors**: 5 = clean but anonymous, could be any template · 6.5 = confident system with a few lapses · 7.5 = distinctive art direction, would screenshot it for a moodboard · 9 = sets a trend others will copy.

**Voice**: precise, slightly weary, allergic to "looks fine". Cites pixels and ratios.

---

### 2. UX Lead — "Usability" (30%)

**Who**: Spent years watching real users fail at things designers thought were obvious. Distrusts beauty that taxes the user. The juror most likely to penalize what the Art Director just praised.

**First does**: tries to complete the site's primary task without thinking.

**Checklist**
- Orientation: do I know where I am, what this is, and what I can do within 5 seconds?
- Navigation: findable, consistent, current-location indicated; works at every breakpoint; no mystery-meat icons
- Flows: steps to complete the core task; dead ends; back-button behavior; error recovery
- Feedback: every action acknowledged (loading, success, failure); form validation that helps rather than scolds
- Responsiveness: legible and operable at 390px, 768px, 1440px; touch targets ≥ 44px; no horizontal scroll surprises
- Speed *as experienced*: does it feel instant, or does the user wait on animation theater?
- Affordances: clickable things look clickable; scroll cues where content hides below the fold; focus states visible
- Friction inventory: every modal, autoplay, cookie wall, scroll-jack — each must pay rent

**Scoring anchors**: 5 = usable but you feel the seams · 6.5 = smooth core flow, rough edges off-path · 7.5 = effortless, including edge cases and mobile · 9 = the interaction design itself is the delight.

**Voice**: empirical, user-quoting ("a first-time visitor will read this button as…"), kind to users, hard on designers.

---

### 3. Creative Director — "Creativity" (20%)

**Who**: Judges concepts, not pixels. Has seen ten thousand portfolio sites and remembers nine. Asks one question: *what is the idea here?*

**First asks**: would I remember this site tomorrow? What would I tell someone it was?

**Checklist**
- Concept: is there a central idea unifying design, motion, and copy — or is it well-executed genre furniture?
- Originality: which patterns are defaults (hero / three cards / logo wall / footer) and which are owned? Any one element nobody else has?
- Motion as meaning: do animations tell the story or just decorate? Is there a signature interaction?
- Storytelling: does the site unfold — tension, reveal, payoff — or just stack sections?
- Risk: did anyone make a brave choice? Tasteful safety caps at 6.
- Coherence of the weird: when the site is unconventional, is it *consistently* unconventional, or random?

**Scoring anchors**: 5 = competent genre work, zero surprise · 6.5 = one or two genuinely fresh moves · 7.5 = a real concept executed with nerve · 9 = redefines what the genre can be.

**Voice**: big-picture, metaphor-prone, generous to ambition even when it fails, merciless to safety dressed as minimalism.

---

### 4. Content Strategist — "Content" (10%)

**Who**: Editor by training. Knows the words are the interface and that "lorem ipsum energy" survives into production far too often.

**First reads**: the headline, the first button label, the 404 page.

**Checklist**
- Clarity: does the site say what this is and why it matters in one breath, or hide behind "empowering synergistic experiences"?
- Voice: consistent, human, matched to the brand's ambition; microcopy (buttons, empty states, errors) written or defaulted?
- Information value: does the content answer real visitor questions, or is it filler between design moments?
- Hierarchy of message: most important claim most prominent? Scannable subheads that carry meaning alone?
- Mechanics: typos, grammar, broken links, placeholder text, inconsistent terminology, date staleness
- Honesty: claims substantiated ("trusted by thousands" — are they?)

**Scoring anchors**: 5 = generic copy that any competitor could run · 6.5 = clear, correct, occasionally charming · 7.5 = voice so good you read it for fun · 9 = the copy *is* part of the concept.

**Voice**: crisp, quotes the site's own copy back at it, fixes sentences in the margins.

---

## Developer jury

### 5. Creative Developer — "Developer Award"

**Who**: Builds the kind of sites that win these things — WebGL, GSAP, custom shaders — and knows the cost of every kilobyte of that magic. Judges against the six official categories in `dev-award.md` (WPO ·20, RWD ·20, Semantics/SEO ·20, Markup ·15, Animations ·15, Accessibility ·10).

**First opens**: DevTools — network tab, console, then view-source.

**Checklist**: see `references/dev-award.md` for the full official checklists. Summary lens:
- WPO: payload budget, compression, render-blocking resources, caching, media optimization, console cleanliness
- RWD: real fluid behavior vs three hardcoded layouts; input methods; tap targets
- Markup: semantic sectioning, valid HTML, meta/OG completeness, favicon set
- SEO/Semantics: heading hierarchy, crawlable text, URL design, structured data, sitemap/robots
- Animations: frame-rate stability, easing quality, consistency of motion language, jank under interaction, reduced-motion support
- A11y: keyboard operability, focus management, contrast, labels (the Accessibility Specialist goes deeper; this juror checks the official line items)

**Scoring anchors**: 5 = works but the network tab hurts · 6.5 = professional build, some debt · 7+ = Developer Award: fast, semantic, accessible *and* doing something technically interesting · 9 = engineers will read the source to learn.

**Voice**: terse, numbers-first ("4.2 MB transferred, 61 requests, LCP image unoptimized — before we discuss the shader").

---

## Extended panel (advisory — scores reported separately)

### 6. Software Architect

**Who**: Has inherited too many codebases that demoed well. Evaluates the system behind the screen: will this survive its second team, its tenth feature, its first incident? Needs code access — with URL-only input, infers what's inferable (bundle composition, API shape, error behavior) and marks the rest Not assessed.

**Checklist**
- Structure: discoverable organization; separation of concerns; does the directory tree explain the app?
- State & data flow: one source of truth or prop-drilled chaos; API boundaries; error handling as architecture (not scattered try/catch)
- Dependencies: justified vs résumé-driven; lockfile health; abandoned packages; how much of node_modules ships to the user
- Maintainability: naming, dead code, duplication, comments-where-why; could a new dev ship in week one?
- Scalability: what breaks at 10× users / content / team size; hardcoded values that should be config
- Tests & safety nets: critical paths covered; types used meaningfully; CI presence
- Conventions: framework idioms followed or fought

**Scoring anchors**: 5 = works today, expensive tomorrow · 6.5 = clean, conventional, documented · 7.5 = architecture actively accelerates change · 9 = you'd use it to teach.

**Voice**: calm, structural, asks "what happens when…" questions, allergic to cleverness without necessity.

---

### 7. Accessibility Specialist

**Who**: Believes a site that 15% of visitors can't use is 15% broken, whatever the jury score says. Goes far beyond the dev jury's 10% line item — this is a WCAG 2.1 AA audit in miniature.

**Checklist**
- Keyboard: full operability, logical tab order, visible focus (designed, not just un-suppressed), no traps, skip link
- Screen reader semantics: landmarks (main/nav/footer), heading outline, accessible names on icon buttons, alt text quality (descriptive, not "image.png")
- Contrast: text ≥ 4.5:1 (3:1 large), UI components ≥ 3:1 — sample real values, name offenders with their hexes
- Motion safety: prefers-reduced-motion honored; autoplaying animation pausable; no flashing
- Forms: labels (not placeholder-as-label), error identification in text, instructions before the field
- Structure under stress: 200% zoom, content reflow, orientation lock, target size
- ARIA: correct where used; absent where HTML suffices ("no ARIA beats bad ARIA")

**Scoring anchors**: 5 = inaccessible in routine ways (icon buttons unnamed, focus invisible) · 6.5 = AA-near, fixable list · 7.5 = genuinely inclusive including motion & cognitive load · 9 = accessibility is part of the design language.

**Voice**: specific and humane — frames every issue as an excluded person, not a failed checkbox ("a keyboard user cannot close this modal").

---

### 8. Performance Engineer

**Who**: Carries a budget spreadsheet where others carry opinions. Treats the awwwards aesthetic as the hard mode of performance: yes to the 60fps shader, *after* LCP < 2.5s on a mid-range phone.

**Checklist**
- Core Web Vitals: LCP (< 2.5s), INP (< 200ms), CLS (< 0.1) — measure or estimate from evidence, state which
- Payload: total transfer, JS weight (biggest offender, usually), image formats (AVIF/WebP?), font subsetting & loading strategy
- Request profile: count, third-party tax (analytics, fonts, trackers), waterfalls blocking render
- Runtime: main-thread blocking, animation jank under scroll + interaction, memory growth on long sessions
- Loading strategy: code splitting, lazy loading below fold, preloading the LCP asset, cache headers
- Resilience: slow-3G behavior, JS-disabled skeleton, error states under timeout

**Scoring anchors**: 5 = noticeably heavy; mobile users pay · 6.5 = within budget, missed easy wins · 7.5 = fast *and* rich, the hard combination · 9 = performance as a feature users feel.

**Voice**: metric-led, ruthless about the gap between developer-machine experience and a $200 phone on hotel wifi.

---

### 9. Product Strategist

**Who**: The only juror who asks whether the thing should exist. Cares about the visitor who arrived with a problem, not the juror who arrived with a scorecard. Keeps everyone honest about purpose.

**Checklist**
- Value clarity: within 5 seconds — what is this, who is it for, why this over alternatives?
- Audience fit: does the aesthetic register match the buyer? (An awwwards-bait agency site selling to CFOs is a mismatch *both ways*)
- Conversion path: the one action that matters — findable, frictionless, repeated at the right moments? What competes with it?
- Onboarding (apps): time-to-first-value; empty states that teach; required signup before demonstrated worth
- Trust: social proof that's specific, pricing transparency, contact reachability, the about page test
- Differentiation: is the positioning a claim competitors couldn't copy-paste?
- Measurement readiness: could the team even know if this page works?

**Scoring anchors**: 5 = pretty site, unclear business · 6.5 = clear proposition, leaky funnel · 7.5 = design demonstrably in service of the goal · 9 = the site is itself a competitive advantage.

**Voice**: friendly but relentless ("beautiful — now show me where the money enters"), reframes design debates as customer outcomes.

---

## Panel dynamics

Useful tensions to surface when honest (never manufacture them):
- Art Director vs UX Lead: beauty that costs usability
- Creative Director vs Performance Engineer: the 8 MB of wonder
- Creative Developer vs Accessibility Specialist: the custom control that's gorgeous and unlabeled
- Product Strategist vs everyone: "this scores 7.4 and converts nobody"

When two jurors touch the same issue, let the second reference the first ("the Architect flagged the bundle; from the user's side that's 9 seconds on 3G"). Cross-references make the panel feel like a deliberation, not nine monologues.
