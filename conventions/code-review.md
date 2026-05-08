# Code Review Conventions

Status: **draft** — used personally; not yet promoted to team repos.

## Comment labels: Conventional Comments

Use [Conventional Comments](https://conventionalcomments.org/) for all review feedback —
markdown drafts, inline PR threads, ad-hoc pair-programming notes.

Format: `label (decoration): subject`.

Active labels:

| Label | Meaning | Decoration |
|---|---|---|
| `issue` | A problem in the code. | `(blocking)` if must be fixed before merge, `(non-blocking)` otherwise |
| `suggestion` | A concrete proposed change that isn't strictly required. | usually none |
| `question` | Needs the author to clarify. Prefer over `issue` when uncertain. | usually none |
| `nitpick` | Trivial preference (style, naming, wording). Always non-blocking. | `(non-blocking)` |

Other Conventional Comments labels (`praise`, `todo`, `thought`, `chore`, `note`) are
allowed when they fit, but the four above cover most cases.

**Do not** invent custom severity labels (🔴/🟡/🟢, P0/P1, "must-fix") in place of these.

Examples:
- `issue (blocking): missing null check on line 42`
- `suggestion: extract this retry policy into a helper`
- `question: should this short-circuit on empty input?`
- `nitpick (non-blocking): naming — prefer "fetch" over "get" here`

## Confidence floor

If a finding requires speculation about runtime behavior or external state you can't verify,
either drop it or convert it to a `question`. Speculative `issue`s waste the author's time
and erode review trust. Read more code first; if still uncertain, ask.

## Anchoring

Every finding must reference `path/to/file.ext:line` or `path/to/file.ext:start-end`. Findings
without a code anchor are unactionable — drop them or find the right anchor.

## When to use this convention

- Personally, in any review I produce (markdown drafts, inline PR threads).
- The `pr-review` skill enforces it.
- When promoting to a team: copy to the team repo's `docs/conventions/code-review.md`
  using `../templates/docs-conventions/code-review.template.md`.
