---
name: implement-feature
description: >-
  End-to-end feature implementation from project docs through PR and CI review loop.
  Use when the user says implement feature, ship feature, build from docs, /implement-feature,
  or names a doc like milky-way-integration.md or a task from docs/tasks.md.
---

# Implement feature

Ship a feature from spec to an open PR. CI runs the Claude review loop after you push; you are notified on GitHub.

## Inputs

User may give: task id (`Task 2.4`), feature name (`milky way`, `milkyway`), or doc path (`docs/milky-way-integration.md`). Resolve all relevant docs before coding.

## 1. Discover docs

Search and read (at minimum):

- The named doc, if provided
- `docs/features/*.feature` matching the feature name
- Matching unchecked items in `docs/tasks.md`
- `docs/spec.md` if it references this feature
- `AGENTS.md` / `CLAUDE.md` for repo conventions

If scope is ambiguous, ask one short question; otherwise proceed.

## 2. Plan

Produce a brief plan: files to touch, approach, tests. Do not edit code until the plan is clear (user already approved by invoking this skill).

## 3. Branch

From latest `main`:

```bash
git fetch origin main
git checkout -b feat/<short-slug> origin/main
```

For parallel work, use a worktree instead:

```bash
git worktree add ../<repo>-wt/<short-slug> -b feat/<short-slug> origin/main
```

## 4. Implement

- Match existing code style and architecture
- Keep files under ~300 lines; split if needed
- Conventional commits as you go

## 5. Verify

Run (or project equivalents from `package.json`):

```bash
npm run lint
npm run test:unit
```

Run `npm run test:e2e` when the feature changes UI, routes, or user-visible flows.

## 6. Open PR

```bash
git push -u origin HEAD
gh pr create --title "feat(<scope>): <subject>" --body "<summary + test plan>"
```

Labels:

| Situation | Label |
|---|---|
| UI / UX / visual flows | `awaiting-e2e` |
| User wants to review before bot auto-fixes | `human-gate` |
| Docs-only / typo / deps-only | `no-claude-loop` |
| Default | none |

Do **not** merge.

## 7. Hand off

Tell the user:

- PR URL and number
- Labels applied
- CI will review and auto-fix up to 3 rounds
- If `awaiting-e2e`: wait for Vercel preview on the **latest** commit, verify, remove label, merge
- Optional finalize: `/babysit`

## Do not

- Skip lint/tests before PR unless user explicitly overrides
- Merge or enable auto-merge
- Run greploop locally (CI handles review)
