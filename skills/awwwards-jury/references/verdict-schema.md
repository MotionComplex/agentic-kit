# JSON Verdict — Canonical Schema

The machine-readable form of a jury verdict, for pipeline gates and other automated consumers. Same deliberation as the HTML scorecard, different rendering: every number in this file is computed, every critique still traces to evidence. A consumer typically gates on `official.weighted` (common threshold: ≥ 6.5, the Honorable Mention line) and treats results inside an ambiguity band around the threshold (± 0.4) or with low `confidence` as "ask a human".

Emit one JSON object per review, saved as `<app-name>-jury-verdict.json`. Validate it against the schema below before presenting — `npx ajv-cli validate --spec=draft2020 -s schema.json -d verdict.json`, or a few lines of node.

## Field summary

| Field | Type | Meaning |
|---|---|---|
| `schemaVersion` | const `1` | Bump only on breaking change |
| `subject` | object | `kind`: `url` \| `codebase` \| `screenshots` (the primary input; mention extras in `ref`) · `ref`: the URL, path, or screenshot-set description |
| `evidenceMode` | `full` \| `partial` | `partial` whenever any official criterion or developer category is Not assessed; extended-panel gaps alone do not flip it |
| `official` | object | The four awwwards criteria (1–10, one decimal, `null` = Not assessed) plus `weighted` — renormalize weights over assessed criteria when partial |
| `developer` | object \| `null` | The six Developer Award categories plus `weighted`; `null` when the whole dev jury cannot assess (e.g. screenshots-only) |
| `extended` | object \| `null` | Advisory scores: `architect`, `a11ySpecialist`, `perfEngineer`, `productStrategist` (each nullable); never blended into `official` |
| `perJuror[]` | array | One entry per juror who assessed: `juror`, `score`, `reaction`, `strengths[]` (2–4 norm), `criticisms[]` (3–6 norm) of `{what, where, why, fix, estGain}` |
| `priorityFixes[]` | array | The cross-panel fix list (8–12 norm), ordered by impact ÷ effort: `{priority: P0|P1|P2, fix, juror, estGain}` |
| `verdict` | enum | `no-award` · `honorable-mention` · `sotd-contender` · `sotm`; append `+dev-award` when developer weighted > 7 |
| `confidence` | number 0–1 | Computed, never vibed — formula below |
| `notAssessed[]` | string[] | Dotted paths of everything unscored, e.g. `"developer.animations"`, `"extended.architect"` |

`estGain` is the estimated score movement if the fix lands, formatted `"<Criterion> +<delta>"` (e.g. `"Usability +0.4"`, `"WPO +0.8"`). Inside a criticism it may be `null` when the point is purely advisory; in `priorityFixes` it is required — a fix that moves nothing doesn't belong on the list.

## Computed fields — the formulas

Do this math in the sandbox, not in your head:

- **`official.weighted`** = 0.40·design + 0.30·usability + 0.20·creativity + 0.10·content. If a criterion is `null`, renormalize the remaining weights to sum to 1.
- **`developer.weighted`** = 0.20·(wpo + rwd + seo) + 0.15·(markup + animations) + 0.10·a11y, renormalized the same way over assessed categories.
- **`verdict`**: weighted < 6.5 → `no-award` · 6.5–6.9 → `honorable-mention` · ≥ 7.0 → `sotd-contender` · ≥ 8.0 → `sotm`; suffix `+dev-award` if `developer.weighted` > 7.
- **`confidence`** = round(E × V, 2), where
  - **E (evidence completeness)** = 0.7 × (sum of weights of assessed official criteria) + 0.3 × (sum of weights of assessed developer categories; 0 if `developer` is `null`). Full URL-with-browser evidence → E = 1.0; screenshots-only caps E at ≤ 0.7.
  - **V (panel agreement)** = 1 − min(0.4, Var/4), where Var is the population variance of the assessed official-panel scores. Healthy disagreement barely dents it; a panel split 4 vs 8 says the verdict itself is uncertain, and V says so.

## JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://github.com/MotionComplex/agentic-kit/skills/awwwards-jury/references/verdict-schema.json",
  "title": "Awwwards Jury Verdict",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schemaVersion", "subject", "evidenceMode", "official", "developer",
    "extended", "perJuror", "priorityFixes", "verdict", "confidence", "notAssessed"
  ],
  "properties": {
    "schemaVersion": { "const": 1 },
    "subject": {
      "type": "object",
      "additionalProperties": false,
      "required": ["kind", "ref"],
      "properties": {
        "kind": { "enum": ["url", "codebase", "screenshots"] },
        "ref": { "type": "string", "minLength": 1 }
      }
    },
    "evidenceMode": { "enum": ["full", "partial"] },
    "official": {
      "type": "object",
      "additionalProperties": false,
      "required": ["design", "usability", "creativity", "content", "weighted"],
      "properties": {
        "design": { "$ref": "#/$defs/scoreOrNull" },
        "usability": { "$ref": "#/$defs/scoreOrNull" },
        "creativity": { "$ref": "#/$defs/scoreOrNull" },
        "content": { "$ref": "#/$defs/scoreOrNull" },
        "weighted": { "$ref": "#/$defs/score" }
      }
    },
    "developer": {
      "anyOf": [
        { "type": "null" },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["wpo", "rwd", "seo", "markup", "animations", "a11y", "weighted"],
          "properties": {
            "wpo": { "$ref": "#/$defs/scoreOrNull" },
            "rwd": { "$ref": "#/$defs/scoreOrNull" },
            "seo": { "$ref": "#/$defs/scoreOrNull" },
            "markup": { "$ref": "#/$defs/scoreOrNull" },
            "animations": { "$ref": "#/$defs/scoreOrNull" },
            "a11y": { "$ref": "#/$defs/scoreOrNull" },
            "weighted": { "$ref": "#/$defs/score" }
          }
        }
      ]
    },
    "extended": {
      "anyOf": [
        { "type": "null" },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["architect", "a11ySpecialist", "perfEngineer", "productStrategist"],
          "properties": {
            "architect": { "$ref": "#/$defs/scoreOrNull" },
            "a11ySpecialist": { "$ref": "#/$defs/scoreOrNull" },
            "perfEngineer": { "$ref": "#/$defs/scoreOrNull" },
            "productStrategist": { "$ref": "#/$defs/scoreOrNull" }
          }
        }
      ]
    },
    "perJuror": {
      "type": "array",
      "minItems": 1,
      "maxItems": 9,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["juror", "score", "reaction", "strengths", "criticisms"],
        "properties": {
          "juror": { "$ref": "#/$defs/jurorId" },
          "score": { "$ref": "#/$defs/score" },
          "reaction": { "type": "string", "minLength": 1 },
          "strengths": {
            "type": "array",
            "minItems": 1,
            "items": { "type": "string", "minLength": 1 }
          },
          "criticisms": {
            "type": "array",
            "minItems": 1,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": ["what", "where", "why", "fix", "estGain"],
              "properties": {
                "what": { "type": "string", "minLength": 1 },
                "where": { "type": "string", "minLength": 1 },
                "why": { "type": "string", "minLength": 1 },
                "fix": { "type": "string", "minLength": 1 },
                "estGain": {
                  "anyOf": [{ "$ref": "#/$defs/estGain" }, { "type": "null" }]
                }
              }
            }
          }
        }
      }
    },
    "priorityFixes": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["priority", "fix", "juror", "estGain"],
        "properties": {
          "priority": { "enum": ["P0", "P1", "P2"] },
          "fix": { "type": "string", "minLength": 1 },
          "juror": { "$ref": "#/$defs/jurorId" },
          "estGain": { "$ref": "#/$defs/estGain" }
        }
      }
    },
    "verdict": {
      "enum": [
        "no-award", "honorable-mention", "sotd-contender", "sotm",
        "no-award+dev-award", "honorable-mention+dev-award",
        "sotd-contender+dev-award", "sotm+dev-award"
      ]
    },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
    "notAssessed": {
      "type": "array",
      "items": { "type": "string", "minLength": 1 }
    }
  },
  "$defs": {
    "score": { "type": "number", "minimum": 1, "maximum": 10 },
    "scoreOrNull": {
      "anyOf": [{ "$ref": "#/$defs/score" }, { "type": "null" }]
    },
    "jurorId": {
      "enum": [
        "art-director", "ux-lead", "creative-director", "content-strategist",
        "creative-developer", "software-architect", "accessibility-specialist",
        "performance-engineer", "product-strategist"
      ]
    },
    "estGain": {
      "type": "string",
      "pattern": "^[A-Za-z][A-Za-z0-9/ ]* \\+[0-9]+(\\.[0-9]+)?$"
    }
  }
}
```

## Worked example

A live-URL review with full browser evidence; the codebase was not shared, so the Software Architect sits out (`extended.architect: null`, listed in `notAssessed`, eight entries in `perJuror`). Math check: official.weighted = 0.4·7.1 + 0.3·6.4 + 0.2·6.6 + 0.1·6.2 = **6.70** → `honorable-mention`. developer.weighted = 0.2·(5.8+6.5+6.9) + 0.15·(6.4+7.2) + 0.1·5.6 = **6.44** → no dev-award suffix. Confidence: E = 1.0; official scores [7.1, 6.4, 6.6, 6.2] have population variance 0.1119 → V = 1 − 0.1119/4 = 0.972 → confidence = **0.97**.

```json
{
  "schemaVersion": 1,
  "subject": { "kind": "url", "ref": "https://lumen.studio" },
  "evidenceMode": "full",
  "official": {
    "design": 7.1,
    "usability": 6.4,
    "creativity": 6.6,
    "content": 6.2,
    "weighted": 6.7
  },
  "developer": {
    "wpo": 5.8,
    "rwd": 6.5,
    "seo": 6.9,
    "markup": 6.4,
    "animations": 7.2,
    "a11y": 5.6,
    "weighted": 6.44
  },
  "extended": {
    "architect": null,
    "a11ySpecialist": 5.4,
    "perfEngineer": 5.9,
    "productStrategist": 6.8
  },
  "perJuror": [
    {
      "juror": "art-director",
      "score": 7.1,
      "reaction": "A confident editorial system — the 1.25-ratio type scale and generous 96px section rhythm read as deliberate, which already puts it ahead of most studio sites.",
      "strengths": [
        "Type pairing (GT Sectra display over Inter text) is disciplined: two families, three weights, scale ratio held across all five pages",
        "The case-study grid keeps a true 12-column alignment — image edges, captions, and pull-quotes all sit on the same verticals"
      ],
      "criticisms": [
        {
          "what": "Hero H1 sits at ~2.9:1 contrast over the looping reel",
          "where": "Homepage, first viewport (white 64px/600 text over bright footage frames)",
          "why": "The strongest design statement on the site is illegible for seconds at a time — jurors screenshot heroes",
          "fix": "Add a 32% black gradient scrim behind the headline block, or lock the reel's first 2s to its darkest grade",
          "estGain": "Design +0.3"
        },
        {
          "what": "Corner radii drift between 8px, 10px, and 12px on cards and inputs",
          "where": "/work cards (12px), contact form fields (8px), footer newsletter input (10px)",
          "why": "Three radii with no role logic reads as accumulation, not a system",
          "fix": "Pick two tokens (e.g. 8px controls, 12px surfaces) and apply them everywhere",
          "estGain": "Design +0.1"
        }
      ]
    },
    {
      "juror": "ux-lead",
      "score": 6.4,
      "reaction": "The core flow — see work, open a case, contact — is smooth on desktop; mobile is where a first-time visitor starts paying for the aesthetics.",
      "strengths": [
        "Current-section indicator in the fixed nav updates on scroll, so orientation never drops on the long case-study pages",
        "Contact form validates inline per field with helpful messages, not a scolding summary on submit"
      ],
      "criticisms": [
        {
          "what": "Primary nav at 390px hides behind an unlabeled 24px morphing-dot icon",
          "where": "Mobile header, all pages",
          "why": "Mystery-meat navigation: first-time visitors must gamble a tap to find out the site has more pages",
          "fix": "Use a recognizable menu glyph or the word 'Menu', and grow the target to 44px",
          "estGain": "Usability +0.4"
        },
        {
          "what": "Case-study horizontal gallery hijacks vertical scroll for ~1200px",
          "where": "/work/atlas, gallery section",
          "why": "Scroll-jacking with no exit cue strands users mid-page; two test scrolls got visibly stuck",
          "fix": "Keep native scroll and translate the gallery on scroll progress instead, or add a visible skip affordance",
          "estGain": "Usability +0.3"
        },
        {
          "what": "Filter chips on /work give no feedback while results load",
          "where": "/work, category filter",
          "why": "A 600–900ms unacknowledged wait reads as a broken control, so users re-tap and double-fire the filter",
          "fix": "Set the chip to its active state immediately and skeleton the grid during the fetch",
          "estGain": "Usability +0.2"
        }
      ]
    },
    {
      "juror": "creative-director",
      "score": 6.6,
      "reaction": "There is a real idea here — 'light as a material', carried by the reveal animations and the duotone treatment — but it stays decorative; the case studies themselves are told like everyone else's.",
      "strengths": [
        "The cursor-following light-bloom on dark sections is a genuine signature interaction, consistent across pages",
        "Duotone photo treatment unifies wildly different client work into one visual voice"
      ],
      "criticisms": [
        {
          "what": "Case studies follow the default challenge/solution/result template with no narrative tension",
          "where": "All four /work entries",
          "why": "The concept lives in the chrome but not the content — tasteful safety caps creativity at the genre median",
          "fix": "Restructure one flagship case as a story the light concept tells: open on the problem in darkness, reveal the work in stages",
          "estGain": "Creativity +0.4"
        },
        {
          "what": "Footer and logo wall are unmodified genre furniture",
          "where": "Homepage sections 5–6",
          "why": "The two most-templated patterns on the page dilute an otherwise owned visual language",
          "fix": "Apply the duotone/bloom treatment to client logos on hover, and let the footer participate in the light concept",
          "estGain": "Creativity +0.2"
        }
      ]
    },
    {
      "juror": "content-strategist",
      "score": 6.2,
      "reaction": "Clean and typo-free, but the words are doing less work than the design — the headline could run on any studio site in this category.",
      "strengths": [
        "Microcopy is written, not defaulted: the 404 ('This page is still in the dark') extends the concept",
        "Case-study subheads carry meaning alone — you can scan /work/atlas and reconstruct the project"
      ],
      "criticisms": [
        {
          "what": "Hero headline 'We craft digital experiences' is category-generic",
          "where": "Homepage H1",
          "why": "The single most-read sentence on the site is interchangeable with a thousand competitors",
          "fix": "Lead with the studio's actual angle — the light/material concept the design already commits to, e.g. 'Interfaces that behave like light'",
          "estGain": "Content +0.4"
        },
        {
          "what": "'Trusted by leading brands' claim with six anonymous logos and no outcomes",
          "where": "Homepage, logo wall intro",
          "why": "Unsubstantiated superlatives read as filler; the case studies have real numbers that never surface here",
          "fix": "Replace with one specific, attributed result pulled from the Atlas case ('+38% activation for Atlas in 6 weeks')",
          "estGain": "Content +0.2"
        }
      ]
    },
    {
      "juror": "creative-developer",
      "score": 6.4,
      "reaction": "3.1 MB transferred, 54 requests, two console warnings — a professional build carrying avoidable weight, with animation work that genuinely earns its frame budget.",
      "strengths": [
        "Scroll-driven animations hold 60fps on a 6x-throttled CPU; transforms and opacity only, no layout thrash",
        "Semantic sectioning is real: nav/main/section/footer landmarks, one H1 per page, heading order never skips"
      ],
      "criticisms": [
        {
          "what": "Hero reel ships as a 1.8 MB MP4, autoplaying, not lazy or poster-gated",
          "where": "Homepage, first network waterfall",
          "why": "It is the LCP element and over half the page weight; WPO is the lowest-scoring dev category because of it",
          "fix": "Serve an AV1/H.265 source set capped ~700 KB, add poster + preload='none' below the fold variants",
          "estGain": "WPO +0.8"
        },
        {
          "what": "Open Graph image and Twitter card metadata missing site-wide",
          "where": "view-source, <head> of all pages",
          "why": "Every share renders as a bare link — markup/metadata loses easy points",
          "fix": "Add og:image (1200x630 from the duotone system), og:description, and twitter:card per page",
          "estGain": "Markup +0.3"
        },
        {
          "what": "prefers-reduced-motion is not honored anywhere",
          "where": "Global — bloom, reveals, and the scroll gallery all run regardless",
          "why": "An official animations line item and an a11y failure in one",
          "fix": "Gate non-essential motion behind a matchMedia('(prefers-reduced-motion: reduce)') check with static fallbacks",
          "estGain": "Animations +0.3"
        }
      ]
    },
    {
      "juror": "accessibility-specialist",
      "score": 5.4,
      "reaction": "Routine exclusions throughout: a keyboard user can browse the work but cannot reliably operate the menu, and a screen-reader user hears 'button' four times in the header.",
      "strengths": [
        "Body text contrast is excellent (13.2:1) and font sizes never drop below 16px",
        "Form fields use real <label> elements with error text in the DOM, not placeholder-as-label"
      ],
      "criticisms": [
        {
          "what": "All four icon-only header buttons lack accessible names",
          "where": "Header: menu, theme, sound, contact icons",
          "why": "A screen-reader user hears 'button, button, button, button' — the primary nav is unusable without sight",
          "fix": "Add aria-label to each ('Open menu', 'Toggle theme', 'Mute sound', 'Contact us')",
          "estGain": "A11y +0.6"
        },
        {
          "what": "Focus is suppressed (outline: none) with no replacement style",
          "where": "Global stylesheet, all interactive elements",
          "why": "Keyboard users navigate blind; this alone is a WCAG 2.4.7 failure",
          "fix": "Design a focus state in the light language — 2px bloom-colored outline with 2px offset — and apply via :focus-visible",
          "estGain": "A11y +0.5"
        },
        {
          "what": "Mobile menu is a focus trap with no Escape handling",
          "where": "390px viewport, opened nav overlay",
          "why": "A keyboard user who opens the menu cannot close it — tab cycles inside, Escape does nothing",
          "fix": "Trap focus intentionally while open, return it to the trigger on close, and bind Escape",
          "estGain": "Usability +0.2"
        }
      ]
    },
    {
      "juror": "performance-engineer",
      "score": 5.9,
      "reaction": "Lab estimate: LCP ~4.1s on a mid-range phone over 4G, almost entirely the hero reel; the runtime is healthy — this is a delivery problem, not an engineering one.",
      "strengths": [
        "JS is code-split per route; initial bundle is a reasonable 210 KB gzipped",
        "Fonts are subset and loaded with font-display: swap — no invisible-text period"
      ],
      "criticisms": [
        {
          "what": "LCP asset (hero reel) is neither preloaded nor size-capped",
          "where": "Homepage waterfall, request 7 of 54",
          "why": "4.1s estimated LCP vs the 2.5s budget; a $200 phone on hotel wifi waits ~9s",
          "fix": "Poster image as LCP (preloaded AVIF ~60 KB), reel lazy-swapped after first paint",
          "estGain": "WPO +0.7"
        },
        {
          "what": "Case-study images ship as 2400px JPEGs regardless of viewport",
          "where": "/work/* galleries, ~180 KB each, 14 per page",
          "why": "~2.5 MB of avoidable transfer per case study on mobile",
          "fix": "srcset with AVIF/WebP at 480/960/1440/2400 and sizes matched to the grid",
          "estGain": "WPO +0.4"
        }
      ]
    },
    {
      "juror": "product-strategist",
      "score": 6.8,
      "reaction": "Strong fit: the aesthetic register matches the design-led clients this studio wants, and the work proves the claim — but the money path leans on a single 'Get in touch' at the page bottom.",
      "strengths": [
        "Five-second test passes: studio, services, and caliber are unambiguous from the first viewport plus one scroll",
        "Case studies cite specific, attributable outcomes — rare and persuasive social proof"
      ],
      "criticisms": [
        {
          "what": "Single conversion point, placed only in the footer",
          "where": "All pages — no contact CTA after case-study payoffs",
          "why": "The moment of maximum conviction (end of a case study) has no next step; interested buyers must scroll-hunt",
          "fix": "Add a contextual CTA block after each case study ('Have a project like Atlas? Talk to us') and a persistent compact contact link in the nav",
          "estGain": null
        },
        {
          "what": "No pricing, engagement model, or process signal anywhere",
          "where": "Site-wide; the about page covers people but not how engagements work",
          "why": "Qualified-but-cautious buyers bounce to competitors who set expectations",
          "fix": "Add a short 'How we work' section: engagement types, typical timeline, starting range",
          "estGain": null
        }
      ]
    }
  ],
  "priorityFixes": [
    { "priority": "P0", "fix": "Replace the 1.8 MB autoplay hero MP4 with a preloaded poster + lazy AV1 reel capped ~700 KB", "juror": "performance-engineer", "estGain": "WPO +0.7" },
    { "priority": "P0", "fix": "Add aria-labels to the four icon-only header buttons", "juror": "accessibility-specialist", "estGain": "A11y +0.6" },
    { "priority": "P0", "fix": "Restore visible focus via :focus-visible with a designed 2px bloom outline", "juror": "accessibility-specialist", "estGain": "A11y +0.5" },
    { "priority": "P1", "fix": "Label the mobile menu trigger and grow it to a 44px target", "juror": "ux-lead", "estGain": "Usability +0.4" },
    { "priority": "P1", "fix": "Rewrite the hero H1 around the light/material concept instead of 'We craft digital experiences'", "juror": "content-strategist", "estGain": "Content +0.4" },
    { "priority": "P1", "fix": "Add a black gradient scrim behind the hero headline to fix the ~2.9:1 contrast", "juror": "art-director", "estGain": "Design +0.3" },
    { "priority": "P1", "fix": "Serve case-study images via srcset with AVIF/WebP variants", "juror": "performance-engineer", "estGain": "WPO +0.4" },
    { "priority": "P2", "fix": "Honor prefers-reduced-motion across bloom, reveals, and the scroll gallery", "juror": "creative-developer", "estGain": "Animations +0.3" },
    { "priority": "P2", "fix": "Replace scroll-jacked gallery with scroll-progress translation or a visible skip", "juror": "ux-lead", "estGain": "Usability +0.3" },
    { "priority": "P2", "fix": "Add per-page Open Graph and Twitter card metadata", "juror": "creative-developer", "estGain": "Markup +0.3" }
  ],
  "verdict": "honorable-mention",
  "confidence": 0.97,
  "notAssessed": ["extended.architect"]
}
```
