# Code Review Conventions

<!--
Promotion template: copy this into a team repo at `docs/conventions/code-review.md` when
the team agrees to adopt the convention. Strip the personal-preference framing — this version
is "this is how we review code on this project", not "this is how I review code".
-->

We use [Conventional Comments](https://conventionalcomments.org/) for all PR review feedback.
Each comment starts with a label (and optional decoration), then the subject:

```
label (decoration): subject
```

## Labels

| Label | Meaning | Decoration |
|---|---|---|
| `issue` | A problem in the code. | `(blocking)` if must be fixed before merge, `(non-blocking)` otherwise |
| `suggestion` | A concrete proposed change that isn't strictly required. | usually none |
| `question` | Needs the author to clarify. Prefer over `issue` when uncertain. | usually none |
| `nitpick` | Trivial preference (style, naming). Always non-blocking. | `(non-blocking)` |

Other Conventional Comments labels (`praise`, `todo`, `thought`, `chore`, `note`) are allowed
when they fit, but the four above cover most cases.

**Don't** invent custom severity labels (🔴/🟡/🟢, P0/P1, "must-fix") in place of these.

## Examples

- `issue (blocking): missing null check on line 42`
- `suggestion: extract this retry policy into a helper`
- `question: should this short-circuit on empty input?`
- `nitpick (non-blocking): naming — prefer "fetch" over "get" here`

## Anchoring

Every review comment must be anchored to a specific file/line range. If a comment doesn't
have a code anchor, it belongs in the PR description or a separate discussion — not as a
review comment.

## Confidence floor

If you're not sure a piece of code is wrong, raise it as a `question`, not an `issue`.
Speculative `issue (blocking)`s waste the author's time. Read more code first; if still
uncertain, ask.

## When using Claude Code

The `pr-review` skill in `agentic-kit/skills/pr-review/` enforces this convention
automatically when generating reviews.
