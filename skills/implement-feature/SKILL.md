---
name: implement-feature
description: >-
  Implement a complete feature from project docs through PR and CI review loop.
  Use for implement feature, ship feature, build from docs, /implement-feature,
  or any doc/task/feature name. Means the WHOLE feature — not one subtask or phase
  unless the user explicitly scopes down (e.g. "Phase 1 only", "Task 12.1 only").
---

# Implement feature

**"Implement feature" = ship the full feature.** All related tasks, phases, and acceptance criteria in the docs — one continuous run until done or blocked.

Do **not** stop after the first subtask, phase, or MVP slice to ask "want the rest?" That is wrong unless the user narrowed scope.

## Scope down only when the user explicitly says

Examples: "Phase 1 only", "MVP only", "Task 12.1 only", "just the dome overlay".

If they name a doc or feature without narrowing → **full feature**.

## 1. Discover scope (read everything)

Find **all** work for this feature:

- Named doc (e.g. `docs/milky-way-integration.md`) — **every phase**, not only Phase 1
- `docs/features/<name>.feature` — all scenarios
- `docs/tasks.md` — **every unchecked task** in that feature's section (e.g. 12.1, 12.2, 12.3)
- `docs/spec.md` if linked

Build one checklist of acceptance criteria. Implement until the checklist is complete.

## 2. Plan once

Brief plan covering the **entire** feature. Then implement — no mid-run scope check-ins.

## 3. Branch

```bash
git fetch origin main
git checkout -b feat/<short-slug> origin/main
```

Use a worktree only if another feature PR is already open on this repo.

## 4. Implement everything

- Complete all tasks/phases in the checklist
- Match repo conventions; split files if >300 lines
- Conventional commits as you go
- Check off completed items in `docs/tasks.md` when done

## 5. Verify

```bash
npm run lint
npm run test:unit
```

Run e2e when UI is involved. Fix failures you introduced; note pre-existing failures separately.

## 6. Open one PR

```bash
git push -u origin HEAD
gh pr create --title "feat(<scope>): <subject>" --body "<what shipped — list all tasks/phases completed>"
```

Labels (only when applicable):

| Situation | Label |
|---|---|
| User asked for preview gate / UI they will eyeball | `awaiting-e2e` |
| User asked to review before bot auto-fixes | `human-gate` |
| Trivial docs-only | `no-claude-loop` |
| **Default** | **none** |

Do **not** merge.

## 7. Hand off

Report: PR link, everything completed, what's left only if truly blocked (missing API keys, ambiguous spec). CI handles review after push.

## Do not

- Deliver Phase 1 alone when asked to implement the feature
- Ask "want Phase 2?" — implement it
- Add `awaiting-e2e` unless user wanted a preview gate or said UI review
