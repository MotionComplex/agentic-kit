<!-- claude-review-loop:begin -->
## Automated PR review loop

This repo runs an automated Claude review-fix loop on every PR (subscription-billed via
`CLAUDE_CODE_OAUTH_TOKEN`). The flow:

1. PR is opened or updated → `.github/workflows/claude-code-review.yml` reviews against
   `.github/PR-REVIEW-RUBRIC.md` and posts a review with a machine-readable summary block.
2. `.github/workflows/claude-loop.yml` parses the summary and decides:
   - **Pass** if `Confidence ≥ 4/5 AND Critical == 0 AND Unresolved == 0` → done.
   - **Stop** if iteration count reached `MAX_ITER` (default **3**) → manual review.
   - **Continue** otherwise → push a fix commit. The new commit triggers the review workflow
     again, which posts a new summary, which feeds back into this decision.

### Skipping the loop on trivial PRs

When opening a PR that is purely:

- Documentation-only (markdown, comments, no code logic changes)
- Version bump or dependency upgrade with no source changes
- Typo / whitespace / formatting only

Add the **`no-claude-loop`** label so the loop and review do not burn quota. This applies to
agent-created PRs too: if you are an agent opening a PR that matches the criteria above, apply
the label as part of `gh pr create`.

### Manual escape hatches

- Add the `no-claude-loop` label any time to halt further iterations on a PR.
- Comment `@claude` on the PR to engage the interactive workflow (`claude.yml`); this is
  independent of the loop.

### Tuning

Defaults live as `env:` keys at the top of `.github/workflows/claude-loop.yml`:

| Key | Default | Effect |
|---|---|---|
| `MAX_ITER` | 3 | Hard cap on review-fix rounds. |
| `MIN_CONFIDENCE` | 4 | Minimum score required to pass. |

The rubric itself is at `.github/PR-REVIEW-RUBRIC.md` — edit it to tighten or loosen review
strictness without changing workflow code.

### Follow-up: dependency security ("tech-guardian")

Dependency vulnerability + freshness checks intentionally live outside this loop. Use
Dependabot + `npm audit` (or equivalent) in a separate workflow rather than asking Claude
to do CVE research at review time.

### Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Workflow fails with `Could not resolve authentication credentials` or `validateHeaders` errors | `CLAUDE_CODE_OAUTH_TOKEN` expired (~1h validity in some setups) or rotated | Locally: `claude setup-token`. Then: `gh secret set CLAUDE_CODE_OAUTH_TOKEN` and paste the new value. |
| Loop posts `summary block missing or unparseable` | Reviewer didn't emit the `<!-- claude-review:summary -->` block | Inspect the review body in the Actions log. If the prompt was ignored, tighten the rubric or re-run by closing/reopening the PR. |
| Loop never triggers after Claude pushes a fix | Push didn't fire `pull_request: synchronize` | Confirm the Claude GitHub App is installed on the repo (not the default `GITHUB_TOKEN`). Pushes from `github-actions[bot]` do not re-trigger workflows. |
| Loop runs but you don't want it on a PR | — | Add the `no-claude-loop` label. |

Verify the secret exists: `gh secret list` should show `CLAUDE_CODE_OAUTH_TOKEN`.
<!-- claude-review-loop:end -->
