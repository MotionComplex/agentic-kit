# Autopilot — FlowLever fix run

**Goal:** Fix every finding in `REVIEW.md` (48: 7 blocker · 17 major · 13 minor · 11 nit), each
verified by an independent reviewer in a fresh context, re-fixed until clean.
**Branch:** `fix/flowlever-review-findings` off `main` (final merge/PR is the owner's).
**Baseline:** review done at `207f569`; HEAD at start `c368ffa` differed only by a comment — all
findings verified still live.

## DoD
- [x] Every blocker + major fixed (pending reviewer confirmation)
- [ ] Every minor + nit fixed or deferred with a logged reason
- [x] `node --test` green and above the 98 baseline — 159+ and climbing
- [ ] No mock/noop/stub on the real path (reviewer to confirm)
- [ ] Each unit reviewed by a fresh independent reviewer; blockers re-reviewed
- [ ] Owner report written

## Units
- [merged] U1 ledger.js — `533d6ab`. C-1/2/3/4/5/6/7/8/10/11/15/17/19/20/22/23 + F-4.
  Verified by real repro: 1920 concurrent enqueues 0 lost, 0 double-claims, traversal refused,
  gate survives status change, garbage sha refused, scoped ingest holds, no round reuse.
  New test/durability.test.js. 98 -> 125 tests.
- [merged] U2 server.js — `b9e6444`. C-1 (HTTP surface), C-8, C-12, C-14, C-22, G-4, F-5, F-6 + scope.
  Verified live with curl: traversal 400 + file survived, socket binds 127.0.0.1 only, HEAD 200,
  /api/config real, GET validation 400.
- [merged] U3 cli.js — `04ea557` (delegated). F-1, F-2, F-3, C-21, C-16 + `--scope-*`, `requests claim`.
  New test/cli.test.js (17 tests). Worker self-reported an incident — see INCIDENT below.
- [merged] U4 report.js — `a8e1e20` (delegated). C-9: split "Open (scored)" vs "On the board" with an
  in-place note wherever they diverge. New test/report.test.js (6 tests).
- [building] U5 web/app.js — delegated. U-1, U-2, U-3, U-4, U-8, C-18, C-24, C-25, F-5 client (+U-5 optional).
- [merged] U6 docs/skills/packaging — `178ad9e`. G-1..G-9. Verified independently: zero `/lever:` left
  in any .md or in app.js; .gitignore present; plugin.json lists all 12 skills; SCHEMA.md documents
  every command I spot-checked plus /api/config and /api/version. app/README.md was reduced to a
  pointer (rather than rewritten) so there is one source of truth — a reasonable call. It also caught
  a stale README claim about the wildcard bind that my server change invalidated.
- [merged] U7 runner.js — `d382b4a` (orchestrator). C-13 both halves: process-group kill proven with a
  forking stub (1 grandchild before stop, 0 after), and a pid-file guard that survives a restart
  (adopted runner blocks a second start with EBUSY; a dead pid is cleaned up, not sticky).
  This settles the disagreement between the two original reviewers — the leak was shell-dependent.
- [in-review] RV1 adversarial Opus review of ledger+server+runner (`533d6ab`, `b9e6444`, `d382b4a`) —
  briefed to falsify 10 specific claims, stress the lock, and audit the 3 changed test assertions.
- [todo] RV2 adversarial review of cli+report+docs+app.js once U5 lands.

## Real-data validation (beyond the test suite)
The owner's live cockpit runs against `~/.flowlever` (40 workspaces, 189 findings), NOT the repo's
`app/data`. Against a COPY of it under the new ledger:
- 40/40 workspaces load and score; gates 37 ready / 2 in-progress / 1 not-ready; 131 requests intact.
- 97 of 189 findings have titles past the old 80-char fingerprint cut, so the migration path is not
  hypothetical — it fires on half the real dataset.
- Replaying the live findings of all 22 workspaces that have any: 63 replayed, 30 fingerprints
  migrated, **0 lost, 0 re-inserted as new, 0 identity/pin/history damage**.

## INCIDENT (owner should know, no action needed)
The cli.js worker ran `demo` / `feature delete` once without `FLOWLEVER_DATA` set, hitting the repo's
`plugins/flowlever/app/data/` dev dir instead of a scratch dir. Verified independently afterwards:
that directory now holds only `config.json` (mtime Jun 16, untouched) plus three empty dirs; the
owner's real data at `~/.flowlever` was never in scope and is intact (confirmed by loading all 40
workspaces and by the live server still serving them). No real data was lost. This is exactly the
failure C-16's guard now prevents, and the guard shipped in the same commit.

## Cycle log
- Cycle 1 (cont.): 6 of 7 build units merged; end-to-end smoke on new code green (demo seed -> server
  -> API -> report; readiness still 53 for the demo, matching the documented pre-change value, so
  scoring did not regress). No references to flowlever outside the plugin, so no cross-plugin risk.
- Cycle 1: ledger + server done by the orchestrator; cli, report, docs, app.js delegated.
  Ledger lock had a real self-inflicted race (missing stamp treated as stale) found by stress test
  and fixed before commit — 1 lost write in 240 became 0 in 1920.

## Usage ledger
- U1/U2: orchestrator (session model), no subagents.
- U3 cli: 1x sonnet builder. U4 report: 1x sonnet builder. U6 docs: 1x sonnet builder.
- U5 app.js: 1x sonnet builder.
- RV: Opus reviewers pending.

## Decisions (default-and-proceed)
- [parallelism] Ran 3 concurrent builders (docs, app.js, + one finishing) rather than the default 2,
  on strictly disjoint file sets, because the owner asked for the whole review cleared in one pass.
  All commits are pathspec-scoped so concurrent workers cannot steal each other's files. OWNER CAN OVERRIDE.
- [bind] Default bind is now 127.0.0.1 with `FLOWLEVER_HOST` as a documented opt-out that warns
  loudly; the runner additionally refuses to start on a non-loopback bind unless
  FLOWLEVER_ALLOW_REMOTE_RUNNER=1. Chosen over adding auth: a bearer token is a product feature, a
  safe default is a bug fix. The hosts-file friendly-hostname setup still works. OWNER CAN OVERRIDE.
- [fingerprint] Hash the full title AND keep a legacy-fp adoption path, rather than accepting fp churn.
  Validated on the owner's real data (above) because half of it needs the migration. OWNER CAN OVERRIDE.
- [config] Added `gates.scoreZeroAtPenalty` (default 40) so scaling severityWeights no longer
  silently redefines readyThreshold. OWNER CAN OVERRIDE.
- [scope] `ingestRound` scope is OPT-IN: unscoped keeps the old full-sweep reconciliation so existing
  callers are unchanged, and partial passes must declare themselves. Skills updated in U6. OWNER CAN OVERRIDE.
- [tests] Two existing assertions were changed because they encoded defects: the 80-char collision
  ("truncation to 80 chars: divergence after char 80 is invisible") and deleteFeature's return shape.
  Every other pre-existing test still passes untouched. OWNER CAN OVERRIDE.

## Out of scope (product features, not review fixes)
The REVIEW.md "top 5 missing capabilities" — ledger export, multi-user/ownership, CI mode,
cross-platform notifications, real auth beyond the loopback bind. Recorded, not built.
