<!-- feature-dev:begin -->
## Feature workflow (portable)

Same flow as `.cursor/rules/feature-workflow.mdc` — applies in Cursor, Claude Code CLI, and headless GitHub.

1. Plan → approve → implement (one worktree per parallel feature).
2. Before PR: lint + unit tests; e2e when UI-critical.
3. `gh pr create` with labels: `no-claude-loop` (trivial), `awaiting-e2e` (UI), `human-gate` (you review before auto-fix continues).
4. CI runs the Claude review loop if installed (see claude-review-loop section above).
5. `/babysit` when ready to merge.

**Headless:** `@claude` on a GitHub Issue — no local IDE required.

**Stay informed:** Watch the repo; set `HUMAN_GATE_NOTIFY` repo variable for @mentions when gates fire.
<!-- feature-dev:end -->
