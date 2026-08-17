# Autopilot — FlowLever fix run

**Goal:** Fix every finding in `REVIEW.md` (48: 7 blocker · 17 major · 13 minor · 11 nit), each
verified by an independent reviewer in a fresh context, re-fixed until clean.
**Branch:** `fix/flowlever-review-findings` off `main` (final merge/PR is the owner's).
**Baseline:** review was done at `207f569`; HEAD `c368ffa` differs only by a comment in ledger.js —
all findings verified as still live.

## DoD
- [ ] Every blocker + major fixed, or explicitly deferred with a logged reason.
- [ ] Every minor + nit fixed or deferred with reason.
- [ ] `node --test` green, and MORE tests than the 98 baseline (new tests for cli.js, report.js,
      concurrency, malformed input, HTTP id validation).
- [ ] No mock/noop/stub on the real path; no fix that only makes a test pass.
- [ ] Each unit reviewed by a fresh independent reviewer; blockers re-reviewed after fixing.
- [ ] Units merged into the integration branch; owner report written.

## Scope / non-goals
IN: `plugins/flowlever/**`. OUT: the 5 "missing capabilities" (export, multi-user, CI mode,
cross-platform notifications, auth beyond loopback bind) — product features, not review fixes.
Recorded in DECISIONS-FOR-OWNER.md.

## Units (dependency order)
- [todo] U1 ledger.js — orchestrator implements (interlocking semantics, single file)
  - U1a foundations: C-10 shape validation, C-11 config merge, C-15 score normalization, C-20 addSource
  - U1b durability: C-2 lost updates, C-3 atomic claim, C-7 ingest atomicity, C-19 fsync, C-23 counter
  - U1c integrity: C-4 gate disarm + sha shape, C-5 fingerprint collision, C-6 scoped ingest,
    C-8 decision wipe, C-22 silent skips, C-17 orphaned queue entries, C-16 destructive guard
- [todo] U2 server.js — orchestrator implements: C-1 traversal, G-4 loopback bind, C-12, C-14, F-6, F-5 endpoint
- [todo] U3 cli.js — delegate: F-1, F-2, F-3, C-21, C-16 CLI guards + new cli.test.js
- [todo] U4 report.js — delegate: C-9 + new report.test.js
- [todo] U5 web/app.js — delegate: U-1, U-2, U-3, U-4, U-5, U-8, C-18, C-24, C-25, F-5 client
- [todo] U6 docs+packaging — delegate: G-1, G-2, G-3, G-5, G-6, G-7, G-8, G-9
- [todo] RV independent review of every unit (Opus, fresh context, read-only) + re-review of blockers

## Cycle log
- Cycle 1 start: branch created, baseline confirmed, contract pinned.

## Usage ledger
(appended per unit)
