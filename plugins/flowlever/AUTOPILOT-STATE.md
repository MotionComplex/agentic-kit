# Autopilot — FlowLever review-cockpit P2 run

**Goal:** Finish the P2 tier of this session's UX analysis (bulk approve + Post-button gating,
⌘↵ save in the comment editor, server health-ping), plus the coherence work needed to give the
new comment-brevity rule a single home, and land it all on `main`.

**Integration branch:** `feat/flowlever-p2` off `main` (per-unit branches off that; final
`--no-ff` merge into `main` — the owner asked for work directly on main and is away).
**Baseline:** `9fcfd5b` (P0+P1: markdown rendering, decision-row placement, comment length rule).
**Scratch data dir:** `<scratchpad>/fl-data` — a copy of `~/.flowlever`. All browser verification
runs against this, never the live ledger.

> The previous autopilot run's record (the REVIEW.md 48-finding fix run) lived in this file and
> is preserved in git at `49dae65`. One truth per file, so this run replaces it.

## DoD
- [ ] P2a — "Approve all remaining" on the finish screen; Post disabled at 0 approved
- [ ] P2b — ⌘↵ / Ctrl+↵ saves in the comment editor
- [ ] P2c — health-ping surfaces an unreachable/hung cockpit as a banner
- [ ] Coherence — comment-brevity rule has one home, referenced by all four authoring skills
- [ ] All 204+ tests pass; new behaviour covered where the suite can reach it
- [ ] Each unit reviewed by a fresh independent reviewer; blockers re-reviewed
- [ ] Verified against the SCRATCH data dir by real browser interaction, not just screenshots
- [ ] Merged to `main`, working tree clean, nothing pushed
- [ ] Owner report written

## Units
- [todo] U1 — P2c health-ping. `src/server.js` (health endpoint), `web/app.js` (poll + banner),
  `web/style.css`. Server-side behaviour is test-reachable.
- [todo] U2 — P2a finish screen. `web/app.js` (`finishView`, `postActionEl`), `web/style.css`.
- [todo] U3 — P2b editor keybinding. `web/app.js` (`commentEditForm`).
- [todo] U4 — Coherence: brevity rule → `conventions/code-review.md`, referenced from
  `skills/pr-review`, `skills/pr-respond`, `plugins/flowlever/skills/pr-review`,
  `plugins/flowlever/skills/pr-respond`. Docs only — file-disjoint from U1–U3.

U1–U3 all touch `web/app.js`, so their builders run **sequentially**. U4 is file-disjoint and
runs in parallel with U1.

## Cycle log
- **Cycle 0 (setup).** Contract read (`conventions/`, `app/docs/ARCHITECTURE.md`). Found the
  coherence gap that became U4: `conventions/code-review.md` declares itself the canonical
  comment convention and says "the pr-review skill enforces it", but carries no length rule —
  so the brevity budget added in `9fcfd5b` lives in 2 of the 4 comment-authoring sites and not
  in the convention that claims to own it. Integration branch and scratch data dir created.

## Backlog (discovered — NOT in this run's DoD)
- **X-2 from the prior run:** workspaces skipped for unreadable JSON are reported on a response
  header and `/api/diagnostics` but never rendered on the board. Still true. Deferred there for
  needing browser verification; out of scope here.
- **Locus prefix drift:** the finish screen shows both `apps/…` and `pr:5843:apps/…` for findings
  in the same workspace (visible in this session's screenshots). Cosmetic, ledger-data-level.
- **No ETag / Cache-Control on static assets** — front-end edits need a hard reload to appear.

## Usage ledger
| Unit | Builders | Reviewers | Fixers | Notes |
|---|---|---|---|---|
| (pending) | | | | |
