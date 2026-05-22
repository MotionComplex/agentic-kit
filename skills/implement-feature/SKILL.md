---
name: implement-feature
description: >-
  Implement feature(s) from project docs through PR(s) and CI review loop. Use for
  implement feature, ship feature, /implement-feature, or multiple features.
  Asks how to run work when scope is unclear or plural. Full feature unless user
  scopes down (Phase 1 only, Task 12.1 only).
---

# Implement feature

## Step 0 — Clarify only when needed

**Do not** run a questionnaire for an obvious single feature (e.g. "implement milky way per docs/milky-way-integration.md"). Go straight to work: `single` mode, full scope, no extra labels unless UI preview was requested.

**Ask** (AskQuestion or short numbered list, then wait) only when:

- **Multiple** features, an epic, or a list of tasks/features
- Run mode is unclear (parallel vs sequential vs GitHub-only)
- Scope is ambiguous (whole feature vs one phase/task — and user did not already narrow it)
- User might want `awaiting-e2e` / `human-gate` and did not say

When asking, offer:

| ID | Mode | Best for |
|---|---|---|
| `single` | **One feature, one session → one PR** | Default. You stay in Cursor/Claude; full feature in one branch. |
| `by-tasks` | **One feature, same PR, task-by-task** | Large feature; write `docs/wip/<slug>.md` handoff if context gets heavy. |
| `seq` | **Several features, one after another** | Same machine; finish PR #1 before starting #2. |
| `parallel-gh` | **Several features, parallel via GitHub** | Fire-and-forget: Issue per feature + `@claude implement…` (no shared IDE context). |
| `parallel-wt` | **Several features, parallel in Cursor** | One worktree + branch per feature; you open a window per worktree. |

Optional second question in the same ask (only if relevant): labels (`none` · `awaiting-e2e` · `human-gate`) or scope (full vs Phase X).

Do **not** ask for confirmation on a clear single-feature request. Start implementing.

## What each mode does

### `single` / `by-tasks`

**Full feature** = all phases in the integration doc + all unchecked tasks in that feature section + `.feature` scenarios.

Do **not** stop after Phase 1 or Task 12.1 to ask "want the rest?"

1. Discover scope → checklist  
2. Plan once → implement all → lint/test → one PR  
3. CI review loop runs on push  

`by-tasks`: same, but commit per task; update `docs/wip/<slug>.md` (done / next / blockers) before ending a session.

### `seq`

For each feature in order: run `single` flow to PR, wait for user to say continue (or only start next when they ask).

### `parallel-gh`

For each feature: ensure a GitHub Issue exists with spec; comment:

```text
@claude Implement per this issue and linked docs. Full feature. Open one PR. Do not merge.
```

Tell user: *N issues triggered — watch GitHub notifications; no Cursor context shared.*

### `parallel-wt`

For each feature: `git worktree add ../<repo>-wt/<slug> -b feat/<slug> origin/main`, implement there, open PR. Tell user which worktrees exist.

## Branch (modes that code locally)

```bash
git fetch origin main
git checkout -b feat/<short-slug> origin/main
```

Skip new branch if continuing the same feature on an existing branch.

## Verify & PR

```bash
npm run lint && npm run test:unit
```

E2e when UI changes. Then `gh pr create` with labels the user chose. **Do not merge.**

## Hand off

PR URL(s), mode used, what's done. CI handles review. Optional: `/babysit` when ready to merge.

## Do not

- Ship only Phase 1 when user asked for the feature
- Auto-add `awaiting-e2e` unless user chose preview gate
- Run multiple unrelated features in one chat without `parallel-gh` or separate worktrees
