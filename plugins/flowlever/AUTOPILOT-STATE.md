# Autopilot — FlowLever review-cockpit P2 run

**Status: COMPLETE.** All DoD items met. Merged to `main`, nothing pushed.

**Goal:** Finish the P2 tier of this session's UX analysis (bulk approve + Post-button gating,
⌘↵ save in the comment editor, server health-ping), plus the coherence work needed to give the
comment-brevity rule a single home, and land it all on `main`.

**Integration branch:** `feat/flowlever-p2` off `main`, merged back `--no-ff`.
**Baseline:** `9fcfd5b` (P0+P1: markdown rendering, decision-row placement, comment length rule).
**Scratch data:** every browser check ran against throwaway copies of `~/.flowlever`
(`fl-data*`, `fl-data-rv2/3/4`, `fl-data-fix2/3`, `fl-data-u3`, `fl-smoke`). The live ledger was
never driven. Confirmed by mtime audit: the only live writes during this run were the owner's own
scheduled poller at 11:11–11:19.

> The previous autopilot run's record (the REVIEW.md 48-finding fix run) lived in this file and is
> preserved in git at `49dae65`. One truth per file, so this run replaced it.

## DoD
- [x] P2a — "Approve all remaining" on the finish screen; Post label no longer dead-ends at zero
- [x] P2b — ⌘↵ / Ctrl+↵ saves in the comment editor, both branches
- [x] P2c — health-ping surfaces an unreachable *or wedged* cockpit as a banner
- [x] Coherence — the brevity rule has one home, referenced by all four authoring skills + template
- [x] 211 tests pass (baseline 204); new behaviour covered, each guard mutation-proved
- [x] Every unit reviewed by a fresh independent reviewer; every blocker re-reviewed before merge
- [x] Verified by real browser interaction against scratch copies, not just screenshots
- [x] Merged to `main`, working tree clean, nothing pushed
- [x] Owner report written

## Units
- [merged] **U1 — P2c health-ping** → `8f65b37`. 1 builder (sonnet), 2 reviewers (opus), 1 fixer
  (opus, escalated after the first review). First cut failed review: the heartbeat was still
  coupled to the per-view poller, so it died during an outage — the same bug class it was meant to
  fix. Ownership inverted to one app-level ticker. Then the orchestrator added the 3s fetch
  deadline the re-review flagged, which is what actually catches the motivating incident
  (SIGSTOP-wedged server: 0 failures / no banner after 60s before, banner in ~8s after).
- [merged] **U2 — P2a bulk approve** → `68d8796`. 1 builder (sonnet), 2 reviewers (opus), 2 fixers
  (sonnet). Three passes to get "undecided" right; the chain of consequences is in the commit
  message. Two blockers were caught only because `reject` was promoted to a real decision kind:
  `persistTriage` would have posted a rejected finding to the PR, and the newly-appearing ↺ Undo
  reopened the same hole in two clicks.
- [merged] **U3 — P2b editor keybinding** → `c4104eb`. 1 builder (sonnet), shared reviewer (opus).
  Approved outright.
- [merged] **U4 — coherence** → `37618de`. 1 builder (sonnet), shared reviewer (opus). Two
  should-fixes applied before merge, incl. one place where the guidance instructed the opposite of
  the rule it was attached to.

## Corrections to the original analysis
- **"Post is an enabled CTA at zero approved" was wrong.** It is already `disabled` (opacity .45,
  `cursor: not-allowed`, `web/app.js:1931`); the accent styling reads more live than it is. Only
  the dead-end label was changed. The disabled logic was deliberately left alone.
- **"One vocabulary everywhere" was too broad.** spec *applies* changes, pr-review *posts*
  comments, pr-respond *replies* — those are different acts, not synonyms. Unified within each
  kind instead (spec's button said "Accept" while its own summary said "Apply").

## Backlog (discovered — NOT in this run's DoD)
- **`FLOWLEVER_READONLY=1` (now strongly justified).** Driving Post even against a scratch data dir
  spawns a *real* `claude … /flowlever:watch` runner that talks to real Azure DevOps. Scratch data
  isolates the ledger, not outbound writes. A worker hit this and killed the process within ~1s.
- **`appTick` has no re-entrancy guard** — up to 5 concurrent poll ticks observed under 6s latency.
  Bounded now by the 3s heartbeat deadline; same shape as before this run.
- **`restackBanners()` does not re-run on viewport resize** — banners can cover the sticky topbar
  after a resize until the next tick; breaks down below ~460px.
- **The `title` ≤60-char rule is widely missed in practice** — an independent re-derivation put the
  ledger's median title at 83 characters.
- **X-2 (from the prior run):** workspaces skipped for unreadable JSON are still not rendered on
  the board.
- **Locus prefix drift** — the finish screen shows both `apps/…` and `pr:5843:apps/…` in one
  workspace. Ledger-data-level, cosmetic.
- **No ETag / Cache-Control on static assets** — front-end edits need a hard reload. U1's restart
  banner now tells you when that is why.

## Usage ledger
| Unit | Builders | Reviewers | Fixers | Notes |
|---|---|---|---|---|
| U1 | 1 (sonnet) | 2 (opus) | 1 (opus) | escalated a tier after failing review; orchestrator added the timeout |
| U2 | 1 (sonnet) | 2 (opus) | 2 (sonnet) | **most expensive** — 2 full fix→re-review cycles, both blocker-class |
| U3 | 1 (sonnet) | shared w/ U4 (opus) | — | approved first pass |
| U4 | 1 (sonnet) | shared w/ U3 (opus) | — | orchestrator applied 2 should-fixes |
| **Total** | **4** | **5** | **3** | 12 agents; U2 alone was ~5 of them |
