---
name: visual-e2e
description: >-
  Add Playwright visual capture tests and criteria JSON for Claude vision review in CI.
  Use for visual e2e, visual quality tests, /visual-e2e, screenshot review pipeline,
  or when shipping UI that should pass e2e-visual-review on the PR.
---

# Visual E2E

Generate **criteria JSON** + **Playwright visual spec** so CI captures screenshots and Claude judges quality (not pixel diff).

**Reference implementation:** `skyview` — `tests/e2e/visual/milky-way.visual.spec.ts`, `tests/e2e/visual/criteria/milky-way.json`.

## Prerequisites

Confirm the repo has (or install from `agentic-kit/workflows/claude-review-loop`):

- `.github/workflows/e2e-visual-review.yml`
- `.github/workflows/claude-loop.yml` (blocks auto-merge until `visual-review` passes)
- `tests/support/fixtures/visual.ts` — `visitSkyView`, `captureVisual`, writes `test-results/visual-review/manifest.json`
- Playwright project `visual-review` + `npm run test:e2e:visual`

If the visual fixture is missing, copy/adapt from this repo's `tests/support/fixtures/visual.ts`.

**Project repos:** commit real files under `.claude/skills/visual-e2e/` and `.cursor/skills/visual-e2e/`. Never symlink to a local `agentic-kit` path — that breaks on other machines. Canonical source lives in `agentic-kit/skills/visual-e2e/`; sync copies when the skill changes.

## Step 1 — Read the feature spec

From the user's feature doc (`.feature`, integration doc, or story):

- Feature name and `specPath`
- User-visible scenarios worth screenshotting (2–5, not every AC)
- Plain-English **quality goals** — how it should *look and feel*, not implementation
- Per-step criteria: what Claude should verify in *that* screenshot

Avoid pixel thresholds, CSS values, or "must use shader X".

## Step 2 — Write criteria JSON

Path: `tests/e2e/visual/criteria/<feature-slug>.json`

Copy [references/criteria-template.json](references/criteria-template.json). Fill:

| Field | Rule |
|---|---|
| `feature` | Display name |
| `specPath` | Link to spec file |
| `qualityGoals` | 3–6 global quality bars |
| `steps[].id` | kebab-case; **must match** `captureVisual({ id })` in the spec |
| `steps[].scenario` | One line — what the user is doing |
| `steps[].criteria` | 2–4 bullets for that screenshot only |

## Step 3 — Write the visual spec

Path: `tests/e2e/visual/<feature-slug>.visual.spec.ts`

Copy [references/spec-template.ts](references/spec-template.ts). Pattern:

1. Load criteria JSON; helper `stepCriteria(id)` falls back to `qualityGoals`
2. `visitSkyView` (or project equivalent) — stable date/location/filters
3. Drive UI to the scenario state; short `waitForTimeout` after animations
4. `captureVisual({ page, id, scenario, criteria, target? })` — `target: "viewport"` for drawers/modals; default `"dome"` crops the sky dome

One test per logical capture group; each `id` in criteria must be captured exactly once.

## Step 4 — Verify locally

```bash
npm run test:e2e:visual
ls test-results/visual-review/   # manifest.json + *.png
```

Fix flaky setup (toggles, expand buttons) before pushing.

## Step 5 — Wire CI (if new feature paths)

`e2e-visual-review.yml` already watches `tests/e2e/**`. No workflow change unless captures need a new npm script.

On PR: **visual-review-capture** → artifact → **visual-review** posts `<!-- claude-visual:summary -->`. `claude-loop` blocks auto-merge until visual passes.

## Do not

- Add pixel-diff baselines — this pipeline is **judgment-based**, not snapshot regression
- Duplicate functional e2e — visual specs only navigate + screenshot
- Use vague criteria ("looks good") — be specific about band, layout, polish, toggle behavior
- Mismatch `id` between JSON and spec — manifest keys drive the vision prompt

## When to skip

Pure backend/API changes, refactors with no UI delta, or PR labeled to skip the loop (`no-claude-loop`).
