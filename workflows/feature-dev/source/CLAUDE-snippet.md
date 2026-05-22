<!-- feature-dev:begin -->
## Feature workflow (portable)

Same flow as `.cursor/rules/feature-workflow.mdc` — applies in Claude Code CLI and any editor.

1. Plan → approve → implement in a dedicated branch or worktree.
2. Before PR: lint + unit tests; e2e when UI-critical.
3. `gh pr create` with labels: `no-claude-loop` (trivial), `human-gate` (hold auto-merge for your review).
4. CI runs the Claude review loop (see `<!-- claude-review-loop:begin -->` section if installed).
5. Loop passes → auto-merge (unless `human-gate`). Use `/babysit` only if the loop stalls.

Headless: `@claude` on a GitHub Issue to implement without a local IDE.
<!-- feature-dev:end -->
