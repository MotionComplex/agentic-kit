# Autopilot — FlowLever PR triage: categorise, order, and rank the review lists

**Status: COMPLETE on the branch.** All DoD items met except the merge, which is deliberately left
to the owner. Nothing pushed.

**Goal:** The PR lists (and the cross-kind Home inbox) rendered as one flat, undifferentiated run of
cards ordered by outstanding counts. You could not tell at a glance which PRs were waiting on *you*,
which were mid-flight under a runner, and which were parked waiting on their author. Every workspace
now has ONE canonical state, the lists group into four ordered bands — **needs you → in progress →
waiting on others → done (collapsed)** — and information density is tiered so the rows that need a
decision say the most and the parked ones say the least.

**Integration branch:** `feat/flowlever-pr-triage`, in a **separate worktree** at
`/Users/elias.douglas/development/agentic-kit-pr-triage`.
**Baseline:** `7b4c358`. **Tip:** `fdeb201`. 10 commits, +3459/−127 across 9 files.
**Tests:** 281 pass / 0 fail (baseline 219).

**Isolation — why the worktree.** The live cockpit (`http://flowlever.localhost`, pid 51980) serves
`web/` straight off `plugins/flowlever/app/` in the MAIN checkout, so editing those files there would
have changed the running UI mid-flight. It also had real work queued (`req-202`/`req-203` pr-review on
`pr-5865-atrius-poi-id`, `req-204` apply on `pr-5867-atrius-deep-links`, plus errored `req-145`).
Nothing in this run touched the main checkout, `~/.flowlever`, or that queue. Verified at the end:
the main checkout is clean on `main` at `7b4c358`.

**Scratch data.** Every browser check ran against a throwaway copy of `~/.flowlever`
(`<scratchpad>/fl-data-triage`, 56 real workspaces) served by second cockpits on ports 4399–4417 from
the worktree. Workers were forbidden from pressing Post / Apply / Run / Refresh / Delete, because a
runner talks to real Azure DevOps regardless of which data dir is configured. Synthetic states were
produced with Playwright route interception, never by writing. Reviewers reported
`writesAttempted: []` — the app never even tried.

## DoD
- [x] U1 — one canonical `state` per workspace, computed server-side, covered by real unit tests
- [x] U2 — PR sections render four ordered bands with tiered density; Done stays collapsed
- [x] U3 — Home inbox groups on the same table (one truth, not a second taxonomy)
- [x] U4 — cross-surface verification in a real browser + docs current (SCHEMA, README)
- [x] `node --test` green; every new behaviour covered
- [x] Every unit reviewed by a fresh independent reviewer; every blocker re-reviewed before closing
- [ ] **Merge to `main` — left for the owner.** Merging lands the change in the checkout the live
      cockpit serves, and its queue was live throughout. See `DECISIONS-FOR-OWNER.md`.
- [x] Owner report written

## The taxonomy (the contract everything else implements)

Band order answers "who is this blocked on": me → a runner → someone else → nobody.

| Band | State | Means | Density |
|---|---|---|---|
| **1 · Needs you** | `job-attention` | a job errored, stalled, or is blocked on you | full |
| | `ready-to-post` | every finding decided, nothing posted yet — one click from done | full |
| | `needs-review` | undecided findings, nothing ever posted → a new PR to check | full |
| | `needs-rereview` | undecided findings and we have posted before | full |
| | `author-responded` | all out, author replied or the PR moved since our round | full |
| **2 · In progress** | `job-posting` | a runner is posting the review / applying to the spec | compact |
| | `job-rereviewing` | a runner is re-reviewing (re-auditing, on a spec) | compact |
| | `job-reviewing` | a runner is doing the first review | compact |
| | `job-polling` | a discovery/refresh pass | compact |
| | `posting` | findings marked in-flight with no live job bound | compact |
| **3 · Waiting** | `awaiting-author` | comments posted, nothing back yet | compact |
| | `awaiting-reaudit` | spec: changes applied, waiting on a re-audit | compact |
| | `settled` | nothing open, nothing out, not marked done | compact |
| **4 · Done** | `done` | completed — collapsed disclosure, existing date sort kept | minimal |

`job-*` states come from the live requests queue and OUTRANK the workspace's own state: what a runner
is doing right now is the truer answer to "what is happening to this PR".

## Units

- [merged] **U1 — canonical workspace state (server).** `5dfe66a` + fix `101212b`.
  `ledger.workspaceState()` + `decisionOf()` + `WORKSPACE_STATES`, served on `/api/home` and
  `/api/features` (which also gained `counts`), API version 3→4, SCHEMA.md updated.
  Reviewer: Approve-with-nits, after independently reimplementing the rules and diffing them against
  the live API across all 56 workspaces — 0 mismatches. Its one real finding was fixed: a workspace
  whose only live findings carried neither a draft nor a suggestion fell through to `settled`, i.e.
  into "Waiting on others" at minimum density, while its own `counts.open` said otherwise. Work
  silently hidden is the exact failure this change exists to prevent.

- [merged] **U2 — banded PR sections (client + CSS).** `7740291` + fix `3d008a8`.
  Reviewer: Request-changes. Both defects the orchestrator spotted by eye were confirmed, plus three
  more: a second live job on a PR that already had a workspace drew a phantom duplicate card (PR
  #5865 twice, under a header claiming 4 over 3 workspaces); the "Needs you" cards named no state, so
  four states demanding four different actions rendered pixel-identically — the band that should say
  the most said the least; the category was recomputed inside the card, so a job crossing the stale
  threshold mid-render could be banded under one header and labelled as another; the band→density map
  was written a second time in CSS; placeholders ignored their band's density.
  The fixer rejected the reviewer's suggested one-liner (`&& !r.wsId`) because it would have hidden a
  running review whose workspace had been deleted, and tested for existence instead — the right call,
  later proved by a verifier who patched the suggestion in and watched a live review vanish.

- [merged] **U2b — one rule for "this job belongs to this workspace".** `80c4f76`.
  The U2 fix was half a rule: it disqualified a placeholder only when the job carried a `wsId`, while
  `jobForFeature` binds by `wsId` **or** `prId`. A `wsId`-less job with a matching `prId` still drew
  the duplicate — and that is the shape the "+ New PR review" dialog enqueues, so it was reachable
  from the UI. Fixed structurally: `jobBindsTo()` now holds the whole rule and both call sites ask it.
  Verification: `jobForFeature` proved bit-for-bit identical across 13,035 replayed input
  combinations; the duplicate reproduced on the parent and gone here; both previously-rejected shapes
  still render their placeholders; the guards caught all five claimed mutations plus three evasions
  the fixer had not considered.

- [merged] **U3 — banded Home inbox (client + CSS).** `ce22adf`.
  The band loop was factored out of `sectionGrid` into a shared `bandSections()` both views call, Home
  binds live jobs onto rows for the first time, and the requests strip stops repeating a job already
  shown on a row. Reviewer: Request-changes, two blockers — see U4a.

- [merged] **U4a — the two U3 blockers.** `316edb0`.
  A PR job was binding every workspace whose id merely contained that number, across kinds, so a
  **spec** workspace could be banded "In progress" by someone else's PR review. And the 4-second poll
  was calling `replaceChildren` on the whole inbox every tick, which reverted an open **delete**
  confirm within 4s and dropped focus to `<body>` — a regression U3 introduced, on a destructive
  control. Fixed with a kind gate in `jobBindsTo`, and a signature short-circuit plus hold-and-release.
  Verification: both demonstrably broken at the parent and working here. The verifier hunted eight
  release paths for a held repaint that never lands and could not produce one — every release paints
  the NEWEST state, not a stale replay.

- [merged] **U4b — the eight loose ends.** `7eedee4`.
  Exact-kind binding; pruning the row caches on delete (a deleted workspace came back); routing the
  section poll through `jobBindsTo`; suppressing the `draft` chip when it is the default; "1 workspace
  **needs** you"; band headers given an accessible name including their count; the 8px compact gap
  made deliberate; README + SCHEMA.

- [merged] **U4c — the four the U4a verification left open.** `4406176`.
  `renderHome()` was still repainting the whole view outside the guard, so the confirm-destroyed
  symptom survived on a narrower path; the hold had no ceiling, so focus resting in the list froze it
  indefinitely while the strip and toolbar kept updating and contradicted it; relative ages stopped
  advancing; and `#/spec` never folded jobs onto its cards, so one workspace read "In progress" on
  Home and "Ready to post" on `#/spec`. Turning the spec poll on would have handed that section the
  repaint blocker brand new, so the section grid went behind the same machinery — which closed that
  hole for the PR sections too.

- [merged] **U5 — the final review's findings.** `fdeb201`.
  Final review: Approve-with-nits; it could not lose a repaint across 11 scenario suites, including
  one where `/api/home` returned 500 mid-reload. Fixed: an inline delete-confirm had **no dismissal
  path** (Escape and outside-click did nothing), so the deliberately-uncapped confirm hold could
  freeze the list forever; a reload blanked every live job binding for a full tick (measured 4.2s
  where a running job vanished from its row); spec jobs wore PR vocabulary ("Re-reviewing",
  "Posting to PR") on a workspace with no PR; a brand-new spec audit was invisible on `#/spec`
  entirely; the grid repainted every ~12s when nothing had changed; plus the strip/note contradiction
  and ~90px of dead space.
  **And two of the new tests were named as theatre** — the prune guard and the focus-restore guard
  both survived mutations that genuinely broke what they were named for. Both were rewritten to lift
  the function out of `web/app.js` and RUN it; five more guards "weaker than their names" were
  strengthened the same way.

## Usage ledger
| Unit | Builders | Reviewers | Fixers |
|---|---|---|---|
| U1 | 1 (opus) | 1 (opus) | 1 (opus) |
| U2 | 1 (opus) | 1 + 1 scoped (opus) | 1 (opus) |
| U2b | — | 1 scoped (opus) | 1 (opus) |
| U3 | 1 (opus) | 1 (opus) | — |
| U4a | — | 1 scoped (opus) | 1 (opus) |
| U4b | 1 (opus) | — | — |
| U4c | — | 1 final (opus, covering U4b+U4c) | 1 (opus) |
| U5 | — | — | 1 (opus) |

14 agents, all Opus per the owner's instruction. The most expensive were U4c and U5 — both were
consequences of the repaint-hold machinery, which no unit set out to build and which exists only
because U3's job-binding turned a 4-second poll into a destroyer of in-flight interactions.

## Backlog (discovered — NOT in this run's DoD)

- **`decisionOf` hunk-id skew.** The core derives a draft's hunks from the recorded
  `draft.review.hunks` keys; the browser recomputes them from the draft text with an LCS diff. A
  partially-accepted multi-hunk draft reads "decided" to one and "undecided" to the other. Bounded:
  both outcomes sit in the **same** `needs-you` band, so it changes a label and a rank, never a band,
  and it over-surfaces rather than hides. 0 occurrences in the real corpus (44 drafts, 43 single-hunk).
  Closing it means one shared diff engine, which this zero-dependency app has no seam for.
- **`counts.toReview` under-reports PR workspaces.** It counts only findings carrying a `draft`, but a
  PR-review finding usually carries only a `suggestion` — which is why the inbox says "3 open" where
  it means "3 to review". `isReviewable()` now expresses the right rule; the counts loop predates it.
  Not changed here because the server's inbox sort reads those counts.
- **Browser code is pinned only by source assertions.** `node --test` cannot import `web/app.js`. Such
  a test can catch a *missing* guard but never one that is *present and wrong* — which is exactly how
  the placeholder predicate shipped with the wrong key, and how two guards shipped as theatre. Two
  partial answers are now in use: make call sites share one predicate so they cannot disagree, and
  lift pure functions out and run them. Neither covers DOM behaviour; a DOM harness would.
- **"+ New PR review" does not dedupe.** It enqueues `{action, prId, title, instructions}` with no
  `wsId` and without the opt-in `dedupe` flag, so typing a PR number that already has a workspace
  queues a second job against it. The duplicate CARD is fixed; the duplicate JOB is not.
- **The requests strip labels an `apply` "Post to PR" regardless of kind.** Requests carry `wsId`, not
  `kind`, so the strip cannot resolve the workspace's vocabulary without a lookup. The cards and rows
  are now kind-correct; the strip is not.
- **A text selection is held but never restored.** The busy hold protects it during the window, but
  the ceiling destroys it and nothing puts it back. Documented in the code rather than fixed — an
  honest restore means re-finding anchor+offset across a `replaceChildren`.
- **`renderHome` paints from the previous visit's queue for one round trip** on a first navigation to
  Home, until the immediate poll corrects it. Strictly better than the `[]` it replaced.
- **`prNumber()`'s bare `id.match(/(\d+)/)` fallback** still lets a PR number match a workspace id
  that merely contains it. Now gated by kind at the one site that mattered, but the helper is unfixed.
