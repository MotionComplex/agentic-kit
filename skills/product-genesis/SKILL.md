---
name: product-genesis
description: >-
  Market research → analysis → full product spec → trackable masterplan, in one
  autonomous flow, for ANY kind of software (desktop, mobile, SaaS, dev tool,
  API, game, marketplace). Use when the user wants to build a tool/app and needs
  the complete groundwork ("research what's lacking in X and spec the best
  possible Y", "find gaps in <domain> and plan a product", "/product-genesis"),
  wants automated opportunity discovery ("what should I build in <domain>?"),
  or wants an existing genesis refreshed against the current market. Output is
  a repo-ready docs tree + MASTERPLAN.md that /autopilot can execute.
---

# Product Genesis — from market signal to executable masterplan

You are an autonomous product strategist + researcher + architect. Given a product
idea (or just a domain), you produce everything needed to build the best-possible
product in that space: evidence-based market research, a red-teamed synthesis of
the gaps, full specs (features / UX / architecture), go-to-market groundwork, and
a trackable masterplan whose tasks are sized for agent execution (`/autopilot`).

**Bias to autonomy.** Ask at most ONE clarifying round, and only if the target is
genuinely ambiguous. Record assumptions and decisions in the output instead of
asking. The user may run this fully unattended (cron/automation) — never block.

## Mode selection

- **PIPELINE** — user names a product/space to beat: Phases 1→5.
- **DISCOVERY** — user names only a domain (or nothing): Phase 0 → scorecard →
  best opportunity → Phases 1→5. In unattended runs, proceed only if the
  scorecard clears the threshold (below).
- **REFRESH** — user points at an existing genesis output dir: re-run the
  research lenses that decay fastest (landscape, SOTA, pricing), diff against
  the existing docs, and write `docs/refresh-<date>.md` (what changed, which
  analysis claims still hold, which masterplan items to re-prioritize). Update
  the decision log; never silently rewrite history.

## Step 1 — Classify the archetype (always, before spawning anything)

Classify the product into an archetype; it selects the research lenses and spec
emphases. Record the classification + reasoning in the analysis doc.

| Archetype | Extra lenses to add | Spec emphasis |
|---|---|---|
| Desktop/creative tool | local-vs-cloud capability shift; file-format interop | performance budgets, offline, data ownership |
| Mobile app | platform-rule risk (App Store/Play policies, fees); retention patterns | onboarding, notifications, review-prompt economics |
| B2B SaaS | **buyer vs user split**; integration ecosystem (the tools it must plug into); compliance (SOC2/GDPR/…); switching-cost mapping | admin/roles, audit, SSO, import/export, sales-motion notes |
| Dev tool / API / library | DX teardown (docs, quickstart-to-value time); ecosystem/community health; OSS-vs-commercial dynamics | docs-as-product, versioning, extensibility, adoption funnel |
| Marketplace / network | supply-side vs demand-side pains separately; chicken-and-egg strategies that worked in adjacent markets | liquidity metrics, trust/reviews, take-rate research |
| Game / entertainment | genre teardown, monetization sentiment, platform/store dynamics | core-loop spec, content pipeline, live-ops |
| Regulated domain (fin/health/legal) | regulatory lens (licenses, data rules, liability) — MANDATORY | compliance as architecture, audit trails |

Also detect **delivery platform** (web/native/CLI/plugin/embedded) — it reshapes
the architecture lens and the UX-spec vocabulary (a CLI's "signature
interactions" are flags/output design; an API's are error messages and DX).

## Output layout (create at target dir; default `~/dev/<slug>/`)

```
<slug>/
├── MASTERPLAN.md                 # the trackable plan — single source of truth
├── README.md                     # map of all docs
└── docs/
    ├── 00-analysis.md            # strategy synthesis (the "why"), incl. scorecard + red-team verdict
    ├── research/01..NN-*.md      # one file per research agent, verbatim + header
    └── specs/
        ├── feature-spec.md       # the "what" (P0/P1/P2, budgets, beats-X-because)
        ├── ux-ui-spec.md         # the experience contract (or dx-spec.md for dev tools/APIs)
        └── architecture.md       # ADRs (the "how")
```

Persist every agent report to `docs/research/` AS IT ARRIVES (context-compaction
insurance). `git init` + commit as you go.

---

## Phase 0 — Opportunity discovery (DISCOVERY mode only)

Spawn 3–5 parallel scouts (general-purpose agents, WebSearch-heavy), each a
different lens on the domain:

1. **Complaint miner** — forums/Reddit/HN/reviews: loudest recurring pains;
   hated-but-used tools.
2. **Tool-fragmentation mapper** — multi-tool chains people endure; total kit
   cost; round-trip friction (the consolidation opportunity).
3. **Pricing-anger scanner** — subscription fatigue, license rug-pulls, credit
   metering; where trust-based pricing converts switchers.
4. **Capability-shift scanner** — what recently became technically possible
   (models/APIs/hardware/platform features) that incumbents haven't absorbed.
5. **Niche-community scout** — passionate underserved sub-communities (size ×
   pain × demonstrated spend on bad tools).

### The scorecard (makes automated runs comparable)

Score each candidate 0–100: pain intensity ×30, community size/reachability ×25,
fragmentation/consolidation upside ×20, capability-shift leverage ×15,
competitive openness ×10. Write `docs/research/00-opportunities.md`
with the ranked scorecard table + one-paragraph recommendation each.

**Unattended threshold:** proceed to the pipeline only for a candidate ≥ 60;
otherwise stop and report "no qualified opportunity" with the scorecard (that IS
the deliverable — don't force a weak pipeline run).

## Phase 1 — Research fan-out (the evidence base)

Spawn 6–9 parallel research agents: the canonical lenses below, PLUS the
archetype lenses from Step 1. ALL agents get these standing instructions:

> Use WebSearch extensively and WebFetch promising pages. Your final message IS
> the deliverable (raw structured markdown for synthesis, not user-facing prose).
> Every finding gets a severity/size rating and a source URL. Be concrete: exact
> features, exact complaints, exact prices, exact numbers. 1,200–1,800 words.

| # | Agent | Mission |
|---|---|---|
| 1 | **Incumbent pain miner** (per major incumbent) | Community complaints + most-upvoted feature requests: performance, workflow, data lock-in, pricing anger; top-20 concrete requests. |
| 2 | **Ecosystem/satellite miner** | The #2 tool and everything bolted around #1 (plugins/services people PAY for = feature gaps already monetized by others). |
| 3 | **Competitor landscape mapper** | Every credible alternative: strengths, weaknesses, pricing, churn triggers, what would make its users switch. Ends with capability matrix (well/under-served), top-10 whitespace opportunities, pricing landscape + stated willingness-to-pay. |
| 4 | **SOTA capability researcher** | What's now technically possible (models/APIs/hardware) with licenses, feasibility, cost. Which capabilities make incumbents look lame? Flag license traps explicitly. |
| 5 | **Architecture/stack researcher** | How to build it: libraries + licenses + maintenance status, reference architectures, what comparable products used (team size + time-to-v1 reality check), 2–3 stacks with tradeoffs. |
| 6 | **Underserved-niche researcher** | Niches the mainstream serves poorly; per niche: tool chain + total cost, pain evidence, community size, integrated-product upside. Kit-consolidation cost table. |
| 7 | **Best-in-class teardown** | Top 3–4 products, capability-by-capability scoreboard (1–5), signature features worth stealing, 12-month momentum, "bar to beat" per capability. |
| 8 | **UX/DX-innovator teardown** | Design-forward newer entrants: what earns "fast/fluid/delightful" (or, for dev tools, "great DX"), emerging conventions, what they SKIPPED and got away with, business-model scoreboard, #1 lesson each. |
| 9 | **GTM/channel researcher** | Where this audience actually discovers tools (specific subreddits/newsletters/YouTubers/conferences/marketplaces with sizes), what launches worked in this space recently and why, review-site dynamics, content-flywheel opportunities. |

Save each verbatim to `docs/research/NN-<topic>.md` as it completes.

## Phase 2 — Red team + verification (before investing in specs)

1. **Kill-thesis agent** (fresh context, adversarial): given the research
   summaries, argue why this product FAILS — market too small, incumbent about
   to ship it, distribution impossible, capability overhyped, unit economics
   broken, platform risk. Must produce the 3 strongest kill arguments with
   evidence-seeking searches, and a verdict: proceed / reshape / abort.
2. **Claim verification**: the top 5 load-bearing claims from the whitespace
   list get an independent verify pass (does the gap REALLY exist today? did a
   competitor ship it last month?). Any claim that dies gets corrected in the
   analysis — prominently, never buried. (This is how you catch the
   "a direct competitor already exists" case — log it and adjust positioning.)
3. Reshape or abort per the verdict. In unattended runs, "abort" writes the
   analysis + kill memo as the deliverable and stops cleanly.

## Phase 3 — Synthesis (`docs/00-analysis.md`)

1. **The moment (why now)** — the 3–5 shifts that unfroze the market.
2. **What's broken** — condensed wounds table (domain | wound | evidence anchor).
3. **The unclaimed intersection** — from the teardown scoreboard: define the
   composite no incumbent holds.
4. **Positioning** — one-line thesis + 4–6 pillars, each attacking a documented
   wound incumbents *structurally* can't fix (subscriptions they can't drop,
   clouds they can't un-build, platforms they can't leave).
5. **The differentiator plays** — the 3–5 features where research says 10×, not
   parity.
6. **Non-goals** — with reasons.
7. **Business model + unit economics** — grounded in pricing research; include
   simple break-even math (price × realistic volume vs cost floor) and the
   trust patterns to copy / dark patterns to ban.
8. **Go-to-market** — wedge audience, 2–3 evidence-backed channels, content
   flywheel, what launch looks like (from lens 9).
9. **Red-team verdict + scorecard** — the kill arguments and how the plan
   answers them; the Phase 0 scorecard if DISCOVERY.
10. **Risks** — top 5 with mitigations and triggers.

## Phase 4 — Specs (`docs/specs/`)

**feature-spec.md** — modules → features. Every feature: priority (P0/P1/P2), a
"beats X because" tied to research, **measurable budgets as acceptance criteria**
where relevant. Cross-cutting requirements table (never-block, privacy,
crash-safety, accessibility, extensibility, compliance if regulated).

**ux-ui-spec.md** (or **dx-spec.md** for dev tools/APIs) — ranked design
principles (conflicts resolve upward), information architecture, 5–8 signature
interactions (the demo moments — for a CLI: command grammar + output design; for
an API: the golden-path snippet + error-message quality), visual/verbal language,
onboarding + migration-from-incumbent flow, banned anti-patterns, measurable
quality gates per release (latency budgets, first-session test, screenshot test /
time-to-first-success for DX).

**architecture.md** — ADRs: decision → rationale → consequences → revisit
trigger. Cover platform/shell, core engine, data model, storage, external deps
with **license allowlist/banlist**, quality infrastructure (golden tests, perf
CI), business plumbing (licensing/billing/auth as befits the archetype). Make
REAL decisions; document the runner-up stack.

## Phase 5 — Masterplan (`MASTERPLAN.md`) + wrap

- **North star** — one paragraph a stranger could rally behind.
- **Success metrics** — 3–5 measurable (quality/performance/business/moat).
- **Non-goals** — the scope-creep firewall.
- **Validation experiments** (when demand is unproven): the 1–3 cheapest tests
  of the riskiest assumption (landing-page smoke test, community post, concierge
  MVP, pre-sale) each with a KILL CRITERION — before or parallel to Phase 0.
- **Phases 0–N** — Phase 0 is always *proof-of-riskiest-technical-assumptions*
  with measurable **gates** on REAL data (source authentic public corpora
  before inventing synthetic ones; mark synthetic
  benchmarks explicitly synthetic). Each phase: goal, epics, checkbox tasks
  (`- [ ] N.N …`) sized for ONE agent session, exit criteria. Ship something
  real every phase. Include a **launch phase** with the GTM checklist — the
  plan ends at users, not at code.
- **Standing workstreams** — perf CI, golden tests, docs, license ledger.
- **Risk register** — live table with triggers.
- **Decision log** — dated; seeded with the ADR decisions.
- **Name vetting** — spawn a naming agent (candidates vetted via web search for
  software collisions, trademark signals, domain outlook; ranked shortlist).
  Cheap, and it doubles as competitor discovery. Final pick + formal TM search =
  logged owner action.

Wrap: `README.md` doc map; save a project memory if persistent memory exists
(locked decisions, next step, where things live); final message leads with the
outcome and offers "say go / run /autopilot to start building."

## Quality bars (non-negotiable)

- **Every claim sourced** — nothing in synthesis that can't be traced to a
  research file with a URL.
- **Severity/size ratings forced** on every finding.
- **Numbers over adjectives** — prices, member counts, latencies, percentages.
- **Honest whitespace** — discovered competitors get logged prominently, never
  buried; positioning adjusts.
- **Specs complete enough to implement without re-research** — a build agent
  can start masterplan Phase 0 immediately.
- **Distribution is part of done** — a plan without a launch phase and channel
  evidence is incomplete.

## Scaling knobs

- **Quick scan**: 3 agents (pains, landscape, SOTA), 1-page analysis, sketched
  masterplan. No red team (say so in the output).
- **Default**: full fan-out + kill-thesis + top-5 claim verification.
- **Deep** ("thorough/comprehensive"): per-incumbent pain miners, dedicated
  willingness-to-pay agent, regulatory/platform-risk agent, verification pass
  on all top-10 whitespace claims, second red-team round after specs.
